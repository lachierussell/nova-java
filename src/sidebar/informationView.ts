/**
 * A small TreeView that surfaces language-server status in the sidebar.
 */

export type ServerStatus = "stopped" | "starting" | "running" | "failed";

interface Row {
  id: string;
  label: string;
  value: string;
}

export class InformationView implements TreeDataProvider<string> {
  private readonly tree: TreeView<string>;
  private status: ServerStatus = "stopped";
  private serverPath = "—";
  private javaHome = "—";
  private projectRoot = "—";
  private gradleWrapper = "—";

  constructor() {
    this.tree = new TreeView("java.sidebar.info", { dataProvider: this });
  }

  get treeView(): TreeView<string> {
    return this.tree;
  }

  setStatus(status: ServerStatus): void {
    this.status = status;
    this.reload();
  }

  setServerPath(path: string): void {
    this.serverPath = path;
    this.reload();
  }

  setJavaHome(home: string): void {
    this.javaHome = home;
    this.reload();
  }

  setProjectRoot(path: string): void {
    this.projectRoot = path;
    this.reload();
  }

  setGradleWrapper(path: string): void {
    this.gradleWrapper = path;
    this.reload();
  }

  private reload(): void {
    this.tree.reload();
  }

  private rows(): Row[] {
    const label: Record<ServerStatus, string> = {
      stopped: "Stopped",
      starting: "Starting…",
      running: "Running",
      failed: "Failed",
    };
    return [
      { id: "status", label: "Status", value: label[this.status] },
      { id: "jdk", label: "JDK", value: this.javaHome },
      { id: "server", label: "Language server", value: this.serverPath },
      { id: "root", label: "Project root", value: this.projectRoot },
      { id: "gradlew", label: "Gradle wrapper", value: this.gradleWrapper },
    ];
  }

  getChildren(element: string | null): string[] {
    if (element == null) return this.rows().map((r) => r.id);
    return [];
  }

  getTreeItem(element: string): TreeItem {
    const row = this.rows().find((r) => r.id === element);
    const item = new TreeItem(
      row?.label ?? element,
      TreeItemCollapsibleState.None,
    );
    item.descriptiveText = row?.value ?? "";
    item.tooltip = row?.value ?? "";
    item.identifier = element;
    return item;
  }
}
