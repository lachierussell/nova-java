/**
 * Lifecycle management for the Eclipse JDT language server.
 */
import { config, getConfig } from "./config";
import {
  findGradleWrapper,
  findJavaExecutable,
  findJavaHome,
  findJdtls,
  findJdtlsConfigPath,
  findProjectRoot,
} from "./paths";
import { expandPath } from "./novaUtils";
import { notify } from "./notify";
import { InformationView } from "./sidebar/informationView";

const FLAVOR_NONE = "none";
const FLAVOR_CUSTOM = "custom";

/** How long a launch must survive before we stop counting it as a crash loop. */
const HEALTHY_UPTIME_MS = 60_000;
/** Consecutive crashes before we stop restarting and ask the user to step in. */
const MAX_CRASH_RESTARTS = 4;

export class JavaLanguageServer {
  private client: LanguageClient | null = null;
  private stopListener: Disposable | null = null;
  private readonly info: InformationView;

  /**
   * Nova refuses to launch two language clients with the same identifier, and
   * a client that failed to shut down cleanly can keep its identifier
   * reserved. Giving every launch a fresh identifier means a wedged client can
   * never block a restart with "it's already running".
   */
  private generation = 0;

  /** True while we are deliberately stopping, so `onDidStop` isn't a crash. */
  private stoppingIntentionally = false;
  private startedAt = 0;
  private crashCount = 0;
  private crashTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(info: InformationView) {
    this.info = info;
  }

  get languageClient(): LanguageClient | null {
    // Never hand out a client that is no longer running: every request against
    // it would reject, including format-on-save.
    if (this.client && this.client.running === false) return null;
    return this.client;
  }

  /** Tear down and relaunch the server, resetting any crash backoff. */
  restart(): void {
    this.crashCount = 0;
    this.start();
  }

