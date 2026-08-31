/**
 * Small helpers shared across the extension.
 */
import { notify } from "./notify";

/**
 * Wrap a command callback so any thrown error / rejected promise is logged and
 * surfaced as a notification instead of silently disappearing.
 */
export function wrapCommand<A extends unknown[]>(
  command: (...args: A) => void | Promise<void>,
): (...args: A) => void {
  return function wrapped(...args: A): void {
    Promise.resolve(command(...args)).catch((err: unknown) => {
      console.error("Java command failed:", String(err));
      notify.error(
        "Java command failed",
        err instanceof Error ? err.message : String(err),
      );
    });
  };
}

/** Does a file exist at the given absolute path? */
export function fileExists(path: string): boolean {
  return nova.fs.access(path, nova.fs.F_OK);
}

/** Resolve after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Expand a leading `~/` to the user's home directory. */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return nova.path.join(nova.path.expanduser("~"), path.slice(2));
  }
  return path;
}

/**
 * Create a directory and every missing parent. `nova.fs.mkdir` creates a
 * single level, so a nested path fails unless its parents already exist.
 */
export function mkdirRecursive(path: string): void {
  let current = "";
  for (const part of path.split("/").filter((p) => p.length > 0)) {
    current += `/${part}`;
    if (nova.fs.access(current, nova.fs.F_OK)) continue;
    try {
      nova.fs.mkdir(current);
    } catch (err) {
      console.error(`Could not create "${current}":`, String(err));
      return;
    }
  }
}

/** A short, stable hash of a string, for naming per-project scratch files. */
export function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

interface InputOptions {
  label?: string;
  placeholder?: string;
  value?: string;
  prompt?: string;
  secure?: boolean;
}

/** Prompt for a line of input, resolving to null if the user cancels. */
export function promptInput(
  message: string,
  options: InputOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    nova.workspace.showInputPanel(message, options, (value) => {
      resolve(value ?? null);
    });
  });
}
