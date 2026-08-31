import { notify } from "./notify";

export function wrapCommand<A extends unknown[]>(
  command: (...args: A) => void | Promise<void>,
): (...args: A) => void {
  return function wrapped(...args: A): void {
    Promise.resolve(command(...args)).catch((err: unknown) => {
      console.error("Java command failed:", String(err));
      notify.error("Java command failed", errorMessage(err));
    });
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function fileExists(path: string): boolean {
  return nova.fs.access(path, nova.fs.F_OK);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce(ms: number, run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, ms);
  };
}

export function expandPath(path: string): string {
  if (!path.startsWith("~/")) return path;
  return nova.path.join(nova.path.expanduser("~"), path.slice(2));
}

/** `nova.fs.mkdir` creates one level only, and throws if a parent is missing. */
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
