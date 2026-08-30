import {
  LspRange,
  LspTextEdit,
  documentText,
  lspRangeToOffsets,
} from "./lspNovaConversions";

interface TextDocumentEdit {
  textDocument: { uri: string; version?: number | null };
  edits: LspTextEdit[];
}

export interface WorkspaceEdit {
  changes?: { [uri: string]: LspTextEdit[] };
  documentChanges?: TextDocumentEdit[];
}

/** A resolved edit: flat character offsets into the snapshot, plus replacement. */
export interface PlannedEdit {
  start: number;
  end: number;
  newText: string;
}

/**
 * Resolve LSP edits into flat offsets against a single snapshot of the
 * document, ordered back-to-front.
 *
 * Every offset must be computed from the *same* text. Resolving each edit
 * against the live document as the transaction mutates it makes later
 * conversions see shifted line starts, which lands replacements a few
 * characters off and shreds the file ("impo  rt", "j a va"). Snapshot once,
 * convert everything, then apply from the end so earlier offsets stay valid.
 *
 * Returns null when the server sent edits that cannot be applied safely —
 * overlapping ranges, or ranges outside the document. That means our text and
 * the server's have diverged, and applying them would corrupt the file.
 */
export function planTextEdits(
  text: string,
  edits: readonly LspTextEdit[],
): PlannedEdit[] | null {
  const planned: PlannedEdit[] = [];
  for (const edit of edits) {
    const { start, end } = lspRangeToOffsets(text, edit.range);
    // Out of bounds means the server was formatting a different revision of
    // the document than the one we hold.
    if (start < 0 || end > text.length || start > end) return null;
    planned.push({ start, end, newText: edit.newText });
  }

  // Back-to-front. Ties break on the longer range first so a replacement and a
  // pure insertion at the same offset keep a deterministic order.
  planned.sort((a, b) => b.start - a.start || b.end - a.end);

  for (let i = 1; i < planned.length; i++) {
    // Sorted descending, so the previous entry starts at or after this one ends.
    if (planned[i].end > planned[i - 1].start) return null;
  }

  return planned;
}

/**
 * Apply the plan to a string. Used to verify a plan in tests, and mirrors
 * exactly what `applyTextEdits` asks the editor to do.
 */
export function applyPlanToText(text: string, plan: readonly PlannedEdit[]): string {
  let out = text;
  for (const e of plan) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

/**
 * Apply a list of LSP TextEdits to an already-open editor. Resolves to false
 * if the edits were rejected as unsafe.
 */
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

/**
 * Collect a WorkspaceEdit into one edit list per document URI.
 *
 * `documentChanges` wins over `changes` when both are present, as the spec
 * requires.
 */
export function groupWorkspaceEdit(
  edit: WorkspaceEdit,
): Map<string, LspTextEdit[]> {
  const perUri = new Map<string, LspTextEdit[]>();

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      // `documentChanges` also carries create/rename/delete file operations,
      // which have no `textDocument` and no edits. Nova cannot perform those,
      // so skip them rather than dereferencing undefined.
      if (!change.textDocument || !change.edits) continue;
      // A single document may appear more than once — JDT.LS splits a rename
      // into several entries for the same file. Overwriting kept only the
      // last, so most of a rename silently went missing.
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

/** Apply a full LSP WorkspaceEdit, opening each affected document. */
export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<void> {
  for (const [uri, edits] of groupWorkspaceEdit(edit)) {
    const editor = await nova.workspace.openFile(uri);
    if (!editor) continue;
    await applyTextEdits(editor, edits);
  }
}

export type { LspRange };
