//
// LSP client for Java Language Server (Eclipse JDT.LS)
//

const Config = require("./config.js");
const State = require("./state.js");
const Paths = require("./paths.js");

var lspClient = null;

const flavorCustom = "custom";
const flavorAuto = "auto";
const flavorNone = "none";

function stopClient() {
  if (lspClient) {
    lspClient.stop();
    lspClient = null;
  }
}

function getConfig(key) {
  let value = nova.workspace?.config.get(key);
  if (value === null || value === undefined) {
    value = nova.config.get(key);
  }
  return value;
}

async function startClient() {
  let flavor = getConfig(Config.lspFlavor);
  if (flavor === flavorNone) {
    console.log("Java LSP is disabled");
    return null;
  }
  if (!flavor) {
    flavor = flavorAuto;
  }

  const javaHome = Paths.findJavaHome();
  if (!javaHome) {
    console.error("Java JDK not found. Please configure Java JDK Home in preferences.");
    nova.workspace.showErrorMessage("Java JDK not found. Please configure Java JDK Home in preferences.");
    return;
  }

  const javaExec = Paths.findJavaExecutable();
  let lspPath = getConfig(Config.lspPath);
  
  // Determine LSP server path
  if (flavor === flavorAuto) {
    // Use bundled or auto-installed jdtls
    // For now, expect user to have jdtls installed
    // Common locations: /usr/local/bin/jdtls or via homebrew
    lspPath = findJdtls();
  }

  if (!lspPath) {
    console.error("Java Language Server not found. Please install Eclipse JDT.LS or configure a custom path.");
    nova.workspace.showErrorMessage("Java Language Server (jdtls) not found. Please install it or configure the path in preferences.");
    return;
  }

  console.log("Starting Java Language Server with Java home:", javaHome);
  console.log("Language server path:", lspPath);

  // Prepare workspace data directory
  const workspacePath = nova.workspace.path || nova.path.expanduser("~");
  const workspaceName = nova.path.basename(workspacePath);
  const dataDir = nova.path.join(
    nova.extension.globalStoragePath,
    "workspaces",
    workspaceName
  );

  // Create data directory if it doesn't exist
  try {
    nova.fs.mkdir(dataDir);
  } catch (e) {
    // Directory might already exist
  }

  // Create server options
  // Check if lspPath is a script or JAR
  const isScript = lspPath.endsWith('jdtls') || !lspPath.endsWith('.jar');
  
  let serverOptions;
  if (isScript) {
    // jdtls is a wrapper script (e.g., from Homebrew)
    serverOptions = {
      path: lspPath,
      args: [
        "-configuration",
        getJdtlsConfigPath(),
        "-data",
        dataDir,
      ],
      env: {
        JAVA_HOME: javaHome,
      },
    };
  } else {
    // Direct JAR invocation
    serverOptions = {
      path: javaExec,
      args: [
        "-Declipse.application=org.eclipse.jdt.ls.core.id1",
        "-Dosgi.bundles.defaultStartLevel=4",
        "-Declipse.product=org.eclipse.jdt.ls.core.product",
        "-Dlog.level=ALL",
        "-noverify",
        "-Xmx1G",
        "-jar",
        lspPath,
        "-configuration",
        getJdtlsConfigPath(),
        "-data",
        dataDir,
      ],
      env: {
        JAVA_HOME: javaHome,
      },
    };
  }

  // Client options
  const clientOptions = {
    syntaxes: ["java"],
    initializationOptions: {
      bundles: [],
      workspaceFolders: [workspacePath],
      settings: {
        java: {
          home: javaHome,
          errors: {
            incompleteClasspath: {
              severity: "warning"
            }
          },
          configuration: {
            updateBuildConfiguration: "automatic"
          },
          format: {
            enabled: true
          },
          contentProvider: {
            preferred: "fernflower"
          },
          autobuild: {
            enabled: true
          },
          completion: {
            enabled: true,
            guessMethodArguments: true
          },
          signatureHelp: {
            enabled: true
          }
        }
      }
    }
  };

  // Create the client
  const client = new LanguageClient(
    "java-lsp",
    "Java Language Server",
    serverOptions,
    clientOptions
  );

  try {
    client.start();
    lspClient = client;
    console.log("Java Language Server started successfully");
    return client;
  } catch (err) {
    console.error("Failed to start Java Language Server:", err);
    return null;
  }
}

