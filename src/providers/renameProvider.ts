import * as vscode from "vscode";
import { WorkspaceIndex, IndexedForm } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots } from "../utils/paths";

type IndexAccessor = () => WorkspaceIndex;
type RenameKind = "form" | "control" | "button" | "section";

interface RenameTarget {
  formIdent: string;
  oldIdent: string;
  kind: RenameKind;
  declaration: vscode.Location;
}

export class SfpXmlRenameProvider implements vscode.RenameProvider {
  constructor(private readonly getIndex: IndexAccessor) {}

  async prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Range | { range: vscode.Range; placeholder: string }> {
    const target = this.resolveRenameTarget(document, position);
    if (!target) {
      throw new Error("Rename is available for Form Ident and Form/WorkFlow Ident references (Control/Button/Section).");
    }

    return { range: target.declaration.range, placeholder: target.oldIdent };
  }

  async provideRenameEdits(
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

    const index = this.getIndex();
    const edit = new vscode.WorkspaceEdit();
    const seen = new Set<string>();
    pushRenameLocation(edit, seen, target.declaration, normalizedNewName);

    if (target.kind === "form") {
      for (const location of index.formIdentReferenceLocations.get(target.oldIdent) ?? []) {
        pushRenameLocation(edit, seen, location, normalizedNewName);
      }

      for (const location of index.mappingFormIdentReferenceLocations.get(target.oldIdent) ?? []) {
        pushRenameLocation(edit, seen, location, normalizedNewName);
      }

      return edit;
    }

    const byForm =
      target.kind === "control"
        ? index.controlReferenceLocationsByFormIdent
        : target.kind === "button"
          ? index.buttonReferenceLocationsByFormIdent
          : index.sectionReferenceLocationsByFormIdent;

    const refs = byForm.get(target.formIdent)?.get(target.oldIdent) ?? [];
    for (const location of refs) {
      pushRenameLocation(edit, seen, location, normalizedNewName);
    }

    return edit;
  }

  private resolveRenameTarget(document: vscode.TextDocument, position: vscode.Position): RenameTarget | undefined {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const index = this.getIndex();
    const facts = parseDocumentFacts(document);

    const formEntry = findFormByUri(index, document.uri);
    if (formEntry) {
      if (formEntry.formIdentLocation.range.contains(position)) {
        return {
          formIdent: formEntry.ident,
          oldIdent: formEntry.ident,
          kind: "form",
          declaration: formEntry.formIdentLocation
        };
      }

      const fromForm = findTargetInFormDefinitions(formEntry, position);
      if (fromForm) {
        return fromForm;
      }
    }

    for (const ref of facts.formIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }

      const form = index.formsByIdent.get(ref.formIdent);
      if (!form) {
        continue;
      }

      return {
        formIdent: form.ident,
        oldIdent: form.ident,
        kind: "form",
        declaration: form.formIdentLocation
      };
    }

    for (const ref of facts.mappingFormIdentReferences) {
      if (!ref.range.contains(position)) {
        continue;
      }

      const form = index.formsByIdent.get(ref.formIdent);
      if (!form) {
        continue;
      }

      return {
        formIdent: form.ident,
        oldIdent: form.ident,
        kind: "form",
        declaration: form.formIdentLocation
      };
    }

    if (facts.rootTag?.toLowerCase() === "workflow" && facts.workflowFormIdent) {
      const form = index.formsByIdent.get(facts.workflowFormIdent);
      if (!form) {
        return undefined;
      }

      for (const ref of facts.workflowReferences) {
        if (!ref.range.contains(position)) {
          continue;
        }

        const kind = toRenameKind(ref.kind);
        if (!kind) {
          continue;
        }

        const declaration = getDeclarationForKind(form, kind, ref.ident);
        if (!declaration) {
          continue;
        }

        return {
          formIdent: form.ident,
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

function findTargetInFormDefinitions(form: IndexedForm, position: vscode.Position): RenameTarget | undefined {
  for (const [ident, location] of form.controlDefinitions.entries()) {
    if (location.range.contains(position)) {
      return {
        formIdent: form.ident,
        oldIdent: ident,
        kind: "control",
        declaration: location
      };
    }
  }

  for (const [ident, location] of form.buttonDefinitions.entries()) {
    if (location.range.contains(position)) {
      return {
        formIdent: form.ident,
        oldIdent: ident,
        kind: "button",
        declaration: location
      };
    }
  }

  for (const [ident, location] of form.sectionDefinitions.entries()) {
    if (location.range.contains(position)) {
      return {
        formIdent: form.ident,
        oldIdent: ident,
        kind: "section",
        declaration: location
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

function getDeclarationForKind(
  form: IndexedForm,
  kind: Exclude<RenameKind, "form">,
  identKey: string
): vscode.Location | undefined {
  if (kind === "control") {
    return form.controlDefinitions.get(identKey);
  }

  if (kind === "button") {
    return form.buttonDefinitions.get(identKey);
  }

  return form.sectionDefinitions.get(identKey);
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
