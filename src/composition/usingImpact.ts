import { IndexedComponent, IndexedComponentContributionSummary } from "../indexer/types";
import type { ParsedDocumentFacts } from "../indexer/xmlFacts";

export interface UsingImpactResult {
  kind: "effective" | "partial" | "unused";
  message?: string;
}

export function analyzeUsingImpact(
  facts: ParsedDocumentFacts,
  rawComponentValue: string,
  contributionValue: string | undefined,
  component: IndexedComponent,
  usingComponentKey?: string
): UsingImpactResult {
  const selectedContributions = selectRelevantUsingContributions(facts, component, contributionValue);
  if (selectedContributions.length === 0) {
    return {
      kind: "unused",
      message: `Using feature '${rawComponentValue}' has no contributions relevant for root '${facts.rootTag ?? "unknown"}'.`
    };
  }

  let successful = 0;
  const componentKey = usingComponentKey ?? component.key;
  for (const contribution of selectedContributions) {
    const key = `${componentKey}::${contribution.contributionName}`;
    const inserts = facts.usingContributionInsertCounts.get(key) ?? 0;
    if (inserts > 0) {
      successful++;
    }
  }

  if (successful === 0) {
    return {
      kind: "unused",
      message: `Using feature '${rawComponentValue}' failed to insert all ${selectedContributions.length} root-relevant contribution(s).`
    };
  }

  if (successful < selectedContributions.length) {
    return {
      kind: "partial",
      message: `Using feature '${rawComponentValue}' inserted ${successful}/${selectedContributions.length} root-relevant contribution(s).`
    };
  }

  return {
    kind: "effective",
    message: `Using feature '${rawComponentValue}' inserted all ${selectedContributions.length} root-relevant contribution(s).`
  };
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
