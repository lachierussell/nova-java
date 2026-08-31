// LSP positions are UTF-16 based, matching Nova's offsets, so only
// line/character ↔ offset conversion is needed.

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

export function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

export function offsetToLspPosition(text: string, offset: number): LspPosition {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

export function lspPositionToOffset(text: string, pos: LspPosition): number {
  return positionToOffset(text, lineStartOffsets(text), pos);
}

export function positionToOffset(
  text: string,
  starts: number[],
  pos: LspPosition,
): number {
  // Not clamped: an out-of-range offset is how callers detect a server
  // describing a different revision of the file.
  if (pos.line >= starts.length) return text.length + 1;

  const lineStart = starts[Math.max(0, pos.line)] ?? 0;
  const lineEnd =
    pos.line + 1 < starts.length
      ? starts[pos.line + 1] - newlineWidth(text, starts[pos.line + 1])
      : text.length;
  return Math.min(lineStart + Math.max(0, pos.character), lineEnd);
}

function newlineWidth(text: string, nextLineStart: number): number {
  return text[nextLineStart - 2] === "\r" ? 2 : 1;
}

export function documentText(document: TextDocument): string {
  return document.getTextInRange(new Range(0, document.length));
}

export function uriToPath(uri: string): string {
  const path = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  return decodeURIComponent(path);
}
