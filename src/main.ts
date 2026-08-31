import { config, getConfig, getOverridableBoolean } from "./config";
import { delay, wrapCommand } from "./novaUtils";
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

  symbolsView = new SymbolsView(() =>
    server?.isReady ? (server.languageClient ?? null) : null,
  );
  disposables.add(symbolsView.treeView);

  server = new JavaLanguageServer(infoView);

  server.onDidBecomeReady = () => symbolsView?.refresh(true);

  registerCommands();
  registerEditorHooks();
  registerConfigReload();

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
    await lsp.findWorkspaceSymbol(client);
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
// Per-editor hooks: the Symbols sidebar follows the active editor, and saves
// can format / organize imports.
// ---------------------------------------------------------------------------

/**
 * Wire up everything that has to happen per open editor.
 *
 * The Symbols section keeps in step with what is on screen. Nova has no
 * "active editor changed" event, so selection changes stand in for it:
 * whichever editor the user is working in is the one reporting them. Those
 * refreshes are cheap — the view skips the request when the file it already
 * describes is still the active one — while edits and saves force a reload.
 */
function registerEditorHooks(): void {
  const symbols = symbolsView!;
  disposables.add(symbols.treeView.onDidChangeVisibility(() => symbols.refresh()));

  disposables.add(
    nova.workspace.onDidAddTextEditor((editor) => {
      warnAboutSyntax(editor.document);
      symbols.refresh();

      // Scoped to this editor so its listeners go away when it closes, rather
      // than accumulating for the lifetime of the extension.
      const perEditor = new CompositeDisposable();
      perEditor.add(editor.onDidChangeSelection(() => symbols.refresh()));
      perEditor.add(editor.onDidStopChanging(() => symbols.refresh(true)));
      perEditor.add(editor.onDidSave(() => symbols.refresh(true)));
      perEditor.add(editor.onWillSave((ed) => runSaveActions(ed)));
      perEditor.add(
        editor.onDidDestroy(() => {
          symbols.refresh(true);
          perEditor.dispose();
        }),
      );
      disposables.add(perEditor);
    }),
  );
}

/**
 * Nova routes hover and completion to a language client only for the syntaxes
 * named in its `clientOptions.syntaxes` — here, exactly `"java"`. A `.java`
 * file reported as anything else means the editor never sends the request at
 * all, which from the outside is indistinguishable from a server that answered
 * nothing. Worth saying so out loud.
 */
function warnAboutSyntax(doc: TextDocument): void {
  if (!doc.path?.endsWith(".java") || doc.syntax === "java") return;
  console.error(
    `${nova.path.basename(doc.path)} is a .java file but Nova reports ` +
      `syntax=${JSON.stringify(doc.syntax)}. The language client is bound to ` +
      `"java", so Nova will not send hover or completion for this editor.`,
  );
}

/**
 * Format and organize imports on save, if enabled.
 *
 * A failure here must never abort the save: Nova waits on the promise we
 * return, and a rejection surfaces as "the file couldn't be saved". Formatting
 * is best-effort, so errors are swallowed and logged.
 */
async function runSaveActions(editor: TextEditor): Promise<void> {
  if (editor.document.syntax !== "java") return;
  const client = server?.languageClient;
  if (!client) return;
  try {
    let organized = false;
    if (getOverridableBoolean(config.organizeImportsOnSave)) {
      await lsp.organizeImports(client, editor);
      organized = true;
    }
    if (getOverridableBoolean(config.formatOnSave)) {
      // Give Nova a moment to push the organize-imports change to the server.
      // Formatting is computed server-side against the document it last saw,
      // so asking too soon returns edits whose positions describe the
      // pre-organize text.
      if (organized) await delay(150);
      await formatDocument(client, editor);
    }
  } catch (err) {
    console.error("Java format-on-save failed:", String(err));
  }
}

// ---------------------------------------------------------------------------
// Restart the server when settings that change how it launches are edited.
// ---------------------------------------------------------------------------

/**
 * Watch a setting and react only when its effective value actually changed.
 *
 * A key has to be observed both globally and per-workspace, and a single edit
 * fires on both — so an unguarded listener runs its callback twice. That is
 * cheap for most things and ruinous for a restart: each one costs JDT.LS a
 * full project re-import, during which the server answers nothing. Comparing
 * against the last value collapses the duplicates.
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
