import {
  LspLocation,
  LspRange,
  LspTextEdit,
  documentText,
  offsetToLspPosition,
  uriToPath,
} from "../lspNovaConversions";
import {
  applyTextEdits,
  applyWorkspaceEdit,
  WorkspaceEdit,
} from "../applyEdits";
import { revealLocation } from "../reveal";
import { notify } from "../notify";
import { promptInput } from "../novaUtils";
import { ReferencesView } from "../sidebar/referencesView";

/** Build the `{ textDocument, position }` params for the editor's cursor. */
function positionParams(editor: TextEditor): {
  textDocument: { uri: string };
  position: { line: number; character: number };
} {
  const doc = editor.document;
  const text = documentText(doc);
  return {
    textDocument: { uri: doc.uri },
    position: offsetToLspPosition(text, editor.selectedRange.start),
  };
}

function asLocationArray(result: unknown): LspLocation[] {
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  return list.map((r) => {
    // Normalise LocationLink into Location.
    if (r && typeof r === "object" && "targetUri" in r) {
      const link = r as {
        targetUri: string;
        targetSelectionRange: LspRange;
        targetRange: LspRange;
      };
      return {
        uri: link.targetUri,
        range: link.targetSelectionRange ?? link.targetRange,
      };
    }
    return r as LspLocation;
  });
}

/** Shared implementation for the definition-like "jump to a location" requests. */
async function goToLocation(
  client: LanguageClient,
  editor: TextEditor,
  method: string,
  label: string,
): Promise<void> {
  const result = await client.sendRequest(method, positionParams(editor));
  const locations = asLocationArray(result);
  if (locations.length === 0) {
    notify.info(`No ${label.toLowerCase()} found.`);
    return;
  }
  if (locations.length === 1) {
    await revealLocation(locations[0]);
    return;
  }
  const chosen = await choose(locations, locationLabel, label);
  if (chosen) await revealLocation(chosen);
}

/**
 * Show a choice palette and resolve with the chosen item, or null if the user
 * dismissed it.
 */
function choose<T>(
  items: readonly T[],
  label: (item: T) => string,
  placeholder: string,
): Promise<T | null> {
  return new Promise((resolve) => {
    nova.workspace.showChoicePalette(
      items.map(label),
      { placeholder },
      (_selection, index) => {
        resolve(index != null && index >= 0 ? items[index] : null);
      },
    );
  });
}

/** "A.java:42" — enough to tell two results apart in a palette. */
function locationLabel(loc: LspLocation): string {
  return `${nova.path.basename(uriToPath(loc.uri))}:${loc.range.start.line + 1}`;
}

export function goToDefinition(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  return goToLocation(client, editor, "textDocument/definition", "Definition");
}

export function goToTypeDefinition(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  return goToLocation(
    client,
    editor,
    "textDocument/typeDefinition",
    "Type Definition",
  );
}

export function goToImplementation(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  return goToLocation(
    client,
    editor,
    "textDocument/implementation",
    "Implementation",
  );
}

export async function findReferences(
  client: LanguageClient,
  editor: TextEditor,
  view: ReferencesView,
): Promise<void> {
  const params = {
    ...positionParams(editor),
    context: { includeDeclaration: true },
  };
  const result = (await client.sendRequest(
    "textDocument/references",
    params,
  )) as LspLocation[] | null;
  const locations = result ?? [];
  if (locations.length === 0) {
    notify.info("No references found.");
    return;
  }
  view.show(locations);
}

export async function rename(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const newName = await promptInput("Rename symbol to:", {
    label: "Rename Symbol",
  });
  if (newName == null || newName.length === 0) return;
  const params = { ...positionParams(editor), newName };
  const edit = (await client.sendRequest(
    "textDocument/rename",
    params,
  )) as WorkspaceEdit | null;
  if (!edit) {
    notify.info("Symbol cannot be renamed here.");
    return;
  }
  await applyWorkspaceEdit(edit);
}

function formattingOptions(editor: TextEditor): {
  tabSize: number;
  insertSpaces: boolean;
} {
  return { tabSize: editor.tabLength, insertSpaces: editor.softTabs };
}

