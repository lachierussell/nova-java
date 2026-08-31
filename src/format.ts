import { config, getConfig } from "./config";
import { findGradleWrapper, findProjectRoot } from "./paths";
import { formatDocumentLsp } from "./commands/lspRequests";
import { notify } from "./notify";

export async function formatDocument(
  client: LanguageClient,
  editor: TextEditor,
): Promise<void> {
  if (getConfig<string>(config.formatter) === "spotless") {
    await formatWithSpotless(editor);
  } else {
    await formatDocumentLsp(client, editor);
  }
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

  const documentPath = editor.document.path;
  if (!documentPath) return Promise.resolve();

  // The wrapper must run from the directory owning it; `-p` then points Gradle
  // at the module, which may be a subfolder.
  const gradleRoot = nova.path.dirname(gradlew);
  const projectRoot = findProjectRoot();
  console.log(
    `Formatting ${nova.path.relative(gradleRoot, documentPath)} with Spotless…`,
  );

  const args = ["bash", gradlew];
  if (projectRoot !== gradleRoot) args.push("-p", projectRoot);
  // Offline, a network-less machine stalls for minutes on the plugin portal.
  if (getConfig<boolean>(config.spotlessOffline) === true) args.push("--offline");
  args.push("spotlessApply");

  return new Promise<void>((resolve, reject) => {
    const process = new Process("/usr/bin/env", { args, cwd: gradleRoot });
    let errorOutput = "";
    process.onStderr((line) => {
      errorOutput += line;
    });
    process.onDidExit((status) => {
      if (status === 0) {
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
