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

          if (code === "sql-convention-equals-spacing") {
            const fixSpacingAction = this.createSqlEqualsSpacingFixAction(document, diagnostic);
            if (fixSpacingAction) {
              actions.push(fixSpacingAction);
            }

            actions.push(this.createSqlInlineIgnoreAction(document, diagnostic, code));
          } else if (code === "suppression-conflict") {
            const removeUsing = this.createRemoveUsingLineAction(document, diagnostic, "Remove conflicting Using");
            if (removeUsing) {
              actions.push(removeUsing);
            }
            const removeSuppression = this.createRemoveSuppressionAttributeAction(document, diagnostic);
            if (removeSuppression) {
              actions.push(removeSuppression);
            }
          } else if (code === "suppression-noop") {
            const removeSuppression = this.createRemoveSuppressionAttributeAction(document, diagnostic);
            if (removeSuppression) {
              actions.push(removeSuppression);
            }
            const removeUsing = this.createRemoveUsingLineAction(document, diagnostic, "Remove no-op Using");
            if (removeUsing) {
              actions.push(removeUsing);
            }
          } else if (code === "ordering-conflict") {
            actions.push(this.createOpenCompositionLogAction(diagnostic));
            actions.push(this.createRevalidateWorkspaceAction(diagnostic));
          } else {
            actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
          }
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
    edit.insert(document.uri, getFileIgnoreInsertPosition(document), `<!-- @IgnoreFile ${ruleId} -->\n`);

    action.edit = edit;
    return action;
  }

  private createIgnoreAllInFileAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction("Ignore all SFP XML Linter rules in file", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];

    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, getFileIgnoreInsertPosition(document), "<!-- @IgnoreFile all -->\n");

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

  private createSqlInlineIgnoreAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic, ruleId: string): vscode.CodeAction {
    const action = new vscode.CodeAction(`Ignore '${ruleId}' on this SQL line`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];

    const line = diagnostic.range.start.line;
    const text = document.lineAt(line).text;
    const insertPos = new vscode.Position(line, text.length);
    const suffix = text.trimEnd().endsWith("*/") ? "" : ` /* @Ignore ${ruleId} */`;

    const edit = new vscode.WorkspaceEdit();
    if (suffix.length > 0) {
      edit.insert(document.uri, insertPos, suffix);
    }

    action.edit = edit;
    return action;
  }

  private createSqlEqualsSpacingFixAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | undefined {
    const eqRange = diagnostic.range;
    if (eqRange.start.line !== eqRange.end.line) {
      return undefined;
    }

    const eqOffset = document.offsetAt(eqRange.start);
    const fullText = document.getText();
    const eqChar = fullText[eqOffset] ?? "";
    if (eqChar !== "=") {
      return undefined;
    }

    const prev = eqOffset > 0 ? fullText[eqOffset - 1] : "";
    const next = eqOffset + 1 < fullText.length ? fullText[eqOffset + 1] : "";
    const needsLeftSpace = !isWhitespace(prev);
    const needsRightSpace = !isWhitespace(next);
    if (!needsLeftSpace && !needsRightSpace) {
      return undefined;
    }

    const action = new vscode.CodeAction("Fix SQL spacing around '='", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    const edit = new vscode.WorkspaceEdit();
    if (needsLeftSpace) {
      edit.insert(document.uri, eqRange.start, " ");
    }

    if (needsRightSpace) {
      edit.insert(document.uri, eqRange.end, " ");
    }

    action.edit = edit;
    return action;
  }

  private createOpenCompositionLogAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction("Show composition log (ordering details)", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.command = {
      command: "sfpXmlLinter.showCompositionLog",
      title: "Show composition log"
    };
    return action;
  }

  private createRevalidateWorkspaceAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction("Revalidate workspace", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.command = {
      command: "sfpXmlLinter.revalidateWorkspace",
      title: "Revalidate workspace"
    };
    return action;
  }

  private createRemoveUsingLineAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    title: string
  ): vscode.CodeAction | undefined {
    const line = diagnostic.range.start.line;
    if (line < 0 || line >= document.lineCount) {
      return undefined;
    }

    const lineText = document.lineAt(line).text;
    if (!/<\s*Using\b/i.test(lineText)) {
      return undefined;
    }

    const start = new vscode.Position(line, 0);
    const end = line + 1 < document.lineCount
      ? new vscode.Position(line + 1, 0)
      : new vscode.Position(line, lineText.length);
    const replaceRange = new vscode.Range(start, end);

    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, replaceRange, "");
    action.edit = edit;
    return action;
  }

  private createRemoveSuppressionAttributeAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const directLine = this.tryBuildSuppressionAttributeEdit(document, diagnostic.range.start.line);
    if (directLine) {
      const action = new vscode.CodeAction("Remove suppression attribute", vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, directLine.range, directLine.replacement);
      action.edit = edit;
      return action;
    }

    const featureFromMessage = extractSuppressionFeature(diagnostic.message);
    if (!featureFromMessage) {
      return undefined;
    }

    for (let line = 0; line < document.lineCount; line++) {
      const candidate = this.tryBuildSuppressionAttributeEdit(document, line, featureFromMessage);
      if (!candidate) {
        continue;
      }

      const action = new vscode.CodeAction("Remove suppression attribute", vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, candidate.range, candidate.replacement);
      action.edit = edit;
      return action;
    }

    return undefined;
  }

  private tryBuildSuppressionAttributeEdit(
    document: vscode.TextDocument,
    line: number,
    requiredFeature?: string
  ): { range: vscode.Range; replacement: string } | undefined {
    if (line < 0 || line >= document.lineCount) {
      return undefined;
    }

    const lineText = document.lineAt(line).text;
    if (!/<\s*Using\b/i.test(lineText)) {
      return undefined;
    }

    if (requiredFeature) {
      const featureAttr = /\b(?:Feature|Component|Name)\s*=\s*("([^"]*)"|'([^']*)')/i.exec(lineText);
      const featureValue = (featureAttr?.[2] ?? featureAttr?.[3] ?? "").trim();
      if (featureValue !== requiredFeature) {
        return undefined;
      }
    }

    const updated = lineText
      .replace(/\s+\bSuppressInheritance\s*=\s*("([^"]*)"|'([^']*)')/gi, "")
      .replace(/\s+\bInherit\s*=\s*("([^"]*)"|'([^']*)')/gi, "");
    if (updated === lineText) {
      return undefined;
    }

    return {
      range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, lineText.length)),
      replacement: updated
    };
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

function extractSuppressionFeature(message: string): string | undefined {
  const featureConflict = /Using feature '([^']+)' conflicts/i.exec(message);
  if (featureConflict?.[1]) {
    return featureConflict[1];
  }

  const suppressionMessage = /Suppression for feature '([^']+)'/i.exec(message);
  if (suppressionMessage?.[1]) {
    return suppressionMessage[1];
  }

  const sectionMessage = /Suppression for '([^'#]+)#([^']+)'/i.exec(message);
  if (sectionMessage?.[1]) {
    return sectionMessage[1];
  }

  return undefined;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function getFileIgnoreInsertPosition(document: vscode.TextDocument): vscode.Position {
  if (document.lineCount === 0) {
    return new vscode.Position(0, 0);
  }

  const firstLineText = document.lineAt(0).text;
  // Keep XML declaration as the first content in XML files.
  if (/^\s*<\?xml\b/i.test(firstLineText)) {
    return new vscode.Position(1, 0);
  }

  return new vscode.Position(0, 0);
}
