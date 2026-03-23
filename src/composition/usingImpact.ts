import { IndexedComponent, IndexedComponentContributionSummary } from "../indexer/types";
import type { ParsedDocumentFacts } from "../indexer/xmlFacts";
import type { WorkspaceIndex } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { analyzeXPathInsertTargets } from "../template/buildXmlTemplatesCore";
import { collectEffectiveUsingRefs } from "../utils/effectiveUsings";

export interface UsingImpactResult {
  kind: "effective" | "partial" | "unused";
  message?: string;
}

export interface UsingImpactSummary extends UsingImpactResult {
  relevantCount: number;
  successfulCount: number;
}

export function analyzeUsingImpact(
  facts: ParsedDocumentFacts,
  rawComponentValue: string,
  contributionValue: string | undefined,
  component: IndexedComponent,
  usingComponentKey?: string
): UsingImpactResult {
  const selectedContributions = selectRelevantUsingContributions(facts, component, contributionValue);
  return evaluateUsingImpactFromContributions(
    facts,
    usingComponentKey ?? component.key,
    selectedContributions,
    `Using feature '${rawComponentValue}'`
  );
}

export function selectUsingContributions(component: IndexedComponent, contributionName?: string): IndexedComponentContributionSummary[] {
  if (contributionName) {
    const only = component.contributionSummaries.get(contributionName);
    return only ? [only] : [];
  }

  return [...component.contributionSummaries.values()];
}

export function selectRelevantUsingContributions(
  facts: ParsedDocumentFacts,
  component: IndexedComponent,
  contributionName?: string
): IndexedComponentContributionSummary[] {
  const selected = selectUsingContributions(component, contributionName);
  return selected.filter((contribution) => contributionMatchesDocumentRoot(facts.rootTag, contribution));
}

export function countContributionInsertions(
  rootTag: string | undefined,
  contribution: IndexedComponentContributionSummary
): number {
  const root = (rootTag ?? "").toLowerCase();
  if (root === "workflow") {
    return (
      contribution.workflowActionShareCodeCount +
      contribution.workflowControlShareCodeCount +
      contribution.workflowButtonShareCodeCount
    );
  }

  return (
    contribution.formControlCount +
    contribution.formButtonCount +
    contribution.formSectionCount
  );
}

export function countFormProvidedSymbols(contributions: readonly IndexedComponentContributionSummary[]): number {
  const controls = unionContributionIdents(contributions, (contribution) => contribution.formControlIdents);
  const buttons = unionContributionIdents(contributions, (contribution) => contribution.formButtonIdents);
  const formSections = unionContributionIdents(contributions, (contribution) => contribution.formSectionIdents);
  return controls.size + buttons.size + formSections.size;
}

export function unionContributionIdents(
  contributions: readonly IndexedComponentContributionSummary[],
  selector: (contribution: IndexedComponentContributionSummary) => ReadonlySet<string>
): Set<string> {
  const out = new Set<string>();
  for (const contribution of contributions) {
    for (const ident of selector(contribution)) {
      out.add(ident);
    }
  }

  return out;
}

export function contributionMatchesDocumentRoot(
  rootTag: string | undefined,
  contribution: Pick<IndexedComponentContributionSummary, "rootExpression">
): boolean {
  const root = (rootTag ?? "").trim().toLowerCase();
  if (!root) {
    return true;
  }

  const expression = (contribution.rootExpression ?? "").trim().toLowerCase();
  if (!expression) {
    return root === "form";
  }

  const tokens = expression
    .split(/[\s,;|]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) {
    return root === "form";
  }

  return tokens.includes(root);
}

export function getUsingContributionInsertTrace(
  facts: ParsedDocumentFacts,
  componentKey: string,
  contributionName: string
): import("../indexer/xmlFacts").UsingContributionInsertTrace | undefined {
  return facts.usingContributionInsertTraces.get(`${componentKey}::${contributionName}`);
}

export function getUsingContributionInsertCount(
  facts: ParsedDocumentFacts,
  componentKey: string,
  contributionName: string
): number {
  return getUsingContributionInsertTrace(facts, componentKey, contributionName)?.finalInsertCount ?? 0;
}

export function evaluateUsingImpactFromContributions(
  facts: ParsedDocumentFacts,
  componentKey: string,
  contributions: readonly IndexedComponentContributionSummary[],
  subjectLabel: string,
  options?: {
    ignoreRootFilter?: boolean;
  }
): UsingImpactSummary {
  const relevant = options?.ignoreRootFilter
    ? [...contributions]
    : contributions.filter((contribution) => contributionMatchesDocumentRoot(facts.rootTag, contribution));
  if (relevant.length === 0) {
    return {
      kind: "unused",
      message: `${subjectLabel} has no contributions relevant for root '${facts.rootTag ?? "unknown"}'.`,
      relevantCount: 0,
      successfulCount: 0
    };
  }

  let successful = 0;
  for (const contribution of relevant) {
    if (getUsingContributionInsertCount(facts, componentKey, contribution.contributionName) > 0) {
      successful++;
    }
  }

  if (successful === 0) {
    return {
      kind: "unused",
      message: `${subjectLabel} failed to insert all ${relevant.length} root-relevant contribution(s).`,
      relevantCount: relevant.length,
      successfulCount: 0
    };
  }

  if (successful < relevant.length) {
    return {
      kind: "partial",
      message: `${subjectLabel} inserted ${successful}/${relevant.length} root-relevant contribution(s).`,
      relevantCount: relevant.length,
      successfulCount: successful
    };
  }

  return {
    kind: "effective",
    message: `${subjectLabel} inserted all ${relevant.length} root-relevant contribution(s).`,
    relevantCount: relevant.length,
    successfulCount: successful
  };
}

