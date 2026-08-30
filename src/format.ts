/**
 * Document formatting: either the Eclipse JDT language server or Gradle
 * Spotless, depending on the `java.format.formatter` setting.
 */
import { config, getConfig } from "./config";
import { findGradleWrapper, findProjectRoot } from "./paths";
import { formatDocumentLsp } from "./commands/lspRequests";
import { notify } from "./notify";

export async function formatDocument(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  const formatter = getConfig<string>(config.formatter) ?? "lsp";
  if (formatter === "spotless") {
    await formatWithSpotless(editor);
  } else {
    await formatDocumentLsp(client, editor);
  }
}

/**
 * The `env` argv for a Spotless run.
 *
 * The wrapper must run from the directory that owns it, so `-p` is what points
 * Gradle at the module being formatted when that is a subfolder. `--offline`
 * matters on a machine with no network: without it Gradle stalls for minutes
 * trying to reach the plugin portal, and a format-on-save appears to hang.
 */
export function spotlessArgs(
  gradlew: string,
  gradleRoot: string,
  projectRoot: string,
  offline: boolean,
): string[] {
  const args = ["bash", gradlew];
  if (projectRoot !== gradleRoot) args.push("-p", projectRoot);
  if (offline) args.push("--offline");
  args.push("spotlessApply");
  return args;
}

function formatWithSpotless(editor: TextEditor): Promise<void> {
  if (!nova.workspace.path) {
    notify.error("Cannot run Spotless", "No workspace is open.");
    return Promise.reject(new Error("No workspace path"));
  }

  const gradlew = findGradleWrapper();
  if (!gradlew) {
    notify.error(
      "Cannot run Spotless",
      "No Gradle wrapper (gradlew) found. Set “Gradle Wrapper Path” in the workspace settings.",
    );
    return Promise.reject(new Error("gradlew not found"));
  }
  // The wrapper must run from the directory that owns it; `-p` then points
  // Gradle at the module being formatted, which may be a subfolder.
  const gradleRoot = nova.path.dirname(gradlew);
  const projectRoot = findProjectRoot();

  const documentPath = editor.document.path;
  if (!documentPath) {
    // Unsaved buffer with no on-disk path — Spotless works against files on
    // disk, so there is nothing for it to format. Bail out cleanly instead of
    // logging a nonsensical "../../.." relative path and running Gradle anyway.
    return Promise.resolve();
  }

  const relative = nova.path.relative(gradleRoot, documentPath);
  console.log(`Formatting ${relative} with Spotless…`);

  const args = spotlessArgs(
    gradlew,
    gradleRoot,
    projectRoot,
    getConfig<boolean>(config.spotlessOffline) === true,
  );

  return new Promise<void>((resolve, reject) => {
    const process = new Process("/usr/bin/env", {
      args,
      cwd: gradleRoot,
    });
    let errorOutput = "";
    process.onStderr((line) => {
      errorOutput += line;
    });
    process.onDidExit((status) => {
      if (status === 0) {
        // Gradle rewrote the file on disk; Nova reloads it automatically.
        resolve();
      } else {
        notify.error("Spotless failed", errorOutput.trim().split("\n").pop());
        reject(new Error(`Spotless exited with status ${status}`));
      }
    });
    try {
      process.start();
    } catch (err) {
      reject(err);
    }
  });
}
