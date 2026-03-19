# Composed Model + Symbol Registry Design

## Goal

Unify internal extension logic around one in-memory model, where:

- build outputs (final XML) are first-class data,
- diagnostics, tree view, references, and completion read from the same source,
- symbol types (`Control`, `Button`, `Section`, `ShareCode`, ...) are extensible and not hardcoded in core structures.

This document defines the proposed data model and extension points.

## Top-Level Model (v2: Node-Based)

```ts
ComposedWorkspaceModel
├─ version: number
├─ settingsSnapshot: SettingsSnapshot
├─ roots
│  ├─ workspaceRoots: string[]
│  ├─ templateRoot: "XML_Templates"
│  ├─ runtimeRoot: "XML"
│  ├─ componentRoot: "XML_Components"
│  └─ primitiveRoot: "XML_Primitives"
├─ nodesById: Map<NodeId, ModelNode>
├─ indexes
│  ├─ formsByIdent: Map<FormIdent, NodeId[]>
│  ├─ featuresByKey: Map<FeatureKey, NodeId[]>
│  ├─ primitivesByKey: Map<PrimitiveKey, NodeId[]>
│  ├─ symbolsByKey: Map<SymbolKey, NodeId[]>
│  └─ urisToNodeId: Map<Uri, NodeId>
├─ dependencyGraph: DependencyGraph
├─ symbols: SymbolRegistry
├─ diagnosticsState: DiagnosticsState
├─ compositionState: CompositionState
└─ perf: ModelPerfCounters
```

Notes:

- `formsByIdent`, `featuresByKey`, `primitivesByKey` are only reference indexes.
- Real data lives in `nodesById`.
- This allows non-file-backed entities (generator outputs, virtual composed nodes).

## Model Node

```ts
ModelNode
├─ id: NodeId
├─ kind: "document" | "feature" | "primitive" | "form" | "generatorOutput" | "virtual"
├─ source
│  ├─ uri?: Uri
│  ├─ provider: "file" | "generator" | "runtime"
│  └─ identityKey: string
├─ rootTag?: "Form" | "WorkFlow" | "DataView" | "Feature" | ...
├─ content
│  ├─ sourceText?: string
│  ├─ normalizedHash: string
│  ├─ eol: "\n" | "\r\n"
│  └─ versionToken: string
├─ facts?: ParsedDocumentFacts
├─ composed
│  ├─ finalXmlText?: string
│  ├─ finalFacts?: ParsedDocumentFacts
│  ├─ builtAt?: number
│  └─ buildStatus: "clean" | "dirty" | "building" | "error"
├─ provenance
│  ├─ symbolProvidersByKey: Map<SymbolKey, Provider[]>
│  ├─ mutations: TemplateMutationRecord[]
│  └─ placeholders: PlaceholderTrace[]
├─ diagnostics
│  ├─ sourceOnly: Diagnostic[]
│  ├─ composedOnly: Diagnostic[]
│  └─ published: Diagnostic[]
├─ payload?: unknown
└─ deps
   ├─ dependsOn: Set<Uri>
   └─ dependedBy: Set<Uri>
```

`payload` is typed by `kind`:

- `kind="form"` -> `FormPayload`
- `kind="feature"` -> `FeaturePayload`
- `kind="primitive"` -> `PrimitivePayload`
- `kind="generatorOutput"` -> generator-specific payload

## Payload Shapes

```ts
FormPayload
├─ ident: string
├─ template
│  ├─ formUri?: Uri
│  ├─ workflowUris: Set<Uri>
│  └─ dataviewUris: Set<Uri>
├─ runtime
│  ├─ formUri?: Uri
│  ├─ workflowUris: Set<Uri>
│  └─ dataviewUris: Set<Uri>
├─ symbolsFromComposed
│  ├─ controls: Map<Ident, SymbolDef>
│  ├─ buttons: Map<Ident, SymbolDef>
│  ├─ sections: Map<Ident, SymbolDef>
│  ├─ actionShareCodes: Map<Ident, SymbolDef>
│  ├─ controlShareCodes: Map<Ident, SymbolDef>
│  └─ buttonShareCodes: Map<Ident, SymbolDef>
└─ status
   ├─ lastComposedAt?: number
   └─ dirtyReason?: string
```

