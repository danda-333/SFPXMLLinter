import * as vscode from "vscode";
import { parseDocumentFacts, ParsedDocumentFacts, UsingContributionInsertTrace } from "../indexer/xmlFacts";
import { WorkspaceIndex, IndexedComponentContributionSummary, IndexedForm, IndexedSymbolProvenanceProvider } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { toIndexUriKey } from "../indexer/uriKey";
import { FeatureManifestRegistry } from "./workspace";
import {
  buildDocumentCompositionModel,
  DocumentCompositionModel,
  DocumentUsingContributionModel
} from "./documentModel";
import {
  contributionMatchesDocumentRoot,
} from "./usingImpact";
import { FeatureCapabilityReport } from "./model";
import { normalizeComponentKey } from "../utils/paths";
import { createPrimitiveQuickFixPayload } from "./primitiveQuickFixPayload";
import { buildCompositionProjection } from "./treeProjectionAdapter";
import {
  collectComponentContributionReferenceLocations,
  collectComponentReferenceLocations
} from "../providers/referenceModelUtils";

type CompositionTreeNode =
  | InfoNode
  | FeatureNode
  | PartNode
  | ContributionNode
  | ConflictNode
  | UsingNode
  | DetailNode
  | GroupNode
  | SymbolNode;

interface BaseNode {
  id?: string;
  type: string;
  label: string;
  description?: string;
  tooltip?: string;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  icon?: vscode.ThemeIcon;
  children?: CompositionTreeNode[];
  resourceUri?: vscode.Uri;
  command?: vscode.Command;
  contextValue?: string;
  sourceLocation?: vscode.Location;
  usageLocations?: vscode.Location[];
  sourceNodeId?: string;
  factKind?: string;
  symbolKind?: string;
  statusSourceKey?: string;
}

interface InfoNode extends BaseNode {
  type: "info";
}

interface FeatureNode extends BaseNode {
  type: "feature";
}

interface PartNode extends BaseNode {
  type: "part";
}

interface ContributionNode extends BaseNode {
  type: "contribution";
}

interface ConflictNode extends BaseNode {
  type: "conflict";
}

interface UsingNode extends BaseNode {
  type: "using";
}

interface DetailNode extends BaseNode {
  type: "detail";
}

interface GroupNode extends BaseNode {
  type: "group";
}

interface SymbolNode extends BaseNode {
  type: "symbol";
}

interface AggregatedSymbol {
  ident: string;
  origin: "local" | "injected" | "inherited" | "resolved" | "final";
  source?: string;
  resourceUri?: vscode.Uri;
  sourceLocation?: vscode.Location;
  usageCount?: number;
  usageLocations?: vscode.Location[];
}

interface CachedRootTree {
  documentUri: string;
  documentVersion: number;
  indexRef: WorkspaceIndex;
  factsRef: ParsedDocumentFacts | undefined;
  registryRef: FeatureManifestRegistry;
  relativePath: string;
  nodes: CompositionTreeNode[];
}

export class CompositionTreeProvider implements vscode.TreeDataProvider<CompositionTreeNode> {
  private readonly didChangeTreeDataEmitter = new vscode.EventEmitter<CompositionTreeNode | undefined | null | void>();
  private readonly expandedNodeIds = new Set<string>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private readonly refreshDebounceMs = 75;
  private cachedRootTree: CachedRootTree | undefined;
  private buildState: "ready" | "building" = "ready";

  public readonly onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

  public constructor(
    private readonly getActiveDocument: () => vscode.TextDocument | undefined,
    private readonly getIndexForUri: (uri: vscode.Uri) => WorkspaceIndex,
    private readonly getFeatureRegistry: () => FeatureManifestRegistry,
    private readonly resolveOwningFormForModel?: (formIdent: string, preferredIndex: WorkspaceIndex) => { form: IndexedForm; index: WorkspaceIndex } | undefined
  ) {}

  public refresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.cachedRootTree = undefined;
      this.didChangeTreeDataEmitter.fire();
    }, this.refreshDebounceMs);
  }

  public setBuildState(state: "ready" | "building"): void {
    if (this.buildState === state) {
      return;
    }
    this.buildState = state;
    this.didChangeTreeDataEmitter.fire();
  }

  public setExpanded(nodeId: string | undefined, expanded: boolean): void {
    if (!nodeId) {
      return;
    }

    if (expanded) {
      this.expandedNodeIds.add(nodeId);
    } else {
      this.expandedNodeIds.delete(nodeId);
    }
  }

  public getTreeItem(element: CompositionTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      this.resolveCollapsibleState(element)
    );
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.icon;
    item.contextValue = element.contextValue;
    item.id = element.id;
    if (element.type === "detail" && element.command) {
      item.command = element.command;
    }
    if (element.resourceUri) {
      item.resourceUri = element.resourceUri;
    }
    return item;
  }

  private resolveCollapsibleState(element: CompositionTreeNode): vscode.TreeItemCollapsibleState {
    if (!element.children || element.children.length === 0) {
      return vscode.TreeItemCollapsibleState.None;
    }

    if (element.id) {
      return this.expandedNodeIds.has(element.id)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }

    return element.collapsibleState ?? vscode.TreeItemCollapsibleState.None;
  }

  public getChildren(element?: CompositionTreeNode): CompositionTreeNode[] {
    if (element?.children) {
      return element.children;
    }

    if (element) {
      return [];
    }

    const document = this.getActiveDocument();
    if (!document || document.languageId !== "xml") {
      this.cachedRootTree = undefined;
      return [
        this.buildStatusNode(),
        infoNode("Open an XML file to inspect feature composition and final injected symbols.")
      ];
    }

    const registry = this.getFeatureRegistry();
    const index = this.getIndexForUri(document.uri);
    const documentUri = document.uri.toString();
    const facts = index.parsedFactsByUri.get(documentUri);
    if (!facts) {
      this.cachedRootTree = undefined;
      return [
        this.buildStatusNode(),
        infoNode("Index facts are not available for this document yet. Run Revalidate Workspace/Project.")
      ];
    }
    const relPath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    const cached = this.cachedRootTree;
    if (
      cached &&
      cached.documentUri === documentUri &&
      cached.documentVersion === document.version &&
      cached.indexRef === index &&
      cached.factsRef === facts &&
      cached.registryRef === registry &&
      cached.relativePath === relPath
    ) {
      return [this.buildStatusNode(), ...cached.nodes];
    }

    const nodes = buildCompositionProjection<CompositionTreeNode>(
      {
        documentUri,
        documentVersion: document.version,
        relativePath: relPath,
        facts,
        index,
        registry
      },
      {
        findFeatureForRelativePath,
        buildFeatureTree: (report, reg, idx, uri) => buildFeatureTree(report, reg, idx, vscode.Uri.parse(uri)),
        buildRegularXmlTree: (_uri, factsSnapshot, idx) =>
          buildRegularXmlTree(vscode.Uri.parse(documentUri), relPath, factsSnapshot, idx, this.resolveOwningFormForModel),
        buildUsingTree: (_uri, factsSnapshot, idx) => buildUsingTree(vscode.Uri.parse(documentUri), factsSnapshot, idx),
        infoNode
      }
    );
    this.cachedRootTree = {
      documentUri,
      documentVersion: document.version,
      indexRef: index,
      factsRef: facts,
      registryRef: registry,
      relativePath: relPath,
      nodes
    };
    return [this.buildStatusNode(), ...nodes];
  }

  private buildStatusNode(): InfoNode {
    if (this.buildState === "building") {
      return {
        type: "info",
        id: "status:build",
        label: "Build: Running",
        description: "template build in progress",
        icon: new vscode.ThemeIcon("sync~spin")
      };
    }

    return {
      type: "info",
      id: "status:build",
      label: "Build: Ready",
      description: "outputs are up to date",
      icon: new vscode.ThemeIcon("pass")
    };
  }
}

