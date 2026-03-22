# Refactor Execution Contract

Purpose: define the missing decisions needed to execute all refactor phases in one pass with high success probability.

## Execution Outcome (2026-03-19)

- Contract items were implemented under one pipeline-first runtime path (`UpdateRunner` + module host).
- Validation moved to module-based host (`validation.*`) and legacy validation module file/wiring was removed.
- Provider layer (`references`, `rename`, `definition`) now consumes shared facts/symbol access paths instead of legacy reference buckets.
- Tree projection adapter is in place and covered by composition test suite.
- TreeView dependency usage and dependency revalidation/template dependent lookup were switched away from legacy component reference/usage maps to fact-scanning paths.
- Facts resolution policy is now centralized (`core/model/factsResolution.ts`) and used by providers + validation service in explicit modes (`strict-accessor` / `fallback-parse`) to avoid silent contract drift.
- Added guard regression test for facts resolution policy (`src/tests/core/runFactsResolutionTests.ts`) and wired into `test:composition`.
- Gates passing:
  - `npm run compile`
  - `npm run test:providers`
  - `npm run test:linter`
  - `npm run test:composition`

## Execution Addendum (2026-03-21)

- Single-writer guard was expanded to cover fact/symbol registration mutation surfaces:
  - `factRegistry.register(...)`
  - `symbolRegistry.registerResolver(...)`
- Direct model/fact/symbol write calls from `extension.ts` were removed and centralized behind:
  - `src/core/model/modelWriteGateway.ts`
- Guard allowlist explicitly marks bootstrap-only registration boundary:
  - `src/core/facts/registerDefaultFactsAndSymbols.ts`
- Update orchestrator contract coverage was extended:
  - post-save callback ordering (`build -> dependency enqueue -> onPostSave`)
  - same-URI save serialization (second save waits for first pipeline completion)
- Shared access policy tightened further in runtime consumers:
  - component key/variant reads moved behind `core/model/indexAccess.ts`
  - additional direct-map reads eliminated from providers/scope/orchestrator-adjacent services
- Runtime facts reads were hardened to strict-accessor mode for composition/runtime consumers (TreeView facts resolution, dependency revalidation open-doc path, template planner on template save).
- Index access helper API was simplified to strict behavior for accessor mode (legacy `index-fallback` mode removed from `core/model/indexAccess.ts`).
- `missing-feature-expected-xpath` was moved to composed-reference validation mode; template diagnostics now resolve this rule from runtime/composed context only.
- Validation rule matrix is now centralized in `src/core/validation/validationModules.ts` (`VALIDATION_RULE_GROUPS` + `COMPOSED_REFERENCE_RULE_IDS`) and consumed by extension composed-reference filtering.
- Added explicit rule-mode matrix contract (`sourceOnly` / `composedOnly` / `dual`) in `src/core/validation/validationModules.ts` and regression gate `src/tests/core/runValidationRuleMatrixContractTests.ts` to keep engine rules, settings defaults, package defaults, and matrix coverage in sync.
- Added validation dependency contract gate `src/tests/core/runValidationModuleFactContractTests.ts` to enforce that every `ValidationModule.needsFacts` dependency is backed by a registered default fact provider.
- Added validation symbol dependency contract gate `src/tests/core/runValidationModuleSymbolContractTests.ts` to enforce that every declared `ValidationModule.needsSymbols` dependency is backed by a registered symbol resolver.
- Added validation rule coverage contract gate `src/tests/core/runValidationModuleRuleCoverageContractTests.ts` to enforce full matrix-to-module coverage (`sourceOnly` / `composedOnly` / `dual`) and prevent orphaned rules/modules.
- Added provider access contract gate `src/tests/core/runProviderAccessContractTests.ts` to enforce provider-layer usage of shared model entrypoints (`indexAccess` + `factsResolution` strict-accessor) and block legacy fallback/direct-map patterns.
- Added orchestration entry contract gate `src/tests/core/runOrchestrationEntryContractTests.ts` to ensure event handlers route save/build work through orchestrator entrypoints and block direct build execution paths in event diagnostics/save handlers.
- Added command-handler orchestration contract gate `src/tests/core/runCommandHandlerOrchestrationContractTests.ts` to ensure command registrar services stay as thin facades (dependency-injected handlers only) and do not import build/validation/orchestrator internals directly.
- Added pipeline module registration contract gate `src/tests/core/runPipelineModuleRegistrationContractTests.ts` to enforce required module registration set and ordering in `extension.ts` (single orchestration path stability).
- Added diagnostics publisher contract gate `src/tests/core/runDiagnosticsPublisherContractTests.ts` to enforce single diagnostics mutation boundary (`DiagnosticsPublisherService`) and keep `createDiagnosticCollection` centralized in `extension.ts`.
- Added composition datasource contract gate `src/tests/core/runCompositionDataSourceContractTests.ts` to keep TreeView/projection on model facts/snapshot accessors only (no direct index map reads or orchestration/indexer internal imports in composition layer).
- Added validation data access contract gate `src/tests/core/runValidationDataAccessContractTests.ts` to keep validation layer free of direct index-map access and direct orchestration/indexer implementation imports; validation module execution stays dependency-injected via `ValidationRunnerDeps`.
- Added extension boundary contract gate `src/tests/core/runExtensionBoundaryContractTests.ts` to enforce that event handlers (`save/files`) route through `updateOrchestrator`, block direct build calls in handlers, and prevent low-level model/fact/symbol mutations in `extension.ts` outside `modelWriteGateway`.
- Added workspace scan boundary contract gate `src/tests/core/runWorkspaceScanBoundaryContractTests.ts` to prevent ad-hoc workspace scans outside explicit boundaries (`utils/paths`, `workspaceIndexer`, template build service, legacy migration command), keeping scan orchestration centralized.
- Added fallback-parse boundary contract gate `src/tests/core/runFallbackParseBoundaryContractTests.ts` to enforce strict-accessor default and allow `fallback-parse` only in the explicit standalone validation boundary (`documentValidationService`) plus `factsResolution` type/implementation declaration.
- Added contract snapshot gate `src/tests/core/runContractGuardsSnapshotTests.ts` to ensure all contract guards are present and wired in `scripts.test:composition` (single aggregated contract inventory/report).
- Added strict aggregate test entrypoint `npm run test:all:strict` (includes performance checkpoints: `test:linter:perf`, `test:templates:perf`).
 - Added focused contract-only entrypoint `npm run test:contracts` for fast guard verification without full composition fixture run.
