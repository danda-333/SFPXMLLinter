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
    workspaceRoots: ["XML", "XML_Templates", "XML_Components"],
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

class MockTextDocument {
  public readonly uri: Uri;
  public readonly languageId = "xml";
  private readonly text: string;
  private readonly lineStarts: number[];

  constructor(filePath: string, text: string) {
    this.uri = Uri.file(filePath);
    this.text = text;
    this.lineStarts = computeLineStarts(text);
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
}

function run(): void {
  const docs = loadFixtureDocuments();
  const index = buildIndex(docs);
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

    const diagnostics = engine.buildDiagnostics(doc as unknown as import("vscode").TextDocument, index);
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
  const roots = ["XML_Templates", "XML_Components"];
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

  for (const [rel, doc] of docs.entries()) {
    const facts = parseDocumentFactsFromText(doc.getText()) as ParsedDocumentFacts;
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root === "form") {
      const formIdent = facts.formIdent ?? facts.rootIdent;
      if (!formIdent) {
        continue;
      }
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
      formsByIdent.set(formIdent, {
        ident: formIdent,
        uri: doc.uri as unknown as import("vscode").Uri,
        controls: new Set(facts.declaredControls),
        buttons: new Set(facts.declaredButtons),
        sections: new Set(facts.declaredSections),
        formIdentLocation: new Location(doc.uri, new Range(new Position(0, 0), new Position(0, 0))) as unknown as import("vscode").Location,
        controlDefinitions: controlDefinitions as unknown as Map<string, import("vscode").Location>,
        buttonDefinitions: buttonDefinitions as unknown as Map<string, import("vscode").Location>,
        sectionDefinitions: sectionDefinitions as unknown as Map<string, import("vscode").Location>
      });
      continue;
    }

    if (root === "component") {
      const componentKey = normalizeComponentKeyFromRel(rel);
      const sectionNames = collectSectionNames(doc.getText());
      const sectionDefinitions = new Map<string, Location>();
      for (const sectionName of sectionNames) {
        sectionDefinitions.set(sectionName, new Location(doc.uri, new Range(new Position(0, 0), new Position(0, 0))));
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
      const workflowButtonShareCodeDefinitions = new Map<string, Location>();
      for (const [ident, range] of facts.buttonShareCodeDefinitions.entries()) {
        workflowButtonShareCodeDefinitions.set(ident, new Location(doc.uri, range as unknown as Range));
      }
      componentsByKey.set(componentKey, {
        key: componentKey,
        uri: doc.uri as unknown as import("vscode").Uri,
        sections: sectionNames,
        componentLocation: new Location(doc.uri, new Range(new Position(0, 0), new Position(0, 0))) as unknown as import("vscode").Location,
        sectionDefinitions: sectionDefinitions as unknown as Map<string, import("vscode").Location>,
        formControlDefinitions: formControlDefinitions as unknown as Map<string, import("vscode").Location>,
        formButtonDefinitions: formButtonDefinitions as unknown as Map<string, import("vscode").Location>,
        formSectionDefinitions: formSectionDefinitions as unknown as Map<string, import("vscode").Location>,
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

  const emptyMapLocations = new Map<string, Location[]>();
  const emptyNestedRef = new Map<string, Map<string, Location[]>>();
  const emptyUsageMap = new Map<string, Set<string>>();
  const emptyNestedUsage = new Map<string, Map<string, Set<string>>>();

  return {
    formsByIdent: formsByIdent as unknown as Map<string, import("../../indexer/types").IndexedForm>,
    componentsByKey: componentsByKey as unknown as Map<string, import("../../indexer/types").IndexedComponent>,
    componentKeysByBaseName,
    formIdentReferenceLocations: emptyMapLocations as unknown as Map<string, import("vscode").Location[]>,
    mappingFormIdentReferenceLocations: new Map<string, import("vscode").Location[]>(),
    controlReferenceLocationsByFormIdent: new Map<string, Map<string, import("vscode").Location[]>>(),
    buttonReferenceLocationsByFormIdent: new Map<string, Map<string, import("vscode").Location[]>>(),
    sectionReferenceLocationsByFormIdent: new Map<string, Map<string, import("vscode").Location[]>>(),
    componentReferenceLocationsByKey: emptyMapLocations as unknown as Map<string, import("vscode").Location[]>,
    componentSectionReferenceLocationsByKey: emptyNestedRef as unknown as Map<string, Map<string, import("vscode").Location[]>>,
    componentUsageFormIdentsByKey: emptyUsageMap,
    componentSectionUsageFormIdentsByKey: emptyNestedUsage,
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
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
  normalized = normalized.replace(/\.component\.xml$/i, "");
  normalized = normalized.replace(/\.xml$/i, "");
  return normalized;
}

function collectSectionNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<Section\b([^>]*)>/gi)) {
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
