import { config, getOverridableBoolean } from "./config";
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

  registerCommands();
  registerSaveListeners();
  registerConfigReload();

  server.start();
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

/** Run an editor command that needs a live client and the active editor. */
function editorCommand(
  fn: (client: LanguageClient, editor: TextEditor) => Promise<void>,
): (editor: TextEditor) => Promise<void> {
  return async (editor: TextEditor) => {
    const client = server?.languageClient;
    if (!client) {
      notify.warn("The Java language server is not running.");
      return;
    }
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
    const client = server?.languageClient;
    if (!client) {
      notify.warn("The Java language server is not running.");
      return;
    }
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

function registerConfigReload(): void {
  const keys = [
    config.lspFlavor,
    config.lspPath,
    config.jdkHome,
    config.lintEnabled,
    config.inlayParameterNames,
    config.projectRoot,
  ];

  let pending: ReturnType<typeof setTimeout> | undefined;
  const scheduleRestart = () => {
    if (pending != null) clearTimeout(pending);
    // Debounce so editing several settings in a row restarts only once.
    pending = setTimeout(() => {
      pending = undefined;
      server?.restart();
    }, 500);
  };

  for (const key of keys) {
    disposables.add(nova.config.onDidChange(key, scheduleRestart));
    if (nova.workspace) {
      disposables.add(nova.workspace.config.onDidChange(key, scheduleRestart));
    }
  }
}
