/**
 * Sidebar tree listing the results of "Find References".
 */
import { LspLocation } from "../lspNovaConversions";
import { revealLocation } from "../reveal";

export class ReferencesView implements TreeDataProvider<LspLocation> {
  private readonly tree: TreeView<LspLocation>;
  private locations: LspLocation[] = [];

  constructor() {
    this.tree = new TreeView("java.sidebar.references", { dataProvider: this });
  }

  get treeView(): TreeView<LspLocation> {
    return this.tree;
  }

  show(locations: LspLocation[]): void {
    this.locations = locations;
    const first = locations[0];
    void this.tree.reload().then(() => {
      if (first) this.tree.reveal(first, { focus: false, reveal: 3 });
    });
  }

  /** Reveal the currently selected reference (invoked on activation). */
  async openSelected(): Promise<void> {
    const [selected] = this.tree.selection;
    if (selected) await revealLocation(selected);
  }

  getChildren(element: LspLocation | null): LspLocation[] {
    return element ? [] : this.locations;
  }

  /** Required by Nova before reveal() may be used; the list is flat. */
  getParent(_element: LspLocation): LspLocation | null {
    return null;
  }

  getTreeItem(element: LspLocation): TreeItem {
    const path = decodeURIComponent(element.uri.replace(/^file:\/\//, ""));
    const item = new TreeItem(
      nova.path.basename(path),
      TreeItemCollapsibleState.None,
    );
    item.descriptiveText = `Line ${element.range.start.line + 1}`;
    item.tooltip = path;
    item.command = "java.openLocation";
    item.image = "__symbol.reference";
    return item;
  }
}
