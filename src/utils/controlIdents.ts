import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { ParsedDocumentFacts } from "../indexer/xmlFacts";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { collectTemplateAvailableControlIdents } from "./templateControls";
import { getSystemMetadata, SystemMetadata } from "../config/systemMetadata";

export function collectResolvableControlIdents(
  document: vscode.TextDocument,
  facts: ParsedDocumentFacts,
  index: WorkspaceIndex,
  options?: { metadata?: SystemMetadata; maskedText?: string }
): Set<string> {
  const metadata = options?.metadata ?? getSystemMetadata();
  const root = facts.rootTag?.toLowerCase();

  if (root === "form") {
    return collectTemplateAvailableControlIdents(document, facts, index, { metadata, maskedText: options?.maskedText });
  }

  if (root === "workflow") {
    const out = new Set<string>();
    appendDefaultColumns(out, metadata);
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
    appendDefaultColumns(out, metadata);
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
  appendDefaultColumns(out, metadata);
  return out;
}

function appendDefaultColumns(target: Set<string>, metadata: SystemMetadata): void {
  for (const column of metadata.defaultFormColumns) {
    target.add(column);
  }
}