## Feature / Primitive Aggregates

```ts
FeaturePayload
├─ key: string
├─ entryUri?: Uri
├─ partUris: Set<Uri>
├─ manifestModel: EffectiveFeatureModel
├─ provides: Set<CapabilityKey>
├─ expects: Set<CapabilityKey>
├─ expectedXPaths: Set<string>
└─ usage
   ├─ usedByTemplates: Set<Uri>
   └─ usedByForms: Set<FormIdent>
```

```ts
PrimitivePayload
├─ key: string
├─ uri: Uri
├─ slots: Set<string>
├─ requiredParams: Set<string>
└─ usage
   ├─ usedByFeatures: Set<FeatureKey>
   └─ usedByTemplates: Set<Uri>
```

## Dependency Graph

```ts
DependencyGraph
├─ forward: Map<NodeId, Set<NodeId>>
├─ reverse: Map<NodeId, Set<NodeId>>
├─ edgesByType
│  ├─ using
│  ├─ include
│  ├─ primitiveUse
│  ├─ inheritedUsing
│  ├─ generatorDependency
│  └─ formOwnership
└─ functions
   ├─ affectedSubtree(changedNode): NodeId[]
   └─ topologicalOrder(nodes): NodeId[]
```

## Symbol Layer (Extensible)

Main requirement: symbol concepts must be extensible and not buried in core model.

```ts
SymbolRegistry
├─ schemas: Map<SymbolKind, SymbolSchema>
├─ defsByNode: Map<NodeId, SymbolDef[]>
├─ defsByKind: Map<SymbolKind, Map<Ident, SymbolDef[]>>
├─ refsByNode: Map<NodeId, SymbolRef[]>
├─ refsByKind: Map<SymbolKind, Map<Ident, SymbolRef[]>>
├─ providersBySymbolKey: Map<SymbolKey, Provider[]>
└─ resolvers: Map<SymbolKind, SymbolResolver>
```

```ts
type SymbolKind = string;
type SymbolKey = `${SymbolKind}:${string}`;
```

```ts
SymbolSchema
├─ kind: SymbolKind
├─ displayName: string
├─ scopes: ("form" | "workflow" | "dataview" | "global")[]
├─ comparableByParent: boolean
├─ duplicatePolicy: "same-parent" | "same-form" | "global" | "custom"
└─ validators: string[]
```

```ts
SymbolDef
├─ key: SymbolKey
├─ kind: SymbolKind
├─ ident: string
├─ nodeId: NodeId
├─ docUri?: Uri
├─ formIdent?: string
├─ parentPath?: string
├─ range: Range
├─ origin: "local" | "injected" | "generated" | "final-only"
├─ provenance?: Provider[]
└─ tags?: string[]
```

```ts
SymbolRef
├─ target: SymbolKey
├─ kind: SymbolKind
├─ ident: string
├─ nodeId: NodeId
├─ docUri?: Uri
├─ formIdent?: string
├─ parentPath?: string
├─ range: Range
├─ source: "template" | "runtime" | "generator"
└─ resolution: "resolved" | "missing" | "ambiguous"
```

```ts
SymbolResolver
├─ collectDefs(node: ModelNode): SymbolDef[]
├─ collectRefs(node: ModelNode): SymbolRef[]
├─ resolve(ref: SymbolRef, ctx: ResolveContext): ResolveResult
└─ compareForDuplicate(a: SymbolDef, b: SymbolDef): boolean
```

## Diagnostics Split

```ts
DiagnosticsState
├─ rules
│  ├─ sourceOnlyRuleIds: Set<string>
│  └─ composedOnlyRuleIds: Set<string>
├─ byUri: Map<Uri, {
│   sourceOnly: Diagnostic[];
│   composedOnly: Diagnostic[];
│   merged: Diagnostic[];
│   signature: string;
│ }>
└─ publishQueue: Uri[]
```

