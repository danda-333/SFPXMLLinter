import * as fs from "node:fs";
import * as path from "node:path";
import Module = require("node:module");

type VscodeMockState = {
  workspaceRoot: string;
  config: Record<string, unknown>;
};

const workspaceRoot = path.resolve(__dirname, "../../../tests/fixtures/linter");
const state: VscodeMockState = {
  workspaceRoot,
  config: {
    workspaceRoots: ["XML", "XML_Templates", "XML_Components", "XML_Primitives"],
    resourcesRoots: ["Resources"],
    hoverDocsFiles: [],
    rules: {},
    incompleteMode: false,
    "formatter.maxConsecutiveBlankLines": 2,
    "templateBuilder.autoBuildOnSave": true,
    "templateBuilder.componentSaveBuildScope": "dependents"
  }
};

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = path.resolve(fsPath);
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }
}

class Position {
  public readonly line: number;
  public readonly character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

class Location {
  public readonly uri: Uri;
  public readonly range: Range;
  constructor(uri: Uri, range: Range) {
    this.uri = uri;
    this.range = range;
  }
}

enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3
}

class Diagnostic {
  public readonly range: Range;
  public readonly message: string;
  public readonly severity: DiagnosticSeverity;
  public source?: string;
  public code?: string | number;
  constructor(range: Range, message: string, severity: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

const vscodeMock = {
  Uri,
  Position,
  Range,
  Location,
  Diagnostic,
  DiagnosticSeverity,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: "linter-fixture", index: 0 }],
    getConfiguration(section: string) {
      if (section !== "sfpXmlLinter") {
        return {
          get<T>(_key: string, defaultValue: T): T {
            return defaultValue;
          }
        };
      }

      return {
        get<T>(key: string, defaultValue: T): T {
          const value = state.config[key];
          return (value as T | undefined) ?? defaultValue;
        }
      };
    },
    getWorkspaceFolder(uri: Uri) {
      const root = path.resolve(state.workspaceRoot).replace(/\\/g, "/").toLowerCase();
      const current = path.resolve(uri.fsPath).replace(/\\/g, "/").toLowerCase();
      return current.startsWith(root) ? { uri: Uri.file(state.workspaceRoot), name: "linter-fixture", index: 0 } : undefined;
    },
    asRelativePath(uri: Uri, _includeWorkspaceFolder: boolean): string {
      return path.relative(state.workspaceRoot, uri.fsPath).replace(/\\/g, "/");
    }
  }
};

const moduleAny = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

type WorkspaceIndex = import("../../indexer/types").WorkspaceIndex;
type IndexedForm = import("../../indexer/types").IndexedForm;
type IndexedComponent = import("../../indexer/types").IndexedComponent;
type ParsedDocumentFacts = import("../../indexer/xmlFacts").ParsedDocumentFacts;

const { DiagnosticsEngine } = require("../../diagnostics/engine") as typeof import("../../diagnostics/engine");
const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");
const { populateUsingInsertTraceFromText } = require("../../composition/usingImpact") as typeof import("../../composition/usingImpact");
const { loadFeatureManifestRegistry } = require("../../composition/workspace") as typeof import("../../composition/workspace");

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  public readonly lineCount: number;
  private readonly text: string;
  private readonly lineStarts: number[];

  constructor(filePath: string, text: string) {
    this.uri = Uri.file(filePath);
    this.text = text;
    this.lineStarts = computeLineStarts(text);
    this.lineCount = this.lineStarts.length;
  }

  public getText(): string {
    return this.text;
  }

  public positionAt(offset: number): Position {
    const safe = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.lineStarts[mid];
      const next = mid + 1 < this.lineStarts.length ? this.lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
      if (safe < start) {
        high = mid - 1;
      } else if (safe >= next) {
        low = mid + 1;
      } else {
        return new Position(mid, safe - start);
      }
    }

    return new Position(0, safe);
  }

  public lineAt(line: number): { text: string } {
    const safeLine = Math.max(0, Math.min(line, this.lineCount - 1));
    const start = this.lineStarts[safeLine] ?? 0;
    const endWithBreak = safeLine + 1 < this.lineStarts.length ? this.lineStarts[safeLine + 1] : this.text.length;
    let end = endWithBreak;
    if (end > start && this.text.charCodeAt(end - 1) === 10) {
      end--;
    }
    if (end > start && this.text.charCodeAt(end - 1) === 13) {
      end--;
    }

    return {
      text: this.text.slice(start, end)
    };
  }
}

