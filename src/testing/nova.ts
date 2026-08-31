// An in-memory stand-in for the Nova editor API, faithful enough to run the
// extension's real code paths without an editor.
// Shapes follow https://docs.nova.app/api-reference.

class FakeRange {
  constructor(
    readonly start: number,
    readonly end: number,
  ) {}
  get length(): number {
    return this.end - this.start;
  }
  get empty(): boolean {
    return this.start === this.end;
  }
}

class FakeDisposable {
  constructor(private readonly fn: () => void) {}
  dispose(): void {
    this.fn();
  }
}

class FakeCompositeDisposable {
  private items: { dispose(): void }[] = [];
  add(item: { dispose(): void }): void {
    this.items.push(item);
  }
  remove(item: { dispose(): void }): void {
    this.items = this.items.filter((i) => i !== item);
  }
  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items = [];
  }
  get count(): number {
    return this.items.length;
  }
}

class Emitter<A extends unknown[]> {
  private readonly listeners = new Set<(...args: A) => void>();

  on(fn: (...args: A) => void): FakeDisposable {
    this.listeners.add(fn);
    return new FakeDisposable(() => this.listeners.delete(fn));
  }

  emit(...args: A): void {
    for (const fn of [...this.listeners]) fn(...args);
  }

  get count(): number {
    return this.listeners.size;
  }
}

const HOME = "/Users/tester";

function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return (absolute ? "/" : "") + parts.join("/");
}

const fakePath = {
  join: (...parts: string[]) => normalize(parts.join("/")),
  normalize,
  basename: (p: string) => normalize(p).split("/").pop() ?? "",
  dirname: (p: string) => {
    const parts = normalize(p).split("/");
    parts.pop();
    const dir = parts.join("/");
    return dir === "" ? (p.startsWith("/") ? "/" : ".") : dir;
  },
  extname: (p: string) => {
    const base = fakePath.basename(p);
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot);
  },
  expanduser: (p: string) => (p === "~" || p.startsWith("~/") ? HOME + p.slice(1) : p),
  split: (p: string) => normalize(p).split("/"),
  relative: (from: string, to: string) => {
    const a = normalize(from).split("/");
    const b = normalize(to).split("/");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
  },
  isAbsolute: (p: string) => p.startsWith("/"),
};

const F_OK = 0;
const X_OK = 1;
const W_OK = 2;
const R_OK = 4;

class FakeFileSystem {
  private readonly entries = new Map<string, string | null>();
  private readonly executable = new Set<string>();

  constructor() {
    this.mkdirp("/");
  }

  mkdirp(path: string): void {
    let current = "";
    for (const part of normalize(path).split("/")) {
      current = current === "" ? "/" : fakePath.join(current, part);
      if (!this.entries.has(current)) this.entries.set(current, null);
    }
  }

  writeFile(path: string, contents = "", opts: { executable?: boolean } = {}): void {
    this.mkdirp(fakePath.dirname(path));
    this.entries.set(normalize(path), contents);
    if (opts.executable) this.executable.add(normalize(path));
  }

  readFile(path: string): string | null {
    return this.entries.get(normalize(path)) ?? null;
  }

  readonly constants = { F_OK, X_OK, W_OK, R_OK };
  readonly F_OK = F_OK;
  readonly X_OK = X_OK;
  readonly W_OK = W_OK;
  readonly R_OK = R_OK;

  access(path: string, mode = F_OK): boolean {
    const p = normalize(path);
    if (!this.entries.has(p)) return false;
    if ((mode & X_OK) !== 0) {
      return this.entries.get(p) === null || this.executable.has(p);
    }
    return true;
  }

  listdir(path: string): string[] {
    const dir = normalize(path);
    if (this.entries.get(dir) !== null) {
      throw new Error(`Not a directory: ${dir}`);
    }
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const names = new Set<string>();
    for (const key of this.entries.keys()) {
      if (key === dir || !key.startsWith(prefix)) continue;
      names.add(key.slice(prefix.length).split("/")[0]);
    }
    return [...names];
  }

  mkdir(path: string): void {
    const p = normalize(path);
    const parent = fakePath.dirname(p);
    if (!this.entries.has(parent)) throw new Error(`No such directory: ${parent}`);
    if (this.entries.has(p)) throw new Error(`Already exists: ${p}`);
    this.entries.set(p, null);
  }

  remove(path: string): void {
    this.entries.delete(normalize(path));
  }

