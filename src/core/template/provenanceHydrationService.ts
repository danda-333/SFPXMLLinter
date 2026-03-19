import * as vscode from "vscode";
import { TemplateInheritedUsingEntry } from "../../template/buildXmlTemplatesService";
import { TemplateMutationRecord } from "../../template/buildXmlTemplatesCore";
import { IndexedSymbolProvenanceProvider } from "../../indexer/types";

export interface ProvenanceMutationEntry {
  outputFsPath: string;
  mutations: readonly TemplateMutationRecord[];
}

export interface ProvenanceHydrationServiceDeps {
  logComposition: (message: string) => void;
  getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[];
  getWorkspaceFolderForPath: (fsPath: string) => vscode.WorkspaceFolder | undefined;
  collectTemplateMutationTelemetry: (
    folder: vscode.WorkspaceFolder,
    options: { mode: "release"; inheritedUsingsByFormIdent: ReadonlyMap<string, readonly TemplateInheritedUsingEntry[]> },
    targetTemplatePath?: string
  ) => Promise<ReadonlyArray<ProvenanceMutationEntry>>;
  buildInheritedUsingsSnapshotFromIndex: () => ReadonlyMap<string, readonly TemplateInheritedUsingEntry[]>;
  setBuiltSymbolProvidersForUri: (
    outputUri: vscode.Uri,
    providersBySymbolKey: Map<string, IndexedSymbolProvenanceProvider[]>
  ) => void;
  runtimeXmlToTemplatePath: (runtimeFsPath: string) => string;
  isRuntimeXmlUri: (uri: vscode.Uri) => boolean;
  refreshCompositionTree: () => void;
  sleep: (ms: number) => Promise<void>;
}

export class ProvenanceHydrationService {
  private isRunning = false;
  private queuedFullHydration = false;
  private readonly queuedTargetedTemplatePaths = new Set<string>();

  public constructor(private readonly deps: ProvenanceHydrationServiceDeps) {}

  public queueHydration(targetRuntimeUri?: vscode.Uri): void {
    if (targetRuntimeUri?.scheme === "file" && this.deps.isRuntimeXmlUri(targetRuntimeUri)) {
      this.queuedTargetedTemplatePaths.add(this.deps.runtimeXmlToTemplatePath(targetRuntimeUri.fsPath));
    }
    this.queuedFullHydration = true;
    void this.runWorker();
  }

  private async runWorker(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      while (this.queuedFullHydration || this.queuedTargetedTemplatePaths.size > 0) {
        const folders = this.deps.getWorkspaceFolders();
        if (folders.length === 0) {
          this.queuedFullHydration = false;
          this.queuedTargetedTemplatePaths.clear();
          return;
        }

        const inheritedUsingsByFormIdent = this.deps.buildInheritedUsingsSnapshotFromIndex();

        while (this.queuedTargetedTemplatePaths.size > 0) {
          const nextTemplatePath = this.queuedTargetedTemplatePaths.values().next().value as string | undefined;
          if (!nextTemplatePath) {
            break;
          }
          this.queuedTargetedTemplatePaths.delete(nextTemplatePath);
          const folder = this.deps.getWorkspaceFolderForPath(nextTemplatePath)
            ?? folders.find((item) => nextTemplatePath.toLowerCase().startsWith(item.uri.fsPath.toLowerCase()));
          if (!folder) {
            continue;
          }

          const entries = await this.deps.collectTemplateMutationTelemetry(
            folder,
            { mode: "release", inheritedUsingsByFormIdent },
            nextTemplatePath
          );
          const applied = this.applyMutationEntries(entries);
          if (applied > 0) {
            this.deps.logComposition(`[build:provenance] targeted hydration applied outputs=${applied}`);
            this.deps.refreshCompositionTree();
          }
        }

        if (!this.queuedFullHydration) {
          continue;
        }
        this.queuedFullHydration = false;

        const startedAt = Date.now();
        let templateCount = 0;
        let outputCount = 0;
        for (const folder of folders) {
          const entries = await this.deps.collectTemplateMutationTelemetry(
            folder,
            { mode: "release", inheritedUsingsByFormIdent }
          );
          templateCount += entries.length;
          outputCount += this.applyMutationEntries(entries);
          await this.deps.sleep(0);
        }

        if (templateCount > 0) {
          this.deps.logComposition(
            `[build:provenance] background hydration from templates=${templateCount}, outputs=${outputCount} in ${Date.now() - startedAt} ms`
          );
          this.deps.refreshCompositionTree();
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  private applyMutationEntries(entries: ReadonlyArray<ProvenanceMutationEntry>): number {
    let applied = 0;
    for (const entry of entries) {
      const outputUri = vscode.Uri.file(entry.outputFsPath);
      const providersBySymbolKey = this.buildProvidersBySymbolKeyFromMutations(entry.mutations);
      this.deps.setBuiltSymbolProvidersForUri(outputUri, providersBySymbolKey);
      applied++;
    }
    return applied;
  }

  private buildProvidersBySymbolKeyFromMutations(
    mutations: readonly TemplateMutationRecord[]
  ): Map<string, IndexedSymbolProvenanceProvider[]> {
    const out = new Map<string, IndexedSymbolProvenanceProvider[]>();
    const dedupe = new Set<string>();
    for (const mutation of mutations) {
      const provider: IndexedSymbolProvenanceProvider = {
        sourceKind: mutation.source.kind,
        featureKey: mutation.source.featureKey,
        contributionName: mutation.source.contributionName,
        primitiveKey: mutation.source.primitiveKey,
        templateName: mutation.source.templateName,
        confidence: "exact"
      };
      const providerSignature = `${provider.sourceKind}|${provider.featureKey ?? ""}|${provider.contributionName ?? ""}|${provider.primitiveKey ?? ""}|${provider.templateName ?? ""}`;
      for (const symbol of mutation.insertedSymbols) {
        const key = `${symbol.kind}:${symbol.ident}`.toLowerCase();
        const dedupeKey = `${key}|${providerSignature}`;
        if (dedupe.has(dedupeKey)) {
          continue;
        }
        dedupe.add(dedupeKey);
        const bucket = out.get(key) ?? [];
        bucket.push(provider);
        out.set(key, bucket);
      }
    }
    return out;
  }
}