function run(): void {
  const docs = loadFixtureDocuments();
  const index = buildIndex(docs);
  const featureRegistry = loadFeatureManifestRegistry(workspaceRoot);
  const engine = new DiagnosticsEngine();
  const invalidExpectations = loadInvalidExpectations();
  let checkedValid = 0;
  let checkedInvalid = 0;

  for (const [relPath, doc] of docs.entries()) {
    const normalizedRelPath = relPath.replace(/\\/g, "/");
    // Validation assertions are only for template files.
    if (!normalizedRelPath.toLowerCase().startsWith("xml_templates/")) {
      continue;
    }

    const diagnostics = engine.buildDiagnostics(doc as unknown as import("vscode").TextDocument, index, {
      featureRegistry
    });
    const isInvalidFixture = normalizedRelPath.toLowerCase().includes("/900_chyby/");

    if (!isInvalidFixture) {
      assertNoDiagnostics(diagnostics, relPath);
      checkedValid += 1;
      console.log(`[linter:test] OK valid   ${normalizedRelPath}`);
      continue;
    }

    const fileName = path.basename(normalizedRelPath);
    const expectedRuleId = invalidExpectations.get(fileName);
    if (!expectedRuleId) {
      throw new Error(`Missing expected rule mapping for invalid fixture '${relPath}'.`);
    }

    if (diagnostics.length !== 1) {
      const compact = diagnostics.map((d) => `[${String(d.code)}] ${d.message}`).join("\n");
      throw new Error(
        `Expected exactly 1 diagnostic for '${relPath}' (${expectedRuleId}), got ${diagnostics.length}:\n${compact}`
      );
    }

    const actualRule = String(diagnostics[0]?.code ?? "");
    if (actualRule !== expectedRuleId) {
      throw new Error(
        `Unexpected diagnostic for '${relPath}'. Expected '${expectedRuleId}', got '${actualRule}'.`
      );
    }

    checkedInvalid += 1;
    console.log(`[linter:test] OK invalid ${normalizedRelPath} -> ${expectedRuleId}`);
  }

  console.log(
    `[linter:test] Done. Valid files: ${checkedValid}, Invalid files: ${checkedInvalid}, Total checked: ${checkedValid + checkedInvalid}`
  );
  console.log("Linter fixture regression tests passed.");
}

function loadInvalidExpectations(): Map<string, string> {
  const out = new Map<string, string>();
  const readmePath = path.join(workspaceRoot, "XML_Templates", "900_chyby", "README.md");
  const content = fs.readFileSync(readmePath, "utf8");
  const lineRegex = /`([^`]+\.xml)`\s*->\s*`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(content)) !== null) {
    const fileName = (match[1] ?? "").trim();
    const ruleId = (match[2] ?? "").trim();
    if (!fileName || !ruleId) {
      continue;
    }
    out.set(fileName, ruleId);
  }

  if (out.size === 0) {
    throw new Error(`No invalid fixture expectations found in '${readmePath}'.`);
  }

  return out;
}

function loadFixtureDocuments(): Map<string, MockTextDocument> {
  const roots = ["XML_Templates", "XML_Components", "XML_Primitives"];
  const docs = new Map<string, MockTextDocument>();
  for (const root of roots) {
    const base = path.join(workspaceRoot, root);
    for (const filePath of collectFiles(base, ".xml")) {
      const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
      const text = fs.readFileSync(filePath, "utf8");
      docs.set(rel, new MockTextDocument(filePath, text));
    }
  }

  return docs;
}