function buildFeatureTree(
  report: FeatureCapabilityReport,
  registry: FeatureManifestRegistry,
  index: WorkspaceIndex,
  activeUri: vscode.Uri
): CompositionTreeNode[] {
  const model = registry.effectiveModelsByFeature.get(report.feature);
  const featureManifest = registry.manifestsByFeature.get(report.feature);
  const featureNodeId = `feature:${report.feature}`;
  const entrypointUri = featureManifest?.entrypoint
    ? vscode.Uri.file(toWorkspacePath(featureManifest.entrypoint, activeUri))
    : undefined;
  const entrypointComponentKey = featureManifest?.entrypoint ? toIndexedComponentKey(featureManifest.entrypoint) : undefined;
  const summaryChildren: CompositionTreeNode[] = [
    detailNode(`Parts: ${report.parts.length}`),
    detailNode(`Provides: ${report.provides.length}`),
    detailNode(`Expects: ${report.expects.length}`),
    detailNode(`Requires: ${report.requires.length}`)
  ];

  if (model) {
    const effective = model.contributions.filter((item) => item.usage === "effective").length;
    const partial = model.contributions.filter((item) => item.usage === "partial").length;
    const unused = model.contributions.filter((item) => item.usage === "unused").length;
    const orderingConflicts = model.conflicts.filter((item) => item.code === "ordering-conflict").length;
    summaryChildren.push(detailNode(`Contributions: ${model.contributions.length}`));
    summaryChildren.push(detailNode(`Usage: effective=${effective}, partial=${partial}, unused=${unused}`));
    summaryChildren.push(detailNode(`Conflicts: ${model.conflicts.length}`));
    summaryChildren.push(detailNode(`Ordering conflicts: ${orderingConflicts}`));
  }

  const partsNode = partGroupNode(
    "Parts",
    report.parts.map((part) => {
      const partComponentKey = toIndexedComponentKey(part.file);
      const contributionReports = model?.contributions.filter((item) => item.partId === part.id) ?? [];
      const partOrderingConflicts = (model?.conflicts ?? []).filter(
        (conflict) => conflict.code === "ordering-conflict" && conflict.itemKeys.includes(`part:${part.id}`)
      );
      const orderingChildren: CompositionTreeNode[] = [];
      if (part.ordering) {
        orderingChildren.push(detailNode(`Group: ${part.ordering.group ?? "(none)"}`));
        orderingChildren.push(detailNode(`Before: ${part.ordering.before.join(", ") || "(none)"}`));
        orderingChildren.push(detailNode(`After: ${part.ordering.after.join(", ") || "(none)"}`));
      } else {
        orderingChildren.push(detailNode("No ordering metadata."));
      }
      if (partOrderingConflicts.length > 0) {
        orderingChildren.push(...partOrderingConflicts.map((conflict, idx) =>
          detailNode(`Conflict ${idx + 1}: ${conflict.message}`)
        ));
      }

      const partChildren: CompositionTreeNode[] = [
        {
          type: "group",
          id: `${featureNodeId}:part:${part.id}:ordering`,
          label: "Ordering",
          description: partOrderingConflicts.length > 0 ? `${partOrderingConflicts.length} conflict(s)` : "ok",
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          icon: new vscode.ThemeIcon(partOrderingConflicts.length > 0 ? "warning" : "list-ordered"),
          children: orderingChildren
        }
      ];
      if (contributionReports.length > 0) {
        partChildren.push(
          ...contributionReports.map((contribution) =>
            ({
              type: "contribution",
              id: `${featureNodeId}:part:${part.id}:contribution:${contribution.name ?? contribution.contributionId}`,
              label: contribution.name ?? contribution.contributionId,
              description: contribution.usage,
              tooltip: [
                contribution.summary,
                contribution.targetXPath ? `Target: ${contribution.targetXPath}` : undefined,
                contribution.insert ? `Insert: ${contribution.insert}` : undefined
              ].filter(Boolean).join("\n"),
              collapsibleState:
                contribution.missingExpectationKeys.length > 0 || contribution.missingExpectedXPaths.length > 0
                  ? vscode.TreeItemCollapsibleState.Collapsed
                  : vscode.TreeItemCollapsibleState.None,
              icon: iconForUsage(contribution.usage),
              contextValue: "compositionContribution",
              resourceUri: featureManifest?.parts.find((item) => item.id === part.id)?.file
                ? vscode.Uri.file(
                    toWorkspacePath(featureManifest.parts.find((item) => item.id === part.id)?.file ?? "", activeUri)
                  )
                : undefined,
              sourceLocation: findContributionLocationForPart(index, partComponentKey, contribution.name ?? contribution.contributionId),
              usageLocations: collectContributionUsageLocations(
                index,
                partComponentKey,
                contribution.name ?? contribution.contributionId,
                entrypointComponentKey
              ),
              children: [
                ...contribution.missingExpectationKeys.map((item) => detailNode(`Missing expect: ${item}`)),
                ...contribution.missingExpectedXPaths.map((item) => detailNode(`Missing xpath: ${item}`))
              ]
            } satisfies ContributionNode)
          )
        );
      } else {
        partChildren.push(detailNode("No contribution reports."));
      }

      return {
        id: `${featureNodeId}:part:${part.id}`,
        type: "part",
        label: part.id,
        description: part.appliesTo.join(", "),
        tooltip: part.file,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        icon: new vscode.ThemeIcon("file-submodule"),
        contextValue: "compositionFeaturePart",
        resourceUri: featureManifest?.parts.find((item) => item.id === part.id)?.file
          ? vscode.Uri.file(
              toWorkspacePath(featureManifest.parts.find((item) => item.id === part.id)?.file ?? "", activeUri)
            )
          : undefined,
        usageLocations: collectPartUsageLocations(index, partComponentKey, entrypointComponentKey),
        children: partChildren
      } satisfies PartNode;
    }),
    sharedSectionNodeId("Parts")
  );

  const conflictsNode = infoGroupNode(
    "Conflicts",
    (model?.conflicts ?? []).length > 0
      ? (model?.conflicts ?? []).map((conflict) => ({
          type: "conflict",
          label: conflict.code,
          description: conflict.itemKeys.length > 0 ? `${conflict.itemKeys.length} item(s)` : undefined,
          tooltip: conflict.message,
          icon: new vscode.ThemeIcon("warning")
        }))
      : [detailNode("No conflicts.")]
    ,
    sharedSectionNodeId("Conflicts")
  );

  return [
    {
      type: "feature",
      id: featureNodeId,
      label: report.feature,
      description: featureManifest?.entrypoint ? "feature" : "auto",
      tooltip: featureManifest?.entrypoint ?? report.feature,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon("symbol-method"),
      contextValue: "compositionFeature",
      resourceUri: entrypointUri,
      usageLocations: collectFeatureUsageLocations(report, index, entrypointComponentKey),
      children: [
        infoGroupNode("Summary", summaryChildren, sharedSectionNodeId("Summary")),
        partsNode,
        conflictsNode
      ]
    }
  ];
}

