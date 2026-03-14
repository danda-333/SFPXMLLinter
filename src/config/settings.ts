import * as vscode from "vscode";

export type RuleSeverity = "off" | "warning" | "error" | "information";

export interface SfpXmlLinterSettings {
  workspaceRoots: string[];
  resourcesRoots: string[];
  hoverDocsFiles: string[];
  ruleSeverities: Record<string, RuleSeverity>;
  incompleteMode: boolean;
  formatterMaxConsecutiveBlankLines: number;
  autoBuildOnSave: boolean;
  componentSaveBuildScope: "dependents" | "full";
  templateBuilderMode: "fast" | "debug" | "release";
}

const DEFAULT_RULES: Record<string, RuleSeverity> = {
  "unknown-form-ident": "error",
  "unknown-form-control-ident": "error",
  "unknown-form-button-ident": "error",
  "unknown-workflow-button-share-code-ident": "error",
  "unknown-form-section-ident": "warning",
  "unknown-mapping-ident": "warning",
  "unknown-mapping-form-ident": "warning",
  "unknown-required-action-ident": "warning",
  "unknown-workflow-action-value-control-ident": "error",
  "unknown-workflow-show-hide-control-ident": "error",
  "unknown-html-template-control-ident": "error",
  "duplicate-control-ident": "warning",
  "duplicate-button-ident": "warning",
  "duplicate-section-ident": "warning",
  "unknown-using-feature": "error",
  "unknown-using-contribution": "warning",
  "contribution-mismatch": "warning",
  "unused-using": "information",
  "partial-using": "information",
  "workflow-redundant-feature-using": "warning",
  "dataview-redundant-feature-using": "warning",
  "feature-inheritance-override": "information",
  "suppression-conflict": "warning",
  "suppression-noop": "information",
  "typo-maxlenght-attribute": "warning",
  "sql-convention-equals-spacing": "warning",
  "ident-convention-button-postfix": "warning",
  "ident-convention-group-button-postfix": "warning",
  "ident-convention-workflow-postfix": "warning",
  "ident-convention-view-postfix": "warning",
  "ident-convention-lookup-control": "warning"
};

const LEGACY_RULE_ALIASES: Record<string, string> = {
  "unknown-using-component": "unknown-using-feature",
  "unknown-using-section": "unknown-using-contribution"
};

export function getSettings(): SfpXmlLinterSettings {
  const cfg = vscode.workspace.getConfiguration("sfpXmlLinter");
  const workspaceRoots = cfg.get<string[]>("workspaceRoots", ["XML", "XML_Templates", "XML_Components"]);
  const resourcesRoots = cfg.get<string[]>("resourcesRoots", ["Resources"]);
  const hoverDocsFiles = cfg.get<string[]>("hoverDocsFiles", ["Docs/hover-docs.json", "Docs/hover-docs.team.json"]);
  const rawRules = cfg.get<Record<string, unknown>>("rules", {});
  const incompleteMode = cfg.get<boolean>("incompleteMode", false);
  const formatterMaxConsecutiveBlankLines = Math.max(0, cfg.get<number>("formatter.maxConsecutiveBlankLines", 2));

  const ruleSeverities: Record<string, RuleSeverity> = { ...DEFAULT_RULES };
  for (const [ruleId, value] of Object.entries(rawRules)) {
    if (value === "off" || value === "warning" || value === "error" || value === "information") {
      ruleSeverities[ruleId] = value;
    }
  }

  for (const [legacyRuleId, currentRuleId] of Object.entries(LEGACY_RULE_ALIASES)) {
    if (rawRules[currentRuleId] === undefined && rawRules[legacyRuleId] !== undefined) {
      const value = rawRules[legacyRuleId];
      if (value === "off" || value === "warning" || value === "error" || value === "information") {
        ruleSeverities[currentRuleId] = value;
      }
    }
  }

  const autoBuildOnSave = cfg.get<boolean>("templateBuilder.autoBuildOnSave", true);
  const componentSaveBuildScope = cfg.get<"dependents" | "full">("templateBuilder.componentSaveBuildScope", "dependents");
  const templateBuilderMode = cfg.get<"fast" | "debug" | "release">("templateBuilder.mode", "debug");

  return {
    workspaceRoots,
    resourcesRoots,
    hoverDocsFiles,
    ruleSeverities,
    incompleteMode,
    formatterMaxConsecutiveBlankLines,
    autoBuildOnSave,
    componentSaveBuildScope,
    templateBuilderMode
  };
}

export function resolveRuleSeverity(settings: SfpXmlLinterSettings, ruleId: string): RuleSeverity {
  const direct = settings.ruleSeverities[ruleId];
  if (direct) {
    return direct;
  }

  for (const [legacyRuleId, currentRuleId] of Object.entries(LEGACY_RULE_ALIASES)) {
    if (currentRuleId === ruleId && settings.ruleSeverities[legacyRuleId]) {
      return settings.ruleSeverities[legacyRuleId];
    }
  }

  return "warning";
}

export function mapSeverityToDiagnostic(severity: RuleSeverity): vscode.DiagnosticSeverity | undefined {
  if (severity === "off") {
    return undefined;
  }

  if (severity === "error") {
    return vscode.DiagnosticSeverity.Error;
  }

  if (severity === "information") {
    return vscode.DiagnosticSeverity.Information;
  }

  return vscode.DiagnosticSeverity.Warning;
}
