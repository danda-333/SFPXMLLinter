import * as vscode from "vscode";

export class DiagnosticsHoverProvider implements vscode.HoverProvider {
  constructor(private readonly diagnostics: vscode.DiagnosticCollection) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const entries = this.diagnostics
      .get(document.uri)
      ?.filter((d) => d.range.contains(position));

    if (!entries || entries.length === 0) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.appendMarkdown("### SFP XML Linter\n\n");

    for (const diag of entries) {
      const severity = diagnosticSeverityToString(diag.severity);
      const code = diag.code ? `\`${String(diag.code)}\`` : "`unknown`";
      markdown.appendMarkdown(`- **${severity}** ${code}: ${escapeMarkdown(diag.message)}\n`);
    }

    return new vscode.Hover(markdown);
  }
}

function diagnosticSeverityToString(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "Error";
    case vscode.DiagnosticSeverity.Warning:
      return "Warning";
    case vscode.DiagnosticSeverity.Information:
      return "Info";
    default:
      return "Hint";
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
