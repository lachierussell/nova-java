import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Nova loads a single CommonJS-ish script from `Scripts/main.dist.js`. The Nova
// JS runtime (JavaScriptCore) does not support ES module `import`/`export`, so
// we bundle everything to a single CJS file with no external dependencies.
export default defineConfig({
  build: {
    target: "es2020",
    outDir: "java.novaextension/Scripts",
    // Keep the tree-sitter query/highlight files and other Scripts assets.
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
      name: "activate",
      formats: ["cjs"],
      fileName: () => "main.dist.js",
    },
    rollupOptions: {
      // `nova` and the CommonJS `module`/`exports` globals are provided by the
      // Nova runtime — never try to bundle them.
      external: ["nova"],
    },
  },
});