  stat(path: string): { isDirectory(): boolean; isFile(): boolean } | null {
    const p = normalize(path);
    if (!this.entries.has(p)) return null;
    const isDir = this.entries.get(p) === null;
    return { isDirectory: () => isDir, isFile: () => !isDir };
  }

  open(path: string, mode = "r"): FakeFile {
    const p = normalize(path);
    if (mode.startsWith("r") && !this.entries.has(p)) {
      throw new Error(`No such file: ${p}`);
    }
    if (mode.startsWith("w")) this.writeFile(p, "");
    return new FakeFile(this, p, mode);
  }
}

class FakeFile {
  private closed = false;

  constructor(
    private readonly fs: FakeFileSystem,
    private readonly path: string,
    private readonly mode: string,
  ) {}

  read(): string | null {
    return this.fs.readFile(this.path);
  }

  write(text: string): void {
    if (this.closed) throw new Error("File is closed");
    const existing = this.mode.startsWith("a") ? (this.fs.readFile(this.path) ?? "") : "";
    this.fs.writeFile(this.path, existing + text);
  }

  close(): void {
    this.closed = true;
  }
}

class FakeConfiguration {
  private readonly values = new Map<string, unknown>();
  private readonly emitters = new Map<string, Emitter<[unknown]>>();

  get(key: string, _coerce?: string): unknown {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
    this.emitters.get(key)?.emit(value);
  }

  remove(key: string): void {
    this.values.delete(key);
    this.emitters.get(key)?.emit(null);
  }

  onDidChange(key: string, fn: (value: unknown) => void): FakeDisposable {
    let emitter = this.emitters.get(key);
    if (!emitter) {
      emitter = new Emitter<[unknown]>();
      this.emitters.set(key, emitter);
    }
    return emitter.on(fn);
  }
}

export class FakeTextDocument {
  isDirty = false;
  isUntitled: boolean;

  constructor(
    public path: string | null,
    public text: string,
    public syntax: string | null = "java",
  ) {
    this.isUntitled = path == null;
  }

  get uri(): string {
    return this.path ? `file://${this.path}` : "untitled:Untitled";
  }

  get length(): number {
    return this.text.length;
  }

  getTextInRange(range: { start: number; end: number }): string {
    if (range.start < 0 || range.end > this.text.length) {
      // Nova throws on an out-of-bounds read; reproducing that keeps the fake
      // honest about the failure mode a mid-transaction re-read can hit.
      throw new RangeError(
        `Range ${range.start}..${range.end} is outside the document (length ${this.text.length})`,
      );
    }
    return this.text.slice(range.start, range.end);
  }
}

export class FakeTextEditor {
  readonly document: FakeTextDocument;
  selectedRange = new FakeRange(0, 0);
  tabLength = 4;
  softTabs = true;
  scrolledTo: number | null = null;

  readonly replacements: { start: number; end: number; newText: string }[] = [];

  readonly onDidChangeSelectionEmitter = new Emitter<[FakeTextEditor]>();
  readonly onDidStopChangingEmitter = new Emitter<[FakeTextEditor]>();
  readonly onWillSaveEmitter = new Emitter<[FakeTextEditor]>();
  readonly onDidSaveEmitter = new Emitter<[FakeTextEditor]>();
  readonly onDidDestroyEmitter = new Emitter<[FakeTextEditor]>();

  private willSavePromises: Promise<unknown>[] = [];

  constructor(document: FakeTextDocument) {
    this.document = document;
  }

  get text(): string {
    return this.document.text;
  }

  async edit(
    callback: (edit: {
      replace: (range: { start: number; end: number }, text: string) => void;
      insert: (position: number, text: string) => void;
      delete: (range: { start: number; end: number }) => void;
    }) => void,
  ): Promise<void> {
    const replace = (range: { start: number; end: number }, text: string) => {
      const doc = this.document;
      if (range.start < 0 || range.end > doc.text.length || range.start > range.end) {
        throw new RangeError(
          `Cannot replace ${range.start}..${range.end} in a document of length ${doc.text.length}`,
        );
      }
      this.replacements.push({ start: range.start, end: range.end, newText: text });
      doc.text = doc.text.slice(0, range.start) + text + doc.text.slice(range.end);
    };
    callback({
      replace,
      insert: (position, text) => replace({ start: position, end: position }, text),
      delete: (range) => replace(range, ""),
    });
  }

  scrollToPosition(position: number): void {
    this.scrolledTo = position;
  }

  async save(): Promise<void> {
    this.willSavePromises = [];
    this.onWillSaveEmitter.emit(this);
    await Promise.all(this.willSavePromises);
    this.onDidSaveEmitter.emit(this);
  }

