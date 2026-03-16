import { resolveComponentByKey } from "../indexer/componentResolve";
import { WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { DocumentCompositionModel, collectSelectedDocumentContributions } from "../composition/documentModel";

export type CompletionSymbolKind =
  | "workflowControlShareCode"
  | "workflowButtonShareCode"
  | "workflowActionShareCode"
  | "workflowFormControl"
  | "workflowFormButton"
  | "workflowFormSection";

export interface CompletionSymbolContext {
  facts: ReturnType<typeof parseDocumentFacts>;
  index: WorkspaceIndex;
  composition: DocumentCompositionModel;
}

type CompletionCollector = (ctx: CompletionSymbolContext) => Set<string>;

const COMPLETION_COLLECTORS: Record<CompletionSymbolKind, CompletionCollector> = {
  workflowControlShareCode: collectWorkflowControlShareCodeValues,
  workflowButtonShareCode: collectWorkflowButtonShareCodeValues,
  workflowActionShareCode: collectWorkflowActionShareCodeValues,
  workflowFormControl: collectWorkflowFormControlValues,
  workflowFormButton: collectWorkflowFormButtonValues,
  workflowFormSection: collectWorkflowFormSectionValues
};

export function collectCompletionSymbolValues(
  kind: CompletionSymbolKind,
  ctx: CompletionSymbolContext
): string[] {
  const collector = COMPLETION_COLLECTORS[kind];
  if (!collector) {
    return [];
  }

  return [...collector(ctx)].sort((a, b) => a.localeCompare(b));
}

function collectWorkflowControlShareCodeValues(ctx: CompletionSymbolContext): Set<string> {
  const out = new Set<string>(ctx.facts.declaredControlShareCodes);
  for (const contributionRef of collectSelectedDocumentContributions(ctx.composition)) {
    const component = resolveComponentByKey(ctx.index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.workflowControlShareCodeIdents) {
      if (component.workflowControlShareCodeDefinitions.has(ident)) {
        out.add(ident);
      }
    }
  }

  return out;
}

function collectWorkflowButtonShareCodeValues(ctx: CompletionSymbolContext): Set<string> {
  const out = new Set<string>(ctx.facts.declaredButtonShareCodes);
  for (const contributionRef of collectSelectedDocumentContributions(ctx.composition)) {
    const component = resolveComponentByKey(ctx.index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.workflowButtonShareCodeIdents) {
      if (component.workflowButtonShareCodeDefinitions.has(ident)) {
        out.add(ident);
      }
    }
  }

  return out;
}

function collectWorkflowActionShareCodeValues(ctx: CompletionSymbolContext): Set<string> {
  const out = new Set<string>(ctx.facts.declaredActionShareCodes);
  for (const contributionRef of collectSelectedDocumentContributions(ctx.composition)) {
    const component = resolveComponentByKey(ctx.index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.workflowActionShareCodeIdents) {
      if (component.workflowActionShareCodeDefinitions.has(ident)) {
        out.add(ident);
      }
    }
  }

  return out;
}

function collectWorkflowFormControlValues(ctx: CompletionSymbolContext): Set<string> {
  const form = resolveWorkflowOwnerForm(ctx);
  if (!form) {
    return new Set<string>();
  }

  const out = new Set<string>(form.controls);
  for (const contributionRef of collectSelectedDocumentContributions(ctx.composition)) {
    const component = resolveComponentByKey(ctx.index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.formControlIdents) {
      if (component.formControlDefinitions.has(ident)) {
        out.add(ident);
      }
    }
  }

  return out;
}

function collectWorkflowFormButtonValues(ctx: CompletionSymbolContext): Set<string> {
  const form = resolveWorkflowOwnerForm(ctx);
  if (!form) {
    return new Set<string>();
  }

  const out = new Set<string>(form.buttons);
  for (const contributionRef of collectSelectedDocumentContributions(ctx.composition)) {
    const component = resolveComponentByKey(ctx.index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.formButtonIdents) {
      if (component.formButtonDefinitions.has(ident)) {
        out.add(ident);
      }
    }
  }

  return out;
}

function collectWorkflowFormSectionValues(ctx: CompletionSymbolContext): Set<string> {
  const form = resolveWorkflowOwnerForm(ctx);
  if (!form) {
    return new Set<string>();
  }

  const out = new Set<string>(form.sections);
  for (const contributionRef of collectSelectedDocumentContributions(ctx.composition)) {
    const component = resolveComponentByKey(ctx.index, contributionRef.componentKey);
    if (!component) {
      continue;
    }

    for (const ident of contributionRef.contribution.formSectionIdents) {
      if (component.formSectionDefinitions.has(ident)) {
        out.add(ident);
      }
    }
  }

  return out;
}

function resolveWorkflowOwnerForm(ctx: CompletionSymbolContext): import("../indexer/types").IndexedForm | undefined {
  const formIdent = ctx.facts.workflowFormIdent;
  if (!formIdent) {
    return undefined;
  }

  return ctx.index.formsByIdent.get(formIdent);
}
