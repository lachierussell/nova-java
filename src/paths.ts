/**
 * Discovery of the JDK, the Eclipse JDT language server, and the project
 * layout (server root and Gradle wrapper) on disk.
 */
import { config, getConfig } from "./config";
import { expandPath, fileExists } from "./novaUtils";

/** Eclipse JDT.LS refuses to launch on anything older than this. */
export const MINIMUM_JAVA_MAJOR = 21;

/**
 * The major version in a Java version string or a JDK directory name.
 *
 * Handles the modern scheme ("21.0.1" → 21), the legacy one where the real
 * major version is the second component ("1.8.0_401" → 8), and vendor
 * directory names ("temurin-17.jdk" → 17). Returns null when there is no
 * version to find.
 */
export function parseJavaMajor(value: string): number | null {
  const trimmed = value.trim().replace(/\.jdk$/, "");
  const match = /(\d+)(?:\.(\d+))?/.exec(trimmed);
  if (!match) return null;
  const first = Number(match[1]);
  // "1.8.0_401" and friends: the leading 1 is the product line, not the
  // version, so the major version is the component after it.
  if (first === 1 && match[2] != null) return Number(match[2]);
  return first;
}

/**
 * Order JDK directory names newest-first, by version rather than lexically.
 *
 * A lexical sort puts "jdk-8.jdk" above "jdk-21.jdk", which handed the
 * language server a Java it refuses to run on — the process then died before
 * answering a single request. Names we cannot parse sink below real versions.
 */
