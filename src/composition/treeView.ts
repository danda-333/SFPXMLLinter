import * as vscode from "vscode";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { WorkspaceIndex, IndexedComponentContributionSummary } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { FeatureManifestRegistry } from "./workspace";
import { analyzeUsingImpact, countFormProvidedSymbols, selectUsingContributions, unionContributionIdents } from "./usingImpact";
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

    if (element.id && this.expandedNodeIds.has(element.id)) {
      return vscode.TreeItemCollapsibleState.Expanded;
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

    const facts = parseDocumentFacts(document);
    const registry = this.getFeatureRegistry();
    const index = this.getIndexForUri(document.uri);
    const relPath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    const featureReport = findFeatureForRelativePath(registry, relPath);
    if (featureReport) {
      return buildFeatureTree(featureReport, registry, index, document.uri);
    }

    const regularXmlTree = buildRegularXmlTree(document, facts, index);
    if (regularXmlTree.length > 0) {
      return regularXmlTree;
    }

    const usingTree = buildUsingTree(facts, index);
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
  const entrypointComponentKey = featureManifest?.entrypoint ? normalizeComponentKey(featureManifest.entrypoint) : undefined;
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
      const partComponentKey = normalizeComponentKey(part.file);
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
    `${featureNodeId}:parts`
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
    `${featureNodeId}:conflicts`
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
        infoGroupNode("Summary", summaryChildren, `${featureNodeId}:summary`),
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

  const rootNodeId = `document:${document.uri.toString()}`;
  const children: CompositionTreeNode[] = [];
  children.push(buildDocumentSummaryNode(document, facts, index, `${rootNodeId}:summary`));
  children.push(buildActionsNode(root, `${rootNodeId}:actions`));

  if (root === "form") {
    const controls = aggregateFormControls(document.uri, facts, index);
    const buttons = aggregateFormButtons(document.uri, facts, index);
    const sections = aggregateFormSections(document.uri, facts, index);
    children.push(buildSymbolGroup("Controls", controls, "symbol-field", `${rootNodeId}:controls`));
    children.push(buildSymbolGroup("Buttons", buttons, "symbol-event", `${rootNodeId}:buttons`));
    children.push(buildSymbolGroup("Sections", sections, "symbol-structure", `${rootNodeId}:sections`));
  } else {
    const controlShareCodes = aggregateWorkflowShareCodes(
      document.uri,
      facts,
      index,
      (summary) => summary.workflowControlShareCodeIdents,
      [...facts.declaredControlShareCodes],
      facts.controlShareCodeDefinitions
    );
    const buttonShareCodes = aggregateWorkflowShareCodes(
      document.uri,
      facts,
      index,
      (summary) => summary.workflowButtonShareCodeIdents,
      [...facts.declaredButtonShareCodes],
      facts.buttonShareCodeDefinitions
    );
    const actionShareCodes = aggregateWorkflowShareCodes(
      document.uri,
      facts,
      index,
      (summary) => summary.workflowActionShareCodeIdents,
      [...facts.declaredActionShareCodes],
      facts.actionShareCodeDefinitions
    );

    children.push(buildSymbolGroup("ControlShareCodes", controlShareCodes, "symbol-key", `${rootNodeId}:controlShareCodes`));
    children.push(buildSymbolGroup("ButtonShareCodes", buttonShareCodes, "symbol-key", `${rootNodeId}:buttonShareCodes`));
    children.push(buildSymbolGroup("ActionShareCodes", actionShareCodes, "symbol-key", `${rootNodeId}:actionShareCodes`));
  }

  const usingTree = buildUsingTree(facts, index);
  if (usingTree.length > 0) {
    children.push(...usingTree);
  }

  return [
    {
      id: `${rootNodeId}:root`,
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

        const impact = analyzeUsingImpact(facts, usingRef.rawComponentValue, usingRef.sectionValue, component);
        const contributions = selectUsingContributions(component, usingRef.sectionValue);
        const isWorkflow = (facts.rootTag ?? "").toLowerCase() === "workflow";
        const detailLines = isWorkflow
          ? [
              `ActionShareCodes: ${unionContributionIdents(contributions, (contribution) => contribution.workflowActionShareCodeIdents).size}`,
              `ControlShareCodes: ${unionContributionIdents(contributions, (contribution) => contribution.workflowControlShareCodeIdents).size}`,
              `ButtonShareCodes: ${unionContributionIdents(contributions, (contribution) => contribution.workflowButtonShareCodeIdents).size}`
            ]
          : [
              `Form symbols: ${countFormProvidedSymbols(contributions)}`
            ];

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
          children: [
            detailNode(`Contribution: ${usingRef.sectionValue ?? "(all)"}`),
            ...detailLines.map((line) => detailNode(line)),
            ...(impact.message ? [detailNode(impact.message)] : [])
          ]
        } satisfies UsingNode;
      }),
      `using-group:${facts.rootTag ?? "xml"}:${facts.formIdent ?? facts.workflowFormIdent ?? "unknown"}`
    )
  ];
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
  localDefinitions: ReadonlyMap<string, vscode.Range>
): AggregatedSymbol[] {
  const local = localIdents.map((ident) => ({
    ident,
    location: localDefinitions.get(ident) ? new vscode.Location(documentUri, localDefinitions.get(ident)!) : undefined
  }));
  const injected = new Map<string, { source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location }>();

  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    const selected = selectUsingContributions(component, usingRef.sectionValue);
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

    const selected = selectUsingContributions(component, usingRef.sectionValue);
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
  localSymbols: ReadonlyArray<{ ident: string; location?: vscode.Location }>,
  injectedMap: ReadonlyMap<string, { source: string; resourceUri?: vscode.Uri; sourceLocation?: vscode.Location }>
): AggregatedSymbol[] {
  const out = new Map<string, AggregatedSymbol>();

  for (const localSymbol of localSymbols) {
    out.set(localSymbol.ident, {
      ident: localSymbol.ident,
      origin: "local",
      sourceLocation: localSymbol.location,
      resourceUri: localSymbol.location?.uri
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
      sourceLocation: source.sourceLocation
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
            description: symbol.origin,
            tooltip: symbol.source ? `Injected from ${symbol.source}` : symbol.origin,
            icon: new vscode.ThemeIcon(symbol.origin === "local" ? "circle-large-filled" : "arrow-circle-right"),
            resourceUri: symbol.resourceUri,
            contextValue: symbol.sourceLocation ? "compositionSymbol" : undefined,
            sourceLocation: symbol.sourceLocation,
            usageLocations: undefined
          }))
        : [detailNode("No items.")]
  };
}

function buildActionsNode(root: string, nodeId: string): GroupNode {
  const actions: CompositionTreeNode[] = [
    actionNode("Refresh View", "sfpXmlLinter.refreshCompositionView", "refresh"),
    actionNode("Show Composition Log", "sfpXmlLinter.showCompositionLog", "output"),
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
    const componentKey = normalizeComponentKey(part.file);
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