function buildRegularXmlTree(
  documentUri: vscode.Uri,
  relativePath: string,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  resolveOwningFormForModel?: (formIdent: string, preferredIndex: WorkspaceIndex) => { form: IndexedForm; index: WorkspaceIndex } | undefined
): CompositionTreeNode[] {
  const root = (facts.rootTag ?? "").toLowerCase();
  if (root !== "form" && root !== "workflow" && root !== "dataview") {
    return [];
  }
  const composition = buildDocumentCompositionModel(facts, index);
  const children: CompositionTreeNode[] = [];
  children.push(buildDocumentSummaryNode(documentUri, facts, index, composition, sharedSectionNodeId("Summary")));
  children.push(buildDocumentStatisticsNode(composition, sharedSectionNodeId("Statistics")));
  children.push(buildActionsNode(root, sharedSectionNodeId("Actions"), composition));

  if (root === "form") {
    const resolvedFinalForm =
      facts.formIdent
        ? resolveOwningFormForModel?.(facts.formIdent, index)
        : undefined;
    const finalFormOverlay =
      resolvedFinalForm && resolvedFinalForm.form.uri.toString() !== documentUri.toString()
        ? resolvedFinalForm
        : undefined;

    let controls = aggregateFormControls(documentUri, facts, index, composition);
    let buttons = aggregateFormButtons(documentUri, facts, index, composition);
    let sections = aggregateFormSections(documentUri, facts, index, composition);
    if (finalFormOverlay) {
      controls = overlayFinalIndexedFormSymbols(controls, finalFormOverlay.form, finalFormOverlay.index, "control");
      buttons = overlayFinalIndexedFormSymbols(buttons, finalFormOverlay.form, finalFormOverlay.index, "button");
      sections = overlayFinalIndexedFormSymbols(sections, finalFormOverlay.form, finalFormOverlay.index, "section");
    }
    children.push(buildSymbolGroup("Controls", controls, "symbol-field", sharedSectionNodeId("Controls")));
    children.push(buildSymbolGroup("Buttons", buttons, "symbol-event", sharedSectionNodeId("Buttons")));
    children.push(buildSymbolGroup("Sections", sections, "symbol-structure", sharedSectionNodeId("Sections")));
  } else if (root === "workflow") {
    const controlShareCodes = aggregateWorkflowShareCodes(
      documentUri,
      facts,
      index,
      composition,
      (summary) => summary.workflowControlShareCodeIdents,
      [...facts.declaredControlShareCodes],
      facts.controlShareCodeDefinitions,
      collectWorkflowReferenceLocations(documentUri, facts, "controlShareCode")
    );
    const buttonShareCodes = aggregateWorkflowShareCodes(
      documentUri,
      facts,
      index,
      composition,
      (summary) => summary.workflowButtonShareCodeIdents,
      [...facts.declaredButtonShareCodes],
      facts.buttonShareCodeDefinitions,
      collectWorkflowReferenceLocations(documentUri, facts, "buttonShareCode")
    );
    const actionShareCodes = aggregateWorkflowShareCodes(
      documentUri,
      facts,
      index,
      composition,
      (summary) => summary.workflowActionShareCodeIdents,
      [...facts.declaredActionShareCodes],
      facts.actionShareCodeDefinitions,
      collectActionShareCodeReferenceLocations(documentUri, facts)
    );

    children.push(buildSymbolGroup("ControlShareCodes", controlShareCodes, "symbol-key", sharedSectionNodeId("ControlShareCodes")));
    children.push(buildSymbolGroup("ButtonShareCodes", buttonShareCodes, "symbol-key", sharedSectionNodeId("ButtonShareCodes")));
    children.push(buildSymbolGroup("ActionShareCodes", actionShareCodes, "symbol-key", sharedSectionNodeId("ActionShareCodes")));
  }

  const owningFormIdent = root === "workflow"
    ? facts.workflowFormIdent
    : root === "dataview"
      ? (facts.rootFormIdent ?? facts.formIdent)
      : undefined;
  if ((root === "workflow" || root === "dataview") && owningFormIdent) {
    const resolvedOwningForm = resolveOwningFormForModel?.(owningFormIdent, index);
    if (resolvedOwningForm) {
      const ownerFacts = resolvedOwningForm.index.parsedFactsByUri.get(resolvedOwningForm.form.uri.toString());
      if (ownerFacts) {
        const ownerComposition = buildDocumentCompositionModel(ownerFacts, resolvedOwningForm.index);
        const ownerControls = aggregateFormControls(resolvedOwningForm.form.uri, ownerFacts, resolvedOwningForm.index, ownerComposition);
        const ownerButtons = aggregateFormButtons(resolvedOwningForm.form.uri, ownerFacts, resolvedOwningForm.index, ownerComposition);
        const ownerSections = aggregateFormSections(resolvedOwningForm.form.uri, ownerFacts, resolvedOwningForm.index, ownerComposition);
        children.push({
          id: sharedSectionNodeId("OwningFormSymbols"),
          type: "group",
          label: `Owning Form Symbols (${owningFormIdent})`,
          description: resolvedOwningForm.index === index ? "template" : "runtime",
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          icon: new vscode.ThemeIcon("symbol-file"),
          children: [
            buildSymbolGroup("Controls", ownerControls, "symbol-field", sharedSectionNodeId("OwningFormSymbols.Controls")),
            buildSymbolGroup("Buttons", ownerButtons, "symbol-event", sharedSectionNodeId("OwningFormSymbols.Buttons")),
            buildSymbolGroup("Sections", ownerSections, "symbol-structure", sharedSectionNodeId("OwningFormSymbols.Sections"))
          ]
        });
      }
    }
  }

  const usingTree = buildUsingTree(documentUri, facts, index, composition);
  if (usingTree.length > 0) {
    children.push(...usingTree);
  }
  const includeTree = buildIncludeTree(facts, index);
  if (includeTree.length > 0) {
    children.push(...includeTree);
  }
  const placeholderTree = buildPlaceholderTree(documentUri, facts);
  if (placeholderTree.length > 0) {
    children.push(...placeholderTree);
  }

  return [
    {
      id: sharedSectionNodeId("ModelRoot"),
      type: "group",
      label: root === "form" ? "Final Form Model" : root === "workflow" ? "Final WorkFlow Model" : "Final DataView Model",
      description: relativePath,
      tooltip: documentUri.fsPath,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon(root === "form" ? "file-code" : root === "workflow" ? "symbol-class" : "table"),
      children
    }
  ];
}

function buildDocumentSummaryNode(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  composition: DocumentCompositionModel,
  nodeId: string
): GroupNode {
  const root = (facts.rootTag ?? "").toLowerCase();
  const usingCount = composition.usings.length;
  const knownFeatureCount = composition.usings.filter((usingRef) => usingRef.hasResolvedFeature).length;
  const localControlCount = facts.declaredControlInfos.length;
  const localButtonCount = facts.declaredButtonInfos.length;
  const localSectionCount = facts.identOccurrences.filter((item) => item.kind === "section").length;
  const composedControlSymbols = collectComposedSymbolsFromModel(composition, index, (summary) => summary.formControlIdents);
  const composedButtonSymbols = collectComposedSymbolsFromModel(composition, index, (summary) => summary.formButtonIdents);
  const composedSectionSymbols = collectComposedSymbolsFromModel(composition, index, (summary) => summary.formSectionIdents);
  const injectedControlCount = [...composedControlSymbols.values()].filter((item) => item.origin === "injected").length;
  const inheritedControlCount = [...composedControlSymbols.values()].filter((item) => item.origin === "inherited").length;
  const injectedButtonCount = [...composedButtonSymbols.values()].filter((item) => item.origin === "injected").length;
  const inheritedButtonCount = [...composedButtonSymbols.values()].filter((item) => item.origin === "inherited").length;
  const injectedSectionCount = [...composedSectionSymbols.values()].filter((item) => item.origin === "injected").length;
  const inheritedSectionCount = [...composedSectionSymbols.values()].filter((item) => item.origin === "inherited").length;
  const summary = [
    detailNode(`Root: ${facts.rootTag ?? "(unknown)"}`),
    detailNode(`Ident: ${facts.rootIdent ?? facts.formIdent ?? facts.workflowFormIdent ?? "(none)"}`),
    detailNode(`Usings: ${usingCount}`),
    detailNode(`Resolved features: ${knownFeatureCount}/${usingCount}`)
  ];

  if (root === "workflow" && facts.workflowFormIdent) {
    summary.push(detailNode(`FormIdent: ${facts.workflowFormIdent}`));
    summary.push(detailNode(`Local ControlShareCodes: ${facts.declaredControlShareCodes.size}`));
    summary.push(detailNode(`Local ButtonShareCodes: ${facts.declaredButtonShareCodes.size}`));
    summary.push(detailNode(`Local ActionShareCodes: ${facts.declaredActionShareCodes.size}`));
  } else if (root === "form") {
    summary.push(detailNode(`Local Controls: ${localControlCount}`));
    summary.push(detailNode(`Injected Controls: ${injectedControlCount}`));
    summary.push(detailNode(`Inherited Controls: ${inheritedControlCount}`));
    summary.push(detailNode(`Local Buttons: ${localButtonCount}`));
    summary.push(detailNode(`Injected Buttons: ${injectedButtonCount}`));
    summary.push(detailNode(`Inherited Buttons: ${inheritedButtonCount}`));
    summary.push(detailNode(`Local Sections: ${localSectionCount}`));
    summary.push(detailNode(`Injected Sections: ${injectedSectionCount}`));
    summary.push(detailNode(`Inherited Sections: ${inheritedSectionCount}`));
  }

  return {
    id: nodeId,
    type: "group",
    label: "Summary",
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    icon: new vscode.ThemeIcon("dashboard"),
    children: summary
  };
}

function buildDocumentStatisticsNode(
  composition: DocumentCompositionModel,
  nodeId: string
): GroupNode {
  const usingEffective = composition.usings.filter((item) => item.impactStatus === "effective").length;
  const usingPartial = composition.usings.filter((item) => item.impactStatus === "partial").length;
  const usingUnused = composition.usings.filter((item) => item.impactStatus === "unused").length;
  const usingInert = composition.usings.filter((item) => item.impactStatus === "inert").length;

  let contributionEffective = 0;
  let contributionUnused = 0;
  let totalInsertCount = 0;
  let contributionWithTrace = 0;
  for (const using of composition.usings) {
    for (const contribution of using.contributions) {
      if (contribution.usage === "effective") {
        contributionEffective++;
      } else {
        contributionUnused++;
      }
      totalInsertCount += contribution.insertCount;
      if (contribution.insertTrace) {
        contributionWithTrace++;
      }
    }
  }

  return {
    id: nodeId,
    type: "group",
    label: "Statistics",
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    icon: new vscode.ThemeIcon("graph"),
    children: [
      detailNode(`Using impact: effective=${usingEffective}, partial=${usingPartial}, unused=${usingUnused}, inert=${usingInert}`),
      detailNode(`Contribution usage: effective=${contributionEffective}, unused=${contributionUnused}`),
      detailNode(`Total inserts: ${totalInsertCount}`),
      detailNode(`Insert traces: ${contributionWithTrace}`)
    ]
  };
}

