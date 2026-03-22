# Changelog

## Unreleased

- Single-source-of-truth contract hardening:
  - added aggregated contract snapshot guard (`runContractGuardsSnapshotTests`) that verifies contract guard inventory and `test:composition` wiring.
  - added focused guard entrypoint `npm run test:contracts` for fast contract-only verification.
  - expanded contract guard suite for:
    - diagnostics publish boundary
    - composition datasource boundary
    - validation data-access boundary
    - extension event-handler/orchestrator boundary
    - workspace scan boundary
    - fallback-parse boundary

## 0.1.14

- Packaging and publish optimization:
  - added extension bundling with `esbuild` (`dist/extension.js`) and enabled it in `vscode:prepublish`.
  - switched extension entrypoint from `out/extension.js` to bundled `dist/extension.js`.
  - updated `.vscodeignore` to exclude `out/**` from VSIX and include only runtime `dist/**`.
  - significantly reduced packaged file count and VSIX size for faster install/update.

## 0.1.13

- Expected XPath diagnostics:
  - fixed `missing-feature-expected-xpath` evaluation against related runtime context (`XML/...`) to reduce false positives.
  - improved XPath matching for `[@Ident='...']` predicates appearing in the middle of XPath expressions.
  - added fallback matching against parsed runtime facts for share code/control/button/section targets.
- Problems related information:
  - `missing-feature-expected-xpath` now links primarily to the source contribution definition in feature/component files.
  - context document link is kept as fallback when contribution location is unavailable.
- Feature contribution usage:
  - fixed `unused-feature-contribution` false positives for root-level target paths (`//Form`, `//WorkFlow`, `//DataView`, `//Filter`).

## 0.1.11

- Provenance tracing and TreeView origin improvements:
  - added build mutation tracing (`using/include/placeholder/primitive`) and symbol provenance provider mapping for final runtime symbols.
  - introduced async provenance hydration worker to avoid blocking reindex/startup; prioritizes active document, then hydrates workspace in background.
  - normalized provenance URI keys (stable file-path keys) and case-insensitive symbol keys for reliable lookup on Windows.
  - added new TreeView origin `resolved` for final symbols with known provenance; `final` now remains only for unresolved origin.
- Build service:
  - added mutation telemetry collection API for template outputs, reused by reindex hydration and build flows.

## 0.1.10

- TreeView and effective model integration:
  - TreeView now overlays Form symbols from final runtime index (`XML`) for the same `FormIdent`, so final buttons/controls/sections are visible consistently.
  - added explicit `final` symbol origin in composition tree for symbols resolved from final index only.
  - improved owner-form resolution flow reused across diagnostics/completion/tree model paths.
- Template/comment handling hardening:
  - template builder now ignores XML comments for `Using` parsing, `Include` scanning, placeholder scanning, and component reference extraction.
  - component section parsing now ignores commented `<Contribution>/<Section>` blocks.
  - fixed false-positive build application from commented `Using` directives.
- Tests:
  - added regression test for primitive-based local button facts (`UsePrimitive` button idents).
  - added template core regressions for commented using and commented component contribution behavior.

## 0.1.9

- Contribution patching:
  - added `ContributionPatch` support in template build pipeline.
  - added `AppendSlot` operation to extend existing contribution content at predefined extension points.
  - introduced `ContributionSlot` build-time marker for contribution-level slot extension (separate from primitive `Slot`).
  - contribution patch blocks are removed from final XML output after build.
- New compare command:
  - added `SFP XML Linter: Compare Current XML vs Built XML`.
  - compares active XML with in-memory final built XML using the same build/generator pipeline.
  - works from both `XML_Templates` and matching files under `XML`.
- Docs and tests:
  - updated `Docs/T9AuthoringSugarExamples.md` with `ContributionPatch` / `ContributionSlot` examples.
  - added template core regression test for contribution patch append-slot behavior.

## 0.1.8

- Startup and indexing performance:
  - reduced deferred full reindex delay after bootstrap startup indexing (new default: `startup.fullReindexDelayMs = 1000`).
  - added startup progress verbosity toggle (`startup.verboseProgress`, default `false`) to avoid heavy per-phase startup logging overhead.
  - optimized workspace indexer using-trace computation:
    - removed redundant full first trace pass,
    - computes trace in one pass after forms are known,
    - narrows trace processing only to eligible files (local/inherited using relevance).
  - added parsed-entry cache in workspace indexer keyed by file signature (`mtime` + `size`) to reduce repeated read/parse work across bootstrap/full passes.