  onDidChangeSelection(fn: (e: FakeTextEditor) => void) {
    return this.onDidChangeSelectionEmitter.on(fn);
  }
  onDidStopChanging(fn: (e: FakeTextEditor) => void) {
    return this.onDidStopChangingEmitter.on(fn);
  }
  onDidSave(fn: (e: FakeTextEditor) => void) {
    return this.onDidSaveEmitter.on(fn);
  }
  onDidDestroy(fn: (e: FakeTextEditor) => void) {
    return this.onDidDestroyEmitter.on(fn);
  }
  onWillSave(fn: (e: FakeTextEditor) => unknown) {
    return this.onWillSaveEmitter.on((editor) => {
      const result = fn(editor);
      if (result instanceof Promise) this.willSavePromises.push(result);
    });
  }
}

class FakeWorkspace {
  readonly config = new FakeConfiguration();
  readonly textEditors: FakeTextEditor[] = [];
  activeTextEditor: FakeTextEditor | null = null;
  path: string | null = null;

  private readonly addEditorEmitter = new Emitter<[FakeTextEditor]>();

  inputResponses: (string | null)[] = [];
  choose: (choices: string[], placeholder?: string) => number | null = () => null;

  readonly prompts: { message: string; choices?: string[] }[] = [];
  openedConfigs = 0;

  get lastPrompt(): { message: string; choices?: string[] } {
    const prompt = this.prompts[this.prompts.length - 1];
    if (!prompt) throw new Error("Nothing has been prompted for");
    return prompt;
  }

  add(editor: FakeTextEditor): void {
    this.textEditors.push(editor);
    this.activeTextEditor = editor;
    this.addEditorEmitter.emit(editor);
  }

  onDidAddTextEditor(fn: (editor: FakeTextEditor) => void): FakeDisposable {
    // Nova invokes the callback immediately for every editor already open.
    for (const editor of this.textEditors) fn(editor);
    return this.addEditorEmitter.on(fn);
  }

