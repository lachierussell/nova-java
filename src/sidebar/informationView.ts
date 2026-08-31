/**
 * A small TreeView that surfaces language-server status in the sidebar.
 */

export type ServerStatus = "stopped" | "starting" | "running" | "failed";

interface Row {
  id: string;
  label: string;
  value: string;
  image?: string;
}

/** Coloured dots (bundled in Images/) so the row reads at a glance. */
const STATUS_IMAGES: Record<ServerStatus, string> = {
  stopped: "status-stopped",
  starting: "status-starting",
  running: "status-running",
  failed: "status-failed",
};

export class InformationView implements TreeDataProvider<string> {
  private readonly tree: TreeView<string>;
  private status: ServerStatus = "stopped";
  /** The server's own words about what it is doing, e.g. "63% Importing…". */
  private statusDetail = "";
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

  setStatus(status: ServerStatus, detail?: string): void {
    this.status = status;
    this.statusDetail = detail?.trim() ?? "";
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
    // Importing a project takes JDT.LS anywhere from seconds to minutes, and
    // it answers nothing until that finishes — so show its progress rather
    // than a bare "Starting…" that looks identical to a hung server.
    const status = this.statusDetail
      ? `${label[this.status]} — ${this.statusDetail}`
      : label[this.status];
    return [
      {
        id: "status",
        label: "Status",
        value: status,
        image: STATUS_IMAGES[this.status],
      },
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
    if (row?.image) item.image = row.image;
    item.descriptiveText = row?.value ?? "";
    item.tooltip = row?.value ?? "";
    item.identifier = element;
    return item;
  }
}
