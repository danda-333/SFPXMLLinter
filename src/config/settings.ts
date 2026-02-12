import * as vscode from "vscode";

export type RuleSeverity = "off" | "warning" | "error";

export interface SfpXmlLinterSettings {
  workspaceRoots: string[];
  resourcesRoots: string[];
  hoverDocsFiles: string[];
  ruleSeverities: Record<string, RuleSeverity>;
  templateBuilderMode: "auto" | "typescript" | "powershell";
  powershellScriptPath: string;
  autoBuildOnSave: boolean;
  componentSaveBuildScope: "dependents" | "full";
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
  "unknown-using-component": "error",
  "unknown-using-section": "warning",
  "typo-maxlenght-attribute": "warning",
  "sql-convention-equals-spacing": "warning",
  "ident-convention-button-postfix": "warning",
  "ident-convention-group-button-postfix": "warning",
  "ident-convention-workflow-postfix": "warning",
  "ident-convention-view-postfix": "warning",
  "ident-convention-lookup-control": "warning"
};

export function getSettings(): SfpXmlLinterSettings {
  const cfg = vscode.workspace.getConfiguration("sfpXmlLinter");
  const workspaceRoots = cfg.get<string[]>("workspaceRoots", ["XML", "XML_Templates", "XML_Components"]);
  const resourcesRoots = cfg.get<string[]>("resourcesRoots", ["Resources"]);
  const hoverDocsFiles = cfg.get<string[]>("hoverDocsFiles", ["Docs/hover-docs.json", "Docs/hover-docs.team.json"]);
  const rawRules = cfg.get<Record<string, unknown>>("rules", {});

  const ruleSeverities: Record<string, RuleSeverity> = { ...DEFAULT_RULES };
  for (const [ruleId, value] of Object.entries(rawRules)) {
    if (value === "off" || value === "warning" || value === "error") {
      ruleSeverities[ruleId] = value;
    }
  }

  const templateBuilderMode = cfg.get<"auto" | "typescript" | "powershell">("templateBuilder.mode", "auto");
  const powershellScriptPath = cfg.get<string>(
    "templateBuilder.powershellScriptPath",
    "SFPExampleProject/Scripts/BuildXmlTemplates.ps1"
  );
  const autoBuildOnSave = cfg.get<boolean>("templateBuilder.autoBuildOnSave", true);
  const componentSaveBuildScope = cfg.get<"dependents" | "full">("templateBuilder.componentSaveBuildScope", "dependents");

  return {
    workspaceRoots,
    resourcesRoots,
    hoverDocsFiles,
    ruleSeverities,
    templateBuilderMode,
    powershellScriptPath,
    autoBuildOnSave,
    componentSaveBuildScope
  };
}

export function mapSeverityToDiagnostic(severity: RuleSeverity): vscode.DiagnosticSeverity | undefined {
  if (severity === "off") {
    return undefined;
  }

  return severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
}
