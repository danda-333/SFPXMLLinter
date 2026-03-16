import type { ParsedDocumentFacts, UsingContributionInsertTrace, UsingReference } from "../indexer/xmlFacts";
import type { WorkspaceIndex, IndexedComponentContributionSummary } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import * as vscode from "vscode";
import {
  contributionMatchesDocumentRoot,
  evaluateUsingImpactFromContributions,
  getUsingContributionInsertTrace,
  type UsingImpactSummary,
  selectUsingContributions
} from "./usingImpact";
import { collectEffectiveUsingRefs } from "../utils/effectiveUsings";

export interface DocumentUsingContributionModel {
  contribution: IndexedComponentContributionSummary;
  rootRelevant: boolean;
  explicit: boolean;
  insertTrace?: UsingContributionInsertTrace;
  insertCount: number;
  usage: "effective" | "unused";
}

export interface DocumentUsingModel {
  componentKey: string;
  rawComponentValue: string;
  source: "local" | "inherited";
  sectionValue?: string;
  impact: UsingImpactSummary;
  impactStatus: "effective" | "partial" | "unused" | "inert";
  contributions: DocumentUsingContributionModel[];
  filteredContributions: DocumentUsingContributionModel[];
  placeholderContributions: DocumentUsingContributionModel[];
  filteredPlaceholderContributions: DocumentUsingContributionModel[];
  hasResolvedFeature: boolean;
}

export interface DocumentCompositionModel {
  usings: DocumentUsingModel[];
}

export interface EffectiveDocumentContributionRef {
  componentKey: string;
  rawComponentValue: string;
  source: "local" | "inherited";
  sectionValue?: string;
  contribution: IndexedComponentContributionSummary;
}

export interface DocumentInjectedSymbolSource {
  source: string;
  resourceUri?: vscode.Uri;
  sourceLocation?: vscode.Location;
}

export function findLocalUsingModelForReference(
  model: DocumentCompositionModel,
  ref: Pick<UsingReference, "componentKey" | "sectionValue">
): DocumentUsingModel | undefined {
  return model.usings.find(
    (item) =>
      item.source === "local" &&
      item.componentKey === ref.componentKey &&
      (item.sectionValue ?? "") === (ref.sectionValue ?? "")
  );
}

export function collectInjectedSymbols(
  model: DocumentCompositionModel,
  index: WorkspaceIndex,
  selector: (contribution: IndexedComponentContributionSummary) => ReadonlySet<string>
): Map<string, DocumentInjectedSymbolSource> {
  const injected = new Map<string, DocumentInjectedSymbolSource>();

  for (const usingModel of model.usings) {
    if (!usingModel.hasResolvedFeature) {
      continue;
    }

    const component = resolveComponentByKey(index, usingModel.componentKey);
    if (!component) {
      continue;
    }

    const sourceLabel = usingModel.sectionValue
      ? `${usingModel.rawComponentValue}#${usingModel.sectionValue}`
      : usingModel.rawComponentValue;
    for (const contributionModel of usingModel.contributions) {
      const contribution = contributionModel.contribution;
      const sourceLocation = component.contributionDefinitions.get(contribution.contributionName);
      for (const ident of selector(contribution)) {
        if (!injected.has(ident)) {
          injected.set(ident, {
            source: sourceLabel,
            resourceUri: component.uri,
            ...(sourceLocation ? { sourceLocation } : {})
          });
        }
      }
    }
  }

  return injected;
}

export function collectEffectiveDocumentContributions(
  model: DocumentCompositionModel
): EffectiveDocumentContributionRef[] {
  const out: EffectiveDocumentContributionRef[] = [];
  for (const usingModel of model.usings) {
    if (!usingModel.hasResolvedFeature) {
      continue;
    }

    for (const contributionModel of usingModel.contributions) {
      if (contributionModel.usage !== "effective") {
        continue;
      }

      out.push({
        componentKey: usingModel.componentKey,
        rawComponentValue: usingModel.rawComponentValue,
        source: usingModel.source,
        ...(usingModel.sectionValue ? { sectionValue: usingModel.sectionValue } : {}),
        contribution: contributionModel.contribution
      });
    }
  }

  return out;
}

export function collectSelectedDocumentContributions(
  model: DocumentCompositionModel
): EffectiveDocumentContributionRef[] {
  const out: EffectiveDocumentContributionRef[] = [];
  for (const usingModel of model.usings) {
    if (!usingModel.hasResolvedFeature) {
      continue;
    }

    for (const contributionModel of usingModel.contributions) {
      out.push({
        componentKey: usingModel.componentKey,
        rawComponentValue: usingModel.rawComponentValue,
        source: usingModel.source,
        ...(usingModel.sectionValue ? { sectionValue: usingModel.sectionValue } : {}),
        contribution: contributionModel.contribution
      });
    }
  }

  return out;
}

