import * as vscode from "vscode";
import { getSettings, mapSeverityToDiagnostic, resolveRuleSeverity, SfpXmlLinterSettings } from "../config/settings";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseIgnoreState, isRuleIgnored } from "./ignore";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts, parseDocumentFactsFromText, WorkflowReference } from "../indexer/xmlFacts";
import { documentInConfiguredRoots, normalizeComponentKey } from "../utils/paths";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { getSystemMetadata, isKnownSystemTableForeignKey, SystemMetadata } from "../config/systemMetadata";
import { collectResolvableControlIdents } from "../utils/controlIdents";
import { maskXmlComments } from "../utils/xmlComments";
import { getAllFormIdentCandidates, isKnownFormIdent, resolveSystemTableName } from "../utils/formIdents";
import { EffectiveCompositionItem, FeatureCapabilityReport, FeatureSymbolKind } from "../composition/model";
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
import type { ComposedDocumentSnapshotRegistry } from "../core/model/composedDocumentSnapshotRegistry";
import { getIndexedComponentKeys, getIndexedFormByIdent, getIndexedForms, getParsedFactsByUri, getParsedFactsEntries } from "../core/model/indexAccess";
import { parseIndexUriKey } from "../core/model/indexUriParser";
import { resolveDocumentFacts } from "../core/model/factsResolution";
import { parseFactsStandalone } from "../core/validation/documentValidationService";

