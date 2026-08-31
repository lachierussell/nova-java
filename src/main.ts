import { config, getConfig, getOverridableBoolean } from "./config";
import { debounce, delay, wrapCommand } from "./novaUtils";
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

// "Still importing" is named separately because a command run too early comes
// back empty, which reads as a broken extension rather than a busy one.
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

const EDITOR_COMMANDS: Record<
  string,
  (client: LanguageClient, editor: TextEditor) => Promise<void>
> = {
  "java.jumpToDefinition": lsp.goToDefinition,
  "java.jumpToTypeDefinition": lsp.goToTypeDefinition,
  "java.jumpToImplementation": lsp.goToImplementation,
  "java.findReferences": (client, editor) =>
    lsp.findReferences(client, editor, referencesView!),
  "java.formatFile": formatDocument,
  "java.formatSelection": lsp.formatSelection,
  "java.organizeImports": lsp.organizeImports,
  "java.renameSymbol": lsp.rename,
  "java.codeActions": lsp.codeActions,
};

const SIMPLE_COMMANDS: Record<string, () => unknown> = {
  "java.openLocation": () => referencesView?.openSelected(),
  "java.openSymbol": () => symbolsView?.openSelected(),
  "java.restartServer": () => server?.restart(),
  "java.preferences": () => nova.workspace.openConfig(),
  "java.extensionPreferences": () => nova.openConfig(),
};

function registerCommands(): void {
  const reg = (name: string, cb: (...args: never[]) => unknown) =>
    disposables.add(nova.commands.register(name, wrapCommand(cb as never)));

  for (const [name, run] of Object.entries(EDITOR_COMMANDS)) {
    reg(name, async (editor: TextEditor) => {
      const client = requireClient();
      if (client) await run(client, editor);
    });
  }
  for (const [name, run] of Object.entries(SIMPLE_COMMANDS)) reg(name, run);

  reg("java.findSymbols", async () => {
    const client = requireClient();
    if (client) await lsp.findWorkspaceSymbol(client);
  });
}

// Nova has no "active editor changed" event, so selection changes stand in for
// it: the editor being worked in is the one reporting them.
function registerEditorHooks(): void {
  const symbols = symbolsView!;
  disposables.add(
    symbols.treeView.onDidChangeVisibility(() => symbols.refresh()),
  );

  disposables.add(
    nova.workspace.onDidAddTextEditor((editor) => {
      warnAboutSyntax(editor.document);
      symbols.refresh();

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

// Nova sends hover and completion only for a client's declared syntaxes, so a
// .java file typed as anything else looks like a server answering nothing.
function warnAboutSyntax(doc: TextDocument): void {
  if (!doc.path?.endsWith(".java") || doc.syntax === "java") return;
  console.error(
    `${nova.path.basename(doc.path)} is a .java file but Nova reports ` +
      `syntax=${JSON.stringify(doc.syntax)}. The language client is bound to ` +
      `"java", so Nova will not send hover or completion for this editor.`,
  );
}

// Errors are swallowed: Nova waits on this promise and surfaces a rejection as
// "the file couldn't be saved".
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
      // Formatting is computed against the document the server last saw, so
      // asking before the organize-imports edit lands returns stale positions.
      if (organized) await delay(150);
      await formatDocument(client, editor);
    }
  } catch (err) {
    console.error("Java format-on-save failed:", String(err));
  }
}

// A key must be watched globally and per-workspace, and one edit fires both —
// so compare values to collapse the duplicate into a single restart.
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

const RELAUNCH_KEYS = [
  config.lspFlavor,
  config.lspPath,
  config.jdkHome,
  config.projectRoot,
  config.logServerTrace,
];

const HOT_RELOAD_KEYS = [
  config.lintEnabled,
  config.inlayParameterNames,
  config.formatStyle,
  config.formatSettingsUrl,
  config.sourcePaths,
  config.outputPath,
  config.referencedLibraries,
];

function registerConfigReload(): void {
  const scheduleRestart = debounce(500, () => void server?.restart());
  for (const key of RELAUNCH_KEYS) watchConfig(key, scheduleRestart);
  for (const key of HOT_RELOAD_KEYS) watchConfig(key, () => server?.applySettings());
}
