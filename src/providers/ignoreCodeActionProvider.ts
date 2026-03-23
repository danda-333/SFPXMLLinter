import * as vscode from "vscode";
import * as fs from "node:fs";
import {
  migrateLegacyPlaceholderAliases as migrateLegacyPlaceholderAliasesShared,
  migrateLegacyTagAliases as migrateLegacyTagAliasesShared
} from "../template/legacyTemplateAliasMigration";

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
          } else if (code === "unknown-primitive") {
            const createPrimitiveAction = this.createCreatePrimitiveFileAction(document, diagnostic);
            if (createPrimitiveAction) {
              actions.push(createPrimitiveAction);
            }
            actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
          } else if (code === "primitive-missing-slot") {
            const addSlotAction = this.createAddMissingPrimitiveSlotAction(document, diagnostic);
            if (addSlotAction) {
              actions.push(addSlotAction);
            }
            actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
          } else if (code === "primitive-missing-param") {
            const addParamAction = this.createAddMissingPrimitiveParamAction(document, diagnostic);
            if (addParamAction) {
              actions.push(addParamAction);
            }
            actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
          } else if (code === "primitive-cycle") {
            const removeUsePrimitiveAction = this.createRemoveUsePrimitiveAction(document, diagnostic);
            if (removeUsePrimitiveAction) {
              actions.push(removeUsePrimitiveAction);
            }
            actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
          } else if (code === "missing-explicit-provides") {
            const addProvidesAction = this.createAddExplicitProvidesAction(document, diagnostic);
            if (addProvidesAction) {
              actions.push(addProvidesAction);
            }
            actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
          } else if (code === "legacy-template-alias-disabled") {
            const migrateLegacyAliasAction = this.createMigrateLegacyTemplateAliasAction(document, diagnostic);
            if (migrateLegacyAliasAction) {
              actions.push(migrateLegacyAliasAction);
            }
            actions.push(this.createIgnoreNextLineAction(document, diagnostic, code));
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

  private createCreatePrimitiveFileAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const primitiveKey = extractPrimitiveKeyFromMessage(diagnostic.message);
    if (!primitiveKey) {
      return undefined;
    }

    const primitiveUri = resolvePrimitiveTargetUri(document, primitiveKey);
    if (!primitiveUri) {
      return undefined;
    }

    if (fs.existsSync(primitiveUri.fsPath)) {
      const action = new vscode.CodeAction("Open primitive source", vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = {
        command: "vscode.open",
        title: "Open primitive source",
        arguments: [primitiveUri]
      };
      return action;
    }

    const action = new vscode.CodeAction(`Create primitive '${primitiveKey}'`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(primitiveUri, { ignoreIfExists: true, overwrite: false });
    edit.insert(primitiveUri, new vscode.Position(0, 0), buildPrimitiveTemplateSkeleton(primitiveKey));
    action.edit = edit;
    action.command = {
      command: "vscode.open",
      title: "Open created primitive",
      arguments: [primitiveUri]
    };
    return action;
  }

  private createAddMissingPrimitiveSlotAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const missingSlot = extractPrimitiveSlotFromMessage(diagnostic.message);
    if (!missingSlot) {
      return undefined;
    }

    const currentNodeText = document.getText(diagnostic.range);
    if (!/<\s*UsePrimitive\b/i.test(currentNodeText)) {
      return undefined;
    }

    const replacement = addMissingPrimitiveSlotToNode(currentNodeText, missingSlot);
    if (!replacement || replacement === currentNodeText) {
      return undefined;
    }

    const action = new vscode.CodeAction(`Add missing Slot '${missingSlot}'`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, replacement);
    action.edit = edit;
    return action;
  }

  private createAddMissingPrimitiveParamAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const missingParam = extractPrimitiveParamFromMessage(diagnostic.message);
    if (!missingParam) {
      return undefined;
    }

    const currentNodeText = document.getText(diagnostic.range);
    if (!/<\s*UsePrimitive\b/i.test(currentNodeText)) {
      return undefined;
    }

    const replacement = addMissingPrimitiveParamToNode(currentNodeText, missingParam);
    if (!replacement || replacement === currentNodeText) {
      return undefined;
    }

    const action = new vscode.CodeAction(`Add missing parameter '${missingParam}'`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, replacement);
    action.edit = edit;
    return action;
  }

  private createRemoveUsePrimitiveAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const nodeText = document.getText(diagnostic.range);
    if (!/<\s*UsePrimitive\b/i.test(nodeText)) {
      return undefined;
    }

    const action = new vscode.CodeAction("Remove cyclic UsePrimitive", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, "");
    action.edit = edit;
    return action;
  }

  private createAddExplicitProvidesAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const fullText = document.getText();
    const offset = document.offsetAt(diagnostic.range.start);
    const node = findContributionNodeAtOffset(fullText, offset);
    if (!node) {
      return undefined;
    }

    const symbols = inferProvidedSymbolsFromContributionBody(node.body);
    if (symbols.length === 0) {
      return undefined;
    }
    const contributionName = node.name ?? extractContributionNameFromMessage(diagnostic.message);
    if (!contributionName) {
      return undefined;
    }
    const updatedText = upsertManifestContributionContract(fullText, contributionName, symbols);
    if (!updatedText || updatedText === fullText) {
      return undefined;
    }

    const action = new vscode.CodeAction("Add explicit <Provides> symbols", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const edit = new vscode.WorkspaceEdit();
    const startPos = new vscode.Position(0, 0);
    const endPos = positionAtInText(fullText, fullText.length);
    edit.replace(document.uri, new vscode.Range(startPos, endPos), updatedText);
    action.edit = edit;
    return action;
  }

  private createMigrateLegacyTemplateAliasAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | undefined {
    const fullText = document.getText();
    const startOffset = document.offsetAt(diagnostic.range.start);

    const placeholderRange = findEnclosingPlaceholderRange(fullText, startOffset);
    if (placeholderRange) {
      const placeholderText = fullText.slice(placeholderRange.start, placeholderRange.end);
      const migrated = migrateLegacyPlaceholderAliasesShared(placeholderText);
      if (migrated !== placeholderText) {
        const action = new vscode.CodeAction("Migrate to Feature/Contribution (placeholder)", vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(placeholderRange.start), document.positionAt(placeholderRange.end)),
          migrated
        );
        action.edit = edit;
        return action;
      }
    }

    const tagRange = findEnclosingTagRange(fullText, startOffset, ["Using", "Include"]);
    if (tagRange) {
      const tagText = fullText.slice(tagRange.start, tagRange.end);
      const migrated = migrateLegacyTagAliasesShared(tagText);
      if (migrated !== tagText) {
        const action = new vscode.CodeAction("Migrate to Feature/Contribution (tag)", vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(tagRange.start), document.positionAt(tagRange.end)),
          migrated
        );
        action.edit = edit;
        return action;
      }
    }

    return undefined;
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

