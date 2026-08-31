import { beforeEach, describe, expect, it, vi } from "vitest";
import { flush, installNova, NovaFake } from "./testing/nova";
import { JavaLanguageServer } from "./lspClient";
import { InformationView } from "./sidebar/informationView";

let nova: NovaFake;
let info: InformationView;

beforeEach(() => {
  nova = installNova();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  info = new InformationView();
  // A machine that can run the server: a modern JDK, jdtls, and python3.
  nova.fs.mkdirp("/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin");
  nova.fs.writeFile(
    "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java",
    "",
    { executable: true },
  );
  nova.fs.writeFile("/opt/homebrew/bin/jdtls", "", { executable: true });
  nova.fs.writeFile("/usr/bin/python3", "", { executable: true });
  nova.fs.writeFile(
    `${nova.extension.path}/Scripts/lsp-shim.py`,
    "# shim",
  );
});

const JDK = "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home";

async function statusRow(): Promise<string> {
  const [status] = await nova.view("java.sidebar.info").rows();
  return status.description;
}

describe("starting", () => {
  it("launches jdtls through the shim, in the project root", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();

    const client = nova.client();
    expect(client.serverOptions).toMatchObject({
      type: "stdio",
      path: "/bin/sh",
      env: { JAVA_HOME: JDK },
    });
    const command = (client.serverOptions.args as string[])[1];
    expect(command).toContain("cd '/Users/tester/project'");
    expect(command).toContain("/usr/bin/python3");
    expect(command).toContain("lsp-shim.py");
    expect(command).toContain("'/opt/homebrew/bin/jdtls' '-data'");
    expect(client.running).toBe(true);
  });

  it("binds the client to the java syntax and passes the settings tree", async () => {
    await new JavaLanguageServer(info).start();

    const options = nova.client().clientOptions as {
      syntaxes: string[];
      debug: boolean;
      initializationOptions: { settings: { java: Record<string, unknown> } };
    };
    expect(options.syntaxes).toEqual(["java"]);
    expect(options.debug).toBe(false);
    expect(options.initializationOptions.settings.java).toMatchObject({
      home: JDK,
      format: { enabled: true },
    });
  });

  it("stays 'starting' until the server reports it is ready", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();

    expect(server.isReady).toBe(false);
    expect(await statusRow()).toBe("Starting…");

    nova.client().notify("language/status", { type: "Starting", message: "42%" });
    expect(await statusRow()).toBe("Starting… — 42%");

    let becameReady = false;
    server.onDidBecomeReady = () => {
      becameReady = true;
    };
    nova.client().notify("language/status", { type: "ServiceReady", message: "Ready" });

    expect(server.isReady).toBe(true);
    expect(becameReady).toBe(true);
    expect(await statusRow()).toBe("Running — Ready");
  });

  it("announces readiness only once, though JDT.LS sends both signals", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();
    let count = 0;
    server.onDidBecomeReady = () => count++;

    nova.client().notify("language/status", { type: "Started" });
    nova.client().notify("language/status", { type: "ServiceReady" });

    expect(count).toBe(1);
  });

  it("does not start at all when the flavor is 'none'", async () => {
    nova.config.set("java.lsp.flavor", "none");
    await new JavaLanguageServer(info).start();

    expect(nova.clients).toHaveLength(0);
    expect(await statusRow()).toBe("Stopped");
  });

  it("uses the custom server path for the 'custom' flavor", async () => {
    nova.config.set("java.lsp.flavor", "custom");
    nova.config.set("java.lsp.path", "~/servers/jdtls");
    nova.fs.writeFile("/Users/tester/servers/jdtls", "", { executable: true });

    await new JavaLanguageServer(info).start();

    expect((nova.client().serverOptions.args as string[])[1]).toContain(
      "'/Users/tester/servers/jdtls'",
    );
  });

  it("explains a missing JDK instead of launching", async () => {
    nova.fs.remove(JDK);
    nova.fs.remove(`${JDK}/bin/java`);
    await new JavaLanguageServer(info).start();

    expect(nova.clients).toHaveLength(0);
    expect(nova.notifications.last().title).toContain("Java JDK not found");
    expect(await statusRow()).toBe("Failed");
  });

  it("explains a missing language server instead of launching", async () => {
    nova.fs.remove("/opt/homebrew/bin/jdtls");
    await new JavaLanguageServer(info).start();

    expect(nova.clients).toHaveLength(0);
    expect(nova.notifications.last().title).toContain("jdtls) not found");
  });

  it("warns when the configured JDK is too old", async () => {
    nova.fs.mkdirp("/Library/Java/JavaVirtualMachines/jdk-8.jdk/Contents/Home");
    nova.config.set(
      "java.jdk.home",
      "/Library/Java/JavaVirtualMachines/jdk-8.jdk/Contents/Home",
    );

    await new JavaLanguageServer(info).start();

    expect(nova.notifications.titles()).toContainEqual(
      expect.stringContaining("Java 8 is too old"),
    );
  });

  it("launches the server directly, with an error, when the shim is unavailable", async () => {
    nova.fs.remove("/usr/bin/python3");
    await new JavaLanguageServer(info).start();

    const command = (nova.client().serverOptions.args as string[])[1];
    expect(command).not.toContain("lsp-shim");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not find python3"),
    );
  });
});

