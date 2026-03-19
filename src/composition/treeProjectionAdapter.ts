import type { ParsedDocumentFacts } from "../indexer/xmlFacts";
import type { WorkspaceIndex } from "../indexer/types";
import type { FeatureManifestRegistry } from "./workspace";
import type { FeatureCapabilityReport } from "./model";

export interface ProjectionTreeNode {
  id?: string;
  type: string;
  label: string;
  children?: ProjectionTreeNode[];
}

export interface CompositionProjectionSnapshot {
  documentUri: string;
  documentVersion: number;
  relativePath: string;
  facts: ParsedDocumentFacts;
  index: WorkspaceIndex;
  registry: FeatureManifestRegistry;
}

export interface CompositionProjectionDeps<NodeT extends ProjectionTreeNode> {
  findFeatureForRelativePath: (registry: FeatureManifestRegistry, relativePath: string) => FeatureCapabilityReport | undefined;
  buildFeatureTree: (report: FeatureCapabilityReport, registry: FeatureManifestRegistry, index: WorkspaceIndex, documentUri: string) => NodeT[];
  buildRegularXmlTree: (documentUri: string, facts: ParsedDocumentFacts, index: WorkspaceIndex) => NodeT[];
  buildUsingTree: (documentUri: string, facts: ParsedDocumentFacts, index: WorkspaceIndex) => NodeT[];
  infoNode: (label: string) => NodeT;
}

export function buildCompositionProjection<NodeT extends ProjectionTreeNode>(
  snapshot: CompositionProjectionSnapshot,
  deps: CompositionProjectionDeps<NodeT>
): NodeT[] {
  const featureReport = deps.findFeatureForRelativePath(snapshot.registry, snapshot.relativePath);
  if (featureReport) {
    return deps.buildFeatureTree(featureReport, snapshot.registry, snapshot.index, snapshot.documentUri);
  }

  const regularXmlTree = deps.buildRegularXmlTree(snapshot.documentUri, snapshot.facts, snapshot.index);
  if (regularXmlTree.length > 0) {
    return regularXmlTree;
  }

  const usingTree = deps.buildUsingTree(snapshot.documentUri, snapshot.facts, snapshot.index);
  if (usingTree.length > 0) {
    return usingTree;
  }

  return [deps.infoNode(`No feature composition or Using impact available for '${snapshot.relativePath}'.`)];
}
