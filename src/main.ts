import { config, getConfig, getOverridableBoolean } from "./config";
import { wrapCommand } from "./novaUtils";
import { notify } from "./notify";
import { JavaLanguageServer } from "./lspClient";
import { InformationView } from "./sidebar/informationView";
import { ReferencesView } from "./sidebar/referencesView";
import { SymbolsView } from "./sidebar/symbolsView";
import { formatDocument } from "./format";
import * as lsp from "./commands/lspRequests";

let server: JavaLanguageServer | null = null;
let referencesView: ReferencesView | null = null;
let symbolsView: SymbolsView | null = null;
const disposables = new CompositeDisposable();

export function activate(): void {
  console.log("Java extension activating…");

  const infoView = new InformationView();
  disposables.add(infoView.treeView);

  referencesView = new ReferencesView();
  disposables.add(referencesView.treeView);

  symbolsView = new SymbolsView();
  disposables.add(symbolsView.treeView);

  server = new JavaLanguageServer(infoView);

  logResolvedConfig();
  registerCommands();
  registerSaveListeners();
  registerConfigReload();
  registerEventLogging();

  void server.start();
  console.log("Java extension activated.");
}

export function deactivate(): void {
  console.log("Java extension deactivating…");
  disposables.dispose();
  server?.dispose();
  server = null;
  referencesView = null;
  symbolsView = null;
}

/**
 * The live client, or null after telling the user why there isn't one.
 *
 * "Still importing" is a distinct state worth naming: JDT.LS accepts the
 * connection long before it can answer, so a command run too early comes back
 * empty and looks like a broken extension rather than a busy one.
 */
function requireClient(): LanguageClient | null {
  const client = server?.languageClient ?? null;
  if (!client) {
    notify.warn("The Java language server is not running.");
    return null;
  }
  if (server && !server.isReady) {
    notify.info(
      "The Java language server is still starting",
      "It is importing the project — try again in a moment.",
    );
    return null;
  }
  return client;
}

/** Run an editor command that needs a live client and the active editor. */
function editorCommand(
  fn: (client: LanguageClient, editor: TextEditor) => Promise<void>,
): (editor: TextEditor) => Promise<void> {
  return async (editor: TextEditor) => {
    const client = requireClient();
    if (!client) return;
    await fn(client, editor);
  };
}

function registerCommands(): void {
  const reg = (name: string, cb: (...args: never[]) => unknown) =>
    disposables.add(nova.commands.register(name, wrapCommand(cb as never)));

  reg("java.jumpToDefinition", editorCommand(lsp.goToDefinition));
  reg("java.jumpToTypeDefinition", editorCommand(lsp.goToTypeDefinition));
  reg("java.jumpToImplementation", editorCommand(lsp.goToImplementation));

  reg(
    "java.findReferences",
    editorCommand((client, editor) =>
      lsp.findReferences(client, editor, referencesView!),
    ),
  );
  reg("java.openLocation", () => referencesView?.openSelected());

  reg("java.findSymbols", async () => {
    const client = requireClient();
    if (!client) return;
    await lsp.findWorkspaceSymbol(client, symbolsView!);
  });
  reg("java.openSymbol", () => symbolsView?.openSelected());

  reg("java.formatFile", editorCommand(formatDocument));
  reg("java.formatSelection", editorCommand(lsp.formatSelection));
  reg("java.organizeImports", editorCommand(lsp.organizeImports));
  reg("java.renameSymbol", editorCommand(lsp.rename));
  reg("java.codeActions", editorCommand(lsp.codeActions));

  reg("java.restartServer", () => server?.restart());
  reg("java.preferences", () => nova.workspace.openConfig());
  reg("java.extensionPreferences", () => nova.openConfig());
}

// ---------------------------------------------------------------------------
// Save hooks: format / organize imports on save.
// ---------------------------------------------------------------------------

function registerSaveListeners(): void {
  disposables.add(
    nova.workspace.onDidAddTextEditor((editor) => {
      const willSave = editor.onWillSave(async (ed) => {
        if (ed.document.syntax !== "java") return;
        const client = server?.languageClient;
        if (!client) return;
        // A failure here must never abort the save: Nova waits on the promise
        // we return, and a rejection surfaces as "the file couldn't be saved".
        // Formatting is best-effort, so swallow errors and just log them.
        try {
          let organized = false;
          if (getOverridableBoolean(config.organizeImportsOnSave)) {
            await lsp.organizeImports(client, ed);
            organized = true;
          }
          if (getOverridableBoolean(config.formatOnSave)) {
            // Give Nova a moment to push the organize-imports change to the
            // server. Formatting is computed server-side against the document
            // it last saw, so asking too soon returns edits whose positions
            // describe the pre-organize text.
            if (organized) await settle();
            await formatDocument(client, ed);
          }
        } catch (err) {
          console.error("Java format-on-save failed:", String(err));
        }
      });
      disposables.add(willSave);
    }),
  );
}

