import type { WorkspaceIndex } from "../indexer/types";
import type { ParsedDocumentFacts } from "../indexer/xmlFacts";

export interface EffectiveUsingRef {
  componentKey: string;
  rawComponentValue: string;
  sectionValue?: string;
  source: "local" | "inherited";
  inheritedFromFormIdent?: string;
}

export function collectEffectiveUsingRefs(
  facts: ParsedDocumentFacts,
  index: WorkspaceIndex
): EffectiveUsingRef[] {
  const out: EffectiveUsingRef[] = [];
  const seen = new Set<string>();
  const localFeatureSections = new Map<string, Set<string>>();
  const localFeatureHasFull = new Set<string>();
  const push = (item: EffectiveUsingRef): void => {
    const key = `${item.componentKey}::${item.sectionValue ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(item);
  };

  for (const usingRef of facts.usingReferences) {
    if (usingRef.sectionValue) {
      const sections = localFeatureSections.get(usingRef.componentKey) ?? new Set<string>();
      sections.add(usingRef.sectionValue);
      localFeatureSections.set(usingRef.componentKey, sections);
    } else {
      localFeatureHasFull.add(usingRef.componentKey);
    }

    push({
      componentKey: usingRef.componentKey,
      rawComponentValue: usingRef.rawComponentValue,
      ...(usingRef.sectionValue ? { sectionValue: usingRef.sectionValue } : {}),
      source: "local"
    });
  }

  const root = (facts.rootTag ?? "").toLowerCase();
  if (root !== "workflow" && root !== "dataview") {
    return out;
  }

  const owningFormIdent =
    root === "workflow"
      ? facts.workflowFormIdent ?? facts.rootFormIdent
      : facts.rootFormIdent;
  if (!owningFormIdent) {
    return out;
  }

  const form = index.formsByIdent.get(owningFormIdent);
  const formFacts = form ? index.parsedFactsByUri.get(form.uri.toString()) : undefined;
  if (!formFacts) {
    return out;
  }

  for (const usingRef of formFacts.usingReferences) {
    if (localFeatureHasFull.has(usingRef.componentKey)) {
      continue;
    }

    if (localFeatureSections.has(usingRef.componentKey)) {
      // Local contribution-level using overrides inherited feature-level activation.
      continue;
    }

    push({
      componentKey: usingRef.componentKey,
      rawComponentValue: usingRef.rawComponentValue,
      ...(usingRef.sectionValue ? { sectionValue: usingRef.sectionValue } : {}),
      source: "inherited",
      inheritedFromFormIdent: owningFormIdent
    });
  }

  return out;
}
