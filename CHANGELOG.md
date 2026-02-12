# Changelog

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
