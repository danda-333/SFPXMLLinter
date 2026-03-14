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
  component: IndexedComponent
): UsingImpactResult {
  const root = (facts.rootTag ?? "").toLowerCase();
  if (root !== "form" && root !== "workflow") {
    return { kind: "effective" };
  }

  const selectedContributions = selectUsingContributions(component, contributionValue);
  if (selectedContributions.length === 0) {
    return { kind: "effective" };
  }

  if (root === "form") {
    const providedCount = countFormProvidedSymbols(selectedContributions);
    if (providedCount === 0) {
      return {
        kind: "unused",
        message: `Using feature '${rawComponentValue}' does not inject any Form controls, buttons, or contributions into this document.`
      };
    }

    return { kind: "effective" };
  }

  const providedActionShareCodes = unionContributionIdents(selectedContributions, (contribution) => contribution.workflowActionShareCodeIdents);
  const providedControlShareCodes = unionContributionIdents(selectedContributions, (contribution) => contribution.workflowControlShareCodeIdents);
  const providedButtonShareCodes = unionContributionIdents(selectedContributions, (contribution) => contribution.workflowButtonShareCodeIdents);
  const totalProvided =
    providedActionShareCodes.size + providedControlShareCodes.size + providedButtonShareCodes.size;
  if (totalProvided === 0) {
      return {
      kind: "unused",
      message: `Using feature '${rawComponentValue}' does not inject any WorkFlow share codes through the selected contribution scope.`
    };
  }

  const referencedControlShareCodes = new Set(
    facts.workflowReferences.filter((item) => item.kind === "controlShareCode").map((item) => item.ident)
  );
  const referencedButtonShareCodes = new Set(
    facts.workflowReferences.filter((item) => item.kind === "buttonShareCode").map((item) => item.ident)
  );
  const referencedActionShareCodes = new Set(facts.actionShareCodeReferences.map((item) => item.ident));

  const consumedControlShareCodes = intersectIdents(providedControlShareCodes, referencedControlShareCodes);
  const consumedButtonShareCodes = intersectIdents(providedButtonShareCodes, referencedButtonShareCodes);
  const indirectActionShareCodeRefs =
    consumedButtonShareCodes.size > 0
      ? intersectIdents(
          providedActionShareCodes,
          unionContributionIdents(selectedContributions, (contribution) => contribution.workflowReferencedActionShareCodeIdents)
        )
      : new Set<string>();
  const effectiveReferencedActionShareCodes = new Set<string>([
    ...referencedActionShareCodes,
    ...indirectActionShareCodeRefs
  ]);
  const consumedActionShareCodes = intersectIdents(providedActionShareCodes, effectiveReferencedActionShareCodes);
  const consumedCount =
    consumedActionShareCodes.size + consumedControlShareCodes.size + consumedButtonShareCodes.size;

  if (consumedCount === 0) {
    return {
      kind: "unused",
      message: `Using feature '${rawComponentValue}' injects WorkFlow share codes, but none of them are used in the current WorkFlow.`
    };
  }

  if (consumedCount < totalProvided) {
    const missing = [
      ...differenceIdents(providedActionShareCodes, effectiveReferencedActionShareCodes),
      ...differenceIdents(providedControlShareCodes, referencedControlShareCodes),
      ...differenceIdents(providedButtonShareCodes, referencedButtonShareCodes)
    ];
    const suffix = missing.length > 0 ? ` Unused: ${missing.map((item) => `'${item}'`).join(", ")}.` : "";
    return {
      kind: "partial",
      message: `Using feature '${rawComponentValue}' is only partially used by the current WorkFlow.${suffix}`
    };
  }

  return { kind: "effective" };
}

export function selectUsingContributions(component: IndexedComponent, contributionName?: string): IndexedComponentContributionSummary[] {
  if (contributionName) {
    const only = component.contributionSummaries.get(contributionName);
    return only ? [only] : [];
  }

  return [...component.contributionSummaries.values()];
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

function intersectIdents(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const ident of left) {
    if (right.has(ident)) {
      out.add(ident);
    }
  }

  return out;
}

function differenceIdents(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const ident of left) {
    if (!right.has(ident)) {
      out.push(ident);
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}
