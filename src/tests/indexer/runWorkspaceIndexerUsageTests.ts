import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import Module = require("node:module");

const fixtureRoot = path.resolve(__dirname, "../../../tests/fixtures/indexer-usage");

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

const state = {
  workspaceRoot: fixtureRoot,
  config: {
    workspaceRoots: ["XML_Templates", "XML_Components"],
    resourcesRoots: [],
    hoverDocsFiles: [],
    rules: {},
    incompleteMode: false,
    "formatter.maxConsecutiveBlankLines": 2,
    "templateBuilder.autoBuildOnSave": true,
    "templateBuilder.componentSaveBuildScope": "dependents",
    "templateBuilder.mode": "debug"
  } as Record<string, unknown>
};

const vscodeMock = {
  Uri,
  Position,
  Range,
  Location,
  workspace: {
    workspaceFolders: [{ uri: Uri.file(fixtureRoot), name: "indexer-usage-fixture", index: 0 }],
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
    asRelativePath(uri: Uri, _includeWorkspaceFolder: boolean): string {
      return path.relative(state.workspaceRoot, uri.fsPath).replace(/\\/g, "/");
    },
    async findFiles(_pattern: string) {
      const xmlFiles = collectXmlFiles(state.workspaceRoot);
      return xmlFiles.map((file) => Uri.file(file));
    },
    fs: {
      async readFile(uri: Uri): Promise<Uint8Array> {
        return fs.readFileSync(uri.fsPath);
      }
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

const { WorkspaceIndexer } = require("../../indexer/workspaceIndexer") as typeof import("../../indexer/workspaceIndexer");

async function run(): Promise<void> {
  const indexer = new WorkspaceIndexer(["XML_Templates", "XML_Components"]);
  const index = await indexer.rebuildIndex();

  const featureUsage = index.componentUsageFormIdentsByKey.get("Shared/Sample");
  assert.ok(featureUsage);
  assert.equal(featureUsage?.has("FormA"), true, "Expected Shared/Sample usage for FormA.");

  const contributionUsage = index.componentContributionUsageFormIdentsByKey.get("Shared/Sample");
  assert.ok(contributionUsage);
  assert.equal(contributionUsage?.get("Controls")?.has("FormA"), true, "Expected explicit Controls contribution usage.");
  assert.equal(
    contributionUsage?.get("ControlShareCodes")?.has("FormA") ?? false,
    false,
    "Suppressed ControlShareCodes should not appear as effective contribution usage."
  );

  console.log("Workspace indexer usage tests passed.");
}

function collectXmlFiles(root: string): string[] {
  const out: string[] = [];
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
      if (entry.isFile() && full.toLowerCase().endsWith(".xml")) {
        out.push(full);
      }
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

void run();
