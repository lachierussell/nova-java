/**
 * Configuration keys and typed accessors for the Java extension.
 *
 * Most settings can be set globally and overridden per-workspace. `get` reads
 * the workspace value first, then falls back to the global value.
 */

export const config = {
  lspFlavor: "java.lsp.flavor",
  lspPath: "java.lsp.path",
  jdkHome: "java.jdk.home",

  formatOnSave: "java.format.onSave",
  organizeImportsOnSave: "java.format.organizeImportsOnSave",
  formatStyle: "java.format.style",
  formatter: "java.format.formatter",

  lintEnabled: "java.lint.enabled",

  inlayParameterNames: "java.inlayHints.parameterNames",
  inlayVariableTypes: "java.inlayHints.variableTypes",

  // Workspace-specific project settings.
  projectRoot: "java.project.root",
  gradleWrapperPath: "java.gradle.wrapperPath",
  sourcePaths: "java.project.sourcePaths",
  outputPath: "java.project.outputPath",
  referencedLibraries: "java.project.referencedLibraries",
} as const;

/** Read a value, preferring the workspace override over the global setting. */
export function getConfig<T = unknown>(key: string): T | null {
  const workspace = nova.workspace?.config.get(key);
  if (workspace !== null && workspace !== undefined) {
    return workspace as T;
  }
  return (nova.config.get(key) as T) ?? null;
}

/**
 * Read a boolean setting whose workspace form is a three-way enum
 * ("Inherit from Global Settings" | "Enable" | "Disable", or null | true |
 * false), falling back to the global boolean.
 */
export function getOverridableBoolean(key: string): boolean {
  const workspace = nova.workspace?.config.get(key);
  if (workspace === true || workspace === "Enable") return true;
  if (workspace === false || workspace === "Disable") return false;
  return (nova.config.get(key, "boolean") as boolean | null) ?? false;
}
