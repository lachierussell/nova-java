/**
 * Conversions between Nova's character-offset ranges and LSP's
 * line/character positions. LSP positions are UTF-16 based, which matches
 * Nova's offsets, so we only need to translate between a flat offset and a
 * (line, character) pair using the document's text.
 */

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

/** Precompute the starting offset of every line in `text`. */
function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Convert a flat character offset into an LSP {line, character}. */
export function offsetToLspPosition(text: string, offset: number): LspPosition {
  const starts = lineStartOffsets(text);
  // Binary search for the greatest line start <= offset.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}

/** Convert an LSP {line, character} into a flat character offset. */
export function lspPositionToOffset(text: string, pos: LspPosition): number {
  const starts = lineStartOffsets(text);
  const lineStart = starts[Math.min(pos.line, starts.length - 1)] ?? 0;
  return lineStart + pos.character;
}

/** Read a document's full text. */
export function documentText(document: TextDocument): string {
  return document.getTextInRange(new Range(0, document.length));
}

export function rangeToLspRange(document: TextDocument, range: Range): LspRange {
  const text = documentText(document);
  return {
    start: offsetToLspPosition(text, range.start),
    end: offsetToLspPosition(text, range.end),
  };
}

export function lspRangeToRange(document: TextDocument, range: LspRange): Range {
  const text = documentText(document);
  return new Range(
    lspPositionToOffset(text, range.start),
    lspPositionToOffset(text, range.end),
  );
}

/** LSP file URI for a Nova path. */
export function pathToUri(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function uriToPath(uri: string): string {
  let p = uri;
  if (p.startsWith("file://")) p = p.slice("file://".length);
  return decodeURIComponent(p);
}
