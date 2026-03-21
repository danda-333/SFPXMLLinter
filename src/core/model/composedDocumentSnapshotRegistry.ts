import * as fs from "node:fs";
import * as vscode from "vscode";
import type { ParsedDocumentFacts } from "../../indexer/xmlFacts";
import { parseDocumentFactsFromText } from "../../indexer/xmlFacts";
import type { WorkspaceIndex } from "../../indexer/types";
import { buildDocumentCompositionModel, type DocumentCompositionModel } from "../../composition/documentModel";
import { getParsedFactsByUri, getParsedFactsEntries } from "./indexAccess";
import { parseIndexUriKey } from "./indexUriParser";

export type SnapshotDomain = "template" | "runtime" | "unknown";

export interface ComposedDocumentSnapshot {
  uri: vscode.Uri;
  uriKey: string;
  domain: SnapshotDomain;
  rootTag?: string;
  owningFormIdent?: string;
  sourceFacts: ParsedDocumentFacts;
  sourceIndexKind: "template" | "runtime" | "fs";
  composedUri?: vscode.Uri;
  composedFacts?: ParsedDocumentFacts;
  effectiveComposition?: DocumentCompositionModel;
  symbolCounts: {
    controls: number;
    buttons: number;
    sections: number;
    actionShareCodes: number;
    controlShareCodes: number;
    buttonShareCodes: number;
  };
  updatedAt: number;
}

export interface SnapshotRefreshDeps {
  templateIndex: WorkspaceIndex;
  runtimeIndex: WorkspaceIndex;
  readFileText?: (uri: vscode.Uri) => string | undefined;
}

export class ComposedDocumentSnapshotRegistry {
  private readonly snapshotsByUri = new Map<string, ComposedDocumentSnapshot>();
  private readonly urisByFormIdent = new Map<string, Set<string>>();
  private version = 0;

  public clear(): void {
    if (this.snapshotsByUri.size === 0 && this.urisByFormIdent.size === 0) {
      return;
    }
    this.snapshotsByUri.clear();
    this.urisByFormIdent.clear();
    this.version++;
  }

  public get(uri: vscode.Uri): ComposedDocumentSnapshot | undefined {
    return this.snapshotsByUri.get(uri.toString());
  }

  public getByFormIdent(formIdent: string): ComposedDocumentSnapshot[] {
    const keys = this.urisByFormIdent.get(formIdent);
    if (!keys) {
      return [];
    }
    return [...keys]
      .map((key) => this.snapshotsByUri.get(key))
      .filter((item): item is ComposedDocumentSnapshot => !!item)
      .sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
  }

  public getStats(): { snapshots: number; forms: number } {
    return {
      snapshots: this.snapshotsByUri.size,
      forms: this.urisByFormIdent.size
    };
  }

  public getVersion(): number {
    return this.version;
  }

  public refreshForUris(uris: readonly vscode.Uri[], deps: SnapshotRefreshDeps): number {
    let updated = 0;
    for (const uri of uris) {
      if (uri.scheme !== "file") {
        continue;
      }
      const next = this.buildSnapshotForUri(uri, deps);
      if (!next) {
        continue;
      }
      this.upsert(next);
      updated++;
    }
    return updated;
  }

  public refreshForFormIdents(formIdents: ReadonlySet<string>, deps: SnapshotRefreshDeps): number {
    if (formIdents.size === 0) {
      return 0;
    }
    const uris = this.collectUrisForFormIdents(formIdents, deps.templateIndex, deps.runtimeIndex);
    return this.refreshForUris(uris, deps);
  }

  private upsert(snapshot: ComposedDocumentSnapshot): void {
    const key = snapshot.uriKey;
    const prev = this.snapshotsByUri.get(key);
    if (prev?.owningFormIdent) {
      this.removeFormBinding(prev.owningFormIdent, key);
    }
    this.snapshotsByUri.set(key, snapshot);
    if (snapshot.owningFormIdent) {
      const bucket = this.urisByFormIdent.get(snapshot.owningFormIdent) ?? new Set<string>();
      bucket.add(key);
      this.urisByFormIdent.set(snapshot.owningFormIdent, bucket);
    }
    this.version++;
  }

