import * as vscode from "vscode";
import { NodeId } from "../model/modelCore";

export type SymbolKind = string;
export type SymbolKey = `${SymbolKind}:${string}`;

export interface SymbolDef {
  key: SymbolKey;
  kind: SymbolKind;
  ident: string;
  nodeId: NodeId;
  range?: vscode.Range;
}

export interface SymbolRef {
  target: SymbolKey;
  kind: SymbolKind;
  ident: string;
  nodeId: NodeId;
  range?: vscode.Range;
}

export interface SymbolResolver {
  kind: SymbolKind;
  collectDefs(nodeId: NodeId): SymbolDef[];
  collectRefs(nodeId: NodeId): SymbolRef[];
}

export class SymbolRegistry {
  private readonly resolvers = new Map<SymbolKind, SymbolResolver>();
  private readonly defsByNode = new Map<NodeId, SymbolDef[]>();
  private readonly refsByNode = new Map<NodeId, SymbolRef[]>();
  private readonly defsByKind = new Map<SymbolKind, Map<string, SymbolDef[]>>();
  private readonly refsByKind = new Map<SymbolKind, Map<string, SymbolRef[]>>();

  public registerResolver(resolver: SymbolResolver): void {
    this.resolvers.set(resolver.kind, resolver);
  }

  public hasResolver(kind: SymbolKind): boolean {
    return this.resolvers.has(kind);
  }

  public getResolverKinds(): readonly SymbolKind[] {
    return [...this.resolvers.keys()].sort((a, b) => a.localeCompare(b));
  }

  public refreshNode(nodeId: NodeId): void {
    this.removeNodeFromKindIndexes(nodeId);
    const defs: SymbolDef[] = [];
    const refs: SymbolRef[] = [];
    for (const resolver of this.resolvers.values()) {
      defs.push(...resolver.collectDefs(nodeId));
      refs.push(...resolver.collectRefs(nodeId));
    }
    this.defsByNode.set(nodeId, defs);
    this.refsByNode.set(nodeId, refs);
    this.indexNodeSymbols(nodeId, defs, refs);
  }

  public getDefs(nodeId: NodeId): readonly SymbolDef[] {
    return this.defsByNode.get(nodeId) ?? [];
  }

  public getDefsByKind(nodeId: NodeId, kind: SymbolKind): readonly SymbolDef[] {
    const defs = this.defsByNode.get(nodeId);
    if (!defs) {
      return [];
    }
    return defs.filter((def) => def.kind === kind);
  }

  public getRefsByKind(nodeId: NodeId, kind: SymbolKind): readonly SymbolRef[] {
    const refs = this.refsByNode.get(nodeId);
    if (!refs) {
      return [];
    }
    return refs.filter((ref) => ref.kind === kind);
  }

  public getDefsForKind(kind: SymbolKind): ReadonlyMap<string, readonly SymbolDef[]> {
    const bucket = this.defsByKind.get(kind);
    if (!bucket) {
      return new Map();
    }
    return bucket;
  }

  public getRefsForKind(kind: SymbolKind): ReadonlyMap<string, readonly SymbolRef[]> {
    const bucket = this.refsByKind.get(kind);
    if (!bucket) {
      return new Map();
    }
    return bucket;
  }

  public getRefs(nodeId: NodeId): readonly SymbolRef[] {
    return this.refsByNode.get(nodeId) ?? [];
  }

  private indexNodeSymbols(nodeId: NodeId, defs: readonly SymbolDef[], refs: readonly SymbolRef[]): void {
    for (const def of defs) {
      const byIdent = this.defsByKind.get(def.kind) ?? new Map<string, SymbolDef[]>();
      const entries = byIdent.get(def.ident) ?? [];
      entries.push(def);
      byIdent.set(def.ident, entries);
      this.defsByKind.set(def.kind, byIdent);
    }

    for (const ref of refs) {
      const byIdent = this.refsByKind.get(ref.kind) ?? new Map<string, SymbolRef[]>();
      const entries = byIdent.get(ref.ident) ?? [];
      entries.push(ref);
      byIdent.set(ref.ident, entries);
      this.refsByKind.set(ref.kind, byIdent);
    }
  }

  private removeNodeFromKindIndexes(nodeId: NodeId): void {
    const oldDefs = this.defsByNode.get(nodeId) ?? [];
    for (const def of oldDefs) {
      const byIdent = this.defsByKind.get(def.kind);
      if (!byIdent) {
        continue;
      }
      const entries = byIdent.get(def.ident);
      if (!entries) {
        continue;
      }
      const filtered = entries.filter((item) => item.nodeId !== nodeId);
      if (filtered.length === 0) {
        byIdent.delete(def.ident);
      } else {
        byIdent.set(def.ident, filtered);
      }
      if (byIdent.size === 0) {
        this.defsByKind.delete(def.kind);
      }
    }

    const oldRefs = this.refsByNode.get(nodeId) ?? [];
    for (const ref of oldRefs) {
      const byIdent = this.refsByKind.get(ref.kind);
      if (!byIdent) {
        continue;
      }
      const entries = byIdent.get(ref.ident);
      if (!entries) {
        continue;
      }
      const filtered = entries.filter((item) => item.nodeId !== nodeId);
      if (filtered.length === 0) {
        byIdent.delete(ref.ident);
      } else {
        byIdent.set(ref.ident, filtered);
      }
      if (byIdent.size === 0) {
        this.refsByKind.delete(ref.kind);
      }
    }
  }

  public getStats(): { nodes: number; defs: number; refs: number; resolvers: number } {
    let defs = 0;
    let refs = 0;
    for (const bucket of this.defsByNode.values()) {
      defs += bucket.length;
    }
    for (const bucket of this.refsByNode.values()) {
      refs += bucket.length;
    }
    return {
      nodes: Math.max(this.defsByNode.size, this.refsByNode.size),
      defs,
      refs,
      resolvers: this.resolvers.size
    };
  }
}
