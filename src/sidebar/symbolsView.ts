/**
 * Sidebar tree listing the results of "Find Symbol".
 */
import { LspLocation } from "../lspNovaConversions";
import { revealLocation } from "../reveal";

export interface SymbolInformation {
  name: string;
  kind: number;
  location: LspLocation;
  containerName?: string;
}

// LSP SymbolKind → a Nova system symbol image name.
const SYMBOL_IMAGES: Record<number, string> = {
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

export class SymbolsView implements TreeDataProvider<SymbolInformation> {
  private readonly tree: TreeView<SymbolInformation>;
  private symbols: SymbolInformation[] = [];

  constructor() {
    this.tree = new TreeView("java.sidebar.symbols", { dataProvider: this });
  }

  get treeView(): TreeView<SymbolInformation> {
    return this.tree;
  }

  show(symbols: SymbolInformation[]): void {
    this.symbols = symbols;
    this.tree.reload();
    this.tree.reveal(symbols[0], { focus: false, reveal: 3 });
  }

  async openSelected(): Promise<void> {
    const [selected] = this.tree.selection;
    if (selected) await revealLocation(selected.location);
  }

  getChildren(element: SymbolInformation | null): SymbolInformation[] {
    return element ? [] : this.symbols;
  }

  getTreeItem(element: SymbolInformation): TreeItem {
    const item = new TreeItem(element.name, TreeItemCollapsibleState.None);
    item.descriptiveText = element.containerName ?? "";
    item.command = "java.openSymbol";
    const image = SYMBOL_IMAGES[element.kind];
    if (image) item.image = image;
    return item;
  }
}