  async openFile(uri: string): Promise<FakeTextEditor | null> {
    const path = decodeURIComponent(uri.replace(/^file:\/\//, ""));
    const existing = this.textEditors.find((e) => e.document.path === path);
    if (existing) {
      this.activeTextEditor = existing;
      return existing;
    }
    const contents = fs.readFile(path);
    if (contents == null) return null;
    const editor = new FakeTextEditor(new FakeTextDocument(path, contents));
    this.add(editor);
    return editor;
  }

  showInputPanel(
    message: string,
    _options: unknown,
    callback: (value: string | null) => void,
  ): void {
    this.prompts.push({ message });
    callback(this.inputResponses.shift() ?? null);
  }

  showChoicePalette(
    choices: string[],
    options: { placeholder?: string } | undefined,
    callback: (choice: string | null, index: number | null) => void,
  ): void {
    this.prompts.push({ message: options?.placeholder ?? "", choices });
    const index = this.choose(choices, options?.placeholder);
    if (index == null || index < 0) callback(null, null);
    else callback(choices[index], index);
  }

  openConfig(): void {
    this.openedConfigs++;
  }

  contains(path: string): boolean {
    return this.path != null && path.startsWith(this.path);
  }

  relativizePath(path: string): string {
    return this.path ? fakePath.relative(this.path, path) : path;
  }
}

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;

class FakeTreeItem {
  descriptiveText?: string;
  tooltip?: string;
  image?: string;
  command?: string;
  identifier?: string;
  color?: unknown;

  constructor(
    public name: string,
    public collapsibleState: number = TreeItemCollapsibleState.None,
  ) {}
}

interface FakeDataProvider<E> {
  getChildren(element: E | null): E[] | Promise<E[]>;
  getParent?(element: E): E | null;
  getTreeItem(element: E): FakeTreeItem;
}

class FakeTreeView<E> {
  visible = true;
  selection: E[] = [];
  reloads = 0;
  readonly revealed: E[] = [];
  disposed = false;

  private readonly visibilityEmitter = new Emitter<[]>();
  private readonly selectionEmitter = new Emitter<[E[]]>();

  constructor(
    readonly identifier: string,
    readonly options: { dataProvider: FakeDataProvider<E> },
  ) {
    views.set(identifier, this as unknown as FakeTreeView<unknown>);
  }

  get provider(): FakeDataProvider<E> {
    return this.options.dataProvider;
  }

  async reload(): Promise<void> {
    this.reloads++;
  }

  reveal(element: E | null): void {
    if (element != null) this.revealed.push(element);
  }

  dispose(): void {
    this.disposed = true;
  }

  onDidChangeVisibility(fn: () => void) {
    return this.visibilityEmitter.on(fn);
  }

  onDidChangeSelection(fn: (selection: E[]) => void) {
    return this.selectionEmitter.on(fn);
  }

  select(element: E): void {
    this.selection = [element];
    this.selectionEmitter.emit(this.selection);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.visibilityEmitter.emit();
  }

  async rows(element: E | null = null): Promise<RenderedRow[]> {
    const children = await this.provider.getChildren(element);
    const out: RenderedRow[] = [];
    for (const child of children) {
      const item = this.provider.getTreeItem(child);
      out.push({
        name: item.name,
        description: item.descriptiveText ?? "",
        image: item.image,
        command: item.command,
        children: await this.rows(child),
      });
    }
    return out;
  }
}

export interface RenderedRow {
  name: string;
  description: string;
  image?: string;
  command?: string;
  children: RenderedRow[];
}

class FakeNotificationRequest {
  title?: string;
  body?: string;
  actions?: string[];
  constructor(public identifier: string) {}
}

export interface ProcessResult {
  stdout?: string[];
  stderr?: string[];
  status?: number;
}

export interface ProcessInvocation {
  path: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

class FakeProcess {
  private readonly stdout = new Emitter<[string]>();
  private readonly stderr = new Emitter<[string]>();
  private readonly exit = new Emitter<[number]>();
  private readonly invocation: ProcessInvocation;

  constructor(path: string, options: Omit<ProcessInvocation, "path"> = { args: [] }) {
    this.invocation = { path, args: options.args ?? [], cwd: options.cwd, env: options.env };
  }

  onStdout(fn: (line: string) => void) {
    return this.stdout.on(fn);
  }
  onStderr(fn: (line: string) => void) {
    return this.stderr.on(fn);
  }
  onDidExit(fn: (status: number) => void) {
    return this.exit.on(fn);
  }

  start(): void {
    processes.push(this.invocation);
    const result = runProcess(this.invocation);
    // Real processes report asynchronously, and Nova delivers each line with
    // its trailing newline intact — callers rely on both.
    const withNewline = (line: string) => (line.endsWith("\n") ? line : `${line}\n`);
    void Promise.resolve().then(() => {
      for (const line of result.stdout ?? []) this.stdout.emit(withNewline(line));
      for (const line of result.stderr ?? []) this.stderr.emit(withNewline(line));
      this.exit.emit(result.status ?? 0);
    });
  }

  kill(): void {}
  terminate(): void {}
}

export type RequestResponder = (method: string, params: unknown) => unknown;

class FakeLanguageClient {
  running = false;
  readonly requests: { method: string; params: unknown }[] = [];
  readonly notificationsSent: { method: string; params: unknown }[] = [];

  private readonly notificationHandlers = new Map<string, (params: unknown) => void>();
  private readonly requestHandlers = new Map<string, (params: unknown) => unknown>();
  private readonly stopEmitter = new Emitter<[Error | undefined]>();

  respond: RequestResponder = () => null;

  constructor(
    readonly identifier: string,
    readonly name: string,
    readonly serverOptions: Record<string, unknown>,
    readonly clientOptions: Record<string, unknown>,
  ) {
    clients.push(this);
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  onDidStop(fn: (err?: Error) => void) {
    return this.stopEmitter.on(fn);
  }

  onNotification(method: string, fn: (params: unknown) => void): void {
    this.notificationHandlers.set(method, fn);
  }

  onRequest(method: string, fn: (params: unknown) => unknown): void {
    this.requestHandlers.set(method, fn);
  }

  sendNotification(method: string, params?: unknown): void {
    this.notificationsSent.push({ method, params });
  }

  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return this.respond(method, params);
  }

  notify(method: string, params: unknown): void {
    this.notificationHandlers.get(method)?.(params);
  }

  request(method: string, params: unknown): unknown {
    return this.requestHandlers.get(method)?.(params);
  }

  emitStop(err?: Error): void {
    this.running = false;
    this.stopEmitter.emit(err);
  }

  becomeReady(): void {
    this.notify("language/status", { type: "Starting", message: "10%" });
    this.notify("language/status", { type: "ServiceReady", message: "Ready" });
  }
}

let fs: FakeFileSystem;
let clients: FakeLanguageClient[];
let processes: ProcessInvocation[];
let views: Map<string, FakeTreeView<unknown>>;
let runProcess: (invocation: ProcessInvocation) => ProcessResult;

export interface NovaFake {
  fs: FakeFileSystem;
  path: typeof fakePath;
  config: FakeConfiguration;
  workspace: FakeWorkspace;
  environment: Record<string, string>;
  extension: { identifier: string; path: string; globalStoragePath: string };
  commands: {
    register(name: string, fn: (...args: never[]) => unknown): FakeDisposable;
    invoke(name: string, ...args: unknown[]): Promise<unknown>;
    names(): string[];
  };
  notifications: {
    add(request: FakeNotificationRequest): Promise<void>;
    posted: FakeNotificationRequest[];
    last(): FakeNotificationRequest;
    titles(): string[];
  };

  clients: FakeLanguageClient[];
  client(): FakeLanguageClient;
  processes: ProcessInvocation[];
  onProcess(fn: (invocation: ProcessInvocation) => ProcessResult): void;
  view<E>(identifier: string): FakeTreeView<E>;
  openEditor(path: string, text: string, syntax?: string | null): FakeTextEditor;
}

export function installNova(
  options: { workspacePath?: string } = {},
): NovaFake {
  fs = new FakeFileSystem();
  clients = [];
  processes = [];
  views = new Map();
  runProcess = () => ({ status: 0 });

  const registered = new Map<string, (...args: never[]) => unknown>();
  const posted: FakeNotificationRequest[] = [];

  const workspace = new FakeWorkspace();
  workspace.path = options.workspacePath ?? "/Users/tester/project";
  fs.mkdirp(workspace.path);
  fs.mkdirp(`${HOME}/storage`);

  const nova: NovaFake = {
    fs,
    path: fakePath,
    config: new FakeConfiguration(),
    workspace,
    environment: { PATH: "/usr/bin:/bin", HOME },
    extension: {
      identifier: "com.parkcedar.java",
      path: "/Applications/Nova.app/Extensions/java.novaextension",
      globalStoragePath: `${HOME}/storage`,
    },
    commands: {
      register(name, fn) {
        registered.set(name, fn);
        return new FakeDisposable(() => registered.delete(name));
      },
      async invoke(name, ...args) {
        const fn = registered.get(name);
        if (!fn) throw new Error(`No such command: ${name}`);
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
      names: () => [...registered.keys()],
    },
    notifications: {
      async add(request) {
        posted.push(request);
      },
      posted,
      last: () => {
        const notification = posted[posted.length - 1];
        if (!notification) throw new Error("No notification has been posted");
        return notification;
      },
      titles: () => posted.map((n) => n.title ?? ""),
    },

    clients,
    client: () => {
      const last = clients[clients.length - 1];
      if (!last) throw new Error("No language client has been created");
      return last;
    },
    processes,
    onProcess: (fn) => {
      runProcess = fn;
    },
    view: <E,>(identifier: string) => {
      const view = views.get(identifier);
      if (!view) throw new Error(`No such tree view: ${identifier}`);
      return view as unknown as FakeTreeView<E>;
    },
    openEditor: (path, text, syntax = "java") => {
      fs.writeFile(path, text);
      const editor = new FakeTextEditor(new FakeTextDocument(path, text, syntax));
      workspace.add(editor);
      return editor;
    },
  };

  const globals = globalThis as Record<string, unknown>;
  globals.nova = nova;
  globals.Range = FakeRange;
  globals.Disposable = FakeDisposable;
  globals.CompositeDisposable = FakeCompositeDisposable;
  globals.NotificationRequest = FakeNotificationRequest;
  globals.TreeView = FakeTreeView;
  globals.TreeItem = FakeTreeItem;
  globals.TreeItemCollapsibleState = TreeItemCollapsibleState;
  globals.Process = FakeProcess;
  globals.LanguageClient = FakeLanguageClient;

  return nova;
}

// Requesting a method with no entry throws, so a test that changes which
// requests a command makes fails loudly rather than silently.
export function fakeClient(
  responses: Record<string, unknown | ((params: unknown) => unknown)>,
): FakeLanguageClient {
  const client = new FakeLanguageClient("test", "Test", {}, {});
  client.respond = (method, params) => {
    if (!(method in responses)) throw new Error(`Unexpected LSP request: ${method}`);
    const response = responses[method];
    return typeof response === "function" ? response(params) : response;
  };
  return client;
}

export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { FakeLanguageClient, FakeTreeView, FakeFileSystem };
export { FakeRange };