- Performance testing:
  - replaced `tests/fixtures/linter-performance` dataset with full `SFPExampleProject` snapshot (including generators/primitives) for realistic coverage.
  - expanded linter perf benchmark with:
    - XML rebuild timing (`xml/rebuild`),
    - real startup pipeline timing (`real-startup`: bootstrap + full + registry + open-doc validation + background validation).
  - refreshed generated runtime XML in `linter-performance` fixture to keep perf runs clean (no restore required after benchmark).

## 0.1.7

- Template builder inherited `Using` refactor:
  - switched inherited `Using` source for build from ad-hoc template file scanning to indexed snapshot (`templateIndexer`) to keep one source of truth across build/validation/tree view.
  - preserved inherited custom `Using` attributes/params during build by indexing full `Using` attribute sets.
  - removed builder-side fallback form-using scan/cache path.
- Auto-build on save:
  - saving `Form` template now queues related templates of the same `FormIdent` (`Form` + `WorkFlow` + `DataView`) so inherited `Using` changes are propagated immediately.

## 0.1.6

- Duplicate-ident scope fix:
  - fixed false-positive `duplicate-button-ident` cases where using-injected root buttons were incorrectly scoped to nested section button containers.
  - duplicate scope matching now uses concrete parent container instances (`controls@...`, `buttons@...`, `sections@...`) and root container keys derived from parsed document structure.
  - improved consistency for composition-injected symbol diagnostics against real template target XPath placement.

## 0.1.5

- Diagnostics and composition consistency:
  - unified duplicate-ident validation between template XML and effective composed output.
  - duplicate detection is now parent-scope aware for `Control`, `Button`, and `Section` (same Ident in different parent containers no longer reports false positives).
  - added regression fixtures for using-injected duplicates and scoped duplicate-valid scenarios.
- Using parameter diagnostics:
  - improved `missing-using-param` validation based on effective active/inherited usings and contribution insert impact.
- Test output UX:
  - unified colored test output across runners through shared console color bootstrap (`green` pass, `red` fail, `yellow` warning/skip).

## 0.1.4

- Auto-build dependency chain:
  - improved component-save dependent template selection to include templates affected via inherited `Using` (`Form` -> `WorkFlow`/`DataView`), not only direct references.
  - extended index usage ownership mapping for `DataView` (`FormIdent`) so inherited dependency fan-out is correctly discoverable from index.

## 0.1.3

- Template builder inherited using parameters:
  - fixed inherited `Using` transfer so custom attributes/params from Form are preserved when inherited into `WorkFlow`/`DataView` build path.
  - inherited `Using` projection still respects `SuppressInheritance` and local deduplication.
- Tests:
  - expanded inherited-using regression to verify parameter propagation (`{{...}}` substitution) from inherited `Using` attributes.

## 0.1.2

- Template builder inherited usings:
  - fixed runtime build path so `WorkFlow`/`DataView` templates correctly apply `Using` inherited from owning `Form` (`FormIdent`).
  - inherited `Using` resolution now respects local `SuppressInheritance` and avoids duplicate activation when local and inherited entries overlap.
- Tests:
  - added regression case for inherited `Using` application in template core tests.

## 0.1.1

- Template builder:
  - `sfpXmlLinter.templateBuilder.postBuildFormat` is now enabled by default (`true`), so final build outputs are formatted by the internal tolerant formatter unless explicitly disabled.
- Performance and responsiveness:
  - reduced repeated validation scheduling on editor/tab visibility changes.
  - reduced Composition Tree refresh churn with debounced refresh and in-memory tree/use-location caching.
  - lowered noisy standalone validation skip logs.

## 0.1.0

- Template generators (T11) completion:
  - finalized generator v2 contract with explicit kinds:
    - `document` (`kind + applies(ctx)? + run(ctx)`)
    - `snippet` (`kind + selector + run(ctx)`)
  - added generator scaffolding commands:
    - `SFP XML Linter: Create Generator Template (Document)`
    - `SFP XML Linter: Create Generator Template (Snippet)`
  - added generator authoring docs:
    - `Docs/TemplateGenerators.MD`
  - added new M11 regression coverage:
    - multi-generator determinism (`document + snippet`) in one file
    - fail-safe scenario where one generator throws but build continues
    - performance checkpoint script (`npm run test:templates:perf`)