Rules that depend on final composition (`unknown-form-*`, sharecode link checks, etc.) should read composed/final symbol data only.

## Composition State

```ts
CompositionState
├─ treeNodesByUri: Map<Uri, CompositionSnapshot>
├─ expansionState: Map<string, boolean>
├─ usageIndex
│  ├─ symbolUsages: Map<SymbolKey, UsageRef[]>
│  ├─ featureUsages: Map<FeatureKey, UsageRef[]>
│  └─ contributionUsages: Map<ContributionKey, UsageRef[]>
└─ lastRefreshAt?: number
```

## Fact Registry (Extensible Facts)

Goal: keep core model clean and move document facts into pluggable providers.

```ts
FactRegistry
├─ providers: Map<FactKind, FactProvider>
├─ factsByNode: Map<NodeId, Map<FactKind, unknown>>
├─ usageStats
│  ├─ requestedByConsumer: Map<ConsumerId, Set<FactKind>>
│  ├─ hitsByFactKind: Map<FactKind, number>
│  ├─ missesByFactKind: Map<FactKind, number>
│  └─ deadFactKinds: Set<FactKind>
└─ get(nodeId, factKind, consumerId): FactValue | MissingFact
```

```ts
type FactKind = string;
type ConsumerId = string; // e.g. "validation:unknown-form-button-ident", "tree:composition"
```

```ts
FactProvider
├─ kind: FactKind
├─ provides: FactKind[]
├─ requires: FactKind[]
├─ collect(node: ModelNode, ctx: FactContext): FactValue
└─ invalidateOn: ("textChange" | "composeChange" | "settingsChange")[]
```

`ParsedDocumentFacts` in the current codebase should be split into multiple fact providers (examples):

- `fact.rootMeta`
- `fact.symbolDecls`
- `fact.workflowRefs`
- `fact.usingRefs`
- `fact.includeRefs`
- `fact.placeholderRefs`
- `fact.mappingRefs`
- `fact.shareCodeDecls`
- `fact.rangeIndex`

This enables independent evolution and targeted invalidation.

## Validation Modules

Validation should be module-driven with explicit dependencies.

```ts
ValidationModule
├─ id: string
├─ needsFacts: FactKind[]
├─ needsSymbols?: SymbolKind[]
├─ init(ctx: ModuleInitContext): InitResult
└─ run(nodeId: NodeId, ctx: ValidationContext): Diagnostic[]
```

```ts
type InitResult =
  | { ok: true }
  | { ok: false; missingFacts: FactKind[]; message?: string };
```

Rules:

- Module initialization fails fast if required facts/providers are missing.
- Missing dependencies are logged once at startup/reload.
- Runtime execution should not silently fallback to unrelated data.

## Consumer Contracts

All major features should declare required facts/symbols:

- diagnostics modules
- tree view model builders
- completion providers
- references/rename providers

Each consumer calls `FactRegistry.get(..., consumerId)` so usage is tracked centrally.

## Fact Usage Analytics

Purpose: detect dead or redundant fact providers and keep the model lean.

Collected metrics:

- requested fact kinds by consumer
- hit/miss rates per fact kind
- facts never requested (`deadFactKinds`)
- hot facts (high request count) for optimization

Suggested maintenance workflow:

1. Run integration suite with analytics enabled.
2. Export fact usage report.
3. Remove/merge dead fact kinds.
4. Re-run to verify no module init failures.

## TreeView 1:1 Contract

TreeView must be a strict projection of `ComposedWorkspaceModel` reality.

Principles:

1. No hidden computation in TreeView layer.
2. No fallback/heuristic derivation in TreeView layer.
3. Every rendered item must map to explicit model data.
4. Missing model data must be rendered as `unknown`/`missing-fact`, never silently inferred.
5. Navigation actions must use model references only.

Implementation shape:

