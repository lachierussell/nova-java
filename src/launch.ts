import { config, getConfig } from "./config";
import { findJavaExecutable, findJdtlsConfigPath, findPython } from "./paths";

export function buildServerOptions(
  serverPath: string,
  javaHome: string,
  projectRoot: string,
  dataDir: string,
): ServerOptions {
  const command = serverArgv(serverPath, dataDir).map(shellQuote).join(" ");

  // ServerOptions has no `cwd`, and JDT.LS resolves relative build files
  // against the working directory.
  return {
    type: "stdio",
    path: "/bin/sh",
    args: [
      "-c",
      `cd ${shellQuote(projectRoot)} && ${wrapWithShim(command, dataDir)}`,
    ],
    env: { JAVA_HOME: javaHome },
  };
}

function serverArgv(serverPath: string, dataDir: string): string[] {
  const isScript = serverPath.endsWith("jdtls") || !serverPath.endsWith(".jar");
  if (isScript) {
    // No `-configuration`: the script sets its own, and overriding it points
    // Equinox inside the read-only install prefix.
    return [serverPath, "-data", dataDir];
  }

  const configPath = findJdtlsConfigPath(serverPath);
  return [
    findJavaExecutable(),
    "-Declipse.application=org.eclipse.jdt.ls.core.id1",
    "-Dosgi.bundles.defaultStartLevel=4",
    "-Declipse.product=org.eclipse.jdt.ls.core.product",
    "-Dlog.level=ALL",
    "-Xmx1G",
    "--add-modules=ALL-SYSTEM",
    "--add-opens",
    "java.base/java.util=ALL-UNNAMED",
    "--add-opens",
    "java.base/java.lang=ALL-UNNAMED",
    "-jar",
    serverPath,
    ...(configPath ? ["-configuration", configPath] : []),
    "-data",
    dataDir,
  ];
}

/**
 * Nova advertises `dynamicRegistration: true` for hover, completion, definition
 * and friends, then ignores the `client/registerCapability` calls JDT.LS
 * answers with, so it never sends those requests. The shim clears the flags in
 * transit, forcing static capabilities. It also reaps the JVM.
 */
function wrapWithShim(command: string, dataDir: string): string {
  const python = findPython();
  const shim = nova.path.join(nova.extension.path, "Scripts", "lsp-shim.py");

  if (!python || !nova.fs.access(shim, nova.fs.F_OK)) {
    console.error(
      "Could not find python3 or the LSP shim; launching the server " +
        "directly. Hover, completion and go-to-definition will not work, " +
        "because Nova ignores this server's dynamic capability registrations.",
    );
    return `exec ${command}`;
  }

  const tracing = getConfig<boolean>(config.logServerTrace) === true;
  if (tracing) console.log(`Logging LSP traffic to ${dataDir}/lsp-*.log`);
  const log = tracing ? ` --log ${shellQuote(dataDir)}` : "";

  return `exec ${shellQuote(python)} ${shellQuote(shim)}${log} -- ${command}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
