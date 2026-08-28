import {
  LspLocation,
  documentText,
  lspPositionToOffset,
} from "./lspNovaConversions";

/** Open the file for an LSP location and select its range. */
export async function revealLocation(loc: LspLocation): Promise<void> {
  const editor = await nova.workspace.openFile(loc.uri);
  if (!editor) return;
  const text = documentText(editor.document);
  const start = lspPositionToOffset(text, loc.range.start);
  const end = lspPositionToOffset(text, loc.range.end);
  editor.selectedRange = new Range(start, end);
  editor.scrollToPosition(start);
}