function buildUsingTree(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  compositionModel?: DocumentCompositionModel
): CompositionTreeNode[] {
  const usageLocationsByKey = new Map<string, vscode.Location[]>();
  const ownerByUri = new Map<string, string | undefined>();
  const resolveUsageLocations = (componentKey: string, contributionName?: string): vscode.Location[] => {
    const cacheKey = `${componentKey}#${contributionName ?? "*"}`;
    const cached = usageLocationsByKey.get(cacheKey);
    if (cached) {
      return cached;
    }
    const resolved = getUsingUsageLocations(facts, index, componentKey, contributionName, ownerByUri);
    usageLocationsByKey.set(cacheKey, resolved);
    return resolved;
  };

  const composition = compositionModel ?? buildDocumentCompositionModel(facts, index);
  const effectiveUsings = composition.usings;
  const suppressedUsings = facts.usingReferences.filter((ref) => ref.suppressInheritance);
  if (effectiveUsings.length === 0 && suppressedUsings.length === 0) {
    return [];
  }

  const effectiveNodes = effectiveUsings.map((usingModel) => {
    const component = resolveComponentByKey(index, usingModel.componentKey);
    if (!component || !usingModel.hasResolvedFeature) {
      return {
        type: "using",
        label: usingModel.rawComponentValue,
        description: "missing feature",
        tooltip: usingModel.rawComponentValue,
        icon: new vscode.ThemeIcon("error")
      } satisfies UsingNode;
    }

    const contributionRows = usingModel.contributions.map((contribution) =>
      buildUsingContributionNode(documentUri, facts, index, usingModel, component, contribution, resolveUsageLocations)
    );
    const filteredRows = usingModel.filteredContributions.map((contribution) =>
      buildUsingContributionNode(documentUri, facts, index, usingModel, component, contribution, resolveUsageLocations)
    );
    const placeholderRows = usingModel.placeholderContributions.map((contribution) =>
      buildUsingContributionNode(documentUri, facts, index, usingModel, component, contribution, resolveUsageLocations)
    );
    const filteredPlaceholderRows = usingModel.filteredPlaceholderContributions.map((contribution) =>
      buildUsingContributionNode(documentUri, facts, index, usingModel, component, contribution, resolveUsageLocations)
    );
    const children: CompositionTreeNode[] =
      contributionRows.length > 0 ? [...contributionRows] : [detailNode("No root-relevant contributions found.")];
    if (placeholderRows.length > 0 || filteredPlaceholderRows.length > 0) {
      const groupedPlaceholders = [...placeholderRows, ...filteredPlaceholderRows];
      children.push({
        type: "group",
        id: `using:${usingModel.componentKey}:${usingModel.sectionValue ?? "*"}:placeholders`,
        label: "Placeholders",
        description: `${groupedPlaceholders.length}`,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        icon: new vscode.ThemeIcon("symbol-key"),
        children: groupedPlaceholders
      });
    }
    if (filteredRows.length > 0) {
      children.push({
        type: "group",
        id: `using:${usingModel.componentKey}:${usingModel.sectionValue ?? "*"}:filtered`,
        label: "Filtered",
        description: `${filteredRows.length}`,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        icon: new vscode.ThemeIcon("filter"),
        children: filteredRows
      });
    }

    return {
      id: `using:${usingModel.componentKey}:${usingModel.sectionValue ?? "*"}`,
      type: "using",
      label: usingModel.rawComponentValue,
      description: usingModel.source === "inherited" ? `${usingModel.impactStatus}, inherited` : usingModel.impactStatus,
      statusSourceKey: "composition.using.impactStatus",
      tooltip: usingModel.impact.message ?? usingModel.rawComponentValue,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      icon: iconForUsage(usingModel.impactStatus),
      contextValue: "compositionUsing",
      resourceUri: component.uri,
      sourceNodeId: documentUri.toString(),
      factKind: "fact.usingRefs",
      sourceLocation: usingModel.sectionValue ? component.contributionDefinitions.get(usingModel.sectionValue) : component.componentLocation,
      usageLocations: resolveUsageLocations(usingModel.componentKey, usingModel.sectionValue),
      command: getUsingOpenCommand(component, usingModel.sectionValue),
      children
    } satisfies UsingNode;
  });

  const suppressionNodes = suppressedUsings.map((ref, idx) => {
    const component = resolveComponentByKey(index, ref.componentKey);
    const matchedContributions = countSuppressedInheritedContributions(facts, index, ref.componentKey, ref.sectionValue);
    const label = ref.sectionValue ? `${ref.rawComponentValue}#${ref.sectionValue}` : ref.rawComponentValue;
    const metaChildren: CompositionTreeNode[] = [
      detailNode(`Mode: suppression`),
      detailNode(`BlockedInheritedContributions: ${matchedContributions}`)
    ];
    if (!component) {
      return {
        id: `using:suppression:${idx}`,
        type: "using",
        label,
        description: "suppression, missing feature",
        tooltip: `Suppression for missing feature '${ref.rawComponentValue}'.`,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        icon: new vscode.ThemeIcon("error"),
        children: metaChildren
      } satisfies UsingNode;
    }

    return {
      id: `using:suppression:${ref.componentKey}:${ref.sectionValue ?? "*"}:${idx}`,
      type: "using",
      label,
      description: `suppression, blocked=${matchedContributions}`,
      statusSourceKey: "composition.using.suppression",
      tooltip: `Suppress inherited using for '${label}'.`,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      icon: new vscode.ThemeIcon("shield"),
      contextValue: "compositionUsing",
      resourceUri: component.uri,
      sourceNodeId: documentUri.toString(),
      factKind: "fact.usingRefs",
      sourceLocation: ref.sectionValue ? component.contributionDefinitions.get(ref.sectionValue) : component.componentLocation,
      usageLocations: resolveUsageLocations(ref.componentKey, ref.sectionValue),
      command: getUsingOpenCommand(component, ref.sectionValue),
      children: metaChildren
    } satisfies UsingNode;
  });

  const usingNodes: CompositionTreeNode[] = [...effectiveNodes, ...suppressionNodes];

  return [
    infoGroupNode(
      "Usings",
      usingNodes,
      `using-group:${facts.rootTag ?? "xml"}:${facts.formIdent ?? facts.workflowFormIdent ?? "unknown"}`
    )
  ];
}

function buildIncludeTree(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): CompositionTreeNode[] {
  if (facts.includeReferences.length === 0) {
    return [];
  }

  const includeNodes: CompositionTreeNode[] = facts.includeReferences.map((includeRef, idx) => {
    const component = resolveComponentByKey(index, includeRef.componentKey);
    if (!component) {
      return {
        id: `include:${includeRef.componentKey}:${includeRef.sectionValue ?? "*"}:${idx}`,
        type: "using",
        label: includeRef.rawComponentValue,
        description: "missing feature",
        tooltip: `Include feature '${includeRef.rawComponentValue}' was not found in indexed features.`,
        icon: new vscode.ThemeIcon("error")
      } satisfies UsingNode;
    }

    const contributionName = includeRef.sectionValue?.trim();
    const contributionExists = contributionName
      ? component.contributionSummaries.has(contributionName)
      : true;
    const description = contributionName
      ? contributionExists ? `contribution=${contributionName}` : `missing contribution=${contributionName}`
      : "whole feature";

    return {
      id: `include:${includeRef.componentKey}:${contributionName ?? "*"}:${idx}`,
      type: "using",
      label: includeRef.rawComponentValue,
      description,
      statusSourceKey: "composition.include.presence",
      tooltip: contributionName
        ? `Include '${includeRef.rawComponentValue}' contribution '${contributionName}'.`
        : `Include whole feature '${includeRef.rawComponentValue}'.`,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      icon: contributionExists ? new vscode.ThemeIcon("link") : new vscode.ThemeIcon("warning"),
      contextValue: "compositionUsing",
      factKind: "fact.includeRefs",
      resourceUri: component.uri,
      sourceLocation: contributionName ? component.contributionDefinitions.get(contributionName) : component.componentLocation,
      command: getUsingOpenCommand(component, contributionName)
    } satisfies UsingNode;
  });

  return [
    infoGroupNode(
      "Includes",
      includeNodes,
      `include-group:${facts.rootTag ?? "xml"}:${facts.formIdent ?? facts.workflowFormIdent ?? "unknown"}`
    )
  ];
}

