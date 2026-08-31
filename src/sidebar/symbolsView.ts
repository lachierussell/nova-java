import { LspRange } from "../lspNovaConversions";
import { debounce } from "../novaUtils";
import { revealLocation } from "../reveal";

export interface SymbolNode {
  name: string;
  detail: string;
  kind: number;
  uri: string;
  range: LspRange;
  children: SymbolNode[];
}

interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange?: LspRange;
  children?: DocumentSymbol[];
}

interface SymbolInformation {
  name: string;
  kind: number;
  location: { uri: string; range: LspRange };
  containerName?: string;
}

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
  private pendingForce = false;
  private loadedUri: string | null = null;
  /** Guards against a slow reply overwriting the results of a later one. */
  private generation = 0;

  constructor(private readonly getClient: () => LanguageClient | null) {
    this.tree = new TreeView("java.sidebar.symbols", { dataProvider: this });
  }

  get treeView(): TreeView<SymbolNode> {
    return this.tree;
  }

  refresh(force = false): void {
    this.pendingForce ||= force;
    this.reload();
  }

  private readonly reload = debounce(200, () => {
    const forced = this.pendingForce;
    this.pendingForce = false;
    void this.load(forced);
  });

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
      // The server refuses requests while importing; the next refresh retries.
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
    item.tooltip = element.detail
      ? `${element.name} ${element.detail}`
      : element.name;
    item.command = "java.openSymbol";
    const image = SYMBOL_IMAGES[element.kind];
    if (image) item.image = image;
    return item;
  }
}

/** Which of the two response shapes arrives depends on Nova's capabilities. */
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
