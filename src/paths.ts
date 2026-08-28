/**
 * Discovery of the JDK, the Eclipse JDT language server, and the project
 * layout (server root and Gradle wrapper) on disk.
 */
import { config, getConfig } from "./config";
import { expandPath, fileExists } from "./novaUtils";

/**
 * Locate a usable JAVA_HOME. Resolution order:
 *   1. Workspace / global `java.jdk.home` setting.
 *   2. jenv (best effort).
 *   3. The JAVA_HOME environment variable.
 *   4. The newest JDK under the standard macOS VM directories.
 */
export function findJavaHome(): string | null {
  const configured = getConfig<string>(config.jdkHome);
  if (configured && fileExists(configured)) return configured;

  const jenvHome = findJavaHomeViaJenv();
  if (jenvHome) return jenvHome;

  const envHome = nova.environment["JAVA_HOME"];
  if (envHome && fileExists(envHome)) return envHome;

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
    // Newest version first (naive but works for `jdk-XX.jdk` naming).
    for (const dir of contents.sort().reverse()) {
      const home = nova.path.join(base, dir, "Contents", "Home");
      if (fileExists(home)) return home;
    }
  }

  return null;
}

/**
 * Ask jenv for its configured java home. jenv's own commands are async; we run
 * them synchronously enough by reading stdout and blocking on exit is not
 * possible in Nova, so this is best-effort using a short-lived probe file that
 * jenv writes. In practice we shell out and read a cached value.
 */
function findJavaHomeViaJenv(): string | null {
  // `jenv javahome` prints an absolute path. We can't block on a Process in
  // Nova, so we read jenv's version file and resolve it against its versions
  // directory — this avoids the async round-trip entirely.
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

/** The platform-specific jdtls configuration directory. */
export function findJdtlsConfigPath(): string {
  const platform = detectJdtlsPlatform();
  const configPaths = [
    `/opt/homebrew/opt/jdtls/libexec/${platform}`,
    `/usr/local/opt/jdtls/libexec/${platform}`,
    `/opt/homebrew/share/jdtls/${platform}`,
    `/usr/local/share/jdtls/${platform}`,
    nova.path.join(nova.extension.path, "jdtls", platform),
  ];
  for (const path of configPaths) {
    if (fileExists(path)) return path;
  }
  console.warn("Could not find a jdtls config directory; using a best guess.");
  return `/opt/homebrew/opt/jdtls/libexec/${platform}`;
}

function detectJdtlsPlatform(): string {
  const home = nova.environment["HOME"] ?? "";
  const isMac = home.startsWith("/Users/");
  const hosttype = nova.environment["HOSTTYPE"] ?? "";
  const machtype = nova.environment["MACHTYPE"] ?? "";
  let isArm = /arm|aarch/.test(hosttype) || /arm|aarch/.test(machtype);
  // If the env vars are unset, infer from the Homebrew prefix.
  if (!isArm && isMac) isArm = fileExists("/opt/homebrew");

  if (isMac) return isArm ? "config_mac_arm" : "config_mac";
  return isArm ? "config_linux_arm" : "config_linux";
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
