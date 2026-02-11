import * as vscode from "vscode";

export class SfpXmlIgnoreCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  private static readonly MAX_INLINE_FIXES = 25;

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];
    const seenInline = new Set<string>();
    const addedRuleFileIgnores = new Set<string>();
    let addedIgnoreAllInFile = false;
    let inlineFixCount = 0;

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "sfp-xml-linter") {
        continue;
      }

      const code = typeof diagnostic.code === "string" ? diagnostic.code : undefined;
      if (!code) {
        continue;
      }

      const touchesSelection = diagnostic.range.intersection(range) !== undefined;
      if (touchesSelection && inlineFixCount < SfpXmlIgnoreCodeActionProvider.MAX_INLINE_FIXES) {
        const inlineKey = `${code}:${diagnostic.range.start.line}`;
        if (!seenInline.has(inlineKey)) {
          seenInline.add(inlineKey);

          const suggestionAction = this.createDidYouMeanFixAction(document, diagnostic);
          if (suggestionAction) {
            actions.push(suggestionAction);
          }

          actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
          inlineFixCount++;
        }
      }

      if (!addedRuleFileIgnores.has(code)) {
        actions.push(this.createIgnoreFileAction(document, diagnostic, code));
        addedRuleFileIgnores.add(code);
      }

      if (!addedIgnoreAllInFile) {
        actions.push(this.createIgnoreAllInFileAction(document, diagnostic));
        addedIgnoreAllInFile = true;
      }
    }

    return actions;
  }

  private createIgnoreNextLineAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic, ruleId: string): vscode.CodeAction {
    const action = new vscode.CodeAction(`Ignore '${ruleId}' on next line`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    const targetLine = diagnostic.range.start.line;
    const indent = whitespacePrefix(document.lineAt(targetLine).text);
    const insertPos = new vscode.Position(targetLine, 0);

    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertPos, `${indent}<!-- @Ignore ${ruleId} -->\n`);

    action.edit = edit;
    return action;
  }

  private createIgnoreFileAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic, ruleId: string): vscode.CodeAction {
    const action = new vscode.CodeAction(`Ignore '${ruleId}' in file`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];

    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(0, 0), `<!-- @IgnoreFile ${ruleId} -->\n`);

    action.edit = edit;
    return action;
  }

  private createIgnoreAllInFileAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction("Ignore all SFP XML Linter rules in file", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];

    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(0, 0), "<!-- @IgnoreFile all -->\n");

    action.edit = edit;
    return action;
  }

  private createDidYouMeanFixAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const suggestion = extractDidYouMeanSuggestion(diagnostic.message);
    if (!suggestion) {
      return undefined;
    }

    if (diagnostic.range.start.isEqual(diagnostic.range.end)) {
      return undefined;
    }

    const action = new vscode.CodeAction(`Replace with '${suggestion}'`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, suggestion);
    action.edit = edit;
    return action;
  }
}

function whitespacePrefix(text: string): string {
  const match = /^\s*/.exec(text);
  return match?.[0] ?? "";
}

function extractDidYouMeanSuggestion(message: string): string | undefined {
  const singleQuoteMatch = /Did you mean '([^']+)'/i.exec(message);
  if (singleQuoteMatch?.[1]) {
    return singleQuoteMatch[1];
  }

  const doubleQuoteMatch = /Did you mean "([^"]+)"/i.exec(message);
  if (doubleQuoteMatch?.[1]) {
    return doubleQuoteMatch[1];
  }

  return undefined;
}
