/**
 * Sidebar tree listing the symbols of the active Java file.
 *
 * This mirrors Nova's built-in Symbols sidebar: it follows the active editor
 * and shows that file's structure, rather than waiting to be filled in by a
 * command. The symbols come from the language server (`textDocument/
 * documentSymbol`), which knows about types the tree-sitter query does not.
 */
import { LspRange } from "../lspNovaConversions";
import { revealLocation } from "../reveal";

/** One row in the tree: an LSP symbol, flattened into what the view needs. */
export interface SymbolNode {
  name: string;
  detail: string;
  kind: number;
  uri: string;
  /** The range to select when the row is opened (the symbol's own name). */
  range: LspRange;
  children: SymbolNode[];
}

/** The hierarchical shape of a `textDocument/documentSymbol` response. */
interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange?: LspRange;
  children?: DocumentSymbol[];
}

/** The flat shape servers may return instead. */
interface SymbolInformation {
  name: string;
  kind: number;
  location: { uri: string; range: LspRange };
  containerName?: string;
}

// LSP SymbolKind → a Nova system symbol image name.
const SYMBOL_IMAGES: Record<number, string> = {
  2: "__symbol.package",
  3: "__symbol.package",
  4: "__symbol.package",
  5: "__symbol.class",
  6: "__symbol.method",
  7: "__symbol.property",
  8: "__symbol.field",
  9: "__symbol.constructor",
  10: "__symbol.enum",
  11: "__symbol.interface",
  12: "__symbol.function",
  13: "__symbol.variable",
  14: "__symbol.constant",
  22: "__symbol.enum-member",
};

export class SymbolsView implements TreeDataProvider<SymbolNode> {
  private readonly tree: TreeView<SymbolNode>;
  private roots: SymbolNode[] = [];
  private readonly parents = new Map<SymbolNode, SymbolNode | null>();
  private pending: ReturnType<typeof setTimeout> | undefined;
  private pendingForce = false;
  /** URI of the document the tree currently describes, if any. */
  private loadedUri: string | null = null;
  /** Guards against a slow reply overwriting the results of a later one. */
  private generation = 0;

  constructor(private readonly getClient: () => LanguageClient | null) {
    this.tree = new TreeView("java.sidebar.symbols", { dataProvider: this });
  }

  get treeView(): TreeView<SymbolNode> {
    return this.tree;
  }

  /**
   * Reload from the active editor, coalescing bursts of events into one request.
   *
   * Unforced refreshes are how the view follows the active editor, and they
   * fire on every cursor move — so they do nothing when the file on screen is
   * already the one in the tree. Edits and saves pass `force`.
   */
  refresh(force = false): void {
    this.pendingForce = this.pendingForce || force;
    if (this.pending != null) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = undefined;
      const forced = this.pendingForce;
      this.pendingForce = false;
      void this.load(forced);
    }, 200);
  }

  async openSelected(): Promise<void> {
    const [selected] = this.tree.selection;
    if (selected) {
      await revealLocation({ uri: selected.uri, range: selected.range });
    }
  }

  private async load(force: boolean): Promise<void> {
    const doc = nova.workspace.activeTextEditor?.document;
    const client = this.getClient();
    if (!doc || doc.syntax !== "java" || !client) {
      this.loadedUri = null;
      this.setRoots([]);
      return;
    }
    if (!force && doc.uri === this.loadedUri) return;
    const token = ++this.generation;

    let result: unknown;
    try {
      result = await client.sendRequest("textDocument/documentSymbol", {
        textDocument: { uri: doc.uri },
      });
    } catch (err) {
      // The server refuses requests while it is still importing; an empty
      // list is the honest answer, and the next refresh will fill it in.
      console.warn("textDocument/documentSymbol failed:", String(err));
      result = null;
    }
    if (token !== this.generation) return;
    this.loadedUri = result ? doc.uri : null;
    this.setRoots(toNodes(result, doc.uri));
  }

  private setRoots(roots: SymbolNode[]): void {
    this.roots = roots;
    this.parents.clear();
    const record = (nodes: SymbolNode[], parent: SymbolNode | null) => {
      for (const node of nodes) {
        this.parents.set(node, parent);
        record(node.children, node);
      }
    };
    record(roots, null);
    void this.tree.reload();
  }

  getChildren(element: SymbolNode | null): SymbolNode[] {
    return element ? element.children : this.roots;
  }

  getParent(element: SymbolNode): SymbolNode | null {
    return this.parents.get(element) ?? null;
  }

  getTreeItem(element: SymbolNode): TreeItem {
    const item = new TreeItem(
      element.name,
      element.children.length > 0
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.None,
    );
    item.descriptiveText = element.detail;
    item.tooltip = element.detail ? `${element.name} ${element.detail}` : element.name;
    item.command = "java.openSymbol";
    const image = SYMBOL_IMAGES[element.kind];
    if (image) item.image = image;
    return item;
  }
}

/**
 * Normalise either documentSymbol response shape into a tree.
 *
 * Which one arrives depends on the capabilities Nova advertises, so both have
 * to be handled: hierarchical `DocumentSymbol`s nest, flat `SymbolInformation`
 * ones are listed in the order the server sent them.
 */
function toNodes(result: unknown, uri: string): SymbolNode[] {
  if (!Array.isArray(result) || result.length === 0) return [];
  if ("location" in (result[0] as object)) {
    return (result as SymbolInformation[]).map((symbol) => ({
      name: symbol.name,
      detail: symbol.containerName ?? "",
      kind: symbol.kind,
      uri: symbol.location.uri,
      range: symbol.location.range,
      children: [],
    }));
  }
  const convert = (symbol: DocumentSymbol): SymbolNode => ({
    name: symbol.name,
    detail: symbol.detail ?? "",
    kind: symbol.kind,
    uri,
    range: symbol.selectionRange ?? symbol.range,
    children: (symbol.children ?? []).map(convert),
  });
  return (result as DocumentSymbol[]).map(convert);
}