```ts
TreeViewAdapter
├─ input: ModelSnapshot
├─ output: TreeItem[]
└─ rules:
   ├─ each item has sourceNodeId
   ├─ each derived label/state points to factKind/symbolKind key
   ├─ open-source uses model range/location only
   └─ usages use SymbolRegistry/CompositionState only
```

Required metadata on tree items:

- `sourceNodeId`
- `sourceUri?`
- `factKind?`
- `symbolKind?`
- `statusSourceKey` (model key used for status label)

Debug expectation:

- If a user reports wrong TreeView data, investigation starts at model snapshot.
- TreeView itself should be deterministic and side-effect free.

## Module-First Architecture (Implementation Strategy)

Refactor target: minimal core + pluggable modules for all domain logic.

### Core (minimal responsibilities)

1. `ModelCore`
- Stores `nodesById`, indexes, dependency graph, model versioning.
- Provides cache invalidation primitives.
- No XML rule-specific logic.

2. `UpdateRunner`
- Single pipeline for all events (`change/save/create/delete/rename`):
  - `collectChanges -> affectedSubgraph -> recomputeFacts -> compose -> rebuildSymbols -> runValidators -> publish`
- Only one execution path, no parallel fallback paths.

3. `ModuleHost`
- Registers modules.
- Verifies module dependency contracts (`needsFacts`, `needsSymbols`).
- Orders execution based on dependencies.

### Module Categories

1. `Fact Modules`
- Each fact domain is independent provider (`rootMeta`, `usingRefs`, `workflowRefs`, `mappingRefs`, `shareCodes`, ...).
- Core caches provider outputs per `nodeId + factKind`.

2. `Compose Modules`
- Template composition/build.
- Inherited using resolver.
- Placeholder/include resolver.
- Generator execution module (using strict mutation API).
- Produces `finalXmlText`, `finalFacts`, provenance records.

3. `Symbol Modules`
- One module per symbol family (`control`, `button`, `section`, `actionShareCode`, ...).
- Responsibilities:
  - collect defs
  - collect refs
  - resolve refs
  - duplicate policy

4. `Validation Modules`
- Rule groups implemented as modules.
- Explicit `needsFacts` and `needsSymbols`.
- Explicit mode metadata: `source-only` vs `composed-only`.

5. `Projection Modules`
- TreeView adapter (strict 1:1 model projection).
- Completion adapter.
- References/Rename adapter.

6. `Publish Modules`
- Diagnostics publisher.
- Output/log channels.
- Metrics/perf sink.

### Unified Module Contract

```ts
Module
├─ id: string
├─ type: "fact" | "compose" | "symbol" | "validation" | "projection" | "publish"
├─ needsFacts?: FactKind[]
├─ needsSymbols?: SymbolKind[]
├─ provides?: string[]
├─ init(ctx): InitResult
├─ onUpdate(ctx, batch): ModuleResult
├─ metrics?: ModuleMetricsHooks
└─ dispose?(): void
```

```ts
ModuleMetricsHooks
├─ onInit(startedAt, endedAt, result): void
├─ onUpdate(startedAt, endedAt, batchSize, changedNodes, result): void
├─ onCacheHit(kind, key): void
├─ onCacheMiss(kind, key): void
└─ onError(phase, error): void
```

### Debug-by-Module

- Per-module log prefix, e.g. `[mod:validation.workflow.refs]`.
- Per-module timing and hit/miss counters.
- Debug settings can enable/disable modules individually.

### Performance Metrics (Mandatory)

All modules must publish performance metrics. No module is exempt.

Required metrics per module:

- `initMs`
- `updateMs` (avg, p95, max)
- `changedNodesCount`
- `cacheHitRate` (`hits`, `misses`)
- `diagnosticsProducedCount` (for validation/publish modules)
- `composeArtifactsCount` (for compose modules)
- `symbolDefsCount` / `symbolRefsCount` (for symbol modules)
- `errorCount`

Global pipeline metrics:

