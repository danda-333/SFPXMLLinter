import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { collectTemplateAvailableControlIdents } from "./templateControls";
import { getSystemMetadata } from "../config/systemMetadata";

export function collectResolvableControlIdents(
  document: vscode.TextDocument,
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): Set<string> {
  const root = facts.rootTag?.toLowerCase();

  if (root === "form") {
    return collectTemplateAvailableControlIdents(document, facts, index);
  }

  if (root === "workflow") {
    const out = new Set<string>();
    appendDefaultColumns(out);
    const formIdent = facts.workflowFormIdent;
    const form = formIdent ? index.formsByIdent.get(formIdent) : undefined;
    if (form) {
      for (const ident of form.controls) {
        out.add(ident);
      }
    }

    for (const usingRef of facts.usingReferences) {
      const component = resolveComponentByKey(index, usingRef.componentKey);
      if (!component) {
        continue;
      }

      for (const ident of component.formControlDefinitions.keys()) {
        out.add(ident);
      }
    }

    return out;
  }

  if (root === "component") {
    const out = new Set<string>(facts.declaredControls);
    appendDefaultColumns(out);
    for (const usingRef of facts.usingReferences) {
      const component = resolveComponentByKey(index, usingRef.componentKey);
      if (!component) {
        continue;
      }

      for (const ident of component.formControlDefinitions.keys()) {
        out.add(ident);
      }
    }

    return out;
  }

  const fallbackForm = facts.formIdent ? index.formsByIdent.get(facts.formIdent) : undefined;
  const out = fallbackForm ? new Set<string>(fallbackForm.controls) : new Set<string>();
  appendDefaultColumns(out);
  return out;
}

function appendDefaultColumns(target: Set<string>): void {
  const metadata = getSystemMetadata();
  for (const column of metadata.defaultFormColumns) {
    target.add(column);
  }
}