function extractPrimitiveKeyFromMessage(message: string): string | undefined {
  const match = /Primitive '([^']+)'/i.exec(message);
  const value = (match?.[1] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function findEnclosingPlaceholderRange(text: string, offset: number): { start: number; end: number } | undefined {
  const start = text.lastIndexOf("{{", offset);
  if (start < 0) {
    return undefined;
  }
  const end = text.indexOf("}}", offset);
  if (end < 0 || end < start) {
    return undefined;
  }
  const finalEnd = end + 2;
  if (offset < start || offset > finalEnd) {
    return undefined;
  }
  return { start, end: finalEnd };
}

function findEnclosingTagRange(
  text: string,
  offset: number,
  tagNames: readonly string[]
): { start: number; end: number } | undefined {
  const names = tagNames.map((tag) => tag.toLowerCase());
  const regex = /<\s*([A-Za-z_][\w:.-]*)\b/g;
  let foundStart = -1;
  let foundTagName = "";
  for (const match of text.matchAll(regex)) {
    const start = typeof match.index === "number" ? match.index : -1;
    if (start < 0 || start > offset) {
      continue;
    }
    const name = (match[1] ?? "").toLowerCase();
    if (!names.includes(name)) {
      continue;
    }
    foundStart = start;
    foundTagName = name;
  }
  if (foundStart < 0 || !foundTagName) {
    return undefined;
  }

  const close = text.indexOf(">", foundStart);
  if (close < 0) {
    return undefined;
  }
  if (offset > close + 1) {
    return undefined;
  }
  return { start: foundStart, end: close + 1 };
}

function migrateLegacyTagAliases(tagText: string): string {
  let out = tagText;

  const hasFeature = /\bFeature\s*=/i.test(out);
  if (hasFeature) {
    out = out.replace(/\s+\bComponent\s*=\s*("([^"]*)"|'([^']*)')/gi, "");
    out = out.replace(/\s+\bName\s*=\s*("([^"]*)"|'([^']*)')/gi, "");
  } else {
    out = out.replace(/\bComponent\s*=/gi, "Feature=");
    out = out.replace(/\bName\s*=/gi, "Feature=");
    // Deduplicate accidental duplicate Feature attribute by removing later ones.
    out = dedupeFirstAttribute(out, "Feature");
  }

  if (/\bContribution\s*=/i.test(out)) {
    out = out.replace(/\s+\bSection\s*=\s*("([^"]*)"|'([^']*)')/gi, "");
  } else {
    out = out.replace(/\bSection\s*=/gi, "Contribution=");
  }

  return out;
}

function migrateLegacyPlaceholderAliases(placeholderText: string): string {
  const bodyMatch = /^\{\{([\s\S]*)\}\}$/.exec(placeholderText);
  if (!bodyMatch) {
    return placeholderText;
  }

  const body = bodyMatch[1] ?? "";
  const pairs = body.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const outPairs: string[] = [];
  let hasFeature = false;
  let hasContribution = false;

  for (const pair of pairs) {
    const idx = pair.indexOf(":");
    if (idx <= 0) {
      outPairs.push(pair);
      continue;
    }
    const rawKey = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    const keyLower = rawKey.toLowerCase();

    if ((keyLower === "component" || keyLower === "name") && !hasFeature) {
      outPairs.push(`Feature:${value}`);
      hasFeature = true;
      continue;
    }
    if (keyLower === "feature") {
      outPairs.push(`Feature:${value}`);
      hasFeature = true;
      continue;
    }
    if (keyLower === "section" && !hasContribution) {
      outPairs.push(`Contribution:${value}`);
      hasContribution = true;
      continue;
    }
    if (keyLower === "contribution") {
      outPairs.push(`Contribution:${value}`);
      hasContribution = true;
      continue;
    }

    outPairs.push(pair);
  }

  return `{{${outPairs.join(",")}}}`;
}

function dedupeFirstAttribute(tagText: string, attrName: string): string {
  const attrRegex = new RegExp(`\\b${attrName}\\s*=\\s*(\"[^\"]*\"|'[^']*')`, "gi");
  let found = false;
  return tagText.replace(attrRegex, (full) => {
    if (!found) {
      found = true;
      return full;
    }
    return "";
  }).replace(/\s{2,}/g, " ");
}

type SymbolKind =
  | "control"
  | "button"
  | "section"
  | "actionShareCode"
  | "buttonShareCode"
  | "controlShareCode"
  | "column"
  | "component"
  | "datasource"
  | "parameter";

type ContributionNode = {
  start: number;
  end: number;
  tag: "Contribution" | "Section";
  name?: string;
  openTag: string;
  body: string;
  closeStart: number;
  selfClosing: boolean;
  indent: string;
};

function findContributionNodeAtOffset(text: string, offset: number): ContributionNode | undefined {
  const regex = /<\s*(Contribution|Section)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\s*\1\s*>)/gi;
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const full = match[0] ?? "";
    const end = start + full.length;
    if (offset < start || offset > end) {
      continue;
    }

    const tag = ((match[1] ?? "Contribution") as "Contribution" | "Section");
    const attrs = parseAttributes(match[2] ?? "");
    const name = attrs.get("name");
    const selfClosing = /\/>\s*$/.test(full);
    const openTagEnd = full.indexOf(">") + 1;
    const openTag = openTagEnd > 0 ? full.slice(0, openTagEnd) : full;
    const body = selfClosing ? "" : (match[3] ?? "");
    const closeStartLocal = selfClosing ? full.length : full.lastIndexOf(`</${tag}`);
    const closeStart = start + (closeStartLocal >= 0 ? closeStartLocal : full.length);
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const linePrefix = text.slice(lineStart, start);
    const indent = (/^[ \t]*/.exec(linePrefix)?.[0]) ?? "";

    return { start, end, tag, name, openTag, body, closeStart, selfClosing, indent };
  }
  return undefined;
}