export async function formatDocumentLsp(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  // Snapshot before the round-trip. On save we may have just applied an
  // organize-imports edit, and the server can answer from the text it had
  // before that change arrived — its positions would then refer to a document
  // that no longer exists, which is how formatting used to scramble files.
  const before = documentText(editor.document);
  const edits = (await client.sendRequest("textDocument/formatting", {
    textDocument: { uri: editor.document.uri },
    options: formattingOptions(editor),
  })) as LspTextEdit[] | null;
  if (!edits || edits.length === 0) return;
  if (!documentUnchanged(editor, before, "formatting")) return;
  await applyTextEdits(editor, edits);
}

/**
 * Did the document change while we were waiting on the server? If so its edits
 * describe stale text and must be dropped rather than applied blindly.
 */
function documentUnchanged(
  editor: TextEditor,
  before: string,
  what: string,
): boolean {
  if (documentText(editor.document) === before) return true;
  console.warn(
    `Discarding ${what} edits: the document changed while the language server was responding.`,
  );
  return false;
}

/** Format just the selection (falls back to the whole document). */
export async function formatSelection(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const selection = editor.selectedRange;
  if (selection.length === 0) {
    await formatDocumentLsp(client, editor);
    return;
  }
  const text = documentText(editor.document);
  const edits = (await client.sendRequest("textDocument/rangeFormatting", {
    textDocument: { uri: editor.document.uri },
    range: {
      start: offsetToLspPosition(text, selection.start),
      end: offsetToLspPosition(text, selection.end),
    },
    options: formattingOptions(editor),
  })) as LspTextEdit[] | null;
  if (!edits || edits.length === 0) return;
  if (!documentUnchanged(editor, text, "range formatting")) return;
  await applyTextEdits(editor, edits);
}

interface CodeAction {
  title: string;
  kind?: string;
  edit?: WorkspaceEdit;
  command?: { command: string; arguments?: unknown[]; title: string };
}

const ORGANIZE_KIND = "source.organizeImports";

export async function organizeImports(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const actions = (await client.sendRequest("textDocument/codeAction", {
    textDocument: { uri: editor.document.uri },
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    context: { diagnostics: [], only: [ORGANIZE_KIND] },
  })) as CodeAction[] | null;

  const action = (actions ?? []).find(
    (a) => a.kind?.startsWith(ORGANIZE_KIND) ?? false,
  );
  if (!action) {
    notify.info("Nothing to organize.");
    return;
  }
  await runCodeAction(client, action);
}

/** Present all code actions / quick-fixes at the cursor as a palette. */
export async function codeActions(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const text = documentText(editor.document);
  const start = offsetToLspPosition(text, editor.selectedRange.start);
  const end = offsetToLspPosition(text, editor.selectedRange.end);
  const actions = (await client.sendRequest("textDocument/codeAction", {
    textDocument: { uri: editor.document.uri },
    range: { start, end },
    context: { diagnostics: [] },
  })) as CodeAction[] | null;

  const list = (actions ?? []).filter((a) => a.title);
  if (list.length === 0) {
    notify.info("No code actions available here.");
    return;
  }
  const chosen = await choose(list, (a) => a.title, "Java Code Actions");
  if (chosen) await runCodeAction(client, chosen);
}

async function runCodeAction(
  client: LanguageClient,
  action: CodeAction,
): Promise<void> {
  if (action.edit) await applyWorkspaceEdit(action.edit);
  if (action.command) {
    await client.sendRequest("workspace/executeCommand", {
      command: action.command.command,
      arguments: action.command.arguments,
    });
  }
}

export async function findWorkspaceSymbol(
  client: LanguageClient,
): Promise<void> {
  const query = await promptInput("Enter symbol name:", {
    label: "Find Symbol",
  });
  if (query == null) return;
  const result = (await client.sendRequest("workspace/symbol", {
    query,
  })) as WorkspaceSymbol[] | null;
  const symbols = result ?? [];
  if (symbols.length === 0) {
    notify.info("No symbols found.");
    return;
  }
  // The sidebar tracks the active file, so workspace-wide hits are offered as
  // a palette to jump from rather than parked in a view.
  const chosen = await choose(
    symbols,
    (symbol) =>
      symbol.containerName ? `${symbol.name} — ${symbol.containerName}` : symbol.name,
    "Find Symbol",
  );
  if (chosen) await revealLocation(chosen.location);
}

interface WorkspaceSymbol {
  name: string;
  kind: number;
  location: LspLocation;
  containerName?: string;
}
