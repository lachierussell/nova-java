import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRange, fakeClient, installNova, NovaFake } from "../testing/nova";
import { setRevealClient } from "../reveal";
import { ReferencesView } from "../sidebar/referencesView";
import * as lsp from "./lspRequests";

let nova: NovaFake;

const SOURCE = ["package p;", "", "class A {", "  void go() {}", "}", ""].join("\n");

beforeEach(() => {
  nova = installNova();
  setRevealClient(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function location(path: string, line: number, character = 0) {
  return {
    uri: `file://${path}`,
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
  };
}


describe("go to definition", () => {
  it("opens the single result and selects the symbol", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    nova.fs.writeFile("/p/B.java", "class B {}\n");
    const c = fakeClient({ "textDocument/definition": [location("/p/B.java", 0, 6)] });

    await lsp.goToDefinition(c as never, editor as never);

    const opened = nova.workspace.activeTextEditor!;
    expect(opened.document.path).toBe("/p/B.java");
    expect([opened.selectedRange.start, opened.selectedRange.end]).toEqual([6, 7]);
  });

  it("sends the cursor position as an LSP position", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const at = SOURCE.indexOf("go");
    editor.selectedRange = new FakeRange(at, at);
    const c = fakeClient({ "textDocument/definition": null });

    await lsp.goToDefinition(c as never, editor as never);

    expect(c.requests[0].params).toMatchObject({
      textDocument: { uri: "file:///p/A.java" },
      position: { line: 3, character: 7 },
    });
  });

  it("normalises a LocationLink into a Location", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    nova.fs.writeFile("/p/B.java", "class B {}\n");
    const c = fakeClient({
      "textDocument/definition": {
        targetUri: "file:///p/B.java",
        targetSelectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 7 },
        },
        targetRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
      },
    });

    await lsp.goToDefinition(c as never, editor as never);

    expect(nova.workspace.activeTextEditor!.selectedRange.start).toBe(6);
  });

  it("offers a palette when there are several results", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    nova.fs.writeFile("/p/B.java", "class B {}\n");
    nova.fs.writeFile("/p/C.java", "class C {}\n");
    const c = fakeClient({
      "textDocument/implementation": [location("/p/B.java", 0), location("/p/C.java", 2)],
    });
    nova.workspace.choose = () => 1;

    await lsp.goToImplementation(c as never, editor as never);

    expect(nova.workspace.lastPrompt).toEqual({
      message: "Implementation",
      choices: ["B.java:1", "C.java:3"],
    });
    expect(nova.workspace.activeTextEditor!.document.path).toBe("/p/C.java");
  });

  it("does nothing when the palette is cancelled", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    nova.fs.writeFile("/p/B.java", "class B {}\n");
    const c = fakeClient({
      "textDocument/typeDefinition": [location("/p/B.java", 0), location("/p/B.java", 1)],
    });
    nova.workspace.choose = () => null;

    await lsp.goToTypeDefinition(c as never, editor as never);

    expect(nova.workspace.activeTextEditor).toBe(editor);
  });

  it("reports when the server has no answer", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const c = fakeClient({ "textDocument/definition": [] });

    await lsp.goToDefinition(c as never, editor as never);

    expect(nova.notifications.titles()).toEqual(["No definition found."]);
  });
});

describe("find references", () => {
  it("fills the sidebar with the results", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const view = new ReferencesView();
    const locations = [location("/p/A.java", 3), location("/p/B.java", 10)];
    const c = fakeClient({ "textDocument/references": locations });

    await lsp.findReferences(c as never, editor as never, view);

    expect(c.requests[0].params).toMatchObject({
      context: { includeDeclaration: true },
    });
    expect(await nova.view("java.sidebar.references").rows()).toEqual([
      {
        name: "A.java",
        description: "Line 4",
        image: "__symbol.reference",
        command: "java.openLocation",
        children: [],
      },
      {
        name: "B.java",
        description: "Line 11",
        image: "__symbol.reference",
        command: "java.openLocation",
        children: [],
      },
    ]);
  });

  it("says so when there are none", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const view = new ReferencesView();
    const c = fakeClient({ "textDocument/references": null });

    await lsp.findReferences(c as never, editor as never, view);

    expect(nova.notifications.titles()).toEqual(["No references found."]);
    expect(await nova.view("java.sidebar.references").rows()).toEqual([]);
  });
});

describe("rename", () => {
  it("prompts, then applies the server's workspace edit", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    nova.workspace.inputResponses = ["B"];
    const c = fakeClient({
      "textDocument/rename": {
        changes: {
          "file:///p/A.java": [
            {
              range: {
                start: { line: 2, character: 6 },
                end: { line: 2, character: 7 },
              },
              newText: "B",
            },
          ],
        },
      },
    });

    await lsp.rename(c as never, editor as never);

    expect(c.requests[0].params).toMatchObject({ newName: "B" });
    expect(editor.text).toContain("class B {");
  });

  it("does not send a request when the prompt is cancelled", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    nova.workspace.inputResponses = [];
    const c = fakeClient({});

    await lsp.rename(c as never, editor as never);

    expect(c.requests).toHaveLength(0);
  });

  it("reports a symbol the server refuses to rename", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    nova.workspace.inputResponses = ["B"];
    const c = fakeClient({ "textDocument/rename": null });

    await lsp.rename(c as never, editor as never);

    expect(nova.notifications.titles()).toEqual(["Symbol cannot be renamed here."]);
  });
});

