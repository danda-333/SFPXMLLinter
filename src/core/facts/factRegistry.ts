import { NodeId } from "../model/modelCore";

export type FactKind = string;

export interface FactProvider {
  kind: FactKind;
  provides?: FactKind[];
  requires?: FactKind[];
  invalidateOn?: Array<"textChange" | "composeChange" | "settingsChange">;
  collect(nodeId: NodeId): unknown;
}

export class FactRegistry {
  private readonly providers = new Map<FactKind, FactProvider>();
  private readonly factsByNode = new Map<NodeId, Map<FactKind, unknown>>();
  private readonly collectInProgress = new Set<string>();
  private readonly hitsByFactKind = new Map<FactKind, number>();
  private readonly missesByFactKind = new Map<FactKind, number>();
  private readonly requestedByConsumer = new Map<string, Set<FactKind>>();

  public register(provider: FactProvider): void {
    this.providers.set(provider.kind, provider);
  }

  public hasProvider(kind: FactKind): boolean {
    return this.providers.has(kind);
  }

  public getProviderKinds(): readonly FactKind[] {
    return [...this.providers.keys()].sort((a, b) => a.localeCompare(b));
  }

  public getMissingDependencies(): Array<{ factKind: FactKind; missing: FactKind[] }> {
    const out: Array<{ factKind: FactKind; missing: FactKind[] }> = [];
    for (const provider of this.providers.values()) {
      const requires = provider.requires ?? [];
      const missing = requires.filter((kind) => !this.providers.has(kind));
      if (missing.length === 0) {
        continue;
      }
      out.push({
        factKind: provider.kind,
        missing: missing.sort((a, b) => a.localeCompare(b))
      });
    }
    return out.sort((a, b) => a.factKind.localeCompare(b.factKind));
  }

  public getFact(nodeId: NodeId, kind: FactKind, consumerId?: string): unknown | undefined {
    if (consumerId) {
      const used = this.requestedByConsumer.get(consumerId) ?? new Set<FactKind>();
      used.add(kind);
      this.requestedByConsumer.set(consumerId, used);
    }

    const cache = this.factsByNode.get(nodeId);
    if (cache?.has(kind)) {
      this.hitsByFactKind.set(kind, (this.hitsByFactKind.get(kind) ?? 0) + 1);
      return cache.get(kind);
    }

    const provider = this.providers.get(kind);
    if (!provider) {
      this.missesByFactKind.set(kind, (this.missesByFactKind.get(kind) ?? 0) + 1);
      return undefined;
    }

    const inProgressKey = `${nodeId}::${kind}`;
    if (this.collectInProgress.has(inProgressKey)) {
      this.missesByFactKind.set(kind, (this.missesByFactKind.get(kind) ?? 0) + 1);
      return undefined;
    }

    this.collectInProgress.add(inProgressKey);
    let value: unknown;
    try {
      value = provider.collect(nodeId);
    } finally {
      this.collectInProgress.delete(inProgressKey);
    }
    const nodeFacts = cache ?? new Map<FactKind, unknown>();
    nodeFacts.set(kind, value);
    this.factsByNode.set(nodeId, nodeFacts);
    this.hitsByFactKind.set(kind, (this.hitsByFactKind.get(kind) ?? 0) + 1);
    return value;
  }

  public invalidateNode(nodeId: NodeId): void {
    this.factsByNode.delete(nodeId);
  }

  public getStats(): Array<{ factKind: FactKind; hits: number; misses: number }> {
    const kinds = new Set<FactKind>([
      ...this.hitsByFactKind.keys(),
      ...this.missesByFactKind.keys()
    ]);
    return [...kinds]
      .map((kind) => ({
        factKind: kind,
        hits: this.hitsByFactKind.get(kind) ?? 0,
        misses: this.missesByFactKind.get(kind) ?? 0
      }))
      .sort((a, b) => b.hits - a.hits);
  }

  public getDeadFactKinds(): FactKind[] {
    const used = new Set<FactKind>([
      ...this.hitsByFactKind.keys(),
      ...this.missesByFactKind.keys()
    ]);
    return [...this.providers.keys()].filter((kind) => !used.has(kind)).sort((a, b) => a.localeCompare(b));
  }

  public getConsumerUsage(): Array<{ consumerId: string; factKinds: FactKind[] }> {
    return [...this.requestedByConsumer.entries()]
      .map(([consumerId, factKinds]) => ({
        consumerId,
        factKinds: [...factKinds].sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.consumerId.localeCompare(b.consumerId));
  }
}