export function sortJdkDirectoriesNewestFirst(
  names: readonly string[],
): string[] {
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

/**
 * Locate a usable JAVA_HOME. Resolution order:
 *   1. Workspace / global `java.jdk.home` setting.
 *   2. jenv (best effort).
 *   3. The JAVA_HOME environment variable.
 *   4. The newest JDK under the standard macOS VM directories.
 *
 * Every candidate but the explicitly configured one must satisfy
 * `MINIMUM_JAVA_MAJOR`; launching JDT.LS on an older JDK just kills the
 * server at startup, which looks to the user like a language server that
 * silently does nothing.
 */
export function findJavaHome(): string | null {
  const configured = getConfig<string>(config.jdkHome);
  // An explicit setting is honoured as-is: if the user pointed us at a JDK,
  // a version complaint is more useful than silently ignoring their choice.
  if (configured && fileExists(configured)) return configured;

  const jenvHome = findJavaHomeViaJenv();
  if (jenvHome && javaHomeIsUsable(jenvHome)) return jenvHome;

  const envHome = nova.environment["JAVA_HOME"];
  if (envHome && fileExists(envHome) && javaHomeIsUsable(envHome)) {
    return envHome;
  }

  const vmDirs = [
    "/Library/Java/JavaVirtualMachines",
    "/System/Library/Java/JavaVirtualMachines",
  ];
  for (const base of vmDirs) {
    let contents: string[];
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

/**
 * The Java version a JAVA_HOME points at, read from its path.
 *
 * The version lives in the JDK's own directory name, which is not the last
 * component: a macOS JAVA_HOME ends in `…/jdk-21.jdk/Contents/Home`. Walk the
 * path from the end and take the first component that carries a version, so
 * both that layout and a bare `…/versions/21.0.1` are read correctly. Null
 * when no component names a version — the server itself will then complain if
 * it turns out to be too old.
 */
export function javaMajorForHome(home: string): number | null {
  const parts = home.split("/").filter((p) => p.length > 0).reverse();
  for (const part of parts) {
    const major = parseJavaMajor(part);
    if (major != null) return major;
  }
  return null;
}

function javaHomeIsUsable(home: string): boolean {
  const major = javaMajorForHome(home);
  return major == null || major >= MINIMUM_JAVA_MAJOR;
}

/**
 * The JDK jenv would select, read from its files rather than its CLI.
 *
 * `jenv javahome` would answer directly, but Nova cannot run a process
 * synchronously and this resolution has to be. Reading the version file and
 * resolving it against `versions/` is what the CLI does anyway.
 */
function findJavaHomeViaJenv(): string | null {
  const jenvRoot = nova.environment["JENV_ROOT"] ??
    nova.path.join(nova.path.expanduser("~"), ".jenv");
  const versionFiles = [
    nova.path.join(findProjectRoot(), ".java-version"),
    nova.path.join(workspaceRoot(), ".java-version"),
    nova.path.join(jenvRoot, "version"),
  ];

  for (const versionFile of versionFiles) {
    if (!fileExists(versionFile)) continue;
    let version: string;
    try {
      const file = nova.fs.open(versionFile, "r") as FileTextMode;
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

/** The `java` executable inside the resolved JAVA_HOME, or `"java"` on $PATH. */
export function findJavaExecutable(): string {
  const home = findJavaHome();
  if (home) {
    const exec = nova.path.join(home, "bin", "java");
    if (nova.fs.access(exec, nova.fs.X_OK)) return exec;
  }
  return "java";
}

/**
 * A Python 3 interpreter for the LSP shim, or null if none is available.
 *
 * macOS ships one at /usr/bin/python3 with the Command Line Tools, and the
 * Homebrew `jdtls` launcher is itself a Python script, so on any machine that
 * can run the server this should resolve.
 */
export function findPython(): string | null {
  const candidates = [
    "/usr/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
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

/** Locate the `jdtls` launcher script or its equinox launcher JAR. */
export function findJdtls(): string | null {
  const commonPaths = [
    "/opt/homebrew/bin/jdtls",
    "/usr/local/bin/jdtls",
    "/usr/local/share/jdtls/plugins/org.eclipse.equinox.launcher_*.jar",
  ];

  for (const path of commonPaths) {
    if (path.includes("*")) {
      const match = resolveGlob(path);
      if (match) return match;
    } else if (fileExists(path)) {
      return path;
    }
  }

  // Fall back to $PATH.
  const pathEnv = nova.environment["PATH"] ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = nova.path.join(dir, "jdtls");
    if (nova.fs.access(candidate, nova.fs.X_OK)) return candidate;
  }

  return null;
}

/** Resolve a single-`*` glob against its parent directory. */
function resolveGlob(pattern: string): string | null {
  const dir = nova.path.dirname(pattern);
  const base = nova.path.basename(pattern);
  let files: string[];
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

/**
 * The Equinox configuration directory that goes with a launcher JAR.
 *
 * Only needed when we launch the raw `org.eclipse.equinox.launcher_*.jar`
 * ourselves. The `jdtls` wrapper script sets its own configuration area (and
 * marks it read-only, cascading into a per-workspace one), so passing
 * `-configuration` alongside it points Equinox at a directory it must write to
 * but cannot — which is how a server that "starts" ends up answering nothing.
 *
 * The JAR always lives in `<install>/plugins/`, so its install root is known
 * exactly; that beats guessing the platform from environment variables that
 * are shell-local and never set for a process Nova spawns.
 */
export function findJdtlsConfigPath(launcherJar: string): string | null {
  const installRoot = nova.path.dirname(nova.path.dirname(launcherJar));
  // Most specific first: an Apple-silicon build ships both, and the arm
  // directory is the one that matches the JVM we launch.
  const candidates = fileExists("/opt/homebrew")
    ? ["config_mac_arm", "config_mac", "config_linux_arm", "config_linux"]
    : ["config_mac", "config_mac_arm", "config_linux", "config_linux_arm"];

  for (const name of candidates) {
    const path = nova.path.join(installRoot, name);
    if (fileExists(path)) return path;
  }

  console.warn(
    `No Equinox configuration directory found under "${installRoot}"; ` +
      "launching without -configuration.",
  );
  return null;
}

// ---------------------------------------------------------------------------
// Project layout: where the language server should root itself, and where the
// Gradle wrapper lives. These are separate on purpose — a monorepo often wants
// the server scoped to one module while `gradlew` sits at the repository root.
// ---------------------------------------------------------------------------

/** The open workspace directory, or the home directory as a last resort. */
export function workspaceRoot(): string {
  return nova.workspace?.path ?? nova.path.expanduser("~");
}

/**
 * Resolve a configured path setting. Absolute paths and `~/…` are used as-is;
 * anything else is treated as relative to the workspace.
 */
function resolveAgainstWorkspace(value: string | null): string | null {
  if (!value || !value.trim()) return null;
  const expanded = expandPath(value.trim());
  if (expanded.startsWith("/")) return expanded;
  return nova.path.join(workspaceRoot(), expanded);
}

/**
 * The directory the language server treats as the project root. Defaults to
 * the workspace, but `java.project.root` can point at a subfolder so JDT.LS
 * indexes one module instead of an entire monorepo.
 */
export function findProjectRoot(): string {
  const configured = resolveAgainstWorkspace(getConfig<string>(config.projectRoot));
  if (configured) {
    if (isDirectory(configured)) return configured;
    console.warn(
      `java.project.root points at "${configured}", which is not a directory; using the workspace root.`,
    );
  }
  return workspaceRoot();
}

/**
 * Locate the Gradle wrapper. An explicit `java.gradle.wrapperPath` wins;
 * otherwise walk up from the project root so a module nested inside a
 * multi-project build still finds the wrapper at the repository root.
 */
export function findGradleWrapper(): string | null {
  const configured = resolveAgainstWorkspace(
    getConfig<string>(config.gradleWrapperPath),
  );
  if (configured) {
    // If the user pointed at the directory containing gradlew, accept that too.
    const candidate = isDirectory(configured)
      ? nova.path.join(configured, "gradlew")
      : configured;
    if (fileExists(candidate)) return candidate;
    console.warn(`java.gradle.wrapperPath points at "${candidate}", which does not exist.`);
    return null;
  }

  let dir = findProjectRoot();
  // Bounded walk: deep enough for any realistic module nesting, but it can
  // never run away past the filesystem root.
  for (let depth = 0; depth < 16; depth++) {
    const candidate = nova.path.join(dir, "gradlew");
    if (fileExists(candidate)) return candidate;
    const parent = nova.path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

function isDirectory(path: string): boolean {
  try {
    return nova.fs.stat(path)?.isDirectory() === true;
  } catch {
    return false;
  }
}