- end-to-end latency per update event (`change`, `save`, `create`, `delete`, `rename`)
- time split by phases:
  - `collectChangesMs`
  - `affectedSubgraphMs`
  - `factsMs`
  - `composeMs`
  - `symbolsMs`
  - `validationMs`
  - `publishMs`
- queue wait time (if any)
- total diagnostics publish time

Output expectations:

- live counters in debug output channel
- periodic summarized snapshot (top slow modules, p95)
- optional JSON export command for offline analysis

### Performance Budgets (Required)

Metrics must be evaluated against explicit budgets:

- `save -> diagnostics publish` (open document path): `<= 300 ms p95`
- `change -> diagnostics publish` (open document path): `<= 200 ms p95`
- `compose phase` for single affected form subtree: `<= 150 ms p95`
- `validation phase` for single affected open document: `<= 80 ms p95`

Budgets may be configurable in debug mode, but production defaults must stay strict.

## Core Consistency Rules

### Single Writer Rule

Only `UpdateRunner` may mutate `ComposedWorkspaceModel`.

- Modules must not mutate model state directly.
- Modules return deterministic outputs (`ModuleResult` / diff-like payload).
- `UpdateRunner` applies all changes in controlled order.

This prevents race conditions and stale-write timing bugs.

### Snapshot Consistency Contract

All consumers (`TreeView`, diagnostics publisher, completion, references/rename) must read from one immutable snapshot version.

- Every read operation binds to a single `model.version`.
- No mixed-version reads in one request.
- If model version changes mid-request, consumer retries or completes on previous snapshot; it must never mix both.

This guarantees deterministic output in UI and diagnostics.

### Mapping to Current Refactor Gaps

- Orchestrator complexity -> `UpdateRunner`.
- In-memory incremental cache -> `ModelCore` + fact/compose caches.
- Generator contract -> `Compose Module` + strict mutation API.
- Symbol hardcoding -> `Symbol Modules`.
- Validation hardcoding -> `Validation Modules`.
- Source/composed inconsistency -> validation metadata (`source-only` / `composed-only`).
- TreeView drift -> `Projection Module` with 1:1 contract.
- Completion/refs/rename divergence -> projection over `FactRegistry + SymbolRegistry`.
- Observability gaps -> `Publish/Metrics Module`.

## Command Catalog (Preserve in Refactor)

All existing commands must remain available with the same command IDs.

### Public/User Commands

- `sfpXmlLinter.buildXmlTemplates`  
  Build XML templates for current/selected targets.
- `sfpXmlLinter.buildXmlTemplatesAll`  
  Full template build for workspace.
- `sfpXmlLinter.compareTemplateWithBuiltXml`  
  Compare current template against built runtime XML.
- `sfpXmlLinter.createDocumentGeneratorTemplate`  
  Create JS/TS document generator template.
- `sfpXmlLinter.createSnippetGeneratorTemplate`  
  Create JS/TS snippet generator template.
- `sfpXmlLinter.showBuildQueueLog`  
  Open build output channel.
- `sfpXmlLinter.showIndexLog`  
  Open index output channel.
- `sfpXmlLinter.showCompositionLog`  
  Open composition output channel.
- `sfpXmlLinter.generateFeatureManifestBootstrap`  
  Generate feature manifest bootstrap from active feature source.
- `sfpXmlLinter.refreshCompositionView`  
  Refresh composition tree projection.
- `sfpXmlLinter.compositionOpenSource`  
  Open selected composition source location.
- `sfpXmlLinter.compositionOpenSourceBeside`  
  Open selected source beside.
- `sfpXmlLinter.compositionOpenSourceSidePreview`  
  Open selected source in side preview.
- `sfpXmlLinter.compositionShowUsages`  
  Show usages of selected composition element.
- `sfpXmlLinter.rebuildIndex`  
  Rebuild full index.
- `sfpXmlLinter.revalidateWorkspace`  
  Revalidate whole workspace.
- `sfpXmlLinter.revalidateProject`  
  Revalidate current project scope.
