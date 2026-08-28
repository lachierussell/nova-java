v 1.1.2
- Fixed format on save corrupting files by scattering spaces through the text
  (#1). Edit positions are now resolved against a single snapshot of the
  document, edits that overlap or fall outside it are rejected instead of
  applied, and formatting results are discarded if the document changed while
  the server was responding
- Format on save now waits for the organize-imports change to reach the server
  before requesting formatting
- Added a unit test suite (`npm test`)
- Fixed restarts failing with "already running" after the language server
  exited: each launch now uses a fresh client identifier and the previous
  client is always stopped
- The server is restarted automatically with a backoff when it exits
  unexpectedly, and pauses with a notification after repeated crashes
- Fixed projects with the same folder name sharing one JDT.LS data directory
- Added "Project Root" so the language server can be scoped to a subfolder
- Added "Gradle Wrapper Path" so Spotless can use a `gradlew` at the
  repository root while the server runs in a subfolder
- The Language Server sidebar now shows the project root and Gradle wrapper

v 1.1.0
- Rewrote the extension in TypeScript, bundled with Vite (TypeScript 7)
- Fixed Jump to Definition / Type Definition / Implementation, which previously
  did not navigate; now reveals the target (with a picker for multiple results)
- Added "Code Actions…" (⌥⏎) for quick fixes and refactorings
- Added "Format Selection" and "Organize imports on save"
- Added optional inlay parameter-name hints
- Added a "Language Server" sidebar showing status and the resolved JDK
- Replaced modal error dialogs with transient notifications
- Rewrote LSP ⇄ Nova position conversions (correct and much faster)
- Debounced server restarts when several settings change at once

v 1.0.2
- Fixed issues with LSP not always activating
- Published repository to github
- Updated readme

v 1.0
- Initial version