- Added CI workflow gate `.github/workflows/ci-contracts-perf.yml` to enforce `test:contracts`, `test:linter:perf`, and `test:templates:perf` on push/PR.

### Standalone Fallback Contract (Explicit Exception)

- Runtime/indexed pipeline remains strict-accessor only.
- Fallback parsing is allowed only for standalone/non-indexed documents.
- Allowed entrypoint:
  - `parseFactsStandalone(...)` in `src/core/validation/documentValidationService.ts`
- Forbidden:
  - direct `parseDocumentFacts(...)` calls in runtime consumers
  - `fallback-parse` mode in composition/runtime consumers
- Guard alignment:
  - single-source guard keeps `parseDocumentFacts(...)` usage blocked outside allowlisted boundaries
  - document validation service is the explicit standalone boundary

## 1) Priority Order (Hard)

Before implementation starts, confirm strict priority:

1. Diagnostics correctness
2. Performance budgets
3. TreeView parity and consistency

If tradeoffs happen, this order decides.

## 2) Definition of Done by Phase

Each phase must have explicit, testable acceptance criteria.

Required:

- exact behavior goals
- measurable output
- mandatory tests
- no hidden fallback behavior

## 3) Final Performance Budgets

Confirm production budgets and whether they are hard fail gates:

- `change -> publish` p95
- `save -> publish` p95
- compose phase p95
- validation phase p95

Also define:

- allowed temporary regressions during refactor (if any)
- hard stop thresholds that block continuation

## 4) Rule Split Matrix (Source vs Composed)

Create an explicit matrix for all diagnostics rules:

- `source-only`
- `composed-only`
- dual mode (should be minimal and justified)

No implicit decisions during coding.

## 5) Command Compatibility Contract

All existing command IDs remain stable.

Required to define:

- must-preserve semantics per command
- allowed internal behavior changes
- payload compatibility for internal/integration commands

## 6) Debug and Logging Policy

Define what is always-on vs debug-only:

- mandatory runtime logs
- per-module debug logs
- trace export format and retention

Goal: keep production logs useful but lightweight.

## 7) Test Gate Policy

Define merge blocking gates:

- unit
- integration
- end-to-end
- performance gates

For each gate specify:

- mandatory pass
- warning-only (if allowed)
- ownership for fixing failures

## 8) Big-Bang Risk Tolerance

Confirm this explicit delivery mode:

- no feature flags
- no phased runtime dual-path support
- full architecture cutover in branch

And define:

- max acceptable stabilization window before merge to main
- required confidence level from fixtures/perf before merge

## 9) Canonical Fixture Set

Define the authoritative fixture set used to validate correctness:

- core linter fixtures
- composition fixtures
- production-like fixture scenarios (complex templating/injection)
- performance fixture dataset

Any conflicting scenario is resolved by updating this canonical set first.

## 10) Implementation Working Agreements

For successful all-in delivery, enforce:

- single writer model updates (`UpdateRunner` only)
- no TreeView fallback logic
- all validators module-declared dependencies only
- all modules emit metrics
- no direct use of legacy maps from new consumers

---

When this contract is fully filled and approved, implementation of phases 1-5 can proceed with minimal ambiguity.
