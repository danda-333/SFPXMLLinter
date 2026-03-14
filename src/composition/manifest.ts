import {
  FeatureCapabilityReport,
  FeatureManifestContribution,
  FeatureManifestContributionKind,
  FeatureContextKind,
  FeatureManifest,
  FeatureManifestDependencyRef,
  FeatureManifestOrdering,
  FeatureManifestPart,
  FeatureManifestSymbolRef,
  FeatureReferenceKind,
  FeatureSymbolKind
} from "./model";

const VALID_CONTEXTS = new Set<FeatureContextKind>(["form", "workflow", "dataview", "view", "filter", "component"]);
const VALID_SYMBOL_KINDS = new Set<FeatureSymbolKind>([
  "control",
  "button",
  "section",
  "actionShareCode",
  "buttonShareCode",
  "controlShareCode",
  "column",
  "component",
  "datasource",
  "parameter",
  "other"
]);

const VALID_REFERENCE_KINDS = new Set<FeatureReferenceKind>(["feature", ...VALID_SYMBOL_KINDS]);
const VALID_CONTRIBUTION_KINDS = new Set<FeatureManifestContributionKind>([
  "provide",
  "extend-existing",
  "placeholder",
  "decorate",
  "asset",
  "other"
]);

export function parseFeatureManifestText(text: string, source?: string): FeatureManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse feature manifest${source ? ` '${source}'` : ""}: ${message}`);
  }

  return normalizeFeatureManifest(parsed, source);
}

export function normalizeFeatureManifest(input: unknown, source?: string): FeatureManifest {
  const obj = asRecord(input, source, "Manifest root must be an object.");
  const feature = readNonEmptyString(obj.feature, source, "Manifest must define a non-empty 'feature'.");
  const tags = normalizeStringArray(obj.tags);
  const parts = normalizeParts(obj.parts, source);
  const manifest: FeatureManifest = {
    version: 1,
    feature,
    description: readOptionalString(obj.description),
    entrypoint: readOptionalString(obj.entrypoint),
    tags,
    parts,
    requires: normalizeDependencyList(obj.requires, source),
    expects: normalizeSymbolList(obj.expects, source),
    source
  };

  return manifest;
}

export function buildFeatureCapabilityReport(manifest: FeatureManifest): FeatureCapabilityReport {
  return {
    feature: manifest.feature,
    provides: uniqueSymbols(manifest.parts.flatMap((part) => part.provides)),
    expects: uniqueSymbols([
      ...manifest.expects,
      ...manifest.parts.flatMap((part) => part.expects)
    ]),
    requires: uniqueDependencies(manifest.requires),
    parts: manifest.parts.map((part) => ({
      id: part.id,
      file: part.file,
      appliesTo: [...part.appliesTo],
      provides: [...part.provides],
      expects: [...part.expects],
      contributions: part.contributions.map((contribution) => ({
        ...contribution,
        appliesTo: [...contribution.appliesTo],
        provides: [...contribution.provides],
        expects: [...contribution.expects],
        expectsXPath: [...contribution.expectsXPath],
        requires: [...contribution.requires],
        touches: [...contribution.touches]
      }))
    }))
  };
}

function normalizeParts(input: unknown, source?: string): FeatureManifestPart[] {
  const rawParts = Array.isArray(input) ? input : [];
  const parts = rawParts.map((item, index) => normalizePart(item, source, index));
  const seen = new Set<string>();
  const result: FeatureManifestPart[] = [];
  for (const part of parts) {
    if (seen.has(part.id)) {
      continue;
    }

    seen.add(part.id);
    result.push(part);
  }

  return result;
}

function normalizePart(input: unknown, source: string | undefined, index: number): FeatureManifestPart {
  if (typeof input === "string") {
    const file = input.trim();
    if (!file) {
      throw new Error(`Manifest${source ? ` '${source}'` : ""} part at index ${index} must not be empty.`);
    }

    return {
      id: toPartId(file),
      file,
      appliesTo: inferContextsFromFile(file),
      provides: [],
      expects: [],
      contributions: []
    };
  }

  const obj = asRecord(input, source, `Manifest${source ? ` '${source}'` : ""} part at index ${index} must be an object or string.`);
  const file = readNonEmptyString(obj.file, source, `Manifest${source ? ` '${source}'` : ""} part at index ${index} must define a non-empty 'file'.`);
  return {
    id: readOptionalString(obj.id)?.trim() || toPartId(file),
    file,
    appliesTo: normalizeContexts(obj.appliesTo, file),
    provides: normalizeSymbolList(obj.provides, source),
    expects: normalizeSymbolList(obj.expects, source),
    contributions: normalizeContributions(obj.contributions, source, file),
    ordering: normalizeOrdering(obj.ordering, source)
  };
}

function normalizeOrdering(input: unknown, source?: string): FeatureManifestOrdering | undefined {
  if (input === undefined) {
    return undefined;
  }

  const obj = asRecord(input, source, `Manifest${source ? ` '${source}'` : ""} ordering must be an object.`);
  return {
    group: readOptionalString(obj.group),
    before: normalizeStringArray(obj.before),
    after: normalizeStringArray(obj.after)
  };
}

function normalizeContributions(input: unknown, source: string | undefined, file: string): FeatureManifestContribution[] {
  const raw = Array.isArray(input) ? input : [];
  const out: FeatureManifestContribution[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const contribution = normalizeContribution(raw[index], source, file, index);
    if (seen.has(contribution.id)) {
      continue;
    }

    seen.add(contribution.id);
    out.push(contribution);
  }

  return out;
}

function normalizeContribution(
  input: unknown,
  source: string | undefined,
  file: string,
  index: number
): FeatureManifestContribution {
  const obj = asRecord(
    input,
    source,
    `Manifest${source ? ` '${source}'` : ""} contribution at index ${index} must be an object.`
  );
  const rawKind = readOptionalString(obj.kind) ?? "other";
  const kind = rawKind as FeatureManifestContributionKind;
  if (!VALID_CONTRIBUTION_KINDS.has(kind)) {
    throw new Error(`Unknown contribution kind '${rawKind}' in part '${file}'.`);
  }

  const name = readOptionalString(obj.name) ?? readOptionalString(obj.for);
  const targetXPath = readOptionalString(obj.targetXPath);
  const insert = readOptionalString(obj.insert);
  const summary = readOptionalString(obj.summary);
  const note = readOptionalString(obj.note);
  const id =
    readOptionalString(obj.id)?.trim() ||
    [name, targetXPath, insert, kind, index.toString()].filter((value) => value && value.length > 0).join("|");

  return {
    id,
    ...(name ? { name } : {}),
    kind,
    ...(summary ? { summary } : {}),
    ...(targetXPath ? { targetXPath } : {}),
    ...(insert ? { insert } : {}),
    appliesTo: normalizeContexts(obj.appliesTo, file),
    provides: normalizeSymbolList(obj.provides, source),
    expects: normalizeSymbolList(obj.expects, source),
    expectsXPath: normalizeStringArray(obj.expectsXPath),
    requires: normalizeDependencyList(obj.requires, source),
    touches: normalizeDependencyList(obj.touches, source),
    ...(note ? { note } : {})
  };
}

function normalizeContexts(input: unknown, file: string): FeatureContextKind[] {
  const values = normalizeStringArray(input);
  if (values.length === 0) {
    return inferContextsFromFile(file);
  }

  const result: FeatureContextKind[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase() as FeatureContextKind;
    if (!VALID_CONTEXTS.has(normalized)) {
      throw new Error(`Unknown feature context '${value}' in part '${file}'.`);
    }

    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

function normalizeSymbolList(input: unknown, source?: string): FeatureManifestSymbolRef[] {
  const raw = Array.isArray(input) ? input : [];
  const values = raw.map((item) => normalizeSymbol(item, source));
  return uniqueSymbols(values);
}

function normalizeDependencyList(input: unknown, source?: string): FeatureManifestDependencyRef[] {
  const raw = Array.isArray(input) ? input : [];
  const values = raw.map((item) => normalizeDependency(item, source));
  return uniqueDependencies(values);
}

function normalizeSymbol(input: unknown, source?: string): FeatureManifestSymbolRef {
  if (typeof input === "string") {
    return parseTypedRef(input, source, VALID_SYMBOL_KINDS) as FeatureManifestSymbolRef;
  }

  const obj = asRecord(input, source, `Manifest${source ? ` '${source}'` : ""} symbol reference must be an object or string.`);
  const kindRaw = readNonEmptyString(obj.kind, source, "Symbol reference must define 'kind'.");
  const kind = kindRaw as FeatureSymbolKind;
  if (!VALID_SYMBOL_KINDS.has(kind)) {
    throw new Error(`Unknown symbol kind '${kindRaw}'.`);
  }

  const note = readOptionalString(obj.note);
  return {
    kind,
    ident: readNonEmptyString(obj.ident, source, "Symbol reference must define non-empty 'ident'."),
    ...(note ? { note } : {})
  };
}

function normalizeDependency(input: unknown, source?: string): FeatureManifestDependencyRef {
  if (typeof input === "string") {
    return parseTypedRef(input, source, VALID_REFERENCE_KINDS) as FeatureManifestDependencyRef;
  }

  const obj = asRecord(input, source, `Manifest${source ? ` '${source}'` : ""} dependency reference must be an object or string.`);
  const kindRaw = readNonEmptyString(obj.kind, source, "Dependency reference must define 'kind'.");
  const kind = kindRaw as FeatureReferenceKind;
  if (!VALID_REFERENCE_KINDS.has(kind)) {
    throw new Error(`Unknown dependency kind '${kindRaw}'.`);
  }

  const note = readOptionalString(obj.note);
  return {
    kind,
    ident: readNonEmptyString(obj.ident, source, "Dependency reference must define non-empty 'ident'."),
    ...(note ? { note } : {})
  };
}

function parseTypedRef(input: string, source: string | undefined, validKinds: Set<string>): { kind: string; ident: string; note?: string } {
  const trimmed = input.trim();
  const sep = trimmed.indexOf(":");
  if (sep <= 0 || sep === trimmed.length - 1) {
    throw new Error(`Manifest${source ? ` '${source}'` : ""} reference '${input}' must use 'kind:ident' format.`);
  }

  const kind = trimmed.slice(0, sep).trim();
  const ident = trimmed.slice(sep + 1).trim();
  if (!validKinds.has(kind)) {
    throw new Error(`Unknown reference kind '${kind}' in '${input}'.`);
  }

  if (!ident) {
    throw new Error(`Reference '${input}' must define a non-empty ident.`);
  }

  return { kind, ident };
}

function inferContextsFromFile(file: string): FeatureContextKind[] {
  const lower = file.toLowerCase();
  if (lower.includes(".workflow.")) {
    return ["workflow"];
  }

  if (lower.includes(".dataview.")) {
    return ["dataview"];
  }

  if (lower.includes(".view.")) {
    return ["view"];
  }

  if (lower.includes(".filter.")) {
    return ["filter"];
  }

  if (lower.includes(".form.")) {
    return ["form"];
  }

  if (lower.includes(".component.")) {
    return ["component"];
  }

  return ["form"];
}

function toPartId(file: string): string {
  const normalized = file.replace(/\\/g, "/").split("/").pop() ?? file;
  return normalized
    .replace(/\.feature\.xml$/i, "")
    .replace(/\.component\.xml$/i, "")
    .replace(/\.xml$/i, "");
}

function uniqueSymbols(values: FeatureManifestSymbolRef[]): FeatureManifestSymbolRef[] {
  const seen = new Set<string>();
  const out: FeatureManifestSymbolRef[] = [];
  for (const value of values) {
    const key = `${value.kind}:${value.ident}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(value);
  }

  return out;
}

function uniqueDependencies(values: FeatureManifestDependencyRef[]): FeatureManifestDependencyRef[] {
  const seen = new Set<string>();
  const out: FeatureManifestDependencyRef[] = [];
  for (const value of values) {
    const key = `${value.kind}:${value.ident}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(value);
  }

  return out;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || out.includes(trimmed)) {
      continue;
    }

    out.push(trimmed);
  }

  return out;
}

function readNonEmptyString(input: unknown, source: string | undefined, message: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error(source ? `${message} Source: ${source}.` : message);
  }

  return input.trim();
}

function readOptionalString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const trimmed = input.trim();
  return trimmed || undefined;
}

function asRecord(input: unknown, source: string | undefined, message: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(source ? `${message} Source: ${source}.` : message);
  }

  return input as Record<string, unknown>;
}
