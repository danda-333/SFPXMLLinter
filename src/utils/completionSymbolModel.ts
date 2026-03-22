import { resolveComponentByKey } from "../indexer/componentResolve";
import { IndexedForm, WorkspaceIndex } from "../indexer/types";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { DocumentCompositionModel, buildDocumentCompositionModel, collectSelectedDocumentContributions } from "../composition/documentModel";
import { contributionMatchesDocumentRoot } from "../composition/usingImpact";
import { getIndexedFormByIdent, getParsedFactsByUri } from "../core/model/indexAccess";

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
  resolveOwningForm?: (formIdent: string, preferredIndex: WorkspaceIndex) => { form: IndexedForm; index: WorkspaceIndex } | undefined;
  getFactsForUri?: (uri: import("vscode").Uri, index: WorkspaceIndex) => ReturnType<typeof parseDocumentFacts> | undefined;
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
  const owner = resolveWorkflowOwnerForm(ctx);
  if (!owner) {
    return new Set<string>();
  }
  const { form, index: ownerIndex } = owner;

  const out = new Set<string>(form.controls);
  for (const ident of collectEffectiveOwnerFormContributionSymbols(form, ownerIndex, ctx.getFactsForUri).controls) {
    out.add(ident);
  }
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
  const owner = resolveWorkflowOwnerForm(ctx);
  if (!owner) {
    return new Set<string>();
  }
  const { form, index: ownerIndex } = owner;

  const out = new Set<string>(form.buttons);
  for (const ident of collectEffectiveOwnerFormContributionSymbols(form, ownerIndex, ctx.getFactsForUri).buttons) {
    out.add(ident);
  }
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
  const owner = resolveWorkflowOwnerForm(ctx);
  if (!owner) {
    return new Set<string>();
  }
  const { form, index: ownerIndex } = owner;

  const out = new Set<string>(form.sections);
  for (const ident of collectEffectiveOwnerFormContributionSymbols(form, ownerIndex, ctx.getFactsForUri).sections) {
    out.add(ident);
  }
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

function resolveWorkflowOwnerForm(ctx: CompletionSymbolContext): { form: IndexedForm; index: WorkspaceIndex } | undefined {
  const formIdent = ctx.facts.workflowFormIdent;
  if (!formIdent) {
    return undefined;
  }

  const resolved = ctx.resolveOwningForm?.(formIdent, ctx.index);
  if (resolved) {
    return resolved;
  }
  const fallback = getIndexedFormByIdent(ctx.index, formIdent);
  if (!fallback) {
    return undefined;
  }
  return { form: fallback, index: ctx.index };
}

function collectEffectiveOwnerFormContributionSymbols(
  form: IndexedForm,
  index: WorkspaceIndex,
  getFactsForUri?: (uri: import("vscode").Uri, index: WorkspaceIndex) => ReturnType<typeof parseDocumentFacts> | undefined
): { controls: Set<string>; buttons: Set<string>; sections: Set<string> } {
  const controls = new Set<string>();
  const buttons = new Set<string>();
  const sections = new Set<string>();
  const facts = getParsedFactsByUri(index, form.uri, getFactsForUri);
  if (!facts) {
    return { controls, buttons, sections };
  }

  const composition = buildDocumentCompositionModel(facts, index);
  for (const contributionRef of collectSelectedDocumentContributions(composition)) {
    if (!contributionMatchesDocumentRoot("Form", contributionRef.contribution)) {
      continue;
    }
    for (const ident of contributionRef.contribution.formControlIdents) {
      controls.add(ident);
    }
    for (const ident of contributionRef.contribution.formButtonIdents) {
      buttons.add(ident);
    }
    for (const ident of contributionRef.contribution.formSectionIdents) {
      sections.add(ident);
    }
  }

  return { controls, buttons, sections };
}
