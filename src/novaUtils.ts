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

/** First non-empty string among the candidates, or undefined. */
export function firstString(
  ...candidates: (string | null | undefined)[]
): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return undefined;
}

/** Does a file exist at the given absolute path? */
export function fileExists(path: string): boolean {
  return nova.fs.access(path, nova.fs.F_OK);
}

/** Expand a leading `~/` to the user's home directory. */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return nova.path.join(nova.path.expanduser("~"), path.slice(2));
  }
  return path;
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
