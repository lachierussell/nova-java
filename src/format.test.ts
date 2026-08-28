import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyTextEdits } from "./applyEdits";
import { formatDocumentLsp } from "./commands/lspRequests";
import { LspTextEdit } from "./lspNovaConversions";
import {
  FakeClient,
  FakeEditor,
  installNovaGlobals,
} from "./testing/novaFake";

beforeAll(() => {
  installNovaGlobals();
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
  it("applies a document-wide format without shifting characters (issue #1)", async () => {
    const editor = new FakeEditor(IMPORTS);
    // Many small edits across the file — the shape of a real JDT.LS formatting
    // response, and the case where offsets resolved one-at-a-time against the
    // mutating document drifted and produced "impo  rt" / "j a va".
    const edits = [
      edit(0, 0, 0, 6, "IMPORT"),
      edit(1, 7, 1, 11, "JAVA"),
      edit(2, 0, 2, 6, "IMPORT"),
      edit(3, 7, 3, 11, "JAVA"),
    ];

    await expect(applyTextEdits(editor as never, edits)).resolves.toBe(true);
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
    const editor = new FakeEditor("one\ntwo\nthree\n");
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
    // Length-changing edits are what made a mid-transaction re-read of the
    // document read the wrong range and throw.
    const editor = new FakeEditor("aaaa\nbbbb\ncccc\n");
    await applyTextEdits(editor as never, [
      edit(0, 0, 0, 4, "x"), // shrink
      edit(1, 0, 1, 4, "yyyyyyyy"), // grow
      edit(2, 0, 2, 4, "z"), // shrink
    ]);
    expect(editor.text).toBe("x\nyyyyyyyy\nz\n");
  });

  it("leaves the document untouched when edits overlap", async () => {
    const editor = new FakeEditor(IMPORTS);
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
    const editor = new FakeEditor(IMPORTS);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      applyTextEdits(editor as never, [edit(99, 0, 99, 4, "  ")]),
    ).resolves.toBe(false);

    expect(editor.text).toBe(IMPORTS);
    spy.mockRestore();
  });
});

describe("formatDocumentLsp", () => {
  it("applies the server's edits when the document is unchanged", async () => {
    const editor = new FakeEditor("class A{}\n");
    const client = new FakeClient(() => [edit(0, 7, 0, 7, " ")]);

    await formatDocumentLsp(client as never, editor as never);

    expect(editor.text).toBe("class A {}\n");
  });

  it("discards edits computed against text that has since changed (issue #1)", async () => {
    // The format-on-save sequence: organize-imports rewrites the file, then
    // formatting is requested. If the server answers from the pre-organize
    // text, its positions describe a document that no longer exists — applying
    // them is what scattered spaces through the imports.
    const editor = new FakeEditor(IMPORTS);
    const staleEdits = [edit(0, 6, 0, 7, "  "), edit(1, 6, 1, 7, "  ")];

    const client = new FakeClient(() => {
      // Something else rewrites the document while the request is in flight.
      editor.document.text = "import java.io.*;\n";
      return staleEdits;
    });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await formatDocumentLsp(client as never, editor as never);

    expect(editor.text).toBe("import java.io.*;\n");
    expect(editor.replacements).toHaveLength(0);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("does nothing when the server returns no edits", async () => {
    const editor = new FakeEditor(IMPORTS);
    const client = new FakeClient(() => null);

    await formatDocumentLsp(client as never, editor as never);

    expect(editor.text).toBe(IMPORTS);
    expect(editor.replacements).toHaveLength(0);
  });

  it("sends the editor's indentation settings to the server", async () => {
    const editor = new FakeEditor("class A{}\n");
    editor.tabLength = 2;
    editor.softTabs = false;
    const client = new FakeClient(() => []);

    await formatDocumentLsp(client as never, editor as never);

    expect(client.requests[0].method).toBe("textDocument/formatting");
    expect(client.requests[0].params).toMatchObject({
      options: { tabSize: 2, insertSpaces: false },
    });
  });
});
