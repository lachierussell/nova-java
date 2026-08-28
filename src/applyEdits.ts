import {
  LspRange,
  LspTextEdit,
  lspRangeToRange,
} from "./lspNovaConversions";

interface TextDocumentEdit {
  textDocument: { uri: string; version?: number | null };
  edits: LspTextEdit[];
}

export interface WorkspaceEdit {
  changes?: { [uri: string]: LspTextEdit[] };
  documentChanges?: TextDocumentEdit[];
}

/**
 * Apply a list of LSP TextEdits to an already-open editor. Edits are applied
 * back-to-front so earlier offsets remain valid as we mutate the document.
 */
export async function applyTextEdits(
  editor: TextEditor,
  edits: readonly LspTextEdit[],
): Promise<void> {
  if (edits.length === 0) return;
  const sorted = [...edits].sort((a, b) => comparePositions(b.range, a.range));
  await editor.edit((edit) => {
    for (const e of sorted) {
      const range = lspRangeToRange(editor.document, e.range);
      edit.replace(range, e.newText);
    }
  });
}

function comparePositions(a: LspRange, b: LspRange): number {
  if (a.start.line !== b.start.line) return a.start.line - b.start.line;
  return a.start.character - b.start.character;
}

/** Apply a full LSP WorkspaceEdit, opening each affected document. */
export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<void> {
  const perUri = new Map<string, LspTextEdit[]>();

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      perUri.set(change.textDocument.uri, change.edits);
    }
  } else if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      perUri.set(uri, edits);
    }
  }

  for (const [uri, edits] of perUri) {
    const editor = await nova.workspace.openFile(uri);
    if (!editor) continue;
    await applyTextEdits(editor, edits);
  }
}
