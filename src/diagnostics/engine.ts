import * as vscode from "vscode";
import { getSettings, mapSeverityToDiagnostic, resolveRuleSeverity, SfpXmlLinterSettings } from "../config/settings";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseIgnoreState, isRuleIgnored } from "./ignore";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots, normalizeComponentKey } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { getSystemMetadata, isKnownSystemTableForeignKey, SystemMetadata } from "../config/systemMetadata";
import { collectResolvableControlIdents } from "../utils/controlIdents";
import { maskXmlComments } from "../utils/xmlComments";
import { getAllFormIdentCandidates, isKnownFormIdent, resolveSystemTableName } from "../utils/formIdents";
import { FeatureCapabilityReport } from "../composition/model";
import { matchesExpectedXPathInEffectiveModel } from "../composition/effectiveModel";
import { FeatureManifestRegistry } from "../composition/workspace";
import { contributionMatchesDocumentRoot, populateUsingInsertTraceFromText } from "../composition/usingImpact";
import {
  buildDocumentCompositionModel,
  collectSelectedDocumentContributions,
  DocumentCompositionModel,
  findLocalUsingModelForReference
} from "../composition/documentModel";
import { collectEffectiveUsingRefs } from "../utils/effectiveUsings";

export interface RuleDiagnostic {
  ruleId: string;
  message: string;
  range: vscode.Range;
}

export interface BuildDiagnosticsOptions {
  standaloneMode?: boolean;
  parsedFacts?: ReturnType<typeof parseDocumentFacts>;
  maskedText?: string;
  fastBackgroundMode?: boolean;
  settingsOverride?: SfpXmlLinterSettings;
  metadataOverride?: SystemMetadata;
  skipConfiguredRootsCheck?: boolean;
  featureRegistry?: FeatureManifestRegistry;
}

