import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, flush, installNova, NovaFake } from "../testing/nova";
import { setRevealClient } from "../reveal";
import { InformationView } from "./informationView";
import { ReferencesView } from "./referencesView";
import { SymbolsView, SymbolNode } from "./symbolsView";

let nova: NovaFake;

beforeEach(() => {
  nova = installNova();
  setRevealClient(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("InformationView", () => {
  it("shows the server status with its own progress message", async () => {
    const view = new InformationView();
    view.setStatus("starting", "63% Importing…");
    view.setJavaHome("/jdk-21");
    view.setServerPath("/opt/homebrew/bin/jdtls");
    view.setProjectRoot("/p");
    view.setGradleWrapper("/p/gradlew");

    const rows = await nova.view("java.sidebar.info").rows();
    expect(rows.map((r) => [r.name, r.description])).toEqual([
      ["Status", "Starting… — 63% Importing…"],
      ["JDK", "/jdk-21"],
      ["Language server", "/opt/homebrew/bin/jdtls"],
      ["Project root", "/p"],
      ["Gradle wrapper", "/p/gradlew"],
    ]);
    expect(rows[0].image).toBe("status-starting");
  });

  it("starts stopped, with everything unknown", async () => {
    new InformationView();
    const rows = await nova.view("java.sidebar.info").rows();
    expect(rows[0].description).toBe("Stopped");
    expect(rows.slice(1).map((r) => r.description)).toEqual(["—", "—", "—", "—"]);
  });

  it("reloads the tree whenever a field changes", async () => {
    const view = new InformationView();
    const tree = nova.view("java.sidebar.info");
    const before = tree.reloads;
    view.setStatus("running");
    view.setJavaHome("/jdk-21");
    expect(tree.reloads).toBe(before + 2);
  });
});

describe("ReferencesView", () => {
  it("opens the selected reference", async () => {
    const view = new ReferencesView();
    nova.fs.writeFile("/p/B.java", "class B {}\n");
    const location = {
      uri: "file:///p/B.java",
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
    };
    view.show([location]);
    await flush();

    nova.view("java.sidebar.references").select(location);
    await view.openSelected();

    expect(nova.workspace.activeTextEditor!.document.path).toBe("/p/B.java");
    expect(nova.workspace.activeTextEditor!.selectedRange.start).toBe(6);
  });

  it("reveals the first result so the list scrolls into view", async () => {
    const view = new ReferencesView();
    const first = {
      uri: "file:///p/A.java",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    };
    view.show([first, { ...first, uri: "file:///p/B.java" }]);
    await flush();
    expect(nova.view("java.sidebar.references").revealed).toEqual([first]);
  });

  it("does nothing when nothing is selected", async () => {
    const view = new ReferencesView();
    await expect(view.openSelected()).resolves.toBeUndefined();
  });
});

describe("SymbolsView", () => {
  const DOCUMENT_SYMBOLS = [
    {
      name: "A",
      detail: "class",
      kind: 5,
      range: { start: { line: 0, character: 0 }, end: { line: 4, character: 1 } },
      selectionRange: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
      children: [
        {
          name: "go()",
          detail: "void",
          kind: 6,
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 15 } },
          selectionRange: {
            start: { line: 1, character: 7 },
            end: { line: 1, character: 9 },
          },
        },
      ],
    },
  ];

  function view(responses: Record<string, unknown>) {
    const client = fakeClient(responses);
    return { view: new SymbolsView(() => client as never), client };
  }

  it("loads the active file's symbols as a tree", async () => {
    nova.openEditor("/p/A.java", "class A {\n  void go() {}\n}\n");
    const { view: symbols } = view({ "textDocument/documentSymbol": DOCUMENT_SYMBOLS });

    symbols.refresh();
    await flush(250);

    expect(await nova.view("java.sidebar.symbols").rows()).toEqual([
      {
        name: "A",
        description: "class",
        image: "__symbol.class",
        command: "java.openSymbol",
        children: [
          {
            name: "go()",
            description: "void",
            image: "__symbol.method",
            command: "java.openSymbol",
            children: [],
          },
        ],
      },
    ]);
  });

  it("flattens the SymbolInformation shape some servers return", async () => {
    nova.openEditor("/p/A.java", "class A {}\n");
    const { view: symbols } = view({
      "textDocument/documentSymbol": [
        {
          name: "A",
          kind: 5,
          containerName: "p",
          location: {
            uri: "file:///p/A.java",
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 7 },
            },
          },
        },
      ],
    });

    symbols.refresh();
    await flush(250);

    const rows = await nova.view("java.sidebar.symbols").rows();
    expect(rows).toEqual([
      {
        name: "A",
        description: "p",
        image: "__symbol.class",
        command: "java.openSymbol",
        children: [],
      },
    ]);
  });

  it("coalesces a burst of refreshes into one request", async () => {
    nova.openEditor("/p/A.java", "class A {}\n");
    const { view: symbols, client } = view({
      "textDocument/documentSymbol": DOCUMENT_SYMBOLS,
    });

    symbols.refresh();
    symbols.refresh();
    symbols.refresh();
    await flush(250);

    expect(client.requests).toHaveLength(1);
  });

  it("skips the request when the file it already describes is still active", async () => {
    nova.openEditor("/p/A.java", "class A {}\n");
    const { view: symbols, client } = view({
      "textDocument/documentSymbol": DOCUMENT_SYMBOLS,
    });

    symbols.refresh();
    await flush(250);
    symbols.refresh();
    await flush(250);

    expect(client.requests).toHaveLength(1);
  });

  it("reloads anyway when forced, as an edit or save does", async () => {
    nova.openEditor("/p/A.java", "class A {}\n");
    const { view: symbols, client } = view({
      "textDocument/documentSymbol": DOCUMENT_SYMBOLS,
    });

    symbols.refresh();
    await flush(250);
    symbols.refresh(true);
    await flush(250);

    expect(client.requests).toHaveLength(2);
  });

  it("empties itself for a non-Java editor", async () => {
    nova.openEditor("/p/notes.md", "# hi\n", "markdown");
    const { view: symbols, client } = view({});

    symbols.refresh();
    await flush(250);

    expect(client.requests).toHaveLength(0);
    expect(await nova.view("java.sidebar.symbols").rows()).toEqual([]);
  });

  it("empties itself when there is no client", async () => {
    nova.openEditor("/p/A.java", "class A {}\n");
    const symbols = new SymbolsView(() => null);

    symbols.refresh();
    await flush(250);

    expect(await nova.view("java.sidebar.symbols").rows()).toEqual([]);
  });

  it("keeps the tree empty when the server refuses the request", async () => {
    nova.openEditor("/p/A.java", "class A {}\n");
    const { view: symbols } = view({
      "textDocument/documentSymbol": () => {
        throw new Error("server is still importing");
      },
    });

    symbols.refresh();
    await flush(250);

    expect(await nova.view("java.sidebar.symbols").rows()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("opens the selected symbol at its name", async () => {
    nova.openEditor("/p/A.java", "class A {\n  void go() {}\n}\n");
    const { view: symbols } = view({ "textDocument/documentSymbol": DOCUMENT_SYMBOLS });
    symbols.refresh();
    await flush(250);

    const tree = nova.view<SymbolNode>("java.sidebar.symbols");
    const [root] = tree.provider.getChildren(null) as SymbolNode[];
    tree.select(root.children[0]);
    await symbols.openSelected();

    const editor = nova.workspace.activeTextEditor!;
    expect(editor.document.path).toBe("/p/A.java");
    // Line 1, character 7 → the name "go".
    expect(editor.document.text.slice(editor.selectedRange.start, editor.selectedRange.end)).toBe(
      "go",
    );
  });
});
