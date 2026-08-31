/**
 * `client.stop()` asks the server to shut down over LSP, which a wedged or
 * mid-import JDT.LS ignores — and Nova does not escalate. The JVM then keeps
 * the Eclipse workspace lock on its `-data` directory and every later launch
 * comes up unable to take it. The launcher chain is all `exec`, so the JVM is
 * a single process we can signal directly.
 */

import { delay } from "./novaUtils";

const JDTLS_MARKER = "org.eclipse.jdt.ls.core.id1";
const TERM_GRACE_MS = 3000;
const POLL_MS = 250;

export async function reapOrphanedServers(dataDir: string): Promise<void> {
  let pids = await findServerPids(dataDir);
  if (pids.length === 0) return;

  console.warn(
    `Found ${pids.length} orphaned Java language server process(es) holding ` +
      `"${dataDir}": ${pids.join(", ")}. Terminating before restart.`,
  );
  await signal("TERM", pids);

  for (let waited = 0; waited < TERM_GRACE_MS; waited += POLL_MS) {
    await delay(POLL_MS);
    pids = await findServerPids(dataDir);
    if (pids.length === 0) return;
  }

  console.warn(`Orphans ${pids.join(", ")} ignored SIGTERM; sending SIGKILL.`);
  await signal("KILL", pids);
  await delay(POLL_MS);

  const survivors = await findServerPids(dataDir);
  if (survivors.length > 0) {
    console.error(
      `Could not terminate Java language server process(es): ${survivors.join(", ")}.`,
    );
  }
}

// Matching marker *and* data directory keeps another project's server from
// ever being a candidate. Matched in JS so no shell reads the path as a pattern.
async function findServerPids(dataDir: string): Promise<string[]> {
  const output = await runCommand("/bin/ps", ["-Ao", "pid=,command="]);
  const pids: string[] = [];
  for (const line of output.split("\n")) {
    if (!line.includes(JDTLS_MARKER)) continue;
    if (!line.includes(`-data ${dataDir}`)) continue;
    const pid = line.trim().split(/\s+/)[0];
    if (/^\d+$/.test(pid)) pids.push(pid);
  }
  return pids;
}

async function signal(name: "TERM" | "KILL", pids: string[]): Promise<void> {
  try {
    await runCommand("/bin/kill", [`-${name}`, ...pids]);
  } catch (err) {
    console.log(`kill -${name} ${pids.join(" ")}: ${String(err)}`);
  }
}

function runCommand(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    try {
      const process = new Process(path, {
        args,
        stdio: ["ignore", "pipe", "ignore"],
      });
      process.onStdout((line) => {
        out += line;
      });
      process.onDidExit(() => resolve(out));
      process.start();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