  private removeFormBinding(formIdent: string, uriKey: string): void {
    const bucket = this.urisByFormIdent.get(formIdent);
    if (!bucket) {
      return;
    }
    bucket.delete(uriKey);
    if (bucket.size === 0) {
      this.urisByFormIdent.delete(formIdent);
    }
  }

  private buildSnapshotForUri(uri: vscode.Uri, deps: SnapshotRefreshDeps): ComposedDocumentSnapshot | undefined {
    const uriKey = uri.toString();
    const templateFacts = getParsedFactsByUri(deps.templateIndex, uri);
    const runtimeFacts = getParsedFactsByUri(deps.runtimeIndex, uri);
    const domain = detectDomain(uri);
    const sourceFacts = templateFacts ?? runtimeFacts ?? this.readFactsFromFs(uri, deps.readFileText);
    if (!sourceFacts) {
      return undefined;
    }

    const sourceIndex = templateFacts
      ? deps.templateIndex
      : runtimeFacts
        ? deps.runtimeIndex
        : domain === "runtime"
          ? deps.runtimeIndex
          : deps.templateIndex;

    const composedUri = domain === "template" ? toRuntimeUri(uri) : undefined;
    const composedFacts = composedUri
      ? getParsedFactsByUri(deps.runtimeIndex, composedUri) ?? this.readFactsFromFs(composedUri, deps.readFileText)
      : undefined;

    const effectiveComposition = domain === "template"
      ? buildDocumentCompositionModel(sourceFacts, sourceIndex)
      : undefined;
    const symbolSource = composedFacts ?? sourceFacts;

    return {
      uri,
      uriKey,
      domain,
      rootTag: sourceFacts.rootTag,
      owningFormIdent: getOwningFormIdent(sourceFacts),
      sourceFacts,
      sourceIndexKind: templateFacts ? "template" : runtimeFacts ? "runtime" : "fs",
      ...(composedUri ? { composedUri } : {}),
      ...(composedFacts ? { composedFacts } : {}),
      ...(effectiveComposition ? { effectiveComposition } : {}),
      symbolCounts: {
        controls: symbolSource.declaredControls.size,
        buttons: symbolSource.declaredButtons.size,
        sections: symbolSource.declaredSections.size,
        actionShareCodes: symbolSource.declaredActionShareCodes.size,
        controlShareCodes: symbolSource.declaredControlShareCodes.size,
        buttonShareCodes: symbolSource.declaredButtonShareCodes.size
      },
      updatedAt: Date.now()
    };
  }

  private readFactsFromFs(uri: vscode.Uri, reader?: (uri: vscode.Uri) => string | undefined): ParsedDocumentFacts | undefined {
    try {
      const text = reader ? reader(uri) : fs.readFileSync(uri.fsPath, "utf8");
      if (typeof text !== "string") {
        return undefined;
      }
      return parseDocumentFactsFromText(text);
    } catch {
      return undefined;
    }
  }

  private collectUrisForFormIdents(
    formIdents: ReadonlySet<string>,
    templateIndex: WorkspaceIndex,
    runtimeIndex: WorkspaceIndex
  ): vscode.Uri[] {
    const out = new Map<string, vscode.Uri>();
    const collect = (index: WorkspaceIndex): void => {
      for (const entry of getParsedFactsEntries(index, undefined, parseIndexUriKey)) {
        const uri = entry.uri;
        const facts = entry.facts;
        const formIdent = getOwningFormIdent(facts);
        if (!formIdent || !formIdents.has(formIdent)) {
          continue;
        }
        if (uri.scheme !== "file") {
          continue;
        }
        out.set(uri.toString(), uri);
      }
    };
    collect(templateIndex);
    collect(runtimeIndex);
    return [...out.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }
}

function getOwningFormIdent(facts: ParsedDocumentFacts): string | undefined {
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

function detectDomain(uri: vscode.Uri): SnapshotDomain {
  const normalized = uri.fsPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/xml_templates/")) {
    return "template";
  }
  if (normalized.includes("/xml/")) {
    return "runtime";
  }
  return "unknown";
}

function toRuntimeUri(templateUri: vscode.Uri): vscode.Uri | undefined {
  const fsPath = templateUri.fsPath.replace(/\\/g, "/");
  const swapped = fsPath.replace(/\/xml_templates\//i, "/XML/");
  if (swapped === fsPath) {
    return undefined;
  }
  return vscode.Uri.file(swapped);
}
