# SFP XML Linter

VS Code extension scaffold for SFP XML linting and semantic validation.

## Implemented foundation

- Configurable scan roots (`sfpXmlLinter.workspaceRoots`), defaults:
  - `XML`
  - `XML_Templates`
  - `XML_Components`
- Workspace indexer for:
  - `Form` symbols (`Controls`, `Buttons`, `Sections`)
  - `Component` symbols (`Section Name`)
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
  - `unknown-using-component`
  - `unknown-using-section`
  - `FormControl xsi:type="ShareCodeControl"` is validated against `WorkFlow/ControlShareCodes/ControlShareCode` (local + injected via `Using`)
- Per-rule severity config (`sfpXmlLinter.rules`) with values: `off`, `warning`, `error`
- Ignore directives:
  - `<!-- @Ignore rule-id -->` (applies to next non-empty line)
  - `<!-- @IgnoreFile rule-id -->` (applies to whole file)
  - `all` is supported as wildcard rule id
- Hover on diagnostics (message + rule id)
- Completion (context-aware foundation):
  - root/child elements
  - attribute names by tag
  - enum values (`xsi:type`, `DataType`, `Insert`, ...)
  - semantic values (`FormIdent`, `Using Component/Section`, WorkFlow `Ident` refs)
- Go to Definition:
  - `WorkFlow@FormIdent` -> `<Form Ident="...">`
  - any `FormIdent="..."` reference -> `<Form Ident="...">`
  - `FormControl/Button/Section Ident` in WorkFlow -> matching declaration in Form
  - `Mapping FromIdent/ToIdent` -> matching control declaration in owning Form
  - `Using Component/Name` -> component file
  - `Using Section` -> `<Section Name="...">` in component
- Rename Symbol:
  - rename `Form Ident` and update all `FormIdent`/`MappingFormIdent` references
  - rename `Control/Button/Section Ident` from Form declaration
  - rename corresponding references in WorkFlow documents
  - for controls, rename `Mapping FromIdent/ToIdent` references (with `MappingFormIdent` support)
- Quick fixes:
  - Ignore rule on next line (`<!-- @Ignore rule-id -->`)
  - Ignore rule in file (`<!-- @IgnoreFile rule-id -->`)
  - Ignore all rules in file (`<!-- @IgnoreFile all -->`)
- Build command:
  - `SFP XML Linter: Build XML Templates`
  - TypeScript builder hook + fallback to legacy PowerShell script (`BuildXmlTemplates.ps1`)
- Report command:
  - `SFP XML Linter: Workspace Diagnostics Report`
  - Prints diagnostics summary and per-rule counts to output channel
- Index command:
  - `SFP XML Linter: Rebuild Full Index`
  - Forces full workspace reindex on demand

## Startup behavior

- On startup, diagnostics are evaluated only for user-open documents (visible editors / open tabs).
- Files opened internally by indexer are ignored for diagnostics.
- Full workspace indexing runs in background (non-blocking startup).

## Dev

```bash
npm install
npm run compile
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
