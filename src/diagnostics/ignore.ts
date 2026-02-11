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
    const xmlMatch = /<!--\s*@Ignore(File)?\s+([^>]+?)\s*-->/i.exec(content);
    if (xmlMatch) {
      const isFile = Boolean(xmlMatch[1]);
      const rules = parseRuleList(xmlMatch[2]);

      if (isFile) {
        for (const rule of rules) {
          ignoredRulesForFile.add(rule);
        }
      } else {
        const targetLine = findNextMeaningfulLine(document, line + 1);
        if (targetLine !== undefined) {
          addIgnoredRulesForLine(ignoredRulesByLine, targetLine, rules);
        }
      }
    }

    // SQL/Command inline ignore support:
    // SELECT ... -- @Ignore sql-convention-equals-spacing
    const sqlLineMatch = /--\s*@Ignore\s+(.+)$/i.exec(content);
    if (sqlLineMatch) {
      const rules = parseRuleList(sqlLineMatch[1]);
      addIgnoredRulesForLine(ignoredRulesByLine, line, rules);
    }

    // SQL/Command inline block ignore support:
    // SELECT ... /* @Ignore sql-convention-equals-spacing */
    const sqlBlockMatch = /\/\*\s*@Ignore\s+(.+?)\s*\*\//i.exec(content);
    if (sqlBlockMatch) {
      const rules = parseRuleList(sqlBlockMatch[1]);
      addIgnoredRulesForLine(ignoredRulesByLine, line, rules);
    }
  }

  return {
    ignoredRulesForFile,
    ignoredRulesByLine
  };
}

function addIgnoredRulesForLine(target: Map<number, Set<string>>, line: number, rules: readonly string[]): void {
  const entry = target.get(line) ?? new Set<string>();
  for (const rule of rules) {
    entry.add(rule);
  }
  target.set(line, entry);
}

function parseRuleList(rawRules: string): string[] {
  return rawRules
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.toLowerCase());
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
