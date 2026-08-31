import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, installNova, NovaFake } from "./testing/nova";
import { formatDocument } from "./format";

let nova: NovaFake;

beforeEach(() => {
  nova = installNova();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const FORMAT_EDIT = {
  range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } },
  newText: " ",
};

describe("formatDocument", () => {
  it("uses the language server by default", async () => {
    const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");
    const client = fakeClient({ "textDocument/formatting": [FORMAT_EDIT] });

    await formatDocument(client as never, editor as never);

    expect(editor.text).toBe("class A {}\n");
    expect(nova.processes).toHaveLength(0);
  });

  describe("with the Spotless formatter selected", () => {
    beforeEach(() => {
      nova.config.set("java.format.formatter", "spotless");
    });

    it("runs the Gradle wrapper from the directory that owns it", async () => {
      nova.fs.writeFile("/Users/tester/project/gradlew", "");
      const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");
      const client = fakeClient({});

      await formatDocument(client as never, editor as never);

      expect(nova.processes).toEqual([
        {
          path: "/usr/bin/env",
          args: ["bash", "/Users/tester/project/gradlew", "spotlessApply"],
          cwd: "/Users/tester/project",
          env: undefined,
        },
      ]);
      expect(client.requests).toHaveLength(0);
    });

    it("points Gradle at the module when it is below the wrapper", async () => {
      nova.fs.writeFile("/Users/tester/project/gradlew", "");
      nova.fs.mkdirp("/Users/tester/project/app");
      nova.workspace.config.set("java.project.root", "app");
      const editor = nova.openEditor("/Users/tester/project/app/A.java", "class A{}\n");

      await formatDocument(fakeClient({}) as never, editor as never);

      expect(nova.processes[0].args).toEqual([
        "bash",
        "/Users/tester/project/gradlew",
        "-p",
        "/Users/tester/project/app",
        "spotlessApply",
      ]);
    });

    it("passes --offline when asked", async () => {
      nova.fs.writeFile("/Users/tester/project/gradlew", "");
      nova.config.set("java.format.spotlessOffline", true);
      const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");

      await formatDocument(fakeClient({}) as never, editor as never);

      expect(nova.processes[0].args).toContain("--offline");
    });

    it("reports a failing Spotless run and rejects", async () => {
      nova.fs.writeFile("/Users/tester/project/gradlew", "");
      nova.onProcess(() => ({ stderr: ["build failed", "Task :spotlessApply FAILED"], status: 1 }));
      const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");

      await expect(
        formatDocument(fakeClient({}) as never, editor as never),
      ).rejects.toThrow("Spotless exited with status 1");
      expect(nova.notifications.last().body).toBe("Task :spotlessApply FAILED");
    });

    it("explains that there is no Gradle wrapper", async () => {
      const editor = nova.openEditor("/Users/tester/project/A.java", "class A{}\n");

      await expect(
        formatDocument(fakeClient({}) as never, editor as never),
      ).rejects.toThrow();
      expect(nova.notifications.last().title).toContain("Cannot run Spotless");
      expect(nova.processes).toHaveLength(0);
    });
  });
});
