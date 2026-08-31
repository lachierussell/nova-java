/**
 * Lifecycle management for the Eclipse JDT language server.
 */
import { config, getConfig } from "./config";
import {
  MINIMUM_JAVA_MAJOR,
  findGradleWrapper,
  findJavaExecutable,
  findJavaHome,
  findJdtls,
  findJdtlsConfigPath,
  findProjectRoot,
  findPython,
  javaMajorForHome,
} from "./paths";
import { delay, expandPath, hashString, mkdirRecursive } from "./novaUtils";
import { reapOrphanedServers } from "./reapServers";
import { notify } from "./notify";
import { setRevealClient } from "./reveal";
import { InformationView } from "./sidebar/informationView";

const FLAVOR_NONE = "none";
const FLAVOR_CUSTOM = "custom";

/** How long a launch must survive before we stop counting it as a crash loop. */
const HEALTHY_UPTIME_MS = 60_000;
/** Consecutive crashes before we stop restarting and ask the user to step in. */
const MAX_CRASH_RESTARTS = 4;

/**
 * Pause between stopping a server and starting the next one.
 *
 * JDT.LS holds an exclusive Eclipse lock on its `-data` directory for as long
 * as the JVM is alive, and the JVM outlives `client.stop()`. This is only the
 * grace period in which a healthy server may exit on its own; anything still
 * running afterwards is killed outright by `reapOrphanedServers`, which is
 * what actually guarantees the lock is free before the next launch.
 */
const RESTART_SETTLE_MS = 1000;

/** Eclipse formatter profiles we can point JDT.LS at for the style presets. */
const FORMATTER_PROFILES: Record<string, { url: string; profile: string }> = {
  google: {
    url: "https://raw.githubusercontent.com/google/styleguide/gh-pages/eclipse-java-google-style.xml",
    profile: "GoogleStyle",
  },
  aosp: {
    url: "https://raw.githubusercontent.com/aosp-mirror/platform_development/master/ide/eclipse/android-formatting.xml",
    profile: "Android",
  },
};

export class JavaLanguageServer {
  private client: LanguageClient | null = null;
  private listeners: Disposable[] = [];
  private readonly info: InformationView;

  /**
   * Nova refuses to launch two language clients with the same identifier, and
   * a client that failed to shut down cleanly can keep its identifier
   * reserved. Giving every launch a fresh identifier means a wedged client can
   * never block a restart with "it's already running".
   */
  private generation = 0;

  private startedAt = 0;
  private crashCount = 0;
  private crashTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  /** The data directory of the most recent launch, so `dispose` can reap it. */
  private lastDataDir: string | null = null;

  /**
   * JDT.LS is connected long before it can answer anything: it has to import
   * the project first, which takes seconds to minutes. Until it reports
   * ServiceReady, hover and completion return nothing — so we track that
   * rather than claiming "running" the moment the process is spawned.
   */
  private ready = false;

  /**
   * Serialises every lifecycle transition. Without this, a restart triggered
   * while another is mid-flight interleaves two launches against one data
   * directory.
   */
  private queue: Promise<void> = Promise.resolve();

  /** Called once the server starts answering requests, so views can load. */
  onDidBecomeReady: (() => void) | null = null;

  constructor(info: InformationView) {
    this.info = info;
  }

  get languageClient(): LanguageClient | null {
    // Never hand out a client that is no longer running: every request against
    // it would reject, including format-on-save.
    if (this.client && this.client.running === false) return null;
    return this.client;
  }

  /** Has the server finished importing and started answering requests? */
  get isReady(): boolean {
    return this.languageClient != null && this.ready;
  }

