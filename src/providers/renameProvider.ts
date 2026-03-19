import * as vscode from "vscode";
import { WorkspaceIndex, IndexedForm } from "../indexer/types";
import { parseDocumentFacts, parseDocumentFactsFromText } from "../indexer/xmlFacts";
import { documentInConfiguredRoots } from "../utils/paths";
import { buildDocumentCompositionModel } from "../composition/documentModel";
import {
  collectFormIdentReferenceLocations,
  collectHtmlControlReferenceLocations,
  collectWorkflowReferenceLocations,
  findFormDeclaration,
  findFormSymbolDeclaration,
  FormSymbolKind,
  resolveWorkflowDeclaration
} from "./referenceModelUtils";

type IndexAccessor = (uri?: vscode.Uri) => WorkspaceIndex;
type FactsAccessor = (document: vscode.TextDocument) => ReturnType<typeof parseDocumentFactsFromText>;
type SymbolReferencesAccessor = (kind: string, ident: string) => readonly vscode.Location[];
type RenameKind = "form" | "control" | "button" | "section";

interface RenameTarget {
  formIdent: string;
  oldIdent: string;
  kind: RenameKind;
  declaration: vscode.Location;
}

export class SfpXmlRenameProvider implements vscode.RenameProvider {
  public constructor(
    private readonly getIndex: IndexAccessor,
    private readonly getFactsForDocument?: FactsAccessor,
    private readonly getSymbolReferences?: SymbolReferencesAccessor
  ) {}

  public async prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Range | { range: vscode.Range; placeholder: string }> {
    const target = this.resolveRenameTarget(document, position);
    if (!target) {
      throw new Error("Rename is available for Form Ident and Form/WorkFlow Ident references (Control/Button/Section).");
    }

    return { range: target.declaration.range, placeholder: target.oldIdent };
  }

  public async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): Promise<vscode.WorkspaceEdit | undefined> {
    const normalizedNewName = newName.trim();
    if (!normalizedNewName) {
      throw new Error("New name must not be empty.");
    }

    const target = this.resolveRenameTarget(document, position);
    if (!target) {
      return undefined;
    }

    const index = this.getIndex(document.uri);
    const edit = new vscode.WorkspaceEdit();
    const seen = new Set<string>();
    pushRenameLocation(edit, seen, target.declaration, normalizedNewName);

    if (target.kind === "form") {
      for (const location of collectFormIdentReferenceLocations(index, target.oldIdent)) {
        pushRenameLocation(edit, seen, location, normalizedNewName);
      }
      return edit;
    }

    const formKind = target.kind as FormSymbolKind;
    for (const location of this.getSymbolReferences?.(target.kind, target.oldIdent) ?? []) {
      pushRenameLocation(edit, seen, location, normalizedNewName);
    }
    for (const location of collectWorkflowReferenceLocations(index, target.formIdent, formKind, target.oldIdent)) {
      pushRenameLocation(edit, seen, location, normalizedNewName);
    }
    if (target.kind === "control") {
      for (const location of collectHtmlControlReferenceLocations(index, target.formIdent, target.oldIdent)) {
        pushRenameLocation(edit, seen, location, normalizedNewName);
      }
    }

    return edit;
  }

  private resolveRenameTarget(document: vscode.TextDocument, position: vscode.Position): RenameTarget | undefined {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const index = this.getIndex(document.uri);
    const facts = this.getFactsForDocument?.(document) ?? parseDocumentFacts(document);
    const documentComposition = buildDocumentCompositionModel(facts, index);

    const formEntry = findFormByUri(index, document.uri);
    if (formEntry) {
      const declaration = findFormDeclaration(index, formEntry.ident) ?? formEntry.formIdentLocation;
      if (declaration.range.contains(position)) {
        return {
          formIdent: formEntry.ident,
          oldIdent: formEntry.ident,
          kind: "form",
          declaration
        };
      }

      const fromForm = findTargetInFormDefinitions(formEntry, facts, position);
      if (fromForm) {
        return fromForm;
      }
    }

    for (const ref of facts.formIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }
      const declaration = findFormDeclaration(index, ref.formIdent);
      if (!declaration) {
        continue;
      }
      return {
        formIdent: ref.formIdent,
        oldIdent: ref.formIdent,
        kind: "form",
        declaration
      };
    }

    for (const ref of facts.mappingFormIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }
      const declaration = findFormDeclaration(index, ref.formIdent);
      if (!declaration) {
        continue;
      }
      return {
        formIdent: ref.formIdent,
        oldIdent: ref.formIdent,
        kind: "form",
        declaration
      };
    }

    if (facts.rootTag?.toLowerCase() === "workflow" && facts.workflowFormIdent) {
      for (const ref of facts.workflowReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        const kind = toRenameKind(ref.kind);
        if (!kind) {
          continue;
        }

        const declaration = resolveWorkflowDeclaration(index, facts, documentComposition, kind, ref.ident);
        if (!declaration) {
          continue;
        }

        return {
          formIdent: facts.workflowFormIdent,
          oldIdent: ref.ident,
          kind,
          declaration
        };
      }
    }

    return undefined;
  }
}

function findFormByUri(index: WorkspaceIndex, uri: vscode.Uri): IndexedForm | undefined {
  for (const form of index.formsByIdent.values()) {
    if (form.uri.toString() === uri.toString()) {
      return form;
    }
  }
  return undefined;
}

function findTargetInFormDefinitions(
  form: IndexedForm,
  facts: ReturnType<typeof parseDocumentFacts>,
  position: vscode.Position
): RenameTarget | undefined {
  for (const info of facts.declaredControlInfos) {
    if (info.range.contains(position)) {
      return {
        formIdent: form.ident,
        oldIdent: info.ident,
        kind: "control",
        declaration: new vscode.Location(form.uri, info.range)
      };
    }
  }

  for (const info of facts.declaredButtonInfos) {
    if (info.range.contains(position)) {
      return {
        formIdent: form.ident,
        oldIdent: info.ident,
        kind: "button",
        declaration: new vscode.Location(form.uri, info.range)
      };
    }
  }

  for (const occurrence of facts.identOccurrences) {
    if (occurrence.kind === "section" && occurrence.range.contains(position)) {
      return {
        formIdent: form.ident,
        oldIdent: occurrence.ident,
        kind: "section",
        declaration: new vscode.Location(form.uri, occurrence.range)
      };
    }
  }

  return undefined;
}

function toRenameKind(kind: "formControl" | "controlShareCode" | "button" | "buttonShareCode" | "section"): Exclude<RenameKind, "form"> | undefined {
  if (kind === "formControl") {
    return "control";
  }
  if (kind === "button") {
    return "button";
  }
  if (kind === "section") {
    return "section";
  }
  return undefined;
}

function pushRenameLocation(
  edit: vscode.WorkspaceEdit,
  seen: Set<string>,
  location: vscode.Location,
  newName: string
): void {
  const key = `${location.uri.toString()}#${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  edit.replace(location.uri, location.range, newName);
}

