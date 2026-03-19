export type NodeId = string;

export interface ModelNode {
  id: NodeId;
  kind: "document" | "feature" | "primitive" | "form" | "generatorOutput" | "virtual";
  source: {
    uri?: string;
    provider: "file" | "generator" | "runtime";
    identityKey: string;
  };
  content?: {
    normalizedHash?: string;
    versionToken?: string;
  };
  payload?: unknown;
}

export interface ModelIndexes {
  formsByIdent: Map<string, NodeId[]>;
  featuresByKey: Map<string, NodeId[]>;
  primitivesByKey: Map<string, NodeId[]>;
  symbolsByKey: Map<string, NodeId[]>;
  urisToNodeId: Map<string, NodeId>;
}

export class ModelCore {
  private readonly nodesById = new Map<NodeId, ModelNode>();
  private readonly indexes: ModelIndexes = {
    formsByIdent: new Map(),
    featuresByKey: new Map(),
    primitivesByKey: new Map(),
    symbolsByKey: new Map(),
    urisToNodeId: new Map()
  };
  private version = 0;

  public getVersion(): number {
    return this.version;
  }

  public getNodesById(): ReadonlyMap<NodeId, ModelNode> {
    return this.nodesById;
  }

  public getIndexes(): Readonly<ModelIndexes> {
    return this.indexes;
  }

  public upsertNode(node: ModelNode): void {
    this.nodesById.set(node.id, node);
    if (node.source.uri) {
      this.indexes.urisToNodeId.set(node.source.uri, node.id);
    }
    this.version++;
  }

  public getNode(nodeId: NodeId): ModelNode | undefined {
    return this.nodesById.get(nodeId);
  }

  public getNodeByUri(uri: string): ModelNode | undefined {
    const nodeId = this.indexes.urisToNodeId.get(uri);
    if (!nodeId) {
      return undefined;
    }
    return this.nodesById.get(nodeId);
  }

  public removeNode(nodeId: NodeId): void {
    const existing = this.nodesById.get(nodeId);
    if (existing?.source.uri) {
      this.indexes.urisToNodeId.delete(existing.source.uri);
    }
    this.nodesById.delete(nodeId);
    this.version++;
  }

  public getStats(): { version: number; nodes: number; indexedUris: number } {
    return {
      version: this.version,
      nodes: this.nodesById.size,
      indexedUris: this.indexes.urisToNodeId.size
    };
  }
}
