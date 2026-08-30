import { describe, expect, it } from "vitest";
import {
  applyPlanToText,
  groupWorkspaceEdit,
  planTextEdits,
} from "./applyEdits";
import { LspTextEdit, lspRangeToOffsets } from "./lspNovaConversions";

/** Build an edit from 1-based-free line/character coordinates. */
function edit(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
  newText: string,
): LspTextEdit {
  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    newText,
  };
}

/** Run edits through the planner and apply them, as the editor would. */
function format(text: string, edits: LspTextEdit[]): string | null {
  const plan = planTextEdits(text, edits);
  return plan ? applyPlanToText(text, plan) : null;
}

describe("planTextEdits", () => {
  it("applies multiple edits without drifting (issue #1)", () => {
    // The reported corruption inserted spaces inside words — "impo  rt",
    // "j a va" — because each edit's offsets were recomputed against a
    // document that earlier edits had already mutated.
    const text = [
      "import java.io.*;",
      "import java.math.*;",
      "import java.security.*;",
      "",
    ].join("\n");

    // A realistic JDT.LS whitespace-normalising response: several small edits
    // spread across the file, delivered in document order.
    const edits = [
      edit(0, 6, 0, 7, "  "), // "import java" -> "import  java"
      edit(1, 6, 1, 7, "  "),
      edit(2, 6, 2, 7, "  "),
    ];

    expect(format(text, edits)).toBe(
      [
        "import  java.io.*;",
        "import  java.math.*;",
        "import  java.security.*;",
        "",
      ].join("\n"),
    );
  });

  it("is unaffected by the order the server sends edits in", () => {
    const text = "alpha\nbeta\ngamma\n";
    const edits = [
      edit(0, 0, 0, 5, "ALPHA"),
      edit(2, 0, 2, 5, "GAMMA"),
      edit(1, 0, 1, 4, "BETA"),
    ];
    const shuffled = [edits[1], edits[2], edits[0]];

    expect(format(text, edits)).toBe("ALPHA\nBETA\nGAMMA\n");
    expect(format(text, shuffled)).toBe("ALPHA\nBETA\nGAMMA\n");
  });

  it("plans edits back-to-front so offsets stay valid", () => {
    const plan = planTextEdits("one\ntwo\nthree\n", [
      edit(0, 0, 0, 3, "1"),
      edit(2, 0, 2, 5, "3"),
      edit(1, 0, 1, 3, "2"),
    ]);
    expect(plan?.map((e) => e.start)).toEqual([8, 4, 0]);
  });

  it("handles edits that grow and shrink the text on the same line", () => {
    const text = "int  x   =  1;\n";
    const edits = [
      edit(0, 3, 0, 5, " "), // collapse the double space
      edit(0, 6, 0, 9, " "), // collapse the triple space
      edit(0, 10, 0, 12, " "),
    ];
    expect(format(text, edits)).toBe("int x = 1;\n");
  });

  it("applies pure insertions at an empty range", () => {
    const text = "class A {}\n";
    expect(format(text, [edit(0, 10, 0, 10, "\n")])).toBe("class A {}\n\n");
  });

  it("rejects overlapping edits rather than corrupting the document", () => {
    const text = "import java.io.*;\n";
    const overlapping = [edit(0, 0, 0, 10, "x"), edit(0, 5, 0, 15, "y")];
    expect(planTextEdits(text, overlapping)).toBeNull();
  });

  it("allows edits that touch end-to-start without overlapping", () => {
    const text = "abcdef\n";
    const adjacent = [edit(0, 0, 0, 3, "XYZ"), edit(0, 3, 0, 6, "123")];
    expect(format(text, adjacent)).toBe("XYZ123\n");
  });

  it("rejects edits pointing past the end of the document", () => {
    // The signature of a server formatting a revision we no longer hold.
    const text = "class A {}\n";
    expect(planTextEdits(text, [edit(40, 0, 40, 4, "  ")])).toBeNull();
  });

  it("accepts a whole-document replacement addressed to the virtual last line", () => {
    const text = "a\nb\n";
    // Text ending in a newline has an empty final line; {line: 2, character: 0}
    // is the valid end-of-document position and must not be rejected.
    expect(format(text, [edit(0, 0, 2, 0, "c\n")])).toBe("c\n");
  });

  it("returns an empty plan for no edits", () => {
    expect(planTextEdits("abc", [])).toEqual([]);
  });
});

describe("lspRangeToOffsets", () => {
  it("resolves positions against the given snapshot", () => {
    const text = "one\ntwo\nthree";
    expect(lspRangeToOffsets(text, edit(1, 0, 2, 5, "").range)).toEqual({
      start: 4,
      end: 13,
    });
  });

  it("clamps a character past the end of its line, as the spec requires", () => {
    const text = "ab\ncd\n";
    // Line 0 holds 2 characters; character 99 must land on the newline, not
    // run into the next line.
    expect(lspRangeToOffsets(text, edit(0, 0, 0, 99, "").range).end).toBe(2);
  });

  it("handles CRLF line endings", () => {
    const text = "ab\r\ncd\r\n";
    expect(lspRangeToOffsets(text, edit(1, 0, 1, 2, "").range)).toEqual({
      start: 4,
      end: 6,
    });
    // Clamping to line 0's end must stop before the \r\n, not inside it.
    expect(lspRangeToOffsets(text, edit(0, 0, 0, 99, "").range).end).toBe(2);
  });

  it("reports an out-of-range offset for a line past the document", () => {
    const text = "ab\n";
    expect(lspRangeToOffsets(text, edit(9, 0, 9, 0, "").range).start).toBe(
      text.length + 1,
    );
  });
});

describe("groupWorkspaceEdit", () => {
  const uri = "file:///a/A.java";

  it("merges repeated entries for one document instead of dropping them", () => {
    // JDT.LS splits a rename into several entries for the same file. Keeping
    // only the last applied a fraction of the rename and left the file broken.
    const grouped = groupWorkspaceEdit({
      documentChanges: [
        { textDocument: { uri }, edits: [edit(0, 0, 0, 3, "Foo")] },
        { textDocument: { uri }, edits: [edit(4, 0, 4, 3, "Foo")] },
      ],
    });
    expect(grouped.get(uri)).toHaveLength(2);
  });

  it("skips create/rename/delete operations, which carry no edits", () => {
    const grouped = groupWorkspaceEdit({
      documentChanges: [
        { kind: "create", uri: "file:///a/B.java" },
        { textDocument: { uri }, edits: [edit(0, 0, 0, 1, "x")] },
      ] as never,
    });
    expect([...grouped.keys()]).toEqual([uri]);
  });

  it("falls back to `changes` only when there are no documentChanges", () => {
    const grouped = groupWorkspaceEdit({ changes: { [uri]: [edit(0, 0, 0, 1, "x")] } });
    expect(grouped.get(uri)).toHaveLength(1);
  });

  it("prefers documentChanges over changes when both are present", () => {
    const other = "file:///a/B.java";
    const grouped = groupWorkspaceEdit({
      documentChanges: [{ textDocument: { uri }, edits: [edit(0, 0, 0, 1, "x")] }],
      changes: { [other]: [edit(0, 0, 0, 1, "y")] },
    });
    expect([...grouped.keys()]).toEqual([uri]);
  });
});