function inferProvidedSymbolsFromContributionBody(body: string): Array<{ kind: SymbolKind; ident: string }> {
  const out: Array<{ kind: SymbolKind; ident: string }> = [];
  collectByRegex(out, body, /<Control\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "control");
  collectByRegex(out, body, /<Button\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "button");
  collectByRegex(out, body, /<Section\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "section");
  collectByRegex(out, body, /<ActionShareCode\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "actionShareCode");
  collectByRegex(out, body, /<ButtonShareCode\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "buttonShareCode");
  collectByRegex(out, body, /<ControlShareCode\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "controlShareCode");
  collectByRegex(out, body, /<Column\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "column");
  collectByRegex(out, body, /<Component\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "component");
  collectByRegex(out, body, /<DataSource\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "datasource");
  collectByRegex(out, body, /<dsp:Parameter\b[^>]*\bIdent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, "parameter");

  const seen = new Set<string>();
  const dedup: Array<{ kind: SymbolKind; ident: string }> = [];
  for (const symbol of out) {
    const key = `${symbol.kind}:${symbol.ident}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedup.push(symbol);
  }
  return dedup;
}

function collectByRegex(
  out: Array<{ kind: SymbolKind; ident: string }>,
  content: string,
  regex: RegExp,
  kind: SymbolKind
): void {
  for (const match of content.matchAll(regex)) {
    const ident = (match[1] ?? match[2] ?? "").trim();
    if (!ident) {
      continue;
    }
    out.push({ kind, ident });
  }
}

function parseAttributes(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const regex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(regex)) {
    const key = (match[1] ?? "").trim().toLowerCase();
    if (!key) {
      continue;
    }
    out.set(key, (match[2] ?? match[3] ?? "").trim());
  }
  return out;
}

function extractContributionNameFromMessage(message: string): string | undefined {
  const match = /Contribution '([^']+)'/i.exec(message);
  const value = (match?.[1] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function upsertManifestContributionContract(
  text: string,
  contributionName: string,
  symbols: ReadonlyArray<{ kind: SymbolKind; ident: string }>
): string | undefined {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const indentUnit = detectIndentUnit(text);
  const manifestRegex = /<\s*Manifest\b[^>]*>([\s\S]*?)<\/\s*Manifest\s*>/i;
  const manifestMatch = manifestRegex.exec(text);
  if (!manifestMatch || typeof manifestMatch.index !== "number") {
    const rootMatch = /<\s*(Feature|Component)\b[^>]*>/i.exec(text);
    if (!rootMatch || typeof rootMatch.index !== "number") {
      return undefined;
    }
    const rootStart = rootMatch.index;
    const rootLineStart = text.lastIndexOf("\n", rootStart - 1) + 1;
    const rootIndent = (/^[ \t]*/.exec(text.slice(rootLineStart, rootStart))?.[0]) ?? "";
    const manifestIndent = `${rootIndent}${indentUnit}`;
    const contractIndent = `${manifestIndent}${indentUnit}`;
    const contract = buildContributionContractBlock(contractIndent, indentUnit, contributionName, symbols, newline);
    const insertion = `${newline}${manifestIndent}<Manifest>${newline}${contract}${manifestIndent}</Manifest>${newline}`;
    const insertOffset = rootStart + rootMatch[0].length;
    return `${text.slice(0, insertOffset)}${insertion}${text.slice(insertOffset)}`;
  }

  const manifestFull = manifestMatch[0] ?? "";
  const manifestStart = manifestMatch.index;
  const manifestBody = manifestMatch[1] ?? "";
  const bodyOffset = manifestFull.indexOf(manifestBody);
  const bodyStart = manifestStart + (bodyOffset >= 0 ? bodyOffset : 0);
  const bodyEnd = bodyStart + manifestBody.length;
  const manifestLineStart = text.lastIndexOf("\n", manifestStart - 1) + 1;
  const manifestIndent = (/^[ \t]*/.exec(text.slice(manifestLineStart, manifestStart))?.[0]) ?? "";
  const contractIndent = `${manifestIndent}${indentUnit}`;

  const contractRegex = /<\s*ContributionContract\b([^>]*?)>([\s\S]*?)<\/\s*ContributionContract\s*>/gi;
  for (const contractMatch of manifestBody.matchAll(contractRegex)) {
    const attrs = parseAttributes(contractMatch[1] ?? "");
    const forName = attrs.get("for") ?? attrs.get("name") ?? attrs.get("id");
    if (forName !== contributionName) {
      continue;
    }
    const contractFull = contractMatch[0] ?? "";
    const contractLocalStart = contractMatch.index ?? 0;
    const contractGlobalStart = bodyStart + contractLocalStart;
    const merged = upsertProvidesIntoContract(contractFull, symbols, indentUnit, newline, `${contractIndent}${indentUnit}`);
    if (!merged || merged === contractFull) {
      return text;
    }
    return `${text.slice(0, contractGlobalStart)}${merged}${text.slice(contractGlobalStart + contractFull.length)}`;
  }

  const contract = buildContributionContractBlock(contractIndent, indentUnit, contributionName, symbols, newline);
  const prefix = manifestBody.trim().length === 0 ? "" : newline;
  const suffix = manifestBody.trim().length === 0 ? "" : newline;
  return `${text.slice(0, bodyEnd)}${prefix}${contract}${suffix}${text.slice(bodyEnd)}`;
}

function upsertProvidesIntoContract(
  contractXml: string,
  symbols: ReadonlyArray<{ kind: SymbolKind; ident: string }>,
  indentUnit: string,
  newline: string,
  baseIndent: string
): string | undefined {
  const provideRegex = /<\s*Provides\b[^>]*>([\s\S]*?)<\/\s*Provides\s*>/i;
  const provideMatch = provideRegex.exec(contractXml);
  if (!provideMatch || typeof provideMatch.index !== "number") {
    const block = buildProvidesBlock(baseIndent, indentUnit, symbols, newline);
    const closeRegex = /<\/\s*ContributionContract\s*>/i;
    const closeMatch = closeRegex.exec(contractXml);
    if (!closeMatch || typeof closeMatch.index !== "number") {
      return undefined;
    }
    return `${contractXml.slice(0, closeMatch.index)}${newline}${block}${newline}${baseIndent}</ContributionContract>`;
  }

  const existingKeys = new Set<string>();
  const symbolRegex = /<\s*Symbol\b([^>]*?)\/>/gi;
  for (const symbolMatch of (provideMatch[0] ?? "").matchAll(symbolRegex)) {
    const attrs = parseAttributes(symbolMatch[1] ?? "");
    const kind = attrs.get("kind");
    const ident = attrs.get("ident");
    if (!kind || !ident) {
      continue;
    }
    existingKeys.add(`${kind}:${ident}`);
  }
  const missing = symbols.filter((symbol) => !existingKeys.has(`${symbol.kind}:${symbol.ident}`));
  if (missing.length === 0) {
    return contractXml;
  }

  const closeProvidesRegex = /<\/\s*Provides\s*>/i;
  const closeMatch = closeProvidesRegex.exec(contractXml);
  if (!closeMatch || typeof closeMatch.index !== "number") {
    return contractXml;
  }
  const symbolIndent = `${baseIndent}${indentUnit}`;
  const lines = missing.map((symbol) => `${symbolIndent}<Symbol Kind="${symbol.kind}" Ident="${symbol.ident}" />`).join(newline);
  const insertion = `${newline}${lines}`;
  return `${contractXml.slice(0, closeMatch.index)}${insertion}${contractXml.slice(closeMatch.index)}`;
}

function buildContributionContractBlock(
  contractIndent: string,
  indentUnit: string,
  contributionName: string,
  symbols: ReadonlyArray<{ kind: SymbolKind; ident: string }>,
  newline: string
): string {
  const providesBlock = buildProvidesBlock(`${contractIndent}${indentUnit}`, indentUnit, symbols, newline);
  return `${contractIndent}<ContributionContract For="${contributionName}">${newline}${providesBlock}${newline}${contractIndent}</ContributionContract>`;
}

function buildProvidesBlock(
  providesIndent: string,
  indentUnit: string,
  symbols: ReadonlyArray<{ kind: SymbolKind; ident: string }>,
  newline: string
): string {
  const symbolIndent = `${providesIndent}${indentUnit}`;
  const lines = symbols.map((symbol) => `${symbolIndent}<Symbol Kind="${symbol.kind}" Ident="${symbol.ident}" />`);
  return `${providesIndent}<Provides>${newline}${lines.join(newline)}${newline}${providesIndent}</Provides>`;
}

function detectIndentUnit(text: string): string {
  if (/\n\t+<\w/.test(text)) {
    return "\t";
  }
  return "  ";
}

function positionAtInText(text: string, offset: number): vscode.Position {
  const safe = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < safe; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return new vscode.Position(line, safe - lineStart);
}

function extractPrimitiveSlotFromMessage(message: string): string | undefined {
  const match = /missing required Slot '([^']+)'/i.exec(message);
  const value = (match?.[1] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function extractPrimitiveParamFromMessage(message: string): string | undefined {
  const match = /missing required parameter '([^']+)'/i.exec(message);
  const value = (match?.[1] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function resolvePrimitiveTargetUri(document: vscode.TextDocument, primitiveKey: string): vscode.Uri | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  const normalized = primitiveKey
    .replace(/\\/g, "/")
    .replace(/^\/*/, "")
    .replace(/(?:\.primitive)?\.xml$/i, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }

  const fileName = `${parts[parts.length - 1]}.primitive.xml`;
  const dirParts = parts.slice(0, -1);
  return vscode.Uri.joinPath(folder.uri, "XML_Primitives", ...dirParts, fileName);
}

function buildPrimitiveTemplateSkeleton(primitiveKey: string): string {
  const normalizedKey = primitiveKey.replace(/\\/g, "/").replace(/(?:\.primitive)?\.xml$/i, "");
  const primitiveName = normalizedKey.split("/").filter((part) => part.length > 0).pop() ?? "NewPrimitive";
  return [
    "<Primitive>",
    "  <Template Name=\"Default\">",
    `    <!-- TODO: implement primitive ${primitiveName} -->`,
    "  </Template>",
    "</Primitive>",
    ""
  ].join("\n");
}

function addMissingPrimitiveSlotToNode(nodeText: string, slotName: string): string | undefined {
  const selfClosing = /<\s*UsePrimitive\b([\s\S]*?)\/\s*>/i.exec(nodeText);
  if (selfClosing) {
    const attrs = selfClosing[1] ?? "";
    return `<UsePrimitive${attrs}>\n  <Slot Name="${slotName}"></Slot>\n</UsePrimitive>`;
  }

  const closingMatch = /<\/\s*UsePrimitive\s*>\s*$/i.exec(nodeText);
  if (!closingMatch) {
    return undefined;
  }

  const insertion = `\n  <Slot Name="${slotName}"></Slot>\n`;
  const closingStart = closingMatch.index ?? nodeText.length;
  return `${nodeText.slice(0, closingStart)}${insertion}${nodeText.slice(closingStart)}`;
}

function addMissingPrimitiveParamToNode(nodeText: string, paramName: string): string | undefined {
  const openTagMatch = /<\s*UsePrimitive\b([^>]*)>/i.exec(nodeText);
  if (!openTagMatch) {
    return undefined;
  }
  const attrs = openTagMatch[1] ?? "";
  if (new RegExp(`\\b${escapeRegex(paramName)}\\s*=`, "i").test(attrs)) {
    return undefined;
  }

  const openTagStart = openTagMatch.index ?? 0;
  const openTagText = openTagMatch[0];
  const insertAt = openTagStart + openTagText.length - 1;
  return `${nodeText.slice(0, insertAt)} ${paramName}=""${nodeText.slice(insertAt)}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}



