import { config, getConfig } from "./config";
import { expandPath, fileExists } from "./novaUtils";

/** Eclipse JDT.LS refuses to launch on anything older. */
export const MINIMUM_JAVA_MAJOR = 21;

/** "21.0.1" → 21, "1.8.0_401" → 8, "temurin-17.jdk" → 17. */
export function parseJavaMajor(value: string): number | null {
  const match = /(\d+)(?:\.(\d+))?/.exec(value.trim().replace(/\.jdk$/, ""));
  if (!match) return null;
  const first = Number(match[1]);
  if (first === 1 && match[2] != null) return Number(match[2]);
  return first;
}

// By version, not lexically: a lexical sort puts "jdk-8.jdk" above "jdk-21.jdk".
export function sortJdkDirectoriesNewestFirst(
  names: readonly string[],
): string[] {
  return [...names].sort((a, b) => {
    const va = parseJavaMajor(a);
    const vb = parseJavaMajor(b);
    if (va == null && vb == null) return a.localeCompare(b);
    if (va == null) return 1;
    if (vb == null) return -1;
    return va === vb ? a.localeCompare(b) : vb - va;
  });
}

const MACOS_VM_DIRS = [
  "/Library/Java/JavaVirtualMachines",
  "/System/Library/Java/JavaVirtualMachines",
];

export function findJavaHome(): string | null {
  // Honoured as-is: a version complaint beats ignoring the user's choice.
  const configured = getConfig<string>(config.jdkHome);
  if (configured && fileExists(configured)) return configured;

  const jenvHome = findJavaHomeViaJenv();
  if (jenvHome && javaHomeIsUsable(jenvHome)) return jenvHome;

  const envHome = nova.environment["JAVA_HOME"];
  if (envHome && fileExists(envHome) && javaHomeIsUsable(envHome)) return envHome;

  for (const base of MACOS_VM_DIRS) {
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

// The version is not the last component: `…/jdk-21.jdk/Contents/Home`.
export function javaMajorForHome(home: string): number | null {
  const parts = home.split("/").filter((p) => p.length > 0);
  for (const part of parts.reverse()) {
    const major = parseJavaMajor(part);
    if (major != null) return major;
  }
  return null;
}

function javaHomeIsUsable(home: string): boolean {
  const major = javaMajorForHome(home);
  return major == null || major >= MINIMUM_JAVA_MAJOR;
}

// Read from jenv's files, not `jenv javahome`: Nova cannot run a process
// synchronously and this resolution has to be.
function findJavaHomeViaJenv(): string | null {
  const jenvRoot =
    nova.environment["JENV_ROOT"] ??
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

export function findJavaExecutable(): string {
  const home = findJavaHome();
  if (home) {
    const exec = nova.path.join(home, "bin", "java");
    if (nova.fs.access(exec, nova.fs.X_OK)) return exec;
  }
  return "java";
}

function findOnPath(name: string): string | null {
  for (const dir of (nova.environment["PATH"] ?? "").split(":")) {
    if (!dir) continue;
    const candidate = nova.path.join(dir, name);
    if (nova.fs.access(candidate, nova.fs.X_OK)) return candidate;
  }
  return null;
}

function firstExisting(
  candidates: readonly string[],
  mode: number = nova.fs.F_OK,
): string | null {
  for (const path of candidates) {
    const found = path.includes("*") ? resolveGlob(path) : path;
    if (found && nova.fs.access(found, mode)) return found;
  }
  return null;
}

export function findPython(): string | null {
  return (
    firstExisting(
      ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"],
      nova.fs.X_OK,
    ) ?? findOnPath("python3")
  );
}

export function findJdtls(): string | null {
  return (
    firstExisting([
      "/opt/homebrew/bin/jdtls",
      "/usr/local/bin/jdtls",
      "/usr/local/share/jdtls/plugins/org.eclipse.equinox.launcher_*.jar",
    ]) ?? findOnPath("jdtls")
  );
}

function resolveGlob(pattern: string): string | null {
  const dir = nova.path.dirname(pattern);
  const regex = new RegExp(
    `^${nova.path.basename(pattern).replace(/\*/g, ".*")}$`,
  );
  let files: string[];
  try {
    files = nova.fs.listdir(dir);
  } catch {
    return null;
  }
  const match = files.find((file) => regex.test(file));
  return match ? nova.path.join(dir, match) : null;
}

/** Only for the raw Equinox JAR, which always lives in `<install>/plugins/`. */
export function findJdtlsConfigPath(launcherJar: string): string | null {
  const installRoot = nova.path.dirname(nova.path.dirname(launcherJar));
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

export function workspaceRoot(): string {
  return nova.workspace?.path ?? nova.path.expanduser("~");
}

function resolveAgainstWorkspace(value: string | null): string | null {
  if (!value?.trim()) return null;
  const expanded = expandPath(value.trim());
  return expanded.startsWith("/")
    ? expanded
    : nova.path.join(workspaceRoot(), expanded);
}

export function findProjectRoot(): string {
  const configured = resolveAgainstWorkspace(
    getConfig<string>(config.projectRoot),
  );
  if (configured) {
    if (isDirectory(configured)) return configured;
    console.warn(
      `java.project.root points at "${configured}", which is not a directory; using the workspace root.`,
    );
  }
  return workspaceRoot();
}

export function findGradleWrapper(): string | null {
  const configured = resolveAgainstWorkspace(
    getConfig<string>(config.gradleWrapperPath),
  );
  if (configured) {
    const candidate = isDirectory(configured)
      ? nova.path.join(configured, "gradlew")
      : configured;
    if (fileExists(candidate)) return candidate;
    console.warn(
      `java.gradle.wrapperPath points at "${candidate}", which does not exist.`,
    );
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

function isDirectory(path: string): boolean {
  try {
    return nova.fs.stat(path)?.isDirectory() === true;
  } catch {
    return false;
  }
}
