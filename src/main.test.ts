import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, installNova, NovaFake } from "./testing/nova";

let nova: NovaFake;
let extension: typeof import("./main");

beforeEach(async () => {
  nova = installNova();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  // A machine that can run the server.
  const jdk = "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home";
  nova.fs.writeFile(`${jdk}/bin/java`, "", { executable: true });
  nova.fs.writeFile("/opt/homebrew/bin/jdtls", "", { executable: true });
  nova.fs.writeFile("/usr/bin/python3", "", { executable: true });
  nova.fs.writeFile(`${nova.extension.path}/Scripts/lsp-shim.py`, "# shim");

  // main.ts keeps module-level state, so each test needs a fresh copy.
  vi.resetModules();
  extension = await import("./main");
});

afterEach(() => {
  extension.deactivate();
});

/** Activate and drive the language server through to ready. */
async function activateReady() {
  extension.activate();
  await flush();
  nova.client().becomeReady();
  return nova.client();
}

describe("activation", () => {
  it("registers every command the manifest declares", async () => {
    await activateReady();

    expect(nova.commands.names().sort()).toEqual([
      "java.codeActions",
      "java.extensionPreferences",
      "java.findReferences",
      "java.findSymbols",
      "java.formatFile",
      "java.formatSelection",
      "java.jumpToDefinition",
      "java.jumpToImplementation",
      "java.jumpToTypeDefinition",
      "java.openLocation",
      "java.openSymbol",
      "java.organizeImports",
      "java.preferences",
      "java.renameSymbol",
      "java.restartServer",
    ]);
  });

  it("creates the three sidebar sections and starts the server", async () => {
    await activateReady();

    expect(() => nova.view("java.sidebar.info")).not.toThrow();
    expect(() => nova.view("java.sidebar.references")).not.toThrow();
    expect(() => nova.view("java.sidebar.symbols")).not.toThrow();
    expect(nova.clients).toHaveLength(1);
  });

  it("loads the symbols sidebar once the server becomes ready", async () => {
    const client = await activateReady();
    nova.openEditor("/Users/tester/project/A.java", "class A {}\n");
    client.respond = () => [
      {
        name: "A",
        kind: 5,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 7 },
        },
      },
    ];

    await flush(250);

    const rows = await nova.view("java.sidebar.symbols").rows();
    expect(rows.map((r) => r.name)).toEqual(["A"]);
  });

  it("tears everything down on deactivate", async () => {
    await activateReady();
    const client = nova.client();

    extension.deactivate();

    expect(client.running).toBe(false);
    expect(nova.view("java.sidebar.info").disposed).toBe(true);
    expect(nova.commands.names()).toEqual([]);
  });
});

describe("commands", () => {
  it("runs an editor command against the live client", async () => {
    const client = await activateReady();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");
    client.respond = () => [
      {
        range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } },
        newText: " ",
      },
    ];

    await nova.commands.invoke("java.formatFile", editor);
    await flush();

    expect(editor.text).toBe("class A {}\n");
  });

  it("tells the user the server is still importing rather than answering emptily", async () => {
    extension.activate();
    await flush();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");

    await nova.commands.invoke("java.jumpToDefinition", editor);
    await flush();

    expect(nova.notifications.last().title).toBe(
      "The Java language server is still starting",
    );
    expect(nova.client().requests).toHaveLength(0);
  });

  it("says the server is not running when it never started", async () => {
    nova.config.set("java.lsp.flavor", "none");
    extension.activate();
    await flush();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");

    await nova.commands.invoke("java.renameSymbol", editor);
    await flush();

    expect(nova.notifications.last().title).toBe(
      "The Java language server is not running.",
    );
  });

  it("surfaces a failing command as a notification instead of losing it", async () => {
    const client = await activateReady();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");
    client.respond = () => {
      throw new Error("server exploded");
    };

    await nova.commands.invoke("java.formatFile", editor);
    await flush();

    expect(nova.notifications.last()).toMatchObject({
      title: "⚠︎ Java command failed",
      body: "server exploded",
    });
  });

  it("restarts the server on demand", async () => {
    await activateReady();

    await nova.commands.invoke("java.restartServer");
    await flush(1200);

    expect(nova.clients).toHaveLength(2);
  });

  it("opens the settings panes", async () => {
    await activateReady();
    await nova.commands.invoke("java.preferences");
    expect(nova.workspace.openedConfigs).toBe(1);
  });
});

