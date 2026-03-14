export type FeatureContextKind = "form" | "workflow" | "dataview" | "view" | "filter" | "component";

export type FeatureSymbolKind =
  | "control"
  | "button"
  | "section"
  | "actionShareCode"
  | "buttonShareCode"
  | "controlShareCode"
  | "column"
  | "component"
  | "datasource"
  | "parameter"
  | "other";

export type FeatureReferenceKind = "feature" | FeatureSymbolKind;
export type FeatureManifestContributionKind = "provide" | "extend-existing" | "placeholder" | "decorate" | "asset" | "other";

export type CompositionOriginKind = "local" | "using" | "include" | "feature" | "inheritance" | "primitive" | "generated";

export type CompositionPresence = "local" | "injected" | "inherited";

export type CompositionUsageState = "provided" | "applied" | "consumed" | "unused";
export type ContributionUsageState = "unused" | "partial" | "effective";

export interface FeatureManifestSymbolRef {
  kind: FeatureSymbolKind;
  ident: string;
  note?: string;
}

export interface FeatureManifestDependencyRef {
  kind: FeatureReferenceKind;
  ident: string;
  note?: string;
}

export interface FeatureManifestOrdering {
  group?: string;
  before: string[];
  after: string[];
}

export interface FeatureManifestContribution {
  id: string;
  name?: string;
  kind: FeatureManifestContributionKind;
  summary?: string;
  targetXPath?: string;
  insert?: string;
  appliesTo: FeatureContextKind[];
  provides: FeatureManifestSymbolRef[];
  expects: FeatureManifestSymbolRef[];
  expectsXPath: string[];
  requires: FeatureManifestDependencyRef[];
  touches: FeatureManifestDependencyRef[];
  note?: string;
}

export interface FeatureManifestPart {
  id: string;
  file: string;
  appliesTo: FeatureContextKind[];
  provides: FeatureManifestSymbolRef[];
  expects: FeatureManifestSymbolRef[];
  contributions: FeatureManifestContribution[];
  ordering?: FeatureManifestOrdering;
}

export interface FeatureManifest {
  version: 1;
  feature: string;
  description?: string;
  entrypoint?: string;
  tags: string[];
  parts: FeatureManifestPart[];
  requires: FeatureManifestDependencyRef[];
  expects: FeatureManifestSymbolRef[];
  source?: string;
}

export interface CompositionOrigin {
  kind: CompositionOriginKind;
  feature?: string;
  partId?: string;
  componentKey?: string;
  section?: string;
  documentUri?: string;
  note?: string;
}

export interface CompositionOrdering {
  group?: string;
  before: string[];
  after: string[];
}

export interface EffectiveCompositionItem {
  key: string;
  kind: FeatureSymbolKind;
  ident: string;
  contexts: FeatureContextKind[];
  presence: CompositionPresence;
  usage: CompositionUsageState;
  origins: CompositionOrigin[];
  ordering?: CompositionOrdering;
  notes: string[];
}

export interface EffectiveCompositionConflict {
  code:
    | "duplicate-provider"
    | "ordering-conflict"
    | "missing-dependency"
    | "missing-expectation"
    | "missing-expected-xpath"
    | "orphan-part"
    | "other";
  message: string;
  itemKeys: string[];
}

export interface EffectiveContributionReport {
  partId: string;
  contributionId: string;
  name?: string;
  kind: FeatureManifestContributionKind;
  summary?: string;
  targetXPath?: string;
  insert?: string;
  usage: ContributionUsageState;
  providedItemKeys: string[];
  consumedItemKeys: string[];
  missingExpectationKeys: string[];
  missingExpectedXPaths: string[];
}

export interface EffectiveCompositionModel {
  documentUri?: string;
  rootKind?: FeatureContextKind;
  activeFeatures: string[];
  inheritedFeatures: string[];
  items: EffectiveCompositionItem[];
  contributions: EffectiveContributionReport[];
  conflicts: EffectiveCompositionConflict[];
}

export interface FeatureCapabilityReport {
  feature: string;
  provides: FeatureManifestSymbolRef[];
  expects: FeatureManifestSymbolRef[];
  requires: FeatureManifestDependencyRef[];
  parts: Array<{
    id: string;
    file: string;
    appliesTo: FeatureContextKind[];
    provides: FeatureManifestSymbolRef[];
    expects: FeatureManifestSymbolRef[];
    contributions: FeatureManifestContribution[];
  }>;
}