  start(): void {
    this.stop();
    if (this.disposed) return;

    const flavor = getConfig<string>(config.lspFlavor) ?? "auto";
    if (flavor === FLAVOR_NONE) {
      console.log("Java language server disabled by preference.");
      this.info.setStatus("stopped");
      return;
    }

    const javaHome = findJavaHome();
    if (!javaHome) {
      this.info.setStatus("failed");
      notify.error(
        "Java JDK not found",
        "Set “Java JDK Home” in the extension preferences.",
      );
      return;
    }
    this.info.setJavaHome(javaHome);

    const serverPath =
      flavor === FLAVOR_CUSTOM
        ? optionalExpand(getConfig<string>(config.lspPath))
        : findJdtls();
    if (!serverPath) {
      this.info.setStatus("failed");
      notify.error(
        "Language server (jdtls) not found",
        "Install Eclipse JDT.LS (e.g. `brew install jdtls`) or set a custom path.",
      );
      return;
    }

    const projectRoot = findProjectRoot();
    this.info.setServerPath(serverPath);
    this.info.setProjectRoot(projectRoot);
    this.info.setGradleWrapper(findGradleWrapper() ?? "—");
    this.info.setStatus("starting");

    const identifier = `java-lsp-${++this.generation}`;
    let client: LanguageClient;
    try {
      client = new LanguageClient(
        identifier,
        "Java Language Server",
        this.buildServerOptions(serverPath, javaHome, projectRoot),
        this.buildClientOptions(javaHome, projectRoot),
      );
    } catch (err) {
      this.info.setStatus("failed");
      notify.error(
        "Could not create the Java language server",
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    this.stopListener = client.onDidStop((err) => {
      this.handleDidStop(client, err);
    });

    try {
      client.start();
      this.client = client;
      this.startedAt = Date.now();
      this.info.setStatus("running");
      console.log(`Java language server started (${identifier}).`);
    } catch (err) {
      this.stopListener?.dispose();
      this.stopListener = null;
      this.info.setStatus("failed");
      notify.error(
        "Could not start the Java language server",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  stop(): void {
    if (this.crashTimer != null) {
      clearTimeout(this.crashTimer);
      this.crashTimer = undefined;
    }
    // Detach first: a deliberate stop must not be mistaken for a crash and
    // trigger the auto-restart path.
    this.stopListener?.dispose();
    this.stopListener = null;

    const client = this.client;
    this.client = null;
    if (client) {
      this.stoppingIntentionally = true;
      try {
        client.stop();
      } catch (err) {
        console.error("Error stopping the Java language server:", String(err));
      } finally {
        this.stoppingIntentionally = false;
      }
    }
    this.info.setStatus("stopped");
  }

  /** Stop for good; no further automatic restarts. */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /**
   * The server exited on its own. Restart it with a growing backoff so a
   * transient crash recovers silently, but a genuinely broken configuration
   * doesn't spin forever.
   */
  private handleDidStop(client: LanguageClient, err?: Error): void {
    if (this.client !== client) return; // A stale client we already replaced.
    if (this.stoppingIntentionally || this.disposed) return;

    this.client = null;
    this.stopListener?.dispose();
    this.stopListener = null;
    this.info.setStatus(err ? "failed" : "stopped");
    if (err) console.error("Java language server stopped:", String(err));

    // A launch that survived a while is healthy; treat this as a fresh fault
    // rather than a continuation of an earlier crash loop.
    if (Date.now() - this.startedAt > HEALTHY_UPTIME_MS) this.crashCount = 0;

    if (this.crashCount >= MAX_CRASH_RESTARTS) {
      notify.error(
        "The Java language server keeps crashing",
        "Automatic restarts have been paused. Check the Extension Console, then use “Restart Language Server”.",
      );
      return;
    }

    const delay = 1000 * 2 ** this.crashCount;
    this.crashCount++;
    console.log(
      `Java language server exited unexpectedly; restarting in ${delay}ms (attempt ${this.crashCount}/${MAX_CRASH_RESTARTS}).`,
    );
    this.crashTimer = setTimeout(() => {
      this.crashTimer = undefined;
      this.start();
    }, delay);
  }

  /**
   * A writable data directory, unique per project root. Keying on the folder
   * name alone made two projects with the same basename share one JDT.LS
   * workspace, which corrupts the index and locks the server.
   */
  private dataDir(projectRoot: string): string {
    const dir = nova.path.join(
      nova.extension.globalStoragePath,
      "workspaces",
      `${nova.path.basename(projectRoot)}-${hashPath(projectRoot)}`,
    );
    try {
      nova.fs.mkdir(dir);
    } catch {
      // Already exists.
    }
    return dir;
  }

  private buildServerOptions(
    serverPath: string,
    javaHome: string,
    projectRoot: string,
  ): ServerOptions {
    const dataDir = this.dataDir(projectRoot);
    const isScript =
      serverPath.endsWith("jdtls") || !serverPath.endsWith(".jar");

    const argv = isScript
      ? [serverPath, "-configuration", findJdtlsConfigPath(), "-data", dataDir]
      : [
          findJavaExecutable(),
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Dlog.level=ALL",
          "-Xmx1G",
          "--add-modules=ALL-SYSTEM",
          "--add-opens",
          "java.base/java.util=ALL-UNNAMED",
          "--add-opens",
          "java.base/java.lang=ALL-UNNAMED",
          "-jar",
          serverPath,
          "-configuration",
          findJdtlsConfigPath(),
          "-data",
          dataDir,
        ];

    // Nova's ServerOptions has no `cwd`, so go through a shell to place the
    // server in the configured project root. JDT.LS resolves relative build
    // files (and Gradle's project discovery) against its working directory.
    return {
      path: "/bin/sh",
      args: [
        "-c",
        `cd ${shellQuote(projectRoot)} && exec ${argv.map(shellQuote).join(" ")}`,
      ],
      env: { JAVA_HOME: javaHome },
    };
  }

  private buildClientOptions(
    javaHome: string,
    projectRoot: string,
  ): {
    syntaxes: string[];
    initializationOptions: Record<string, unknown>;
  } {
    const lintEnabled =
      (getConfig<boolean>(config.lintEnabled) ?? true) === true;

    return {
      syntaxes: ["java"],
      initializationOptions: {
        workspaceFolders: [`file://${projectRoot}`],
        settings: {
          java: {
            home: javaHome,
            configuration: { updateBuildConfiguration: "automatic" },
            format: { enabled: true },
            autobuild: { enabled: true },
            errors: {
              incompleteClasspath: {
                severity: lintEnabled ? "warning" : "ignore",
              },
            },
            completion: { enabled: true, guessMethodArguments: true },
            signatureHelp: { enabled: true },
            contentProvider: { preferred: "fernflower" },
            referencesCodeLens: { enabled: false },
            inlayHints: {
              parameterNames: {
                enabled:
                  getConfig<string>(config.inlayParameterNames) ?? "none",
              },
            },
          },
        },
      },
    };
  }
}

function optionalExpand(path: string | null): string | null {
  return path ? expandPath(path) : null;
}

/** Wrap an argument in single quotes for `sh -c`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Short, stable hash of a path, used to key per-project data directories. */
function hashPath(path: string): string {
  let hash = 5381;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) + hash + path.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