- Templating naming migration:
  - added first-class support for `Feature` / `Contribution` authoring while keeping legacy `Component` / `Section` compatibility.
  - added `Feature="..."` alias support for `Using` / `Include` and `{{Feature:...}}` placeholder references.
- Diagnostics naming cleanup:
  - renamed `unknown-using-component` -> `unknown-using-feature`
  - renamed `unknown-using-section` -> `unknown-using-contribution`
  - kept legacy settings compatibility for old rule ids.
- Indexing and validation fixes:
  - updated runtime/workspace indexing to recognize `Feature` roots and `Contribution` blocks, so real validation matches fixture behavior.
  - fixed `unused-using` / `partial-using` fixture coverage to validate the intended rule instead of side-effect diagnostics.
  - added `Include` reference indexing in parsed facts so composition/index model stays in sync with template build behavior.
- Tests and fixtures:
  - migrated linter/template/composition fixtures to the new `Feature` / `Contribution` naming.
  - refreshed invalid fixture mappings and regression coverage for `unused-using` / `partial-using`.
- Composition effective trace and using impact:
  - indexed per-contribution insert trace (`strategy`, XPath matches, clamped count, placeholder count, fallback symbol count, final insert count).
  - Tree View `Using/Contribution -> Meta` now shows indexed insert trace details and uses insert count as the single effective/unused signal.
  - Tree View now includes dedicated `Includes` group for normal XML documents.
- Feature conflict handling:
  - `duplicate-provider` conflict message now includes source file and applies-to context for each conflicting provider.
  - suppressed false-positive `duplicate-provider` conflict for control providers limited to `form` + `filter` context overlap.
- Feature manifest bootstrap:
  - added command `SFP XML Linter: Generate Feature Manifest Bootstrap`.
  - generates `*.feature.json` draft from XML-first feature composition near the active feature file (with overwrite confirmation).
  - added composition bootstrap regression tests.
- Using impact + inheritance diagnostics:
  - `unused-using` / `partial-using` now consume indexed insert traces as primary source.
  - added form-owned inheritance diagnostics for `WorkFlow` and `DataView` (`*-redundant-feature-using`), default severity `warning`.
  - added composition diagnostics tests covering redundant inheritance scenarios.
- Primitive diagnostics + Tree View:
  - added primitive linter rules: `unknown-primitive`, `primitive-missing-slot`, `primitive-missing-param`, `primitive-cycle`.
  - Composition Tree `Using/Contribution` now shows primitive usage summary (`uses`, effective `inserts`) and source navigation.
  - indexed contribution summaries now include primitive usage metadata.
- Primitive regression coverage:
  - added linter fixtures for primitive diagnostics (`chyba-36`..`chyba-39` + fixture primitives).
  - added dedicated primitive template tests (`runBuildTemplatePrimitiveTests`).
  - added fixture-level primitive edge scenarios (`998_T9PrimitiveEdge`).

## 0.0.16

- VSIX packaging fix:
  - included runtime dependencies `@xmldom/xmldom` and `xpath` in the packaged extension.
  - fixes activation failure `Cannot find module '@xmldom/xmldom'` after installing the VSIX.

## 0.0.15

- Template builder XPath targeting:
  - replaced legacy pseudo-`TargetXPath` matching with real XPath evaluation.
  - when multiple nodes match, builder now logs a debug message and uses the first match by default.
  - added `AllowMultipleInserts="true"` for template component sections to apply one insert to all matched nodes (for example XPath unions using `|`).
- Template builder internals:
  - build output now surfaces XPath debug lines in the build log.
- Added regression coverage for:
  - multi-match XPath first-result behavior
  - multi-match XPath insertion with `AllowMultipleInserts`

## 0.0.14

- Template builder `Component` collision fix:
  - fixed case where SFP runtime `<Component>...</Component>` inside a form was corrupted by templating cleanup.
  - outer templating `<Component>` wrapper stripping is now limited to the actual root wrapper only and no longer removes nested SFP component closing tags.
- Added regression coverage for nested SFP component rendering inside form template components.

## 0.0.13

- Template builder line endings:
  - output XML now preserves line endings from the source template file (`LF`/`CRLF`).
- Template tests:
  - added dedicated template service EOL regression tests (`test:templates:service`).
  - template fixture comparison is now strict (`expected === actual`), including line endings.

## 0.0.12

- Template builder fix:
  - preserved valid root `<Component>` templates during output sanitization.
  - component-wrapper cleanup now runs only for non-`Component` template roots.
- Added regression coverage for `Component`-root template rendering in template core tests.
- Updated template fixture expectations for `ITSMKnowledgeBaseComponent.xml`.

