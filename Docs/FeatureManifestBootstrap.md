# Feature Manifest Bootstrap

`SFP XML Linter: Generate Feature Manifest Bootstrap`

## What it does

- Builds a `*.feature.json` draft from XML-first feature files (`Feature` + `Contribution`).
- Uses the same auto-manifest inference used by runtime registry loading.
- Writes the file next to the active feature entrypoint.

## Expected workflow

1. Open a feature file inside `XML_Components` (for example `Assign.Form.feature.xml`).
2. Run command: `SFP XML Linter: Generate Feature Manifest Bootstrap`.
3. Review generated `<FeatureName>.feature.json`.
4. Keep auto-inferred data as-is, and manually refine semantic intent where needed (for example `requires` notes, optional tags/description tuning).

## Overwrite behavior

- If the target manifest already exists, command asks for explicit overwrite confirmation.

## Resolution rules

- Primary match: feature candidate that contains the active file.
- Fallback match: feature candidate by active file basename.
- If no candidate is found, command aborts with info message.
