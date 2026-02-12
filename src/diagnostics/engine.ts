import * as vscode from "vscode";
import { getSettings, mapSeverityToDiagnostic } from "../config/settings";
import { parseIgnoreState, isRuleIgnored } from "./ignore";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { getSystemMetadata } from "../config/systemMetadata";
import { collectTemplateAvailableControlIdents } from "../utils/templateControls";
import { collectResolvableControlIdents } from "../utils/controlIdents";
import { maskXmlComments } from "../utils/xmlComments";
import { getAllFormIdentCandidates, isKnownFormIdent } from "../utils/formIdents";

export interface RuleDiagnostic {
  ruleId: string;
  message: string;
  range: vscode.Range;
}

export class DiagnosticsEngine {
  public buildDiagnostics(document: vscode.TextDocument, index: WorkspaceIndex): vscode.Diagnostic[] {
    if (!documentInConfiguredRoots(document)) {
      return [];
    }

    const facts = parseDocumentFacts(document);
    const issues: RuleDiagnostic[] = [];

    this.validateGeneralFormIdentReferences(facts, index, issues);
    this.validateDuplicateIdents(facts, index, issues);
    this.validateIdentConventions(facts, index, issues);

    if (facts.rootTag?.toLowerCase() === "workflow") {
      this.validateWorkflowReferences(facts, index, issues);
    }

    this.validateMappingFormIdentReferences(facts, index, issues);
    this.validateMappingReferences(facts, index, issues);
    this.validateRequiredActionIdentReferences(document, facts, index, issues);
    this.validateWorkflowControlIdentReferences(document, facts, index, issues);
    this.validateUsingReferences(facts, index, issues);
    this.validateHtmlTemplateControlReferences(document, facts, index, issues);
    this.validateSqlEqualsSpacing(document, issues);

    const settings = getSettings();
    const ignoreState = parseIgnoreState(document);

    const diagnostics: vscode.Diagnostic[] = [];
    for (const issue of issues) {
      const severitySetting = settings.ruleSeverities[issue.ruleId] ?? "warning";
      const severity = mapSeverityToDiagnostic(severitySetting);
      if (severity === undefined) {
        continue;
      }

      if (isRuleIgnored(ignoreState, issue.ruleId, issue.range.start.line)) {
        continue;
      }

      const diagnostic = new vscode.Diagnostic(issue.range, `[${issue.ruleId}] ${issue.message}`, severity);
      diagnostic.source = "sfp-xml-linter";
      diagnostic.code = issue.ruleId;
      diagnostics.push(diagnostic);
    }

    return diagnostics;
  }

  private validateDuplicateIdents(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    const seen = new Map<string, { control?: boolean; buttonByScope: Set<string>; section?: boolean }>();
    const occurrences = collectExpandedIdentOccurrences(facts, index);
    for (const occurrence of occurrences) {
      const key = occurrence.ident;
      const flags = seen.get(key) ?? { buttonByScope: new Set<string>() };
      const ruleId =
        occurrence.kind === "control"
          ? "duplicate-control-ident"
          : occurrence.kind === "button"
            ? "duplicate-button-ident"
            : "duplicate-section-ident";

      if (occurrence.kind === "button") {
        const scopeKey = occurrence.scopeKey ?? "__global_buttons__";
        if (flags.buttonByScope.has(scopeKey)) {
          issues.push({
            ruleId,
            range: occurrence.range,
            message: `Duplicate ${occurrence.kind} Ident '${occurrence.ident}'.`
          });
        } else {
          flags.buttonByScope.add(scopeKey);
        }
      } else if (flags[occurrence.kind]) {
        issues.push({
          ruleId,
          range: occurrence.range,
          message: `Duplicate ${occurrence.kind} Ident '${occurrence.ident}'.`
        });
      } else {
        flags[occurrence.kind] = true;
      }

      seen.set(key, flags);
    }
  }

