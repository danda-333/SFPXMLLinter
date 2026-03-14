import * as vscode from "vscode";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { WorkspaceIndex } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { FeatureManifestRegistry } from "./workspace";
import { analyzeUsingImpact, countFormProvidedSymbols, selectUsingContributions, unionContributionIdents } from "./usingImpact";
import { FeatureCapabilityReport } from "./model";

type CompositionTreeNode =
  | InfoNode
  | FeatureNode
  | PartNode
  | ContributionNode
  | ConflictNode
  | UsingNode
  | DetailNode;

interface BaseNode {
  type: string;
  label: string;
  description?: string;
  tooltip?: string;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  icon?: vscode.ThemeIcon;
  children?: CompositionTreeNode[];
  resourceUri?: vscode.Uri;
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

export class CompositionTreeProvider implements vscode.TreeDataProvider<CompositionTreeNode> {
  private readonly didChangeTreeDataEmitter = new vscode.EventEmitter<CompositionTreeNode | undefined | null | void>();

  public readonly onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

  public constructor(
    private readonly getActiveDocument: () => vscode.TextDocument | undefined,
    private readonly getIndexForUri: (uri: vscode.Uri) => WorkspaceIndex,
    private readonly getFeatureRegistry: () => FeatureManifestRegistry
  ) {}

  public refresh(): void {
    this.didChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: CompositionTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.icon;
    if (element.resourceUri) {
      item.resourceUri = element.resourceUri;
      item.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [element.resourceUri]
      };
    }
    return item;
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
        infoNode("Open an XML file to inspect feature composition and Using impact.")
      ];
    }

    const facts = parseDocumentFacts(document);
    const registry = this.getFeatureRegistry();
    const relPath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    const featureReport = findFeatureForRelativePath(registry, relPath);
    if (featureReport) {
      return buildFeatureTree(featureReport, registry, document.uri);
    }

    const usingTree = buildUsingTree(document, facts, this.getIndexForUri(document.uri));
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
  activeUri: vscode.Uri
): CompositionTreeNode[] {
  const model = registry.effectiveModelsByFeature.get(report.feature);
  const featureManifest = registry.manifestsByFeature.get(report.feature);
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
      const contributionReports = model?.contributions.filter((item) => item.partId === part.id) ?? [];
      return {
        type: "part",
        label: part.id,
        description: part.appliesTo.join(", "),
        tooltip: part.file,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        icon: new vscode.ThemeIcon("file-submodule"),
        resourceUri: featureManifest?.parts.find((item) => item.id === part.id)?.file
          ? vscode.Uri.file(
              toWorkspacePath(featureManifest.parts.find((item) => item.id === part.id)?.file ?? "", activeUri)
            )
          : undefined,
        children: contributionReports.length > 0
          ? contributionReports.map((contribution) => ({
              type: "contribution",
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
              children: [
                ...contribution.missingExpectationKeys.map((item) => detailNode(`Missing expect: ${item}`)),
                ...contribution.missingExpectedXPaths.map((item) => detailNode(`Missing xpath: ${item}`))
              ]
            }))
          : [detailNode("No contribution reports.")]
      } satisfies PartNode;
    })
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
  );

  return [
    {
      type: "feature",
      label: report.feature,
      description: featureManifest?.entrypoint ? "feature" : "auto",
      tooltip: featureManifest?.entrypoint ?? report.feature,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon("symbol-method"),
      children: [
        infoGroupNode("Summary", summaryChildren),
        partsNode,
        conflictsNode
      ]
    }
  ];
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
          type: "using",
          label: usingRef.rawComponentValue,
          description: impact.kind,
          tooltip: impact.message ?? usingRef.rawComponentValue,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          icon: iconForUsage(impact.kind),
          children: [
            detailNode(`Contribution: ${usingRef.sectionValue ?? "(all)"}`),
            ...detailLines.map((line) => detailNode(line)),
            ...(impact.message ? [detailNode(impact.message)] : [])
          ]
        } satisfies UsingNode;
      })
    )
  ];
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

function detailNode(label: string): DetailNode {
  return {
    type: "detail",
    label,
    icon: new vscode.ThemeIcon("circle-small-filled")
  };
}

function infoGroupNode(label: string, children: CompositionTreeNode[]): InfoNode {
  return {
    type: "info",
    label,
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    icon: new vscode.ThemeIcon("list-unordered"),
    children
  };
}

function partGroupNode(label: string, children: CompositionTreeNode[]): PartNode {
  return {
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