  /** Queue a lifecycle transition behind whatever is already in flight. */
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work, work);
    return this.queue;
  }

  start(): Promise<void> {
    return this.enqueue(() => this.startNow());
  }

  /** Tear down and relaunch the server, resetting any crash backoff. */
  restart(): Promise<void> {
    return this.enqueue(async () => {
      this.crashCount = 0;
      const wasRunning = this.client != null;
      this.stopNow();
      // Only wait when there was a JVM holding the workspace lock.
      if (wasRunning) await delay(RESTART_SETTLE_MS);
      await this.startNow();
    });
  }

  stop(): Promise<void> {
    return this.enqueue(async () => this.stopNow());
  }

  /** Stop for good; no further automatic restarts. */
  dispose(): void {
    this.disposed = true;
    this.stopNow();
    // Best effort: Nova may tear the extension down before this finishes, but
    // when it does complete it saves the next launch from inheriting an
    // orphan. A launch reaps on its own regardless.
    if (this.lastDataDir) void reapOrphanedServers(this.lastDataDir);
  }

  private async startNow(): Promise<void> {
    this.stopNow();
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
        `JDT.LS needs Java ${MINIMUM_JAVA_MAJOR} or newer. Set “Java JDK Home” in the extension preferences.`,
      );
      return;
    }
    this.warnIfJavaTooOld(javaHome);
    this.info.setJavaHome(javaHome);

    const serverPath =
      flavor === FLAVOR_CUSTOM
        ? expandOptional(getConfig<string>(config.lspPath))
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

    const dataDir = this.dataDir(projectRoot);
    this.lastDataDir = dataDir;
    // We hold no client at this point, so any JVM still sitting on this data
    // directory is an orphan — from a stop that never took, or from a Nova
    // that quit without reaping. It holds the Eclipse workspace lock, and the
    // server we are about to launch would come up unable to take it.
    await reapOrphanedServers(dataDir);

    const identifier = `java-lsp-${++this.generation}`;
    const serverOptions = this.buildServerOptions(
      serverPath,
      javaHome,
      projectRoot,
      dataDir,
    );
    const clientOptions = this.buildClientOptions(projectRoot);
    console.log(
      `[lsp] launching ${serverOptions.path} ${JSON.stringify(serverOptions.args)}`,
    );
    console.log(
      `[lsp] bound to syntaxes=${JSON.stringify(clientOptions.syntaxes)} ` +
        `debug=${clientOptions.debug}`,
    );

    let client: LanguageClient;
    try {
      client = new LanguageClient(
        identifier,
        "Java Language Server",
        serverOptions,
        clientOptions,
      );
    } catch (err) {
      this.info.setStatus("failed");
      notify.error(
        "Could not create the Java language server",
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    this.attachListeners(client);

    try {
      client.start();
      this.client = client;
      this.ready = false;
      setRevealClient(client);
      this.startedAt = Date.now();
      // Deliberately not "running": the server is spawned but cannot answer a
      // request until it reports ServiceReady. See `ready`.
      this.info.setStatus("starting");
      console.log(`Java language server started (${identifier}).`);
    } catch (err) {
      this.detachListeners();
      this.info.setStatus("failed");
      notify.error(
        "Could not start the Java language server",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Wire up the server-to-client traffic JDT.LS relies on. Nova surfaces none
   * of this on its own, so without it the extension is blind to import
   * progress and to the errors that explain a server which answers nothing.
   */
  private attachListeners(client: LanguageClient): void {
    this.listeners.push(
      client.onDidStop((err) => {
        this.handleDidStop(client, err);
      }),
    );

    // Everything the server pushes, so the console shows the full picture.
    for (const method of [
      "textDocument/publishDiagnostics",
      "window/showMessage",
      "telemetry/event",
      "$/progress",
    ]) {
      client.onNotification(method, (params: unknown) => {
        console.log(`[lsp<-] ${method} ${summarise(params)}`);
      });
    }

    // Import progress. JDT.LS emits this throughout startup and it is the only
    // reliable signal that the server is actually usable.
    client.onNotification("language/status", (params: unknown) => {
      const status = params as { type?: string; message?: string };
      switch (status.type) {
        case "Starting":
          this.info.setStatus("starting", status.message);
          break;
        case "Started":
        case "ServiceReady":
          // JDT.LS sends both; only announce the transition once.
          if (!this.ready) {
            console.log("Java language server is ready.");
            this.ready = true;
            this.onDidBecomeReady?.();
          }
          this.info.setStatus("running", status.message);
          break;
        case "Error":
          this.info.setStatus("failed", status.message);
          console.error(`Java language server error: ${status.message ?? ""}`);
          break;
        default:
          break;
      }
    });

    // Server-side logs. The reason an import failed only ever appears here.
    client.onNotification("window/logMessage", (params: unknown) => {
      const log = params as { type?: number; message?: string };
      if (!log.message) return;
      if (log.type === 1) console.error(`[jdtls] ${log.message}`);
      else if (log.type === 2) console.warn(`[jdtls] ${log.message}`);
    });

    // JDT.LS pulls settings back out of the client; answering with our own
    // configuration keeps the two in step after a live settings change.
    client.onRequest("workspace/configuration", (params: unknown) => {
      const items =
        (params as { items?: { section?: string }[] } | undefined)?.items ?? [];
      const settings = this.buildJavaSettings();
      return items.map((item) => resolveSection(settings, item.section));
    });
  }

  private detachListeners(): void {
    for (const listener of this.listeners) listener.dispose();
    this.listeners = [];
  }

  /**
   * Push the current settings to a running server. Most preferences take
   * effect this way, so a restart — which costs a full project re-import — is
   * only warranted for the ones that change how the process is launched.
   */
  applySettings(): void {
    const client = this.languageClient;
    if (!client) return;
    try {
      client.sendNotification("workspace/didChangeConfiguration", {
        settings: this.buildJavaSettings(),
      });
    } catch (err) {
      console.error("Could not push Java settings to the server:", String(err));
    }
  }

  private stopNow(): void {
    if (this.crashTimer != null) {
      clearTimeout(this.crashTimer);
      this.crashTimer = undefined;
    }
    // Detach first: a deliberate stop must not be mistaken for a crash and
    // trigger the auto-restart path.
    this.detachListeners();

    const client = this.client;
    this.client = null;
    this.ready = false;
    setRevealClient(null);
    if (client) {
      try {
        client.stop();
      } catch (err) {
        console.error("Error stopping the Java language server:", String(err));
      }
    }
    this.info.setStatus("stopped");
  }

  private warnIfJavaTooOld(javaHome: string): void {
    const major = javaMajorForHome(javaHome);
    if (major != null && major < MINIMUM_JAVA_MAJOR) {
      notify.warn(
        `Java ${major} is too old for the language server`,
        `Eclipse JDT.LS needs Java ${MINIMUM_JAVA_MAJOR} or newer. Set “Java JDK Home” to a newer JDK.`,
      );
    }
  }

  /**
   * The server exited on its own. Restart it with a growing backoff so a
   * transient crash recovers silently, but a genuinely broken configuration
   * doesn't spin forever.
   */
  private handleDidStop(client: LanguageClient, err?: Error): void {
    // A stale client we already stopped and replaced; not a crash.
    if (this.client !== client || this.disposed) return;

    this.client = null;
    this.ready = false;
    setRevealClient(null);
    this.detachListeners();
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

    const backoff = 1000 * 2 ** this.crashCount;
    this.crashCount++;
    console.log(
      `Java language server exited unexpectedly; restarting in ${backoff}ms (attempt ${this.crashCount}/${MAX_CRASH_RESTARTS}).`,
    );
    this.crashTimer = setTimeout(() => {
      this.crashTimer = undefined;
      void this.start();
    }, backoff);
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
      `${nova.path.basename(projectRoot)}-${hashString(projectRoot)}`,
    );
    mkdirRecursive(dir);
    return dir;
  }

  private buildServerOptions(
    serverPath: string,
    javaHome: string,
    projectRoot: string,
    dataDir: string,
  ): ServerOptions {
    const isScript =
      serverPath.endsWith("jdtls") || !serverPath.endsWith(".jar");

    let argv: string[];
    if (isScript) {
      // The `jdtls` launcher picks the Equinox configuration itself — it sets
      // a read-only shared configuration area that cascades into a writable
      // per-workspace one. Passing `-configuration` here overrides that with a
      // directory inside the (read-only) install prefix, and the server then
      // comes up unable to answer requests.
      argv = [serverPath, "-data", dataDir];
    } else {
      const configPath = findJdtlsConfigPath(serverPath);
      argv = [
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
        ...(configPath ? ["-configuration", configPath] : []),
        "-data",
        dataDir,
      ];
    }

    const command = argv.map(shellQuote).join(" ");

    // Nova's ServerOptions has no `cwd`, so go through a shell to place the
    // server in the configured project root. JDT.LS resolves relative build
    // files (and Gradle's project discovery) against its working directory.
    return {
      type: "stdio",
      path: "/bin/sh",
      args: [
        "-c",
        `cd ${shellQuote(projectRoot)} && ${this.wrapWithShim(command, dataDir)}`,
      ],
      env: { JAVA_HOME: javaHome },
    };
  }

  /**
   * Launch the server behind the LSP shim.
   *
   * Nova advertises `dynamicRegistration: true` for hover, completion,
   * definition, signatureHelp, documentHighlight and codeAction. JDT.LS
   * therefore leaves all of them out of its `initialize` response and
   * announces them later with `client/registerCapability` — which Nova
   * acknowledges and then ignores, so it never sends those requests at all.
   * That is why hover did nothing while references, formatting and rename
   * (still declared statically) kept working.
   *
   * The shim clears those flags on the way past, so the server declares its
   * capabilities statically and Nova wires them up. It also takes the JVM down
   * with it when Nova closes the pipe, and optionally records the traffic.
   */
  private wrapWithShim(command: string, dataDir: string): string {
    const python = findPython();
    const shim = nova.path.join(nova.extension.path, "Scripts", "lsp-shim.py");

    if (!python || !nova.fs.access(shim, nova.fs.F_OK)) {
      console.error(
        "Could not find python3 or the LSP shim; launching the server " +
          "directly. Hover, completion and go-to-definition will not work, " +
          "because Nova ignores this server's dynamic capability registrations.",
      );
      return `exec ${command}`;
    }

    const tracing =
      getConfig<boolean>(config.logServerTrace) === true;
    if (tracing) console.log(`Logging LSP traffic to ${dataDir}/lsp-*.log`);
    const log = tracing ? ` --log ${shellQuote(dataDir)}` : "";

    // `exec` so the shim replaces the shell and is Nova's direct child: it can
    // then reap the JVM when Nova closes the pipe.
    return `exec ${shellQuote(python)} ${shellQuote(shim)}${log} -- ${command}`;
  }

  /** The `java.*` settings tree, shared by initialization and live updates. */
  private buildJavaSettings(): Record<string, unknown> {
    const javaHome = findJavaHome();
    const lintEnabled = (getConfig<boolean>(config.lintEnabled) ?? true) === true;

    const java: Record<string, unknown> = {
      configuration: { updateBuildConfiguration: "automatic" },
      format: {
        enabled: true,
        settings: this.formatterSettings(),
      },
      autobuild: { enabled: true },
      errors: {
        incompleteClasspath: { severity: lintEnabled ? "warning" : "ignore" },
      },
      completion: { enabled: true, guessMethodArguments: true },
      signatureHelp: { enabled: true },
      contentProvider: { preferred: "fernflower" },
      referencesCodeLens: { enabled: false },
      inlayHints: {
        parameterNames: {
          enabled: getConfig<string>(config.inlayParameterNames) ?? "none",
        },
      },
      project: this.projectSettings(),
    };
    if (javaHome) java.home = javaHome;

    return { java };
  }

  /**
   * Map the style preset onto an Eclipse formatter profile. JDT.LS has no
   * built-in notion of "Google style"; it loads a formatter XML from
   * `format.settings.url`, so a preset that is never translated into one
   * silently does nothing.
   */
  private formatterSettings(): Record<string, unknown> {
    const style = getConfig<string>(config.formatStyle) ?? "google";

    if (style === "custom") {
      const url = getConfig<string>(config.formatSettingsUrl);
      return url ? { url: expandPath(url) } : {};
    }
    // "eclipse" and anything unrecognised fall through to the server's own
    // default, which is the Eclipse built-in profile.
    const profile = FORMATTER_PROFILES[style];
    return profile ? { url: profile.url, profile: profile.profile } : {};
  }

  /** Per-workspace project layout overrides, omitted when unset. */
  private projectSettings(): Record<string, unknown> {
    const settings: Record<string, unknown> = {};

    const sourcePaths = getConfig<string[]>(config.sourcePaths);
    if (sourcePaths?.length) settings.sourcePaths = sourcePaths;

    const outputPath = getConfig<string>(config.outputPath);
    if (outputPath?.trim()) settings.outputPath = outputPath.trim();

    const libraries = getConfig<string[]>(config.referencedLibraries);
    if (libraries?.length) settings.referencedLibraries = libraries;

    return settings;
  }

  private buildClientOptions(projectRoot: string): {
    syntaxes: string[];
    debug: boolean;
    initializationOptions: Record<string, unknown>;
  } {
    return {
      syntaxes: ["java"],
      // Nova 10+: mirrors the LSP conversation into the Extension Console.
      // Off by default because it is noisy and costs throughput, but it is the
      // only way to see why a request came back empty.
      debug: getConfig<boolean>(config.logServerTrace) === true,
      initializationOptions: {
        workspaceFolders: [`file://${projectRoot}`],
        settings: this.buildJavaSettings(),
        extendedClientCapabilities: {
          classFileContentsSupport: true,
          overrideMethodsPromptSupport: false,
          advancedOrganizeImportsSupport: true,
          advancedGenerateAccessorsSupport: false,
        },
      },
    };
  }
}

/** A short, safe one-line rendering of an LSP payload for the console. */
function summarise(params: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(params) ?? String(params);
  } catch {
    return "(unserialisable)";
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Look a dotted `section` up in a settings tree, the way an LSP client is
 * expected to answer `workspace/configuration`.
 */
function resolveSection(
  settings: Record<string, unknown>,
  section: string | undefined,
): unknown {
  if (!section) return settings;
  let current: unknown = settings;
  for (const part of section.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}

function expandOptional(path: string | null): string | null {
  return path ? expandPath(path) : null;
}

/** Wrap an argument in single quotes for `sh -c`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
