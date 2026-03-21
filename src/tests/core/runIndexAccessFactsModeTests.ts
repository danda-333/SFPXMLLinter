import { strict as assert } from "node:assert";
import { getParsedFactsByUri } from "../../core/model/indexAccess";
import type { WorkspaceIndex } from "../../indexer/types";

const uri = {
  toString: () => "file:///demo.xml",
  fsPath: "/demo.xml"
} as unknown as import("vscode").Uri;

function createIndex(): WorkspaceIndex {
  const facts = { rootTag: "Form" } as unknown as import("../../indexer/xmlFacts").ParsedDocumentFacts;
  return {
    formsByIdent: new Map(),
    formIdentByUri: new Map(),
    componentsByKey: new Map(),
    componentKeyByUri: new Map(),
    componentKeysByBaseName: new Map(),
    parsedFactsByUri: new Map([[uri.toString(), facts]]),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: true,
    componentsReady: true,
    fullReady: true
  };
}

function run(): void {
  const index = createIndex();

  const strictMissing = getParsedFactsByUri(index, uri, () => undefined, "strict-accessor");
  assert.equal(strictMissing, undefined, "strict-accessor must not fallback to index when accessor returns undefined");

  const fallback = getParsedFactsByUri(index, uri, () => undefined, "index-fallback");
  assert.ok(fallback, "index-fallback should use index map when accessor returns undefined");

  const fromAccessor = getParsedFactsByUri(index, uri, () => ({ rootTag: "WorkFlow" } as unknown as import("../../indexer/xmlFacts").ParsedDocumentFacts), "strict-accessor");
  assert.equal(fromAccessor?.rootTag, "WorkFlow");

  console.log("Index access facts mode tests passed.");
}

run();