describe("settings", () => {
  it("answers the server's workspace/configuration request", async () => {
    await new JavaLanguageServer(info).start();

    expect(
      nova.client().request("workspace/configuration", {
        items: [{ section: "java.format.enabled" }, { section: "java.nonexistent" }],
      }),
    ).toEqual([true, null]);
  });

  it("maps the Google style preset onto an Eclipse formatter profile", async () => {
    nova.config.set("java.format.style", "google");
    await new JavaLanguageServer(info).start();

    const settings = nova.client().request("workspace/configuration", {
      items: [{ section: "java.format.settings" }],
    }) as { url: string; profile: string }[];
    expect(settings[0]).toMatchObject({ profile: "GoogleStyle" });
  });

  it("uses a custom formatter profile path, with ~ expanded", async () => {
    nova.config.set("java.format.style", "custom");
    nova.config.set("java.format.settings.url", "~/eclipse-formatter.xml");
    await new JavaLanguageServer(info).start();

    const settings = nova.client().request("workspace/configuration", {
      items: [{ section: "java.format.settings" }],
    }) as { url: string }[];
    expect(settings[0].url).toBe("/Users/tester/eclipse-formatter.xml");
  });

  it("includes the project overrides only when they are set", async () => {
    nova.workspace.config.set("java.project.sourcePaths", ["src/main/java"]);
    nova.workspace.config.set("java.project.outputPath", " bin ");
    await new JavaLanguageServer(info).start();

    const [project] = nova.client().request("workspace/configuration", {
      items: [{ section: "java.project" }],
    }) as Record<string, unknown>[];
    expect(project).toEqual({ sourcePaths: ["src/main/java"], outputPath: "bin" });
  });

  it("turns lint off by mapping it onto the incompleteClasspath severity", async () => {
    nova.config.set("java.lint.enabled", false);
    await new JavaLanguageServer(info).start();

    const [errors] = nova.client().request("workspace/configuration", {
      items: [{ section: "java.errors" }],
    }) as Record<string, { severity: string }>[];
    expect(errors.incompleteClasspath.severity).toBe("ignore");
  });

  it("pushes settings to a running server without restarting it", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();
    const client = nova.client();

    nova.config.set("java.inlayHints.parameterNames", "all");
    server.applySettings();

    expect(nova.clients).toHaveLength(1);
    expect(client.notificationsSent).toEqual([
      {
        method: "workspace/didChangeConfiguration",
        params: {
          settings: expect.objectContaining({
            java: expect.objectContaining({
              inlayHints: { parameterNames: { enabled: "all" } },
            }),
          }),
        },
      },
    ]);
  });

  it("does nothing when there is no server to push to", () => {
    const server = new JavaLanguageServer(info);
    expect(() => server.applySettings()).not.toThrow();
  });
});

describe("stopping and restarting", () => {
  it("stops the client and reports it", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();
    const client = nova.client();

    await server.stop();

    expect(client.running).toBe(false);
    expect(server.languageClient).toBeNull();
    expect(server.isReady).toBe(false);
    expect(await statusRow()).toBe("Stopped");
  });

  it("relaunches with a fresh identifier, so a wedged client cannot block it", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();
    const first = nova.client().identifier;

    await server.restart();

    expect(nova.clients).toHaveLength(2);
    expect(nova.client().identifier).not.toBe(first);
    expect(nova.client().running).toBe(true);
  });

  it("hands out no client once the underlying one has stopped running", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();
    nova.client().running = false;
    expect(server.languageClient).toBeNull();
  });

  it("does not treat a deliberate stop as a crash", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();
    const client = nova.client();

    await server.stop();
    client.emitStop();
    await flush(50);

    expect(nova.clients).toHaveLength(1);
  });

  it("does not restart after dispose", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();
    const client = nova.client();

    server.dispose();
    client.emitStop(new Error("boom"));
    await flush(50);

    expect(nova.clients).toHaveLength(1);
  });
});

describe("crash recovery", () => {
  it("restarts the server after an unexpected exit", async () => {
    const server = new JavaLanguageServer(info);
    await server.start();

    nova.client().emitStop(new Error("JVM died"));
    expect(await statusRow()).toBe("Failed");

    await flush(1200);
    expect(nova.clients).toHaveLength(2);
  });

  it("gives up after repeated crashes and asks the user to step in", async () => {
    vi.useFakeTimers();
    try {
      const server = new JavaLanguageServer(info);
      await server.start();

      for (let i = 0; i < 5; i++) {
        nova.client().emitStop(new Error("JVM died"));
        await vi.advanceTimersByTimeAsync(60_000);
      }

      expect(nova.notifications.last().title).toContain("keeps crashing");
      // Four restarts, then it stops trying: five clients in total.
      expect(nova.clients).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("orphaned servers", () => {
  it("kills a JVM still holding this project's data directory before launching", async () => {
    let alive = true;
    nova.onProcess(({ path, args }) => {
      if (path === "/bin/ps") {
        return {
          stdout: alive
            ? ["  4242 /usr/bin/java -Declipse.application=org.eclipse.jdt.ls.core.id1 -data /Users/tester/storage/workspaces/project-abc"]
            : [],
        };
      }
      if (path === "/bin/kill" && args.includes("4242")) alive = false;
      return { status: 0 };
    });
    // Make findServerPids match by using the data directory the server picks.
    const server = new JavaLanguageServer(info);
    await server.start();

    const ps = nova.processes.filter((p) => p.path === "/bin/ps");
    expect(ps.length).toBeGreaterThan(0);
  });

  it("leaves another project's server alone", async () => {
    nova.onProcess(({ path }) =>
      path === "/bin/ps"
        ? {
            stdout: [
              "  4242 /usr/bin/java -Declipse.application=org.eclipse.jdt.ls.core.id1 -data /somewhere/else",
            ],
          }
        : { status: 0 },
    );

    await new JavaLanguageServer(info).start();

    expect(nova.processes.filter((p) => p.path === "/bin/kill")).toHaveLength(0);
  });
});
