import { config, getConfig } from "./config";
import {
  MINIMUM_JAVA_MAJOR,
  findGradleWrapper,
  findJavaHome,
  findJdtls,
  findProjectRoot,
  javaMajorForHome,
} from "./paths";
import { buildJavaSettings, resolveSection } from "./javaSettings";
import { buildServerOptions } from "./launch";
import {
  delay,
  errorMessage,
  expandPath,
  hashString,
  mkdirRecursive,
} from "./novaUtils";
import { reapOrphanedServers } from "./reapServers";
import { notify } from "./notify";
import { setRevealClient } from "./reveal";
import { InformationView } from "./sidebar/informationView";

const FLAVOR_NONE = "none";
const FLAVOR_CUSTOM = "custom";

const HEALTHY_UPTIME_MS = 60_000;
const MAX_CRASH_RESTARTS = 4;

// The JVM outlives `client.stop()` and holds the Eclipse lock on its `-data`
// directory; whatever is left after this grace period is reaped.
const RESTART_SETTLE_MS = 1000;

export class JavaLanguageServer {
  private client: LanguageClient | null = null;
  private listeners: Disposable[] = [];
  private readonly info: InformationView;

  // A fresh identifier per launch: Nova refuses two clients sharing one, and a
  // client that failed to stop keeps its identifier reserved.
  private generation = 0;

  private startedAt = 0;
  private crashCount = 0;
  private crashTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private lastDataDir: string | null = null;

  // JDT.LS connects long before it can answer; it imports the project first.
  private ready = false;

  /** Serialises lifecycle transitions so two launches cannot interleave. */
  private queue: Promise<void> = Promise.resolve();

  onDidBecomeReady: (() => void) | null = null;

  constructor(info: InformationView) {
    this.info = info;
  }

  get languageClient(): LanguageClient | null {
    // A stopped client rejects every request, format-on-save included.
    if (this.client?.running === false) return null;
    return this.client;
  }

  get isReady(): boolean {
    return this.languageClient != null && this.ready;
  }

  private forgetClient(): LanguageClient | null {
    const client = this.client;
    this.client = null;
    this.ready = false;
    setRevealClient(null);
    return client;
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work, work);
    return this.queue;
  }

  start(): Promise<void> {
    return this.enqueue(() => this.startNow());
  }

  restart(): Promise<void> {
    return this.enqueue(async () => {
      this.crashCount = 0;
      const wasRunning = this.client != null;
      this.stopNow();
      if (wasRunning) await delay(RESTART_SETTLE_MS);
      await this.startNow();
    });
  }

  stop(): Promise<void> {
    return this.enqueue(async () => this.stopNow());
  }

  dispose(): void {
    this.disposed = true;
    this.stopNow();
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
    this.info.setDetails({ javaHome });

    const configuredPath = getConfig<string>(config.lspPath);
    const serverPath =
      flavor === FLAVOR_CUSTOM
        ? configuredPath && expandPath(configuredPath)
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
    this.info.setDetails({
      serverPath,
      projectRoot,
      gradleWrapper: findGradleWrapper() ?? "—",
    });
    this.info.setStatus("starting");

    const dataDir = this.dataDir(projectRoot);
    this.lastDataDir = dataDir;
    // We hold no client, so any JVM here is an orphan holding the lock the
    // next launch needs.
    await reapOrphanedServers(dataDir);

    const identifier = `java-lsp-${++this.generation}`;
    const serverOptions = buildServerOptions(
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

    try {
      const client = new LanguageClient(
        identifier,
        "Java Language Server",
        serverOptions,
        clientOptions,
      );
      this.attachListeners(client);
      client.start();
      this.client = client;
      this.ready = false;
      setRevealClient(client);
      this.startedAt = Date.now();
      this.info.setStatus("starting");
      console.log(`Java language server started (${identifier}).`);
    } catch (err) {
      this.detachListeners();
      this.info.setStatus("failed");
      notify.error("Could not start the Java language server", errorMessage(err));
    }
  }

  private attachListeners(client: LanguageClient): void {
    this.listeners.push(
      client.onDidStop((err) => {
        this.handleDidStop(client, err);
      }),
    );

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

    client.onNotification("language/status", (params: unknown) => {
      const status = params as { type?: string; message?: string };
      switch (status.type) {
        case "Starting":
          this.info.setStatus("starting", status.message);
          break;
        case "Started":
        case "ServiceReady":
          // JDT.LS sends both.
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
      }
    });

    client.onNotification("window/logMessage", (params: unknown) => {
      const log = params as { type?: number; message?: string };
      if (!log.message) return;
      if (log.type === 1) console.error(`[jdtls] ${log.message}`);
      else if (log.type === 2) console.warn(`[jdtls] ${log.message}`);
    });

    client.onRequest("workspace/configuration", (params: unknown) => {
      const items =
        (params as { items?: { section?: string }[] } | undefined)?.items ?? [];
      const settings = buildJavaSettings();
      return items.map((item) => resolveSection(settings, item.section));
    });
  }

  private detachListeners(): void {
    for (const listener of this.listeners) listener.dispose();
    this.listeners = [];
  }

  applySettings(): void {
    const client = this.languageClient;
    if (!client) return;
    try {
      client.sendNotification("workspace/didChangeConfiguration", {
        settings: buildJavaSettings(),
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
    // Detach first, or this looks like a crash and auto-restarts.
    this.detachListeners();

    const client = this.forgetClient();
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

  private handleDidStop(client: LanguageClient, err?: Error): void {
    // A stale client we already stopped and replaced; not a crash.
    if (this.client !== client || this.disposed) return;

    this.forgetClient();
    this.detachListeners();
    this.info.setStatus(err ? "failed" : "stopped");
    if (err) console.error("Java language server stopped:", String(err));

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

  // Hashed, not just named: two projects sharing a basename shared one JDT.LS
  // workspace, corrupting the index.
  private dataDir(projectRoot: string): string {
    const dir = nova.path.join(
      nova.extension.globalStoragePath,
      "workspaces",
      `${nova.path.basename(projectRoot)}-${hashString(projectRoot)}`,
    );
    mkdirRecursive(dir);
    return dir;
  }

  private buildClientOptions(projectRoot: string): {
    syntaxes: string[];
    debug: boolean;
    initializationOptions: Record<string, unknown>;
  } {
    return {
      syntaxes: ["java"],
      debug: getConfig<boolean>(config.logServerTrace) === true,
      initializationOptions: {
        workspaceFolders: [`file://${projectRoot}`],
        settings: buildJavaSettings(),
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

function summarise(params: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(params) ?? String(params);
  } catch {
    return "(unserialisable)";
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