  private validateGeneralFormIdentReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    const metadata = getSystemMetadata();
    const candidates = getAllFormIdentCandidates(index, metadata);
    for (const ref of facts.formIdentReferences) {
      if (isKnownFormIdent(ref.formIdent, index, metadata)) {
        continue;
      }

      issues.push({
        ruleId: "unknown-form-ident",
        range: ref.range,
        message: withDidYouMean(
          `Referenced FormIdent '${ref.formIdent}' was not found in indexed forms.`,
          ref.formIdent,
          candidates
        )
      });
    }
  }

  private validateWorkflowReferences(facts: ReturnType<typeof parseDocumentFacts>, index: WorkspaceIndex, issues: RuleDiagnostic[]): void {
    const formIdent = facts.workflowFormIdent;
    if (!formIdent) {
      return;
    }

    const form = index.formsByIdent.get(formIdent);
    if (!form) {
      return;
    }

    const availableControlShareCodes = collectWorkflowControlShareCodes(facts, index);
    const availableButtonShareCodes = collectWorkflowButtonShareCodes(facts, index);
    for (const ref of facts.workflowReferences) {
      if (ref.kind === "formControl") {
        if (!form.controls.has(ref.ident)) {
          issues.push({
            ruleId: "unknown-form-control-ident",
            range: ref.range,
            message: withDidYouMean(
              `FormControl Ident '${ref.ident}' was not found in Form '${form.ident}'.`,
              ref.ident,
              form.controls
            )
          });
        }
        continue;
      }

      if (ref.kind === "controlShareCode") {
        const key = ref.ident;
        if (!availableControlShareCodes.has(key)) {
          issues.push({
            ruleId: "unknown-form-control-ident",
            range: ref.range,
            message: withDidYouMean(
              `ControlShareCode Ident '${ref.ident}' was not found in WorkFlow ControlShareCodes.`,
              ref.ident,
              availableControlShareCodes
            )
          });
        }
        continue;
      }

      if (ref.kind === "button" && !form.buttons.has(ref.ident)) {
        issues.push({
          ruleId: "unknown-form-button-ident",
          range: ref.range,
          message: withDidYouMean(
            `Button Ident '${ref.ident}' was not found in Form '${form.ident}'.`,
            ref.ident,
            form.buttons
          )
        });
        continue;
      }

      if (ref.kind === "buttonShareCode") {
        const key = ref.ident;
        if (!availableButtonShareCodes.has(key)) {
          issues.push({
            ruleId: "unknown-workflow-button-share-code-ident",
            range: ref.range,
            message: withDidYouMean(
              `ButtonShareCode Ident '${ref.ident}' was not found in WorkFlow ButtonShareCodes.`,
              ref.ident,
              availableButtonShareCodes
            )
          });
        }
        continue;
      }

      if (ref.kind === "section" && !form.sections.has(ref.ident)) {
        issues.push({
          ruleId: "unknown-form-section-ident",
          range: ref.range,
          message: withDidYouMean(
            `Section Ident '${ref.ident}' was not found in Form '${form.ident}'.`,
            ref.ident,
            form.sections
          )
        });
      }
    }
  }

  private validateMappingReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow" ? facts.workflowFormIdent : facts.formIdent;
    if (!owningFormIdent) {
      return;
    }

    const form = index.formsByIdent.get(owningFormIdent);
    if (!form) {
      return;
    }

    for (const mapping of facts.mappingIdentReferences) {
      const identKey = mapping.ident;
      if (mapping.kind === "fromIdent" && form.controls.has(identKey)) {
        continue;
      }

      if (mapping.kind === "toIdent") {
        const targetFormIdent = mapping.mappingFormIdent;
        const targetForm = targetFormIdent ? index.formsByIdent.get(targetFormIdent) : undefined;
        if (targetForm && targetForm.controls.has(identKey)) {
          continue;
        }

        if (!targetForm && form.controls.has(identKey)) {
          continue;
        }
      }

      issues.push({
        ruleId: "unknown-mapping-ident",
        range: mapping.range,
        message:
          mapping.kind === "toIdent" && mapping.mappingFormIdent
            ? withDidYouMean(
                `Mapping toIdent '${mapping.ident}' was not found in Form '${mapping.mappingFormIdent}'.`,
                mapping.ident,
                index.formsByIdent.get(mapping.mappingFormIdent)?.controls ?? []
              )
            : withDidYouMean(
                `Mapping ${mapping.kind} '${mapping.ident}' was not found in controls of Form '${form.ident}'.`,
                mapping.ident,
                form.controls
              )
      });
    }
  }

  private validateMappingFormIdentReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    const metadata = getSystemMetadata();
    const candidates = getAllFormIdentCandidates(index, metadata);
    for (const ref of facts.mappingFormIdentReferences) {
      if (isKnownFormIdent(ref.formIdent, index, metadata)) {
        continue;
      }

      issues.push({
        ruleId: "unknown-mapping-form-ident",
        range: ref.range,
        message: withDidYouMean(
          `MappingFormIdent '${ref.formIdent}' was not found in indexed forms.`,
          ref.formIdent,
          candidates
        )
      });
    }
  }

  private validateUsingReferences(facts: ReturnType<typeof parseDocumentFacts>, index: WorkspaceIndex, issues: RuleDiagnostic[]): void {
    if (!index.componentsReady) {
      return;
    }

    for (const ref of facts.usingReferences) {
      const component = resolveComponentByKey(index, ref.componentKey);
      if (!component) {
        issues.push({
          ruleId: "unknown-using-component",
          range: ref.componentValueRange,
          message: withDidYouMean(
            `Using component '${ref.rawComponentValue}' was not found in indexed components.`,
            ref.componentKey,
            index.componentsByKey.keys()
          )
        });
        continue;
      }

      if (ref.sectionValue && !component.sections.has(ref.sectionValue) && component.sections.size > 0) {
        issues.push({
          ruleId: "unknown-using-section",
          range: ref.sectionValueRange ?? ref.componentValueRange,
          message: withDidYouMean(
            `Section '${ref.sectionValue}' was not found in component '${ref.rawComponentValue}'.`,
            ref.sectionValue,
            component.sections
          )
        });
      }
    }
  }

  private validateRequiredActionIdentReferences(
    document: vscode.TextDocument,
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    if (facts.requiredActionIdentReferences.length === 0) {
      return;
    }

    const available = collectResolvableControlIdents(document, facts, index);
    for (const ref of facts.requiredActionIdentReferences) {
      if (available.has(ref.ident)) {
        continue;
      }

      issues.push({
        ruleId: "unknown-required-action-ident",
        range: ref.range,
        message: withDidYouMean(
          `Required Action Ident '${ref.ident}' was not found in available controls.`,
          ref.ident,
          available
        )
      });
    }
  }

  private validateWorkflowControlIdentReferences(
    document: vscode.TextDocument,
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    if (facts.workflowControlIdentReferences.length === 0) {
      return;
    }

    if (facts.rootTag?.toLowerCase() !== "workflow") {
      return;
    }

    const available = collectResolvableControlIdents(document, facts, index);
    for (const ref of facts.workflowControlIdentReferences) {
      if (available.has(ref.ident)) {
        continue;
      }

      if (ref.kind === "actionValue") {
        issues.push({
          ruleId: "unknown-workflow-action-value-control-ident",
          range: ref.range,
          message: withDidYouMean(
            `ActionValue ControlIdent '${ref.ident}' was not found in available controls.`,
            ref.ident,
            available
          )
        });
        continue;
      }

      issues.push({
        ruleId: "unknown-workflow-show-hide-control-ident",
        range: ref.range,
        message: withDidYouMean(
          `ShowHide JavaScript ControlIdent '${ref.ident}' was not found in available controls.`,
          ref.ident,
          available
        )
      });
    }
  }

  private validateIdentConventions(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    if (facts.rootTag?.toLowerCase() === "workflow" && facts.rootIdent && facts.rootIdentRange) {
      if (!endsWithExact(facts.rootIdent, "WorkFlow")) {
        issues.push({
          ruleId: "ident-convention-workflow-postfix",
          range: facts.rootIdentRange,
          message: `WorkFlow Ident '${facts.rootIdent}' should end with 'WorkFlow'.`
        });
      }
    }

    const root = facts.rootTag?.toLowerCase();
    if ((root === "dataview" || root === "view") && facts.rootIdent && facts.rootIdentRange) {
      if (!endsWithExact(facts.rootIdent, "View")) {
        issues.push({
          ruleId: "ident-convention-view-postfix",
          range: facts.rootIdentRange,
          message: `View Ident '${facts.rootIdent}' should end with 'View'.`
        });
      }
    }

    for (const button of facts.declaredButtonInfos) {
      const type = (button.type ?? "").toLowerCase();
      if (type === "sharecodebutton") {
        continue;
      }

      if (type === "groupbutton") {
        if (!endsWithExact(button.ident, "GroupButton")) {
          issues.push({
            ruleId: "ident-convention-group-button-postfix",
            range: button.range,
            message: `GroupButton Ident '${button.ident}' should end with 'GroupButton'.`
          });
        }
        continue;
      }

      if (!endsWithExact(button.ident, "Button")) {
        issues.push({
          ruleId: "ident-convention-button-postfix",
          range: button.range,
          message: `Button Ident '${button.ident}' should end with 'Button'.`
        });
      }
    }

    const metadata = getSystemMetadata();
    const formCandidates = [...index.formsByIdent.values()].map((f) => f.ident);
    const targetCandidates = [
      ...formCandidates.map((name) => ({ name, kind: "form" as const })),
      ...[...metadata.systemTables].map((name) => ({ name, kind: "system" as const }))
    ];

    for (const control of facts.declaredControlInfos) {
      const type = (control.type ?? "").toLowerCase();
      const isLookupSingle = type === "dropdownlistcontrol" || type === "autocompletecontrol";
      const isLookupMulti = type === "listboxcontrol" || type === "duallistboxcontrol";
      if (!isLookupSingle && !isLookupMulti) {
        continue;
      }

      const parsed = parseLookupControlIdent(control.ident, targetCandidates);
      if (!parsed) {
        issues.push({
          ruleId: "ident-convention-lookup-control",
          range: control.range,
          message: `Lookup control Ident '${control.ident}' should follow [Purpose][FormOrTable][ForeignKey].`
        });
        continue;
      }

      if (isLookupMulti && !parsed.foreignKey.toLowerCase().endsWith("s")) {
        issues.push({
          ruleId: "ident-convention-lookup-control",
          range: control.range,
          message: `Multi-select lookup '${control.ident}' should use plural foreign key suffix ending with 's'.`
        });
      }

      const normalizedForeignKey = isLookupMulti
        ? trimTrailingPluralS(parsed.foreignKey)
        : parsed.foreignKey;

      if (parsed.targetKind === "system") {
        if (!metadata.systemTableAllowedForeignKeys.has(normalizedForeignKey)) {
          issues.push({
            ruleId: "ident-convention-lookup-control",
            range: control.range,
            message: `System table lookup '${control.ident}' should use foreign key 'ID' or 'Ident'.`
          });
        }
        continue;
      }

      const targetForm = index.formsByIdent.get(parsed.targetName);
      if (!targetForm) {
        continue;
      }

      const fk = normalizedForeignKey;
      const isKnownControl = targetForm.controls.has(fk);
      const isDefaultColumn = metadata.defaultFormColumns.has(fk);
      const isPreferredSuffix = metadata.preferredForeignKeySuffixes.some((suffix) => endsWithExact(fk, suffix));
      if (!isKnownControl && !isDefaultColumn && !isPreferredSuffix) {
        issues.push({
          ruleId: "ident-convention-lookup-control",
          range: control.range,
          message: `Lookup control '${control.ident}' references '${parsed.targetName}', but foreign key '${parsed.foreignKey}' is not a known control/default column.`
        });
      }
    }
  }

  private validateHtmlTemplateControlReferences(
    document: vscode.TextDocument,
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    if (facts.htmlControlReferences.length === 0) {
      return;
    }

    const root = facts.rootTag?.toLowerCase();
    if (root !== "form") {
      return;
    }

    const available = collectTemplateAvailableControlIdents(document, facts, index);
    for (const ref of facts.htmlControlReferences) {
      if (available.has(ref.ident)) {
        continue;
      }

      issues.push({
        ruleId: "unknown-html-template-control-ident",
        range: ref.range,
        message: withDidYouMean(
          `${ref.tagName} ${ref.attributeName} '${ref.ident}' was not found in Form Controls (including Using/Include injected controls).`,
          ref.ident,
          available
        )
      });
    }
  }

  private validateSqlEqualsSpacing(document: vscode.TextDocument, issues: RuleDiagnostic[]): void {
    const text = maskXmlComments(document.getText());
    const blockRegex = /<(SQL|Command)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    for (const blockMatch of text.matchAll(blockRegex)) {
      const whole = blockMatch[0] ?? "";
      const content = blockMatch[2] ?? "";
      const wholeStart = blockMatch.index ?? 0;
      const contentOffset = whole.indexOf(content);
      if (contentOffset < 0) {
        continue;
      }

      const contentStart = wholeStart + contentOffset;
      for (const relativeIndex of collectInvalidEqualsIndices(content)) {
        const absoluteIndex = contentStart + relativeIndex;
        issues.push({
          ruleId: "sql-convention-equals-spacing",
          range: new vscode.Range(document.positionAt(absoluteIndex), document.positionAt(absoluteIndex + 1)),
          message: "In SQL/Command blocks, '=' must be separated by at least one space on both sides."
        });
      }
    }
  }
}