- `sfpXmlLinter.switchProjectScopeToActiveFile`  
  Set active project scope by current file.
- `sfpXmlLinter.workspaceDiagnosticsReport`  
  Generate workspace diagnostics report.
- `sfpXmlLinter.formatDocumentTolerant`  
  Run tolerant formatter on full document.
- `sfpXmlLinter.formatSelectionTolerant`  
  Run tolerant formatter on selection.

### Internal/Integration Commands (also preserve IDs)

- `sfpXmlLinter.suppressNextSqlSuggest`  
  Internal helper to suppress one SQL suggest auto-trigger.
- `sfpXmlLinter.compositionCopySummary`  
  Copy composition summary text payload to clipboard.
- `sfpXmlLinter.compositionLogNonEffectiveUsings`  
  Log non-effective using summary payload to composition output.
- `sfpXmlLinter.compositionApplyPrimitiveQuickFix`  
  Apply primitive quick-fix action from tree payload.

### Command Ownership in Module Architecture

- Build/compare/generator commands -> `Compose Modules` + `Publish Modules`
- Index/revalidate/scope commands -> `UpdateRunner` + `ModelCore`
- Tree/usage/source commands -> `Projection Modules` (TreeView adapter)
- Format commands -> formatter module (independent utility module)
- Internal payload commands -> projection/publish helper modules

### Contract

- Command IDs are stable API.
- Command behavior should be re-implemented through module interfaces, not direct legacy internals.
- If command internals change, user-visible semantics must remain equivalent.

## Implementation Blueprint

This section defines concrete implementation choices for the refactor.

### 1) Error Handling Policy

Use a result-based module contract:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

Module lifecycle:

- `init` failure on required module => `fatal` => pipeline stops.
- `onUpdate` recoverable failure => module skipped for run, warning logged, pipeline continues.

`UpdateRunner` returns:

```ts
type UpdateOutcome = "applied" | "partial" | "failed";
```

Publish layer emits internal pipeline status diagnostics/logs for debugging.

### 2) Concurrency Model

`UpdateRunner` runs as single-flight worker per workspace.

Queue behavior:

- Coalescing key: `NodeId + ChangeType`
- Keep latest pending update for same key (drop obsolete intermediates)
- Save events have higher priority than change events

Cancellation:

- Every module `onUpdate` receives cancellation token
- Newer update can cancel running low-priority phases

Goal: prevent stale-state races and "one save late" effects.

### 3) Persistence Scope

In-memory only:

- `nodesById`
- facts cache
- symbol registry
- diagnostics snapshot

Optional persisted (bounded, diagnostic-only):

- rolling perf aggregates
- module health stats
- trace samples ring buffer

Do not persist facts/symbol resolved state across restarts (avoids stale cache corruption).

### 4) Test Strategy Map

Required layers:

1. Unit tests per module:
- provider/resolver/validator behavior
- init dependency checks
- missing dependency failures

2. Integration tests:
- `UpdateRunner` over fixture dependency graphs
- incremental invalidation and recompute correctness

3. End-to-end tests:
- VS Code command flows (save/comment/uncomment/build/revalidate)
- diagnostics + tree projection consistency

4. Performance gate tests:
- p95 budgets enforced in CI for hot scenarios

Mandatory golden scenarios:

- template valid -> composed invalid transition
- composed invalid -> composed valid transition
- injected symbol references availability for template diagnostics

### 5) Debug / Trace Format

Machine-readable JSONL trace event:

```json
{
  "ts": "2026-03-19T12:34:56.789Z",
  "runId": "run-00124",
  "version": 123,
  "module": "validation.workflow.refs",
  "phase": "onUpdate",
  "nodeId": "node:xml_templates/300_ITSMIncident/ITSMIncidentWorkFlow.xml",
  "durationMs": 12,
  "result": "ok",
  "changedNodes": 3
}
```

Human-readable output channel prefix:

- `[run:124][mod:validation.workflow.refs][12ms] ...`

Support commands:

