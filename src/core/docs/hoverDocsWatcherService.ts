import * as vscode from "vscode";

export interface HoverDocsWatcherServiceDeps {
  getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[];
  getHoverDocsFiles: () => readonly string[];
  markDirty: () => void;
}

export class HoverDocsWatcherService implements vscode.Disposable {
  private readonly watchers: vscode.Disposable[] = [];

  public constructor(private readonly deps: HoverDocsWatcherServiceDeps) {}

  public refresh(): void {
    this.disposeWatchers();
    const folders = this.deps.getWorkspaceFolders();
    const docsFiles = this.deps.getHoverDocsFiles();
    for (const folder of folders) {
      for (const docPath of docsFiles) {
        const pattern = new vscode.RelativePattern(folder, docPath);
        const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
        watcher.onDidCreate(() => this.deps.markDirty());
        watcher.onDidChange(() => this.deps.markDirty());
        watcher.onDidDelete(() => this.deps.markDirty());
        this.watchers.push(watcher);
      }
    }
  }

  public dispose(): void {
    this.disposeWatchers();
  }

  private disposeWatchers(): void {
    while (this.watchers.length > 0) {
      this.watchers.pop()?.dispose();
    }
  }
}

