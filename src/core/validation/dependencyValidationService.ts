import * as vscode from "vscode";
import { WorkspaceIndex } from "../../indexer/types";
import { parseDocumentFacts, parseDocumentFactsFromText } from "../../indexer/xmlFacts";

export interface DependencyValidationServiceDeps {
  getTemplateIndex: () => WorkspaceIndex;
  getRuntimeIndex: () => WorkspaceIndex;
  isReindexRelevantUri: (uri: vscode.Uri) => boolean;
  shouldValidateUriForActiveProjects: (uri: vscode.Uri) => boolean;
  enqueueValidationHigh: (uri: vscode.Uri, options?: { force?: boolean }) => void;
  enqueueValidationLow: (uri: vscode.Uri, options?: { force?: boolean }) => void;
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
  private reverseComponentDependenciesByIndex = new WeakMap<WorkspaceIndex, Map<string, Set<string>>>();

  public constructor(private readonly deps: DependencyValidationServiceDeps) {}

  public markDependentUrisDirty(): void {
    this.dependentUrisCacheDirty = true;
    this.reverseComponentDependenciesByIndex = new WeakMap<WorkspaceIndex, Map<string, Set<string>>>();
  }

  public collectAffectedFormIdentsForComponent(componentKey: string): Set<string> {
    const out = new Set<string>();
    const indexes = [this.deps.getTemplateIndex(), this.deps.getRuntimeIndex()];
    const allCandidateKeys = this.collectTransitiveCandidateComponentKeys(indexes, componentKey);

    for (const idx of indexes) {
      for (const [, facts] of idx.parsedFactsByUri.entries()) {
        const owningFormIdent = this.getOwningFormIdentFromFacts(facts);
        if (!owningFormIdent) {
          continue;
        }

        const usingHit = facts.usingReferences.some((ref) => allCandidateKeys.has(ref.componentKey));
        const includeHit = facts.includeReferences.some((ref) => allCandidateKeys.has(ref.componentKey));
        const placeholderHit = facts.placeholderReferences.some((ref) => ref.componentKey && allCandidateKeys.has(ref.componentKey));
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
    for (const pairUri of this.expandTemplateRuntimeCounterparts(uris)) {
      if (!uris.some((item) => item.toString() === pairUri.toString())) {
        uris.push(pairUri);
      }
    }
    for (const uri of this.collectOpenDocumentUrisForFormIdents(formIdents)) {
      if (!uris.some((item) => item.toString() === uri.toString())) {
        uris.push(uri);
      }
    }
    uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
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
        validatedOpenNow++;
      } else {
        queuedLow++;
      }
      // Save-driven dependency revalidation must be deterministic and fast;
      // route all impacted files through high priority queue to avoid low-priority starvation.
      this.deps.enqueueValidationHigh(uri, { force: true });
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

    return this.collectDependentUrisDirectly(formIdents);
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

        const uri = this.uriFromIndexKey(uriKey);
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

  private collectOpenDocumentUrisForFormIdents(formIdents: ReadonlySet<string>): vscode.Uri[] {
    if (formIdents.size === 0) {
      return [];
    }

    const out = new Map<string, vscode.Uri>();
    for (const document of vscode.workspace.textDocuments) {
      if (document.languageId !== "xml" || document.uri.scheme !== "file") {
        continue;
      }
      if (!this.deps.isReindexRelevantUri(document.uri)) {
        continue;
      }

      const facts = parseDocumentFacts(document);
      const owningFormIdent = this.getOwningFormIdentFromFacts(facts);
      if (!owningFormIdent || !formIdents.has(owningFormIdent)) {
        continue;
      }

      out.set(document.uri.toString(), document.uri);
    }

    return [...out.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
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

  private collectTransitiveCandidateComponentKeys(
    indexes: readonly WorkspaceIndex[],
    rootComponentKey: string
  ): Set<string> {
    const allKnownKeys = new Set<string>();
    const queue: string[] = [];
    const enqueue = (key: string): void => {
      if (allKnownKeys.has(key)) {
        return;
      }
      allKnownKeys.add(key);
      queue.push(key);
    };

    for (const idx of indexes) {
      for (const variant of this.collectCandidateComponentKeys(idx, rootComponentKey)) {
        enqueue(variant);
      }
    }

    while (queue.length > 0) {
      const key = queue.shift();
      if (!key) {
        continue;
      }
      for (const idx of indexes) {
        const reverse = this.getReverseComponentDependencies(idx);
        const expanded = this.collectCandidateComponentKeys(idx, key);
        for (const expandedKey of expanded) {
          const dependents = reverse.get(expandedKey);
          if (!dependents) {
            continue;
          }
          for (const dependentKey of dependents) {
            enqueue(dependentKey);
          }
        }
      }
    }

    return allKnownKeys;
  }

  private getReverseComponentDependencies(index: WorkspaceIndex): Map<string, Set<string>> {
    const cached = this.reverseComponentDependenciesByIndex.get(index);
    if (cached) {
      return cached;
    }

    const reverse = new Map<string, Set<string>>();
    for (const [uriKey, facts] of index.parsedFactsByUri.entries()) {
      const consumerKey = index.componentKeyByUri.get(uriKey);
      if (!consumerKey) {
        continue;
      }

      const referencedKeys = new Set<string>();
      for (const ref of facts.usingReferences) {
        referencedKeys.add(ref.componentKey);
      }
      for (const ref of facts.includeReferences) {
        referencedKeys.add(ref.componentKey);
      }
      for (const ref of facts.placeholderReferences) {
        if (ref.componentKey) {
          referencedKeys.add(ref.componentKey);
        }
      }

      if (referencedKeys.size === 0) {
        continue;
      }

      for (const referencedKey of referencedKeys) {
        const dependents = reverse.get(referencedKey) ?? new Set<string>();
        dependents.add(consumerKey);
        reverse.set(referencedKey, dependents);
      }
    }

    this.reverseComponentDependenciesByIndex.set(index, reverse);
    return reverse;
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

  private uriFromIndexKey(uriKey: string): vscode.Uri {
    if (uriKey.includes("://")) {
      const parsed = vscode.Uri.parse(uriKey);
      if (parsed.scheme === "file") {
        return vscode.Uri.file(parsed.fsPath);
      }
      return parsed;
    }
    return vscode.Uri.file(uriKey);
  }

  private collectFormUrisFromIndexes(formIdents: ReadonlySet<string>): vscode.Uri[] {
    const out = new Map<string, vscode.Uri>();
    const indexes = [this.deps.getTemplateIndex(), this.deps.getRuntimeIndex()];
    for (const idx of indexes) {
      for (const formIdent of formIdents) {
        const form = idx.formsByIdent.get(formIdent);
        if (!form) {
          continue;
        }
        if (form.uri.scheme !== "file" || !this.deps.isReindexRelevantUri(form.uri)) {
          continue;
        }
        out.set(form.uri.toString(), form.uri);
      }
    }
    return [...out.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  private collectDependentUrisDirectly(formIdents: ReadonlySet<string>): vscode.Uri[] {
    const out = new Map<string, vscode.Uri>();
    const indexes = [this.deps.getTemplateIndex(), this.deps.getRuntimeIndex()];
    for (const idx of indexes) {
      for (const formIdent of formIdents) {
        const form = idx.formsByIdent.get(formIdent);
        if (!form) {
          continue;
        }
        if (form.uri.scheme !== "file" || !this.deps.isReindexRelevantUri(form.uri)) {
          continue;
        }
        out.set(form.uri.toString(), form.uri);
      }

      for (const [uriKey, facts] of idx.parsedFactsByUri.entries()) {
        const owningFormIdent = this.getOwningFormIdentFromFacts(facts);
        if (!owningFormIdent || !formIdents.has(owningFormIdent)) {
          continue;
        }

        const uri = this.uriFromIndexKey(uriKey);
        if (uri.scheme !== "file" || !this.deps.isReindexRelevantUri(uri)) {
          continue;
        }

        out.set(uri.toString(), uri);
      }
    }
    return [...out.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  private expandTemplateRuntimeCounterparts(uris: readonly vscode.Uri[]): vscode.Uri[] {
    const out = new Map<string, vscode.Uri>();
    for (const uri of uris) {
      if (uri.scheme !== "file") {
        continue;
      }
      const normalized = uri.fsPath.replace(/\\/g, "/");
      const counterpartPath = this.swapTemplateRuntimePath(normalized);
      if (!counterpartPath || counterpartPath === normalized) {
        continue;
      }
      const counterpart = vscode.Uri.file(counterpartPath);
      if (!this.deps.isReindexRelevantUri(counterpart)) {
        continue;
      }
      out.set(counterpart.toString(), counterpart);
    }
    return [...out.values()];
  }

  private swapTemplateRuntimePath(fsPathNormalized: string): string | undefined {
    const templateSwapped = fsPathNormalized.replace(/\/xml_templates\//i, "/XML/");
    if (templateSwapped !== fsPathNormalized) {
      return templateSwapped;
    }

    const runtimeSwapped = fsPathNormalized.replace(/\/xml\//i, "/XML_Templates/");
    if (runtimeSwapped !== fsPathNormalized) {
      return runtimeSwapped;
    }

    return undefined;
  }
}