function collectWorkflowControlShareCodes(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): Set<string> {
  const out = new Set<string>(facts.declaredControlShareCodes);
  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const key of component.workflowControlShareCodeDefinitions.keys()) {
      out.add(key);
    }
  }

  return out;
}

function collectWorkflowButtonShareCodes(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): Set<string> {
  const out = new Set<string>(facts.declaredButtonShareCodes);
  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const key of component.workflowButtonShareCodeDefinitions.keys()) {
      out.add(key);
    }
  }

  return out;
}

function collectExpandedIdentOccurrences(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): ReturnType<typeof parseDocumentFacts>["identOccurrences"] {
  const out = [...facts.identOccurrences];
  if (facts.rootTag?.toLowerCase() !== "workflow") {
    return out;
  }

  const buttonShareCodeButtons = collectWorkflowButtonShareCodeButtonIdents(facts, index);
  for (const ref of facts.workflowReferences) {
    if (ref.kind !== "buttonShareCode") {
      continue;
    }

    const shareCodeKey = ref.ident;
    const expandedButtons = buttonShareCodeButtons.get(shareCodeKey);
    if (!expandedButtons || expandedButtons.size === 0) {
      continue;
    }

    for (const buttonIdent of expandedButtons) {
      out.push({
        ident: buttonIdent,
        kind: "button",
        range: ref.range,
        scopeKey: ref.scopeKey ?? "__global_buttons__"
      });
    }
  }

  return out;
}

