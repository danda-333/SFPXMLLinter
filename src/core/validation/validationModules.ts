import * as vscode from "vscode";
import { ValidationModule, ValidationRequest } from "./types";

export interface ValidationRunnerDeps {
  runSource: (request: ValidationRequest) => vscode.Diagnostic[];
  runComposed: (request: ValidationRequest) => vscode.Diagnostic[];
}

type ValidationMode = ValidationModule["mode"];

const SOURCE_CACHE = new WeakMap<ValidationRequest, vscode.Diagnostic[]>();
const COMPOSED_CACHE = new WeakMap<ValidationRequest, vscode.Diagnostic[]>();

function getCode(diagnostic: vscode.Diagnostic): string {
  return typeof diagnostic.code === "string" ? diagnostic.code : "";
}

class RuleGroupValidationModule implements ValidationModule {
  public constructor(
    public readonly id: string,
    public readonly mode: ValidationMode,
    private readonly deps: ValidationRunnerDeps,
    private readonly includeRuleIds: readonly string[],
    public readonly needsFacts: readonly string[] = []
  ) {}

  public run(request: ValidationRequest): vscode.Diagnostic[] {
    const diagnostics = this.mode === "source"
      ? getOrCompute(SOURCE_CACHE, request, () => this.deps.runSource(request))
      : getOrCompute(COMPOSED_CACHE, request, () => this.deps.runComposed(request));
    const allowed = new Set(this.includeRuleIds);
    return diagnostics.filter((item) => allowed.has(getCode(item)));
  }
}

export const VALIDATION_RULE_GROUPS = {
  duplicates: [
    "duplicate-control-ident",
    "duplicate-button-ident",
    "duplicate-section-ident"
  ],
  references: [
    "unknown-form-ident",
    "unknown-form-control-ident",
    "unknown-form-button-ident",
    "unknown-workflow-button-share-code-ident",
    "unknown-form-section-ident",
    "unknown-mapping-ident",
    "unknown-mapping-form-ident",
    "unknown-required-action-ident",
    "unknown-workflow-action-value-control-ident",
    "unknown-workflow-show-hide-control-ident",
    "unknown-html-template-control-ident"
  ],
  using: [
    "unknown-using-feature",
    "unknown-using-contribution",
    "contribution-mismatch",
    "legacy-template-alias-disabled",
    "unused-using",
    "partial-using",
    "missing-using-param",
    "orphan-placeholder",
    "workflow-redundant-feature-using",
    "dataview-redundant-feature-using",
    "feature-inheritance-override",
    "suppression-noop",
    "suppression-conflict"
  ],
  conventions: [
    "ident-convention-workflow-postfix",
    "ident-convention-view-postfix",
    "ident-convention-group-button-postfix",
    "ident-convention-button-postfix",
    "ident-convention-lookup-control",
    "sql-convention-equals-spacing",
    "typo-maxlenght-attribute"
  ],
  feature: [
    "unknown-feature-requirement",
    "missing-feature-expectation",
    "duplicate-feature-provider",
    "missing-explicit-provides",
    "missing-feature-dependency",
    "ordering-conflict",
    "orphan-feature-part",
    "incomplete-feature",
    "unused-feature-contribution",
    "partial-feature-contribution"
  ],
  primitives: [
    "unknown-primitive",
    "primitive-missing-slot",
    "primitive-missing-param",
    "primitive-cycle"
  ],
  composedReference: [
    "unknown-form-ident",
    "unknown-form-control-ident",
    "unknown-form-button-ident",
    "unknown-workflow-button-share-code-ident",
    "unknown-form-section-ident",
    "unknown-mapping-ident",
    "unknown-mapping-form-ident",
    "unknown-required-action-ident",
    "unknown-workflow-action-value-control-ident",
    "unknown-workflow-show-hide-control-ident",
    "unknown-html-template-control-ident",
    "unknown-using-feature",
    "unknown-using-contribution",
    "contribution-mismatch",
    "orphan-placeholder",
    "missing-feature-expected-xpath"
  ]
} as const;

export const COMPOSED_REFERENCE_RULE_IDS: readonly string[] = VALIDATION_RULE_GROUPS.composedReference;

function toSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

const SOURCE_RULE_CANDIDATES = new Set<string>([
  ...VALIDATION_RULE_GROUPS.duplicates,
  ...VALIDATION_RULE_GROUPS.references,
  ...VALIDATION_RULE_GROUPS.using,
  ...VALIDATION_RULE_GROUPS.conventions,
  ...VALIDATION_RULE_GROUPS.feature,
  ...VALIDATION_RULE_GROUPS.primitives
]);
const COMPOSED_RULE_CANDIDATES = new Set<string>(VALIDATION_RULE_GROUPS.composedReference);
const DUAL_RULES = new Set<string>(Array.from(SOURCE_RULE_CANDIDATES).filter((id) => COMPOSED_RULE_CANDIDATES.has(id)));
const SOURCE_ONLY_RULES = new Set<string>(Array.from(SOURCE_RULE_CANDIDATES).filter((id) => !DUAL_RULES.has(id)));
const COMPOSED_ONLY_RULES = new Set<string>(Array.from(COMPOSED_RULE_CANDIDATES).filter((id) => !DUAL_RULES.has(id)));

export const VALIDATION_RULE_MODE_MATRIX = {
  sourceOnly: toSorted(SOURCE_ONLY_RULES),
  composedOnly: toSorted(COMPOSED_ONLY_RULES),
  dual: toSorted(DUAL_RULES)
} as const;

export const ALL_VALIDATION_RULE_IDS: readonly string[] = toSorted([
  ...VALIDATION_RULE_MODE_MATRIX.sourceOnly,
  ...VALIDATION_RULE_MODE_MATRIX.composedOnly,
  ...VALIDATION_RULE_MODE_MATRIX.dual
]);

function getOrCompute(
  cache: WeakMap<ValidationRequest, vscode.Diagnostic[]>,
  request: ValidationRequest,
  compute: () => vscode.Diagnostic[]
): vscode.Diagnostic[] {
  const existing = cache.get(request);
  if (existing) {
    return existing;
  }
  const computed = compute();
  cache.set(request, computed);
  return computed;
}

export function createValidationModules(deps: ValidationRunnerDeps): ValidationModule[] {
  const modules: ValidationModule[] = [];

  modules.push(
    new RuleGroupValidationModule(
      "validation.duplicates",
      "source",
      deps,
      VALIDATION_RULE_GROUPS.duplicates,
      ["fact.symbolDecls", "fact.rangeIndex"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.references",
      "source",
      deps,
      VALIDATION_RULE_GROUPS.references,
      ["fact.rootMeta", "fact.workflowRefs", "fact.mappingRefs", "fact.symbolDecls"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.using",
      "source",
      deps,
      VALIDATION_RULE_GROUPS.using,
      ["fact.usingRefs", "fact.placeholderRefs", "fact.rootMeta"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.conventions",
      "source",
      deps,
      VALIDATION_RULE_GROUPS.conventions,
      ["fact.rootMeta", "fact.symbolDecls", "fact.rangeIndex"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.feature",
      "source",
      deps,
      VALIDATION_RULE_GROUPS.feature,
      ["fact.usingRefs", "fact.rootMeta"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.primitives",
      "source",
      deps,
      VALIDATION_RULE_GROUPS.primitives,
      ["fact.rootMeta"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.composed-reference",
      "composed-reference",
      deps,
      VALIDATION_RULE_GROUPS.composedReference,
      ["fact.rootMeta", "fact.workflowRefs", "fact.mappingRefs", "fact.symbolDecls"]
    )
  );

  return modules;
}
