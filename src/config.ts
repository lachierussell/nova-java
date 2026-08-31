export const config = {
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
  logServerTrace: "java.debug.logServerTrace",
  inlayParameterNames: "java.inlayHints.parameterNames",

  projectRoot: "java.project.root",
  gradleWrapperPath: "java.gradle.wrapperPath",
  sourcePaths: "java.project.sourcePaths",
  outputPath: "java.project.outputPath",
  referencedLibraries: "java.project.referencedLibraries",
} as const;

export function getConfig<T = unknown>(key: string): T | null {
  const workspace = nova.workspace?.config.get(key);
  if (workspace !== null && workspace !== undefined) return workspace as T;
  return (nova.config.get(key) as T) ?? null;
}

/**
 * For settings whose workspace form is a three-way enum — true, false, or null
 * for "Inherit from Global Settings" — so a workspace `false` beats a global
 * `true` and only null falls through.
 */
export function getOverridableBoolean(key: string): boolean {
  const workspace = nova.workspace?.config.get(key);
  if (typeof workspace === "boolean") return workspace;
  return (nova.config.get(key, "boolean") as boolean | null) ?? false;
}
