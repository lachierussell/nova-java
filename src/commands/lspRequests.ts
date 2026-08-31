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

interface CodeAction {
  title: string;
  kind?: string;
  edit?: WorkspaceEdit;
  command?: { command: string; arguments?: unknown[]; title: string };
}

interface WorkspaceSymbol {
  name: string;
  kind: number;
  location: LspLocation;
  containerName?: string;
}

const ORGANIZE_KIND = "source.organizeImports";

function positionParams(editor: TextEditor): {
  textDocument: { uri: string };
  position: { line: number; character: number };
} {
  const doc = editor.document;
  return {
    textDocument: { uri: doc.uri },
    position: offsetToLspPosition(
      documentText(doc),
      editor.selectedRange.start,
    ),
  };
}

function asLocationArray(result: unknown): LspLocation[] {
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map((r) => {
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

function locationLabel(loc: LspLocation): string {
  return `${nova.path.basename(uriToPath(loc.uri))}:${loc.range.start.line + 1}`;
}

async function goToLocation(
  client: LanguageClient,
  editor: TextEditor,
  method: string,
  label: string,
): Promise<void> {
  const locations = asLocationArray(
    await client.sendRequest(method, positionParams(editor)),
  );
  if (locations.length === 0) {
    notify.info(`No ${label.toLowerCase()} found.`);
    return;
  }

  const chosen =
    locations.length === 1
      ? locations[0]
      : await choose(locations, locationLabel, label);
  if (chosen) await revealLocation(chosen);
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
  const result = (await client.sendRequest("textDocument/references", {
    ...positionParams(editor),
    context: { includeDeclaration: true },
  })) as LspLocation[] | null;

  if (!result || result.length === 0) {
    notify.info("No references found.");
    return;
  }
  view.show(result);
}

export async function rename(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const newName = await promptInput("Rename symbol to:", {
    label: "Rename Symbol",
  });
  if (!newName) return;

  const edit = (await client.sendRequest("textDocument/rename", {
    ...positionParams(editor),
    newName,
  })) as WorkspaceEdit | null;
  if (!edit) {
    notify.info("Symbol cannot be renamed here.");
    return;
  }
  await applyWorkspaceEdit(edit);
}

/**
 * The document is snapshotted around the round-trip because the server may
 * answer from text that has since changed — on save, an organize-imports edit
 * has often just landed — and those edits would scramble the file.
 */
async function requestFormatting(
  client: LanguageClient,
  editor: TextEditor,
  method: string,
  range?: LspRange,
): Promise<void> {
  const before = documentText(editor.document);
  const edits = (await client.sendRequest(method, {
    textDocument: { uri: editor.document.uri },
    options: { tabSize: editor.tabLength, insertSpaces: editor.softTabs },
    ...(range ? { range } : {}),
  })) as LspTextEdit[] | null;

  if (!edits || edits.length === 0) return;
  if (documentText(editor.document) !== before) {
    console.warn(
      `Discarding ${method} edits: the document changed while the language server was responding.`,
    );
    return;
  }
  await applyTextEdits(editor, edits);
}

export function formatDocumentLsp(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  return requestFormatting(client, editor, "textDocument/formatting");
}

export function formatSelection(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const selection = editor.selectedRange;
  if (selection.length === 0) return formatDocumentLsp(client, editor);

  const text = documentText(editor.document);
  return requestFormatting(client, editor, "textDocument/rangeFormatting", {
    start: offsetToLspPosition(text, selection.start),
    end: offsetToLspPosition(text, selection.end),
  });
}

export async function organizeImports(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const actions = (await client.sendRequest("textDocument/codeAction", {
    textDocument: { uri: editor.document.uri },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics: [], only: [ORGANIZE_KIND] },
  })) as CodeAction[] | null;

  const action = actions?.find((a) => a.kind?.startsWith(ORGANIZE_KIND));
  if (!action) {
    notify.info("Nothing to organize.");
    return;
  }
  await runCodeAction(client, action);
}

export async function codeActions(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const text = documentText(editor.document);
  const actions = (await client.sendRequest("textDocument/codeAction", {
    textDocument: { uri: editor.document.uri },
    range: {
      start: offsetToLspPosition(text, editor.selectedRange.start),
      end: offsetToLspPosition(text, editor.selectedRange.end),
    },
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

  const symbols = ((await client.sendRequest("workspace/symbol", {
    query,
  })) ?? []) as WorkspaceSymbol[];
  if (symbols.length === 0) {
    notify.info("No symbols found.");
    return;
  }

  const chosen = await choose(
    symbols,
    (symbol) =>
      symbol.containerName
        ? `${symbol.name} — ${symbol.containerName}`
        : symbol.name,
    "Find Symbol",
  );
  if (chosen) await revealLocation(chosen.location);
}
