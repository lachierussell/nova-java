import { beforeEach, describe, expect, it, vi } from "vitest";
import { installNova, NovaFake } from "./testing/nova";
import { applyTextEdits, applyWorkspaceEdit } from "./applyEdits";
import { LspTextEdit } from "./lspNovaConversions";

let nova: NovaFake;

beforeEach(() => {
  nova = installNova();
});

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

const IMPORTS = [
  "import java.io.*;",
  "import java.math.*;",
  "import java.security.*;",
  "import java.text.*;",
  "",
].join("\n");

describe("applyTextEdits", () => {
  it("applies a document-wide format without shifting characters", async () => {
    const editor = nova.openEditor("/p/A.java", IMPORTS);
    // Many small edits across the file — the shape of a real JDT.LS formatting
    // response, and the case where offsets resolved one-at-a-time against the
    // mutating document drifted and produced "impo  rt" / "j a va".
    await expect(
      applyTextEdits(editor as never, [
        edit(0, 0, 0, 6, "IMPORT"),
        edit(1, 7, 1, 11, "JAVA"),
        edit(2, 0, 2, 6, "IMPORT"),
        edit(3, 7, 3, 11, "JAVA"),
      ]),
    ).resolves.toBe(true);

    expect(editor.text).toBe(
      [
        "IMPORT java.io.*;",
        "import JAVA.math.*;",
        "IMPORT java.security.*;",
        "import JAVA.text.*;",
        "",
      ].join("\n"),
    );
  });

  it("issues its replacements back-to-front", async () => {
    const editor = nova.openEditor("/p/A.java", "one\ntwo\nthree\n");
    await applyTextEdits(editor as never, [
      edit(0, 0, 0, 3, "1"),
      edit(1, 0, 1, 3, "2"),
      edit(2, 0, 2, 5, "3"),
    ]);
    // Descending starts: each replace lands after the ones still to come, so
    // no earlier offset is invalidated by the time it is used.
    expect(editor.replacements.map((r) => r.start)).toEqual([8, 4, 0]);
    expect(editor.text).toBe("1\n2\n3\n");
  });

  it("survives edits that change the document length as they are applied", async () => {
    const editor = nova.openEditor("/p/A.java", "aaaa\nbbbb\ncccc\n");
    await applyTextEdits(editor as never, [
      edit(0, 0, 0, 4, "x"),
      edit(1, 0, 1, 4, "yyyyyyyy"),
      edit(2, 0, 2, 4, "z"),
    ]);
    expect(editor.text).toBe("x\nyyyyyyyy\nz\n");
  });

  it("handles CRLF line endings", async () => {
    const editor = nova.openEditor("/p/A.java", "one\r\ntwo\r\n");
    await applyTextEdits(editor as never, [edit(1, 0, 1, 3, "2")]);
    expect(editor.text).toBe("one\r\n2\r\n");
  });

  it("applies an insertion and a replacement that meet at one offset", async () => {
    const editor = nova.openEditor("/p/A.java", "ab\n");
    await applyTextEdits(editor as never, [
      edit(0, 0, 0, 1, "A"),
      edit(0, 1, 0, 1, "-"),
    ]);
    expect(editor.text).toBe("A-b\n");
  });

  it("leaves the document untouched when edits overlap", async () => {
    const editor = nova.openEditor("/p/A.java", IMPORTS);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      applyTextEdits(editor as never, [
        edit(0, 0, 0, 10, "x"),
        edit(0, 5, 0, 15, "y"),
      ]),
    ).resolves.toBe(false);

    expect(editor.text).toBe(IMPORTS);
    expect(editor.replacements).toHaveLength(0);
    spy.mockRestore();
  });

  it("leaves the document untouched when edits point past its end", async () => {
    const editor = nova.openEditor("/p/A.java", IMPORTS);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      applyTextEdits(editor as never, [edit(99, 0, 99, 4, "  ")]),
    ).resolves.toBe(false);

    expect(editor.text).toBe(IMPORTS);
    spy.mockRestore();
  });

  it("does nothing for an empty edit list", async () => {
    const editor = nova.openEditor("/p/A.java", IMPORTS);
    await expect(applyTextEdits(editor as never, [])).resolves.toBe(true);
    expect(editor.replacements).toHaveLength(0);
  });
});

describe("applyWorkspaceEdit", () => {
  it("applies `changes` across several files", async () => {
    const a = nova.openEditor("/p/A.java", "class A {}\n");
    const b = nova.openEditor("/p/B.java", "class B {}\n");

    await applyWorkspaceEdit({
      changes: {
        "file:///p/A.java": [edit(0, 6, 0, 7, "X")],
        "file:///p/B.java": [edit(0, 6, 0, 7, "Y")],
      },
    });

    expect(a.text).toBe("class X {}\n");
    expect(b.text).toBe("class Y {}\n");
  });

  it("merges several documentChanges entries for the same file", async () => {
    // JDT.LS splits a rename across entries; keeping only the last dropped
    // most of the rename.
    const editor = nova.openEditor("/p/A.java", "aa bb cc\n");

    await applyWorkspaceEdit({
      documentChanges: [
        { textDocument: { uri: "file:///p/A.java" }, edits: [edit(0, 0, 0, 2, "AA")] },
        { textDocument: { uri: "file:///p/A.java" }, edits: [edit(0, 6, 0, 8, "CC")] },
      ],
    });

    expect(editor.text).toBe("AA bb CC\n");
  });

  it("prefers documentChanges over changes when both are present", async () => {
    const editor = nova.openEditor("/p/A.java", "aa\n");
    await applyWorkspaceEdit({
      changes: { "file:///p/A.java": [edit(0, 0, 0, 2, "WRONG")] },
      documentChanges: [
        { textDocument: { uri: "file:///p/A.java" }, edits: [edit(0, 0, 0, 2, "RIGHT")] },
      ],
    });
    expect(editor.text).toBe("RIGHT\n");
  });

  it("skips create/rename/delete operations it cannot perform", async () => {
    const editor = nova.openEditor("/p/A.java", "aa\n");
    await applyWorkspaceEdit({
      documentChanges: [
        { kind: "create", uri: "file:///p/New.java" },
        { textDocument: { uri: "file:///p/A.java" }, edits: [edit(0, 0, 0, 2, "bb")] },
      ] as never,
    });
    expect(editor.text).toBe("bb\n");
  });

  it("opens a file that is not already in an editor", async () => {
    nova.fs.writeFile("/p/Closed.java", "class Closed {}\n");
    await applyWorkspaceEdit({
      changes: { "file:///p/Closed.java": [edit(0, 6, 0, 12, "Opened")] },
    });
    const editor = nova.workspace.textEditors.find(
      (e) => e.document.path === "/p/Closed.java",
    );
    expect(editor?.text).toBe("class Opened {}\n");
  });
});