function findJdtls() {
  // Try common installation paths
  const commonPaths = [
    "/usr/local/bin/jdtls",
    "/opt/homebrew/bin/jdtls",
    "/usr/local/share/jdtls/plugins/org.eclipse.equinox.launcher_*.jar",
  ];

  for (const path of commonPaths) {
    if (path.includes("*")) {
      // Handle glob pattern for JAR file
      const dir = nova.path.dirname(path);
      const pattern = nova.path.basename(path);
      try {
        const files = nova.fs.listdir(dir);
        if (files) {
          const regex = new RegExp(pattern.replace("*", ".*"));
          for (const file of files) {
            if (regex.test(file)) {
              return nova.path.join(dir, file);
            }
          }
        }
      } catch (e) {
        // Directory doesn't exist, continue
      }
    } else if (nova.fs.access(path, nova.fs.F_OK)) {
      return path;
    }
  }

  // Try to find via PATH
  const pathEnv = nova.environment.PATH || "";
  const pathDirs = pathEnv.split(":");
  for (const dir of pathDirs) {
    const jdtlsPath = nova.path.join(dir, "jdtls");
    if (nova.fs.access(jdtlsPath, nova.fs.X_OK)) {
      return jdtlsPath;
    }
  }

  return null;
}

function getJdtlsConfigPath() {
  // Determine the configuration directory based on platform
  const isMac = nova.environment.HOME.includes("/Users/");
  
  // Try multiple ways to detect ARM architecture
  const hosttype = nova.environment.HOSTTYPE || "";
  const machine = nova.environment.MACHTYPE || "";
  
  // Check for ARM indicators
  const isArm = hosttype.includes("arm") || hosttype.includes("aarch") ||
                machine.includes("arm") || machine.includes("aarch");
  
  // If no env vars, try to detect from Homebrew path
  let detectedArm = isArm;
  if (!isArm && isMac) {
    // Homebrew on Apple Silicon is at /opt/homebrew
    // Homebrew on Intel is at /usr/local
    detectedArm = nova.fs.access("/opt/homebrew", nova.fs.F_OK);
  }
  
  let platform;
  if (isMac) {
    platform = detectedArm ? "config_mac_arm" : "config_mac";
  } else {
    platform = detectedArm ? "config_linux_arm" : "config_linux";
  }
  
  console.log(`Detected platform: ${platform} (HOSTTYPE=${hosttype}, MACHTYPE=${machine}, detected ARM: ${detectedArm})`);
  
  // Common jdtls installation paths
  const configPaths = [
    `/opt/homebrew/opt/jdtls/libexec/${platform}`,
    `/usr/local/opt/jdtls/libexec/${platform}`,
    `/usr/local/share/jdtls/${platform}`,
    `/opt/homebrew/share/jdtls/${platform}`,
    nova.path.join(nova.extension.path, "jdtls", platform),
  ];

  for (const path of configPaths) {
    if (nova.fs.access(path, nova.fs.F_OK)) {
      console.log("Found jdtls config at:", path);
      return path;
    }
  }

  // Fallback - try to detect from jdtls installation
  console.warn("Could not find jdtls config directory, using fallback");
  return `/opt/homebrew/opt/jdtls/libexec/${platform}`;
}

function restartClient() {
  stopClient();
  startClient();
}

function register() {
  State.emitter.on(State.events.onActivate, () => {
    startClient();
  });

  State.disposal.add(
    nova.config.onDidChange(Config.lspFlavor, () => {
      restartClient();
    })
  );

  State.disposal.add(
    nova.config.onDidChange(Config.lspPath, () => {
      restartClient();
    })
  );

  State.disposal.add(
    nova.config.onDidChange(Config.jdkHome, () => {
      restartClient();
    })
  );

  if (nova.workspace) {
    State.disposal.add(
      nova.workspace.config.onDidChange(Config.jdkHome, () => {
        restartClient();
      })
    );
  }

  nova.commands.register("java.restartServer", () => {
    restartClient();
  });

  nova.subscriptions.add({
    dispose: stopClient,
  });
}

function getClient() {
  return lspClient;
}

module.exports = {
  register,
  stopClient,
  startClient,
  getClient,
};