/** Yield long enough for pending document changes to reach the server. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

// ---------------------------------------------------------------------------
// Restart the server when settings that change how it launches are edited.
// ---------------------------------------------------------------------------

/**
 * Log editor and document events to the Extension Console.
 *
 * The decisive fact is each document's `syntax`: Nova routes hover and
 * completion to a language client only for the syntaxes named in its
 * `clientOptions.syntaxes` — here, exactly `"java"`. A `.java` file reported as
 * anything else (or as null) means the editor never sends the request at all,
 * which from the outside is indistinguishable from a server that answered
 * nothing.
 *
 * Unconditional while we chase that: a preference-gated version of this
 * produced no output, and a diagnostic you have to switch on is a diagnostic
 * that doesn't run.
 */
function registerEventLogging(): void {
  const describe = (doc: TextDocument) =>
    `${doc.path ? nova.path.basename(doc.path) : "(untitled)"} ` +
    `syntax=${JSON.stringify(doc.syntax)}`;

  console.log(
    `[events] workspace path=${JSON.stringify(nova.workspace.path)} ` +
      `openEditors=${nova.workspace.textEditors.length}`,
  );

  disposables.add(
    nova.workspace.onDidAddTextEditor((editor) => {
      const doc = editor.document;
      console.log(
        `[events] editor opened: ${describe(doc)} ` +
          `isJava=${doc.syntax === "java"} uri=${doc.uri}`,
      );
      if (doc.path?.endsWith(".java") && doc.syntax !== "java") {
        console.error(
          `[events] MISMATCH: ${nova.path.basename(doc.path)} is a .java file ` +
            `but Nova reports syntax=${JSON.stringify(doc.syntax)}. The language ` +
            `client is bound to "java", so Nova will not send hover or ` +
            `completion for this editor.`,
        );
      }

      disposables.add(
        editor.onDidStopChanging((ed) =>
          console.log(`[events] stopped changing: ${describe(ed.document)}`),
        ),
      );
      disposables.add(
        editor.onDidSave((ed) =>
          console.log(`[events] saved: ${describe(ed.document)}`),
        ),
      );
      disposables.add(
        editor.onDidDestroy((ed) =>
          console.log(`[events] editor closed: ${describe(ed.document)}`),
        ),
      );
    }),
  );
}

/** Dump the settings the extension actually resolved, and where from. */
function logResolvedConfig(): void {
  for (const key of Object.values(config)) {
    const workspace = nova.workspace?.config.get(key) ?? null;
    const global = nova.config.get(key) ?? null;
    console.log(
      `[config] ${key} = ${JSON.stringify(getConfig(key))} ` +
        `(workspace=${JSON.stringify(workspace)}, global=${JSON.stringify(global)})`,
    );
  }
}

/**
 * Watch a setting and react only when its effective value actually changed.
 *
 * A key has to be observed both globally and per-workspace, and a single edit
 * fires on both — so an unguarded listener runs its callback twice. That is
 * cheap for most things and ruinous for a restart: each one costs JDT.LS a
 * full project re-import, during which the server answers nothing. Comparing
 * against the last value collapses the duplicates. (Pattern from nova-gobee.)
 */
function watchConfig(key: string, onChange: () => void): void {
  let previous = JSON.stringify(getConfig(key) ?? null);
  const handler = () => {
    const next = JSON.stringify(getConfig(key) ?? null);
    if (next === previous) return;
    previous = next;
    onChange();
  };
  disposables.add(nova.config.onDidChange(key, handler));
  if (nova.workspace) {
    disposables.add(nova.workspace.config.onDidChange(key, handler));
  }
}

function registerConfigReload(): void {
  // Changing these changes how the process is launched, so the server has to
  // come back up. Everything else is pushed to the running server instead.
  const relaunchKeys = [
    config.lspFlavor,
    config.lspPath,
    config.jdkHome,
    config.projectRoot,
    config.logServerTrace,
  ];

  // These are plain settings: JDT.LS applies them from a
  // workspace/didChangeConfiguration notification, no restart required.
  const liveKeys = [
    config.lintEnabled,
    config.inlayParameterNames,
    config.formatStyle,
    config.formatSettingsUrl,
    config.sourcePaths,
    config.outputPath,
    config.referencedLibraries,
  ];

  let pending: ReturnType<typeof setTimeout> | undefined;
  const scheduleRestart = () => {
    if (pending != null) clearTimeout(pending);
    // Debounce so editing several settings in a row restarts only once.
    pending = setTimeout(() => {
      pending = undefined;
      void server?.restart();
    }, 500);
  };

  for (const key of relaunchKeys) watchConfig(key, scheduleRestart);
  for (const key of liveKeys) watchConfig(key, () => server?.applySettings());
}
