import {
  LspLocation,
  documentText,
  lspPositionToOffset,
  uriToPath,
} from "./lspNovaConversions";
import { notify } from "./notify";

/**
 * The live client, supplied by main.ts.
 *
 * Revealing a location sometimes needs to talk to the server — a definition
 * inside a JAR arrives as a `jdt://` URI whose contents only JDT.LS can
 * produce — but the sidebar views that reveal locations have no client of
 * their own, so one is registered here instead of threaded through every call.
 */
let client: LanguageClient | null = null;

export function setRevealClient(next: LanguageClient | null): void {
  client = next;
}

/** Open the file for an LSP location and select its range. */
export async function revealLocation(loc: LspLocation): Promise<void> {
  const path = await resolvePath(loc.uri);
  if (!path) return;

  const editor = await nova.workspace.openFile(path);
  if (!editor) return;
  const text = documentText(editor.document);
  const start = lspPositionToOffset(text, loc.range.start);
  const end = lspPositionToOffset(text, loc.range.end);
  editor.selectedRange = new Range(start, end);
  editor.scrollToPosition(start);
}

/**
 * A path Nova can open for an LSP URI.
 *
 * `file:` URIs pass straight through. JDT.LS also hands back `jdt:` URIs for
 * types that live inside a JAR — the JDK's own classes, and every dependency —
 * which Nova cannot open. Those are materialised as a read-only file on disk
 * from the decompiled source the server holds, so "Jump To Definition" on
 * `String` lands somewhere instead of doing nothing.
 */
async function resolvePath(uri: string): Promise<string | null> {
  if (uri.startsWith("file:")) return uriToPath(uri);
  if (!uri.startsWith("jdt:")) {
    notify.info("Cannot open that location", uri);
    return null;
  }

  if (!client) {
    notify.info("Cannot open library sources", "The language server is not running.");
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

/**
 * Cache decompiled sources under the extension's storage so repeated jumps to
 * the same class reuse one file (and one editor tab) instead of piling up.
 */
function writeClassFile(uri: string, contents: string): string | null {
  const dir = nova.path.join(nova.extension.globalStoragePath, "classfiles");
  try {
    if (!nova.fs.access(dir, nova.fs.F_OK)) nova.fs.mkdir(dir);
  } catch {
    // Racing with ourselves is fine; a real failure surfaces on open below.
  }

  const path = nova.path.join(dir, `${classFileName(uri)}.java`);
  try {
    const file = nova.fs.open(path, "w") as FileTextMode;
    file.write(contents);
    file.close();
  } catch (err) {
    console.error(`Could not write decompiled source to "${path}":`, String(err));
    return null;
  }
  return path;
}

/** A filesystem-safe name for a `jdt:` URI, ending in the simple type name. */
function classFileName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  // e.g. …?=project/…&lt;java.lang(String.class → "String"
  const match = /([A-Za-z_$][A-Za-z0-9_$]*)\.class/.exec(decoded);
  const simpleName = match ? match[1] : "ClassFile";
  return `${simpleName}-${hash(uri)}`;
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
