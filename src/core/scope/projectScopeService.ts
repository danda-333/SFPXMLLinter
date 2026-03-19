import * as vscode from "vscode";
import { WorkspaceIndex } from "../../indexer/types";

export interface ProjectScopeServiceDeps {
  log: (message: string) => void;
  getProjectKeyForUri: (uri: vscode.Uri) => string | undefined;
  isReindexRelevantUri: (uri: vscode.Uri) => boolean;
  isUserOpenDocument: (uri: vscode.Uri) => boolean;
  getUserOpenUris: () => readonly vscode.Uri[];
  getTemplateIndex: () => WorkspaceIndex;
  getRuntimeIndex: () => WorkspaceIndex;
  diagnosticsForEach: (callback: (uri: vscode.Uri) => void) => void;
  deleteDiagnostics: (uri: vscode.Uri) => void;
  globConfiguredXmlFiles: () => Promise<readonly vscode.Uri[]>;
  enqueueWorkspaceValidation: (uris: readonly vscode.Uri[]) => void;
}

export class ProjectScopeService {
  private activeProjectScopeKey: string | undefined;
  private multiProjectCache:
    | {
        signature: string;
        value: boolean;
      }
    | undefined;

  public constructor(private readonly deps: ProjectScopeServiceDeps) {}

  public ensureInitialized(): void {
    if (this.activeProjectScopeKey) {
      return;
    }

    const candidate = this.deps.getUserOpenUris()
      .filter((uri) => uri.scheme === "file")
      .map((uri) => this.deps.getProjectKeyForUri(uri))
      .find((v): v is string => !!v);
    if (!candidate) {
      return;
    }

    this.activeProjectScopeKey = candidate;
    this.deps.log(`PROJECT scope initialized: ${candidate}`);
  }

  public shouldValidateUriForActiveProjects(uri: vscode.Uri): boolean {
    if (!this.deps.isReindexRelevantUri(uri)) {
      return true;
    }

    if (!this.isWorkspaceMultiProject()) {
      return true;
    }

    if (!this.activeProjectScopeKey) {
      return true;
    }

    const projectKey = this.deps.getProjectKeyForUri(uri);
    if (!projectKey) {
      return true;
    }

    if (projectKey === this.activeProjectScopeKey) {
      return true;
    }

    return this.deps.isUserOpenDocument(uri);
  }

  public clearDiagnosticsOutsideActiveProjects(): void {
    if (!this.isWorkspaceMultiProject() || !this.activeProjectScopeKey) {
      return;
    }

    this.deps.diagnosticsForEach((uri) => {
      const projectKey = this.deps.getProjectKeyForUri(uri);
      if (!projectKey) {
        return;
      }

      if (projectKey !== this.activeProjectScopeKey && !this.deps.isUserOpenDocument(uri)) {
        this.deps.deleteDiagnostics(uri);
      }
    });
  }

  public async switchToUri(uri: vscode.Uri): Promise<void> {
    if (!this.isWorkspaceMultiProject()) {
      this.deps.log("PROJECT scope switch skipped: workspace is not multi-project.");
      return;
    }

    const next = this.deps.getProjectKeyForUri(uri);
    if (!next) {
      this.deps.log("PROJECT scope switch skipped: active file is outside configured XML roots.");
      return;
    }

    if (next === this.activeProjectScopeKey) {
      this.deps.log(`PROJECT scope unchanged: ${next}`);
      return;
    }

    const prev = this.activeProjectScopeKey;
    this.activeProjectScopeKey = next;
    this.deps.log(`PROJECT scope switched: ${prev ?? "<none>"} -> ${next}`);
    this.clearDiagnosticsOutsideActiveProjects();

    const uris = (await this.deps.globConfiguredXmlFiles())
      .filter((u) => u.scheme === "file")
      .filter((u) => this.deps.getProjectKeyForUri(u) === next);
    this.deps.log(`PROJECT scope validation queued for ${uris.length} file(s).`);
    this.deps.enqueueWorkspaceValidation(uris);
  }

  public isWorkspaceMultiProject(): boolean {
    const signature = this.computeWorkspaceTopologySignature();
    if (this.multiProjectCache && this.multiProjectCache.signature === signature) {
      return this.multiProjectCache.value;
    }

    const projectKeys = new Set<string>();
    const collect = (uri: vscode.Uri): void => {
      const key = this.deps.getProjectKeyForUri(uri);
      if (key) {
        projectKeys.add(key);
      }
    };

    for (const form of this.deps.getTemplateIndex().formsByIdent.values()) {
      collect(form.uri);
    }
    for (const component of this.deps.getTemplateIndex().componentsByKey.values()) {
      collect(component.uri);
    }
    for (const form of this.deps.getRuntimeIndex().formsByIdent.values()) {
      collect(form.uri);
    }

    const value = projectKeys.size > 1;
    this.multiProjectCache = {
      signature,
      value
    };
    return value;
  }

  private computeWorkspaceTopologySignature(): string {
    const template = this.deps.getTemplateIndex();
    const runtime = this.deps.getRuntimeIndex();
    return [
      `tf:${template.formsByIdent.size}`,
      `tc:${template.componentsByKey.size}`,
      `tp:${template.parsedFactsByUri.size}`,
      `rf:${runtime.formsByIdent.size}`,
      `rp:${runtime.parsedFactsByUri.size}`
    ].join("|");
  }
}