describe("save hooks", () => {
  const ORGANIZED = {
    changes: {
      "file:///Users/tester/project/A.java": [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
          newText: "",
        },
      ],
    },
  };

  it("does nothing on save by default", async () => {
    const client = await activateReady();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");

    await editor.save();

    expect(client.requests).toHaveLength(0);
  });

  it("organizes imports on save when enabled", async () => {
    const client = await activateReady();
    const editor = nova.openEditor(
      "/Users/tester/project/A.java",
      "import java.io.*;\nclass A {}\n",
    );
    nova.config.set("java.format.organizeImportsOnSave", true);
    client.respond = (method) =>
      method === "textDocument/codeAction"
        ? [{ title: "Organize", kind: "source.organizeImports", edit: ORGANIZED }]
        : null;

    await editor.save();

    expect(editor.text).toBe("class A {}\n");
  });

  it("formats after organizing, so the server sees the organized text", async () => {
    const client = await activateReady();
    const editor = nova.openEditor(
      "/Users/tester/project/A.java",
      "import java.io.*;\nclass A{}\n",
    );
    nova.config.set("java.format.organizeImportsOnSave", true);
    nova.config.set("java.format.onSave", true);
    client.respond = (method) => {
      if (method === "textDocument/codeAction") {
        return [{ title: "Organize", kind: "source.organizeImports", edit: ORGANIZED }];
      }
      // Positions here describe the post-organize text: "class A{}".
      return [
        {
          range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } },
          newText: " ",
        },
      ];
    };

    await editor.save();

    expect(editor.text).toBe("class A {}\n");
    expect(client.requests.map((r) => r.method)).toEqual([
      "textDocument/codeAction",
      "textDocument/formatting",
    ]);
  });

  it("lets a workspace setting override the global one", async () => {
    const client = await activateReady();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");
    nova.config.set("java.format.onSave", true);
    nova.workspace.config.set("java.format.onSave", false);
    client.respond = () => [];

    await editor.save();

    expect(client.requests).toHaveLength(0);
  });

  it("never lets a formatting failure abort the save", async () => {
    const client = await activateReady();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");
    nova.config.set("java.format.onSave", true);
    client.respond = () => {
      throw new Error("server exploded");
    };

    await expect(editor.save()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("format-on-save failed"),
      expect.anything(),
    );
  });

  it("ignores non-Java editors", async () => {
    const client = await activateReady();
    const editor = nova.openEditor("/Users/tester/project/notes.md", "# hi\n", "markdown");
    nova.config.set("java.format.onSave", true);

    await editor.save();

    expect(client.requests).toHaveLength(0);
  });
});

describe("settings changes", () => {
  it("restarts the server when a launch setting changes", async () => {
    await activateReady();

    nova.config.set("java.jdk.home", "/somewhere/else");
    await flush(1800);

    expect(nova.clients).toHaveLength(2);
  });

  it("restarts only once for a burst of edits", async () => {
    await activateReady();

    nova.config.set("java.jdk.home", "/a");
    nova.config.set("java.project.root", "server");
    nova.config.set("java.lsp.path", "/b");
    await flush(1800);

    expect(nova.clients).toHaveLength(2);
  });

  it("does not restart when a setting is rewritten to the same value", async () => {
    await activateReady();

    nova.config.set("java.jdk.home", "/a");
    await flush(1800);
    nova.config.set("java.jdk.home", "/a");
    await flush(1800);

    expect(nova.clients).toHaveLength(2);
  });

  it("pushes a live setting to the running server instead of restarting", async () => {
    const client = await activateReady();

    nova.config.set("java.inlayHints.parameterNames", "all");
    await flush(50);

    expect(nova.clients).toHaveLength(1);
    expect(client.notificationsSent.map((n) => n.method)).toEqual([
      "workspace/didChangeConfiguration",
    ]);
  });
});

describe("symbols sidebar tracking", () => {
  it("follows the active editor as the selection moves", async () => {
    const client = await activateReady();
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A {}\n");
    client.respond = () => [
      {
        name: "A",
        kind: 5,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      },
    ];
    await flush(250);

    const before = client.requests.length;
    editor.onDidChangeSelectionEmitter.emit(editor);
    await flush(250);

    // The file on screen has not changed, so no new request is needed.
    expect(client.requests).toHaveLength(before);

    editor.onDidSaveEmitter.emit(editor);
    await flush(250);
    expect(client.requests.length).toBeGreaterThan(before);
  });
});
