# SFP XML Linter

VS Code extension scaffold for SFP XML linting and semantic validation.

## Implemented foundation

- Configurable scan roots (`sfpXmlLinter.workspaceRoots`), defaults:
  - `XML`
  - `XML_Templates`
  - `XML_Components`
- Workspace indexer for:
  - `Form` symbols (`Controls`, `Buttons`, `Sections`)
  - `Feature` symbols (`Contribution` + contracts)
  - `Primitive` symbols (`UsePrimitive`, params, slots)
- Diagnostics:
  - `unknown-form-ident`
  - `unknown-form-control-ident`
  - `unknown-form-button-ident`
  - `unknown-form-section-ident`
  - `unknown-mapping-ident`
  - `unknown-mapping-form-ident`
  - `duplicate-control-ident`
  - `duplicate-button-ident`
  - `duplicate-section-ident`
  - `unknown-using-feature`
  - `unknown-using-contribution`
  - `contribution-mismatch`
  - `typo-maxlenght-attribute` (`MaxLenght` typo in `Control`/`Parameter`; expected `MaxLength`)
  - `sql-convention-equals-spacing` (`=` in `SQL`/`Command` must have spaces on both sides)
  - primitive diagnostics:
    - `unknown-primitive`
    - `primitive-missing-slot`
    - `primitive-missing-param`
    - `primitive-cycle`
  - feature-contract diagnostics:
    - `unknown-feature-requirement`
    - `missing-feature-dependency`
    - `missing-feature-expectation`
    - `missing-feature-expected-xpath`
    - `duplicate-feature-provider`
    - `ordering-conflict`
    - `orphan-feature-part`
    - `incomplete-feature`
  - inheritance/suppression diagnostics:
    - `workflow-redundant-feature-using`
    - `dataview-redundant-feature-using`
    - `feature-inheritance-override`
    - `suppression-conflict`
    - `suppression-noop`
  - `FormControl xsi:type="ShareCodeControl"` is validated against `WorkFlow/ControlShareCodes/ControlShareCode` (local + injected via `Using`)
- Per-rule severity config (`sfpXmlLinter.rules`) with values: `off`, `information`, `warning`, `error`
- Ignore directives:
  - `<!-- @Ignore rule-id -->` (applies to next non-empty line)
  - `<!-- @IgnoreFile rule-id -->` (applies to whole file)
  - `all` is supported as wildcard rule id
  - SQL inline ignore is supported in `SQL`/`Command` blocks:
    - `-- @Ignore rule-id`
    - `/* @Ignore rule-id */`
  - SQL semantic highlighting ignores SQL comments (`-- ...`, `/* ... */`) to avoid placeholder/string highlighting in commented SQL.
