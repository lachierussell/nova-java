import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, installNova, NovaFake } from "./testing/nova";
import { revealLocation, setRevealClient } from "./reveal";

let nova: NovaFake;

beforeEach(() => {
  nova = installNova();
  setRevealClient(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const range = {
  start: { line: 0, character: 6 },
  end: { line: 0, character: 7 },
};

describe("revealLocation", () => {
  it("opens a file:// location and selects the range", async () => {
    nova.fs.writeFile("/p/B.java", "class B {}\n");

    await revealLocation({ uri: "file:///p/B.java", range });

    const editor = nova.workspace.activeTextEditor!;
    expect(editor.document.path).toBe("/p/B.java");
    expect([editor.selectedRange.start, editor.selectedRange.end]).toEqual([6, 7]);
    expect(editor.scrolledTo).toBe(6);
  });

  it("percent-decodes a path with spaces", async () => {
    nova.fs.writeFile("/p/My Project/B.java", "class B {}\n");

    await revealLocation({ uri: "file:///p/My%20Project/B.java", range });

    expect(nova.workspace.activeTextEditor!.document.path).toBe("/p/My Project/B.java");
  });

  it("materialises a jdt: location from the server's decompiled source", async () => {
    const uri = "jdt://contents/rt.jar/java.lang/String.class?=proj";
    setRevealClient(
      fakeClient({ "java/classFileContents": "package java.lang;\nclass String {}\n" }) as never,
    );

    await revealLocation({ uri, range });

    const editor = nova.workspace.activeTextEditor!;
    expect(editor.document.path).toMatch(/\/classfiles\/String-[a-z0-9]+\.java$/);
    expect(editor.text).toBe("package java.lang;\nclass String {}\n");
  });

  it("reuses one file per jdt: uri, so repeated jumps do not pile up tabs", async () => {
    const uri = "jdt://contents/rt.jar/java.lang/String.class?=proj";
    setRevealClient(fakeClient({ "java/classFileContents": "class String {}\n" }) as never);

    await revealLocation({ uri, range });
    await revealLocation({ uri, range });

    expect(nova.workspace.textEditors).toHaveLength(1);
  });

  it("explains that library sources need a running server", async () => {
    await revealLocation({ uri: "jdt://contents/rt.jar/java.lang/String.class", range });

    expect(nova.notifications.last().title).toBe("Cannot open library sources");
    expect(nova.workspace.textEditors).toHaveLength(0);
  });

  it("reports a class the server cannot decompile", async () => {
    setRevealClient(fakeClient({ "java/classFileContents": null }) as never);

    await revealLocation({ uri: "jdt://contents/x/A.class", range });

    expect(nova.notifications.last().title).toBe("No sources available");
  });

  it("survives a failing classFileContents request", async () => {
    setRevealClient(
      fakeClient({
        "java/classFileContents": () => {
          throw new Error("no such class");
        },
      }) as never,
    );

    await revealLocation({ uri: "jdt://contents/x/A.class", range });

    expect(nova.notifications.last().title).toBe("No sources available");
    expect(console.error).toHaveBeenCalled();
  });

  it("declines a scheme it cannot open", async () => {
    await revealLocation({ uri: "https://example.com/A.java", range });

    expect(nova.notifications.last().title).toBe("Cannot open that location");
  });
});