function buildIndex(docs: Map<string, MockTextDocument>): WorkspaceIndex {
  const formsByIdent = new Map<string, IndexedForm>();
  const componentsByKey = new Map<string, IndexedComponent>();
  const componentKeysByBaseName = new Map<string, Set<string>>();
  const parsedEntries: Array<{
    rel: string;
    doc: MockTextDocument;
    facts: ParsedDocumentFacts;
    root: string;
  }> = [];

  for (const [rel, doc] of docs.entries()) {
    const facts = parseDocumentFactsFromText(doc.getText()) as ParsedDocumentFacts;
    const root = (facts.rootTag ?? "").toLowerCase();
    parsedEntries.push({ rel, doc, facts, root });
  }

  // Pass 1: components
  for (const entry of parsedEntries) {
    const { rel, doc, facts, root } = entry;
    if (root === "component" || root === "feature") {
      const componentKey = normalizeComponentKeyFromRel(rel);
      const contributionNames = collectContributionNames(doc.getText());
      const contributionDefinitions = new Map<string, Location>();
      for (const contributionName of contributionNames) {
        contributionDefinitions.set(contributionName, new Location(doc.uri, new Range(new Position(0, 0), new Position(0, 0))));
      }
      const formControlDefinitions = new Map<string, Location>();
      for (const item of facts.declaredControlInfos) {
        formControlDefinitions.set(item.ident, new Location(doc.uri, item.range as unknown as Range));
      }
      const formButtonDefinitions = new Map<string, Location>();
      for (const item of facts.declaredButtonInfos) {
        formButtonDefinitions.set(item.ident, new Location(doc.uri, item.range as unknown as Range));
      }
      const formSectionDefinitions = new Map<string, Location>();
      for (const item of facts.identOccurrences) {
        if (item.kind !== "section") {
          continue;
        }
        formSectionDefinitions.set(item.ident, new Location(doc.uri, item.range as unknown as Range));
      }
      const workflowControlShareCodeDefinitions = new Map<string, Location>();
      for (const [ident, range] of facts.controlShareCodeDefinitions.entries()) {
        workflowControlShareCodeDefinitions.set(ident, new Location(doc.uri, range as unknown as Range));
      }
      const workflowActionShareCodeDefinitions = new Map<string, Location>();
      for (const [ident, range] of facts.actionShareCodeDefinitions.entries()) {
        workflowActionShareCodeDefinitions.set(ident, new Location(doc.uri, range as unknown as Range));
      }
      const workflowButtonShareCodeDefinitions = new Map<string, Location>();
      for (const [ident, range] of facts.buttonShareCodeDefinitions.entries()) {
        workflowButtonShareCodeDefinitions.set(ident, new Location(doc.uri, range as unknown as Range));
      }
      componentsByKey.set(componentKey, {
        key: componentKey,
        uri: doc.uri as unknown as import("vscode").Uri,
        contributions: contributionNames,
        componentLocation: new Location(doc.uri, new Range(new Position(0, 0), new Position(0, 0))) as unknown as import("vscode").Location,
        contributionDefinitions: contributionDefinitions as unknown as Map<string, import("vscode").Location>,
        contributionSummaries: collectComponentContributionSummaries(doc.getText()) as unknown as import("../../indexer/types").IndexedComponent["contributionSummaries"],
        formControlDefinitions: formControlDefinitions as unknown as Map<string, import("vscode").Location>,
        formButtonDefinitions: formButtonDefinitions as unknown as Map<string, import("vscode").Location>,
        formSectionDefinitions: formSectionDefinitions as unknown as Map<string, import("vscode").Location>,
        workflowActionShareCodeDefinitions: workflowActionShareCodeDefinitions as unknown as Map<string, import("vscode").Location>,
        workflowControlShareCodeDefinitions: workflowControlShareCodeDefinitions as unknown as Map<string, import("vscode").Location>,
        workflowButtonShareCodeDefinitions: workflowButtonShareCodeDefinitions as unknown as Map<string, import("vscode").Location>,
        workflowButtonShareCodeButtonIdents: facts.buttonShareCodeButtonIdents
      });
      const baseName = componentKey.split("/").pop() ?? componentKey;
      if (!componentKeysByBaseName.has(baseName)) {
        componentKeysByBaseName.set(baseName, new Set<string>());
      }
      componentKeysByBaseName.get(baseName)?.add(componentKey);
    }
  }

  // Pass 2: forms (with Using expansion from components)
  for (const entry of parsedEntries) {
    const { doc, facts, root } = entry;
    if (root !== "form") {
      continue;
    }

    const formIdent = facts.formIdent ?? facts.rootIdent;
    if (!formIdent) {
      continue;
    }

    const controls = new Set(facts.declaredControls);
    const buttons = new Set(facts.declaredButtons);
    const sections = new Set(facts.declaredSections);

    const controlDefinitions = new Map<string, Location>();
    for (const item of facts.declaredControlInfos) {
      controlDefinitions.set(item.ident, new Location(doc.uri, item.range as unknown as Range));
    }

    const buttonDefinitions = new Map<string, Location>();
    for (const item of facts.declaredButtonInfos) {
      buttonDefinitions.set(item.ident, new Location(doc.uri, item.range as unknown as Range));
    }

    const sectionDefinitions = new Map<string, Location>();
    for (const item of facts.identOccurrences) {
      if (item.kind !== "section") {
        continue;
      }
      sectionDefinitions.set(item.ident, new Location(doc.uri, item.range as unknown as Range));
    }

    for (const usingRef of facts.usingReferences) {
      const component = resolveComponentFromFixtureIndex(componentsByKey, componentKeysByBaseName, usingRef.componentKey);
      if (!component) {
        continue;
      }
      for (const ident of component.formControlDefinitions.keys()) {
        controls.add(ident);
      }
      for (const ident of component.formButtonDefinitions.keys()) {
        buttons.add(ident);
      }
      for (const ident of component.formSectionDefinitions.keys()) {
        sections.add(ident);
      }
    }

    formsByIdent.set(formIdent, {
      ident: formIdent,
      uri: doc.uri as unknown as import("vscode").Uri,
      controls,
      buttons,
      sections,
      formIdentLocation: new Location(doc.uri, new Range(new Position(0, 0), new Position(0, 0))) as unknown as import("vscode").Location,
      controlDefinitions: controlDefinitions as unknown as Map<string, import("vscode").Location>,
      buttonDefinitions: buttonDefinitions as unknown as Map<string, import("vscode").Location>,
      sectionDefinitions: sectionDefinitions as unknown as Map<string, import("vscode").Location>
    });
  }

  const emptyMapLocations = new Map<string, Location[]>();
  const emptyNestedRef = new Map<string, Map<string, Location[]>>();
  const emptyUsageMap = new Map<string, Set<string>>();
  const emptyNestedUsage = new Map<string, Map<string, Set<string>>>();
  const parsedFactsByUri = new Map<string, ParsedDocumentFacts>();
  for (const entry of parsedEntries) {
    parsedFactsByUri.set(entry.doc.uri.toString(), entry.facts);
  }

  const index: WorkspaceIndex = {
    formsByIdent: formsByIdent as unknown as Map<string, import("../../indexer/types").IndexedForm>,
    componentsByKey: componentsByKey as unknown as Map<string, import("../../indexer/types").IndexedComponent>,
    componentKeysByBaseName,
    formIdentReferenceLocations: emptyMapLocations as unknown as Map<string, import("vscode").Location[]>,
    mappingFormIdentReferenceLocations: new Map<string, import("vscode").Location[]>(),
    controlReferenceLocationsByFormIdent: new Map<string, Map<string, import("vscode").Location[]>>(),
    buttonReferenceLocationsByFormIdent: new Map<string, Map<string, import("vscode").Location[]>>(),
    sectionReferenceLocationsByFormIdent: new Map<string, Map<string, import("vscode").Location[]>>(),
    componentReferenceLocationsByKey: emptyMapLocations as unknown as Map<string, import("vscode").Location[]>,
    componentContributionReferenceLocationsByKey: emptyNestedRef as unknown as Map<string, Map<string, import("vscode").Location[]>>,
    componentUsageFormIdentsByKey: emptyUsageMap,
    componentContributionUsageFormIdentsByKey: emptyNestedUsage,
    parsedFactsByUri,
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };

  for (const entry of parsedEntries) {
    populateUsingInsertTraceFromText(entry.facts, entry.doc.getText(), index);
  }

  return index;
}

