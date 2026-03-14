import {
  CompositionOrigin,
  EffectiveContributionReport,
  EffectiveCompositionConflict,
  EffectiveCompositionItem,
  EffectiveCompositionModel,
  FeatureCapabilityReport,
  FeatureContextKind,
  FeatureManifest,
  FeatureManifestContribution,
  FeatureManifestDependencyRef,
  FeatureManifestSymbolRef,
  FeatureSymbolKind
} from "./model";
import { FeatureManifestRegistry } from "./workspace";

const XPATH_IDENT_REGEX = /\/([A-Za-z_:][\w:.-]*)\s*\[\s*@Ident\s*=\s*(['"])(.*?)\2\s*\]\s*$/i;
const LAST_SEGMENT_REGEX = /\/([A-Za-z_:][\w:.-]*)\s*$/i;

export function buildEffectiveCompositionModel(
  manifest: FeatureManifest,
  registry: FeatureManifestRegistry
): EffectiveCompositionModel {
  const itemsByKey = new Map<string, EffectiveCompositionItem>();
  const providerContextsByItemKey = new Map<string, Array<Set<FeatureContextKind>>>();
  const conflicts: EffectiveCompositionConflict[] = [];
  const contributionReports: EffectiveContributionReport[] = [];
  const partProvidedKeys = new Set<string>();
  const contributionProvidedKeys = new Map<string, Set<string>>();

  for (const part of manifest.parts) {
    const contributionKeysInPart = new Set<string>();
    for (const contribution of part.contributions) {
      for (const symbol of contribution.provides) {
        contributionKeysInPart.add(toSymbolKey(symbol));
      }
    }

    for (const symbol of part.provides) {
      const symbolKey = toSymbolKey(symbol);
      if (contributionKeysInPart.has(symbolKey)) {
        continue;
      }

      partProvidedKeys.add(symbolKey);
      addProviderContexts(providerContextsByItemKey, symbolKey, part.appliesTo);
      upsertItem(itemsByKey, symbol, part.appliesTo, {
        kind: "feature",
        feature: manifest.feature,
        partId: part.id,
        note: `Part '${part.id}'`
      }, undefined, part.ordering);
    }

    for (const contribution of part.contributions) {
      const providedKeysForContribution = contributionProvidedKeys.get(contribution.id) ?? new Set<string>();
      for (const symbol of contribution.provides) {
        providedKeysForContribution.add(toSymbolKey(symbol));
        addProviderContexts(providerContextsByItemKey, toSymbolKey(symbol), contribution.appliesTo);
        upsertItem(itemsByKey, symbol, contribution.appliesTo, {
          kind: "feature",
          feature: manifest.feature,
          partId: part.id,
          note: contribution.name ? `Contribution '${contribution.name}'` : `Contribution '${contribution.id}'`
        }, contribution.summary, part.ordering);
      }
      contributionProvidedKeys.set(contribution.id, providedKeysForContribution);
    }
  }

  validatePartOrdering(manifest, conflicts);

  const items = [...itemsByKey.values()];
  const providedKeys = new Set(items.map((item) => item.key));
  const providedIdents = new Set(items.map((item) => item.ident));

  for (const item of items) {
    const providerContextSets = providerContextsByItemKey.get(item.key) ?? [];
    if (providerContextSets.length <= 1) {
      continue;
    }

    if (!hasOverlappingProviderContexts(providerContextSets)) {
      continue;
    }

    if (isAllowedProviderOverlap(item.kind, providerContextSets)) {
      continue;
    }

    const providers = item.origins
      .map((origin) => {
        const source = origin.note ?? [origin.feature, origin.partId, origin.section].filter(Boolean).join("/");
        const part = manifest.parts.find((candidate) => candidate.id === origin.partId);
        const appliesTo = part?.appliesTo?.join(",") ?? "unknown";
        const file = part?.file ?? "unknown-file";
        return `${source} [file=${file}, appliesTo=${appliesTo}]`;
      })
      .filter((value): value is string => !!value)
      .join(", ");

    conflicts.push({
      code: "duplicate-provider",
      message: `Symbol '${item.key}' is provided by multiple feature parts/contributions: ${providers}.`,
      itemKeys: [item.key]
    });
  }

  for (const requirement of collectAllRequirements(manifest)) {
    if (isDependencySatisfied(requirement, registry, providedKeys, providedIdents)) {
      continue;
    }

    conflicts.push({
      code: "missing-dependency",
      message: `Required dependency '${requirement.kind}:${requirement.ident}' is not satisfied.`,
      itemKeys: []
    });
  }

  for (const expectation of collectAllExpectations(manifest)) {
    if (providedKeys.has(toSymbolKey(expectation))) {
      continue;
    }

    conflicts.push({
      code: "missing-expectation",
      message: `Expected symbol '${expectation.kind}:${expectation.ident}' is not provided by feature '${manifest.feature}'.`,
      itemKeys: []
    });
  }

  const capabilityReport = registry.capabilityReportsByFeature.get(manifest.feature) ?? buildCapabilityReportFallback(manifest);
  const appliedKeys = collectAppliedItemKeys(capabilityReport, items, contributionProvidedKeys);
  const consumedKeys = collectConsumedItemKeys(manifest, capabilityReport, items);

  for (const item of items) {
    if (consumedKeys.has(item.key)) {
      item.usage = "consumed";
      continue;
    }

    if (appliedKeys.has(item.key)) {
      item.usage = "applied";
      continue;
    }

    if (partProvidedKeys.has(item.key)) {
      item.usage = "provided";
      continue;
    }

    item.usage = "unused";
  }

  for (const xpath of collectAllExpectedXPaths(capabilityReport)) {
    if (matchesExpectedXPathInEffectiveModel(xpath, items, capabilityReport)) {
      continue;
    }

    conflicts.push({
      code: "missing-expected-xpath",
      message: `Expected XPath '${xpath}' is not satisfied by the effective feature composition.`,
      itemKeys: []
    });
  }

  for (const part of capabilityReport.parts) {
    for (const contribution of part.contributions) {
      const isApplied = isContributionApplied(contribution, items);
      const providedItemKeys = [...(contributionProvidedKeys.get(contribution.id) ?? [])].sort((a, b) => a.localeCompare(b));
      const consumedItemKeys = providedItemKeys.filter((key) => consumedKeys.has(key));
      const missingExpectationKeys = contribution.expects
        .map((symbol) => toSymbolKey(symbol))
        .filter((key) => !providedKeys.has(key))
        .sort((a, b) => a.localeCompare(b));
      const missingExpectedXPaths = contribution.expectsXPath
        .filter((xpath) => !matchesExpectedXPathInEffectiveModel(xpath, items, capabilityReport))
        .sort((a, b) => a.localeCompare(b));

      contributionReports.push({
        partId: part.id,
        contributionId: contribution.id,
        ...(contribution.name ? { name: contribution.name } : {}),
        kind: contribution.kind,
        ...(contribution.summary ? { summary: contribution.summary } : {}),
        ...(contribution.targetXPath ? { targetXPath: contribution.targetXPath } : {}),
        ...(contribution.insert ? { insert: contribution.insert } : {}),
        usage: deriveContributionUsage(isApplied, missingExpectationKeys, missingExpectedXPaths),
        providedItemKeys,
        consumedItemKeys,
        missingExpectationKeys,
        missingExpectedXPaths
      });
    }
  }

  return {
    activeFeatures: [manifest.feature],
    inheritedFeatures: [],
    items,
    contributions: contributionReports,
    conflicts
  };
}

function addProviderContexts(
  target: Map<string, Array<Set<FeatureContextKind>>>,
  itemKey: string,
  contexts: readonly FeatureContextKind[]
): void {
  const current = target.get(itemKey) ?? [];
  current.push(new Set(contexts));
  target.set(itemKey, current);
}

function hasOverlappingProviderContexts(contextSets: readonly ReadonlySet<FeatureContextKind>[]): boolean {
  for (let i = 0; i < contextSets.length; i++) {
    for (let j = i + 1; j < contextSets.length; j++) {
      const left = contextSets[i];
      const right = contextSets[j];
      for (const context of left) {
        if (right.has(context)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isAllowedProviderOverlap(
  kind: FeatureSymbolKind,
  contextSets: readonly ReadonlySet<FeatureContextKind>[]
): boolean {
  if (kind !== "control") {
    return false;
  }

  for (let i = 0; i < contextSets.length; i++) {
    for (let j = i + 1; j < contextSets.length; j++) {
      const left = contextSets[i];
      const right = contextSets[j];
      const overlap = intersectContexts(left, right);
      if (overlap.length === 0) {
        continue;
      }

      const union = [...new Set([...left, ...right])];
      const inFormFilterScope = union.every((context) => context === "form" || context === "filter");
      const includesFilter = union.includes("filter");
      if (!inFormFilterScope || !includesFilter) {
        return false;
      }
    }
  }

  return true;
}

function intersectContexts(
  left: ReadonlySet<FeatureContextKind>,
  right: ReadonlySet<FeatureContextKind>
): FeatureContextKind[] {
  const out: FeatureContextKind[] = [];
  for (const context of left) {
    if (right.has(context)) {
      out.push(context);
    }
  }
  return out;
}

export function matchesExpectedXPathInEffectiveModel(
  xpath: string,
  items: readonly EffectiveCompositionItem[],
  capabilityReport?: FeatureCapabilityReport
): boolean {
  const normalized = xpath.trim();
  if (!normalized) {
    return true;
  }

  const targetXPaths = new Set(
    (capabilityReport?.parts ?? [])
      .flatMap((part) => part.contributions)
      .map((contribution) => contribution.targetXPath?.trim())
      .filter((value): value is string => !!value)
  );
  if (targetXPaths.has(normalized)) {
    return true;
  }

  const identMatch = XPATH_IDENT_REGEX.exec(normalized);
  if (identMatch) {
    const rawElementName = identMatch[1] ?? "";
    const ident = identMatch[3] ?? "";
    const elementName = stripNamespace(rawElementName);
    const mappedKind = mapElementNameToSymbolKind(elementName);
    if (mappedKind) {
      return items.some((item) => item.kind === mappedKind && item.ident === ident);
    }

    return items.some((item) => item.ident === ident);
  }

  const lastSegment = LAST_SEGMENT_REGEX.exec(normalized)?.[1];
  if (!lastSegment) {
    return false;
  }

  const segment = stripNamespace(lastSegment);
  if (targetXPaths.has(normalized)) {
    return true;
  }

  return (capabilityReport?.parts ?? []).some((part) =>
    part.contributions.some((contribution) => {
      const target = contribution.targetXPath?.trim();
      if (!target) {
        return false;
      }

      const targetSegment = stripNamespace(LAST_SEGMENT_REGEX.exec(target)?.[1] ?? "");
      return targetSegment === segment;
    })
  );
}

function upsertItem(
  itemsByKey: Map<string, EffectiveCompositionItem>,
  symbol: FeatureManifestSymbolRef,
  contexts: readonly FeatureContextKind[],
  origin: CompositionOrigin,
  summary?: string,
  ordering?: { group?: string; before: string[]; after: string[] }
): void {
  const key = toSymbolKey(symbol);
  const existing = itemsByKey.get(key);
  if (!existing) {
    itemsByKey.set(key, {
      key,
      kind: symbol.kind,
      ident: symbol.ident,
      contexts: [...contexts],
      presence: "local",
      usage: "provided",
      origins: [origin],
      ...(ordering ? { ordering: { group: ordering.group, before: [...ordering.before], after: [...ordering.after] } } : {}),
      notes: uniqueStrings([symbol.note, summary])
    });
    return;
  }

  existing.contexts = uniqueContexts([...existing.contexts, ...contexts]);
  existing.origins = uniqueOrigins([...existing.origins, origin]);
  if (ordering) {
    const currentOrdering = existing.ordering ?? { before: [], after: [] };
    existing.ordering = {
      ...(ordering.group ? { group: ordering.group } : currentOrdering.group ? { group: currentOrdering.group } : {}),
      before: uniqueStrings([...currentOrdering.before, ...ordering.before]),
      after: uniqueStrings([...currentOrdering.after, ...ordering.after])
    };
  }
  existing.notes = uniqueStrings([...existing.notes, symbol.note, summary]);
}

function validatePartOrdering(
  manifest: FeatureManifest,
  conflicts: EffectiveCompositionConflict[]
): void {
  const partIds = new Set(manifest.parts.map((part) => part.id));
  const edges = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    const bucket = edges.get(from) ?? new Set<string>();
    bucket.add(to);
    edges.set(from, bucket);
  };

  for (const part of manifest.parts) {
    const ordering = part.ordering;
    if (!ordering) {
      continue;
    }

    for (const target of ordering.before) {
      if (!partIds.has(target)) {
        conflicts.push({
          code: "ordering-conflict",
          message: `Part '${part.id}' declares 'before=${target}' but target part was not found.`,
          itemKeys: [`part:${part.id}`]
        });
        continue;
      }
      if (target === part.id) {
        conflicts.push({
          code: "ordering-conflict",
          message: `Part '${part.id}' cannot reference itself in 'before'.`,
          itemKeys: [`part:${part.id}`]
        });
        continue;
      }
      addEdge(part.id, target);
    }

    for (const target of ordering.after) {
      if (!partIds.has(target)) {
        conflicts.push({
          code: "ordering-conflict",
          message: `Part '${part.id}' declares 'after=${target}' but target part was not found.`,
          itemKeys: [`part:${part.id}`]
        });
        continue;
      }
      if (target === part.id) {
        conflicts.push({
          code: "ordering-conflict",
          message: `Part '${part.id}' cannot reference itself in 'after'.`,
          itemKeys: [`part:${part.id}`]
        });
        continue;
      }
      addEdge(target, part.id);
    }

    for (const target of ordering.before) {
      if (ordering.after.includes(target)) {
        conflicts.push({
          code: "ordering-conflict",
          message: `Part '${part.id}' declares both before and after relation for '${target}'.`,
          itemKeys: [`part:${part.id}`]
        });
      }
    }
  }

  for (const [from, targets] of edges.entries()) {
    for (const to of targets) {
      if (edges.get(to)?.has(from)) {
        conflicts.push({
          code: "ordering-conflict",
          message: `Conflicting ordering between parts '${from}' and '${to}'.`,
          itemKeys: [`part:${from}`, `part:${to}`]
        });
      }
    }
  }

  const permanent = new Set<string>();
  const temporary = new Set<string>();
  const stack: string[] = [];
  const reportCycle = (cycleNodes: string[]): void => {
    conflicts.push({
      code: "ordering-conflict",
      message: `Ordering cycle detected: ${cycleNodes.join(" -> ")}.`,
      itemKeys: cycleNodes.map((item) => `part:${item}`)
    });
  };

  const visit = (node: string): void => {
    if (permanent.has(node)) {
      return;
    }
    if (temporary.has(node)) {
      const start = stack.indexOf(node);
      const cycle = start >= 0 ? [...stack.slice(start), node] : [node, node];
      reportCycle(cycle);
      return;
    }

    temporary.add(node);
    stack.push(node);
    for (const target of edges.get(node) ?? []) {
      visit(target);
    }
    stack.pop();
    temporary.delete(node);
    permanent.add(node);
  };

  for (const part of manifest.parts) {
    visit(part.id);
  }
}

function collectAllRequirements(manifest: FeatureManifest): FeatureManifestDependencyRef[] {
  return uniqueDependencies([
    ...manifest.requires,
    ...manifest.parts.flatMap((part) => [
      ...part.contributions.flatMap((contribution) => contribution.requires)
    ])
  ]);
}

function collectAllExpectations(manifest: FeatureManifest): FeatureManifestSymbolRef[] {
  return uniqueSymbols([
    ...manifest.expects,
    ...manifest.parts.flatMap((part) => [
      ...part.expects,
      ...part.contributions.flatMap((contribution) => contribution.expects)
    ])
  ]);
}

function collectAllExpectedXPaths(capabilityReport: FeatureCapabilityReport): string[] {
  return uniqueStrings(
    capabilityReport.parts.flatMap((part) =>
      part.contributions.flatMap((contribution) => contribution.expectsXPath)
    )
  );
}

function collectAppliedItemKeys(
  capabilityReport: FeatureCapabilityReport,
  items: readonly EffectiveCompositionItem[],
  contributionProvidedKeys: ReadonlyMap<string, ReadonlySet<string>>
): Set<string> {
  const out = new Set<string>();
  for (const part of capabilityReport.parts) {
    for (const contribution of part.contributions) {
      if (!isContributionApplied(contribution, items)) {
        continue;
      }

      for (const key of contributionProvidedKeys.get(contribution.id) ?? []) {
        out.add(key);
      }
    }
  }

  return out;
}

function collectConsumedItemKeys(
  manifest: FeatureManifest,
  capabilityReport: FeatureCapabilityReport,
  items: readonly EffectiveCompositionItem[]
): Set<string> {
  const out = new Set<string>();

  for (const symbol of collectAllExpectations(manifest)) {
    out.add(toSymbolKey(symbol));
  }

  for (const xpath of collectAllExpectedXPaths(capabilityReport)) {
    for (const key of resolveExpectedXPathToItemKeys(xpath, items)) {
      out.add(key);
    }
  }

  for (const part of capabilityReport.parts) {
    for (const contribution of part.contributions) {
      for (const dependency of contribution.touches) {
        if (dependency.kind === "feature") {
          continue;
        }

        const key = `${dependency.kind}:${dependency.ident}`;
        if (items.some((item) => item.key === key)) {
          out.add(key);
        }
      }
    }
  }

  return out;
}

function isDependencySatisfied(
  requirement: FeatureManifestDependencyRef,
  registry: FeatureManifestRegistry,
  providedKeys: ReadonlySet<string>,
  providedIdents: ReadonlySet<string>
): boolean {
  if (requirement.kind === "feature") {
    return registry.manifestsByFeature.has(requirement.ident);
  }

  if (providedKeys.has(`${requirement.kind}:${requirement.ident}`)) {
    return true;
  }

  return providedIdents.has(requirement.ident);
}

function isContributionApplied(
  contribution: FeatureManifestContribution,
  items: readonly EffectiveCompositionItem[]
): boolean {
  const targetXPath = contribution.targetXPath?.trim();
  if (!targetXPath) {
    return true;
  }

  return targetXPath
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .some((candidate) => matchesContributionTargetXPath(candidate, items));
}

function matchesContributionTargetXPath(xpath: string, items: readonly EffectiveCompositionItem[]): boolean {
  const identMatch = XPATH_IDENT_REGEX.exec(xpath);
  if (identMatch) {
    const rawElementName = identMatch[1] ?? "";
    const ident = identMatch[3] ?? "";
    const mappedKind = mapElementNameToSymbolKind(stripNamespace(rawElementName));
    if (mappedKind) {
      return items.some((item) => item.kind === mappedKind && item.ident === ident);
    }

    return items.some((item) => item.ident === ident);
  }

  const normalized = xpath.toLowerCase();
  if (
    normalized.startsWith("//form/") ||
    normalized.startsWith("//workflow/") ||
    normalized.startsWith("//dataview/") ||
    normalized.startsWith("//filter/")
  ) {
    return true;
  }

  return false;
}

function resolveExpectedXPathToItemKeys(xpath: string, items: readonly EffectiveCompositionItem[]): string[] {
  const normalized = xpath.trim();
  if (!normalized) {
    return [];
  }

  const identMatch = XPATH_IDENT_REGEX.exec(normalized);
  if (identMatch) {
    const rawElementName = identMatch[1] ?? "";
    const ident = identMatch[3] ?? "";
    const mappedKind = mapElementNameToSymbolKind(stripNamespace(rawElementName));
    if (mappedKind) {
      return items
        .filter((item) => item.kind === mappedKind && item.ident === ident)
        .map((item) => item.key);
    }

    return items
      .filter((item) => item.ident === ident)
      .map((item) => item.key);
  }

  return [];
}

function buildCapabilityReportFallback(manifest: FeatureManifest): FeatureCapabilityReport {
  return {
    feature: manifest.feature,
    provides: uniqueSymbols(manifest.parts.flatMap((part) => part.provides)),
    expects: uniqueSymbols([
      ...manifest.expects,
      ...manifest.parts.flatMap((part) => [
        ...part.expects,
        ...part.contributions.flatMap((contribution) => contribution.expects)
      ])
    ]),
    requires: uniqueDependencies(manifest.requires),
    parts: manifest.parts.map((part) => ({
      id: part.id,
      file: part.file,
      appliesTo: [...part.appliesTo],
      provides: [...part.provides],
      expects: [...part.expects],
      ...(part.ordering
        ? {
            ordering: {
              ...(part.ordering.group ? { group: part.ordering.group } : {}),
              before: [...part.ordering.before],
              after: [...part.ordering.after]
            }
          }
        : {}),
      contributions: part.contributions.map((contribution) => ({
        ...contribution,
        appliesTo: [...contribution.appliesTo],
        provides: [...contribution.provides],
        expects: [...contribution.expects],
        expectsXPath: [...contribution.expectsXPath],
        requires: [...contribution.requires],
        touches: [...contribution.touches]
      }))
    }))
  };
}

function deriveContributionUsage(
  isApplied: boolean,
  missingExpectationKeys: readonly string[],
  missingExpectedXPaths: readonly string[]
): "unused" | "partial" | "effective" {
  const hasMissing = missingExpectationKeys.length > 0 || missingExpectedXPaths.length > 0;
  if (hasMissing) {
    return "partial";
  }

  return isApplied ? "effective" : "unused";
}

function toSymbolKey(symbol: FeatureManifestSymbolRef): string {
  return `${symbol.kind}:${symbol.ident}`;
}

function mapElementNameToSymbolKind(elementName: string): FeatureSymbolKind | undefined {
  switch (elementName.toLowerCase()) {
    case "control":
      return "control";
    case "button":
      return "button";
    case "section":
      return "section";
    case "actionsharecode":
      return "actionShareCode";
    case "buttonsharecode":
      return "buttonShareCode";
    case "controlsharecode":
      return "controlShareCode";
    case "column":
      return "column";
    case "component":
      return "component";
    case "datasource":
      return "datasource";
    case "parameter":
      return "parameter";
    default:
      return undefined;
  }
}

function stripNamespace(name: string): string {
  const index = name.indexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}

function uniqueSymbols(values: readonly FeatureManifestSymbolRef[]): FeatureManifestSymbolRef[] {
  const seen = new Set<string>();
  const out: FeatureManifestSymbolRef[] = [];
  for (const value of values) {
    const key = toSymbolKey(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueDependencies(values: readonly FeatureManifestDependencyRef[]): FeatureManifestDependencyRef[] {
  const seen = new Set<string>();
  const out: FeatureManifestDependencyRef[] = [];
  for (const value of values) {
    const key = `${value.kind}:${value.ident}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueOrigins(values: readonly CompositionOrigin[]): CompositionOrigin[] {
  const seen = new Set<string>();
  const out: CompositionOrigin[] = [];
  for (const value of values) {
    const key = [value.kind, value.feature, value.partId, value.componentKey, value.section, value.documentUri, value.note].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueContexts(values: readonly FeatureContextKind[]): FeatureContextKind[] {
  const out: FeatureContextKind[] = [];
  for (const value of values) {
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

function uniqueStrings(values: ReadonlyArray<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || out.includes(normalized)) {
      continue;
    }
    out.push(normalized);
  }
  return out;
}
