# Feature Manifest Authoring

This guide is the practical baseline for M2 (`Dependency-safe features`).

## Recommended flow

1. Start with XML-first feature files (`*.feature.xml`).
2. Run `SFP XML Linter: Generate Feature Manifest Bootstrap`.
3. Review generated `*.feature.json`.
4. Keep inferred structure, then refine semantic intent (`requires`, `expects`, descriptions, tags).

## What to define manually

- `requires`
  - Use for real external dependencies (other features or symbols this feature needs).
- `expects`
  - Use when contribution logic needs symbols that are not guaranteed by the same contribution.
- `expectsXPath`
  - Use when contribution targets structure-sensitive paths (for example required anchor nodes).
- `summary` / `description` / `tags`
  - Keep them concise; they are used by diagnostics and Tree View.

## Quick meaning of diagnostics

- `unknown-feature-requirement`
  - Manifest references feature that is not loaded.
- `missing-feature-dependency`
  - Effective model cannot satisfy a declared dependency.
- `missing-feature-expectation`
  - Expected symbol is not provided by effective feature composition.
- `missing-feature-expected-xpath`
  - Required XPath condition is not met in effective model.
- `duplicate-feature-provider`
  - Multiple parts/contributions provide same symbol in overlapping scope.
- `orphan-feature-part`
  - Entrypoint references part file that is missing in registry.
- `incomplete-feature`
  - Summary signal: feature has unresolved dependency/provider/partial-orphan issues.

## Minimal checklist before publish

1. No `warning`+ diagnostics from feature rules above.
2. No `partial-feature-contribution` unless intentionally accepted.
3. Tree View `Usings` shows expected effective contributions for target roots.
4. `test:composition` and `test:linter` pass.