export class DiagnosticsEngine {
  public buildDiagnostics(document: vscode.TextDocument, index: WorkspaceIndex, options?: BuildDiagnosticsOptions): vscode.Diagnostic[] {
    const standaloneMode = options?.standaloneMode === true;
    const fastBackgroundMode = options?.fastBackgroundMode === true;
    const skipConfiguredRootsCheck = options?.skipConfiguredRootsCheck === true;
    if (!standaloneMode && !skipConfiguredRootsCheck && !documentInConfiguredRoots(document)) {
      return [];
    }

    const maskedText = options?.maskedText ?? maskXmlComments(document.getText());
    const facts =
      options?.parsedFacts ??
      (standaloneMode
        ? parseDocumentFacts(document)
        : index.parsedFactsByUri.get(document.uri.toString()));
    if (!facts) {
      return [];
    }
    const metadata = options?.metadataOverride ?? getSystemMetadata();
    const settings = options?.settingsOverride ?? getSettings();
    const featureRegistry = options?.featureRegistry;
    if (!standaloneMode && facts.usingContributionInsertTraces.size === 0 && index.componentsReady) {
      populateUsingInsertTraceFromText(facts, document.getText(), index);
    }
    const documentComposition = buildDocumentCompositionModel(facts, index);
    const formIdentCandidates = getAllFormIdentCandidates(index, metadata);
    const issues: RuleDiagnostic[] = [];
    let cachedResolvableControlIdents: Set<string> | undefined;
    const getResolvableControlIdents = (): Set<string> => {
      if (!cachedResolvableControlIdents) {
        cachedResolvableControlIdents = collectResolvableControlIdents(document, facts, index, {
          metadata,
          maskedText,
          compositionModel: documentComposition
        });
      }
      return cachedResolvableControlIdents;
    };

    this.validateGeneralFormIdentReferences(facts, index, issues, metadata, formIdentCandidates, settings);
    this.validateDuplicateIdents(facts, index, issues, documentComposition);
    this.validateIdentConventions(facts, index, issues, metadata);

    if (facts.rootTag?.toLowerCase() === "workflow") {
      this.validateWorkflowReferences(facts, index, issues, metadata, documentComposition);
    }

    this.validateMappingFormIdentReferences(facts, index, issues, metadata, formIdentCandidates, settings);
    this.validateMappingReferences(facts, index, issues, metadata, getResolvableControlIdents, settings);
    this.validateRequiredActionIdentReferences(facts, issues, getResolvableControlIdents);
    this.validateWorkflowControlIdentReferences(facts, issues, getResolvableControlIdents);
    this.validateUsingReferences(facts, index, issues, documentComposition);
    this.validatePrimitiveReferences(document, issues);
    this.validateHtmlTemplateControlReferences(facts, issues, getResolvableControlIdents);
    this.validateFeatureCompositionReferences(document, facts, issues, featureRegistry);
    if (!fastBackgroundMode) {
      this.validateCommonAttributeTypos(document, issues, maskedText);
      this.validateSqlEqualsSpacing(document, issues, maskedText);
    }

    const ignoreState = fastBackgroundMode ? undefined : parseIgnoreState(document);

    const diagnostics: vscode.Diagnostic[] = [];
    for (const issue of issues) {
      const severitySetting = resolveRuleSeverity(settings, issue.ruleId);
      const severity = mapSeverityToDiagnostic(severitySetting);
      if (severity === undefined) {
        continue;
      }

      if (ignoreState && isRuleIgnored(ignoreState, issue.ruleId, issue.range.start.line)) {
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
    issues: RuleDiagnostic[],
    documentComposition: DocumentCompositionModel
  ): void {
    const seen = new Map<string, { controlByScope: Set<string>; buttonByScope: Set<string>; sectionByScope: Set<string> }>();
    const occurrences = collectExpandedIdentOccurrences(facts, index, documentComposition);
    for (const occurrence of occurrences) {
      const key = occurrence.ident;
      const flags = seen.get(key) ?? { controlByScope: new Set<string>(), buttonByScope: new Set<string>(), sectionByScope: new Set<string>() };
      const ruleId =
        occurrence.kind === "control"
          ? "duplicate-control-ident"
          : occurrence.kind === "button"
            ? "duplicate-button-ident"
            : "duplicate-section-ident";

      if (occurrence.kind === "control") {
        const scopeKey = occurrence.scopeKey ?? "__global_controls__";
        if (flags.controlByScope.has(scopeKey)) {
          issues.push({
            ruleId,
            range: occurrence.range,
            message: `Duplicate ${occurrence.kind} Ident '${occurrence.ident}'.`
          });
        } else {
          flags.controlByScope.add(scopeKey);
        }
      } else if (occurrence.kind === "button") {
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
      } else if (occurrence.kind === "section") {
        const scopeKey = occurrence.scopeKey ?? "__global_sections__";
        if (flags.sectionByScope.has(scopeKey)) {
          issues.push({
            ruleId,
            range: occurrence.range,
            message: `Duplicate ${occurrence.kind} Ident '${occurrence.ident}'.`
          });
        } else {
          flags.sectionByScope.add(scopeKey);
        }
      }

      seen.set(key, flags);
    }
  }

  private validateGeneralFormIdentReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[],
    metadata: SystemMetadata,
    candidates: readonly string[],
    settings: SfpXmlLinterSettings
  ): void {
    for (const ref of facts.formIdentReferences) {
      if (isKnownFormIdent(ref.formIdent, index, metadata)) {
        continue;
      }

      if (settings.incompleteMode) {
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

  private validateWorkflowReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[],
    metadata: SystemMetadata,
    documentComposition: DocumentCompositionModel
  ): void {
    const formIdent = facts.workflowFormIdent;
    if (!formIdent) {
      return;
    }

    const form = index.formsByIdent.get(formIdent);
    if (!form) {
      return;
    }

    const availableControlShareCodes = collectWorkflowControlShareCodes(facts, index, documentComposition);
    const availableButtonShareCodes = collectWorkflowButtonShareCodes(facts, index, documentComposition);
    const availableControls = collectWorkflowAvailableControls(facts, index, form, metadata, documentComposition);
    const availableButtons = collectWorkflowAvailableButtons(facts, index, form, documentComposition);
    for (const ref of facts.workflowReferences) {
      if (ref.kind === "formControl") {
        if (!availableControls.has(ref.ident)) {
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

      if (ref.kind === "button" && !availableButtons.has(ref.ident)) {
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
    issues: RuleDiagnostic[],
    metadata: SystemMetadata,
    getResolvableControlIdents: () => Set<string>,
    settings: SfpXmlLinterSettings
  ): void {
    const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow" ? facts.workflowFormIdent : facts.formIdent;
    if (!owningFormIdent) {
      return;
    }

    const form = index.formsByIdent.get(owningFormIdent);
    if (!form) {
      return;
    }

    const localAvailableControlIdents = getResolvableControlIdents();

    for (const mapping of facts.mappingIdentReferences) {
      const identKey = mapping.ident;
      // FromIdent validation is intentionally disabled for now.
      // It depends on source/query semantics (often SQL-driven), which are not
      // fully resolvable by the current static parser.
      if (mapping.kind === "fromIdent") {
        continue;
      }

      if (mapping.kind === "toIdent") {
        const targetFormIdent = mapping.mappingFormIdent;
        const targetForm = targetFormIdent ? index.formsByIdent.get(targetFormIdent) : undefined;
        if (targetForm) {
          const targetSameAsOwning = targetFormIdent === owningFormIdent;
          if (targetSameAsOwning) {
            if (localAvailableControlIdents.has(identKey)) {
              continue;
            }
          } else if (targetForm.controls.has(identKey) || metadata.defaultFormColumns.has(identKey)) {
            continue;
          }
        }

        // If MappingFormIdent points to known system/external table, validate against
        // table columns (including default form columns).
        if (targetFormIdent) {
          const systemTable = resolveSystemTableName(targetFormIdent, metadata);
          if (systemTable) {
            if (isKnownSystemTableForeignKey(metadata, systemTable, identKey) || metadata.defaultFormColumns.has(identKey)) {
              continue;
            }
          }
        }

        if (settings.incompleteMode && targetFormIdent && !targetForm) {
          continue;
        }

        if (!targetForm && localAvailableControlIdents.has(identKey)) {
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
                localAvailableControlIdents
              )
      });
    }
  }

  private validateMappingFormIdentReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[],
    metadata: SystemMetadata,
    candidates: readonly string[],
    settings: SfpXmlLinterSettings
  ): void {
    for (const ref of facts.mappingFormIdentReferences) {
      if (isKnownFormIdent(ref.formIdent, index, metadata)) {
        continue;
      }

      if (settings.incompleteMode) {
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

  private validateUsingReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[],
    documentComposition: ReturnType<typeof buildDocumentCompositionModel>
  ): void {
    if (!index.componentsReady) {
      return;
    }

    const tracesReady = facts.usingContributionInsertTraces.size > 0;
    const suppressedFull = new Set<string>();
    const suppressedSections = new Map<string, Set<string>>();
    for (const ref of facts.usingReferences) {
      if (!ref.suppressInheritance) {
        continue;
      }
      if (ref.sectionValue) {
        const current = suppressedSections.get(ref.componentKey) ?? new Set<string>();
        current.add(ref.sectionValue);
        suppressedSections.set(ref.componentKey, current);
      } else {
        suppressedFull.add(ref.componentKey);
      }
    }

    for (const ref of facts.usingReferences) {
      if (ref.suppressInheritance) {
        continue;
      }

      const component = resolveComponentByKey(index, ref.componentKey);
      if (!component) {
        issues.push({
          ruleId: "unknown-using-feature",
          range: ref.componentValueRange,
          message: withDidYouMean(
            `Using feature '${ref.rawComponentValue}' was not found in indexed features.`,
            ref.componentKey,
            index.componentsByKey.keys()
          )
        });
        continue;
      }

      if (ref.sectionValue && !component.contributions.has(ref.sectionValue) && component.contributions.size > 0) {
        issues.push({
          ruleId: "unknown-using-contribution",
          range: ref.sectionValueRange ?? ref.componentValueRange,
          message: withDidYouMean(
            `Contribution '${ref.sectionValue}' was not found in feature '${ref.rawComponentValue}'.`,
            ref.sectionValue,
            component.contributions
          )
        });
        continue;
      }

      if (ref.sectionValue) {
        const contribution = component.contributionSummaries.get(ref.sectionValue);
        if (contribution && !contributionMatchesDocumentRoot(facts.rootTag, contribution)) {
          issues.push({
            ruleId: "contribution-mismatch",
            range: ref.sectionValueRange ?? ref.componentValueRange,
            message: `Contribution '${ref.sectionValue}' in feature '${ref.rawComponentValue}' does not match current root '${facts.rootTag ?? "unknown"}'.`
          });
          continue;
        }
      }

      const suppressionConflict =
        suppressedFull.has(ref.componentKey) ||
        (ref.sectionValue ? suppressedSections.get(ref.componentKey)?.has(ref.sectionValue) === true : false);
      if (suppressionConflict) {
        continue;
      }

      if (!tracesReady) {
        continue;
      }

      const impact = findLocalUsingModelForReference(documentComposition, ref)?.impact;
      if (!impact) {
        continue;
      }
      if (impact.kind === "unused") {
        issues.push({
          ruleId: "unused-using",
          range: ref.sectionValueRange ?? ref.componentValueRange,
          message: impact.message ?? `Using '${ref.rawComponentValue}' has no effective impact.`
        });
        continue;
      }

      if (impact.kind === "partial") {
        issues.push({
          ruleId: "partial-using",
          range: ref.sectionValueRange ?? ref.componentValueRange,
          message: impact.message ?? `Using '${ref.rawComponentValue}' is only partially effective.`
        });
      }
    }

    this.validateUsingSuppressionConflicts(facts, index, issues);
    this.validateFormOwnedUsingInheritance(facts, index, issues);
    this.validateMissingUsingParams(facts, index, issues, documentComposition);
  }

  private validateMissingUsingParams(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[],
    documentComposition: DocumentCompositionModel
  ): void {
    const implicitParams = new Set<string>(["formident"]);
    const localUsingRangeByKey = new Map<string, vscode.Range>();
    for (const ref of facts.usingReferences) {
      if (ref.suppressInheritance) {
        continue;
      }

      const key = getUsingKey(ref.componentKey, ref.sectionValue);
      if (!localUsingRangeByKey.has(key)) {
        localUsingRangeByKey.set(key, ref.sectionValueRange ?? ref.componentValueRange);
      }
    }

    for (const usingRef of collectEffectiveUsingRefs(facts, index)) {
      const component = resolveComponentByKey(index, usingRef.componentKey);
      if (!component) {
        continue;
      }

      const usingModel = documentComposition.usings.find(
        (item) =>
          item.componentKey === usingRef.componentKey &&
          item.source === usingRef.source &&
          (item.sectionValue ?? "") === (usingRef.sectionValue ?? "")
      );
      if (!usingModel || !usingModel.hasResolvedFeature) {
        continue;
      }

      const providedParamNames = new Set<string>(
        (usingRef.providedParamNames ?? []).map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0)
      );
      const missingForUsing = new Set<string>();
      for (const contributionModel of usingModel.contributions) {
        if (contributionModel.insertCount <= 0) {
          continue;
        }

        for (const requiredParamName of contributionModel.contribution.requiredParamNames) {
          const normalized = requiredParamName.trim().toLowerCase();
          if (!normalized || implicitParams.has(normalized) || providedParamNames.has(normalized)) {
            continue;
          }

          missingForUsing.add(requiredParamName);
        }
      }

      if (missingForUsing.size === 0) {
        continue;
      }

      const range =
        usingRef.source === "local"
          ? localUsingRangeByKey.get(getUsingKey(usingRef.componentKey, usingRef.sectionValue))
          : facts.workflowFormIdentRange ?? facts.rootFormIdentRange ?? facts.rootIdentRange;
      if (!range) {
        continue;
      }

      const missingList = [...missingForUsing].sort((a, b) => a.localeCompare(b));
      const sourceLabel =
        usingRef.source === "inherited" && usingRef.inheritedFromFormIdent
          ? `inherited from Form '${usingRef.inheritedFromFormIdent}'`
          : "active";
      issues.push({
        ruleId: "missing-using-param",
        range,
        message: `Using '${usingRef.rawComponentValue}${usingRef.sectionValue ? `#${usingRef.sectionValue}` : ""}' is ${sourceLabel} but missing required parameter(s): ${missingList.join(", ")}.`
      });
    }
  }

  private validateUsingSuppressionConflicts(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "workflow" && root !== "dataview") {
      return;
    }

    const localFullByFeature = new Map<string, vscode.Range[]>();
    const localSectionsByFeature = new Map<string, Map<string, vscode.Range[]>>();
    const suppressFullByFeature = new Map<string, vscode.Range[]>();
    const suppressSectionsByFeature = new Map<string, Map<string, vscode.Range[]>>();

    for (const ref of facts.usingReferences) {
      const targetRange = ref.sectionValueRange ?? ref.componentValueRange;
      if (ref.suppressInheritance) {
        if (ref.sectionValue) {
          addNestedRangeMapValue(suppressSectionsByFeature, ref.componentKey, ref.sectionValue, targetRange);
        } else {
          addRangeMapValue(suppressFullByFeature, ref.componentKey, targetRange);
        }
        continue;
      }

      if (ref.sectionValue) {
        addNestedRangeMapValue(localSectionsByFeature, ref.componentKey, ref.sectionValue, targetRange);
      } else {
        addRangeMapValue(localFullByFeature, ref.componentKey, targetRange);
      }
    }

    const owningFormIdent = getOwningFormIdentForInheritance(root, facts);
    const form = owningFormIdent ? index.formsByIdent.get(owningFormIdent) : undefined;
    const formFacts = form ? index.parsedFactsByUri.get(form.uri.toString()) : undefined;
    const formFeatureRefs = formFacts ? collectUsingRefsByFeature(formFacts) : new Map<string, { hasFull: boolean; sections: Set<string> }>();

    for (const [featureKey, ranges] of suppressFullByFeature.entries()) {
      if (formFeatureRefs.has(featureKey)) {
        continue;
      }
      for (const range of ranges) {
        issues.push({
          ruleId: "suppression-noop",
          range,
          message: `Suppression for feature '${featureKey}' has no effect because the feature is not inherited from Form.`
        });
      }
    }

    for (const [featureKey, sections] of suppressSectionsByFeature.entries()) {
      const formFeature = formFeatureRefs.get(featureKey);
      for (const [sectionName, ranges] of sections.entries()) {
        const effective =
          !!formFeature &&
          !formFeature.hasFull &&
          formFeature.sections.has(sectionName);
        if (effective) {
          continue;
        }

        const reason = !formFeature
          ? `feature '${featureKey}' is not inherited from Form`
          : formFeature.hasFull
            ? `Form inherits feature '${featureKey}' as full feature (section-level suppression cannot target full inheritance)`
            : `contribution '${sectionName}' is not inherited from Form feature '${featureKey}'`;
        for (const range of ranges) {
          issues.push({
            ruleId: "suppression-noop",
            range,
            message: `Suppression for '${featureKey}#${sectionName}' has no effect because ${reason}.`
          });
        }
      }
    }

    for (const [featureKey, localRanges] of localFullByFeature.entries()) {
      if (!suppressFullByFeature.has(featureKey)) {
        continue;
      }

      for (const range of localRanges) {
        issues.push({
          ruleId: "suppression-conflict",
          range,
          message: `Using feature '${featureKey}' conflicts with suppression of the same inherited feature.`
        });
      }
    }

    for (const [featureKey, localSections] of localSectionsByFeature.entries()) {
      if (suppressFullByFeature.has(featureKey)) {
        for (const ranges of localSections.values()) {
          for (const range of ranges) {
            issues.push({
              ruleId: "suppression-conflict",
              range,
              message: `Using contribution of feature '${featureKey}' conflicts with full suppression of the same inherited feature.`
            });
          }
        }
      }

      const suppressedSections = suppressSectionsByFeature.get(featureKey);
      if (!suppressedSections) {
        continue;
      }

      for (const [sectionName, ranges] of localSections.entries()) {
        if (!suppressedSections.has(sectionName)) {
          continue;
        }
        for (const range of ranges) {
          issues.push({
            ruleId: "suppression-conflict",
            range,
            message: `Using '${featureKey}#${sectionName}' conflicts with suppression of the same inherited contribution.`
          });
        }
      }
    }
  }

  private validateFormOwnedUsingInheritance(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    const root = (facts.rootTag ?? "").toLowerCase();
    const inheritanceRulePrefix = getInheritanceRulePrefix(root);
    if (!inheritanceRulePrefix) {
      return;
    }

    const owningFormIdent = getOwningFormIdentForInheritance(root, facts);
    if (!owningFormIdent) {
      return;
    }

    const form = index.formsByIdent.get(owningFormIdent);
    if (!form) {
      return;
    }

    const formFacts = index.parsedFactsByUri.get(form.uri.toString());
    if (!formFacts) {
      return;
    }

    const formFeatureRefs = collectUsingRefsByFeature(formFacts);
    if (formFeatureRefs.size === 0) {
      return;
    }

    const suppressedFull = new Set<string>();
    const suppressedSections = new Map<string, Set<string>>();
    for (const ref of facts.usingReferences) {
      if (!ref.suppressInheritance) {
        continue;
      }

      if (ref.sectionValue) {
        const current = suppressedSections.get(ref.componentKey) ?? new Set<string>();
        current.add(ref.sectionValue);
        suppressedSections.set(ref.componentKey, current);
      } else {
        suppressedFull.add(ref.componentKey);
      }
    }

    for (const ref of facts.usingReferences) {
      if (ref.suppressInheritance) {
        continue;
      }

      if (suppressedFull.has(ref.componentKey)) {
        continue;
      }
      if (ref.sectionValue && suppressedSections.get(ref.componentKey)?.has(ref.sectionValue)) {
        continue;
      }

      const formFeature = formFeatureRefs.get(ref.componentKey);
      if (!formFeature) {
        continue;
      }

      if (ref.sectionValue) {
        if (!formFeature.hasFull && formFeature.sections.has(ref.sectionValue)) {
          issues.push({
            ruleId: `${inheritanceRulePrefix}-redundant-feature-using`,
            range: ref.sectionValueRange ?? ref.componentValueRange,
            message: `Using '${ref.rawComponentValue}#${ref.sectionValue}' is redundant because Form '${owningFormIdent}' already activates this contribution.`
          });
          continue;
        }

        issues.push({
          ruleId: "feature-inheritance-override",
          range: ref.sectionValueRange ?? ref.componentValueRange,
          message: `Using '${ref.rawComponentValue}#${ref.sectionValue}' overrides inherited feature activation from Form '${owningFormIdent}'.`
        });
        continue;
      }

      issues.push({
        ruleId: `${inheritanceRulePrefix}-redundant-feature-using`,
        range: ref.sectionValueRange ?? ref.componentValueRange,
        message: `Using '${ref.rawComponentValue}' is redundant because Form '${owningFormIdent}' already activates this feature.`
      });
    }
  }

  private validateRequiredActionIdentReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    issues: RuleDiagnostic[],
    getResolvableControlIdents: () => Set<string>
  ): void {
    if (facts.requiredActionIdentReferences.length === 0) {
      return;
    }

    const available = getResolvableControlIdents();
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
    facts: ReturnType<typeof parseDocumentFacts>,
    issues: RuleDiagnostic[],
    getResolvableControlIdents: () => Set<string>
  ): void {
    if (facts.workflowControlIdentReferences.length === 0) {
      return;
    }

    if (facts.rootTag?.toLowerCase() !== "workflow") {
      return;
    }

    const available = getResolvableControlIdents();
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
    issues: RuleDiagnostic[],
    metadata: SystemMetadata
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

      const splitInfo = describeLookupIdentSplit(control.ident, targetCandidates);
      const parsed = parseLookupControlIdent(control.ident, targetCandidates);
      if (!parsed) {
        issues.push({
          ruleId: "ident-convention-lookup-control",
          range: control.range,
          message: `Lookup control Ident '${control.ident}' should follow [Purpose][FormOrTable][ForeignKey]. ${splitInfo}`
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
        if (!isKnownSystemTableForeignKey(metadata, parsed.targetName, normalizedForeignKey)) {
          issues.push({
            ruleId: "ident-convention-lookup-control",
            range: control.range,
            message: `System table lookup '${control.ident}' should use known system-table column (default 'ID'/'Ident' or configured external columns). ${splitInfo}`
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
          message: `Lookup control '${control.ident}' references '${parsed.targetName}', but foreign key '${parsed.foreignKey}' is not a known control/default column. ${splitInfo}`
        });
      }
    }
  }

  private validateHtmlTemplateControlReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    issues: RuleDiagnostic[],
    getResolvableControlIdents: () => Set<string>
  ): void {
    if (facts.htmlControlReferences.length === 0) {
      return;
    }

    const root = facts.rootTag?.toLowerCase();
    if (root !== "form") {
      return;
    }

    const available = getResolvableControlIdents();
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

  private validateSqlEqualsSpacing(document: vscode.TextDocument, issues: RuleDiagnostic[], maskedText: string): void {
    const text = maskedText;
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

  private validateCommonAttributeTypos(document: vscode.TextDocument, issues: RuleDiagnostic[], maskedText: string): void {
    const text = maskedText;
    const tagRegex = /<((?:[A-Za-z_][\w.-]*:)?(?:Control|Parameter))\b([^>]*)>/gi;

    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(text)) !== null) {
      const fullTag = tagMatch[0] ?? "";
      const attrsRaw = tagMatch[2] ?? "";
      const tagStart = tagMatch.index ?? 0;
      const attrsOffsetInTag = fullTag.indexOf(attrsRaw);
      const attrsStart = tagStart + (attrsOffsetInTag >= 0 ? attrsOffsetInTag : 0);

      const typoRegex = /\bMaxLenght\b(?=\s*=)/gi;
      let typoMatch: RegExpExecArray | null;
      while ((typoMatch = typoRegex.exec(attrsRaw)) !== null) {
        const start = attrsStart + typoMatch.index;
        const end = start + typoMatch[0].length;
        issues.push({
          ruleId: "typo-maxlenght-attribute",
          range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
          message: `Attribute 'MaxLenght' is a typo. Did you mean 'MaxLength'?`
        });
      }
    }
  }

  private validateFeatureCompositionReferences(
    document: vscode.TextDocument,
    facts: ReturnType<typeof parseDocumentFacts>,
    issues: RuleDiagnostic[],
    featureRegistry: FeatureManifestRegistry | undefined
  ): void {
    if (!featureRegistry) {
      return;
    }

    const root = (facts.rootTag ?? "").toLowerCase();
    const relPath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    const isFeatureFile = relPath.toLowerCase().endsWith(".feature.xml");
    if (root !== "feature" && !isFeatureFile) {
      return;
    }

    const feature = findFeatureForRelativePath(featureRegistry, relPath);
    if (!feature) {
      return;
    }

    const capabilityReport = featureRegistry.capabilityReportsByFeature.get(feature.feature);
    const effectiveModel = featureRegistry.effectiveModelsByFeature.get(feature.feature);
    const providedKeys = new Set((effectiveModel?.items ?? []).map((item) => item.key));
    const providedIdents = new Set((effectiveModel?.items ?? []).map((item) => item.ident));

    const text = document.getText();
    for (const ref of collectFeatureRequiresFeatureRefs(text, document)) {
      if (featureRegistry.manifestsByFeature.has(ref.ident)) {
        continue;
      }

      issues.push({
        ruleId: "unknown-feature-requirement",
        range: ref.range,
        message: withDidYouMean(
          `Required feature '${ref.ident}' was not found in the loaded feature registry.`,
          ref.ident,
          featureRegistry.manifestsByFeature.keys()
        )
      });
    }

    for (const expectation of collectFeatureExpectsRefs(text, document)) {
      const key = `${expectation.kind}:${expectation.ident}`;
      if (providedKeys.has(key)) {
        continue;
      }

      issues.push({
        ruleId: "missing-feature-expectation",
        range: expectation.range,
        message: withDidYouMean(
          `Expected symbol '${expectation.kind}:${expectation.ident}' is not provided by feature '${feature.feature}'.`,
          expectation.ident,
          providedIdents
        )
      });
    }

    for (const expectedXPath of collectFeatureExpectedXPathRefs(text, document)) {
      if (effectiveModel && matchesExpectedXPathInEffectiveModel(expectedXPath.xpath, effectiveModel.items, capabilityReport)) {
        continue;
      }

      issues.push({
        ruleId: "missing-feature-expected-xpath",
        range: expectedXPath.range,
        message: `Expected XPath '${expectedXPath.xpath}' is not satisfied by the effective feature composition.`
      });
    }

    const featureManifest = featureRegistry.manifestsByFeature.get(feature.feature);
    if (effectiveModel && featureManifest?.entrypoint === relPath) {
      const diagnosticAnchor = findFeatureManifestRange(text, document);
      const duplicateProviderConflicts = effectiveModel.conflicts.filter((conflict) => conflict.code === "duplicate-provider");
      for (const conflict of duplicateProviderConflicts) {
        issues.push({
          ruleId: "duplicate-feature-provider",
          range: diagnosticAnchor,
          message: conflict.message
        });
      }

      const missingDependencyConflicts = effectiveModel.conflicts.filter((conflict) => conflict.code === "missing-dependency");
      for (const conflict of missingDependencyConflicts) {
        issues.push({
          ruleId: "missing-feature-dependency",
          range: diagnosticAnchor,
          message: conflict.message
        });
      }

      const orderingConflicts = effectiveModel.conflicts.filter((conflict) => conflict.code === "ordering-conflict");
      for (const conflict of orderingConflicts) {
        issues.push({
          ruleId: "ordering-conflict",
          range: diagnosticAnchor,
          message: `${conflict.message} Tip: keep ordering targets in the same OrderGroup and avoid reciprocal/cyclic Before/After links.`
        });
      }

      const orphanParts = feature.parts
        .map((part) => part.file)
        .filter((partFile) => !isFeaturePartFilePresent(partFile, document.uri));
      if (orphanParts.length > 0) {
        issues.push({
          ruleId: "orphan-feature-part",
          range: diagnosticAnchor,
          message: `Feature '${feature.feature}' references part files that are not present in registry: ${orphanParts.join(", ")}.`
        });
      }

      const partialContributionCount = effectiveModel.contributions.filter((contribution) => contribution.usage === "partial").length;
      const missingExpectedXPathConflicts = effectiveModel.conflicts.filter(
        (conflict) => conflict.code === "missing-expected-xpath"
      ).length;
      const incompleteReasons: string[] = [];
      if (missingDependencyConflicts.length > 0) {
        incompleteReasons.push(`missing dependencies=${missingDependencyConflicts.length}`);
      }
      if (duplicateProviderConflicts.length > 0) {
        incompleteReasons.push(`duplicate providers=${duplicateProviderConflicts.length}`);
      }
      if (partialContributionCount > 0) {
        incompleteReasons.push(`partial contributions=${partialContributionCount}`);
      }
      if (missingExpectedXPathConflicts > 0) {
        incompleteReasons.push(`missing expected XPath=${missingExpectedXPathConflicts}`);
      }
      if (orphanParts.length > 0) {
        incompleteReasons.push(`orphan parts=${orphanParts.length}`);
      }

      if (incompleteReasons.length > 0) {
        issues.push({
          ruleId: "incomplete-feature",
          range: diagnosticAnchor,
          message: `Feature '${feature.feature}' is incomplete: ${incompleteReasons.join(", ")}.`
        });
      }
    }

    const matchingPart = feature.parts.find((part) => part.file === relPath);
    if (!matchingPart || !effectiveModel) {
      return;
    }

    const contributionRanges = collectFeatureContributionRanges(text, document);
    for (const contribution of effectiveModel.contributions.filter((item) => item.partId === matchingPart.id)) {
      const range = contributionRanges.get((contribution.name ?? contribution.contributionId).toLowerCase());
      if (!range) {
        continue;
      }

      if (contribution.usage === "unused") {
        issues.push({
          ruleId: "unused-feature-contribution",
          range,
          message: `Contribution '${contribution.name ?? contribution.contributionId}' has no effective impact in current feature composition.`
        });
        continue;
      }

      if (contribution.usage === "partial") {
        const missing = [
          ...contribution.missingExpectationKeys.map((item) => `'${item}'`),
          ...contribution.missingExpectedXPaths.map((item) => `'${item}'`)
        ];
        const suffix = missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
        issues.push({
          ruleId: "partial-feature-contribution",
          range,
          message: `Contribution '${contribution.name ?? contribution.contributionId}' is only partially effective.${suffix}`
        });
      }
    }
  }

  private validatePrimitiveReferences(
    document: vscode.TextDocument,
    issues: RuleDiagnostic[]
  ): void {
    const text = document.getText();
    if (!/<UsePrimitive\b/i.test(text)) {
      return;
    }

    const primitiveUsages = collectUsePrimitiveNodes(text, document);
    if (primitiveUsages.length === 0) {
      return;
    }

    const primitiveRoots = collectPrimitiveRoots();
    const definitionCache = new Map<string, PrimitiveDefinition | null>();
    for (const usage of primitiveUsages) {
      const key = usage.primitiveKey;
      if (!key) {
        continue;
      }

      const definition = loadPrimitiveDefinition(key, primitiveRoots, definitionCache);
      if (!definition) {
        issues.push({
          ruleId: "unknown-primitive",
          range: usage.keyRange ?? usage.range,
          message: `Primitive '${key}' was not found in XML_Primitives/XML_Components.`
        });
        continue;
      }

      const template = pickPrimitiveTemplateDefinition(definition, usage.templateName);
      if (!template) {
        issues.push({
          ruleId: "unknown-primitive",
          range: usage.templateRange ?? usage.keyRange ?? usage.range,
          message: usage.templateName
            ? `Primitive '${key}' does not define template '${usage.templateName}'.`
            : `Primitive '${key}' has no usable template.`
        });
        continue;
      }

      const requiredSlots = collectRequiredSlotNames(template.content);
      for (const slotName of requiredSlots) {
        if (usage.slotNames.has(slotName)) {
          continue;
        }
        issues.push({
          ruleId: "primitive-missing-slot",
          range: usage.range,
          message: `UsePrimitive '${key}' is missing required Slot '${slotName}'.`
        });
      }

      const requiredParams = collectRequiredPrimitiveParamNames(definition, template);
      for (const paramName of requiredParams) {
        if (usage.attrs.has(paramName)) {
          continue;
        }
        issues.push({
          ruleId: "primitive-missing-param",
          range: usage.range,
          message: `UsePrimitive '${key}' is missing required parameter '${paramName}'.`
        });
      }

      const cycle = detectPrimitiveCycleFrom(definition.key, primitiveRoots, definitionCache);
      if (cycle) {
        issues.push({
          ruleId: "primitive-cycle",
          range: usage.keyRange ?? usage.range,
          message: `Primitive cycle detected: ${cycle.join(" -> ")}`
        });
      }
    }
  }
}

interface UsePrimitiveNode {
  primitiveKey?: string;
  templateName?: string;
  attrs: Map<string, string>;
  slotNames: Set<string>;
  range: vscode.Range;
  keyRange?: vscode.Range;
  templateRange?: vscode.Range;
}

interface PrimitiveTemplateDefinition {
  name?: string;
  content: string;
  requiredParams: Set<string>;
}

interface PrimitiveDefinition {
  key: string;
  filePath: string;
  templates: PrimitiveTemplateDefinition[];
  requiredParams: Set<string>;
  dependencies: Set<string>;
}

function collectUsePrimitiveNodes(text: string, document: vscode.TextDocument): UsePrimitiveNode[] {
  const out: UsePrimitiveNode[] = [];
  const selfClosingRegex = /<UsePrimitive\b([^>]*)\/>/gi;
  for (const match of text.matchAll(selfClosingRegex)) {
    const rawAttrs = match[1] ?? "";
    const attrsOffset = (match[0] ?? "").indexOf(rawAttrs);
    const attrsStart = (match.index ?? 0) + (attrsOffset >= 0 ? attrsOffset : 0);
    out.push(buildUsePrimitiveNode(rawAttrs, "", match.index ?? 0, (match.index ?? 0) + (match[0]?.length ?? 0), attrsStart, document));
  }

  const blockRegex = /<UsePrimitive\b([^>]*)>([\s\S]*?)<\/UsePrimitive>/gi;
  for (const match of text.matchAll(blockRegex)) {
    const rawAttrs = match[1] ?? "";
    const body = match[2] ?? "";
    const full = match[0] ?? "";
    const start = match.index ?? 0;
    const attrsOffset = full.indexOf(rawAttrs);
    const attrsStart = start + (attrsOffset >= 0 ? attrsOffset : 0);
    out.push(buildUsePrimitiveNode(rawAttrs, body, start, start + full.length, attrsStart, document));
  }

  return out;
}

function buildUsePrimitiveNode(
  rawAttrs: string,
  body: string,
  start: number,
  end: number,
  attrsStart: number,
  document: vscode.TextDocument
): UsePrimitiveNode {
  const attrs = parseFeatureXmlAttributes(rawAttrs, rawAttrs, attrsStart, document);
  const primitiveAttr =
    getAttributeCaseInsensitiveXml(attrs, "Primitive") ??
    getAttributeCaseInsensitiveXml(attrs, "Name") ??
    getAttributeCaseInsensitiveXml(attrs, "Feature") ??
    getAttributeCaseInsensitiveXml(attrs, "Component");
  const templateAttr =
    getAttributeCaseInsensitiveXml(attrs, "Template") ??
    getAttributeCaseInsensitiveXml(attrs, "Contribution") ??
    getAttributeCaseInsensitiveXml(attrs, "Section");

  const attrMap = new Map<string, string>();
  for (const [attrName, attrValue] of attrs.entries()) {
    attrMap.set(attrName, attrValue.value);
  }

  return {
    primitiveKey: primitiveAttr ? normalizeComponentKey(primitiveAttr.value) : undefined,
    templateName: templateAttr?.value,
    attrs: attrMap,
    slotNames: collectSlotNamesFromUsePrimitiveBody(body),
    range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
    ...(primitiveAttr ? { keyRange: primitiveAttr.range } : {}),
    ...(templateAttr ? { templateRange: templateAttr.range } : {})
  };
}

function collectSlotNamesFromUsePrimitiveBody(body: string): Set<string> {
  const out = new Set<string>();
  for (const slotMatch of body.matchAll(/<Slot\b([^>]*)>([\s\S]*?)<\/Slot>/gi)) {
    const attrs = slotMatch[1] ?? "";
    const name = extractXmlAttribute(attrs, "Name");
    if (name) {
      out.add(name);
    }
  }
  return out;
}

function collectPrimitiveRoots(): string[] {
  const out: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    out.push(path.join(folder.uri.fsPath, "XML_Primitives"));
    out.push(path.join(folder.uri.fsPath, "XML_Components"));
  }
  return out;
}

function loadPrimitiveDefinition(
  primitiveKey: string,
  primitiveRoots: readonly string[],
  cache: Map<string, PrimitiveDefinition | null>
): PrimitiveDefinition | undefined {
  const normalizedKey = normalizeComponentKey(primitiveKey);
  if (cache.has(normalizedKey)) {
    return cache.get(normalizedKey) ?? undefined;
  }

  const filePath = findPrimitiveFilePath(normalizedKey, primitiveRoots);
  if (!filePath) {
    cache.set(normalizedKey, null);
    return undefined;
  }

  const text = fs.readFileSync(filePath, "utf8");
  const templates = parsePrimitiveTemplates(text);
  const requiredParams = collectRequiredParamsFromPrimitiveText(text);
  const dependencies = collectPrimitiveDependencies(text);
  const definition: PrimitiveDefinition = {
    key: normalizedKey,
    filePath,
    templates,
    requiredParams,
    dependencies
  };
  cache.set(normalizedKey, definition);
  return definition;
}

function findPrimitiveFilePath(primitiveKey: string, primitiveRoots: readonly string[]): string | undefined {
  const normalized = primitiveKey.replace(/\//g, path.sep);
  for (const root of primitiveRoots) {
    const candidates = [
      path.join(root, `${normalized}.primitive.xml`),
      path.join(root, `${normalized}.xml`)
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function parsePrimitiveTemplates(text: string): PrimitiveTemplateDefinition[] {
  const out: PrimitiveTemplateDefinition[] = [];
  for (const match of text.matchAll(/<Template\b([^>]*)>([\s\S]*?)<\/Template>/gi)) {
    const attrs = match[1] ?? "";
    const content = match[2] ?? "";
    out.push({
      name: extractXmlAttribute(attrs, "Name"),
      content,
      requiredParams: collectRequiredParamsFromPrimitiveText(content)
    });
  }
  return out;
}

function collectRequiredSlotNames(templateContent: string): Set<string> {
  const out = new Set<string>();
  for (const match of templateContent.matchAll(/\{\{Slot:([A-Za-z_][\w.-]*)\}\}/g)) {
    const name = (match[1] ?? "").trim();
    if (name) {
      out.add(name);
    }
  }
  return out;
}

function collectRequiredPrimitiveParamNames(
  definition: PrimitiveDefinition,
  template: PrimitiveTemplateDefinition
): Set<string> {
  const required = new Set<string>(definition.requiredParams);
  for (const name of template.requiredParams) {
    required.add(name);
  }
  return required;
}

function collectRequiredParamsFromPrimitiveText(text: string): Set<string> {
  const out = new Set<string>();
  for (const explicitParam of text.matchAll(/<Param\b([^>]*)\/?>/gi)) {
    const attrs = explicitParam[1] ?? "";
    const name = extractXmlAttribute(attrs, "Name");
    const requiredAttr = (extractXmlAttribute(attrs, "Required") ?? "").trim().toLowerCase();
    if (name && (requiredAttr === "true" || requiredAttr === "1")) {
      out.add(name);
    }
  }

  for (const token of text.matchAll(/\{\{([A-Za-z_][\w.-]*)\}\}/g)) {
    const name = (token[1] ?? "").trim();
    if (!name || name.toLowerCase().startsWith("slot:")) {
      continue;
    }
    out.add(name);
  }

  return out;
}

function collectPrimitiveDependencies(text: string): Set<string> {
  const out = new Set<string>();
  for (const usage of text.matchAll(/<UsePrimitive\b([^>]*)\/?>/gi)) {
    const attrs = usage[1] ?? "";
    const key =
      extractXmlAttribute(attrs, "Primitive") ??
      extractXmlAttribute(attrs, "Name") ??
      extractXmlAttribute(attrs, "Feature") ??
      extractXmlAttribute(attrs, "Component");
    if (key) {
      out.add(normalizeComponentKey(key));
    }
  }
  return out;
}

function extractXmlAttribute(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\s*=\\s*(\"([^\"]*)\"|'([^']*)')`, "i");
  const match = regex.exec(attrs);
  const value = (match?.[2] ?? match?.[3] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function pickPrimitiveTemplateDefinition(
  definition: PrimitiveDefinition,
  templateName?: string
): PrimitiveTemplateDefinition | undefined {
  if (templateName && templateName.trim().length > 0) {
    return definition.templates.find((template) => (template.name ?? "") === templateName);
  }
  return definition.templates[0];
}

function detectPrimitiveCycleFrom(
  rootKey: string,
  primitiveRoots: readonly string[],
  cache: Map<string, PrimitiveDefinition | null>
): string[] | undefined {
  const visited = new Set<string>();
  const stack: string[] = [];
  const inStack = new Set<string>();

  const dfs = (key: string): string[] | undefined => {
    const normalized = normalizeComponentKey(key);
    const cycleStart = stack.indexOf(normalized);
    if (cycleStart >= 0) {
      return [...stack.slice(cycleStart), normalized];
    }
    if (visited.has(normalized)) {
      return undefined;
    }

    const definition = loadPrimitiveDefinition(normalized, primitiveRoots, cache);
    if (!definition) {
      visited.add(normalized);
      return undefined;
    }

    visited.add(normalized);
    stack.push(normalized);
    inStack.add(normalized);
    for (const dep of definition.dependencies) {
      if (inStack.has(dep)) {
        const depIndex = stack.indexOf(dep);
        if (depIndex >= 0) {
          return [...stack.slice(depIndex), dep];
        }
      }

      const nested = dfs(dep);
      if (nested) {
        return nested;
      }
    }
    stack.pop();
    inStack.delete(normalized);
    return undefined;
  };

  return dfs(rootKey);
}

function findFeatureForRelativePath(
  featureRegistry: FeatureManifestRegistry,
  relativePath: string
): FeatureCapabilityReport | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  for (const manifest of featureRegistry.manifestsByFeature.values()) {
    if (manifest.entrypoint === normalized) {
      return featureRegistry.capabilityReportsByFeature.get(manifest.feature);
    }

    if (manifest.parts.some((part) => part.file === normalized)) {
      return featureRegistry.capabilityReportsByFeature.get(manifest.feature);
    }
  }

  return undefined;
}

function collectFeatureRequiresFeatureRefs(
  text: string,
  document: vscode.TextDocument
): Array<{ ident: string; range: vscode.Range }> {
  const out: Array<{ ident: string; range: vscode.Range }> = [];
  const requiresRegex = /<\s*Requires\b[^>]*>([\s\S]*?)<\/\s*Requires\s*>/gi;
  const refRegex = /<\s*Ref\b([^>]*?)\/>/gi;

  for (const block of text.matchAll(requiresRegex)) {
    const body = block[1] ?? "";
    const whole = block[0] ?? "";
    const blockStart = block.index ?? 0;
    const bodyOffset = whole.indexOf(body);
    if (bodyOffset < 0) {
      continue;
    }

    const bodyStart = blockStart + bodyOffset;
    for (const ref of body.matchAll(refRegex)) {
      const rawAttrs = ref[1] ?? "";
      const attrsOffset = (ref[0] ?? "").indexOf(rawAttrs);
      const attrsStart = bodyStart + (ref.index ?? 0) + (attrsOffset >= 0 ? attrsOffset : 0);
      const attrs = parseFeatureXmlAttributes(rawAttrs, text, attrsStart, document);
      const kind = getAttributeCaseInsensitiveXml(attrs, "Kind");
      const ident = getAttributeCaseInsensitiveXml(attrs, "Ident");
      if (!kind || !ident || kind.value.toLowerCase() !== "feature") {
        continue;
      }

      out.push({
        ident: ident.value,
        range: ident.range
      });
    }
  }

  return out;
}

function collectFeatureExpectsRefs(
  text: string,
  document: vscode.TextDocument
): Array<{ kind: string; ident: string; range: vscode.Range }> {
  const out: Array<{ kind: string; ident: string; range: vscode.Range }> = [];
  const expectsRegex = /<\s*Expects\b[^>]*>([\s\S]*?)<\/\s*Expects\s*>/gi;
  const symbolRegex = /<\s*Symbol\b([^>]*?)\/>/gi;

  for (const block of text.matchAll(expectsRegex)) {
    const body = block[1] ?? "";
    const whole = block[0] ?? "";
    const blockStart = block.index ?? 0;
    const bodyOffset = whole.indexOf(body);
    if (bodyOffset < 0) {
      continue;
    }

    const bodyStart = blockStart + bodyOffset;
    for (const symbol of body.matchAll(symbolRegex)) {
      const rawAttrs = symbol[1] ?? "";
      const attrsOffset = (symbol[0] ?? "").indexOf(rawAttrs);
      const attrsStart = bodyStart + (symbol.index ?? 0) + (attrsOffset >= 0 ? attrsOffset : 0);
      const attrs = parseFeatureXmlAttributes(rawAttrs, text, attrsStart, document);
      const kind = getAttributeCaseInsensitiveXml(attrs, "Kind");
      const ident = getAttributeCaseInsensitiveXml(attrs, "Ident");
      if (!kind || !ident) {
        continue;
      }

      out.push({
        kind: kind.value,
        ident: ident.value,
        range: ident.range
      });
    }
  }

  return out;
}

function collectFeatureExpectedXPathRefs(
  text: string,
  document: vscode.TextDocument
): Array<{ xpath: string; range: vscode.Range }> {
  const out: Array<{ xpath: string; range: vscode.Range }> = [];
  const expectsXPathRegex = /<\s*ExpectsXPath(s)?\b[^>]*>([\s\S]*?)<\/\s*ExpectsXPath(s)?\s*>/gi;
  const xpathRegex = /<\s*XPath\b[^>]*>([\s\S]*?)<\/\s*XPath\s*>/gi;

  for (const block of text.matchAll(expectsXPathRegex)) {
    const body = block[2] ?? "";
    const whole = block[0] ?? "";
    const blockStart = block.index ?? 0;
    const bodyOffset = whole.indexOf(body);
    if (bodyOffset < 0) {
      continue;
    }

    const bodyStart = blockStart + bodyOffset;
    for (const xpathMatch of body.matchAll(xpathRegex)) {
      const xpath = (xpathMatch[1] ?? "").trim();
      if (!xpath) {
        continue;
      }

      const rawValue = xpathMatch[1] ?? "";
      const valueOffset = (xpathMatch[0] ?? "").indexOf(rawValue);
      const start = bodyStart + (xpathMatch.index ?? 0) + (valueOffset >= 0 ? valueOffset : 0);
      out.push({
        xpath,
        range: new vscode.Range(document.positionAt(start), document.positionAt(start + rawValue.length))
      });
    }
  }

  return out;
}

function collectFeatureContributionRanges(
  text: string,
  document: vscode.TextDocument
): Map<string, vscode.Range> {
  const out = new Map<string, vscode.Range>();
  const contributionRegex = /<\s*(Contribution|Section)\b([^>]*?)(?:\/>|>)/gi;

  for (const match of text.matchAll(contributionRegex)) {
    const rawAttrs = match[2] ?? "";
    const attrsOffset = (match[0] ?? "").indexOf(rawAttrs);
    const attrsStart = (match.index ?? 0) + (attrsOffset >= 0 ? attrsOffset : 0);
    const attrs = parseFeatureXmlAttributes(rawAttrs, text, attrsStart, document);
    const name = getAttributeCaseInsensitiveXml(attrs, "Name");
    if (name?.value) {
      out.set(name.value.toLowerCase(), name.range);
      continue;
    }

    const tagName = match[1] ?? "Contribution";
    const tagStart = match.index ?? 0;
    out.set(
      tagName.toLowerCase(),
      new vscode.Range(document.positionAt(tagStart), document.positionAt(tagStart + tagName.length + 1))
    );
  }

  return out;
}

function findFeatureManifestRange(
  text: string,
  document: vscode.TextDocument
): vscode.Range {
  const manifestMatch = /<\s*Manifest\b/i.exec(text);
  if (manifestMatch) {
    const start = manifestMatch.index ?? 0;
    return new vscode.Range(document.positionAt(start), document.positionAt(start + "<Manifest".length));
  }

  const featureMatch = /<\s*Feature\b/i.exec(text);
  if (featureMatch) {
    const start = featureMatch.index ?? 0;
    return new vscode.Range(document.positionAt(start), document.positionAt(start + "<Feature".length));
  }

  return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
}

function isFeaturePartFilePresent(partFile: string, documentUri: vscode.Uri): boolean {
  const normalized = partFile.replace(/\\/g, "/").trim();
  if (!normalized) {
    return true;
  }

  const candidatePaths = new Set<string>();
  if (path.isAbsolute(normalized)) {
    candidatePaths.add(path.normalize(normalized));
  }

  const activeFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (activeFolder) {
    candidatePaths.add(path.normalize(path.join(activeFolder.uri.fsPath, normalized)));
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidatePaths.add(path.normalize(path.join(folder.uri.fsPath, normalized)));
  }

  if (candidatePaths.size === 0) {
    return true;
  }

  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      return true;
    }
  }

  return false;
}

function parseFeatureXmlAttributes(
  rawAttrs: string,
  fullText: string,
  attrsStartIndex: number,
  document: vscode.TextDocument
): Map<string, { value: string; range: vscode.Range }> {
  const map = new Map<string, { value: string; range: vscode.Range }>();
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(\"([^\"]*)\"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? "";
    const valueOffset = match[0].indexOf(value);
    const absoluteStart = attrsStartIndex + match.index + valueOffset;
    map.set(name, {
      value,
      range: new vscode.Range(document.positionAt(absoluteStart), document.positionAt(absoluteStart + value.length))
    });
  }

  return map;
}

function getAttributeCaseInsensitiveXml(
  attrs: Map<string, { value: string; range: vscode.Range }>,
  name: string
): { value: string; range: vscode.Range } | undefined {
  for (const [key, value] of attrs.entries()) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }

  return undefined;
}

function collectWorkflowControlShareCodes(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Set<string> {
  const out = new Set<string>(facts.declaredControlShareCodes);
  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const key of contributionRef.contribution.workflowControlShareCodeIdents) {
      if (component.workflowControlShareCodeDefinitions.has(key)) {
        out.add(key);
      }
    }
  }

  return out;
}

function collectWorkflowButtonShareCodes(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Set<string> {
  const out = new Set<string>(facts.declaredButtonShareCodes);
  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const key of contributionRef.contribution.workflowButtonShareCodeIdents) {
      if (component.workflowButtonShareCodeDefinitions.has(key)) {
        out.add(key);
      }
    }
  }

  return out;
}

function collectExpandedIdentOccurrences(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): ReturnType<typeof parseDocumentFacts>["identOccurrences"] {
  const out = [...facts.identOccurrences];
  const rootLower = (facts.rootTag ?? "").toLowerCase();

  if (rootLower === "form") {
    const localUsingRangesByComponent = new Map<string, vscode.Range>();
    const localUsingRangesByComponentAndContribution = new Map<string, vscode.Range>();
    for (const usingRef of facts.usingReferences) {
      if (usingRef.suppressInheritance) {
        continue;
      }

      if (!localUsingRangesByComponent.has(usingRef.componentKey)) {
        localUsingRangesByComponent.set(usingRef.componentKey, usingRef.componentValueRange);
      }

      if (usingRef.sectionValue && !localUsingRangesByComponentAndContribution.has(`${usingRef.componentKey}::${usingRef.sectionValue}`)) {
        localUsingRangesByComponentAndContribution.set(`${usingRef.componentKey}::${usingRef.sectionValue}`, usingRef.sectionValueRange ?? usingRef.componentValueRange);
      }
    }

    const defaultRange = facts.rootIdentRange
      ?? facts.rootFormIdentRange
      ?? facts.workflowFormIdentRange
      ?? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
    const defaultButtonScopeKey =
      facts.identOccurrences.find((item) => item.kind === "button")?.scopeKey
      ?? "__global_buttons__";
    const defaultSectionScopeKey =
      facts.identOccurrences.find((item) => item.kind === "section")?.scopeKey
      ?? "__global_sections__";
    const defaultControlScopeKey =
      facts.identOccurrences.find((item) => item.kind === "control")?.scopeKey
      ?? "__global_controls__";
    const rootButtonScopeKey = [...(facts.rootButtonScopeKeys ?? [])][0];
    const rootSectionScopeKey = [...(facts.rootSectionScopeKeys ?? [])][0];
    const rootControlScopeKey = [...(facts.rootControlScopeKeys ?? [])][0];

    for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
      if (!contributionMatchesDocumentRoot(facts.rootTag, contributionRef.contribution)) {
        continue;
      }

      for (const controlIdent of contributionRef.contribution.formControlIdents) {
        const contributionKey = `${contributionRef.componentKey}::${contributionRef.contribution.contributionName}`;
        const range =
          contributionRef.source === "local"
            ? localUsingRangesByComponentAndContribution.get(contributionKey)
              ?? localUsingRangesByComponent.get(contributionRef.componentKey)
              ?? defaultRange
            : defaultRange;

        out.push({
          ident: controlIdent,
          kind: "control",
          range,
          scopeKey: resolveInjectedControlScopeKey(contributionRef.contribution.targetXPath, rootControlScopeKey, defaultControlScopeKey)
        });
      }

      for (const buttonIdent of contributionRef.contribution.formButtonIdents) {
        const contributionKey = `${contributionRef.componentKey}::${contributionRef.contribution.contributionName}`;
        const range =
          contributionRef.source === "local"
            ? localUsingRangesByComponentAndContribution.get(contributionKey)
              ?? localUsingRangesByComponent.get(contributionRef.componentKey)
              ?? defaultRange
            : defaultRange;

        out.push({
          ident: buttonIdent,
          kind: "button",
          range,
          scopeKey: resolveInjectedButtonScopeKey(contributionRef.contribution.targetXPath, rootButtonScopeKey, defaultButtonScopeKey)
        });
      }

      for (const sectionIdent of contributionRef.contribution.formSectionIdents) {
        const contributionKey = `${contributionRef.componentKey}::${contributionRef.contribution.contributionName}`;
        const range =
          contributionRef.source === "local"
            ? localUsingRangesByComponentAndContribution.get(contributionKey)
              ?? localUsingRangesByComponent.get(contributionRef.componentKey)
              ?? defaultRange
            : defaultRange;

        out.push({
          ident: sectionIdent,
          kind: "section",
          range,
          scopeKey: resolveInjectedSectionScopeKey(contributionRef.contribution.targetXPath, rootSectionScopeKey, defaultSectionScopeKey)
        });
      }
    }
  }

  if (rootLower !== "workflow") {
    return out;
  }

  const buttonShareCodeButtons = collectWorkflowButtonShareCodeButtonIdents(facts, index, documentComposition);
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
  index: WorkspaceIndex,
  documentComposition: DocumentCompositionModel
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();

  for (const [shareCode, buttonIds] of facts.buttonShareCodeButtonIdents.entries()) {
    const target = out.get(shareCode) ?? new Set<string>();
    for (const buttonId of buttonIds) {
      target.add(buttonId);
    }
    out.set(shareCode, target);
  }

  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    const component = resolveComponentByKey(index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const shareCode of contributionRef.contribution.workflowButtonShareCodeIdents) {
      const buttonIds = component.workflowButtonShareCodeButtonIdents.get(shareCode);
      if (!buttonIds || buttonIds.size === 0) {
        continue;
      }

      const target = out.get(shareCode) ?? new Set<string>();
      for (const buttonId of buttonIds) {
        target.add(buttonId);
      }
      out.set(shareCode, target);
    }
  }

  return out;
}

function collectWorkflowAvailableControls(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  form: import("../indexer/types").IndexedForm,
  metadata: ReturnType<typeof getSystemMetadata>,
  documentComposition: DocumentCompositionModel
): Set<string> {
  const out = new Set<string>(form.controls);
  for (const column of metadata.defaultFormColumns) {
    out.add(column);
  }

  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    for (const ident of contributionRef.contribution.formControlIdents) {
      out.add(ident);
    }
  }

  return out;
}

function collectWorkflowAvailableButtons(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex,
  form: import("../indexer/types").IndexedForm,
  documentComposition: DocumentCompositionModel
): Set<string> {
  const out = new Set<string>(form.buttons);
  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    for (const ident of contributionRef.contribution.formButtonIdents) {
      out.add(ident);
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

function describeLookupIdentSplit(
  ident: string,
  candidates: Array<{ name: string; kind: "form" | "system" }>
): string {
  const parsed = parseLookupControlIdent(ident, candidates);
  if (!parsed) {
    return "Split: purpose=?, formOrTable=?, foreignKey=?. Primary table/form candidate not found.";
  }

  const idx = ident.lastIndexOf(parsed.targetName);
  const purposeRaw = idx > 0 ? ident.slice(0, idx) : "";
  const purpose = purposeRaw.length > 0 ? purposeRaw : "(empty)";
  const foreignKey = parsed.foreignKey.length > 0 ? parsed.foreignKey : "(empty)";
  return `Split: purpose='${purpose}', formOrTable='${parsed.targetName}', foreignKey='${foreignKey}'.`;
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

function getInheritanceRulePrefix(root: string): "workflow" | "dataview" | undefined {
  if (root === "workflow") {
    return "workflow";
  }

  if (root === "dataview") {
    return "dataview";
  }

  return undefined;
}

function getOwningFormIdentForInheritance(root: string, facts: ReturnType<typeof parseDocumentFacts>): string | undefined {
  if (root === "workflow") {
    return facts.workflowFormIdent ?? facts.rootFormIdent;
  }

  if (root === "dataview") {
    return facts.rootFormIdent;
  }

  return undefined;
}

function collectUsingRefsByFeature(
  facts: ReturnType<typeof parseDocumentFacts>
): Map<string, { hasFull: boolean; sections: Set<string> }> {
  const out = new Map<string, { hasFull: boolean; sections: Set<string> }>();
  for (const ref of facts.usingReferences) {
    const current = out.get(ref.componentKey) ?? { hasFull: false, sections: new Set<string>() };
    if (ref.sectionValue) {
      current.sections.add(ref.sectionValue);
    } else {
      current.hasFull = true;
    }
    out.set(ref.componentKey, current);
  }
  return out;
}

function addRangeMapValue(target: Map<string, vscode.Range[]>, key: string, range: vscode.Range): void {
  const current = target.get(key) ?? [];
  current.push(range);
  target.set(key, current);
}

function addNestedRangeMapValue(
  target: Map<string, Map<string, vscode.Range[]>>,
  key: string,
  nestedKey: string,
  range: vscode.Range
): void {
  const nested = target.get(key) ?? new Map<string, vscode.Range[]>();
  const current = nested.get(nestedKey) ?? [];
  current.push(range);
  nested.set(nestedKey, current);
  target.set(key, nested);
}

function getUsingKey(componentKey: string, sectionValue?: string): string {
  return `${componentKey}::${sectionValue ?? ""}`;
}

function resolveInjectedControlScopeKey(targetXPath: string | undefined, rootScopeKey: string | undefined, fallback: string): string {
  const normalized = (targetXPath ?? "").replace(/\s+/g, "").toLowerCase();
  if (normalized.includes("//form/controls")) {
    return rootScopeKey ?? fallback;
  }

  return fallback;
}

function resolveInjectedButtonScopeKey(targetXPath: string | undefined, rootScopeKey: string | undefined, fallback: string): string {
  const normalized = (targetXPath ?? "").replace(/\s+/g, "").toLowerCase();
  if (normalized.includes("//form/buttons")) {
    return rootScopeKey ?? fallback;
  }

  return fallback;
}

function resolveInjectedSectionScopeKey(targetXPath: string | undefined, rootScopeKey: string | undefined, fallback: string): string {
  const normalized = (targetXPath ?? "").replace(/\s+/g, "").toLowerCase();
  if (normalized.includes("//form/sections")) {
    return rootScopeKey ?? fallback;
  }

  return fallback;
}
