import * as vscode from "vscode";
import { parseDocumentFacts, UsingContributionInsertTrace } from "../indexer/xmlFacts";
import { WorkspaceIndex, IndexedComponentContributionSummary } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { FeatureManifestRegistry } from "./workspace";
import {
  contributionMatchesDocumentRoot,
  selectRelevantUsingContributions,
  selectUsingContributions,
  unionContributionIdents
} from "./usingImpact";
import { FeatureCapabilityReport } from "./model";
import { normalizeComponentKey } from "../utils/paths";

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
  origin: "local" | "injected";
  source?: string;
  resourceUri?: vscode.Uri;
  sourceLocation?: vscode.Location;
  usageCount?: number;
  usageLocations?: vscode.Location[];
}

export class CompositionTreeProvider implements vscode.TreeDataProvider<CompositionTreeNode> {
  private readonly didChangeTreeDataEmitter = new vscode.EventEmitter<CompositionTreeNode | undefined | null | void>();
  private readonly expandedNodeIds = new Set<string>();

  public readonly onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

  public constructor(
    private readonly getActiveDocument: () => vscode.TextDocument | undefined,
    private readonly getIndexForUri: (uri: vscode.Uri) => WorkspaceIndex,
    private readonly getFeatureRegistry: () => FeatureManifestRegistry
  ) {}

  public refresh(): void {
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
      return [
        infoNode("Open an XML file to inspect feature composition and final injected symbols.")
      ];
    }

    const registry = this.getFeatureRegistry();
    const index = this.getIndexForUri(document.uri);
    const facts = index.parsedFactsByUri.get(document.uri.toString());
    if (!facts) {
      return [
        infoNode("Index facts are not available for this document yet. Run Revalidate Workspace/Project.")
      ];
    }
    const relPath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    const featureReport = findFeatureForRelativePath(registry, relPath);
    if (featureReport) {
      return buildFeatureTree(featureReport, registry, index, document.uri);
    }

    const regularXmlTree = buildRegularXmlTree(document, facts, index);
    if (regularXmlTree.length > 0) {
      return regularXmlTree;
    }

    const usingTree = buildUsingTree(document, facts, index);
    if (usingTree.length > 0) {
      return usingTree;
    }

