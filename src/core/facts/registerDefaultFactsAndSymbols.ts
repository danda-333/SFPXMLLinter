import { parseDocumentFactsFromText } from "../../indexer/xmlFacts";
import { FactRegistry } from "./factRegistry";
import { SymbolRegistry } from "../symbols/symbolRegistry";

type ParsedFacts = ReturnType<typeof parseDocumentFactsFromText>;

export interface RegisterDefaultFactsAndSymbolsDeps {
  factRegistry: FactRegistry;
  symbolRegistry: SymbolRegistry;
  resolveParsedFacts: (nodeId: string) => ParsedFacts | undefined;
}

interface WorkflowRef {
  kind: string;
  ident: string;
  range?: import("vscode").Range;
}

interface SymbolDeclsFact {
  controls: Array<{ ident: string; range?: import("vscode").Range }>;
  buttons: Array<{ ident: string; range?: import("vscode").Range }>;
  sections: Array<{ ident: string; range?: import("vscode").Range }>;
  controlShareCodes: Array<{ ident: string; range?: import("vscode").Range }>;
  actionShareCodes: Array<{ ident: string; range?: import("vscode").Range }>;
  buttonShareCodes: Array<{ ident: string; range?: import("vscode").Range }>;
}

export function registerDefaultFactsAndSymbols(deps: RegisterDefaultFactsAndSymbolsDeps): void {
  const { factRegistry, symbolRegistry, resolveParsedFacts } = deps;
  const getFacts = (nodeId: string): ParsedFacts | undefined => resolveParsedFacts(nodeId);

  factRegistry.register({
    kind: "fact.parsedDocument",
    collect(nodeId) {
      return getFacts(nodeId);
    }
  });

  factRegistry.register({
    kind: "fact.rootMeta",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      if (!facts) {
        return undefined;
      }
      return {
        rootTag: facts.rootTag,
        rootIdent: facts.rootIdent,
        rootFormIdent: facts.rootFormIdent,
        formIdent: facts.formIdent,
        workflowFormIdent: facts.workflowFormIdent
      };
    }
  });

  factRegistry.register({
    kind: "fact.usingRefs",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      return facts?.usingReferences ?? [];
    }
  });

  factRegistry.register({
    kind: "fact.includeRefs",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      return facts?.includeReferences ?? [];
    }
  });

  factRegistry.register({
    kind: "fact.placeholderRefs",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      return facts?.placeholderReferences ?? [];
    }
  });

  factRegistry.register({
    kind: "fact.workflowRefs",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      return (facts?.workflowReferences ?? []) as WorkflowRef[];
    }
  });

  factRegistry.register({
    kind: "fact.mappingRefs",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      if (!facts) {
        return {
          mappingIdentReferences: [],
          mappingFormIdentReferences: [],
          formIdentReferences: []
        };
      }
      return {
        mappingIdentReferences: facts.mappingIdentReferences,
        mappingFormIdentReferences: facts.mappingFormIdentReferences,
        formIdentReferences: facts.formIdentReferences
      };
    }
  });

  factRegistry.register({
    kind: "fact.symbolDecls",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      if (!facts) {
        return {
          controls: [] as Array<{ ident: string; range?: import("vscode").Range }>,
          buttons: [] as Array<{ ident: string; range?: import("vscode").Range }>,
          sections: [] as Array<{ ident: string; range?: import("vscode").Range }>,
          controlShareCodes: [] as Array<{ ident: string; range?: import("vscode").Range }>,
          actionShareCodes: [] as Array<{ ident: string; range?: import("vscode").Range }>,
          buttonShareCodes: [] as Array<{ ident: string; range?: import("vscode").Range }>
        } satisfies SymbolDeclsFact;
      }

      const controlRanges = new Map<string, import("vscode").Range>();
      const buttonRanges = new Map<string, import("vscode").Range>();
      const sectionRanges = new Map<string, import("vscode").Range>();
      for (const occurrence of facts.identOccurrences) {
        if (occurrence.kind === "control" && !controlRanges.has(occurrence.ident)) {
          controlRanges.set(occurrence.ident, occurrence.range);
        }
        if (occurrence.kind === "button" && !buttonRanges.has(occurrence.ident)) {
          buttonRanges.set(occurrence.ident, occurrence.range);
        }
        if (occurrence.kind === "section" && !sectionRanges.has(occurrence.ident)) {
          sectionRanges.set(occurrence.ident, occurrence.range);
        }
      }

      return {
        controls: [...facts.declaredControls].map((ident) => ({ ident, range: controlRanges.get(ident) })),
        buttons: [...facts.declaredButtons].map((ident) => ({ ident, range: buttonRanges.get(ident) })),
        sections: [...facts.declaredSections].map((ident) => ({ ident, range: sectionRanges.get(ident) })),
        controlShareCodes: [...facts.declaredControlShareCodes].map((ident) => ({ ident, range: facts.controlShareCodeDefinitions.get(ident) })),
        actionShareCodes: [...facts.declaredActionShareCodes].map((ident) => ({ ident, range: facts.actionShareCodeDefinitions.get(ident) })),
        buttonShareCodes: [...facts.declaredButtonShareCodes].map((ident) => ({ ident, range: facts.buttonShareCodeDefinitions.get(ident) }))
      } satisfies SymbolDeclsFact;
    }
  });

  factRegistry.register({
    kind: "fact.shareCodeDecls",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      if (!facts) {
        return {
          controlShareCodes: [] as string[],
          actionShareCodes: [] as string[],
          buttonShareCodes: [] as string[]
        };
      }
      return {
        controlShareCodes: [...facts.declaredControlShareCodes],
        actionShareCodes: [...facts.declaredActionShareCodes],
        buttonShareCodes: [...facts.declaredButtonShareCodes]
      };
    }
  });

  factRegistry.register({
    kind: "fact.rangeIndex",
    collect(nodeId) {
      const facts = getFacts(nodeId);
      if (!facts) {
        return {
          rootIdentRange: undefined,
          workflowFormIdentRange: undefined,
          rootFormIdentRange: undefined,
          identOccurrences: []
        };
      }
      return {
        rootIdentRange: facts.rootIdentRange,
        workflowFormIdentRange: facts.workflowFormIdentRange,
        rootFormIdentRange: facts.rootFormIdentRange,
        identOccurrences: facts.identOccurrences
      };
    }
  });

  symbolRegistry.registerResolver({
    kind: "control",
    collectDefs(nodeId) {
      const decls = factRegistry.getFact(nodeId, "fact.symbolDecls", "symbol:control:defs") as SymbolDeclsFact | undefined;
      if (!decls) {
        return [];
      }

      return [...decls.controls].map(({ ident, range }) => ({
        key: `control:${ident}` as const,
        kind: "control",
        ident,
        nodeId,
        range
      }));
    },
    collectRefs(nodeId) {
      const refs = factRegistry.getFact(nodeId, "fact.workflowRefs", "symbol:control:refs") as WorkflowRef[] | undefined;
      if (!refs) {
        return [];
      }

      return refs
        .filter((ref) => ref.kind === "formControl")
        .map((ref) => ({
          target: `control:${ref.ident}` as const,
          kind: "control",
          ident: ref.ident,
          nodeId,
          range: ref.range
        }));
    }
  });

  symbolRegistry.registerResolver({
    kind: "button",
    collectDefs(nodeId) {
      const decls = factRegistry.getFact(nodeId, "fact.symbolDecls", "symbol:button:defs") as SymbolDeclsFact | undefined;
      if (!decls) {
        return [];
      }

      return [...decls.buttons].map(({ ident, range }) => ({
        key: `button:${ident}` as const,
        kind: "button",
        ident,
        nodeId,
        range
      }));
    },
    collectRefs(nodeId) {
      const refs = factRegistry.getFact(nodeId, "fact.workflowRefs", "symbol:button:refs") as WorkflowRef[] | undefined;
      if (!refs) {
        return [];
      }

      return refs
        .filter((ref) => ref.kind === "button")
        .map((ref) => ({
          target: `button:${ref.ident}` as const,
          kind: "button",
          ident: ref.ident,
          nodeId,
          range: ref.range
        }));
    }
  });

  symbolRegistry.registerResolver({
    kind: "section",
    collectDefs(nodeId) {
      const decls = factRegistry.getFact(nodeId, "fact.symbolDecls", "symbol:section:defs") as SymbolDeclsFact | undefined;
      if (!decls) {
        return [];
      }

      return [...decls.sections].map(({ ident, range }) => ({
        key: `section:${ident}` as const,
        kind: "section",
        ident,
        nodeId,
        range
      }));
    },
    collectRefs(nodeId) {
      const refs = factRegistry.getFact(nodeId, "fact.workflowRefs", "symbol:section:refs") as WorkflowRef[] | undefined;
      if (!refs) {
        return [];
      }

      return refs
        .filter((ref) => ref.kind === "section")
        .map((ref) => ({
          target: `section:${ref.ident}` as const,
          kind: "section",
          ident: ref.ident,
          nodeId,
          range: ref.range
        }));
    }
  });

  symbolRegistry.registerResolver({
    kind: "controlShareCode",
    collectDefs(nodeId) {
      const decls = factRegistry.getFact(nodeId, "fact.symbolDecls", "symbol:controlShareCode:defs") as SymbolDeclsFact | undefined;
      if (!decls) {
        return [];
      }

      return [...decls.controlShareCodes].map(({ ident, range }) => ({
        key: `controlShareCode:${ident}` as const,
        kind: "controlShareCode",
        ident,
        nodeId,
        range
      }));
    },
    collectRefs(nodeId) {
      const refs = factRegistry.getFact(nodeId, "fact.workflowRefs", "symbol:controlShareCode:refs") as WorkflowRef[] | undefined;
      if (!refs) {
        return [];
      }

      return refs
        .filter((ref) => ref.kind === "controlShareCode")
        .map((ref) => ({
          target: `controlShareCode:${ref.ident}` as const,
          kind: "controlShareCode",
          ident: ref.ident,
          nodeId,
          range: ref.range
        }));
    }
  });

  symbolRegistry.registerResolver({
    kind: "buttonShareCode",
    collectDefs(nodeId) {
      const decls = factRegistry.getFact(nodeId, "fact.symbolDecls", "symbol:buttonShareCode:defs") as SymbolDeclsFact | undefined;
      if (!decls) {
        return [];
      }

      return [...decls.buttonShareCodes].map(({ ident, range }) => ({
        key: `buttonShareCode:${ident}` as const,
        kind: "buttonShareCode",
        ident,
        nodeId,
        range
      }));
    },
    collectRefs(nodeId) {
      const refs = factRegistry.getFact(nodeId, "fact.workflowRefs", "symbol:buttonShareCode:refs") as WorkflowRef[] | undefined;
      if (!refs) {
        return [];
      }

      return refs
        .filter((ref) => ref.kind === "buttonShareCode")
        .map((ref) => ({
          target: `buttonShareCode:${ref.ident}` as const,
          kind: "buttonShareCode",
          ident: ref.ident,
          nodeId,
          range: ref.range
        }));
    }
  });

  symbolRegistry.registerResolver({
    kind: "actionShareCode",
    collectDefs(nodeId) {
      const decls = factRegistry.getFact(nodeId, "fact.symbolDecls", "symbol:actionShareCode:defs") as SymbolDeclsFact | undefined;
      if (!decls) {
        return [];
      }

      return [...decls.actionShareCodes].map(({ ident, range }) => ({
        key: `actionShareCode:${ident}` as const,
        kind: "actionShareCode",
        ident,
        nodeId,
        range
      }));
    },
    collectRefs() {
      return [];
    }
  });
}
