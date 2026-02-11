import * as vscode from "vscode";

export interface IgnoreState {
  ignoredRulesForFile: Set<string>;
  ignoredRulesByLine: Map<number, Set<string>>;
}

export function parseIgnoreState(document: vscode.TextDocument): IgnoreState {
  const ignoredRulesForFile = new Set<string>();
  const ignoredRulesByLine = new Map<number, Set<string>>();

  for (let line = 0; line < document.lineCount; line++) {
    const content = document.lineAt(line).text;
    const commentMatch = /<!--\s*@Ignore(File)?\s+([^>]+?)\s*-->/.exec(content);
    if (!commentMatch) {
      continue;
    }

    const isFile = Boolean(commentMatch[1]);
    const rawRules = commentMatch[2];
    const rules = rawRules
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => v.toLowerCase());

    if (isFile) {
      for (const rule of rules) {
        ignoredRulesForFile.add(rule);
      }
      continue;
    }

    const targetLine = findNextMeaningfulLine(document, line + 1);
    if (targetLine === undefined) {
      continue;
    }

    const entry = ignoredRulesByLine.get(targetLine) ?? new Set<string>();
    for (const rule of rules) {
      entry.add(rule);
    }
    ignoredRulesByLine.set(targetLine, entry);
  }

  return {
    ignoredRulesForFile,
    ignoredRulesByLine
  };
}

export function isRuleIgnored(ignoreState: IgnoreState, ruleId: string, line: number): boolean {
  const normalized = ruleId.toLowerCase();

  if (ignoreState.ignoredRulesForFile.has("all") || ignoreState.ignoredRulesForFile.has(normalized)) {
    return true;
  }

  const lineRules = ignoreState.ignoredRulesByLine.get(line);
  if (!lineRules) {
    return false;
  }

  return lineRules.has("all") || lineRules.has(normalized);
}

function findNextMeaningfulLine(document: vscode.TextDocument, startLine: number): number | undefined {
  for (let line = startLine; line < document.lineCount; line++) {
    const text = document.lineAt(line).text.trim();
    if (text.length > 0) {
      return line;
    }
  }

  return undefined;
}