    return [
      infoNode(`No feature composition or Using impact available for '${relPath}'.`)
    ];
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
    summaryChildren.push(detailNode(`Contributions: ${model.contributions.length}`));
    summaryChildren.push(detailNode(`Usage: effective=${effective}, partial=${partial}, unused=${unused}`));
    summaryChildren.push(detailNode(`Conflicts: ${model.conflicts.length}`));
  }

  const partsNode = partGroupNode(
    "Parts",
    report.parts.map((part) => {
      const partComponentKey = toIndexedComponentKey(part.file);
      const contributionReports = model?.contributions.filter((item) => item.partId === part.id) ?? [];
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
        children: contributionReports.length > 0
          ? contributionReports.map((contribution) => ({
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
            }))
          : [detailNode("No contribution reports.")]
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
  document: vscode.TextDocument,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): CompositionTreeNode[] {
  const root = (facts.rootTag ?? "").toLowerCase();
  if (root !== "form" && root !== "workflow") {
    return [];
  }
  const children: CompositionTreeNode[] = [];
  children.push(buildDocumentSummaryNode(document, facts, index, sharedSectionNodeId("Summary")));
  children.push(buildActionsNode(root, sharedSectionNodeId("Actions")));

  if (root === "form") {
    const controls = aggregateFormControls(document.uri, facts, index);
    const buttons = aggregateFormButtons(document.uri, facts, index);
    const sections = aggregateFormSections(document.uri, facts, index);
    children.push(buildSymbolGroup("Controls", controls, "symbol-field", sharedSectionNodeId("Controls")));
    children.push(buildSymbolGroup("Buttons", buttons, "symbol-event", sharedSectionNodeId("Buttons")));
    children.push(buildSymbolGroup("Sections", sections, "symbol-structure", sharedSectionNodeId("Sections")));
  } else {
    const controlShareCodes = aggregateWorkflowShareCodes(
      document.uri,
      facts,
      index,
      (summary) => summary.workflowControlShareCodeIdents,
      [...facts.declaredControlShareCodes],
      facts.controlShareCodeDefinitions,
      collectWorkflowReferenceLocations(document.uri, facts, "controlShareCode")
    );
    const buttonShareCodes = aggregateWorkflowShareCodes(
      document.uri,
      facts,
      index,
      (summary) => summary.workflowButtonShareCodeIdents,
      [...facts.declaredButtonShareCodes],
      facts.buttonShareCodeDefinitions,
      collectWorkflowReferenceLocations(document.uri, facts, "buttonShareCode")
    );
    const actionShareCodes = aggregateWorkflowShareCodes(
      document.uri,
      facts,
      index,
      (summary) => summary.workflowActionShareCodeIdents,
      [...facts.declaredActionShareCodes],
      facts.actionShareCodeDefinitions,
      collectActionShareCodeReferenceLocations(document.uri, facts)
    );

    children.push(buildSymbolGroup("ControlShareCodes", controlShareCodes, "symbol-key", sharedSectionNodeId("ControlShareCodes")));
    children.push(buildSymbolGroup("ButtonShareCodes", buttonShareCodes, "symbol-key", sharedSectionNodeId("ButtonShareCodes")));
    children.push(buildSymbolGroup("ActionShareCodes", actionShareCodes, "symbol-key", sharedSectionNodeId("ActionShareCodes")));
  }

  const usingTree = buildUsingTree(document, facts, index);
  if (usingTree.length > 0) {
    children.push(...usingTree);
  }

  return [
    {
      id: sharedSectionNodeId("ModelRoot"),
      type: "group",
      label: root === "form" ? "Final Form Model" : "Final WorkFlow Model",
      description: vscode.workspace.asRelativePath(document.uri, false),
      tooltip: document.uri.fsPath,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon(root === "form" ? "file-code" : "symbol-class"),
      children
    }
  ];
}

function buildDocumentSummaryNode(
  document: vscode.TextDocument,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  nodeId: string
): GroupNode {
  const root = (facts.rootTag ?? "").toLowerCase();
  const usingCount = facts.usingReferences.length;
  const knownFeatureCount = facts.usingReferences.filter((usingRef) => !!resolveComponentByKey(index, usingRef.componentKey)).length;
  const localControlCount = facts.declaredControlInfos.length;
  const localButtonCount = facts.declaredButtonInfos.length;
  const localSectionCount = facts.identOccurrences.filter((item) => item.kind === "section").length;
  const injectedControlCount = collectUsingSymbols(facts, index, (summary) => summary.formControlIdents).size;
  const injectedButtonCount = collectUsingSymbols(facts, index, (summary) => summary.formButtonIdents).size;
  const injectedSectionCount = collectUsingSymbols(facts, index, (summary) => summary.formSectionIdents).size;
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
    summary.push(detailNode(`Local Buttons: ${localButtonCount}`));
    summary.push(detailNode(`Injected Buttons: ${injectedButtonCount}`));
    summary.push(detailNode(`Local Sections: ${localSectionCount}`));
    summary.push(detailNode(`Injected Sections: ${injectedSectionCount}`));
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

function buildUsingTree(
  document: vscode.TextDocument,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): CompositionTreeNode[] {
  if (facts.usingReferences.length === 0) {
    return [];
  }

  return [
    infoGroupNode(
      "Usings",
      facts.usingReferences.map((usingRef) => {
        const component = resolveComponentByKey(index, usingRef.componentKey);
        if (!component) {
          return {
            type: "using",
            label: usingRef.rawComponentValue,
            description: "missing feature",
            tooltip: usingRef.rawComponentValue,
            icon: new vscode.ThemeIcon("error")
          } satisfies UsingNode;
        }

        const contributions = selectUsingContributions(component);
        const impact = evaluateUsingInsertImpact(facts, usingRef.componentKey, contributions);
        const contributionRows = contributions
          .filter((contribution) => contributionMatchesDocumentRoot(facts.rootTag, contribution))
          .map((contribution) =>
            buildUsingContributionNode(document, facts, index, usingRef.componentKey, component, contribution)
          );
        const filteredRows = contributions
          .filter((contribution) => !contributionMatchesDocumentRoot(facts.rootTag, contribution))
          .map((contribution) =>
            buildUsingContributionNode(document, facts, index, usingRef.componentKey, component, contribution)
          );
        const children: CompositionTreeNode[] =
          contributionRows.length > 0 ? [...contributionRows] : [detailNode("No root-relevant contributions found.")];
        if (filteredRows.length > 0) {
          children.push({
            type: "group",
            id: `using:${usingRef.componentKey}:${usingRef.sectionValue ?? "*"}:filtered`,
            label: "Filtered",
            description: `${filteredRows.length}`,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            icon: new vscode.ThemeIcon("filter"),
            children: filteredRows
          });
        }

        return {
          id: `using:${usingRef.componentKey}:${usingRef.sectionValue ?? "*"}`,
          type: "using",
          label: usingRef.rawComponentValue,
          description: impact.kind,
          tooltip: impact.message ?? usingRef.rawComponentValue,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          icon: iconForUsage(impact.kind),
          contextValue: "compositionUsing",
          resourceUri: component.uri,
          sourceLocation: usingRef.sectionValue ? component.contributionDefinitions.get(usingRef.sectionValue) : component.componentLocation,
          usageLocations: getUsingUsageLocations(facts, index, usingRef.componentKey, usingRef.sectionValue),
          command: getUsingOpenCommand(component, usingRef.sectionValue),
          children
        } satisfies UsingNode;
      }),
      `using-group:${facts.rootTag ?? "xml"}:${facts.formIdent ?? facts.workflowFormIdent ?? "unknown"}`
    )
  ];
}

function buildUsingContributionNode(
  document: vscode.TextDocument,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  componentKey: string,
  component: NonNullable<ReturnType<typeof resolveComponentByKey>>,
  contribution: IndexedComponentContributionSummary
): ContributionNode {
  const nodeId = `using:${componentKey}:contribution:${contribution.contributionName}`;
  const location = component.contributionDefinitions.get(contribution.contributionName);
  const rootRelevant = contributionMatchesDocumentRoot(facts.rootTag, contribution);
  const insertMode = (contribution.insert ?? "").trim().toLowerCase();
  const insertTrace = getIndexedContributionInsertTrace(facts, componentKey, contribution.contributionName);
  const insertions = insertTrace?.finalInsertCount;
  const hasIndexedInsertCount = insertions !== undefined;
  const usageState: "effective" | "unused" = rootRelevant && hasIndexedInsertCount && insertions > 0 ? "effective" : "unused";
  const metaGroup = buildUsingContributionMetaGroup(nodeId, contribution, insertTrace);
  const placeholderLocations = collectPlaceholderUsageLocations(
    document,
    facts,
    componentKey,
    contribution.contributionName
  );
  const placeholderGroup = buildPlaceholderUsageGroup(nodeId, placeholderLocations, contribution.insert);

  const typeGroups = buildUsingContributionTypeGroups(nodeId, contribution);
  const details: string[] = [];
  if (!rootRelevant) {
    details.push(`not relevant for root '${facts.rootTag ?? "unknown"}'`);
  }
  details.push(hasIndexedInsertCount ? `inserts=${insertions}` : "inserts=index-missing");

  return {
    type: "contribution",
    id: nodeId,
    label: contribution.contributionName,
    description: details.join(", "),
    tooltip: [
      contribution.targetXPath ? `TargetXPath: ${contribution.targetXPath}` : undefined,
      contribution.insert ? `Insert: ${contribution.insert}` : undefined,
      rootRelevant ? undefined : `Root mismatch (current root=${facts.rootTag ?? "unknown"})`
    ].filter(Boolean).join("\n"),
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    icon: rootRelevant ? iconForUsage(usageState) : new vscode.ThemeIcon("circle-outline"),
    contextValue: "compositionContribution",
    resourceUri: component.uri,
    sourceLocation: location,
    usageLocations: getUsingUsageLocations(facts, index, componentKey, contribution.contributionName),
    children: [metaGroup, ...(placeholderGroup ? [placeholderGroup] : []), ...typeGroups, ...(typeGroups.length === 0 ? [detailNode("No typed symbols.")] : [])]
  };
}

function buildUsingContributionMetaGroup(
  contributionNodeId: string,
  contribution: IndexedComponentContributionSummary,
  insertTrace: ReturnType<typeof getIndexedContributionInsertTrace>
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
  contribution: IndexedComponentContributionSummary
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

  return groups;
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
  document: vscode.TextDocument,
  facts: ReturnType<typeof parseDocumentFacts>,
  componentKey: string,
  contributionName: string
): vscode.Location[] {
  return facts.placeholderReferences
    .filter((ref) => ref.componentKey === componentKey && (ref.contributionValue ?? "").trim() === contributionName)
    .map((ref) => new vscode.Location(document.uri, ref.range))
    .sort(compareLocations);
}

function getIndexedContributionInsertCount(
  facts: ReturnType<typeof parseDocumentFacts>,
  componentKey: string,
  contributionName: string
): number | undefined {
  const key = `${componentKey}::${contributionName}`;
  return facts.usingContributionInsertCounts.get(key);
}

function getIndexedContributionInsertTrace(
  facts: ReturnType<typeof parseDocumentFacts>,
  componentKey: string,
  contributionName: string
): UsingContributionInsertTrace | undefined {
  const key = `${componentKey}::${contributionName}`;
  return facts.usingContributionInsertTraces.get(key);
}

function evaluateUsingInsertImpact(
  facts: ReturnType<typeof parseDocumentFacts>,
  componentKey: string,
  contributions: readonly IndexedComponentContributionSummary[]
): { kind: "effective" | "partial" | "unused"; message: string } {
  const relevant = contributions.filter((contribution) => contributionMatchesDocumentRoot(facts.rootTag, contribution));
  if (relevant.length === 0) {
    return {
      kind: "unused",
      message: `No contributions with matching root '${facts.rootTag ?? "unknown"}'.`
    };
  }

  let successCount = 0;
  for (const contribution of relevant) {
    const inserts = getIndexedContributionInsertCount(facts, componentKey, contribution.contributionName) ?? 0;
    if (inserts > 0) {
      successCount++;
    }
  }

  if (successCount === 0) {
    return {
      kind: "unused",
      message: `Insert failed for all ${relevant.length} root-relevant contribution(s).`
    };
  }

  if (successCount < relevant.length) {
    return {
      kind: "partial",
      message: `Insert succeeded for ${successCount}/${relevant.length} root-relevant contribution(s).`
    };
  }

  return {
    kind: "effective",
    message: `Insert succeeded for all ${relevant.length} root-relevant contribution(s).`
  };
}

function aggregateFormControls(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): AggregatedSymbol[] {
  const local = facts.declaredControlInfos.map((item) => ({
    ident: item.ident,
    location: new vscode.Location(documentUri, item.range)
  }));
  const injected = collectUsingSymbols(facts, index, (summary) => summary.formControlIdents);
  return mergeAggregatedSymbols(local, injected);
}

function aggregateFormButtons(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): AggregatedSymbol[] {
  const local = facts.declaredButtonInfos.map((item) => ({
    ident: item.ident,
    location: new vscode.Location(documentUri, item.range)
  }));
  const injected = collectUsingSymbols(facts, index, (summary) => summary.formButtonIdents);
  return mergeAggregatedSymbols(local, injected);
}

function aggregateFormSections(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): AggregatedSymbol[] {
  const local = facts.identOccurrences
    .filter((item) => item.kind === "section")
    .map((item) => ({
      ident: item.ident,
      location: new vscode.Location(documentUri, item.range)
    }));
  const injected = collectUsingSymbols(facts, index, (summary) => summary.formSectionIdents);
  return mergeAggregatedSymbols(local, injected);
}

function aggregateWorkflowShareCodes(
  documentUri: vscode.Uri,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
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
  const injected = new Map<string, { source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location; usageCount?: number; usageLocations?: vscode.Location[] }>();

  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    const selected = selectRelevantUsingContributions(facts, component, usingRef.sectionValue);
    const sourceLabel = usingRef.sectionValue
      ? `${usingRef.rawComponentValue}#${usingRef.sectionValue}`
      : usingRef.rawComponentValue;
    for (const ident of unionContributionIdents(selected, selector)) {
      if (!injected.has(ident)) {
        injected.set(ident, {
          source: sourceLabel,
          resourceUri: component.uri,
          sourceLocation: findContributionLocationForIdent(component, selected, ident, selector),
          usageCount: usageLocationsByIdent.get(ident)?.length ?? 0,
          usageLocations: usageLocationsByIdent.get(ident) ?? []
        });
      }
    }
  }

  return mergeAggregatedSymbols(local, injected);
}

function collectUsingSymbols(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  selector: (summary: IndexedComponentContributionSummary) => ReadonlySet<string>
): Map<string, { source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location }> {
  const injected = new Map<string, { source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location }>();
  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    const selected = selectRelevantUsingContributions(facts, component, usingRef.sectionValue);
    const sourceLabel = usingRef.sectionValue
      ? `${usingRef.rawComponentValue}#${usingRef.sectionValue}`
      : usingRef.rawComponentValue;
    for (const ident of unionContributionIdents(selected, selector)) {
      if (!injected.has(ident)) {
        injected.set(ident, {
          source: sourceLabel,
          resourceUri: component.uri,
          sourceLocation: findContributionLocationForIdent(component, selected, ident, selector)
        });
      }
    }
  }

  return injected;
}

function mergeAggregatedSymbols(
  localSymbols: ReadonlyArray<{ ident: string; location?: vscode.Location; usageCount?: number; usageLocations?: vscode.Location[] }>,
  injectedMap: ReadonlyMap<string, { source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location; usageCount?: number; usageLocations?: vscode.Location[] }>
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

  for (const [ident, source] of injectedMap.entries()) {
    if (out.has(ident)) {
      continue;
    }
    out.set(ident, {
      ident,
      origin: "injected",
      source: source.source,
      resourceUri: source.resourceUri,
      sourceLocation: source.sourceLocation,
      usageCount: source.usageCount,
      usageLocations: source.usageLocations
    });
  }

  return [...out.values()].sort((a, b) => a.ident.localeCompare(b.ident));
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
            tooltip: symbol.source ? `Injected from ${symbol.source}` : symbol.origin,
            icon: new vscode.ThemeIcon(symbol.origin === "local" ? "circle-large-filled" : "arrow-circle-right"),
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

function buildActionsNode(root: string, nodeId: string): GroupNode {
  const actions: CompositionTreeNode[] = [
    actionNode("Refresh View", "sfpXmlLinter.refreshCompositionView", "refresh"),
    actionNode("Show Composition Log", "sfpXmlLinter.showCompositionLog", "output"),
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

function actionNode(label: string, command: string, iconId: string): DetailNode {
  return {
    type: "detail",
    label,
    icon: new vscode.ThemeIcon(iconId),
    command: {
      command,
      title: label
    }
  };
}

function findContributionLocationForIdent(
  component: NonNullable<ReturnType<typeof resolveComponentByKey>>,
  selected: readonly IndexedComponentContributionSummary[],
  ident: string,
  selector: (summary: IndexedComponentContributionSummary) => ReadonlySet<string>
): vscode.Location | undefined {
  const matching = selected.filter((summary) => selector(summary).has(ident));
  if (matching.length !== 1) {
    return undefined;
  }

  const contributionName = matching[0]?.contributionName;
  if (!contributionName) {
    return undefined;
  }

  return component.contributionDefinitions.get(contributionName);
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
    for (const location of index.componentReferenceLocationsByKey.get(entrypointComponentKey) ?? []) {
      pushUniqueLocationMap(seen, location);
    }
  }
  for (const part of report.parts) {
    const componentKey = toIndexedComponentKey(part.file);
    for (const location of index.componentReferenceLocationsByKey.get(componentKey) ?? []) {
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
  for (const location of index.componentReferenceLocationsByKey.get(partComponentKey) ?? []) {
    pushUniqueLocationMap(seen, location);
  }
  if (seen.size === 0 && entrypointComponentKey) {
    for (const location of index.componentReferenceLocationsByKey.get(entrypointComponentKey) ?? []) {
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
  for (const location of index.componentContributionReferenceLocationsByKey.get(partComponentKey)?.get(contributionName) ?? []) {
    pushUniqueLocationMap(seen, location);
  }

  if (seen.size === 0 && entrypointComponentKey) {
    for (const location of index.componentReferenceLocationsByKey.get(entrypointComponentKey) ?? []) {
      pushUniqueLocationMap(seen, location);
    }
  }

  return [...seen.values()].sort(compareLocations);
}

function getUsingUsageLocations(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  componentKey: string,
  contributionName?: string
): vscode.Location[] {
  const currentOwner = facts.formIdent ?? facts.workflowFormIdent;
  const locations = contributionName
    ? index.componentContributionReferenceLocationsByKey.get(componentKey)?.get(contributionName) ?? []
    : index.componentReferenceLocationsByKey.get(componentKey) ?? [];
  if (!currentOwner) {
    return [...locations].sort(compareLocations);
  }

  return locations
    .filter((location) => {
      const locationFacts = index.parsedFactsByUri.get(location.uri.toString());
      const locationOwner = locationFacts?.formIdent ?? locationFacts?.workflowFormIdent;
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

function iconForUsage(usage: "effective" | "partial" | "unused"): vscode.ThemeIcon {
  switch (usage) {
    case "effective":
      return new vscode.ThemeIcon("pass");
    case "partial":
      return new vscode.ThemeIcon("warning");
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
