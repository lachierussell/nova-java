import {
  LspTextEdit,
  documentText,
  lineStartOffsets,
  positionToOffset,
} from "./lspNovaConversions";

interface TextDocumentEdit {
  textDocument: { uri: string; version?: number | null };
  edits: LspTextEdit[];
}

export interface WorkspaceEdit {
  changes?: { [uri: string]: LspTextEdit[] };
  documentChanges?: TextDocumentEdit[];
}

interface PlannedEdit {
  start: number;
  end: number;
  newText: string;
}

// Converting against the live document as the transaction mutates it shifts
// later line starts and shreds the file, so: snapshot once, convert all, apply
// from the end. Null means the edits overlap or fall outside the document.
function planTextEdits(
  text: string,
  edits: readonly LspTextEdit[],
): PlannedEdit[] | null {
  const starts = lineStartOffsets(text);
  const planned: PlannedEdit[] = [];
  for (const edit of edits) {
    const start = positionToOffset(text, starts, edit.range.start);
    const end = positionToOffset(text, starts, edit.range.end);
    if (start < 0 || end > text.length || start > end) return null;
    planned.push({ start, end, newText: edit.newText });
  }

  planned.sort((a, b) => b.start - a.start || b.end - a.end);

  for (let i = 1; i < planned.length; i++) {
    if (planned[i].end > planned[i - 1].start) return null;
  }

  return planned;
}

export async function applyTextEdits(
  editor: TextEditor,
  edits: readonly LspTextEdit[],
): Promise<boolean> {
  if (edits.length === 0) return true;

  const text = documentText(editor.document);
  const plan = planTextEdits(text, edits);
  if (!plan) {
    console.error(
      `Refusing to apply ${edits.length} text edit(s): they overlap or fall outside the document. ` +
        "The language server is likely working from a stale copy of the file.",
    );
    return false;
  }

  await editor.edit((edit) => {
    for (const e of plan) {
      edit.replace(new Range(e.start, e.end), e.newText);
    }
  });
  return true;
}

export function groupWorkspaceEdit(
  edit: WorkspaceEdit,
): Map<string, LspTextEdit[]> {
  const perUri = new Map<string, LspTextEdit[]>();

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      // Create/rename/delete file operations, which Nova cannot perform.
      if (!change.textDocument || !change.edits) continue;
      // Appended, not assigned: JDT.LS splits a rename across several entries.
      const existing = perUri.get(change.textDocument.uri);
      if (existing) existing.push(...change.edits);
      else perUri.set(change.textDocument.uri, [...change.edits]);
    }
  } else if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      perUri.set(uri, [...edits]);
    }
  }

  return perUri;
}

export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<void> {
  for (const [uri, edits] of groupWorkspaceEdit(edit)) {
    const editor = await nova.workspace.openFile(uri);
    if (editor) await applyTextEdits(editor, edits);
  }
}