- Hover on diagnostics (message + rule id)
- Color preview and picker for hex literals in XML (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`)
- Completion (context-aware foundation):
  - root/child elements
  - attribute names by tag
  - enum values (`xsi:type`, `DataType`, `Insert`, ...)
  - semantic values (`FormIdent`, `Using Feature/Contribution`, WorkFlow `Ident` refs)
  - production-oriented workflow `Action` snippets (e.g. `ChangeState`, `ChangeState (StateDataSource)`, `ActionTrigger`, `ActionValue`, `GlobalValidation`, `Required`, `Communication`, `Email`, `Alert`, `GenerateForm`, `GenerateSubForm`, `IF`)
  - `ActionValue` snippet defaults to `DataSource` (`SQL` + `Parameters`) and does not suggest inline `Value` for `xsi:type="ActionValue"`
- Go to Definition:
  - `WorkFlow@FormIdent` -> `<Form Ident="...">`
  - any `FormIdent="..."` reference -> `<Form Ident="...">`
  - `FormControl/Button/Section Ident` in WorkFlow -> matching declaration in Form
  - `Mapping FromIdent/ToIdent` -> matching control declaration in owning Form
  - `Using Feature/Name` -> feature file
  - `Using Contribution` -> `<Contribution Name="...">` in feature
  - legacy `Using Component/Section` is still supported (temporary compatibility)
- Rename Symbol:
  - rename `Form Ident` and update all `FormIdent`/`MappingFormIdent` references
  - rename `Control/Button/Section Ident` from Form declaration
  - rename corresponding references in WorkFlow documents
  - for controls, rename `Mapping FromIdent/ToIdent` references (with `MappingFormIdent` support)
- Quick fixes:
  - Ignore rule on next line (`<!-- @Ignore rule-id -->`)
  - Ignore rule in file (`<!-- @IgnoreFile rule-id -->`)
  - Ignore all rules in file (`<!-- @IgnoreFile all -->`)
  - SQL convention quick fixes for `sql-convention-equals-spacing`:
    - auto-fix spacing around `=`
    - add SQL inline ignore (`/* @Ignore sql-convention-equals-spacing */`)
- Build command:
  - `SFP XML Linter: Build XML Templates`
  - `SFP XML Linter: Build XML Templates (All)`
  - Native TypeScript `BuildXmlTemplates` builder (no PowerShell fallback)
  - templating naming supports both:
    - current: `Feature` / `Contribution`
    - legacy (temporary): `Component` / `Section`
  - composition helpers:
    - `UsePrimitive` + `XML_Primitives` library
    - sugar pipeline: `Repeat`, `If`, `Case`
  - `TargetXPath` is evaluated as real XPath during section insertion
  - if multiple nodes match:
    - first match is used by default
    - `AllowMultipleInserts="true"` applies the insert to all matches
    - build log prints a debug line for the multi-match case
  - Placeholder sections support custom inline params:
    - `{{Component:Common/Shared/Assign,Section:Html,CustomParam:ParamValue}}`
    - `{{Feature:Common/Shared/Assign,Contribution:Html,CustomParam:ParamValue}}`
    - enables replacements inside inserted section content (e.g. `{{CustomParam}}`)
  - output quality options:
    - `sfpXmlLinter.templateBuilder.postBuildFormat`
    - `sfpXmlLinter.templateBuilder.provenanceMode` (`off` | `fileComment`)
  - builder modes:
    - `sfpXmlLinter.templateBuilder.mode` (`fast` | `debug` | `release`)
  - build/composition output channels:
    - `SFP XML Linter: Show Build Queue Log`
    - `SFP XML Linter: Show Composition Log`
- Generator scaffolding commands:
  - `SFP XML Linter: Create Generator Template (Document)`
  - `SFP XML Linter: Create Generator Template (Snippet)`
  - Creates hello-world templates in `XML_Generators`:
    - `hello.document.generator.js`
    - `hello.snippet.generator.js`
  - If file name already exists, numeric suffix is added automatically.
  - Full generator API and examples: `Docs/TemplateGenerators.MD`
  - user generator settings:
    - `sfpXmlLinter.templateBuilder.generators.enabled`
    - `sfpXmlLinter.templateBuilder.generators.timeoutMs`
    - `sfpXmlLinter.templateBuilder.generators.enableUserScripts`
    - `sfpXmlLinter.templateBuilder.generators.userScriptsRoots`
- Feature manifest bootstrap command:
  - `SFP XML Linter: Generate Feature Manifest Bootstrap`
  - Generates `*.feature.json` next to the active feature from current XML-first feature composition.
  - Uses the same auto-manifest inference as runtime (`Feature`/`Contribution`, contracts, `expectsXPath`, `requires`, `provides`).
  - If target file already exists, asks for explicit overwrite confirmation.
  - Full usage guide: `Docs/FeatureManifestBootstrap.md`
  - Authoring guide (contracts + diagnostics): `Docs/FeatureManifestAuthoring.md`
- Report command:
  - `SFP XML Linter: Workspace Diagnostics Report`
  - Prints diagnostics summary and per-rule counts to output channel
- Composition view commands:
  - `SFP XML Linter: Refresh Composition View`
  - `SFP XML Linter: Composition Open Source`
  - Tree View shows:
    - local/injected symbols
    - `Using` status (`effective` / `partial` / `unused`)
    - contribution meta and insert trace (`TargetXPath`, matches, inserts, placeholder usage)
- Index command:
  - `SFP XML Linter: Rebuild Full Index`
  - Forces full workspace reindex on demand
- Revalidate command:
  - `SFP XML Linter: Revalidate Workspace (Full)`
  - Runs full reindex and then revalidates all XML files in configured roots
- Tolerant formatter commands:
  - `SFP XML Linter: Format Document (Tolerant)`
  - `SFP XML Linter: Format Selection (Tolerant)`
  - Extension is registered as XML format provider (and default formatter via extension configuration defaults).
  - Handles invalid XML nesting with recovery/fallback behavior.
  - Supports `@FormatRule` directives:
    - `<!-- @FormatRule:disable -->`
    - `<!-- @FormatRule:preserve-inner -->`
    - `<!-- @FormatRule:format-inner -->`
    - `<!-- @FormatRule:no-type-first -->`
    - `<!-- @FormatRule:no-attr-normalize -->`
    - `<!-- @FormatRule:no-inline-text-normalize -->`
    - Multiple rules in one directive are supported (comma/space separated).
  - Preserves inner content for `SQL`, `SQLCommand`, `HTMLTemplate`, and `XMLDescription` (reindents leading whitespace only by default).
  - `Command` is auto-suppressed (no formatting is applied by default unless `@FormatRule:format-inner` is used).
  - Consecutive blank lines are preserved but clamped by `sfpXmlLinter.formatter.maxConsecutiveBlankLines` (default `2`).

## Startup behavior

- On startup, diagnostics are evaluated only for user-open documents (visible editors / open tabs).
- Files opened internally by indexer are ignored for diagnostics.
- Full workspace indexing runs in background (non-blocking startup).

## Incomplete Mode and External Tables

- VS Code setting: `sfpXmlLinter.incompleteMode` (`false` by default)
  - when enabled, suppresses diagnostics that require unknown `FormIdent` resolution (e.g. `unknown-form-ident`, `unknown-mapping-form-ident`, and dependent `unknown-mapping-ident` cases).
- External tables can be declared in workspace root file:
  - `.sfpxmlsetting` (preferred)
  - `.sfpxmlsettings` (also supported)

Minimal example:

```json
{
  "externalTables": {
    "ExternalTicket": ["ID", "Ident", "Code"],
    "dbo.LegacyOrder": {
      "columns": ["ID", "OrderNumber"]
    }
  }
}
```

Notes:
- Both `TableName` and `dbo.TableName` are accepted for `FormIdent`.
- External table columns are used by lookup-ident convention checks (`DropDown`/`AutoComplete`/`ListBox`/`DualListBox`).

## Index domains

- Indexing is isolated into 2 independent domains:
  - `template` domain: `XML_Templates` + `XML_Components`
  - `runtime` domain: `XML`
- Diagnostics, completion, definition, references, and rename use the domain of the current document.
- This prevents symbol collisions when the same `Form Ident` exists in both template and runtime trees.
- Reindex/rebuild operations update both domains, but symbol resolution never mixes them.

## Dev

```bash
npm install
npm run compile
npm run test:linter
npm run test:formatter
npm run test:templates
npm run test:templates:perf
```

Run extension in VS Code with `F5` (Extension Development Host).

## Hover docs files

Hover documentation is loaded from configurable JSON files:

- Setting: `sfpXmlLinter.hoverDocsFiles`
- Default:
  - `Docs/hover-docs.json`
  - `Docs/hover-docs.team.json`
- Changes in these files are reloaded automatically (no extension host restart required).
- If multiple entries match with the same relevance, later files in `hoverDocsFiles` win (override behavior).
- If no external hover docs file is available, built-in fallback docs (derived from `SFPDocs`) are used automatically.

Minimal file format:

```json
{
  "entries": [
    {
      "tag": "Form",
      "summary": "Short description",
      "details": "Optional concise detail."
    },
    {
      "attribute": "FormIdent",
      "summary": "Reference to Form Ident"
    }
  ]
}
```

Example override in VS Code settings:

```json
{
  "sfpXmlLinter.hoverDocsFiles": [
    "Docs/hover-docs.json",
    "Docs/hover-docs.team.json",
    "Docs/hover-docs.custom.json"
  ]
}
```
