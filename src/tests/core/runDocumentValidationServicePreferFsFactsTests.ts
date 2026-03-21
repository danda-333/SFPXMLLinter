import { strict as assert } from "node:assert";
import Module = require("node:module");

class Uri {
  public readonly fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = fsPath;
  }

  public static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  public toString(): string {
    return `file://${this.fsPath.replace(/\\/g, "/")}`;
  }

  public get scheme(): string {
    return "file";
  }
}

class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

class Range {
  constructor(public readonly start: Position, public readonly end: Position) {}
}

const vscodeMock = {
  Uri,
  Position,
  Range,
  workspace: {
    textDocuments: [] as Array<{ uri: Uri; languageId: string; version: number; getText(): string }>
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

const { DocumentValidationService } = require("../../core/validation/documentValidationService") as typeof import("../../core/validation/documentValidationService");
const { parseDocumentFactsFromText } = require("../../indexer/xmlFacts") as typeof import("../../indexer/xmlFacts");

async function run(): Promise<void> {
  await testPreferFsReadIgnoresCachedFacts();
  console.log("\x1b[32mDocumentValidationService preferFsRead tests passed.\x1b[0m");
}

async function testPreferFsReadIgnoresCachedFacts(): Promise<void> {
  const uri = Uri.file("C:\\repo\\XML_Templates\\100_Test\\A.xml") as unknown as import("vscode").Uri;
  const documentText = "<Form Ident=\"A\"><Controls /></Form>";
  const document = {
    uri: uri as unknown as Uri,
    languageId: "xml",
    version: 7,
    getText(): string {
      return documentText;
    }
  };
  vscodeMock.workspace.textDocuments = [document];

  const staleFacts = parseDocumentFactsFromText("<WorkFlow FormIdent=\"A\"><Steps /></WorkFlow>");
  const index = {
    parsedFactsByUri: new Map([[uri.toString(), staleFacts]])
  } as unknown as import("../../indexer/types").WorkspaceIndex;

  let observedRootTag = "";
  const service = new DocumentValidationService({
    emptyIndex: index,
    clearDiagnostics: () => {
      // no-op
    },
    setDiagnostics: () => {
      // no-op
    },
    getIndexForUri: () => index,
    buildDiagnosticsForDocument: (_doc, _idx, facts) => {
      observedRootTag = (facts.rootTag ?? "").toLowerCase();
      return [];
    },
    shouldValidateUriForActiveProjects: () => true,
    documentInConfiguredRoots: () => true,
    isUserOpenDocument: () => false,
    hasInitialIndex: () => true,
    openTextDocumentWithInternalFlag: async () => undefined,
    readWorkspaceFileText: async () => documentText,
    createVirtualXmlDocument: (_uri, text) => ({
      uri: uri as unknown as Uri,
      languageId: "xml",
      version: 7,
      getText(): string {
        return text;
      }
    } as never),
    getRelativePath: () => "XML_Templates/100_Test/A.xml",
    logIndex: () => {
      // no-op
    },
    logSingleFile: () => {
      // no-op
    },
    referenceRuleFilter: () => true
  });

  await service.computeIndexedValidationOutcome(uri, { preferFsRead: true });
  assert.equal(observedRootTag, "form", "preferFsRead must use freshly parsed document facts instead of stale index facts");
}

void run();
