//
// Configuration keys for Java extension
//

const keys = {
  lspFlavor: "java.lsp.flavor",
  lspPath: "java.lsp.path",
  jdkHome: "java.jdk.home",

  formatOnSave: "java.format.onSave",
  formatStyle: "java.format.style",
  formatter: "java.format.formatter",

  lintEnabled: "java.lint.enabled",

  // workspace-specific
  sourcePaths: "java.project.sourcePaths",
  outputPath: "java.project.outputPath",
  referencedLibraries: "java.project.referencedLibraries",

  // context keys
  version: "java.version",
};

module.exports = keys;