export function buildDocumentCompositionModel(
  facts: ParsedDocumentFacts,
  index: WorkspaceIndex
): DocumentCompositionModel {
  const usings: DocumentUsingModel[] = [];

  for (const usingRef of collectEffectiveUsingRefs(facts, index)) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      usings.push({
        componentKey: usingRef.componentKey,
        rawComponentValue: usingRef.rawComponentValue,
        source: usingRef.source,
        ...(usingRef.sectionValue ? { sectionValue: usingRef.sectionValue } : {}),
        impact: {
          kind: "unused",
          message: `Using feature '${usingRef.rawComponentValue}' was not found in indexed features.`,
          relevantCount: 0,
          successfulCount: 0
        },
        impactStatus: "unused",
        contributions: [],
        filteredContributions: [],
        placeholderContributions: [],
        filteredPlaceholderContributions: [],
        hasResolvedFeature: false
      });
      continue;
    }

    const explicit = !!usingRef.sectionValue;
    const allContributions = selectUsingContributions(component);
    const selectedContributions = explicit
      ? selectUsingContributions(component, usingRef.sectionValue)
      : allContributions;
    const selectedPlaceholderContributions = selectedContributions.filter((contribution) => isPlaceholderContribution(contribution));
    const selectedNonPlaceholderContributions = selectedContributions.filter((contribution) => !isPlaceholderContribution(contribution));
    const visibleContributions = explicit
      ? selectedNonPlaceholderContributions
      : selectedNonPlaceholderContributions.filter((contribution) => contributionMatchesDocumentRoot(facts.rootTag, contribution));
    const filteredContributions = explicit
      ? allContributions.filter(
          (contribution) =>
            !selectedContributions.some((selected) => selected.contributionName === contribution.contributionName)
        )
      : selectedNonPlaceholderContributions.filter((contribution) => !contributionMatchesDocumentRoot(facts.rootTag, contribution));
    const filteredPlaceholderContributions = explicit
      ? []
      : selectedPlaceholderContributions.filter((contribution) => !contributionMatchesDocumentRoot(facts.rootTag, contribution));
    const relevantNonPlaceholderContributions = explicit
      ? selectedNonPlaceholderContributions
      : selectedNonPlaceholderContributions.filter((contribution) => contributionMatchesDocumentRoot(facts.rootTag, contribution));
    const impact = evaluateUsingImpactFromContributions(
      facts,
      usingRef.componentKey,
      selectedNonPlaceholderContributions,
      `Using feature '${usingRef.rawComponentValue}'`,
      explicit ? { ignoreRootFilter: true } : undefined
    );
    const inert = usingRef.source === "inherited" && relevantNonPlaceholderContributions.length === 0;
    const impactStatus: "effective" | "partial" | "unused" | "inert" = inert ? "inert" : impact.kind;
    const normalizedImpact: UsingImpactSummary = inert
      ? {
          ...impact,
          message: `Using feature '${usingRef.rawComponentValue}' is inherited but not applicable for root '${facts.rootTag ?? "unknown"}'.`
        }
      : impact;

    usings.push({
      componentKey: usingRef.componentKey,
      rawComponentValue: usingRef.rawComponentValue,
      source: usingRef.source,
      ...(usingRef.sectionValue ? { sectionValue: usingRef.sectionValue } : {}),
      impact: normalizedImpact,
      impactStatus,
      contributions: visibleContributions.map((contribution) =>
        buildUsingContributionModel(facts, usingRef.componentKey, contribution, explicit)
      ),
      filteredContributions: filteredContributions.map((contribution) =>
        buildUsingContributionModel(facts, usingRef.componentKey, contribution, false)
      ),
      placeholderContributions: selectedPlaceholderContributions.map((contribution) =>
        buildUsingContributionModel(facts, usingRef.componentKey, contribution, explicit)
      ),
      filteredPlaceholderContributions: filteredPlaceholderContributions.map((contribution) =>
        buildUsingContributionModel(facts, usingRef.componentKey, contribution, false)
      ),
      hasResolvedFeature: true
    });
  }

  return { usings };
}

function isPlaceholderContribution(contribution: IndexedComponentContributionSummary): boolean {
  return (contribution.insert ?? "").trim().toLowerCase() === "placeholder";
}

function buildUsingContributionModel(
  facts: ParsedDocumentFacts,
  componentKey: string,
  contribution: IndexedComponentContributionSummary,
  explicit: boolean
): DocumentUsingContributionModel {
  const insertTrace = getUsingContributionInsertTrace(facts, componentKey, contribution.contributionName);
  const insertCount = insertTrace?.finalInsertCount ?? 0;
  const rootRelevant = contributionMatchesDocumentRoot(facts.rootTag, contribution);
  const usage: "effective" | "unused" = (explicit || rootRelevant) && insertCount > 0 ? "effective" : "unused";
  return {
    contribution,
    rootRelevant,
    explicit,
    ...(insertTrace ? { insertTrace } : {}),
    insertCount,
    usage
  };
}