- `sfpXmlLinter.exportTrace` -> export last N runs as JSON
- `sfpXmlLinter.showPipelineStats` -> top slow modules, p95, cache hit/miss

## Implementation Roadmap (Phases)

## Execution Status (2026-03-19)

- Phase 1 completed: `ModelCore`, `UpdateRunner`, module host, pipeline metrics, and unified event routing are active.
- Phase 2 completed: `FactRegistry` + default fact providers + `SymbolRegistry` resolvers are wired and test-covered.
- Phase 3 completed: validation is module-driven (`validation.*`) through `ValidationHost` + queue orchestrator.
- Phase 4 completed: Tree projection adapter, references/rename/definition providers, and completion symbol hooks read from shared model services.
- Phase 5 completed for core goals: performance metrics/traces are available and legacy validation module wiring has been removed.

Validation gates used for this status:

- `npm run compile`
- `npm run test:providers`
- `npm run test:linter`
- `npm run test:composition`

### Phase 1: Core Runtime Framework

1. Implement `ModelCore` (node store, indexes, versioning).
2. Implement `UpdateRunner` (single-flight pipeline, queue, cancellation).
3. Implement `ModuleHost` (registration, dependency checks, execution ordering).
4. Add baseline tracing and pipeline timing metrics.
5. Route all update events (`change/save/fs`) through `UpdateRunner` only.

Expected output:

- One canonical execution path for updates.
- Legacy logic can still exist inside temporary compatibility modules.

### Phase 2: Facts + Compose + Symbols

1. Implement `FactRegistry` and initial fact modules:
   - root metadata
   - using/include refs
   - workflow refs
   - placeholders
2. Implement compose modules for final XML + provenance.
3. Implement `SymbolRegistry` and symbol modules:
   - control
   - button
   - section
   - sharecodes
4. Enable dependency-driven invalidation per `nodeId + factKind`.
5. Enable cache hit/miss analytics.

Expected output:

- Composed/final state and symbols available from unified model.
- Legacy maps remain temporary fallback only.

### Phase 3: Validation Modularization

1. Split diagnostics into validation modules.
2. Enforce module dependencies (`needsFacts`, `needsSymbols`).
3. Enforce explicit `source-only` vs `composed-only` rule modes.
4. Move reference buckets (`unknown-form-*` etc.) to composed symbols.
5. Remove cross-layer validation fallbacks.

Expected output:

- Deterministic diagnostics with explicit data dependencies.

### Phase 4: Consumer Migration

1. TreeView rewrite as strict 1:1 snapshot projection.
2. Completion provider migration to `FactRegistry + SymbolRegistry`.
3. References/Rename migration to symbol usage index.
4. Add item-level source metadata (`nodeId/factKind/symbolKind`) for debugging.
5. Remove consumer-side heuristics/fallbacks.

Expected output:

- TreeView, completion, references, rename all read the same model truth.

### Phase 5: Stabilization + Performance

1. Enforce CI performance gates (p95 budgets).
2. Add E2E scenarios for complex templating transitions.
3. Evaluate dead facts/modules via usage analytics.
4. Remove legacy compatibility provider(s).
5. Final cleanup and release hardening.

Expected output:

- Fully refactored extension with measurable budgets and no legacy branches.

## Migration Notes

- Keep a temporary compatibility provider `fact.legacyParsedDocumentFacts` while migrating.
- New modules should depend on fine-grained facts only.
- Remove legacy provider once no consumer requests it.

## Performance Tracking

```ts
ModelPerfCounters
├─ parseMs
├─ composeMs
├─ validateSourceMs
├─ validateComposedMs
├─ publishDiagnosticsMs
├─ cacheHitRate
└─ lastHotPaths: string[]
```

## Expected Benefits

- Single source of truth for all language features.
- No template/runtime fallback race conditions for reference diagnostics.
- Faster updates via in-memory caches and dependency-driven recompute.
- Easy extensibility for new symbol kinds without changing core model.
- Support for non-file entities (dynamic generator outputs, virtual nodes) without redesign.
