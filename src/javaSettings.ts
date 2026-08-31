import { config, getConfig } from "./config";
import { findJavaHome } from "./paths";
import { expandPath } from "./novaUtils";

// JDT.LS has no notion of "Google style"; it only loads a formatter XML.
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

export function buildJavaSettings(): Record<string, unknown> {
  const javaHome = findJavaHome();
  const lintEnabled = (getConfig<boolean>(config.lintEnabled) ?? true) === true;

  const java: Record<string, unknown> = {
    configuration: { updateBuildConfiguration: "automatic" },
    format: { enabled: true, settings: formatterSettings() },
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
    project: projectSettings(),
  };
  if (javaHome) java.home = javaHome;

  return { java };
}

function formatterSettings(): Record<string, unknown> {
  const style = getConfig<string>(config.formatStyle) ?? "google";
  if (style === "custom") {
    const url = getConfig<string>(config.formatSettingsUrl);
    return url ? { url: expandPath(url) } : {};
  }
  const profile = FORMATTER_PROFILES[style];
  return profile ? { url: profile.url, profile: profile.profile } : {};
}

function projectSettings(): Record<string, unknown> {
  const settings: Record<string, unknown> = {};

  const sourcePaths = getConfig<string[]>(config.sourcePaths);
  if (sourcePaths?.length) settings.sourcePaths = sourcePaths;

  const outputPath = getConfig<string>(config.outputPath)?.trim();
  if (outputPath) settings.outputPath = outputPath;

  const libraries = getConfig<string[]>(config.referencedLibraries);
  if (libraries?.length) settings.referencedLibraries = libraries;

  return settings;
}

export function resolveSection(
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