function buildPlaceholderTree(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>
): CompositionTreeNode[] {
  if (facts.placeholderReferences.length === 0) {
    return [];
  }

  const nodes: CompositionTreeNode[] = facts.placeholderReferences.map((ref, idx) => {
    const featureLabel = ref.rawComponentValue ?? "(unknown feature)";
    const contributionLabel = (ref.contributionValue ?? "").trim();
    const label = contributionLabel.length > 0 ? `${featureLabel}#${contributionLabel}` : featureLabel;
    return {
      type: "detail",
      id: `placeholder:${idx}`,
      label,
      description: ref.rawToken,
      statusSourceKey: "composition.placeholder.token",
      factKind: "fact.placeholderRefs",
      icon: new vscode.ThemeIcon("references"),
      command: openLocationCommand(new vscode.Location(documentUri, ref.range), "Open placeholder")
    } satisfies DetailNode;
  });

  return [
    infoGroupNode(
      "Placeholders",
      nodes,
      `placeholder-group:${facts.rootTag ?? "xml"}:${facts.formIdent ?? facts.workflowFormIdent ?? "unknown"}`
    )
  ];
}

function countSuppressedInheritedContributions(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  componentKey: string,
  sectionValue: string | undefined
): number {
  const root = (facts.rootTag ?? "").toLowerCase();
  if (root !== "workflow" && root !== "dataview") {
    return 0;
  }

  const owningFormIdent = root === "workflow" ? facts.workflowFormIdent ?? facts.rootFormIdent : facts.rootFormIdent;
  if (!owningFormIdent) {
    return 0;
  }

  const form = index.formsByIdent.get(owningFormIdent);
  const formFacts = form ? index.parsedFactsByUri.get(form.uri.toString()) : undefined;
  const component = resolveComponentByKey(index, componentKey);
  if (!formFacts || !component) {
    return 0;
  }

  const inheritedRefs = formFacts.usingReferences.filter((ref) => ref.componentKey === componentKey);
  if (inheritedRefs.length === 0) {
    return 0;
  }

  let total = 0;
  for (const ref of inheritedRefs) {
    if (sectionValue) {
      if (!ref.sectionValue || ref.sectionValue !== sectionValue) {
        continue;
      }
      const contribution = component.contributionSummaries.get(sectionValue);
      if (contribution && contributionMatchesDocumentRoot(facts.rootTag, contribution)) {
        total++;
      }
      continue;
    }

    if (ref.sectionValue) {
      const contribution = component.contributionSummaries.get(ref.sectionValue);
      if (contribution && contributionMatchesDocumentRoot(facts.rootTag, contribution)) {
        total++;
      }
      continue;
    }

    for (const contribution of component.contributionSummaries.values()) {
      if (contributionMatchesDocumentRoot(facts.rootTag, contribution)) {
        total++;
      }
    }
  }

  return total;
}

function buildUsingContributionNode(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  usingModel: { componentKey: string },
  component: NonNullable<ReturnType<typeof resolveComponentByKey>>,
  contributionModel: DocumentUsingContributionModel,
  resolveUsageLocations: (componentKey: string, contributionName?: string) => vscode.Location[]
): ContributionNode {
  const contribution = contributionModel.contribution;
  const componentKey = usingModel.componentKey;
  const nodeId = `using:${componentKey}:contribution:${contribution.contributionName}`;
  const location = component.contributionDefinitions.get(contribution.contributionName);
  const rootRelevant = contributionModel.rootRelevant;
  const insertMode = (contribution.insert ?? "").trim().toLowerCase();
  const insertTrace = contributionModel.insertTrace;
  const insertions = contributionModel.insertCount;
  const hasIndexedInsertCount = insertTrace !== undefined;
  const usageState: "effective" | "unused" = contributionModel.usage;
  const metaGroup = buildUsingContributionMetaGroup(nodeId, contribution, insertTrace);
  const placeholderLocations = collectPlaceholderUsageLocations(
    documentUri,
    facts,
    componentKey,
    contribution.contributionName
  );
  const placeholderGroup = buildPlaceholderUsageGroup(nodeId, placeholderLocations, contribution.insert);

  const typeGroups = buildUsingContributionTypeGroups(nodeId, contribution, insertions, location);
  const details: string[] = [];
  if (!rootRelevant && !contributionModel.explicit) {
    details.push(`not relevant for root '${facts.rootTag ?? "unknown"}'`);
  }
  details.push(hasIndexedInsertCount ? `inserts=${insertions}` : "inserts=index-missing");

  return {
    type: "contribution",
    id: nodeId,
    label: contribution.contributionName,
    description: details.join(", "),
    statusSourceKey: "composition.using.contribution.usage",
    tooltip: [
      contribution.targetXPath ? `TargetXPath: ${contribution.targetXPath}` : undefined,
      contribution.insert ? `Insert: ${contribution.insert}` : undefined,
      rootRelevant || contributionModel.explicit ? undefined : `Root mismatch (current root=${facts.rootTag ?? "unknown"})`
    ].filter(Boolean).join("\n"),
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    icon: rootRelevant || contributionModel.explicit ? iconForUsage(usageState) : new vscode.ThemeIcon("circle-outline"),
    contextValue: "compositionContribution",
    resourceUri: component.uri,
    sourceNodeId: documentUri.toString(),
    sourceLocation: location,
    usageLocations: resolveUsageLocations(componentKey, contribution.contributionName),
    children: [metaGroup, ...(placeholderGroup ? [placeholderGroup] : []), ...typeGroups, ...(typeGroups.length === 0 ? [detailNode("No typed symbols.")] : [])]
  };
}

function buildUsingContributionMetaGroup(
  contributionNodeId: string,
  contribution: IndexedComponentContributionSummary,
  insertTrace: UsingContributionInsertTrace | undefined
): GroupNode {
  const rootValue = contribution.rootExpression ?? contribution.root ?? "form";
  const insertValue = contribution.insert ?? "append";
  const targetXPathValue = contribution.targetXPath ?? "(none)";
  const summary = `${rootValue}, ${insertValue}, ${targetXPathValue}${insertTrace ? `, inserts=${insertTrace.finalInsertCount}` : ""}`;
  const children: CompositionTreeNode[] = [
    detailNode(`Root: ${rootValue}`),
    detailNode(`Insert: ${insertValue}`),
    detailNode(`TargetXPath: ${targetXPathValue}`)
  ];

  if (contribution.allowMultipleInserts !== undefined) {
    children.push(detailNode(`AllowMultipleInserts: ${contribution.allowMultipleInserts ? "true" : "false"}`));
  }
  children.push(detailNode(`HasContent: ${contribution.hasContent ? "true" : "false"}`));
  if (insertTrace) {
    children.push(detailNode(`InsertStrategy: ${insertTrace.strategy}`));
    children.push(detailNode(`InsertCount: ${insertTrace.finalInsertCount}`));
    children.push(detailNode(`PlaceholderCount: ${insertTrace.placeholderCount}`));
    children.push(detailNode(`TargetXPathMatches: ${insertTrace.targetXPathMatchCount}`));
    children.push(detailNode(`TargetXPathClamped: ${insertTrace.targetXPathClampedCount}`));
    children.push(detailNode(`FallbackSymbolCount: ${insertTrace.fallbackSymbolCount}`));
  } else {
    children.push(detailNode("InsertTrace: missing in index"));
  }

  return {
    type: "group",
    id: `${contributionNodeId}:meta`,
    label: "Meta",
    description: summary,
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    icon: new vscode.ThemeIcon("symbol-structure"),
    children
  };
}

