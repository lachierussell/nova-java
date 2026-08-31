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

/**
 * The starting offset of every line in `text`.
 *
 * Callers resolving more than one position — formatting a whole document is
 * hundreds of edits — build this once and pass it to `positionToOffset`, so
 * the text is walked once rather than once per position.
 */
export function lineStartOffsets(text: string): number[] {
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

/**
 * Convert an LSP {line, character} into a flat character offset.
 *
 * `character` is clamped to the end of its line, as the LSP spec requires. A
 * `line` past the end of the document is *not* clamped: the resulting
 * out-of-range offset is how callers detect that the server is describing a
 * different revision of the file than the one we hold.
 */
export function lspPositionToOffset(text: string, pos: LspPosition): number {
  return positionToOffset(text, lineStartOffsets(text), pos);
}

export function positionToOffset(
  text: string,
  starts: number[],
  pos: LspPosition,
): number {
  if (pos.line >= starts.length) {
    // Beyond the last line; deliberately out of range.
    return text.length + 1;
  }
  const lineStart = starts[Math.max(0, pos.line)] ?? 0;
  const lineEnd = pos.line + 1 < starts.length
    ? starts[pos.line + 1] - newlineWidth(text, starts[pos.line + 1])
    : text.length;
  return Math.min(lineStart + Math.max(0, pos.character), lineEnd);
}

/** 2 for a CRLF ending at `nextLineStart`, otherwise 1. */
function newlineWidth(text: string, nextLineStart: number): number {
  return text[nextLineStart - 2] === "\r" ? 2 : 1;
}

/**
 * Convert an LSP range into flat start/end offsets using a single pass over
 * the text. Callers formatting a whole document resolve hundreds of edits, and
 * every one of them must be measured against the same snapshot.
 */
export function lspRangeToOffsets(
  text: string,
  range: LspRange,
): { start: number; end: number } {
  const starts = lineStartOffsets(text);
  return {
    start: positionToOffset(text, starts, range.start),
    end: positionToOffset(text, starts, range.end),
  };
}

/** Read a document's full text. */
export function documentText(document: TextDocument): string {
  return document.getTextInRange(new Range(0, document.length));
}

export function uriToPath(uri: string): string {
  let p = uri;
  if (p.startsWith("file://")) p = p.slice("file://".length);
  return decodeURIComponent(p);
}