## 0.0.11

- SQL highlighting improvements:
  - Added dedicated `UPDATE` token highlighting in embedded SQL/Command blocks.
  - Fixed SQL semantic highlighting to ignore SQL comments (`-- ...`, `/* ... */`) so placeholders/strings are not highlighted inside comments.
- Completion/snippet improvements for workflow actions:
  - Expanded production-oriented `Action` snippets based on real fixture usage:
    - `ChangeState`, `ChangeState (StateDataSource)`, `ShareCode`, `ActionTrigger`, `ActionValue`, `GlobalValidation`, `Required`, `SetValue`, `IF`, `Communication`, `Email`, `Alert`, `ClearCache`, `GenerateForm`, `GenerateSubForm`.
  - Added richer `Action` attribute suggestions for common action types.
  - Improved action snippet ordering/priorities to prefer most common workflow patterns.
  - Updated `ActionValue` snippet to use `DataSource` (SQL + Parameters) instead of inline `Value`.
  - Suppressed `Value` attribute suggestion when editing `Action xsi:type=\"ActionValue\"`.
- Diagnostics message quality:
  - `ident-convention-lookup-control` now includes ident split details (`purpose`, `formOrTable`, `foreignKey`) and explicit "primary table/form not found" hint when applicable.
- Hover docs fallback:
  - Added built-in hover docs in source (based on `SFPDocs`) that are used automatically when external `hoverDocsFiles` are not found.

## 0.0.10

- Linter stability and consistency:
  - improved mapping/workflow ident resolution for defaults, system/external tables, and `Using`-injected symbols.
  - fixed self-closing `ButtonShareCode` parsing edge case causing false duplicate/sharecode expansion.
  - improved `.sfpxmlsetting`/`.sfpxmlsettings` discovery (workspace + nested locations), so external table metadata is loaded more reliably.
- Added fixture-based linter regression suite (`npm run test:linter`):
  - validates all `tests/fixtures/linter/XML_Templates/**/*.xml`.
  - valid fixtures must have zero diagnostics.
  - invalid fixtures (`900_chyby`) must produce exactly one expected diagnostic.
  - includes per-file progress output and final summary.

## 0.0.9

- Added configurable `sfpXmlLinter.incompleteMode`:
  - suppresses diagnostics tied to unknown `FormIdent` resolution in incomplete projects.
- Added workspace external table metadata support:
  - reads `.sfpxmlsetting` / `.sfpxmlsettings` from workspace root,
  - supports external tables and optional columns for lookup convention validation.
- Added command:
  - `SFP XML Linter: Revalidate Workspace (Full)`
  - performs full reindex and full revalidation across configured XML roots.

## 0.0.8

- Template builder updates:
  - Added support for custom inline params in placeholder section syntax, e.g.:
    - `{{Component:Common/Shared/Assign,Section:Html,CustomParam:ParamValue}}`
  - Section placeholders now correctly resolve inherited and explicit params in nested template composition.
  - Removed script/content XML entity encoding in builder output to keep generated runtime content raw.
- Testing:
  - Added dedicated template-core test suite (`npm run test:templates:core`) for isolated templating behavior checks.
  - `npm run test:templates` now runs both core templating tests and full production fixture parity tests.

## 0.0.7

- New tolerant XML formatter implementation (without legacy formatter parser dependency):
  - Added commands:
    - `SFP XML Linter: Format Document (Tolerant)`
    - `SFP XML Linter: Format Selection (Tolerant)`
  - Recovery-oriented parsing for invalid XML nesting, with stable fallback output.
  - Default attribute normalization and `type`/`xsi:type` first ordering.
  - `@FormatRule` support:
    - `disable` (skip formatting for next nearest node)
    - `preserve-inner` (preserve inner content formatting)
    - granular toggles:
      - `format-inner`
      - `no-type-first`
      - `no-attr-normalize`
      - `no-inline-text-normalize`
    - supports multiple rules in one directive (`@FormatRule:rule-a,rule-b`)
  - Built-in preserve-inner behavior for `SQL`, `SQLCommand`, and `HTMLTemplate` blocks.
  - Built-in preserve-inner behavior extended to `XMLDescription`.
  - `Command` block is now fully auto-suppressed by default (raw passthrough).
  - Added formatter setting `sfpXmlLinter.formatter.maxConsecutiveBlankLines` (default `2`) to clamp long blank-line runs.
