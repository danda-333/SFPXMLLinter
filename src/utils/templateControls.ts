import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { ParsedDocumentFacts } from "../indexer/xmlFacts";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { maskXmlComments } from "./xmlComments";
import { normalizeComponentKey } from "./paths";

export function collectTemplateAvailableControlIdents(
  document: vscode.TextDocument,
  facts: ParsedDocumentFacts,
  index: WorkspaceIndex
): Set<string> {
  const out = new Set<string>();

  for (const item of facts.declaredControlInfos) {
    out.add(item.ident);
  }

  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const key of component.formControlDefinitions.keys()) {
      out.add(key);
    }
  }

  const text = maskXmlComments(document.getText());
  for (const componentKey of collectIncludeComponentKeys(text)) {
    const component = resolveComponentByKey(index, componentKey);
    if (!component) {
      continue;
    }

    for (const key of component.formControlDefinitions.keys()) {
      out.add(key);
    }
  }

  return out;
}

function collectIncludeComponentKeys(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<Include\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const raw = extractAttributeValue(attrs, "Component") ?? extractAttributeValue(attrs, "Name");
    if (!raw) {
      continue;
    }

    out.add(normalizeComponentKey(raw));
  }

  return out;
}

function extractAttributeValue(rawAttrs: string, attrName: string): string | undefined {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*(\"([^\"]*)\"|'([^']*)')`, "i");
  const match = regex.exec(rawAttrs);
  const value = (match?.[2] ?? match?.[3] ?? "").trim();
  return value.length > 0 ? value : undefined;
}
