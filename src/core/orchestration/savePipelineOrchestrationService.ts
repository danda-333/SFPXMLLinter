import * as vscode from "vscode";
import { parseDocumentFactsFromText } from "../../indexer/xmlFacts";
import { WorkspaceIndexer } from "../../indexer/workspaceIndexer";
import { WorkspaceIndex } from "../../indexer/types";
import { DependencyValidationService, DependencyValidationServiceDeps } from "../validation/dependencyValidationService";
import { UpdateOrchestrator, UpdateOrchestratorHooks } from "../../orchestrator/updateOrchestrator";

export interface SavePipelineOrchestrationDeps {
  getTemplateIndex: () => WorkspaceIndex;
  getRuntimeIndex: () => WorkspaceIndex;
  getFactsForUri?: (uri: vscode.Uri, index: WorkspaceIndex) => ReturnType<typeof parseDocumentFactsFromText> | undefined;
  isReindexRelevantUri: (uri: vscode.Uri) => boolean;
  shouldValidateUriForActiveProjects: (uri: vscode.Uri) => boolean;
  enqueueValidationHigh: (uri: vscode.Uri, options?: { force?: boolean; sourceLabel?: string; snapshotVersion?: number }) => void;
  enqueueValidationLow: (uri: vscode.Uri, options?: { force?: boolean; sourceLabel?: string; snapshotVersion?: number }) => void;
  logIndex: (message: string) => void;
  getIndexerForUri: (uri: vscode.Uri) => WorkspaceIndexer;
  onStructureUpdated: () => void;
  triggerAutoBuild: (document: vscode.TextDocument, componentKeyHint?: string) => Promise<void>;
  queueFullReindex: () => void;
  getCurrentSnapshotVersion: () => number;
  onSavePerformance?: UpdateOrchestratorHooks["onSavePerformance"];
  onPostSave?: UpdateOrchestratorHooks["onPostSave"];
}

export interface SavePipelineOrchestration {
  dependencyValidationService: DependencyValidationService;
  updateOrchestrator: UpdateOrchestrator;
}

export function createSavePipelineOrchestration(deps: SavePipelineOrchestrationDeps): SavePipelineOrchestration {
  const dependencyDeps: DependencyValidationServiceDeps = {
    getTemplateIndex: deps.getTemplateIndex,
    getRuntimeIndex: deps.getRuntimeIndex,
    getFactsForUri: deps.getFactsForUri,
    isReindexRelevantUri: deps.isReindexRelevantUri,
    shouldValidateUriForActiveProjects: deps.shouldValidateUriForActiveProjects,
    enqueueValidationHigh: deps.enqueueValidationHigh,
    enqueueValidationLow: deps.enqueueValidationLow,
    logIndex: deps.logIndex
  };
  const dependencyValidationService = new DependencyValidationService(dependencyDeps);

  const updateHooks: UpdateOrchestratorHooks = {
    log: deps.logIndex,
    isReindexRelevantUri: deps.isReindexRelevantUri,
    refreshIncremental: (document) => {
      const indexer = deps.getIndexerForUri(document.uri);
      const refreshed = indexer.refreshXmlDocument(document);
      if (refreshed.rootKind === "form" || refreshed.rootKind === "workflow" || refreshed.rootKind === "dataview") {
        deps.onStructureUpdated();
      }
      return refreshed;
    },
    collectAffectedFormIdentsForComponent: (componentKey) =>
      dependencyValidationService.collectAffectedFormIdentsForComponent(componentKey),
    enqueueDependentValidationForFormIdents: (formIdents, sourceLabel, options) =>
      dependencyValidationService.enqueueDependentValidationForFormIdents(formIdents, sourceLabel, options),
    triggerAutoBuild: deps.triggerAutoBuild,
    queueFullReindex: deps.queueFullReindex,
    getCurrentSnapshotVersion: deps.getCurrentSnapshotVersion,
    onSavePerformance: deps.onSavePerformance,
    onPostSave: deps.onPostSave
  };
  const updateOrchestrator = new UpdateOrchestrator(updateHooks);

  return {
    dependencyValidationService,
    updateOrchestrator
  };
}