function buildUsingContributionTypeGroups(
  contributionNodeId: string,
  contribution: IndexedComponentContributionSummary,
  contributionInsertions: number,
  contributionLocation?: vscode.Location
): GroupNode[] {
  const groups: GroupNode[] = [];
  const add = (label: string, suffix: string, idents: ReadonlySet<string>, iconId: string): void => {
    if (idents.size === 0) {
      return;
    }
    groups.push({
      type: "group",
      id: `${contributionNodeId}:type:${suffix}`,
      label,
      description: `${idents.size}`,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      icon: new vscode.ThemeIcon(iconId),
      children: [...idents]
        .sort((a, b) => a.localeCompare(b))
        .map((ident, idx) => ({
          type: "detail",
          id: `${contributionNodeId}:type:${suffix}:ident:${idx}`,
          label: ident,
          icon: new vscode.ThemeIcon("symbol-string")
        }))
    });
  };

  add("Controls", "controls", contribution.formControlIdents, "symbol-field");
  add("Buttons", "buttons", contribution.formButtonIdents, "symbol-event");
  add("Sections", "sections", contribution.formSectionIdents, "symbol-class");
  add("ActionShareCodes", "wf-actions", contribution.workflowActionShareCodeIdents, "symbol-method");
  add("ControlShareCodes", "wf-controls", contribution.workflowControlShareCodeIdents, "symbol-constant");
  add("ButtonShareCodes", "wf-buttons", contribution.workflowButtonShareCodeIdents, "symbol-key");
  add("ReferencedActionShareCodes", "wf-referenced-actions", contribution.workflowReferencedActionShareCodeIdents, "references");
  const primitiveEntries = [...contribution.primitiveUsageCountByKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (primitiveEntries.length > 0) {
    groups.push({
      type: "group",
      id: `${contributionNodeId}:type:primitives`,
      label: "Primitives",
      description: `${primitiveEntries.length}`,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      icon: new vscode.ThemeIcon("symbol-snippet"),
      children: primitiveEntries.map(([primitiveKey, usageCount], idx) => {
        const templateNames = [...(contribution.primitiveTemplateNamesByKey.get(primitiveKey) ?? new Set<string>())].sort((a, b) => a.localeCompare(b));
        const effectiveInserts = usageCount * Math.max(1, contributionInsertions);
        const uri = contributionLocation?.uri;
        const providedParams = [...(contribution.primitiveProvidedParamNamesByKey.get(primitiveKey) ?? new Set<string>())].sort((a, b) => a.localeCompare(b));
        const providedSlots = [...(contribution.primitiveProvidedSlotNamesByKey.get(primitiveKey) ?? new Set<string>())].sort((a, b) => a.localeCompare(b));
        const cycleNode = primitiveQuickFixDetailNode(
          "CycleFix: Remove cyclic UsePrimitive",
          `${contributionNodeId}:type:primitives:item:${idx}:cycle`,
          "cycle",
          primitiveKey,
          primitiveKey,
          contributionLocation
        );
        return {
          type: "group",
          id: `${contributionNodeId}:type:primitives:item:${idx}`,
          label: primitiveKey,
          description: `uses=${usageCount}, inserts=${effectiveInserts}`,
          icon: new vscode.ThemeIcon("symbol-file"),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          ...(uri ? { resourceUri: uri, sourceLocation: toUriStartLocation(uri), contextValue: "compositionSymbol" } : {}),
          children: [
            detailNode(`Templates: ${templateNames.length > 0 ? templateNames.join(", ") : "(default)"}`),
            primitiveQuickFixDetailNode(
              `PrimitiveSource: ${primitiveKey}`,
              `${contributionNodeId}:type:primitives:item:${idx}:source`,
              "unknown",
              primitiveKey,
              primitiveKey,
              contributionLocation
            ),
            detailNode("RequiredParams: unavailable (index-only projection)"),
            detailNode(`ProvidedParams: ${providedParams.length > 0 ? providedParams.join(", ") : "(none)"}`),
            detailNode("MissingParams: unavailable (index-only projection)"),
            detailNode("RequiredSlots: unavailable (index-only projection)"),
            detailNode(`ProvidedSlots: ${providedSlots.length > 0 ? providedSlots.join(", ") : "(none)"}`),
            detailNode("MissingSlots: unavailable (index-only projection)"),
            cycleNode
          ]
        } satisfies GroupNode;
      })
    });
  }

  return groups;
}

function primitiveQuickFixDetailNode(
  label: string,
  id: string,
  kind: "param" | "slot" | "unknown" | "cycle",
  name: string,
  primitiveKey: string,
  contributionLocation?: vscode.Location
): DetailNode {
  if (!contributionLocation) {
    return detailNode(label, id);
  }

  return {
    type: "detail",
    id,
    label,
    icon: new vscode.ThemeIcon("wrench"),
    command: {
      command: "sfpXmlLinter.compositionApplyPrimitiveQuickFix",
      title: "Apply primitive quick fix",
      arguments: [
        createPrimitiveQuickFixPayload(contributionLocation.uri, kind, name, primitiveKey)
      ]
    }
  };
}

function buildPlaceholderUsageGroup(
  contributionNodeId: string,
  locations: readonly vscode.Location[],
  insertMode: string | undefined
): GroupNode | undefined {
  if (locations.length === 0 && (insertMode ?? "").trim().toLowerCase() !== "placeholder") {
    return undefined;
  }

  return {
    type: "group",
    id: `${contributionNodeId}:placeholders`,
    label: "Placeholders",
    description: `${locations.length}`,
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    icon: new vscode.ThemeIcon("symbol-key"),
    children:
      locations.length > 0
        ? locations.map((location, idx) => ({
            type: "detail",
            id: `${contributionNodeId}:placeholders:${idx}`,
            label: formatLocationLabel(location),
            icon: new vscode.ThemeIcon("references"),
            command: openLocationCommand(location, "Open placeholder")
          }))
        : [detailNode("No matching placeholder usage found in current document.")]
  };
}

function collectPlaceholderUsageLocations(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  componentKey: string,
  contributionName: string
): vscode.Location[] {
  return facts.placeholderReferences
    .filter((ref) => ref.componentKey === componentKey && (ref.contributionValue ?? "").trim() === contributionName)
    .map((ref) => new vscode.Location(documentUri, ref.range))
    .sort(compareLocations);
}

function aggregateFormControls(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  composition: DocumentCompositionModel
): AggregatedSymbol[] {
  const local = facts.declaredControlInfos.map((item) => ({
    ident: item.ident,
    location: new vscode.Location(documentUri, item.range)
  }));
  const composed = collectComposedSymbolsFromModel(composition, index, (summary) => summary.formControlIdents);
  return mergeAggregatedSymbols(local, composed);
}

function aggregateFormButtons(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  composition: DocumentCompositionModel
): AggregatedSymbol[] {
  const local = facts.declaredButtonInfos.map((item) => ({
    ident: item.ident,
    location: new vscode.Location(documentUri, item.range)
  }));
  const composed = collectComposedSymbolsFromModel(composition, index, (summary) => summary.formButtonIdents);
  return mergeAggregatedSymbols(local, composed);
}

function aggregateFormSections(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  composition: DocumentCompositionModel
): AggregatedSymbol[] {
  const local = facts.identOccurrences
    .filter((item) => item.kind === "section")
    .map((item) => ({
      ident: item.ident,
      location: new vscode.Location(documentUri, item.range)
    }));
  const composed = collectComposedSymbolsFromModel(composition, index, (summary) => summary.formSectionIdents);
  return mergeAggregatedSymbols(local, composed);
}

function overlayFinalIndexedFormSymbols(
  symbols: readonly AggregatedSymbol[],
  form: IndexedForm,
  index: WorkspaceIndex,
  kind: "control" | "button" | "section"
): AggregatedSymbol[] {
  const out = new Map<string, AggregatedSymbol>();
  for (const symbol of symbols) {
    out.set(symbol.ident, symbol);
  }

  const idents =
    kind === "control" ? form.controls :
    kind === "button" ? form.buttons :
    form.sections;
  const definitions =
    kind === "control" ? form.controlDefinitions :
    kind === "button" ? form.buttonDefinitions :
    form.sectionDefinitions;
  const providersBySymbol = index.builtSymbolProvidersByUri?.get(toIndexUriKey(form.uri));

  for (const ident of idents) {
    if (out.has(ident)) {
      continue;
    }
    const sourceLocation = definitions.get(ident);
    const providerKey = `${kind}:${ident}`.toLowerCase();
    const providers = providersBySymbol?.get(providerKey) ?? [];
    out.set(ident, {
      ident,
      origin: providers.length > 0 ? "resolved" : "final",
      source: providers.length > 0
        ? summarizeProviders(providers)
        : `final-index:${form.ident}${providersBySymbol ? ` (providers=${providersBySymbol.size})` : ""}`,
      resourceUri: sourceLocation?.uri ?? form.uri,
      sourceLocation
    });
  }

  return [...out.values()].sort((a, b) => a.ident.localeCompare(b.ident));
}

function summarizeProviders(providers: readonly IndexedSymbolProvenanceProvider[]): string {
  const labels = new Set<string>();
  for (const provider of providers) {
    if (provider.sourceKind === "primitive") {
      labels.add(provider.primitiveKey
        ? `primitive:${provider.primitiveKey}${provider.templateName ? `#${provider.templateName}` : ""}`
        : "primitive");
      continue;
    }

    const feature = provider.featureKey ?? provider.sourceKind;
    const contribution = provider.contributionName ? `#${provider.contributionName}` : "";
    labels.add(`${provider.sourceKind}:${feature}${contribution}`);
  }
  return [...labels].sort((a, b) => a.localeCompare(b)).join(", ");
}

function aggregateWorkflowShareCodes(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  composition: DocumentCompositionModel,
  selector: (summary: IndexedComponentContributionSummary) => ReadonlySet<string>,
  localIdents: readonly string[],
  localDefinitions: ReadonlyMap<string, vscode.Range>,
  usageLocationsByIdent: ReadonlyMap<string, vscode.Location[]>
): AggregatedSymbol[] {
  const local = localIdents.map((ident) => ({
    ident,
    location: localDefinitions.get(ident) ? new vscode.Location(documentUri, localDefinitions.get(ident)!) : undefined,
    usageCount: usageLocationsByIdent.get(ident)?.length ?? 0,
    usageLocations: usageLocationsByIdent.get(ident) ?? []
  }));
  const composed = collectComposedSymbolsFromModel(composition, index, selector);
  for (const value of composed.values()) {
    value.usageCount = usageLocationsByIdent.get(value.ident)?.length ?? 0;
    value.usageLocations = usageLocationsByIdent.get(value.ident) ?? [];
  }

  return mergeAggregatedSymbols(local, composed);
}

function mergeAggregatedSymbols(
  localSymbols: ReadonlyArray<{ ident: string; location?: vscode.Location; usageCount?: number; usageLocations?: vscode.Location[] }>,
  composedMap: ReadonlyMap<string, { ident: string; origin: "injected" | "inherited"; source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location; usageCount?: number; usageLocations?: vscode.Location[] }>
): AggregatedSymbol[] {
  const out = new Map<string, AggregatedSymbol>();

  for (const localSymbol of localSymbols) {
    out.set(localSymbol.ident, {
      ident: localSymbol.ident,
      origin: "local",
      sourceLocation: localSymbol.location,
      resourceUri: localSymbol.location?.uri,
      usageCount: localSymbol.usageCount,
      usageLocations: localSymbol.usageLocations
    });
  }

  for (const [ident, source] of composedMap.entries()) {
    if (out.has(ident)) {
      continue;
    }
    out.set(ident, {
      ident,
      origin: source.origin,
      source: source.source,
      resourceUri: source.resourceUri,
      sourceLocation: source.sourceLocation,
      usageCount: source.usageCount,
      usageLocations: source.usageLocations
    });
  }

  return [...out.values()].sort((a, b) => a.ident.localeCompare(b.ident));
}

function collectComposedSymbolsFromModel(
  model: DocumentCompositionModel,
  index: WorkspaceIndex,
  selector: (summary: IndexedComponentContributionSummary) => ReadonlySet<string>
): Map<string, { ident: string; origin: "injected" | "inherited"; source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location; usageCount?: number; usageLocations?: vscode.Location[] }> {
  const out = new Map<string, { ident: string; origin: "injected" | "inherited"; source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location; usageCount?: number; usageLocations?: vscode.Location[] }>();
  for (const usingModel of model.usings) {
    if (!usingModel.hasResolvedFeature) {
      continue;
    }
    const component = resolveComponentByKey(index, usingModel.componentKey);
    if (!component) {
      continue;
    }
    const sourceLabel = usingModel.sectionValue
      ? `${usingModel.rawComponentValue}#${usingModel.sectionValue}`
      : usingModel.rawComponentValue;
    const origin: "injected" | "inherited" = usingModel.source === "inherited" ? "inherited" : "injected";
    for (const contributionModel of usingModel.contributions) {
      const sourceLocation = component.contributionDefinitions.get(contributionModel.contribution.contributionName);
      for (const ident of selector(contributionModel.contribution)) {
        if (out.has(ident)) {
          continue;
        }
        out.set(ident, {
          ident,
          origin,
          source: sourceLabel,
          resourceUri: component.uri,
          ...(sourceLocation ? { sourceLocation } : {})
        });
      }
    }
  }
  return out;
}

function buildSymbolGroup(label: string, symbols: readonly AggregatedSymbol[], iconId: string, nodeId: string): GroupNode {
  return {
    id: nodeId,
    type: "group",
    label,
    description: `${symbols.length}`,
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    icon: new vscode.ThemeIcon(iconId),
    children:
      symbols.length > 0
        ? symbols.map((symbol) => ({
            type: "symbol",
            id: `${nodeId}:symbol:${symbol.ident}`,
            label: symbol.ident,
            description: symbol.usageCount !== undefined ? `${symbol.origin}, used ${symbol.usageCount}` : symbol.origin,
            statusSourceKey: "composition.symbol.origin",
            symbolKind:
              label.toLowerCase().includes("control")
                ? "control"
                : label.toLowerCase().includes("button")
                  ? "button"
                  : label.toLowerCase().includes("section")
                    ? "section"
                    : label.toLowerCase().includes("actionsharecode")
                      ? "actionShareCode"
                      : label.toLowerCase().includes("controlsharecode")
                        ? "controlShareCode"
                        : label.toLowerCase().includes("buttonsharecode")
                          ? "buttonShareCode"
                          : undefined,
            tooltip: symbol.source
              ? `${symbol.origin === "inherited" ? "Inherited" : symbol.origin === "injected" ? "Injected" : symbol.origin === "resolved" ? "Resolved" : symbol.origin === "final" ? "Final" : "Local"} from ${symbol.source}`
              : symbol.origin,
            icon: new vscode.ThemeIcon(
              symbol.origin === "local"
                ? "circle-large-filled"
                : symbol.origin === "inherited"
                  ? "arrow-both"
                  : symbol.origin === "resolved"
                    ? "link"
                  : symbol.origin === "final"
                    ? "database"
                  : "arrow-circle-right"
            ),
            resourceUri: symbol.resourceUri,
            contextValue: symbol.sourceLocation ? "compositionSymbol" : undefined,
            sourceLocation: symbol.sourceLocation,
            usageLocations: undefined,
            collapsibleState: (symbol.usageLocations?.length ?? 0) > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            children: (symbol.usageLocations?.length ?? 0) > 0
              ? symbol.usageLocations!.map((location, index) => ({
                  type: "detail",
                  id: `${nodeId}:symbol:${symbol.ident}:usage:${index}`,
                  label: formatLocationLabel(location),
                  icon: new vscode.ThemeIcon("references"),
                  command: openLocationCommand(location, `Open usage of ${symbol.ident}`)
                } satisfies DetailNode))
              : undefined
          }))
        : [detailNode("No items.")]
  };
}

function buildActionsNode(root: string, nodeId: string, composition?: DocumentCompositionModel): GroupNode {
  const summaryText = composition ? buildCompositionQuickSummary(root, composition) : undefined;
  const nonEffectiveUsingRows = composition
    ? composition.usings
        .filter((item) => item.impactStatus !== "effective")
        .map((item) => {
          const label = item.sectionValue ? `${item.rawComponentValue}#${item.sectionValue}` : item.rawComponentValue;
          return `${label}: ${item.impactStatus} (${item.impact.successfulCount}/${item.impact.relevantCount})`;
        })
    : [];

  const actions: CompositionTreeNode[] = [
    actionNode("Refresh View", "sfpXmlLinter.refreshCompositionView", "refresh"),
    actionNode("Show Composition Log", "sfpXmlLinter.showCompositionLog", "output"),
    ...(summaryText
      ? [actionNode("Copy Summary", "sfpXmlLinter.compositionCopySummary", "clippy", [{ text: summaryText }])]
      : []),
    ...(nonEffectiveUsingRows.length > 0
      ? [
          actionNode("Log Non-effective Usings", "sfpXmlLinter.compositionLogNonEffectiveUsings", "warning", [
            {
              title: "Non-effective usings",
              lines: nonEffectiveUsingRows
            }
          ])
        ]
      : []),
    actionNode("Generate Feature Manifest Bootstrap", "sfpXmlLinter.generateFeatureManifestBootstrap", "new-file"),
    actionNode("Revalidate Workspace", "sfpXmlLinter.revalidateWorkspace", "workspace-trusted"),
    actionNode("Revalidate Project", "sfpXmlLinter.revalidateProject", "folder-active")
  ];

  if (root === "workflow" || root === "form") {
    actions.push(actionNode("Show Index Log", "sfpXmlLinter.showIndexLog", "list-tree"));
  }

  return {
    id: nodeId,
    type: "group",
    label: "Actions",
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    icon: new vscode.ThemeIcon("tools"),
    children: actions
  };
}

function actionNode(label: string, command: string, iconId: string, args?: unknown[]): DetailNode {
  return {
    type: "detail",
    label,
    icon: new vscode.ThemeIcon(iconId),
    command: {
      command,
      title: label,
      ...(args ? { arguments: args } : {})
    }
  };
}

function buildCompositionQuickSummary(root: string, composition: DocumentCompositionModel): string {
  const usings = composition.usings.length;
  const usingEffective = composition.usings.filter((item) => item.impactStatus === "effective").length;
  const usingPartial = composition.usings.filter((item) => item.impactStatus === "partial").length;
  const usingUnused = composition.usings.filter((item) => item.impactStatus === "unused").length;
  const usingInert = composition.usings.filter((item) => item.impactStatus === "inert").length;
  let contributions = 0;
  let inserts = 0;
  for (const using of composition.usings) {
    for (const contribution of using.contributions) {
      contributions++;
      inserts += contribution.insertCount;
    }
  }

  return [
    `Root: ${root}`,
    `Usings: ${usings}`,
    `Using impact: effective=${usingEffective}, partial=${usingPartial}, unused=${usingUnused}, inert=${usingInert}`,
    `Contributions: ${contributions}`,
    `Total inserts: ${inserts}`
  ].join("\n");
}

function findContributionLocationForPart(
  index: WorkspaceIndex,
  partId: string,
  contributionName: string
): vscode.Location | undefined {
  const component = resolveComponentByKey(index, partId);
  return component?.contributionDefinitions.get(contributionName);
}

function collectFeatureUsageLocations(
  report: FeatureCapabilityReport,
  index: WorkspaceIndex,
  entrypointComponentKey?: string
): vscode.Location[] {
  const seen = new Map<string, vscode.Location>();
  if (entrypointComponentKey) {
    for (const location of collectComponentReferenceLocations(index, entrypointComponentKey)) {
      pushUniqueLocationMap(seen, location);
    }
  }
  for (const part of report.parts) {
    const componentKey = toIndexedComponentKey(part.file);
    for (const location of collectComponentReferenceLocations(index, componentKey)) {
      pushUniqueLocationMap(seen, location);
    }
  }
  return [...seen.values()].sort(compareLocations);
}

function collectPartUsageLocations(
  index: WorkspaceIndex,
  partComponentKey: string,
  entrypointComponentKey?: string
): vscode.Location[] {
  const seen = new Map<string, vscode.Location>();
  for (const location of collectComponentReferenceLocations(index, partComponentKey)) {
    pushUniqueLocationMap(seen, location);
  }
  if (seen.size === 0 && entrypointComponentKey) {
    for (const location of collectComponentReferenceLocations(index, entrypointComponentKey)) {
      pushUniqueLocationMap(seen, location);
    }
  }
  return [...seen.values()].sort(compareLocations);
}

function collectContributionUsageLocations(
  index: WorkspaceIndex,
  partComponentKey: string,
  contributionName: string,
  entrypointComponentKey?: string
): vscode.Location[] {
  const seen = new Map<string, vscode.Location>();
  for (const location of collectComponentContributionReferenceLocations(index, partComponentKey, contributionName)) {
    pushUniqueLocationMap(seen, location);
  }

  if (seen.size === 0 && entrypointComponentKey) {
    for (const location of collectComponentReferenceLocations(index, entrypointComponentKey)) {
      pushUniqueLocationMap(seen, location);
    }
  }

  return [...seen.values()].sort(compareLocations);
}

function getUsingUsageLocations(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  componentKey: string,
  contributionName?: string,
  ownerByUri?: Map<string, string | undefined>
): vscode.Location[] {
  const currentOwner = facts.formIdent ?? facts.workflowFormIdent;
  const locations = contributionName
    ? collectComponentContributionReferenceLocations(index, componentKey, contributionName)
    : collectComponentReferenceLocations(index, componentKey);
  if (!currentOwner) {
    return [...locations].sort(compareLocations);
  }

  return locations
    .filter((location) => {
      const key = location.uri.toString();
      let locationOwner: string | undefined;
      if (ownerByUri?.has(key)) {
        locationOwner = ownerByUri.get(key);
      } else {
        const locationFacts = index.parsedFactsByUri.get(key);
        locationOwner = locationFacts?.formIdent ?? locationFacts?.workflowFormIdent;
        ownerByUri?.set(key, locationOwner);
      }
      return locationOwner === currentOwner;
    })
    .sort(compareLocations);
}

function getUsingOpenCommand(
  component: NonNullable<ReturnType<typeof resolveComponentByKey>>,
  contributionName?: string
): vscode.Command | undefined {
  if (contributionName) {
    const location = component.contributionDefinitions.get(contributionName);
    if (location) {
      return openLocationCommand(location, `Open contribution ${contributionName}`);
    }
  }

  return {
    command: "vscode.open",
    title: "Open feature",
    arguments: [component.uri]
  };
}

function openLocationCommand(location: vscode.Location, title: string): vscode.Command {
  return {
    command: "vscode.open",
    title,
    arguments: [location.uri, { selection: location.range }]
  };
}

function pushUniqueLocationMap(target: Map<string, vscode.Location>, location: vscode.Location): void {
  const key = `${location.uri.toString()}#${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
  if (!target.has(key)) {
    target.set(key, location);
  }
}

function compareLocations(a: vscode.Location, b: vscode.Location): number {
  const uriCompare = a.uri.toString().localeCompare(b.uri.toString());
  if (uriCompare !== 0) {
    return uriCompare;
  }

  if (a.range.start.line !== b.range.start.line) {
    return a.range.start.line - b.range.start.line;
  }

  return a.range.start.character - b.range.start.character;
}

function findFeatureForRelativePath(
  registry: FeatureManifestRegistry,
  relativePath: string
): FeatureCapabilityReport | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  for (const manifest of registry.manifestsByFeature.values()) {
    if (manifest.entrypoint === normalized) {
      return registry.capabilityReportsByFeature.get(manifest.feature);
    }
    if (manifest.parts.some((part) => part.file === normalized)) {
      return registry.capabilityReportsByFeature.get(manifest.feature);
    }
  }
  return undefined;
}

function iconForUsage(usage: "effective" | "partial" | "unused" | "inert"): vscode.ThemeIcon {
  switch (usage) {
    case "effective":
      return new vscode.ThemeIcon("pass");
    case "partial":
      return new vscode.ThemeIcon("warning");
    case "inert":
      return new vscode.ThemeIcon("circle-large-outline");
    case "unused":
      return new vscode.ThemeIcon("circle-slash");
  }
}

function infoNode(label: string): InfoNode {
  return {
    type: "info",
    label,
    icon: new vscode.ThemeIcon("info")
  };
}

function detailNode(label: string, id?: string): DetailNode {
  return {
    ...(id ? { id } : {}),
    type: "detail",
    label,
    icon: new vscode.ThemeIcon("circle-small-filled")
  };
}

function infoGroupNode(label: string, children: CompositionTreeNode[], id?: string): GroupNode {
  return {
    ...(id ? { id } : {}),
    type: "group",
    label,
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    icon: new vscode.ThemeIcon("list-unordered"),
    children
  };
}

function partGroupNode(label: string, children: CompositionTreeNode[], id?: string): PartNode {
  return {
    ...(id ? { id } : {}),
    type: "part",
    label,
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    icon: new vscode.ThemeIcon("group-by-ref-type"),
    children
  };
}

function toWorkspacePath(relativePath: string, activeUri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(activeUri);
  if (!folder) {
    return activeUri.fsPath;
  }

  return vscode.Uri.joinPath(folder.uri, ...relativePath.split("/")).fsPath;
}

function toUriStartLocation(uri: vscode.Uri): vscode.Location {
  return new vscode.Location(uri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)));
}

function toIndexedComponentKey(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const marker = "xml_components/";
  const markerWithSlash = `/${marker}`;

  let fromRoot = normalized;
  if (lower.startsWith(marker)) {
    fromRoot = normalized.slice(marker.length);
  } else {
    const markerIndex = lower.indexOf(markerWithSlash);
    if (markerIndex >= 0) {
      fromRoot = normalized.slice(markerIndex + markerWithSlash.length);
    }
  }

  return normalizeComponentKey(fromRoot);
}

function collectWorkflowReferenceLocations(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  kind: "controlShareCode" | "buttonShareCode"
): Map<string, vscode.Location[]> {
  const locations = new Map<string, vscode.Location[]>();
  for (const ref of facts.workflowReferences) {
    if (ref.kind !== kind) {
      continue;
    }

    const list = locations.get(ref.ident) ?? [];
    list.push(new vscode.Location(documentUri, ref.range));
    locations.set(ref.ident, list);
  }
  return locations;
}

function collectActionShareCodeReferenceLocations(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>
): Map<string, vscode.Location[]> {
  const locations = new Map<string, vscode.Location[]>();
  for (const ref of facts.actionShareCodeReferences) {
    const list = locations.get(ref.ident) ?? [];
    list.push(new vscode.Location(documentUri, ref.range));
    locations.set(ref.ident, list);
  }
  return locations;
}

function formatLocationLabel(location: vscode.Location): string {
  const relative = vscode.workspace.asRelativePath(location.uri, false);
  const line = location.range.start.line + 1;
  const column = location.range.start.character + 1;
  return `${relative}:${line}:${column}`;
}

function sharedSectionNodeId(label: string): string {
  return `section:${label.toLowerCase()}`;
}