describe("formatting", () => {
  it("applies the server's edits and passes the editor's indentation", async () => {
    const editor = nova.openEditor("/p/A.java", "class A{}\n");
    editor.tabLength = 2;
    editor.softTabs = false;
    const c = fakeClient({
      "textDocument/formatting": [
        {
          range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } },
          newText: " ",
        },
      ],
    });

    await lsp.formatDocumentLsp(c as never, editor as never);

    expect(editor.text).toBe("class A {}\n");
    expect(c.requests[0].params).toMatchObject({
      options: { tabSize: 2, insertSpaces: false },
    });
  });

  it("discards edits computed against text that has since changed", async () => {
    // The format-on-save sequence: organize-imports rewrites the file, then
    // formatting is requested. If the server answers from the pre-organize
    // text, its positions describe a document that no longer exists.
    const editor = nova.openEditor("/p/A.java", "import java.io.*;\nimport java.math.*;\n");
    const c = fakeClient({
      "textDocument/formatting": () => {
        // Something else rewrites the document while the request is in flight.
        editor.document.text = "import java.io.*;\n";
        return [
          {
            range: { start: { line: 1, character: 6 }, end: { line: 1, character: 7 } },
            newText: "  ",
          },
        ];
      },
    });

    await lsp.formatDocumentLsp(c as never, editor as never);

    expect(editor.text).toBe("import java.io.*;\n");
    expect(editor.replacements).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it("does nothing when the server returns no edits", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const c = fakeClient({ "textDocument/formatting": null });

    await lsp.formatDocumentLsp(c as never, editor as never);

    expect(editor.replacements).toHaveLength(0);
  });

  it("formats a selection with rangeFormatting", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    editor.selectedRange = new FakeRange(12, 21);
    const c = fakeClient({ "textDocument/rangeFormatting": [] });

    await lsp.formatSelection(c as never, editor as never);

    expect(c.requests[0].method).toBe("textDocument/rangeFormatting");
    expect(c.requests[0].params).toMatchObject({
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 9 },
      },
    });
  });

  it("falls back to whole-document formatting with an empty selection", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const c = fakeClient({ "textDocument/formatting": [] });

    await lsp.formatSelection(c as never, editor as never);

    expect(c.requests[0].method).toBe("textDocument/formatting");
  });
});

describe("organize imports", () => {
  it("asks for the organizeImports action and applies its edit", async () => {
    const editor = nova.openEditor("/p/A.java", "import java.io.*;\nclass A {}\n");
    const c = fakeClient({
      "textDocument/codeAction": [
        { title: "Something else", kind: "quickfix" },
        {
          title: "Organize imports",
          kind: "source.organizeImports",
          edit: {
            changes: {
              "file:///p/A.java": [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 1, character: 0 },
                  },
                  newText: "",
                },
              ],
            },
          },
        },
      ],
    });

    await lsp.organizeImports(c as never, editor as never);

    expect(c.requests[0].params).toMatchObject({
      context: { only: ["source.organizeImports"] },
    });
    expect(editor.text).toBe("class A {}\n");
  });

  it("reports when the server offers nothing to organize", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const c = fakeClient({ "textDocument/codeAction": [] });

    await lsp.organizeImports(c as never, editor as never);

    expect(nova.notifications.titles()).toEqual(["Nothing to organize."]);
  });
});

describe("code actions", () => {
  it("offers the actions and runs the chosen one's command", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const c = fakeClient({
      "textDocument/codeAction": [
        { title: "Add import" },
        {
          title: "Generate getters",
          command: { command: "java.action.generate", arguments: [1], title: "gen" },
        },
      ],
      "workspace/executeCommand": null,
    });
    nova.workspace.choose = () => 1;

    await lsp.codeActions(c as never, editor as never);

    expect(nova.workspace.lastPrompt.choices).toEqual([
      "Add import",
      "Generate getters",
    ]);
    expect(c.requests[1]).toEqual({
      method: "workspace/executeCommand",
      params: { command: "java.action.generate", arguments: [1] },
    });
  });

  it("reports when there are none", async () => {
    const editor = nova.openEditor("/p/A.java", SOURCE);
    const c = fakeClient({ "textDocument/codeAction": null });

    await lsp.codeActions(c as never, editor as never);

    expect(nova.notifications.titles()).toEqual(["No code actions available here."]);
  });
});

describe("find workspace symbol", () => {
  it("queries, then reveals the chosen symbol", async () => {
    nova.openEditor("/p/A.java", SOURCE);
    nova.fs.writeFile("/p/B.java", "class B {}\n");
    nova.workspace.inputResponses = ["B"];
    nova.workspace.choose = () => 0;
    const c = fakeClient({
      "workspace/symbol": [
        { name: "B", kind: 5, containerName: "p", location: location("/p/B.java", 0, 6) },
      ],
    });

    await lsp.findWorkspaceSymbol(c as never);

    expect(c.requests[0].params).toEqual({ query: "B" });
    expect(nova.workspace.lastPrompt.choices).toEqual(["B — p"]);
    expect(nova.workspace.activeTextEditor!.document.path).toBe("/p/B.java");
  });

  it("reports an empty result", async () => {
    nova.workspace.inputResponses = ["Nope"];
    const c = fakeClient({ "workspace/symbol": [] });

    await lsp.findWorkspaceSymbol(c as never);

    expect(nova.notifications.titles()).toEqual(["No symbols found."]);
  });
});
