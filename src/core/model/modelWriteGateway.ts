import type { FactRegistry } from "../facts/factRegistry";
import type { SymbolRegistry } from "../symbols/symbolRegistry";
import type { ModelCore, ModelNode, NodeId } from "./modelCore";

export interface ModelWriteGatewayDeps {
  modelCore: ModelCore;
  factRegistry: FactRegistry;
  symbolRegistry: SymbolRegistry;
}

export class ModelWriteGateway {
  public constructor(private readonly deps: ModelWriteGatewayDeps) {}

  public upsertNode(node: ModelNode): void {
    this.deps.modelCore.upsertNode(node);
    this.deps.factRegistry.invalidateNode(node.id);
    this.deps.symbolRegistry.refreshNode(node.id);
  }

  public removeNode(nodeId: NodeId): void {
    this.deps.modelCore.removeNode(nodeId);
    this.deps.factRegistry.invalidateNode(nodeId);
    this.deps.symbolRegistry.refreshNode(nodeId);
  }
}

