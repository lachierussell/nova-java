import { beforeEach, describe, expect, it } from "vitest";
import { installNova } from "./testing/nova";
import {
  lspPositionToOffset,
  lspRangeToOffsets,
  offsetToLspPosition,
  uriToPath,
} from "./lspNovaConversions";

beforeEach(() => {
  installNova();
});

const TEXT = "package p;\n\nclass A {\n}\n";

describe("offset ↔ position", () => {
  it("round-trips every offset in the document", () => {
    for (let offset = 0; offset <= TEXT.length; offset++) {
      const position = offsetToLspPosition(TEXT, offset);
      expect(lspPositionToOffset(TEXT, position)).toBe(offset);
    }
  });

  it("places offset 0 at the start of the first line", () => {
    expect(offsetToLspPosition(TEXT, 0)).toEqual({ line: 0, character: 0 });
  });

  it("treats a newline as belonging to the line it ends", () => {
    expect(offsetToLspPosition(TEXT, 10)).toEqual({ line: 0, character: 10 });
    expect(offsetToLspPosition(TEXT, 11)).toEqual({ line: 1, character: 0 });
  });

  it("clamps a character past the end of its line", () => {
    // LSP requires clamping; line 0 is "package p;" (10 characters).
    expect(lspPositionToOffset(TEXT, { line: 0, character: 99 })).toBe(10);
  });

  it("does not count a CRLF's carriage return as line content", () => {
    const crlf = "one\r\ntwo\r\n";
    expect(lspPositionToOffset(crlf, { line: 0, character: 99 })).toBe(3);
    expect(lspPositionToOffset(crlf, { line: 1, character: 0 })).toBe(5);
  });

  it("returns an out-of-range offset for a line past the end", () => {
    // Deliberately out of range: that is how callers detect that the server
    // is describing a different revision of the file.
    expect(lspPositionToOffset(TEXT, { line: 99, character: 0 })).toBeGreaterThan(
      TEXT.length,
    );
  });

  it("handles an empty document", () => {
    expect(offsetToLspPosition("", 0)).toEqual({ line: 0, character: 0 });
    expect(lspPositionToOffset("", { line: 0, character: 0 })).toBe(0);
  });
});

describe("lspRangeToOffsets", () => {
  it("resolves both ends against one snapshot", () => {
    expect(
      lspRangeToOffsets(TEXT, {
        start: { line: 2, character: 6 },
        end: { line: 2, character: 7 },
      }),
    ).toEqual({ start: 18, end: 19 });
    expect(TEXT.slice(18, 19)).toBe("A");
  });
});

describe("uriToPath", () => {
  it("strips the scheme and percent-decodes", () => {
    expect(uriToPath("file:///p/My%20Project/A.java")).toBe("/p/My Project/A.java");
  });
});
