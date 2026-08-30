v 1.1.4
- Fixed hover, completion, go-to-definition, signature help, document
  highlight and code actions never firing. Nova advertises
  `dynamicRegistration: true` for those features, so JDT.LS left them out of
  its `initialize` response and announced them later with
  `client/registerCapability`; Nova acknowledges those registrations but does
  not act on them, so it never sent the requests. The server is now launched
  behind a small stdio shim that clears those flags, which makes JDT.LS
  declare its capabilities statically. References, formatting and rename were
  unaffected all along because JDT.LS always declared those statically
- The shim also terminates the language server when Nova closes the pipe, so
  a dead client can no longer strand a JVM holding the workspace lock
- Orphaned language server processes are now killed before a new one starts.
  `client.stop()` only asks the server to shut down over LSP, which a wedged or
  mid-import JDT.LS ignores; the JVM then outlived its client, kept the Eclipse
  workspace lock, and every later restart came up unable to take it. Only a
  process matching both the JDT.LS marker and this project's exact data
  directory is signalled, so no other project's server is ever touched
- Fixed the language server being launched with a `-configuration` directory
  that conflicts with the one the `jdtls` launcher sets for itself. The server
  connected but could not answer requests, so hover, completion and
  go-to-definition did nothing
- Fixed JDKs being ranked lexically, which picked Java 8 over Java 21 and
  handed the server a JDK it refuses to run on
- The sidebar now reports real readiness. JDT.LS accepts a connection long
  before it can answer, so it shows the server's own import progress and
  commands say "still starting" instead of returning nothing
- Language server errors (a failed project import, for example) are now written
  to the Extension Console instead of being discarded
- A restart now waits for the previous JVM to release its workspace lock, and
  lifecycle changes are serialised so two launches cannot interleave
- Settings changes that don't affect how the server is launched are pushed to
  the running server instead of forcing a full project re-import, and a single
  edit no longer triggers two restarts
- "Formatting style" now actually reaches the server; it previously had no
  effect at all. Likewise "Source Paths", "Output Path" and
  "Referenced Libraries"
- Fixed Rename Symbol dropping most of a rename when the server split one
  file's edits across several entries
- "Jump To Definition" now opens decompiled sources for types inside JARs
  (the JDK's own classes and dependencies) instead of doing nothing
- Added "Log language server traffic" to record the LSP conversation in the
  Extension Console
- Added "Run Spotless offline" so a networkless Gradle fails instead of stalling

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