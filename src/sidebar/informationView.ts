export type ServerStatus = "stopped" | "starting" | "running" | "failed";

interface Details {
  javaHome: string;
  serverPath: string;
  projectRoot: string;
  gradleWrapper: string;
}

interface Row {
  id: string;
  label: string;
  value: string;
  image?: string;
}

const STATUS_IMAGES: Record<ServerStatus, string> = {
  stopped: "status-stopped",
  starting: "status-starting",
  running: "status-running",
  failed: "status-failed",
};

const STATUS_LABELS: Record<ServerStatus, string> = {
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  failed: "Failed",
};

const UNKNOWN = "—";

export class InformationView implements TreeDataProvider<string> {
  private readonly tree: TreeView<string>;
  private status: ServerStatus = "stopped";
  private statusDetail = "";
  private details: Details = {
    javaHome: UNKNOWN,
    serverPath: UNKNOWN,
    projectRoot: UNKNOWN,
    gradleWrapper: UNKNOWN,
  };

  constructor() {
    this.tree = new TreeView("java.sidebar.info", { dataProvider: this });
  }

  get treeView(): TreeView<string> {
    return this.tree;
  }

  setStatus(status: ServerStatus, detail?: string): void {
    this.status = status;
    this.statusDetail = detail?.trim() ?? "";
    this.tree.reload();
  }

  setDetails(changes: Partial<Details>): void {
    this.details = { ...this.details, ...changes };
    this.tree.reload();
  }

  private rows(): Row[] {
    const status = this.statusDetail
      ? `${STATUS_LABELS[this.status]} — ${this.statusDetail}`
      : STATUS_LABELS[this.status];
    return [
      {
        id: "status",
        label: "Status",
        value: status,
        image: STATUS_IMAGES[this.status],
      },
      { id: "jdk", label: "JDK", value: this.details.javaHome },
      { id: "server", label: "Language server", value: this.details.serverPath },
      { id: "root", label: "Project root", value: this.details.projectRoot },
      {
        id: "gradlew",
        label: "Gradle wrapper",
        value: this.details.gradleWrapper,
      },
    ];
  }

  getChildren(element: string | null): string[] {
    return element == null ? this.rows().map((r) => r.id) : [];
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