function collectWorkflowButtonShareCodeButtonIdents(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();

  for (const [shareCode, buttonIds] of facts.buttonShareCodeButtonIdents.entries()) {
    const target = out.get(shareCode) ?? new Set<string>();
    for (const buttonId of buttonIds) {
      target.add(buttonId);
    }
    out.set(shareCode, target);
  }

  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const [shareCode, buttonIds] of component.workflowButtonShareCodeButtonIdents.entries()) {
      const target = out.get(shareCode) ?? new Set<string>();
      for (const buttonId of buttonIds) {
        target.add(buttonId);
      }
      out.set(shareCode, target);
    }
  }

  return out;
}

function endsWithExact(value: string, suffix: string): boolean {
  return value.endsWith(suffix);
}

function parseLookupControlIdent(
  ident: string,
  candidates: Array<{ name: string; kind: "form" | "system" }>
): { targetName: string; targetKind: "form" | "system"; foreignKey: string } | undefined {
  let best: { targetName: string; targetKind: "form" | "system"; foreignKey: string; score: number } | undefined;

  for (const candidate of candidates) {
    const idx = ident.lastIndexOf(candidate.name);
    if (idx < 0) {
      continue;
    }

    const foreignKey = ident.slice(idx + candidate.name.length);
    if (!foreignKey) {
      continue;
    }

    const score = candidate.name.length;
    if (!best || score > best.score) {
      best = {
        targetName: candidate.name,
        targetKind: candidate.kind,
        foreignKey,
        score
      };
    }
  }

  if (!best) {
    return undefined;
  }

  return {
    targetName: best.targetName,
    targetKind: best.targetKind,
    foreignKey: best.foreignKey
  };
}

