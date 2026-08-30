"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const config = {
  lspFlavor: "java.lsp.flavor",
  lspPath: "java.lsp.path",
  jdkHome: "java.jdk.home",
  formatOnSave: "java.format.onSave",
  organizeImportsOnSave: "java.format.organizeImportsOnSave",
  formatStyle: "java.format.style",
  formatter: "java.format.formatter",
  spotlessOffline: "java.format.spotlessOffline",
  formatSettingsUrl: "java.format.settings.url",
  lintEnabled: "java.lint.enabled",
  /** Logs LSP traffic to the Extension Console (Nova 10+ `debug` option). */
  logServerTrace: "java.debug.logServerTrace",
  inlayParameterNames: "java.inlayHints.parameterNames",
  inlayVariableTypes: "java.inlayHints.variableTypes",
  // Workspace-specific project settings.
  projectRoot: "java.project.root",
  gradleWrapperPath: "java.gradle.wrapperPath",
  sourcePaths: "java.project.sourcePaths",
  outputPath: "java.project.outputPath",
  referencedLibraries: "java.project.referencedLibraries"
};
function getConfig(key) {
  const workspace = nova.workspace?.config.get(key);
  if (workspace !== null && workspace !== void 0) {
    return workspace;
  }
  return nova.config.get(key) ?? null;
}
function getOverridableBoolean(key) {
  const workspace = nova.workspace?.config.get(key);
  if (workspace === true || workspace === "Enable") return true;
  if (workspace === false || workspace === "Disable") return false;
  return nova.config.get(key, "boolean") ?? false;
}
function post(kind, message, detail) {
  const request = new NotificationRequest(`com.parkcedar.java.${kind}`);
  const prefix = kind === "error" ? "⚠︎ " : "";
  request.title = `${prefix}${message}`;
  if (detail) request.body = detail;
  nova.notifications.add(request).catch(() => {
    console.error(`[${kind}] ${message}${detail ? ` — ${detail}` : ""}`);
  });
}
const notify = {
  info: (message, detail) => post("info", message, detail),
  warn: (message, detail) => post("warn", message, detail),
  error: (message, detail) => post("error", message, detail)
};
function wrapCommand(command) {
  return function wrapped(...args) {
    Promise.resolve(command(...args)).catch((err) => {
      console.error("Java command failed:", String(err));
      notify.error(
        "Java command failed",
        err instanceof Error ? err.message : String(err)
      );
    });
  };
}
function fileExists(path) {
  return nova.fs.access(path, nova.fs.F_OK);
}
function expandPath(path) {
  if (path.startsWith("~/")) {
    return nova.path.join(nova.path.expanduser("~"), path.slice(2));
  }
  return path;
}
function promptInput(message, options = {}) {
  return new Promise((resolve) => {
    nova.workspace.showInputPanel(message, options, (value) => {
      resolve(value ?? null);
    });
  });
}
const MINIMUM_JAVA_MAJOR = 21;
function parseJavaMajor(value) {
  const trimmed = value.trim().replace(/\.jdk$/, "");
  const match = /(\d+)(?:\.(\d+))?/.exec(trimmed);
  if (!match) return null;
  const first = Number(match[1]);
  if (first === 1 && match[2] != null) return Number(match[2]);
  return first;
}
function sortJdkDirectoriesNewestFirst(names) {
  return [...names].sort((a, b) => {
    const va = parseJavaMajor(a);
    const vb = parseJavaMajor(b);
    if (va == null && vb == null) return a.localeCompare(b);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va !== vb) return vb - va;
    return a.localeCompare(b);
  });
}
function findJavaHome() {
  const configured = getConfig(config.jdkHome);
  if (configured && fileExists(configured)) return configured;
  const jenvHome = findJavaHomeViaJenv();
  if (jenvHome && javaHomeIsUsable(jenvHome)) return jenvHome;
  const envHome = nova.environment["JAVA_HOME"];
  if (envHome && fileExists(envHome) && javaHomeIsUsable(envHome)) {
    return envHome;
  }
  const vmDirs = [
    "/Library/Java/JavaVirtualMachines",
    "/System/Library/Java/JavaVirtualMachines"
  ];
  for (const base of vmDirs) {
    let contents;
    try {
      contents = nova.fs.listdir(base);
    } catch {
      continue;
    }
    for (const dir of sortJdkDirectoriesNewestFirst(contents)) {
      const major = parseJavaMajor(dir);
      if (major != null && major < MINIMUM_JAVA_MAJOR) continue;
      const home = nova.path.join(base, dir, "Contents", "Home");
      if (fileExists(home)) return home;
    }
  }
  return null;
}
function javaHomeIsUsable(home) {
  const major = parseJavaMajor(nova.path.basename(home));
  return major == null || major >= MINIMUM_JAVA_MAJOR;
}
function findJavaHomeViaJenv() {
  const jenvRoot = nova.environment["JENV_ROOT"] ?? nova.path.join(nova.path.expanduser("~"), ".jenv");
  const versionFiles = [
    nova.path.join(findProjectRoot(), ".java-version"),
    nova.path.join(workspaceRoot(), ".java-version"),
    nova.path.join(jenvRoot, "version")
  ];
  for (const versionFile of versionFiles) {
    if (!fileExists(versionFile)) continue;
    let version;
    try {
      const file = nova.fs.open(versionFile, "r");
      version = (file.read() ?? "").trim();
      file.close();
    } catch {
      continue;
    }
    if (!version) continue;
    const home = nova.path.join(jenvRoot, "versions", version);
    if (fileExists(home)) return home;
  }
  return null;
}
function findJavaExecutable() {
  const home = findJavaHome();
  if (home) {
    const exec = nova.path.join(home, "bin", "java");
    if (nova.fs.access(exec, nova.fs.X_OK)) return exec;
  }
  return "java";
}
function findPython() {
  const candidates = [
    "/usr/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3"
  ];
  for (const path of candidates) {
    if (nova.fs.access(path, nova.fs.X_OK)) return path;
  }
  const pathEnv = nova.environment["PATH"] ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = nova.path.join(dir, "python3");
    if (nova.fs.access(candidate, nova.fs.X_OK)) return candidate;
  }
  return null;
}
function findJdtls() {
  const commonPaths = [
    "/opt/homebrew/bin/jdtls",
    "/usr/local/bin/jdtls",
    "/usr/local/share/jdtls/plugins/org.eclipse.equinox.launcher_*.jar"
  ];
  for (const path of commonPaths) {
    if (path.includes("*")) {
      const match = resolveGlob(path);
      if (match) return match;
    } else if (fileExists(path)) {
      return path;
    }
  }
  const pathEnv = nova.environment["PATH"] ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = nova.path.join(dir, "jdtls");
    if (nova.fs.access(candidate, nova.fs.X_OK)) return candidate;
  }
  return null;
}
function resolveGlob(pattern) {
  const dir = nova.path.dirname(pattern);
  const base = nova.path.basename(pattern);
  let files;
  try {
    files = nova.fs.listdir(dir);
  } catch {
    return null;
  }
  const regex = new RegExp(`^${base.replace(/\*/g, ".*")}$`);
  for (const file of files) {
    if (regex.test(file)) return nova.path.join(dir, file);
  }
  return null;
}
function findJdtlsConfigPath(launcherJar) {
  const installRoot = nova.path.dirname(nova.path.dirname(launcherJar));
  const candidates = fileExists("/opt/homebrew") ? ["config_mac_arm", "config_mac", "config_linux_arm", "config_linux"] : ["config_mac", "config_mac_arm", "config_linux", "config_linux_arm"];
  for (const name of candidates) {
    const path = nova.path.join(installRoot, name);
    if (fileExists(path)) return path;
  }
  console.warn(
    `No Equinox configuration directory found under "${installRoot}"; launching without -configuration.`
  );
  return null;
}
function workspaceRoot() {
  return nova.workspace?.path ?? nova.path.expanduser("~");
}
function resolveAgainstWorkspace(value) {
  if (!value || !value.trim()) return null;
  const expanded = expandPath(value.trim());
  if (expanded.startsWith("/")) return expanded;
  return nova.path.join(workspaceRoot(), expanded);
}
function findProjectRoot() {
  const configured = resolveAgainstWorkspace(getConfig(config.projectRoot));
  if (configured) {
    if (isDirectory(configured)) return configured;
    console.warn(
      `java.project.root points at "${configured}", which is not a directory; using the workspace root.`
    );
  }
  return workspaceRoot();
}
function findGradleWrapper() {
  const configured = resolveAgainstWorkspace(
    getConfig(config.gradleWrapperPath)
  );
  if (configured) {
    const candidate = isDirectory(configured) ? nova.path.join(configured, "gradlew") : configured;
    if (fileExists(candidate)) return candidate;
    console.warn(`java.gradle.wrapperPath points at "${candidate}", which does not exist.`);
    return null;
  }
  let dir = findProjectRoot();
  for (let depth = 0; depth < 16; depth++) {
    const candidate = nova.path.join(dir, "gradlew");
    if (fileExists(candidate)) return candidate;
    const parent = nova.path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}
function isDirectory(path) {
  try {
    return nova.fs.stat(path)?.isDirectory() === true;
  } catch {
    return false;
  }
}
function lineStartOffsets(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}
function offsetToLspPosition(text, offset) {
  const starts = lineStartOffsets(text);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}
function lspPositionToOffset(text, pos) {
  return positionToOffset(text, lineStartOffsets(text), pos);
}
function positionToOffset(text, starts, pos) {
  if (pos.line >= starts.length) {
    return text.length + 1;
  }
  const lineStart = starts[Math.max(0, pos.line)] ?? 0;
  const lineEnd = pos.line + 1 < starts.length ? starts[pos.line + 1] - newlineWidth(text, starts[pos.line + 1]) : text.length;
  return Math.min(lineStart + Math.max(0, pos.character), lineEnd);
}
function newlineWidth(text, nextLineStart) {
  return text[nextLineStart - 2] === "\r" ? 2 : 1;
}
function lspRangeToOffsets(text, range) {
  const starts = lineStartOffsets(text);
  return {
    start: positionToOffset(text, starts, range.start),
    end: positionToOffset(text, starts, range.end)
  };
}
function documentText(document) {
  return document.getTextInRange(new Range(0, document.length));
}
function uriToPath(uri) {
  let p = uri;
  if (p.startsWith("file://")) p = p.slice("file://".length);
  return decodeURIComponent(p);
}
let client = null;
function setRevealClient(next) {
  client = next;
}
async function revealLocation(loc) {
  const path = await resolvePath(loc.uri);
  if (!path) return;
  const editor = await nova.workspace.openFile(path);
  if (!editor) return;
  const text = documentText(editor.document);
  const start = lspPositionToOffset(text, loc.range.start);
  const end = lspPositionToOffset(text, loc.range.end);
  editor.selectedRange = new Range(start, end);
  editor.scrollToPosition(start);
}
async function resolvePath(uri) {
  if (uri.startsWith("file:")) return uriToPath(uri);
  if (!uri.startsWith("jdt:")) {
    notify.info("Cannot open that location", uri);
    return null;
  }
  if (!client) {
    notify.info("Cannot open library sources", "The language server is not running.");
    return null;
  }
  let contents;
  try {
    contents = await client.sendRequest("java/classFileContents", {
      uri
    });
  } catch (err) {
    console.error("java/classFileContents failed:", String(err));
    contents = null;
  }
  if (!contents) {
    notify.info(
      "No sources available",
      "The language server could not decompile that class."
    );
    return null;
  }
  return writeClassFile(uri, contents);
}
function writeClassFile(uri, contents) {
  const dir = nova.path.join(nova.extension.globalStoragePath, "classfiles");
  try {
    if (!nova.fs.access(dir, nova.fs.F_OK)) nova.fs.mkdir(dir);
  } catch {
  }
  const path = nova.path.join(dir, `${classFileName(uri)}.java`);
  try {
    const file = nova.fs.open(path, "w");
    file.write(contents);
    file.close();
  } catch (err) {
    console.error(`Could not write decompiled source to "${path}":`, String(err));
    return null;
  }
  return path;
}
function classFileName(uri) {
  const decoded = decodeURIComponent(uri);
  const match = /([A-Za-z_$][A-Za-z0-9_$]*)\.class/.exec(decoded);
  const simpleName = match ? match[1] : "ClassFile";
  return `${simpleName}-${hash(uri)}`;
}
function hash(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = (h << 5) + h + value.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}
const FLAVOR_NONE = "none";
const FLAVOR_CUSTOM = "custom";
const HEALTHY_UPTIME_MS = 6e4;
const MAX_CRASH_RESTARTS = 4;
const RESTART_SETTLE_MS = 1e3;
const FORMATTER_PROFILES = {
  google: {
    url: "https://raw.githubusercontent.com/google/styleguide/gh-pages/eclipse-java-google-style.xml",
    profile: "GoogleStyle"
  },
  aosp: {
    url: "https://raw.githubusercontent.com/aosp-mirror/platform_development/master/ide/eclipse/android-formatting.xml",
    profile: "Android"
  }
};
class JavaLanguageServer {
  constructor(info) {
    this.client = null;
    this.listeners = [];
    this.generation = 0;
    this.stoppingIntentionally = false;
    this.startedAt = 0;
    this.crashCount = 0;
    this.disposed = false;
    this.lastDataDir = null;
    this.ready = false;
    this.queue = Promise.resolve();
    this.info = info;
  }
  get languageClient() {
    if (this.client && this.client.running === false) return null;
    return this.client;
  }
  /** Has the server finished importing and started answering requests? */
  get isReady() {
    return this.languageClient != null && this.ready;
  }
  /** Queue a lifecycle transition behind whatever is already in flight. */
  enqueue(work) {
    this.queue = this.queue.then(work, work);
    return this.queue;
  }
  start() {
    return this.enqueue(() => this.startNow());
  }
  /** Tear down and relaunch the server, resetting any crash backoff. */
  restart() {
    return this.enqueue(async () => {
      this.crashCount = 0;
      const wasRunning = this.client != null;
      this.stopNow();
      if (wasRunning) await delay(RESTART_SETTLE_MS);
      await this.startNow();
    });
  }
  stop() {
    return this.enqueue(async () => this.stopNow());
  }
  /** Stop for good; no further automatic restarts. */
  dispose() {
    this.disposed = true;
    this.stopNow();
    if (this.lastDataDir) void reapOrphanedServers(this.lastDataDir);
  }
  async startNow() {
    this.stopNow();
    if (this.disposed) return;
    const flavor = getConfig(config.lspFlavor) ?? "auto";
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
        `JDT.LS needs Java ${MINIMUM_JAVA_MAJOR} or newer. Set “Java JDK Home” in the extension preferences.`
      );
      return;
    }
    this.warnIfJavaTooOld(javaHome);
    this.info.setJavaHome(javaHome);
    const serverPath = flavor === FLAVOR_CUSTOM ? optionalExpand(getConfig(config.lspPath)) : findJdtls();
    if (!serverPath) {
      this.info.setStatus("failed");
      notify.error(
        "Language server (jdtls) not found",
        "Install Eclipse JDT.LS (e.g. `brew install jdtls`) or set a custom path."
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
    await reapOrphanedServers(dataDir);
    const identifier = `java-lsp-${++this.generation}`;
    const serverOptions = this.buildServerOptions(
      serverPath,
      javaHome,
      projectRoot,
      dataDir
    );
    const clientOptions = this.buildClientOptions(javaHome, projectRoot);
    console.log(
      `[lsp] launching ${serverOptions.path} ${JSON.stringify(serverOptions.args)}`
    );
    console.log(
      `[lsp] bound to syntaxes=${JSON.stringify(clientOptions.syntaxes)} debug=${clientOptions.debug}`
    );
    let client2;
    try {
      client2 = new LanguageClient(
        identifier,
        "Java Language Server",
        serverOptions,
        clientOptions
      );
    } catch (err) {
      this.info.setStatus("failed");
      notify.error(
        "Could not create the Java language server",
        err instanceof Error ? err.message : String(err)
      );
      return;
    }
    this.attachListeners(client2);
    try {
      client2.start();
      this.client = client2;
      this.ready = false;
      setRevealClient(client2);
      this.startedAt = Date.now();
      this.info.setStatus("starting");
      console.log(`Java language server started (${identifier}).`);
    } catch (err) {
      this.detachListeners();
      this.info.setStatus("failed");
      notify.error(
        "Could not start the Java language server",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  /**
   * Wire up the server-to-client traffic JDT.LS relies on. Nova surfaces none
   * of this on its own, so without it the extension is blind to import
   * progress and to the errors that explain a server which answers nothing.
   */
  attachListeners(client2) {
    this.listeners.push(
      client2.onDidStop((err) => {
        this.handleDidStop(client2, err);
      })
    );
    for (const method of [
      "textDocument/publishDiagnostics",
      "window/showMessage",
      "telemetry/event",
      "$/progress"
    ]) {
      client2.onNotification(method, (params) => {
        console.log(`[lsp<-] ${method} ${summarise(params)}`);
      });
    }
    client2.onNotification("language/status", (params) => {
      const status = params;
      switch (status.type) {
        case "Starting":
          this.info.setStatus("starting", status.message);
          break;
        case "Started":
        case "ServiceReady":
          if (!this.ready) console.log("Java language server is ready.");
          this.ready = true;
          this.info.setStatus("running", status.message);
          break;
        case "Error":
          this.info.setStatus("failed", status.message);
          console.error(`Java language server error: ${status.message ?? ""}`);
          break;
      }
    });
    client2.onNotification("window/logMessage", (params) => {
      const log = params;
      if (!log.message) return;
      if (log.type === 1) console.error(`[jdtls] ${log.message}`);
      else if (log.type === 2) console.warn(`[jdtls] ${log.message}`);
    });
    client2.onRequest("workspace/configuration", (params) => {
      const items = params?.items ?? [];
      const settings = this.buildJavaSettings();
      return items.map((item) => resolveSection(settings, item.section));
    });
  }
  detachListeners() {
    for (const listener of this.listeners) listener.dispose();
    this.listeners = [];
  }
  /**
   * Push the current settings to a running server. Most preferences take
   * effect this way, so a restart — which costs a full project re-import — is
   * only warranted for the ones that change how the process is launched.
   */
  applySettings() {
    const client2 = this.languageClient;
    if (!client2) return;
    try {
      client2.sendNotification("workspace/didChangeConfiguration", {
        settings: this.buildJavaSettings()
      });
    } catch (err) {
      console.error("Could not push Java settings to the server:", String(err));
    }
  }
  stopNow() {
    if (this.crashTimer != null) {
      clearTimeout(this.crashTimer);
      this.crashTimer = void 0;
    }
    this.detachListeners();
    const client2 = this.client;
    this.client = null;
    this.ready = false;
    setRevealClient(null);
    if (client2) {
      this.stoppingIntentionally = true;
      try {
        client2.stop();
      } catch (err) {
        console.error("Error stopping the Java language server:", String(err));
      } finally {
        this.stoppingIntentionally = false;
      }
    }
    this.info.setStatus("stopped");
  }
  warnIfJavaTooOld(javaHome) {
    const major = parseJavaMajor(nova.path.basename(javaHome));
    if (major != null && major < MINIMUM_JAVA_MAJOR) {
      notify.warn(
        `Java ${major} is too old for the language server`,
        `Eclipse JDT.LS needs Java ${MINIMUM_JAVA_MAJOR} or newer. Set “Java JDK Home” to a newer JDK.`
      );
    }
  }
  /**
   * The server exited on its own. Restart it with a growing backoff so a
   * transient crash recovers silently, but a genuinely broken configuration
   * doesn't spin forever.
   */
  handleDidStop(client2, err) {
    if (this.client !== client2) return;
    if (this.stoppingIntentionally || this.disposed) return;
    this.client = null;
    this.ready = false;
    setRevealClient(null);
    this.detachListeners();
    this.info.setStatus(err ? "failed" : "stopped");
    if (err) console.error("Java language server stopped:", String(err));
    if (Date.now() - this.startedAt > HEALTHY_UPTIME_MS) this.crashCount = 0;
    if (this.crashCount >= MAX_CRASH_RESTARTS) {
      notify.error(
        "The Java language server keeps crashing",
        "Automatic restarts have been paused. Check the Extension Console, then use “Restart Language Server”."
      );
      return;
    }
    const backoff = 1e3 * 2 ** this.crashCount;
    this.crashCount++;
    console.log(
      `Java language server exited unexpectedly; restarting in ${backoff}ms (attempt ${this.crashCount}/${MAX_CRASH_RESTARTS}).`
    );
    this.crashTimer = setTimeout(() => {
      this.crashTimer = void 0;
      void this.start();
    }, backoff);
  }
  /**
   * A writable data directory, unique per project root. Keying on the folder
   * name alone made two projects with the same basename share one JDT.LS
   * workspace, which corrupts the index and locks the server.
   */
  dataDir(projectRoot) {
    const dir = nova.path.join(
      nova.extension.globalStoragePath,
      "workspaces",
      `${nova.path.basename(projectRoot)}-${hashPath(projectRoot)}`
    );
    mkdirRecursive(dir);
    return dir;
  }
  buildServerOptions(serverPath, javaHome, projectRoot, dataDir) {
    const isScript = serverPath.endsWith("jdtls") || !serverPath.endsWith(".jar");
    let argv;
    if (isScript) {
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
        ...configPath ? ["-configuration", configPath] : [],
        "-data",
        dataDir
      ];
    }
    const command = argv.map(shellQuote).join(" ");
    return {
      type: "stdio",
      path: "/bin/sh",
      args: [
        "-c",
        `cd ${shellQuote(projectRoot)} && ${this.wrapWithShim(command, dataDir)}`
      ],
      env: { JAVA_HOME: javaHome }
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
  wrapWithShim(command, dataDir) {
    const python = findPython();
    const shim = nova.path.join(nova.extension.path, "Scripts", "lsp-shim.py");
    if (!python || !nova.fs.access(shim, nova.fs.F_OK)) {
      console.error(
        "Could not find python3 or the LSP shim; launching the server directly. Hover, completion and go-to-definition will not work, because Nova ignores this server's dynamic capability registrations."
      );
      return `exec ${command}`;
    }
    const tracing = getConfig(config.logServerTrace) === true;
    if (tracing) console.log(`Logging LSP traffic to ${dataDir}/lsp-*.log`);
    const log = tracing ? ` --log ${shellQuote(dataDir)}` : "";
    return `exec ${shellQuote(python)} ${shellQuote(shim)}${log} -- ${command}`;
  }
  /** The `java.*` settings tree, shared by initialization and live updates. */
  buildJavaSettings() {
    const javaHome = findJavaHome();
    const lintEnabled = (getConfig(config.lintEnabled) ?? true) === true;
    const java = {
      configuration: { updateBuildConfiguration: "automatic" },
      format: {
        enabled: true,
        settings: this.formatterSettings()
      },
      autobuild: { enabled: true },
      errors: {
        incompleteClasspath: { severity: lintEnabled ? "warning" : "ignore" }
      },
      completion: { enabled: true, guessMethodArguments: true },
      signatureHelp: { enabled: true },
      contentProvider: { preferred: "fernflower" },
      referencesCodeLens: { enabled: false },
      inlayHints: {
        parameterNames: {
          enabled: getConfig(config.inlayParameterNames) ?? "none"
        }
      },
      project: this.projectSettings()
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
  formatterSettings() {
    const style = getConfig(config.formatStyle) ?? "google";
    if (style === "custom") {
      const url = getConfig(config.formatSettingsUrl);
      return url ? { url: expandPath(url) } : {};
    }
    if (style === "palantir") {
      console.warn(
        "Palantir formatting is only available with the Spotless formatter; the language server will use its default style."
      );
      return {};
    }
    const profile = FORMATTER_PROFILES[style];
    return profile ? { url: profile.url, profile: profile.profile } : {};
  }
  /** Per-workspace project layout overrides, omitted when unset. */
  projectSettings() {
    const settings = {};
    const sourcePaths = getConfig(config.sourcePaths);
    if (sourcePaths?.length) settings.sourcePaths = sourcePaths;
    const outputPath = getConfig(config.outputPath);
    if (outputPath?.trim()) settings.outputPath = outputPath.trim();
    const libraries = getConfig(config.referencedLibraries);
    if (libraries?.length) settings.referencedLibraries = libraries;
    return settings;
  }
  buildClientOptions(_javaHome, projectRoot) {
    return {
      syntaxes: ["java"],
      // Nova 10+: mirrors the LSP conversation into the Extension Console.
      // Off by default because it is noisy and costs throughput, but it is the
      // only way to see why a request came back empty.
      debug: getConfig(config.logServerTrace) === true,
      initializationOptions: {
        workspaceFolders: [`file://${projectRoot}`],
        settings: this.buildJavaSettings(),
        extendedClientCapabilities: {
          classFileContentsSupport: true,
          overrideMethodsPromptSupport: false,
          advancedOrganizeImportsSupport: true,
          advancedGenerateAccessorsSupport: false
        }
      }
    };
  }
}
function summarise(params) {
  let text;
  try {
    text = JSON.stringify(params) ?? String(params);
  } catch {
    return "(unserialisable)";
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const JDTLS_MARKER = "org.eclipse.jdt.ls.core.id1";
async function reapOrphanedServers(dataDir) {
  let pids = await findServerPids(dataDir);
  if (pids.length === 0) return;
  console.warn(
    `Found ${pids.length} orphaned Java language server process(es) holding "${dataDir}": ${pids.join(", ")}. Terminating before restart.`
  );
  await signal("TERM", pids);
  for (let attempt = 0; attempt < 12; attempt++) {
    await delay(250);
    pids = await findServerPids(dataDir);
    if (pids.length === 0) return;
  }
  console.warn(`Orphans ${pids.join(", ")} ignored SIGTERM; sending SIGKILL.`);
  await signal("KILL", pids);
  await delay(250);
  const survivors = await findServerPids(dataDir);
  if (survivors.length > 0) {
    console.error(
      `Could not terminate Java language server process(es): ${survivors.join(", ")}.`
    );
  }
}
async function findServerPids(dataDir) {
  const output = await runCommand("/bin/ps", ["-Ao", "pid=,command="]);
  const pids = [];
  for (const line of output.split("\n")) {
    if (!line.includes(JDTLS_MARKER)) continue;
    if (!line.includes(`-data ${dataDir}`)) continue;
    const pid = line.trim().split(/\s+/)[0];
    if (/^\d+$/.test(pid)) pids.push(pid);
  }
  return pids;
}
async function signal(name, pids) {
  if (pids.length === 0) return;
  try {
    await runCommand("/bin/kill", [`-${name}`, ...pids]);
  } catch (err) {
    console.log(`kill -${name} ${pids.join(" ")}: ${String(err)}`);
  }
}
function runCommand(path, args) {
  return new Promise((resolve, reject) => {
    let out = "";
    try {
      const process = new Process(path, {
        args,
        stdio: ["ignore", "pipe", "ignore"]
      });
      process.onStdout((line) => {
        out += line;
      });
      process.onDidExit(() => resolve(out));
      process.start();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
function resolveSection(settings, section) {
  if (!section) return settings;
  let current = settings;
  for (const part of section.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = current[part];
  }
  return current ?? null;
}
function mkdirRecursive(path) {
  const parts = path.split("/").filter((p) => p.length > 0);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    if (nova.fs.access(current, nova.fs.F_OK)) continue;
    try {
      nova.fs.mkdir(current);
    } catch (err) {
      console.error(`Could not create "${current}":`, String(err));
      return;
    }
  }
}
function optionalExpand(path) {
  return path ? expandPath(path) : null;
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function hashPath(path) {
  let hash2 = 5381;
  for (let i = 0; i < path.length; i++) {
    hash2 = (hash2 << 5) + hash2 + path.charCodeAt(i) | 0;
  }
  return (hash2 >>> 0).toString(36);
}
class InformationView {
  constructor() {
    this.status = "stopped";
    this.statusDetail = "";
    this.serverPath = "—";
    this.javaHome = "—";
    this.projectRoot = "—";
    this.gradleWrapper = "—";
    this.tree = new TreeView("java.sidebar.info", { dataProvider: this });
  }
  get treeView() {
    return this.tree;
  }
  setStatus(status, detail) {
    this.status = status;
    this.statusDetail = detail?.trim() ?? "";
    this.reload();
  }
  setServerPath(path) {
    this.serverPath = path;
    this.reload();
  }
  setJavaHome(home) {
    this.javaHome = home;
    this.reload();
  }
  setProjectRoot(path) {
    this.projectRoot = path;
    this.reload();
  }
  setGradleWrapper(path) {
    this.gradleWrapper = path;
    this.reload();
  }
  reload() {
    this.tree.reload();
  }
  rows() {
    const label = {
      stopped: "Stopped",
      starting: "Starting…",
      running: "Running",
      failed: "Failed"
    };
    const status = this.statusDetail ? `${label[this.status]} — ${this.statusDetail}` : label[this.status];
    return [
      { id: "status", label: "Status", value: status },
      { id: "jdk", label: "JDK", value: this.javaHome },
      { id: "server", label: "Language server", value: this.serverPath },
      { id: "root", label: "Project root", value: this.projectRoot },
      { id: "gradlew", label: "Gradle wrapper", value: this.gradleWrapper }
    ];
  }
  getChildren(element) {
    if (element == null) return this.rows().map((r) => r.id);
    return [];
  }
  getTreeItem(element) {
    const row = this.rows().find((r) => r.id === element);
    const item = new TreeItem(
      row?.label ?? element,
      TreeItemCollapsibleState.None
    );
    item.descriptiveText = row?.value ?? "";
    item.tooltip = row?.value ?? "";
    item.identifier = element;
    return item;
  }
}
class ReferencesView {
  constructor() {
    this.locations = [];
    this.tree = new TreeView("java.sidebar.references", { dataProvider: this });
  }
  get treeView() {
    return this.tree;
  }
  show(locations) {
    this.locations = locations;
    this.tree.reload();
    this.tree.reveal(locations[0], { focus: false, reveal: 3 });
  }
  /** Reveal the currently selected reference (invoked on activation). */
  async openSelected() {
    const [selected] = this.tree.selection;
    if (selected) await revealLocation(selected);
  }
  getChildren(element) {
    return element ? [] : this.locations;
  }
  getTreeItem(element) {
    const path = decodeURIComponent(element.uri.replace(/^file:\/\//, ""));
    const item = new TreeItem(
      nova.path.basename(path),
      TreeItemCollapsibleState.None
    );
    item.descriptiveText = `Line ${element.range.start.line + 1}`;
    item.tooltip = path;
    item.command = "java.openLocation";
    item.image = "__symbol.reference";
    return item;
  }
}
const SYMBOL_IMAGES = {
  5: "__symbol.class",
  6: "__symbol.method",
  7: "__symbol.property",
  8: "__symbol.field",
  9: "__symbol.constructor",
  10: "__symbol.enum",
  11: "__symbol.interface",
  12: "__symbol.function",
  13: "__symbol.variable",
  14: "__symbol.constant",
  22: "__symbol.enum-member"
};
class SymbolsView {
  constructor() {
    this.symbols = [];
    this.tree = new TreeView("java.sidebar.symbols", { dataProvider: this });
  }
  get treeView() {
    return this.tree;
  }
  show(symbols) {
    this.symbols = symbols;
    this.tree.reload();
    this.tree.reveal(symbols[0], { focus: false, reveal: 3 });
  }
  async openSelected() {
    const [selected] = this.tree.selection;
    if (selected) await revealLocation(selected.location);
  }
  getChildren(element) {
    return element ? [] : this.symbols;
  }
  getTreeItem(element) {
    const item = new TreeItem(element.name, TreeItemCollapsibleState.None);
    item.descriptiveText = element.containerName ?? "";
    item.command = "java.openSymbol";
    const image = SYMBOL_IMAGES[element.kind];
    if (image) item.image = image;
    return item;
  }
}
function planTextEdits(text, edits) {
  const planned = [];
  for (const edit of edits) {
    const { start, end } = lspRangeToOffsets(text, edit.range);
    if (start < 0 || end > text.length || start > end) return null;
    planned.push({ start, end, newText: edit.newText });
  }
  planned.sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < planned.length; i++) {
    if (planned[i].end > planned[i - 1].start) return null;
  }
  return planned;
}
async function applyTextEdits(editor, edits) {
  if (edits.length === 0) return true;
  const text = documentText(editor.document);
  const plan = planTextEdits(text, edits);
  if (!plan) {
    console.error(
      `Refusing to apply ${edits.length} text edit(s): they overlap or fall outside the document. The language server is likely working from a stale copy of the file.`
    );
    return false;
  }
  await editor.edit((edit) => {
    for (const e of plan) {
      edit.replace(new Range(e.start, e.end), e.newText);
    }
  });
  return true;
}
function groupWorkspaceEdit(edit) {
  const perUri = /* @__PURE__ */ new Map();
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if (!change.textDocument || !change.edits) continue;
      const existing = perUri.get(change.textDocument.uri);
      if (existing) existing.push(...change.edits);
      else perUri.set(change.textDocument.uri, [...change.edits]);
    }
  } else if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      perUri.set(uri, [...edits]);
    }
  }
  return perUri;
}
async function applyWorkspaceEdit(edit) {
  for (const [uri, edits] of groupWorkspaceEdit(edit)) {
    const editor = await nova.workspace.openFile(uri);
    if (!editor) continue;
    await applyTextEdits(editor, edits);
  }
}
function positionParams(editor) {
  const doc = editor.document;
  const text = documentText(doc);
  return {
    textDocument: { uri: doc.uri },
    position: offsetToLspPosition(text, editor.selectedRange.start)
  };
}
function asLocationArray(result) {
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  return list.map((r) => {
    if (r && typeof r === "object" && "targetUri" in r) {
      const link = r;
      return {
        uri: link.targetUri,
        range: link.targetSelectionRange ?? link.targetRange
      };
    }
    return r;
  });
}
async function goToLocation(client2, editor, method, label) {
  const result = await client2.sendRequest(method, positionParams(editor));
  const locations = asLocationArray(result);
  if (locations.length === 0) {
    notify.info(`No ${label.toLowerCase()} found.`);
    return;
  }
  if (locations.length === 1) {
    await revealLocation(locations[0]);
    return;
  }
  await pickLocation(locations, label);
}
function goToDefinition(client2, editor) {
  return goToLocation(client2, editor, "textDocument/definition", "Definition");
}
function goToTypeDefinition(client2, editor) {
  return goToLocation(
    client2,
    editor,
    "textDocument/typeDefinition",
    "Type Definition"
  );
}
function goToImplementation(client2, editor) {
  return goToLocation(
    client2,
    editor,
    "textDocument/implementation",
    "Implementation"
  );
}
async function pickLocation(locations, placeholder) {
  const labels = locations.map((loc) => {
    const path = decodeURIComponent(loc.uri.replace(/^file:\/\//, ""));
    return `${nova.path.basename(path)}:${loc.range.start.line + 1}`;
  });
  return new Promise((resolve) => {
    nova.workspace.showChoicePalette(labels, { placeholder }, (_sel, index) => {
      if (index != null && index >= 0) {
        void revealLocation(locations[index]).then(resolve);
      } else {
        resolve();
      }
    });
  });
}
async function findReferences(client2, editor, view) {
  const params = {
    ...positionParams(editor),
    context: { includeDeclaration: true }
  };
  const result = await client2.sendRequest(
    "textDocument/references",
    params
  );
  const locations = result ?? [];
  if (locations.length === 0) {
    notify.info("No references found.");
    return;
  }
  view.show(locations);
}
async function rename(client2, editor) {
  const newName = await promptInput("Rename symbol to:", {
    label: "Rename Symbol"
  });
  if (newName == null || newName.length === 0) return;
  const params = { ...positionParams(editor), newName };
  const edit = await client2.sendRequest(
    "textDocument/rename",
    params
  );
  if (!edit) {
    notify.info("Symbol cannot be renamed here.");
    return;
  }
  await applyWorkspaceEdit(edit);
}
function formattingOptions(editor) {
  return { tabSize: editor.tabLength, insertSpaces: editor.softTabs };
}
async function formatDocumentLsp(client2, editor) {
  const before = documentText(editor.document);
  const edits = await client2.sendRequest("textDocument/formatting", {
    textDocument: { uri: editor.document.uri },
    options: formattingOptions(editor)
  });
  if (!edits || edits.length === 0) return;
  if (!documentUnchanged(editor, before, "formatting")) return;
  await applyTextEdits(editor, edits);
}
function documentUnchanged(editor, before, what) {
  if (documentText(editor.document) === before) return true;
  console.warn(
    `Discarding ${what} edits: the document changed while the language server was responding.`
  );
  return false;
}
async function formatSelection(client2, editor) {
  const selection = editor.selectedRange;
  if (selection.length === 0) {
    await formatDocumentLsp(client2, editor);
    return;
  }
  const text = documentText(editor.document);
  const edits = await client2.sendRequest("textDocument/rangeFormatting", {
    textDocument: { uri: editor.document.uri },
    range: {
      start: offsetToLspPosition(text, selection.start),
      end: offsetToLspPosition(text, selection.end)
    },
    options: formattingOptions(editor)
  });
  if (!edits || edits.length === 0) return;
  if (!documentUnchanged(editor, text, "range formatting")) return;
  await applyTextEdits(editor, edits);
}
const ORGANIZE_KIND = "source.organizeImports";
async function organizeImports(client2, editor) {
  const actions = await client2.sendRequest("textDocument/codeAction", {
    textDocument: { uri: editor.document.uri },
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 }
    },
    context: { diagnostics: [], only: [ORGANIZE_KIND] }
  });
  const action = (actions ?? []).find(
    (a) => a.kind?.startsWith(ORGANIZE_KIND) ?? false
  );
  if (!action) {
    notify.info("Nothing to organize.");
    return;
  }
  await runCodeAction(client2, action);
}
async function codeActions(client2, editor) {
  const text = documentText(editor.document);
  const start = offsetToLspPosition(text, editor.selectedRange.start);
  const end = offsetToLspPosition(text, editor.selectedRange.end);
  const actions = await client2.sendRequest("textDocument/codeAction", {
    textDocument: { uri: editor.document.uri },
    range: { start, end },
    context: { diagnostics: [] }
  });
  const list = (actions ?? []).filter((a) => a.title);
  if (list.length === 0) {
    notify.info("No code actions available here.");
    return;
  }
  await new Promise((resolve) => {
    nova.workspace.showChoicePalette(
      list.map((a) => a.title),
      { placeholder: "Java Code Actions" },
      (_sel, index) => {
        if (index != null && index >= 0) {
          void runCodeAction(client2, list[index]).then(resolve);
        } else {
          resolve();
        }
      }
    );
  });
}
async function runCodeAction(client2, action) {
  if (action.edit) await applyWorkspaceEdit(action.edit);
  if (action.command) {
    await client2.sendRequest("workspace/executeCommand", {
      command: action.command.command,
      arguments: action.command.arguments
    });
  }
}
async function findWorkspaceSymbol(client2, view) {
  const query = await promptInput("Enter symbol name:", {
    label: "Find Symbol"
  });
  if (query == null) return;
  const result = await client2.sendRequest("workspace/symbol", {
    query
  });
  const symbols = result ?? [];
  if (symbols.length === 0) {
    notify.info("No symbols found.");
    return;
  }
  view.show(symbols);
}
async function formatDocument(client2, editor) {
  const formatter = getConfig(config.formatter) ?? "lsp";
  if (formatter === "spotless") {
    await formatWithSpotless(editor);
  } else {
    await formatDocumentLsp(client2, editor);
  }
}
function spotlessArgs(gradlew, gradleRoot, projectRoot, offline) {
  const args = ["bash", gradlew];
  if (projectRoot !== gradleRoot) args.push("-p", projectRoot);
  if (offline) args.push("--offline");
  args.push("spotlessApply");
  return args;
}
function formatWithSpotless(editor) {
  if (!nova.workspace.path) {
    notify.error("Cannot run Spotless", "No workspace is open.");
    return Promise.reject(new Error("No workspace path"));
  }
  const gradlew = findGradleWrapper();
  if (!gradlew) {
    notify.error(
      "Cannot run Spotless",
      "No Gradle wrapper (gradlew) found. Set “Gradle Wrapper Path” in the workspace settings."
    );
    return Promise.reject(new Error("gradlew not found"));
  }
  const gradleRoot = nova.path.dirname(gradlew);
  const projectRoot = findProjectRoot();
  const documentPath = editor.document.path;
  if (!documentPath) {
    return Promise.resolve();
  }
  const relative = nova.path.relative(gradleRoot, documentPath);
  console.log(`Formatting ${relative} with Spotless…`);
  const args = spotlessArgs(
    gradlew,
    gradleRoot,
    projectRoot,
    getConfig(config.spotlessOffline) === true
  );
  return new Promise((resolve, reject) => {
    const process = new Process("/usr/bin/env", {
      args,
      cwd: gradleRoot
    });
    let errorOutput = "";
    process.onStderr((line) => {
      errorOutput += line;
    });
    process.onDidExit((status) => {
      if (status === 0) {
        resolve();
      } else {
        notify.error("Spotless failed", errorOutput.trim().split("\n").pop());
        reject(new Error(`Spotless exited with status ${status}`));
      }
    });
    try {
      process.start();
    } catch (err) {
      reject(err);
    }
  });
}
let server = null;
let referencesView = null;
let symbolsView = null;
const disposables = new CompositeDisposable();
function activate() {
  console.log("Java extension activating…");
  const infoView = new InformationView();
  disposables.add(infoView.treeView);
  referencesView = new ReferencesView();
  disposables.add(referencesView.treeView);
  symbolsView = new SymbolsView();
  disposables.add(symbolsView.treeView);
  server = new JavaLanguageServer(infoView);
  logResolvedConfig();
  registerCommands();
  registerSaveListeners();
  registerConfigReload();
  registerEventLogging();
  void server.start();
  console.log("Java extension activated.");
}
function deactivate() {
  console.log("Java extension deactivating…");
  disposables.dispose();
  server?.dispose();
  server = null;
  referencesView = null;
  symbolsView = null;
}
function requireClient() {
  const client2 = server?.languageClient ?? null;
  if (!client2) {
    notify.warn("The Java language server is not running.");
    return null;
  }
  if (server && !server.isReady) {
    notify.info(
      "The Java language server is still starting",
      "It is importing the project — try again in a moment."
    );
    return null;
  }
  return client2;
}
function editorCommand(fn) {
  return async (editor) => {
    const client2 = requireClient();
    if (!client2) return;
    await fn(client2, editor);
  };
}
function registerCommands() {
  const reg = (name, cb) => disposables.add(nova.commands.register(name, wrapCommand(cb)));
  reg("java.jumpToDefinition", editorCommand(goToDefinition));
  reg("java.jumpToTypeDefinition", editorCommand(goToTypeDefinition));
  reg("java.jumpToImplementation", editorCommand(goToImplementation));
  reg(
    "java.findReferences",
    editorCommand(
      (client2, editor) => findReferences(client2, editor, referencesView)
    )
  );
  reg("java.openLocation", () => referencesView?.openSelected());
  reg("java.findSymbols", async () => {
    const client2 = requireClient();
    if (!client2) return;
    await findWorkspaceSymbol(client2, symbolsView);
  });
  reg("java.openSymbol", () => symbolsView?.openSelected());
  reg("java.formatFile", editorCommand(formatDocument));
  reg("java.formatSelection", editorCommand(formatSelection));
  reg("java.organizeImports", editorCommand(organizeImports));
  reg("java.renameSymbol", editorCommand(rename));
  reg("java.codeActions", editorCommand(codeActions));
  reg("java.restartServer", () => server?.restart());
  reg("java.preferences", () => nova.workspace.openConfig());
  reg("java.extensionPreferences", () => nova.openConfig());
}
function registerSaveListeners() {
  disposables.add(
    nova.workspace.onDidAddTextEditor((editor) => {
      const willSave = editor.onWillSave(async (ed) => {
        if (ed.document.syntax !== "java") return;
        const client2 = server?.languageClient;
        if (!client2) return;
        try {
          let organized = false;
          if (getOverridableBoolean(config.organizeImportsOnSave)) {
            await organizeImports(client2, ed);
            organized = true;
          }
          if (getOverridableBoolean(config.formatOnSave)) {
            if (organized) await settle();
            await formatDocument(client2, ed);
          }
        } catch (err) {
          console.error("Java format-on-save failed:", String(err));
        }
      });
      disposables.add(willSave);
    })
  );
}
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 150));
}
function registerEventLogging() {
  const describe = (doc) => `${doc.path ? nova.path.basename(doc.path) : "(untitled)"} syntax=${JSON.stringify(doc.syntax)}`;
  console.log(
    `[events] workspace path=${JSON.stringify(nova.workspace.path)} openEditors=${nova.workspace.textEditors.length}`
  );
  disposables.add(
    nova.workspace.onDidAddTextEditor((editor) => {
      const doc = editor.document;
      console.log(
        `[events] editor opened: ${describe(doc)} isJava=${doc.syntax === "java"} uri=${doc.uri}`
      );
      if (doc.path?.endsWith(".java") && doc.syntax !== "java") {
        console.error(
          `[events] MISMATCH: ${nova.path.basename(doc.path)} is a .java file but Nova reports syntax=${JSON.stringify(doc.syntax)}. The language client is bound to "java", so Nova will not send hover or completion for this editor.`
        );
      }
      disposables.add(
        editor.onDidStopChanging(
          (ed) => console.log(`[events] stopped changing: ${describe(ed.document)}`)
        )
      );
      disposables.add(
        editor.onDidSave(
          (ed) => console.log(`[events] saved: ${describe(ed.document)}`)
        )
      );
      disposables.add(
        editor.onDidDestroy(
          (ed) => console.log(`[events] editor closed: ${describe(ed.document)}`)
        )
      );
    })
  );
}
function logResolvedConfig() {
  for (const key of Object.values(config)) {
    const workspace = nova.workspace?.config.get(key) ?? null;
    const global = nova.config.get(key) ?? null;
    console.log(
      `[config] ${key} = ${JSON.stringify(getConfig(key))} (workspace=${JSON.stringify(workspace)}, global=${JSON.stringify(global)})`
    );
  }
}
function watchConfig(key, onChange) {
  let previous = JSON.stringify(getConfig(key) ?? null);
  const handler = () => {
    const next = JSON.stringify(getConfig(key) ?? null);
    if (next === previous) return;
    previous = next;
    onChange();
  };
  disposables.add(nova.config.onDidChange(key, handler));
  if (nova.workspace) {
    disposables.add(nova.workspace.config.onDidChange(key, handler));
  }
}
function registerConfigReload() {
  const relaunchKeys = [
    config.lspFlavor,
    config.lspPath,
    config.jdkHome,
    config.projectRoot,
    config.logServerTrace
  ];
  const liveKeys = [
    config.lintEnabled,
    config.inlayParameterNames,
    config.formatStyle,
    config.formatSettingsUrl,
    config.sourcePaths,
    config.outputPath,
    config.referencedLibraries
  ];
  let pending;
  const scheduleRestart = () => {
    if (pending != null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = void 0;
      void server?.restart();
    }, 500);
  };
  for (const key of relaunchKeys) watchConfig(key, scheduleRestart);
  for (const key of liveKeys) watchConfig(key, () => server?.applySettings());
}
exports.activate = activate;
exports.deactivate = deactivate;
