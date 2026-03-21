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
      ["duplicate-control-ident", "duplicate-button-ident", "duplicate-section-ident"],
      ["fact.symbolDecls", "fact.rangeIndex"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.references",
      "source",
      deps,
      [
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
      ["fact.rootMeta", "fact.workflowRefs", "fact.mappingRefs", "fact.symbolDecls"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.using",
      "source",
      deps,
      [
        "unknown-using-feature",
        "unknown-using-contribution",
        "contribution-mismatch",
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
      ["fact.usingRefs", "fact.placeholderRefs", "fact.rootMeta"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.conventions",
      "source",
      deps,
      [
        "ident-convention-workflow-postfix",
        "ident-convention-view-postfix",
        "ident-convention-group-button-postfix",
        "ident-convention-button-postfix",
        "ident-convention-lookup-control",
        "sql-convention-equals-spacing",
        "typo-maxlenght-attribute"
      ],
      ["fact.rootMeta", "fact.symbolDecls", "fact.rangeIndex"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.feature",
      "source",
      deps,
      [
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
      ["fact.usingRefs", "fact.rootMeta"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.primitives",
      "source",
      deps,
      ["unknown-primitive", "primitive-missing-slot", "primitive-missing-param", "primitive-cycle"],
      ["fact.rootMeta"]
    )
  );

  modules.push(
    new RuleGroupValidationModule(
      "validation.composed-reference",
      "composed-reference",
      deps,
      [
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
      ],
      ["fact.rootMeta", "fact.workflowRefs", "fact.mappingRefs", "fact.symbolDecls"]
    )
  );

  return modules;
}