function trimTrailingPluralS(value: string): string {
  if (!value.toLowerCase().endsWith("s")) {
    return value;
  }

  return value.slice(0, -1);
}

function withDidYouMean(message: string, typed: string | undefined, candidates: Iterable<string>): string {
  if (!typed) {
    return message;
  }

  const hint = findDidYouMean(typed, candidates);
  if (!hint) {
    return message;
  }

  return `${message} Did you mean '${hint}'?`;
}

function findDidYouMean(typed: string, candidates: Iterable<string>): string | undefined {
  const target = typed.trim();
  if (!target) {
    return undefined;
  }

  const targetLower = target.toLowerCase();
  let caseOnly: string | undefined;
  const all: string[] = [];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    all.push(candidate);
    if (!caseOnly && candidate !== target && candidate.toLowerCase() === targetLower) {
      caseOnly = candidate;
    }
  }

  if (caseOnly) {
    return caseOnly;
  }

  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of all) {
    if (candidate === target) {
      continue;
    }

    const distance = levenshteinDistance(targetLower, candidate.toLowerCase());
    if (!best || distance < best.distance || (distance === best.distance && candidate.length < best.candidate.length)) {
      best = { candidate, distance };
    }
  }

  if (!best) {
    return undefined;
  }

  const threshold = target.length <= 6 ? 2 : 3;
  return best.distance <= threshold ? best.candidate : undefined;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }

    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function collectInvalidEqualsIndices(sql: string): number[] {
  const out: number[] = [];
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingleQuote) {
      if (ch === "-" && next === "-") {
        inLineComment = true;
        i++;
        continue;
      }

      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    if (ch === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        i++;
        continue;
      }

      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (inSingleQuote) {
      continue;
    }

    if (ch !== "=") {
      continue;
    }

    const prev = i > 0 ? sql[i - 1] : "";
    if (prev === "<" || prev === ">" || prev === "!" || prev === "=" || next === "=") {
      continue;
    }

    if (!isWhitespace(prev) || !isWhitespace(next)) {
      out.push(i);
    }
  }

  return out;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}