- Added formatter fixture test suite (`tests/fixtures/formatter`) and runner (`npm run test:formatter`).
- Added extended formatter regression fixtures (`22`-`27`), including real project examples from `SFPExampleProject`.

## 0.0.6

- Snippet consistency fixes:
  - `TitleResourceKey` snippets now consistently use package suffix derived from `PackageIdent` without `Package` postfix (e.g. `ITSMPackage` -> `_ITSM`).
  - Updated button snippets to append package suffix in `TitleResourceKey`.
  - Simplified `FileControl` snippet:
    - removed `DataType` from default snippet
    - removed default `FileID` suffix from `Ident` and `TitleResourceKey` template.

## 0.0.5

- Validation updates:
  - `duplicate-section-ident` now follows group-local scoping (same behavior as button duplicate checks).
  - Added typo diagnostic `typo-maxlenght-attribute` for `Control`/`Parameter` attributes (`MaxLenght` -> `MaxLength`).
- IntelliSense updates:
  - Added `TableParameter` snippet for `dsp:TableParameter`.
  - Added `SetDataType` enum value suggestions for variable parameters:
    - `ActualData`, `OldData`, `ParentData`, `QueryStringData`, `POSTData`, `HTTPData`, `ExtensionData`, `HTMLAttribute`, `SelectedValueData`, `SpecifyData`.
  - Added `MaxLength` to control attribute completion suggestions.

## 0.0.4

- SQL IntelliSense stability and UX polish:
  - Fixed SQL suggestions inside `<![CDATA[ ... ]]>` blocks.
  - Improved live suggestions for inline value syntax (`@Param==Value`) while typing.
  - Fixed suggestion ranking/filtering edge cases for lowercase parameter typing.
  - Prevented repeated auto-popup after confirming SQL append completions.
  - Limited SQL auto-trigger behavior to active `@...` tokens only.

## 0.0.3

- FormIdent and system tables:
  - `FormIdent`/`MappingFormIdent` now accept system tables (`Account`) and schema-prefixed variants (`dbo.Account`).
  - Form identifier suggestions now include system tables and `dbo.*` aliases.
  - Reference search for form identifiers now handles equivalent system-table variants.
- Ident convention fixes:
  - Restored/fixed plural lookup handling for `ListBoxControl` and `DualListBoxControl` idents.
- Parameters and snippets:
  - Added production snippets for `VariableParameter`, `ValueParameter`, and common constants (`UserID`, `UserLanguageID`, `UICultureCode`).
  - Improved snippet ordering and matching for parameter workflows.
- SQL parameter IntelliSense:
  - `@` suggestions in `SQL`/`Command` now resolve parameters from the local parent scope.
  - New append actions from SQL suggestions:
    - `append as VariableParameter`
    - `append as ValueParameter`
    - `append as ConstantType`
  - Supports inline value syntax (`@Param==Value`) for fast ValueParameter creation with inferred `DataType` (`Number`/`String`).
  - Auto-create `<Parameters>` block when missing and preserve indentation/formatting when appending.
  - SQL suggestions are now case-insensitive and updated continuously while typing.
  - Auto-triggered SQL suggestions only activate inside active `@...` tokens (stops after whitespace).
  - Suppressed immediate re-open of suggestions after confirming append actions.

## 0.0.2

- Major indexing and responsiveness improvements:
  - Incremental save refresh for `Form` and `Component` documents.
  - Faster startup and rebuild behavior with reduced unnecessary full reindexes.
  - Split index domains (`template` vs `runtime`) to prevent cross-tree symbol collisions.
- SQL convention diagnostics:
  - New `sql-convention-equals-spacing` rule for `SQL`/`Command` blocks.
  - SQL-aware quick fixes (auto spacing fix and SQL inline ignore).
  - SQL comment-aware parsing for rule evaluation.
- XML quality-of-life:
  - Color preview and color picker support for hex color literals in XML.
  - `Ignore in file` quick fix now preserves XML declaration (`<?xml ...?>`) as first line.
- Internal stability fixes and diagnostics range accuracy improvements.

## 0.0.1

- Initial public release of SFP XML Linter.
- XML diagnostics with configurable severities and ignore directives.
- IntelliSense for XML elements, attributes, values, and snippets.
- Go to Definition, Find References, and Rename support for key SFP identifiers.
- Build XML Templates commands and auto-build integration on save.
- Embedded SQL/HTMLTemplate highlighting and SFP-specific semantic tokens.
- Workspace indexing with startup optimization (bootstrap + background full indexing).