function resolveComponentFromFixtureIndex(
  componentsByKey: Map<string, IndexedComponent>,
  componentKeysByBaseName: Map<string, Set<string>>,
  requestedKey: string
): IndexedComponent | undefined {
  const exact = componentsByKey.get(requestedKey);
  if (exact) {
    return exact;
  }

  const baseName = requestedKey.split("/").pop() ?? requestedKey;
  const aliases = componentKeysByBaseName.get(baseName);
  if (!aliases || aliases.size === 0) {
    return undefined;
  }

  const ordered = [...aliases].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return componentsByKey.get(ordered[0]);
}

function collectFiles(root: string, extension: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) {
    return out;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && full.toLowerCase().endsWith(extension)) {
        out.push(full);
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalizeComponentKeyFromRel(relPath: string): string {
  let normalized = relPath.replace(/\\/g, "/");
  normalized = normalized.replace(/^xml_components\//i, "");
  normalized = normalized.replace(/^xml_primitives\//i, "");
  normalized = normalized.replace(/\.feature\.xml$/i, "");
  normalized = normalized.replace(/\.primitive\.xml$/i, "");
  normalized = normalized.replace(/\.component\.xml$/i, "");
  normalized = normalized.replace(/\.xml$/i, "");
  return normalized;
}

function collectContributionNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<(?:Contribution|Section)\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const m = /\bName\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const value = (m?.[2] ?? m?.[3] ?? "").trim();
    if (!value) {
      continue;
    }
    out.add(value);
  }
  return out;
}

function collectComponentContributionSummaries(text: string): Map<string, import("../../indexer/types").IndexedComponentContributionSummary> {
  const out = new Map<string, import("../../indexer/types").IndexedComponentContributionSummary>();
  for (const match of text.matchAll(/<(Contribution|Section)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const attrs = match[2] ?? "";
    const body = match[3] ?? "";
    const name = extractAttributeValue(attrs, "Name");
    if (!name) {
      continue;
    }

    const rootRaw = (extractAttributeValue(attrs, "Root") ?? "").trim().toLowerCase();
    const root: import("../../indexer/types").IndexedComponentContributionSummary["root"] =
      rootRaw.length === 0 || rootRaw === "form" ? "form" : rootRaw === "workflow" ? "workflow" : "other";

    out.set(name, {
      contributionName: name,
      root,
      rootExpression: rootRaw.length > 0 ? rootRaw : undefined,
      insert: extractAttributeValue(attrs, "Insert"),
      targetXPath: extractAttributeValue(attrs, "TargetXPath"),
      allowMultipleInserts: parseBooleanAttribute(extractAttributeValue(attrs, "AllowMultipleInserts")),
      hasContent: /\S/.test(body),
      formControlCount: countTagOccurrences(body, /<Control\b[^>]*>/gi),
      formButtonCount: countTagOccurrences(body, /<Button\b[^>]*>/gi),
      formSectionCount: countTagOccurrences(body, /<Section\b[^>]*>/gi),
      workflowActionShareCodeCount: countTagOccurrences(body, /<ActionShareCode\b[^>]*>/gi),
      workflowControlShareCodeCount: countTagOccurrences(body, /<ControlShareCode\b[^>]*>/gi),
      workflowButtonShareCodeCount: countTagOccurrences(body, /<ButtonShareCode\b[^>]*>/gi),
      formControlIdents: collectAttributeIdents(body, /<Control\b([^>]*)>/gi, "Ident"),
      formButtonIdents: collectAttributeIdents(body, /<Button\b([^>]*)>/gi, "Ident"),
      formSectionIdents: collectAttributeIdents(body, /<Section\b([^>]*)>/gi, "Ident"),
      workflowReferencedActionShareCodeIdents: collectActionShareCodeReferenceIdents(body),
      workflowActionShareCodeIdents: collectAttributeIdents(body, /<ActionShareCode\b([^>]*)>/gi, "Ident"),
      workflowControlShareCodeIdents: collectAttributeIdents(body, /<ControlShareCode\b([^>]*)>/gi, "Ident"),
      workflowButtonShareCodeIdents: collectAttributeIdents(body, /<ButtonShareCode\b([^>]*)>/gi, "Ident")
    });
  }

  return out;
}

function extractAttributeValue(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*(\"([^\"]*)\"|'([^']*)')`, "i");
  const match = regex.exec(attrs);
  return (match?.[2] ?? match?.[3] ?? "").trim() || undefined;
}

function collectAttributeIdents(text: string, tagRegex: RegExp, attributeName: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(tagRegex)) {
    const value = extractAttributeValue(match[1] ?? "", attributeName);
    if (value) {
      out.add(value);
    }
  }
  return out;
}

function collectActionShareCodeReferenceIdents(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<Action\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const actionType = (extractAttributeValue(attrs, "xsi:type") ?? extractAttributeValue(attrs, "type") ?? "").trim().toLowerCase();
    if (actionType !== "sharecode") {
      continue;
    }

    const ident = extractAttributeValue(attrs, "Ident");
    if (ident) {
      out.add(ident);
    }
  }
  return out;
}

function countTagOccurrences(text: string, regex: RegExp): number {
  let count = 0;
  for (const _ of text.matchAll(regex)) {
    count++;
  }
  return count;
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return undefined;
}

function assertNoDiagnostics(
  diagnostics: readonly import("vscode").Diagnostic[],
  fileLabel: string
): void {
  if (diagnostics.length === 0) {
    return;
  }

  const compact = diagnostics.map((d) => `[${String(d.code)}] ${d.message}`).join("\n");
  throw new Error(`Expected no diagnostics for ${fileLabel}, got ${diagnostics.length}:\n${compact}`);
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

run();