export function populateUsingInsertTraceFromText(
  facts: ParsedDocumentFacts,
  text: string,
  index: WorkspaceIndex
): void {
  const counts = new Map<string, number>();
  const traces = new Map<string, import("../indexer/xmlFacts").UsingContributionInsertTrace>();
  const placeholderCounts = new Map<string, number>();
  const wildcardPlaceholderCounts = new Map<string, number>();
  const includeCounts = new Map<string, number>();
  const wildcardIncludeCounts = new Map<string, number>();
  for (const ref of facts.placeholderReferences) {
    const componentKey = ref.componentKey;
    const contributionName = (ref.contributionValue ?? "").trim();
    if (!componentKey) {
      continue;
    }

    if (contributionName) {
      const key = `${componentKey}::${contributionName}`;
      placeholderCounts.set(key, (placeholderCounts.get(key) ?? 0) + 1);
    } else {
      wildcardPlaceholderCounts.set(componentKey, (wildcardPlaceholderCounts.get(componentKey) ?? 0) + 1);
    }
  }
  for (const includeRef of facts.includeReferences) {
    const componentKey = includeRef.componentKey;
    const contributionName = (includeRef.sectionValue ?? "").trim();
    if (!componentKey) {
      continue;
    }

    if (contributionName) {
      const key = `${componentKey}::${contributionName}`;
      includeCounts.set(key, (includeCounts.get(key) ?? 0) + 1);
    } else {
      wildcardIncludeCounts.set(componentKey, (wildcardIncludeCounts.get(componentKey) ?? 0) + 1);
    }
  }

  const processedUsingKeys = new Set<string>();
  const xpathStatsCache = new Map<string, { matchCount: number; insertCount: number }>();
  for (const usingRef of collectEffectiveUsingRefs(facts, index)) {
    const usingKey = `${usingRef.componentKey}::${usingRef.sectionValue ?? ""}`;
    if (processedUsingKeys.has(usingKey)) {
      continue;
    }
    processedUsingKeys.add(usingKey);

    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    const contributions = usingRef.sectionValue
      ? (() => {
          const only = component.contributionSummaries.get(usingRef.sectionValue!);
          return only ? [only] : [];
        })()
      : [...component.contributionSummaries.values()];

    for (const contribution of contributions) {
      const key = `${usingRef.componentKey}::${contribution.contributionName}`;
      const insertMode = (contribution.insert ?? "").trim().toLowerCase();
      const placeholderCount =
        (placeholderCounts.get(key) ?? 0) +
        (includeCounts.get(key) ?? 0) +
        (wildcardPlaceholderCounts.get(usingRef.componentKey) ?? 0) +
        (wildcardIncludeCounts.get(usingRef.componentKey) ?? 0);

      if (insertMode === "placeholder") {
        counts.set(key, placeholderCount);
        traces.set(key, {
          strategy: "placeholder",
          finalInsertCount: placeholderCount,
          placeholderCount,
          targetXPathExpression: contribution.targetXPath?.trim() || undefined,
          targetXPathMatchCount: 0,
          targetXPathClampedCount: 0,
          allowMultipleInserts: !!contribution.allowMultipleInserts,
          estimatedSymbolCount: 0
        });
        continue;
      }

      if ((contribution.targetXPath ?? "").trim().length > 0) {
        const xpathKey = `${contribution.targetXPath ?? ""}::${contribution.allowMultipleInserts ? "1" : "0"}`;
        let xpathStats = xpathStatsCache.get(xpathKey);
        if (!xpathStats) {
          xpathStats = analyzeXPathInsertTargets(text, contribution.targetXPath, contribution.allowMultipleInserts);
          xpathStatsCache.set(xpathKey, xpathStats);
        }
        counts.set(key, xpathStats.insertCount);
        traces.set(key, {
          strategy: "targetXPath",
          finalInsertCount: xpathStats.insertCount,
          placeholderCount,
          targetXPathExpression: contribution.targetXPath?.trim() || undefined,
          targetXPathMatchCount: xpathStats.matchCount,
          targetXPathClampedCount: xpathStats.insertCount,
          allowMultipleInserts: !!contribution.allowMultipleInserts,
          estimatedSymbolCount: 0
        });
        continue;
      }

      const estimatedSymbolCount = countIndexedContributionSymbolsForRoot(facts.rootTag, contribution);
      counts.set(key, estimatedSymbolCount);
      traces.set(key, {
        strategy: "estimatedSymbolCount",
        finalInsertCount: estimatedSymbolCount,
        placeholderCount,
        targetXPathExpression: undefined,
        targetXPathMatchCount: 0,
        targetXPathClampedCount: 0,
        allowMultipleInserts: !!contribution.allowMultipleInserts,
        estimatedSymbolCount
      });
    }
  }

  facts.usingContributionInsertCounts = counts;
  facts.usingContributionInsertTraces = traces;
}

function countIndexedContributionSymbolsForRoot(
  rootTag: string | undefined,
  contribution: IndexedComponentContributionSummary
): number {
  const root = (rootTag ?? "").trim().toLowerCase();
  if (root === "workflow") {
    return (
      contribution.workflowActionShareCodeCount +
      contribution.workflowControlShareCodeCount +
      contribution.workflowButtonShareCodeCount
    );
  }

  if (root === "form") {
    return contribution.formControlCount + contribution.formButtonCount + contribution.formSectionCount;
  }

  return (
    contribution.formControlCount +
    contribution.formButtonCount +
    contribution.formSectionCount +
    contribution.workflowActionShareCodeCount +
    contribution.workflowControlShareCodeCount +
    contribution.workflowButtonShareCodeCount
  );
}
