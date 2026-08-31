import {
  LspLocation,
  documentText,
  lspPositionToOffset,
  uriToPath,
} from "./lspNovaConversions";
import { notify } from "./notify";
import { hashString, mkdirRecursive } from "./novaUtils";

// Registered rather than threaded through every call: the sidebar views that
// reveal locations have no client of their own.
let client: LanguageClient | null = null;

export function setRevealClient(next: LanguageClient | null): void {
  client = next;
}

export async function revealLocation(loc: LspLocation): Promise<void> {
  const path = await resolvePath(loc.uri);
  if (!path) return;

  const editor = await nova.workspace.openFile(path);
  if (!editor) return;
  const text = documentText(editor.document);
  const start = lspPositionToOffset(text, loc.range.start);
  editor.selectedRange = new Range(
    start,
    lspPositionToOffset(text, loc.range.end),
  );
  editor.scrollToPosition(start);
}

// JDT.LS returns `jdt:` URIs for types inside a JAR, which Nova cannot open,
// so the decompiled source is materialised on disk.
async function resolvePath(uri: string): Promise<string | null> {
  if (uri.startsWith("file:")) return uriToPath(uri);
  if (!uri.startsWith("jdt:")) {
    notify.info("Cannot open that location", uri);
    return null;
  }
  if (!client) {
    notify.info(
      "Cannot open library sources",
      "The language server is not running.",
    );
    return null;
  }

  let contents: string | null;
  try {
    contents = (await client.sendRequest("java/classFileContents", {
      uri,
    })) as string | null;
  } catch (err) {
    console.error("java/classFileContents failed:", String(err));
    contents = null;
  }
  if (!contents) {
    notify.info(
      "No sources available",
      "The language server could not decompile that class.",
    );
    return null;
  }
  return writeClassFile(uri, contents);
}

function writeClassFile(uri: string, contents: string): string | null {
  const dir = nova.path.join(nova.extension.globalStoragePath, "classfiles");
  mkdirRecursive(dir);

  const path = nova.path.join(dir, `${classFileName(uri)}.java`);
  try {
    const file = nova.fs.open(path, "w") as FileTextMode;
    file.write(contents);
    file.close();
  } catch (err) {
    console.error(
      `Could not write decompiled source to "${path}":`,
      String(err),
    );
    return null;
  }
  return path;
}

function classFileName(uri: string): string {
  const match = /([A-Za-z_$][A-Za-z0-9_$]*)\.class/.exec(decodeURIComponent(uri));
  return `${match ? match[1] : "ClassFile"}-${hashString(uri)}`;
}