export interface RuleDiagnostic {
  ruleId: string;
  message: string;
  range: vscode.Range;
  relatedInformation?: ReadonlyArray<{ location: vscode.Location; message: string }>;
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
  resolveOwningForm?: (formIdent: string) => { form: import("../indexer/types").IndexedForm; index: WorkspaceIndex } | undefined;
  injectedWorkflowReferences?: readonly WorkflowReference[];
  workflowReferenceMode?: "local" | "injected" | "merged";
  composedSnapshotRegistry?: ComposedDocumentSnapshotRegistry;
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
    const facts = options?.parsedFacts ?? resolveDocumentFacts(document, index, {
      getFactsForUri: standaloneMode
        ? undefined
        : ((uri, idx) => getFactsForUri(idx, uri, options?.composedSnapshotRegistry)),
      parseFacts: parseDocumentFacts,
      mode: "strict-accessor"
    }) ?? (standaloneMode ? parseFactsStandalone(document) : undefined);
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
      this.validateWorkflowReferences(
        facts,
        index,
        issues,
        metadata,
        documentComposition,
        options?.resolveOwningForm,
        options?.injectedWorkflowReferences,
        options?.workflowReferenceMode
      );
    }

    this.validateMappingFormIdentReferences(facts, index, issues, metadata, formIdentCandidates, settings);
    this.validateMappingReferences(facts, index, issues, metadata, getResolvableControlIdents, settings);
    this.validateRequiredActionIdentReferences(facts, issues, getResolvableControlIdents);
    this.validateWorkflowControlIdentReferences(facts, issues, getResolvableControlIdents);
    this.validateUsingReferences(
      document,
      facts,
      index,
      issues,
      documentComposition,
      options?.composedSnapshotRegistry,
      maskedText
    );
    this.validatePrimitiveReferences(document, issues);
    this.validateHtmlTemplateControlReferences(facts, issues, getResolvableControlIdents);
    this.validateFeatureCompositionReferences(document, facts, issues, featureRegistry, maskedText);
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
      if (issue.relatedInformation && issue.relatedInformation.length > 0) {
        diagnostic.relatedInformation = issue.relatedInformation.map(
          (item) => new vscode.DiagnosticRelatedInformation(item.location, item.message)
        );
      }
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
    documentComposition: DocumentCompositionModel,
    resolveOwningForm?: (formIdent: string) => { form: import("../indexer/types").IndexedForm; index: WorkspaceIndex } | undefined,
    injectedWorkflowReferences?: readonly WorkflowReference[],
    workflowReferenceMode: "local" | "injected" | "merged" = "local"
  ): void {
    const formIdent = facts.workflowFormIdent;
    if (!formIdent) {
      return;
    }

    const resolvedOwningForm = resolveOwningForm?.(formIdent);
    const form = resolvedOwningForm?.form ?? getIndexedFormByIdent(index, formIdent);
    if (!form) {
      return;
    }
    const formIndex = resolvedOwningForm?.index ?? index;

    const availableControlShareCodes = collectWorkflowControlShareCodes(facts, index, documentComposition);
    const availableButtonShareCodes = collectWorkflowButtonShareCodes(facts, index, documentComposition);
    const availableControls = collectWorkflowAvailableControls(facts, index, form, metadata, documentComposition, formIndex);
    const availableButtons = collectWorkflowAvailableButtons(facts, index, form, documentComposition, formIndex);
    const injectedRangeFallback =
      facts.usingReferences[0]?.componentValueRange ??
      facts.workflowFormIdentRange ??
      facts.rootFormIdentRange ??
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));

    const localReferenceKeys = new Set(
      facts.workflowReferences.map((ref) => `${ref.kind}|${ref.ident}|${ref.scopeKey ?? ""}`.toLowerCase())
    );
    const injectedRefs = (injectedWorkflowReferences ?? []).filter((ref) => {
      const key = `${ref.kind}|${ref.ident}|${ref.scopeKey ?? ""}`.toLowerCase();
      return !localReferenceKeys.has(key);
    });

    let allRefs: Array<{ ref: WorkflowReference; injected: boolean }> = [];
    if (workflowReferenceMode === "injected") {
      allRefs = injectedRefs.map((ref) => ({ ref, injected: true }));
      if (allRefs.length === 0) {
        allRefs = facts.workflowReferences.map((ref) => ({ ref, injected: false }));
      }
    } else if (workflowReferenceMode === "merged") {
      allRefs = [
        ...facts.workflowReferences.map((ref) => ({ ref, injected: false })),
        ...injectedRefs.map((ref) => ({ ref, injected: true }))
      ];
    } else {
      allRefs = facts.workflowReferences.map((ref) => ({ ref, injected: false }));
    }

    for (const item of allRefs) {
      const ref = item.ref;
      const range = item.injected ? injectedRangeFallback : ref.range;
      const injectedPrefix = item.injected ? "Injected " : "";
      if (ref.kind === "formControl") {
        if (!availableControls.has(ref.ident)) {
          issues.push({
            ruleId: "unknown-form-control-ident",
            range,
            message: withDidYouMean(
              `${injectedPrefix}FormControl Ident '${ref.ident}' was not found in Form '${form.ident}'.`,
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
            range,
            message: withDidYouMean(
              `${injectedPrefix}ControlShareCode Ident '${ref.ident}' was not found in WorkFlow ControlShareCodes.`,
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
          range,
          message: withDidYouMean(
            `${injectedPrefix}Button Ident '${ref.ident}' was not found in Form '${form.ident}'.`,
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
            range,
            message: withDidYouMean(
              `${injectedPrefix}ButtonShareCode Ident '${ref.ident}' was not found in WorkFlow ButtonShareCodes.`,
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
          range,
          message: withDidYouMean(
            `${injectedPrefix}Section Ident '${ref.ident}' was not found in Form '${form.ident}'.`,
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

    const form = getIndexedFormByIdent(index, owningFormIdent);
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
        const targetForm = getIndexedFormByIdent(index, targetFormIdent);
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
                getIndexedFormByIdent(index, mapping.mappingFormIdent)?.controls ?? []
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
    document: vscode.TextDocument,
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[],
    documentComposition: ReturnType<typeof buildDocumentCompositionModel>,
    composedSnapshotRegistry?: ComposedDocumentSnapshotRegistry,
    maskedText?: string
  ): void {
    if (!index.componentsReady) {
      return;
    }

    if (facts.usingContributionInsertTraces.size === 0) {
      populateUsingInsertTraceFromText(facts, document.getText(), index);
    }

    const settings = getSettings();
    const legacyAliasesEnabled = settings.templateBuilderLegacyComponentSectionSupport;
    const tracesReady = facts.usingContributionInsertTraces.size > 0;
    const effectiveMaskedText = maskedText ?? maskXmlComments(document.getText());
    const suppressedFull = new Set<string>();
    const suppressedSections = new Map<string, Set<string>>();
    const crossDocumentImpactByUsingKey = this.collectCrossDocumentUsingImpactByKey(
      facts,
      index,
      composedSnapshotRegistry
    );
    const effectiveItemsCurrentDocument = buildEffectiveItemsFromDocumentComposition(documentComposition, facts);
    const relatedExpectedXPathContexts = this.collectRelatedExpectedXPathContextsForForm(
      document.uri,
      facts,
      index,
      composedSnapshotRegistry
    );
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

    if (!legacyAliasesEnabled) {
      const includeLegacyFlags = collectIncludeLegacyAliasFlags(effectiveMaskedText);
      for (let i = 0; i < facts.includeReferences.length; i++) {
        const includeRef = facts.includeReferences[i];
        const flags = includeLegacyFlags[i];
        if (!flags) {
          continue;
        }
        const parts: string[] = [];
        if (flags.legacyFeatureAliasUsed) {
          parts.push("Component/Name");
        }
        if (flags.legacyContributionAliasUsed) {
          parts.push("Section");
        }
        if (parts.length === 0) {
          continue;
        }
        issues.push({
          ruleId: "legacy-template-alias-disabled",
          range: flags.legacyContributionAliasUsed
            ? (includeRef.sectionValueRange ?? includeRef.componentValueRange)
            : includeRef.componentValueRange,
          message:
            `Legacy template alias ${parts.join(" + ")} is disabled for this workspace. ` +
            `Use Feature/Contribution instead or enable sfpXmlLinter.templateBuilder.legacyComponentSectionSupport.`
        });
      }

      const placeholderLegacyFlags = collectPlaceholderLegacyAliasFlags(effectiveMaskedText);
      for (let i = 0; i < facts.placeholderReferences.length; i++) {
        const placeholderRef = facts.placeholderReferences[i];
        if (!placeholderRef.componentKey) {
          continue;
        }
        const flags = placeholderLegacyFlags[i];
        if (!flags) {
          continue;
        }
        const parts: string[] = [];
        if (flags.legacyFeatureAliasUsed) {
          parts.push("Component/Name");
        }
        if (flags.legacyContributionAliasUsed) {
          parts.push("Section");
        }
        if (parts.length === 0) {
          continue;
        }
        issues.push({
          ruleId: "legacy-template-alias-disabled",
          range: placeholderRef.range,
          message:
            `Legacy placeholder alias ${parts.join(" + ")} is disabled for this workspace. ` +
            `Use Feature/Contribution keys instead or enable sfpXmlLinter.templateBuilder.legacyComponentSectionSupport.`
        });
      }
    }

    for (const ref of facts.usingReferences) {
      if (ref.suppressInheritance) {
        continue;
      }

      if (!legacyAliasesEnabled) {
        const usedLegacyFeatureAttr = ref.attributes?.some((attr) => {
          const normalized = attr.name.trim().toLowerCase();
          return normalized === "component" || normalized === "name";
        }) === true;
        const usedLegacyContributionAttr = ref.attributes?.some((attr) => attr.name.trim().toLowerCase() === "section") === true;

        if (usedLegacyFeatureAttr || usedLegacyContributionAttr) {
          const parts: string[] = [];
          if (usedLegacyFeatureAttr) {
            parts.push("Component/Name");
          }
          if (usedLegacyContributionAttr) {
            parts.push("Section");
          }
          issues.push({
            ruleId: "legacy-template-alias-disabled",
            range: usedLegacyContributionAttr
              ? (ref.sectionValueRange ?? ref.componentValueRange)
              : ref.componentValueRange,
            message:
              `Legacy template alias ${parts.join(" + ")} is disabled for this workspace. ` +
              `Use Feature/Contribution instead or enable sfpXmlLinter.templateBuilder.legacyComponentSectionSupport.`
          });
        }
      }

      const component = resolveComponentByKey(index, ref.componentKey);
      if (!component) {
        issues.push({
          ruleId: "unknown-using-feature",
          range: ref.componentValueRange,
              message: withDidYouMean(
                `Using feature '${ref.rawComponentValue}' was not found in indexed features.`,
                ref.componentKey,
                getIndexedComponentKeys(index)
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

      const usingModel = findLocalUsingModelForReference(documentComposition, ref);
      const impact = usingModel?.impact;
      if (!impact || !usingModel) {
        continue;
      }
      const localImpactKind = impact.kind;
      const crossImpactKind = crossDocumentImpactByUsingKey.get(getUsingKey(ref.componentKey, ref.sectionValue));
      const effectiveImpactKind = this.resolveEffectiveUsingImpactKind(localImpactKind, crossImpactKind);
      if (effectiveImpactKind === "unused") {
        issues.push({
          ruleId: "unused-using",
          range: ref.sectionValueRange ?? ref.componentValueRange,
          message: impact.message ?? `Using '${ref.rawComponentValue}' has no effective impact.`
        });
        continue;
      }

      if (effectiveImpactKind === "partial") {
        issues.push({
          ruleId: "partial-using",
          range: ref.sectionValueRange ?? ref.componentValueRange,
          message: impact.message ?? `Using '${ref.rawComponentValue}' is only partially effective.`
        });
      }

      const usingRange = ref.sectionValueRange ?? ref.componentValueRange;
      this.validateUsingExpectedXPathsForContext(
        index,
        ref.componentKey,
        ref.rawComponentValue,
        usingModel.contributions,
        effectiveItemsCurrentDocument,
        issues,
        usingRange,
        "",
        undefined,
        facts,
        undefined
      );
      this.validateUsingExpectedXPathsForContext(
        index,
        ref.componentKey,
        ref.rawComponentValue,
        usingModel.placeholderContributions,
        effectiveItemsCurrentDocument,
        issues,
        usingRange,
        "",
        undefined,
        facts,
        undefined
      );
      for (const relatedContext of relatedExpectedXPathContexts) {
        const relatedUsingModel = relatedContext.composition.usings.find(
          (item) =>
            item.componentKey === ref.componentKey &&
            (item.sectionValue ?? "") === (ref.sectionValue ?? "")
        );
        if (!relatedUsingModel || !relatedUsingModel.hasResolvedFeature) {
          continue;
        }
        if (relatedUsingModel.impact.kind === "unused") {
          continue;
        }
        this.validateUsingExpectedXPathsForContext(
          index,
          relatedUsingModel.componentKey,
          ref.rawComponentValue,
          relatedUsingModel.contributions,
          relatedContext.items,
          issues,
          usingRange,
          ` (context: ${relatedContext.label})`,
          relatedContext.uri,
          relatedContext.facts,
          relatedContext.text,
          relatedContext.altItems,
          relatedContext.altFacts,
          relatedContext.altText,
          relatedContext.altUri
        );
        this.validateUsingExpectedXPathsForContext(
          index,
          relatedUsingModel.componentKey,
          ref.rawComponentValue,
          relatedUsingModel.placeholderContributions,
          relatedContext.items,
          issues,
          usingRange,
          ` (context: ${relatedContext.label})`,
          relatedContext.uri,
          relatedContext.facts,
          relatedContext.text,
          relatedContext.altItems,
          relatedContext.altFacts,
          relatedContext.altText,
          relatedContext.altUri
        );
      }
    }

    this.validateUsingSuppressionConflicts(facts, index, issues, composedSnapshotRegistry);
    this.validateFormOwnedUsingInheritance(facts, index, issues, composedSnapshotRegistry);
    this.validateMissingUsingParams(facts, index, issues, documentComposition);
    this.validateOrphanPlaceholderReferences(facts, index, issues);
  }

  private validateUsingExpectedXPathsForContext(
    index: WorkspaceIndex,
    componentKey: string,
    rawComponentValue: string,
    contributionModels: ReadonlyArray<DocumentCompositionModel["usings"][number]["contributions"][number]>,
    items: readonly EffectiveCompositionItem[],
    issues: RuleDiagnostic[],
    range: vscode.Range,
    contextSuffix = "",
    contextUri?: vscode.Uri,
    contextFacts?: ReturnType<typeof parseDocumentFacts>,
    contextText?: string,
    altItems?: readonly EffectiveCompositionItem[],
    altContextFacts?: ReturnType<typeof parseDocumentFacts>,
    altContextText?: string,
    altContextUri?: vscode.Uri
  ): void {
    // Single-source policy: expected XPath checks must rely on composed/indexed model
    // (`items` + `facts`) and avoid ad-hoc text rescans/fallback branches.

    for (const contributionModel of contributionModels) {
      if (!contributionModel.rootRelevant && !contributionModel.explicit) {
        continue;
      }
      const contributionName = contributionModel.contribution.contributionName;
      const component = resolveComponentByKey(index, componentKey);
      const contributionLocation = component?.contributionDefinitions.get(contributionName);
      const relatedInfo = contributionLocation
        ? [{ location: contributionLocation, message: `Contribution '${contributionName}' in feature '${rawComponentValue}'` }]
        : contextUri
          ? [{ location: new vscode.Location(contextUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))), message: "Context document" }]
          : undefined;
      const contributionTargetXPath = (contributionModel.contribution.targetXPath ?? "").trim();
      const contributionInsert = (contributionModel.contribution.insert ?? "").trim().toLowerCase();
      const insertOptional = contributionModel.contribution.isInsertOptional === true;
      const isRelatedContext = contextSuffix.length > 0;
      const contextRoot = normalizeRootTagName(contextFacts?.rootTag);
      const targetRoot = detectTopLevelXPathRoot(contributionTargetXPath);
      if (targetRoot && contextRoot && targetRoot !== contextRoot) {
        // This contribution is expected to apply in another document root context
        // (e.g. Form-owned feature contribution targeting //WorkFlow/...).
        // It will be validated through related context passes.
        continue;
      }
      if (!insertOptional && contributionInsert === "placeholder") {
        if (isRelatedContext) {
          continue;
        }
        const placeholderUsed = contributionModel.insertCount > 0;
        if (!placeholderUsed) {
          issues.push({
            ruleId: "missing-feature-expected-xpath",
            range,
            message:
              `Using '${rawComponentValue}' contribution '${contributionName}' requires at least one placeholder/include usage, ` +
              `but none was found${contextSuffix}.`,
            relatedInformation: relatedInfo
          });
          continue;
        }
      }
      if (!insertOptional && contributionTargetXPath.length > 0 && contributionInsert !== "placeholder") {
        const trace = contributionModel.insertTrace;
        const matchedInContextItems = matchesExpectedXPathInEffectiveModel(contributionTargetXPath, items);
        const matchedInContextFacts = contextFacts ? matchesExpectedXPathInDocumentFacts(contributionTargetXPath, contextFacts) : false;
        const matchedInAltContextItems = altItems
          ? matchesExpectedXPathInEffectiveModel(contributionTargetXPath, altItems)
          : false;
        const matchedInAltContextFacts = altContextFacts
          ? matchesExpectedXPathInDocumentFacts(contributionTargetXPath, altContextFacts)
          : false;
        const targetMatched = trace
          ? trace.strategy !== "targetXPath" ||
            trace.targetXPathMatchCount > 0 ||
            matchedInContextItems ||
            matchedInContextFacts ||
            matchedInAltContextItems ||
            matchedInAltContextFacts
          : contributionModel.insertCount > 0 ||
            matchedInContextItems ||
            matchedInContextFacts ||
            matchedInAltContextItems ||
            matchedInAltContextFacts;
        if (!targetMatched) {
          issues.push({
            ruleId: "missing-feature-expected-xpath",
            range,
            message:
              `Using '${rawComponentValue}' contribution '${contributionName}' requires existing target XPath ` +
              `'${contributionTargetXPath}' which was not found${contextSuffix}.`,
            relatedInformation: relatedInfo
          });
          continue;
        }
      }

      const expectedXPaths = [...(contributionModel.contribution.expectsXPath ?? [])];
      if (expectedXPaths.length === 0) {
        continue;
      }
      for (const expectedXPath of expectedXPaths) {
        if (insertOptional) {
          continue;
        }
        const expectedRoot = detectTopLevelXPathRoot(expectedXPath);
        if (expectedRoot && contextRoot && expectedRoot !== contextRoot) {
          continue;
        }
        if (contributionTargetXPath.length > 0 && expectedXPath.trim() === contributionTargetXPath) {
          continue;
        }
        if (
          matchesExpectedXPathInEffectiveModel(expectedXPath, items) ||
          (contextFacts ? matchesExpectedXPathInDocumentFacts(expectedXPath, contextFacts) : false) ||
          (altItems ? matchesExpectedXPathInEffectiveModel(expectedXPath, altItems) : false) ||
          (altContextFacts ? matchesExpectedXPathInDocumentFacts(expectedXPath, altContextFacts) : false)
        ) {
          continue;
        }
        issues.push({
          ruleId: "missing-feature-expected-xpath",
          range,
          message:
            `Using '${rawComponentValue}' contribution '${contributionName}' requires XPath '${expectedXPath}' ` +
            `which is not satisfied by effective composition${contextSuffix}.`,
          relatedInformation: relatedInfo
        });
      }
    }
  }

  private collectRelatedExpectedXPathContextsForForm(
    documentUri: vscode.Uri,
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    composedSnapshotRegistry?: ComposedDocumentSnapshotRegistry
  ): Array<{
    label: string;
    uri: vscode.Uri;
    composition: DocumentCompositionModel;
    items: EffectiveCompositionItem[];
    facts: ReturnType<typeof parseDocumentFacts>;
    text?: string;
    altUri?: vscode.Uri;
    altItems?: EffectiveCompositionItem[];
    altFacts?: ReturnType<typeof parseDocumentFacts>;
    altText?: string;
  }> {
    if (composedSnapshotRegistry) {
      const snapshotContexts = this.collectRelatedExpectedXPathContextsForFormFromSnapshots(
        documentUri,
        facts,
        index,
        composedSnapshotRegistry
      );
      if (snapshotContexts.length > 0) {
        return snapshotContexts;
      }
    }

    const out: Array<{
      label: string;
      uri: vscode.Uri;
      composition: DocumentCompositionModel;
      items: EffectiveCompositionItem[];
      facts: ReturnType<typeof parseDocumentFacts>;
      text?: string;
      altUri?: vscode.Uri;
      altItems?: EffectiveCompositionItem[];
      altFacts?: ReturnType<typeof parseDocumentFacts>;
      altText?: string;
    }> = [];
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "form" || !facts.formIdent) {
      return out;
    }
    const currentDir = path.dirname(documentUri.fsPath).replace(/\\/g, "/").toLowerCase();

    for (const entry of getParsedFactsEntries(index, undefined, parseIndexUriKey)) {
      const relatedUri = entry.uri;
      const relatedFacts = entry.facts;
      const relatedRoot = (relatedFacts.rootTag ?? "").toLowerCase();
      if (relatedRoot !== "workflow" && relatedRoot !== "dataview") {
        continue;
      }
      const relatedDir = relatedUri.scheme === "file"
        ? path.dirname(relatedUri.fsPath).replace(/\\/g, "/").toLowerCase()
        : dirnameFromUriKey(relatedUri.toString());
      if (!relatedDir || relatedDir !== currentDir) {
        continue;
      }

      const relatedFormIdent = relatedRoot === "workflow"
        ? (relatedFacts.workflowFormIdent ?? relatedFacts.rootFormIdent)
        : relatedFacts.rootFormIdent;
      if (!relatedFormIdent || relatedFormIdent !== facts.formIdent) {
        continue;
      }

      const composition = buildDocumentCompositionModel(relatedFacts, index);
      let contextUri = relatedUri;
      let contextFacts = relatedFacts;
      let contextText: string | undefined;
      let contextItems = buildEffectiveItemsFromDocumentComposition(composition, relatedFacts);
      let altUri: vscode.Uri | undefined;
      let altFacts: ReturnType<typeof parseDocumentFacts> | undefined;
      let altText: string | undefined;
      let altItems: EffectiveCompositionItem[] | undefined;
      try {
        contextText = fs.readFileSync(relatedUri.fsPath, "utf8");
      } catch {
        contextText = undefined;
      }
      const runtimeUri = templateUriToRuntimeUri(relatedUri);
      if (runtimeUri && fs.existsSync(runtimeUri.fsPath)) {
        try {
          const runtimeText = fs.readFileSync(runtimeUri.fsPath, "utf8");
          // Always prefer runtime text for XPath existence checks, even when
          // structured facts parsing fails for any reason.
          contextUri = runtimeUri;
          contextText = runtimeText;
          const runtimeFacts = parseDocumentFactsFromText(runtimeText);
          const runtimeComposition = buildDocumentCompositionModel(runtimeFacts, index);
          contextItems = buildEffectiveItemsFromDocumentComposition(runtimeComposition, runtimeFacts);
          contextFacts = runtimeFacts;
          altUri = relatedUri;
          altFacts = relatedFacts;
          altItems = buildEffectiveItemsFromDocumentComposition(composition, relatedFacts);
          try {
            altText = fs.readFileSync(relatedUri.fsPath, "utf8");
          } catch {
            altText = undefined;
          }
        } catch {
          // Keep already-populated runtime text context; fallback to template facts/items.
        }
      }
      out.push({
        label: formatUriForMessage(contextUri),
        uri: contextUri,
        composition,
        items: contextItems,
        facts: contextFacts,
        ...(contextText !== undefined ? { text: contextText } : {}),
        ...(altUri !== undefined ? { altUri } : {}),
        ...(altFacts !== undefined ? { altFacts } : {}),
        ...(altItems !== undefined ? { altItems } : {}),
        ...(altText !== undefined ? { altText } : {})
      });
    }

    return out;
  }

  private collectRelatedExpectedXPathContextsForFormFromSnapshots(
    documentUri: vscode.Uri,
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    composedSnapshotRegistry: ComposedDocumentSnapshotRegistry
  ): Array<{
    label: string;
    uri: vscode.Uri;
    composition: DocumentCompositionModel;
    items: EffectiveCompositionItem[];
    facts: ReturnType<typeof parseDocumentFacts>;
    text?: string;
    altUri?: vscode.Uri;
    altItems?: EffectiveCompositionItem[];
    altFacts?: ReturnType<typeof parseDocumentFacts>;
    altText?: string;
  }> {
    const out: Array<{
      label: string;
      uri: vscode.Uri;
      composition: DocumentCompositionModel;
      items: EffectiveCompositionItem[];
      facts: ReturnType<typeof parseDocumentFacts>;
      text?: string;
      altUri?: vscode.Uri;
      altItems?: EffectiveCompositionItem[];
      altFacts?: ReturnType<typeof parseDocumentFacts>;
      altText?: string;
    }> = [];
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "form" || !facts.formIdent) {
      return out;
    }

    const currentUriKey = documentUri.toString();
    for (const snapshot of composedSnapshotRegistry.getByFormIdent(facts.formIdent)) {
      if (snapshot.uriKey === currentUriKey) {
        continue;
      }
      const sourceRoot = (snapshot.sourceFacts.rootTag ?? "").toLowerCase();
      if (sourceRoot !== "workflow" && sourceRoot !== "dataview") {
        continue;
      }

      const sourceComposition = snapshot.effectiveComposition ?? buildDocumentCompositionModel(snapshot.sourceFacts, index);
      const contextUri = snapshot.uri;
      const contextFacts = snapshot.sourceFacts;
      const contextItems = buildEffectiveItemsFromDocumentComposition(sourceComposition, snapshot.sourceFacts);
      const contextText = this.tryReadFileText(snapshot.uri);

      out.push({
        label: formatUriForMessage(contextUri),
        uri: contextUri,
        composition: sourceComposition,
        items: contextItems,
        facts: contextFacts,
        ...(contextText !== undefined ? { text: contextText } : {})
      });
    }

    return out;
  }

  private collectCrossDocumentUsingImpactByKeyFromSnapshots(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    composedSnapshotRegistry: ComposedDocumentSnapshotRegistry
  ): Map<string, "effective" | "partial" | "unused"> {
    const out = new Map<string, "effective" | "partial" | "unused">();
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "form" || !facts.formIdent) {
      return out;
    }

    for (const snapshot of composedSnapshotRegistry.getByFormIdent(facts.formIdent)) {
      const relatedRoot = (snapshot.sourceFacts.rootTag ?? "").toLowerCase();
      if (relatedRoot !== "workflow" && relatedRoot !== "dataview") {
        continue;
      }

      const relatedComposition = snapshot.effectiveComposition ?? buildDocumentCompositionModel(snapshot.sourceFacts, index);
      for (const usingModel of relatedComposition.usings) {
        const key = getUsingKey(usingModel.componentKey, usingModel.sectionValue);
        const relatedKind = usingModel.impact.kind;
        const previous = out.get(key);
        out.set(key, this.resolveEffectiveUsingImpactKind(previous, relatedKind));
      }
    }

    return out;
  }

  private tryReadFileText(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== "file") {
      return undefined;
    }
    try {
      return fs.readFileSync(uri.fsPath, "utf8");
    } catch {
      return undefined;
    }
  }

  private collectCrossDocumentUsingImpactByKey(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    composedSnapshotRegistry?: ComposedDocumentSnapshotRegistry
  ): Map<string, "effective" | "partial" | "unused"> {
    if (composedSnapshotRegistry) {
      const snapshotImpact = this.collectCrossDocumentUsingImpactByKeyFromSnapshots(
        facts,
        index,
        composedSnapshotRegistry
      );
      if (snapshotImpact.size > 0) {
        return snapshotImpact;
      }
    }

    const out = new Map<string, "effective" | "partial" | "unused">();
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "form" || !facts.formIdent) {
      return out;
    }

    for (const entry of getParsedFactsEntries(index, undefined, parseIndexUriKey)) {
      const relatedFacts = entry.facts;
      const relatedRoot = (relatedFacts.rootTag ?? "").toLowerCase();
      if (relatedRoot !== "workflow" && relatedRoot !== "dataview") {
        continue;
      }

      const relatedFormIdent = relatedRoot === "workflow"
        ? (relatedFacts.workflowFormIdent ?? relatedFacts.rootFormIdent)
        : relatedFacts.rootFormIdent;
      if (!relatedFormIdent || relatedFormIdent !== facts.formIdent) {
        continue;
      }

      const relatedComposition = buildDocumentCompositionModel(relatedFacts, index);
      for (const usingModel of relatedComposition.usings) {
        const key = getUsingKey(usingModel.componentKey, usingModel.sectionValue);
        const relatedKind = usingModel.impact.kind;
        const previous = out.get(key);
        out.set(key, this.resolveEffectiveUsingImpactKind(previous, relatedKind));
      }
    }

    return out;
  }

  private resolveEffectiveUsingImpactKind(
    localKind: "effective" | "partial" | "unused" | undefined,
    relatedKind: "effective" | "partial" | "unused" | undefined
  ): "effective" | "partial" | "unused" {
    const rank = (kind: "effective" | "partial" | "unused" | undefined): number => {
      if (kind === "effective") {
        return 3;
      }
      if (kind === "partial") {
        return 2;
      }
      return 1;
    };

    return rank(localKind) >= rank(relatedKind) ? (localKind ?? "unused") : (relatedKind ?? "unused");
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

  private validateOrphanPlaceholderReferences(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[]
  ): void {
    if (facts.placeholderReferences.length === 0) {
      return;
    }

    const rootTag = facts.rootTag;
    const activePlaceholderContributionKeys = new Set<string>();
    const activePlaceholderFeatureKeys = new Set<string>();

    for (const usingRef of collectEffectiveUsingRefs(facts, index)) {
      const component = resolveComponentByKey(index, usingRef.componentKey);
      if (!component) {
        continue;
      }

      const candidateContributions = usingRef.sectionValue
        ? [component.contributionSummaries.get(usingRef.sectionValue)].filter(
            (item): item is import("../indexer/types").IndexedComponentContributionSummary => !!item
          )
        : [...component.contributionSummaries.values()];
      for (const contribution of candidateContributions) {
        if ((contribution.insert ?? "").toLowerCase() !== "placeholder") {
          continue;
        }
        if (!contributionMatchesDocumentRoot(rootTag, contribution)) {
          continue;
        }
        activePlaceholderFeatureKeys.add(component.key);
        activePlaceholderContributionKeys.add(getUsingKey(component.key, contribution.contributionName));
      }
    }

    for (const placeholderRef of facts.placeholderReferences) {
      if (!placeholderRef.componentKey) {
        continue;
      }

      const component = resolveComponentByKey(index, placeholderRef.componentKey);
      if (!component) {
        continue;
      }

      const placeholderContributions = [...component.contributionSummaries.values()].filter(
        (item) => (item.insert ?? "").toLowerCase() === "placeholder"
      );
      if (placeholderContributions.length === 0) {
        continue;
      }

      const contributionName = placeholderRef.contributionValue?.trim();
      const isActive = contributionName
        ? activePlaceholderContributionKeys.has(getUsingKey(component.key, contributionName))
        : activePlaceholderFeatureKeys.has(component.key);
      if (isActive) {
        continue;
      }

      const scopedLabel = contributionName
        ? `${placeholderRef.rawComponentValue ?? component.key}#${contributionName}`
        : (placeholderRef.rawComponentValue ?? component.key);
      issues.push({
        ruleId: "orphan-placeholder",
        range: placeholderRef.range,
        message: `Placeholder '${scopedLabel}' has no active Using namespace in current document.`
      });
    }
  }

  private validateUsingSuppressionConflicts(
    facts: ReturnType<typeof parseDocumentFacts>,
    index: WorkspaceIndex,
    issues: RuleDiagnostic[],
    composedSnapshotRegistry?: ComposedDocumentSnapshotRegistry
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
    const form = getIndexedFormByIdent(index, owningFormIdent);
    const formFacts = form ? getFactsForUri(index, form.uri, composedSnapshotRegistry) : undefined;
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
    issues: RuleDiagnostic[],
    composedSnapshotRegistry?: ComposedDocumentSnapshotRegistry
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

    const form = getIndexedFormByIdent(index, owningFormIdent);
    if (!form) {
      return;
    }

    const formFacts = getFactsForUri(index, form.uri, composedSnapshotRegistry);
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

    const formCandidates = getIndexedForms(index).map((f) => f.ident);
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
      const parsedCandidates = parseLookupControlIdentCandidates(control.ident, targetCandidates);
      if (parsedCandidates.length === 0) {
        issues.push({
          ruleId: "ident-convention-lookup-control",
          range: control.range,
          message: `Lookup control Ident '${control.ident}' should follow [Purpose][FormOrTable][ForeignKey]. ${splitInfo}`
        });
        continue;
      }

      const validCandidate = parsedCandidates.find((candidate) => {
        if (isLookupMulti && !candidate.foreignKey.toLowerCase().endsWith("s")) {
          return false;
        }
        return isLookupCandidateSemanticallyValid(candidate, isLookupMulti, index, metadata);
      });
      if (validCandidate) {
        continue;
      }

      if (isLookupMulti && !parsedCandidates.some((candidate) => candidate.foreignKey.toLowerCase().endsWith("s"))) {
        issues.push({
          ruleId: "ident-convention-lookup-control",
          range: control.range,
          message: `Multi-select lookup '${control.ident}' should use plural foreign key suffix ending with 's'.`
        });
        continue;
      }

      const parsed = parsedCandidates[0];
      if (parsed.targetKind === "system") {
        issues.push({
          ruleId: "ident-convention-lookup-control",
          range: control.range,
          message: `System table lookup '${control.ident}' should use known system-table column (default 'ID'/'Ident' or configured external columns). ${splitInfo}`
        });
        continue;
      }

      issues.push({
        ruleId: "ident-convention-lookup-control",
        range: control.range,
        message: `Lookup control '${control.ident}' references '${parsed.targetName}', but foreign key '${parsed.foreignKey}' is not a known control/default column. ${splitInfo}`
      });
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
    featureRegistry: FeatureManifestRegistry | undefined,
    maskedText?: string
  ): void {
    const root = (facts.rootTag ?? "").toLowerCase();
    const relPath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    const isFeatureFile = relPath.toLowerCase().endsWith(".feature.xml");
    const isComponentFile = relPath.toLowerCase().endsWith(".component.xml");
    if (root !== "feature" && root !== "component" && !isFeatureFile && !isComponentFile) {
      return;
    }

    const text = maskedText ?? document.getText();
    this.validateMissingExplicitProvides(text, document, issues);

    if (!featureRegistry) {
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

  private validateMissingExplicitProvides(
    text: string,
    document: vscode.TextDocument,
    issues: RuleDiagnostic[]
  ): void {
    const contributionRanges = collectFeatureContributionRanges(text, document);
    const contributionBlocks = collectFeatureContributionBlocks(text, document);
    const contractProvides = collectManifestContributionContractProvides(text);
    for (const [key, block] of contributionBlocks.entries()) {
      if (block.hasProvidesBlock) {
        continue;
      }
      const manifestProvidesCount = contractProvides.get(key) ?? 0;
      if (manifestProvidesCount > 0) {
        continue;
      }
      if (!containsImplicitProvidedSymbol(block.content)) {
        continue;
      }
      const range =
        contributionRanges.get(key) ??
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      issues.push({
        ruleId: "missing-explicit-provides",
        range,
        message: `Contribution '${block.name ?? key}' contains symbol-like XML with Ident, but has no explicit <Provides>.`
      });
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

interface FeatureContributionBlock {
  name?: string;
  content: string;
  hasProvidesBlock: boolean;
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
    const tagName = match[1] ?? "Contribution";
    const tagStart = match.index ?? 0;
    const tagRange = new vscode.Range(document.positionAt(tagStart), document.positionAt(tagStart + tagName.length + 1));
    const name = getAttributeCaseInsensitiveXml(attrs, "Name");
    if (name?.value) {
      out.set(name.value.toLowerCase(), tagRange);
      continue;
    }

    out.set(
      tagName.toLowerCase(),
      tagRange
    );
  }

  return out;
}

function collectFeatureContributionBlocks(
  text: string,
  document: vscode.TextDocument
): Map<string, FeatureContributionBlock> {
  const out = new Map<string, FeatureContributionBlock>();
  const contributionRegex = /<\s*(Contribution|Section)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\s*\1\s*>)/gi;

  for (const match of text.matchAll(contributionRegex)) {
    const rawAttrs = match[2] ?? "";
    const body = match[3] ?? "";
    const attrsOffset = (match[0] ?? "").indexOf(rawAttrs);
    const attrsStart = (match.index ?? 0) + (attrsOffset >= 0 ? attrsOffset : 0);
    const attrs = parseFeatureXmlAttributes(rawAttrs, text, attrsStart, document);
    const name = getAttributeCaseInsensitiveXml(attrs, "Name")?.value;
    if (!name) {
      continue;
    }

    out.set(name.toLowerCase(), {
      name,
      content: body,
      hasProvidesBlock: /<\s*Provides\b/i.test(body)
    });
  }

  return out;
}

function containsImplicitProvidedSymbol(content: string): boolean {
  return /<(Control|Button|Section|ActionShareCode|ButtonShareCode|ControlShareCode|Column|Component|DataSource|dsp:Parameter)\b[^>]*\bIdent\s*=\s*(?:"[^"]*"|'[^']*')/i.test(
    content
  );
}

function collectManifestContributionContractProvides(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const manifestMatch = /<\s*Manifest\b[^>]*>([\s\S]*?)<\/\s*Manifest\s*>/i.exec(text);
  if (!manifestMatch) {
    return out;
  }
  const body = manifestMatch[1] ?? "";
  const contractRegex = /<\s*ContributionContract\b([^>]*?)>([\s\S]*?)<\/\s*ContributionContract\s*>/gi;
  for (const match of body.matchAll(contractRegex)) {
    const attrsRaw = match[1] ?? "";
    const contractBody = match[2] ?? "";
    const attrs = parseXmlAttributesLoose(attrsRaw);
    const name = attrs.get("for") ?? attrs.get("name") ?? attrs.get("id");
    if (!name) {
      continue;
    }
    const symbolCount = [...contractBody.matchAll(/<\s*Symbol\b[^>]*\/>/gi)].length;
    const key = name.toLowerCase();
    const current = out.get(key) ?? 0;
    out.set(key, Math.max(current, symbolCount));
  }
  return out;
}

function parseXmlAttributesLoose(raw: string): Map<string, string> {
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

interface LegacyAliasFlags {
  legacyFeatureAliasUsed: boolean;
  legacyContributionAliasUsed: boolean;
}

function collectIncludeLegacyAliasFlags(text: string): LegacyAliasFlags[] {
  const out: LegacyAliasFlags[] = [];
  for (const match of text.matchAll(/<Include\b([^>]*)\/?>/gi)) {
    const attrsRaw = match[1] ?? "";
    const legacyFeatureAliasUsed = hasXmlAttributeName(attrsRaw, "Component") || hasXmlAttributeName(attrsRaw, "Name");
    const legacyContributionAliasUsed = hasXmlAttributeName(attrsRaw, "Section");
    out.push({ legacyFeatureAliasUsed, legacyContributionAliasUsed });
  }
  return out;
}

function collectPlaceholderLegacyAliasFlags(text: string): LegacyAliasFlags[] {
  const out: LegacyAliasFlags[] = [];
  for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const body = (match[1] ?? "").trim();
    const keys = parsePlaceholderKeys(body);
    const hasFeatureLikeKey = keys.has("feature") || keys.has("component") || keys.has("name") || keys.has("primitive");
    const legacyFeatureAliasUsed = hasFeatureLikeKey && (keys.has("component") || keys.has("name"));
    const legacyContributionAliasUsed = hasFeatureLikeKey && keys.has("section");
    out.push({ legacyFeatureAliasUsed, legacyContributionAliasUsed });
  }
  return out;
}

function parsePlaceholderKeys(body: string): Set<string> {
  const out = new Set<string>();
  for (const part of body.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = part.slice(0, idx).trim().toLowerCase();
    if (!key) {
      continue;
    }
    out.add(key);
  }
  return out;
}

function hasXmlAttributeName(rawAttrs: string, attributeName: string): boolean {
  const escaped = escapeRegExp(attributeName);
  const regex = new RegExp(`\\b${escaped}\\s*=`, "i");
  return regex.test(rawAttrs);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  documentComposition: DocumentCompositionModel,
  formIndex: WorkspaceIndex
): Set<string> {
  const out = new Set<string>(form.controls);
  const formEffectiveSymbols = collectFormEffectiveContributionSymbols(form, formIndex);
  for (const ident of formEffectiveSymbols.controlIdents) {
    out.add(ident);
  }
  for (const column of metadata.defaultFormColumns) {
    out.add(column);
  }

  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    if (!contributionMatchesDocumentRoot(facts.rootTag, contributionRef.contribution)) {
      continue;
    }
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
  documentComposition: DocumentCompositionModel,
  formIndex: WorkspaceIndex
): Set<string> {
  const out = new Set<string>(form.buttons);
  const formEffectiveSymbols = collectFormEffectiveContributionSymbols(form, formIndex);
  for (const ident of formEffectiveSymbols.buttonIdents) {
    out.add(ident);
  }
  for (const contributionRef of collectSelectedDocumentContributions(documentComposition)) {
    if (!contributionMatchesDocumentRoot(facts.rootTag, contributionRef.contribution)) {
      continue;
    }
    for (const ident of contributionRef.contribution.formButtonIdents) {
      out.add(ident);
    }
  }

  return out;
}

function normalizeUriKeyToComparablePath(uriKey: string): string {
  const normalized = uriKey.replace(/\\/g, "/");
  if (!normalized.toLowerCase().startsWith("file://")) {
    return normalized.toLowerCase();
  }
  const withoutScheme = normalized.slice("file://".length);
  let decoded = withoutScheme;
  try {
    decoded = decodeURIComponent(withoutScheme);
  } catch {
    decoded = withoutScheme;
  }
  return decoded.replace(/^\/([A-Za-z]:)/, "$1").toLowerCase();
}

function dirnameFromUriKey(uriKey: string): string | undefined {
  const path = normalizeUriKeyToComparablePath(uriKey);
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) {
    return undefined;
  }
  return path.slice(0, lastSlash);
}

function uriFromUriKey(uriKey: string): vscode.Uri | undefined {
  const normalized = uriKey.replace(/\\/g, "/");
  if (/^file:\/\//i.test(normalized)) {
    let withoutScheme = normalized.slice("file://".length);
    try {
      withoutScheme = decodeURIComponent(withoutScheme);
    } catch {
      // keep as-is
    }
    const fsPath = withoutScheme.replace(/^\/([A-Za-z]:)/, "$1");
    return vscode.Uri.file(fsPath);
  }
  try {
    return vscode.Uri.file(normalized);
  } catch {
    return undefined;
  }
}

function templateUriToRuntimeUri(uri: vscode.Uri): vscode.Uri | undefined {
  const fsPath = uri.fsPath;
  if (!/[\\/]XML_Templates([\\/])/i.test(fsPath)) {
    return undefined;
  }
  return vscode.Uri.file(fsPath.replace(/[\\/]XML_Templates([\\/])/i, `${path.sep}XML$1`));
}

function formatUriForMessage(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
  if (rel && rel !== uri.fsPath) {
    return rel;
  }
  return uri.fsPath.replace(/\\/g, "/");
}


function getFactsForUri(
  index: WorkspaceIndex,
  uri: vscode.Uri,
  composedSnapshotRegistry?: ComposedDocumentSnapshotRegistry
): ReturnType<typeof parseDocumentFacts> | undefined {
  return composedSnapshotRegistry?.get(uri)?.sourceFacts ?? getParsedFactsByUri(index, uri);
}

function collectFormEffectiveContributionSymbols(
  form: import("../indexer/types").IndexedForm,
  index: WorkspaceIndex
): { controlIdents: Set<string>; buttonIdents: Set<string> } {
  const controlIdents = new Set<string>();
  const buttonIdents = new Set<string>();
  const formFacts = getFactsForUri(index, form.uri);
  if (!formFacts) {
    return { controlIdents, buttonIdents };
  }

  const formComposition = buildDocumentCompositionModel(formFacts, index);
  for (const contributionRef of collectSelectedDocumentContributions(formComposition)) {
    if (!contributionMatchesDocumentRoot("Form", contributionRef.contribution)) {
      continue;
    }
    for (const ident of contributionRef.contribution.formControlIdents) {
      controlIdents.add(ident);
    }
    for (const ident of contributionRef.contribution.formButtonIdents) {
      buttonIdents.add(ident);
    }
  }

  return { controlIdents, buttonIdents };
}

function endsWithExact(value: string, suffix: string): boolean {
  return value.endsWith(suffix);
}

type LookupIdentParseCandidate = {
  targetName: string;
  targetKind: "form" | "system";
  foreignKey: string;
  score: number;
};

function parseLookupControlIdentCandidates(
  ident: string,
  candidates: Array<{ name: string; kind: "form" | "system" }>
): LookupIdentParseCandidate[] {
  const out: LookupIdentParseCandidate[] = [];
  for (const candidate of candidates) {
    const idx = ident.lastIndexOf(candidate.name);
    if (idx < 0) {
      continue;
    }

    const foreignKey = ident.slice(idx + candidate.name.length);
    if (!foreignKey) {
      continue;
    }

    out.push({
      targetName: candidate.name,
      targetKind: candidate.kind,
      foreignKey,
      score: candidate.name.length
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

function isLookupCandidateSemanticallyValid(
  parsed: LookupIdentParseCandidate,
  isLookupMulti: boolean,
  index: WorkspaceIndex,
  metadata: SystemMetadata
): boolean {
  const normalizedForeignKey = isLookupMulti
    ? trimTrailingPluralS(parsed.foreignKey)
    : parsed.foreignKey;

  if (parsed.targetKind === "system") {
    return isKnownSystemTableForeignKey(metadata, parsed.targetName, normalizedForeignKey);
  }

  const targetForm = getIndexedFormByIdent(index, parsed.targetName);
  if (!targetForm) {
    return false;
  }

  const fk = normalizedForeignKey;
  const isKnownControl = targetForm.controls.has(fk);
  const isDefaultColumn = metadata.defaultFormColumns.has(fk);
  const isPreferredSuffix = metadata.preferredForeignKeySuffixes.some((suffix) => endsWithExact(fk, suffix));
  return isKnownControl || isDefaultColumn || isPreferredSuffix;
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
  const parsedCandidates = parseLookupControlIdentCandidates(ident, candidates);
  const parsed = parsedCandidates[0];
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

function buildEffectiveItemsFromDocumentComposition(
  composition: DocumentCompositionModel,
  facts: ReturnType<typeof parseDocumentFacts>
): EffectiveCompositionItem[] {
  const itemsByKey = new Map<string, EffectiveCompositionItem>();
  const upsert = (kind: FeatureSymbolKind, ident: string, presence: "local" | "injected" = "injected"): void => {
    const key = `${kind}:${ident}`;
    const existing = itemsByKey.get(key);
    if (existing) {
      if (existing.presence !== "local" && presence === "local") {
        existing.presence = "local";
      }
      return;
    }
    itemsByKey.set(key, {
      key,
      kind,
      ident,
      contexts: [],
      presence,
      usage: "applied",
      origins: [],
      notes: []
    });
  };

  // Seed with symbols declared directly in the parsed document (runtime/template facts).
  for (const ident of facts.declaredControls) {
    upsert("control", ident, "local");
  }
  for (const ident of facts.declaredButtons) {
    upsert("button", ident, "local");
  }
  for (const ident of facts.declaredSections) {
    upsert("section", ident, "local");
  }
  for (const ident of facts.declaredActionShareCodes) {
    upsert("actionShareCode", ident, "local");
  }
  for (const ident of facts.declaredControlShareCodes) {
    upsert("controlShareCode", ident, "local");
  }
  for (const ident of facts.declaredButtonShareCodes) {
    upsert("buttonShareCode", ident, "local");
  }

  for (const contributionRef of collectSelectedDocumentContributions(composition)) {
    for (const ident of contributionRef.contribution.formControlIdents) {
      upsert("control", ident, "injected");
    }
    for (const ident of contributionRef.contribution.formButtonIdents) {
      upsert("button", ident, "injected");
    }
    for (const ident of contributionRef.contribution.formSectionIdents) {
      upsert("section", ident, "injected");
    }
    for (const ident of contributionRef.contribution.workflowActionShareCodeIdents) {
      upsert("actionShareCode", ident, "injected");
    }
    for (const ident of contributionRef.contribution.workflowControlShareCodeIdents) {
      upsert("controlShareCode", ident, "injected");
    }
    for (const ident of contributionRef.contribution.workflowButtonShareCodeIdents) {
      upsert("buttonShareCode", ident, "injected");
    }
  }

  return [...itemsByKey.values()];
}

function matchesExpectedXPathInDocumentFacts(
  xpath: string,
  facts: ReturnType<typeof parseDocumentFacts>
): boolean {
  const normalized = xpath.trim();
  if (!normalized) {
    return true;
  }

  const identMatches = [...normalized.matchAll(/\/([A-Za-z_:][\w:.-]*)\s*\[\s*@Ident\s*=\s*(['"])(.*?)\2\s*\]/gi)];
  if (identMatches.length === 0) {
    return false;
  }

  for (const identMatch of identMatches) {
    const elementName = (identMatch[1] ?? "").replace(/^.*:/, "");
    const ident = identMatch[3] ?? "";
    if (!ident) {
      continue;
    }

    switch (elementName.toLowerCase()) {
      case "control":
      case "formcontrol":
        if (facts.declaredControls.has(ident)) {
          return true;
        }
        break;
      case "button":
        if (facts.declaredButtons.has(ident)) {
          return true;
        }
        break;
      case "section":
        if (facts.declaredSections.has(ident)) {
          return true;
        }
        break;
      case "controlsharecode":
        if (facts.declaredControlShareCodes.has(ident)) {
          return true;
        }
        break;
      case "actionsharecode":
        if (facts.declaredActionShareCodes.has(ident)) {
          return true;
        }
        break;
      case "buttonsharecode":
        if (facts.declaredButtonShareCodes.has(ident)) {
          return true;
        }
        break;
      default:
        break;
    }
  }

  return false;
}

function normalizeRootTagName(rootTag: string | undefined): "form" | "workflow" | "dataview" | "filter" | undefined {
  const value = (rootTag ?? "").trim().toLowerCase();
  if (value === "form" || value === "workflow" || value === "dataview" || value === "filter") {
    return value;
  }
  return undefined;
}

function detectTopLevelXPathRoot(xpathExpression: string | undefined): "form" | "workflow" | "dataview" | "filter" | undefined {
  const xpath = (xpathExpression ?? "").trim();
  if (!xpath) {
    return undefined;
  }
  const absoluteMatch = /^\/{1,2}\s*([A-Za-z_][\w:-]*)/.exec(xpath);
  if (!absoluteMatch) {
    return undefined;
  }
  return normalizeRootTagName(absoluteMatch[1]);
}

function normalizeFeatureLikeKey(value: string | undefined): string {
  const raw = (value ?? "").trim().replace(/\\/g, "/").toLowerCase();
  if (!raw) {
    return "";
  }
  return raw.replace(/\.(feature|component)\.xml$/i, "").replace(/\.xml$/i, "");
}

function hasPlaceholderOrIncludeUsageForContribution(
  componentKey: string,
  rawComponentValue: string,
  contributionName: string,
  text: string | undefined
): boolean {
  if (!text) {
    return false;
  }

  const expectedKey = normalizeFeatureLikeKey(componentKey);
  const expectedRaw = normalizeFeatureLikeKey(rawComponentValue);
  const expectedSection = (contributionName ?? "").trim().toLowerCase();
  const scanText = text.replace(/<!--[\s\S]*?-->/g, "");

  for (const match of scanText.matchAll(/<Include\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const featureValue = extractXmlAttribute(attrs, "Feature") ?? extractXmlAttribute(attrs, "Component");
    const sectionValue = extractXmlAttribute(attrs, "Section");
    const featureKey = normalizeFeatureLikeKey(featureValue);
    if (!featureKey || !sectionValue) {
      continue;
    }
    if ((featureKey === expectedKey || featureKey === expectedRaw) && sectionValue.trim().toLowerCase() === expectedSection) {
      return true;
    }
  }

  for (const match of scanText.matchAll(/\{\{\s*(?:Feature|Component)\s*:\s*([^,}]+)\s*,\s*Section\s*:\s*([^}]+)\}\}/gi)) {
    const featureKey = normalizeFeatureLikeKey(match[1] ?? "");
    const sectionValue = (match[2] ?? "").trim().toLowerCase();
    if ((featureKey === expectedKey || featureKey === expectedRaw) && sectionValue === expectedSection) {
      return true;
    }
  }

  return false;
}

