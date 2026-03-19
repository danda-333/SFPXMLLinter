import * as vscode from "vscode";
import { WorkspaceIndex } from "../../indexer/types";
import { parseDocumentFactsFromText } from "../../indexer/xmlFacts";

export interface DependencyValidationServiceDeps {
  getTemplateIndex: () => WorkspaceIndex;
  getRuntimeIndex: () => WorkspaceIndex;
  isReindexRelevantUri: (uri: vscode.Uri) => boolean;
  shouldValidateUriForActiveProjects: (uri: vscode.Uri) => boolean;
  enqueueValidationHigh: (uri: vscode.Uri) => void;
  enqueueValidationLow: (uri: vscode.Uri) => void;
  logIndex: (message: string) => void;
}

export interface DependencyRevalidationStats {
  forms: number;
  files: number;
  immediateOpen: number;
  queuedLow: number;
  durationMs: number;
}

export class DependencyValidationService {
  private dependentUrisByFormIdentCache = new Map<string, vscode.Uri[]>();
  private dependentUrisCacheDirty = true;

  public constructor(private readonly deps: DependencyValidationServiceDeps) {}

  public markDependentUrisDirty(): void {
    this.dependentUrisCacheDirty = true;
  }

  public collectAffectedFormIdentsForComponent(componentKey: string): Set<string> {
    const out = new Set<string>();
    const indexes = [this.deps.getTemplateIndex(), this.deps.getRuntimeIndex()];

    for (const idx of indexes) {
      const candidateKeys = this.collectCandidateComponentKeys(idx, componentKey);
      for (const [, facts] of idx.parsedFactsByUri.entries()) {
        const owningFormIdent = this.getOwningFormIdentFromFacts(facts);
        if (!owningFormIdent) {
          continue;
        }

        const usingHit = facts.usingReferences.some((ref) => candidateKeys.has(ref.componentKey));
        const includeHit = facts.includeReferences.some((ref) => candidateKeys.has(ref.componentKey));
        const placeholderHit = facts.placeholderReferences.some((ref) => ref.componentKey && candidateKeys.has(ref.componentKey));
        if (usingHit || includeHit || placeholderHit) {
          out.add(owningFormIdent);
        }
      }
    }

    return out;
  }

  public enqueueDependentValidationForFormIdents(
    formIdents: ReadonlySet<string>,
    sourceLabel: string
  ): DependencyRevalidationStats | undefined {
    const startedAt = Date.now();
    if (formIdents.size === 0) {
      return undefined;
    }

    const uris = this.collectDependentUrisForFormIdents(formIdents);
    if (uris.length === 0) {
      this.deps.logIndex(`SAVE dependency revalidation skipped (${sourceLabel}): no dependent files for forms=[${[...formIdents].join(", ")}]`);
      return {
        forms: formIdents.size,
        files: 0,
        immediateOpen: 0,
        queuedLow: 0,
        durationMs: Date.now() - startedAt
      };
    }

    let queuedLow = 0;
    let validatedOpenNow = 0;
    const openDocKeys = new Set(vscode.workspace.textDocuments.map((d) => d.uri.toString()));
    for (const uri of uris) {
      if (!this.deps.shouldValidateUriForActiveProjects(uri)) {
        continue;
      }

      if (openDocKeys.has(uri.toString())) {
        this.deps.enqueueValidationHigh(uri);
        validatedOpenNow++;
      } else {
        this.deps.enqueueValidationLow(uri);
        queuedLow++;
      }
    }

    this.deps.logIndex(
      `SAVE dependency revalidation queued (${sourceLabel}): forms=${formIdents.size}, files=${uris.length}, immediateOpen=${validatedOpenNow}, low=${queuedLow}`
    );
    if (uris.length > 0) {
      const preview = uris
        .slice(0, 8)
        .map((uri) => vscode.workspace.asRelativePath(uri, false))
        .join(", ");
      this.deps.logIndex(
        `SAVE dependency targets (${sourceLabel}): ${preview}${uris.length > 8 ? ` ... +${uris.length - 8}` : ""}`
      );
    }
    return {
      forms: formIdents.size,
      files: uris.length,
      immediateOpen: validatedOpenNow,
      queuedLow,
      durationMs: Date.now() - startedAt
    };
  }

  private collectDependentUrisForFormIdents(formIdents: ReadonlySet<string>): vscode.Uri[] {
    if (formIdents.size === 0) {
      return [];
    }

    this.ensureDependentUrisCache();

    const out = new Map<string, vscode.Uri>();
    for (const formIdent of formIdents) {
      const uris = this.dependentUrisByFormIdentCache.get(formIdent);
      if (!uris || uris.length === 0) {
        continue;
      }
      for (const uri of uris) {
        out.set(uri.toString(), uri);
      }
    }

    return [...out.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  private ensureDependentUrisCache(): void {
    if (!this.dependentUrisCacheDirty) {
      return;
    }

    const next = new Map<string, Map<string, vscode.Uri>>();
    const indexes = [this.deps.getTemplateIndex(), this.deps.getRuntimeIndex()];
    for (const idx of indexes) {
      for (const [uriKey, facts] of idx.parsedFactsByUri.entries()) {
        const owningFormIdent = this.getOwningFormIdentFromFacts(facts);
        if (!owningFormIdent) {
          continue;
        }

        const uri = vscode.Uri.parse(uriKey);
        if (uri.scheme !== "file" || !this.deps.isReindexRelevantUri(uri)) {
          continue;
        }

        const byUri = next.get(owningFormIdent) ?? new Map<string, vscode.Uri>();
        byUri.set(uri.toString(), uri);
        next.set(owningFormIdent, byUri);
      }
    }

    this.dependentUrisByFormIdentCache = new Map(
      [...next.entries()].map(([formIdent, urisByKey]) => [
        formIdent,
        [...urisByKey.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath))
      ])
    );
    this.dependentUrisCacheDirty = false;
  }

  private collectCandidateComponentKeys(index: WorkspaceIndex, componentKey: string): Set<string> {
    const out = new Set<string>([componentKey]);
    const baseName = componentKey.split("/").pop() ?? componentKey;
    const variants = index.componentKeysByBaseName.get(baseName);
    if (variants) {
      for (const variant of variants) {
        out.add(variant);
      }
    }
    return out;
  }

  private getOwningFormIdentFromFacts(
    facts: ReturnType<typeof parseDocumentFactsFromText>
  ): string | undefined {
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root === "form") {
      return facts.formIdent;
    }

    if (root === "workflow") {
      return facts.workflowFormIdent ?? facts.rootFormIdent;
    }

    if (root === "dataview") {
      return facts.rootFormIdent;
    }

    return undefined;
  }
}
