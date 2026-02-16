import * as vscode from "vscode";
import { WorkspaceIndex, IndexedComponent, IndexedForm } from "./types";
import { globConfiguredXmlFiles, normalizeComponentKey } from "../utils/paths";
import { parseDocumentFactsFromMaskedText } from "./xmlFacts";
import { resolveComponentByKey } from "./componentResolve";
import { maskXmlComments } from "../utils/xmlComments";

interface ParsedEntry {
  uri: vscode.Uri;
  maskedText: string;
  facts: ReturnType<typeof parseDocumentFactsFromMaskedText>;
  root: string;
}

interface PositionResolver {
  uri: vscode.Uri;
  positionAt(offset: number): vscode.Position;
  getText?: () => string;
}

export interface RebuildIndexProgressEvent {
  phase:
    | "discover-start"
    | "discover-done"
    | "parse-start"
    | "parse-progress"
    | "parse-done"
    | "components-start"
    | "components-progress"
    | "components-done"
    | "forms-start"
    | "forms-progress"
    | "forms-done"
    | "references-start"
    | "references-progress"
    | "references-done"
    | "done";
  current?: number;
  total?: number;
  uri?: vscode.Uri;
  message?: string;
}

export interface RebuildIndexOptions {
  onProgress?: (event: RebuildIndexProgressEvent) => void;
  scope?: "all" | "bootstrap";
}

export class WorkspaceIndexer {
  public constructor(private readonly roots?: readonly string[]) {}

  private index: WorkspaceIndex = {
    formsByIdent: new Map<string, IndexedForm>(),
    componentsByKey: new Map<string, IndexedComponent>(),
    componentKeysByBaseName: new Map<string, Set<string>>(),
    formIdentReferenceLocations: new Map<string, vscode.Location[]>(),
    mappingFormIdentReferenceLocations: new Map<string, vscode.Location[]>(),
    controlReferenceLocationsByFormIdent: new Map<string, Map<string, vscode.Location[]>>(),
    buttonReferenceLocationsByFormIdent: new Map<string, Map<string, vscode.Location[]>>(),
    sectionReferenceLocationsByFormIdent: new Map<string, Map<string, vscode.Location[]>>(),
    componentReferenceLocationsByKey: new Map<string, vscode.Location[]>(),
    componentSectionReferenceLocationsByKey: new Map<string, Map<string, vscode.Location[]>>(),
    componentUsageFormIdentsByKey: new Map<string, Set<string>>(),
    componentSectionUsageFormIdentsByKey: new Map<string, Map<string, Set<string>>>(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    formsReady: false,
    componentsReady: false,
    fullReady: false
  };

  public getIndex(): WorkspaceIndex {
    return this.index;
  }

  public refreshFormDocument(document: vscode.TextDocument): {
    updated: boolean;
    reason: "updated" | "not-form" | "missing-ident";
    formIdent?: string;
  } {
    const maskedText = maskXmlComments(document.getText());
    const facts = parseDocumentFactsFromMaskedText(maskedText);
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "form") {
      return { updated: false, reason: "not-form" };
    }

    if (!facts.formIdent) {
      return { updated: false, reason: "missing-ident" };
    }

    const existingIdentByUri = findFormIdentByUri(this.index.formsByIdent, document.uri);
    if (existingIdentByUri && existingIdentByUri !== facts.formIdent) {
      this.index.formsByIdent.delete(existingIdentByUri);
    }

    const formIdentLocation = this.findFormIdentLocation(document, maskedText) ?? new vscode.Location(document.uri, new vscode.Position(0, 0));
    const controlDefinitions = this.collectAttributeDefinitions(document, /<Control\b([^>]*)>/gi, "Ident", maskedText);
    const buttonDefinitions = this.collectAttributeDefinitions(document, /<Button\b([^>]*)>/gi, "Ident", maskedText);
    const sectionDefinitions = this.collectAttributeDefinitions(document, /<Section\b([^>]*)>/gi, "Ident", maskedText);

    const controls = new Set([...facts.declaredControls]);
    const buttons = new Set([...facts.declaredButtons]);
    const sections = new Set([...facts.declaredSections]);

    for (const usingRef of facts.usingReferences) {
      const component = resolveComponentByKey(this.index, usingRef.componentKey);
      if (!component) {
        continue;
      }

      mergeDefinitions(controls, controlDefinitions, component.formControlDefinitions);
      mergeDefinitions(buttons, buttonDefinitions, component.formButtonDefinitions);
      mergeDefinitions(sections, sectionDefinitions, component.formSectionDefinitions);
    }

    const form: IndexedForm = {
      ident: facts.formIdent,
      uri: document.uri,
      controls,
      buttons,
      sections,
      formIdentLocation,
      controlDefinitions,
      buttonDefinitions,
      sectionDefinitions
    };

    this.index.formsByIdent.set(facts.formIdent, form);
    this.index.parsedFactsByUri.set(document.uri.toString(), facts);
    this.index.hasIgnoreDirectiveByUri.set(document.uri.toString(), containsIgnoreDirective(document.getText()));
    this.index.formsReady = true;
    return { updated: true, reason: "updated", formIdent: facts.formIdent };
  }

  public refreshComponentDocument(document: vscode.TextDocument): {
    updated: boolean;
    reason: "updated" | "not-component";
    componentKey?: string;
  } {
    const maskedText = maskXmlComments(document.getText());
    const facts = parseDocumentFactsFromMaskedText(maskedText);
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "component") {
      return { updated: false, reason: "not-component" };
    }

    const key = this.getComponentKey(document.uri);
    const oldKey = findComponentKeyByUri(this.index.componentsByKey, document.uri);
    if (oldKey && oldKey !== key) {
      this.index.componentsByKey.delete(oldKey);
      removeBaseNameVariant(this.index.componentKeysByBaseName, this.getBaseNameFromKey(oldKey), oldKey);
    }

    const sectionDefinitions = this.collectAttributeDefinitions(document, /<Section\b([^>]*)>/gi, "Name", maskedText);
    const formInjected = this.collectFormInjectedDefinitions(document, maskedText);
    const workflowInjected = this.collectWorkflowInjectedDefinitions(document, maskedText);

    const component: IndexedComponent = {
      key,
      uri: document.uri,
      sections: this.readComponentSections(maskedText),
      componentLocation: new vscode.Location(document.uri, new vscode.Position(0, 0)),
      sectionDefinitions,
      formControlDefinitions: formInjected.controls,
      formButtonDefinitions: formInjected.buttons,
      formSectionDefinitions: formInjected.sections,
      workflowControlShareCodeDefinitions: workflowInjected.controlShareCodes,
      workflowButtonShareCodeDefinitions: workflowInjected.buttonShareCodes,
      workflowButtonShareCodeButtonIdents: workflowInjected.buttonShareCodeButtonIdents
    };

    this.index.componentsByKey.set(key, component);
    this.index.parsedFactsByUri.set(document.uri.toString(), facts);
    this.index.hasIgnoreDirectiveByUri.set(document.uri.toString(), containsIgnoreDirective(document.getText()));
    const baseName = this.getBaseNameFromKey(key);
    const variants = this.index.componentKeysByBaseName.get(baseName) ?? new Set<string>();
    variants.add(key);
    this.index.componentKeysByBaseName.set(baseName, variants);
    this.index.componentsReady = true;

    return { updated: true, reason: "updated", componentKey: key };
  }

  public async rebuildIndex(options?: RebuildIndexOptions): Promise<WorkspaceIndex> {
    const onProgress = options?.onProgress;
    const scope = options?.scope ?? "all";
    const allStart = Date.now();
    onProgress?.({ phase: "discover-start", message: "Scanning workspace for XML files." });
    const discoverStart = Date.now();
    const files = await globConfiguredXmlFiles(this.roots);
    const discoverMs = Date.now() - discoverStart;
    onProgress?.({
      phase: "discover-done",
      total: files.length,
      message: `Found ${files.length} XML files in ${discoverMs} ms.`
    });

    const parsedEntries: ParsedEntry[] = [];
    const parsedFactsByUri = new Map<string, ReturnType<typeof parseDocumentFactsFromMaskedText>>();
    const hasIgnoreDirectiveByUri = new Map<string, boolean>();
    const parseBatchSize = 48;
    let processed = 0;
    const parseStart = Date.now();
    onProgress?.({
      phase: "parse-start",
      total: files.length,
      message: `Parsing XML files (${files.length}).`
    });
    for (let offset = 0; offset < files.length; offset += parseBatchSize) {
      const batch = files.slice(offset, offset + parseBatchSize);
      const batchEntries = await Promise.all(
        batch.map(async (uri): Promise<ParsedEntry | undefined> => {
          if (scope === "bootstrap" && !isLikelyBootstrapPath(uri)) {
            return undefined;
          }

          const text = await readWorkspaceFileText(uri);
          const maskedText = maskXmlComments(text);
          const facts = parseDocumentFactsFromMaskedText(maskedText);
          hasIgnoreDirectiveByUri.set(uri.toString(), containsIgnoreDirective(text));
          if (scope === "bootstrap") {
            const root = (facts.rootTag ?? "").toLowerCase();
            if (root !== "component" && root !== "form") {
              return undefined;
            }
          }

          return {
            uri,
            maskedText,
            facts,
            root: (facts.rootTag ?? "").toLowerCase()
          };
        })
      );

      for (let i = 0; i < batch.length; i++) {
        processed++;
        onProgress?.({
          phase: "parse-progress",
          current: processed,
          total: files.length,
          uri: batch[i]
        });
      }

      for (const entry of batchEntries) {
        if (entry) {
          parsedEntries.push(entry);
          parsedFactsByUri.set(entry.uri.toString(), entry.facts);
        }
      }

      await yieldToEventLoop();
    }
    const parseMs = Date.now() - parseStart;
    onProgress?.({
      phase: "parse-done",
      current: processed,
      total: files.length,
      message: `Parsed ${processed}/${files.length} files in ${parseMs} ms (accepted ${parsedEntries.length}).`
    });

    const formsByIdent = new Map<string, IndexedForm>();
    const componentsByKey = new Map<string, IndexedComponent>();
    const componentKeysByBaseName = new Map<string, Set<string>>();
    const formIdentReferenceLocations = new Map<string, vscode.Location[]>();
    const mappingFormIdentReferenceLocations = new Map<string, vscode.Location[]>();
    const controlReferenceLocationsByFormIdent = new Map<string, Map<string, vscode.Location[]>>();
    const buttonReferenceLocationsByFormIdent = new Map<string, Map<string, vscode.Location[]>>();
    const sectionReferenceLocationsByFormIdent = new Map<string, Map<string, vscode.Location[]>>();
    const componentReferenceLocationsByKey = new Map<string, vscode.Location[]>();
    const componentSectionReferenceLocationsByKey = new Map<string, Map<string, vscode.Location[]>>();
    const componentUsageFormIdentsByKey = new Map<string, Set<string>>();
    const componentSectionUsageFormIdentsByKey = new Map<string, Map<string, Set<string>>>();

    const componentEntries = parsedEntries.filter((entry) => entry.root === "component");
    const componentsStart = Date.now();
    onProgress?.({
      phase: "components-start",
      total: componentEntries.length,
      message: `Building component index (${componentEntries.length}).`
    });
    for (let i = 0; i < componentEntries.length; i++) {
      const entry = componentEntries[i];
      if (entry.root !== "component") {
        continue;
      }

      const resolver = createRawResolver(entry.uri, entry.maskedText);
      const key = this.getComponentKey(entry.uri);
      const sectionDefinitions = this.collectAttributeDefinitions(resolver, /<Section\b([^>]*)>/gi, "Name", entry.maskedText);
      const formInjected = this.collectFormInjectedDefinitions(resolver, entry.maskedText);
      const workflowInjected = this.collectWorkflowInjectedDefinitions(resolver, entry.maskedText);

      const component: IndexedComponent = {
        key,
        uri: entry.uri,
        sections: this.readComponentSections(entry.maskedText),
        componentLocation: new vscode.Location(entry.uri, new vscode.Position(0, 0)),
        sectionDefinitions,
        formControlDefinitions: formInjected.controls,
        formButtonDefinitions: formInjected.buttons,
        formSectionDefinitions: formInjected.sections
        ,
        workflowControlShareCodeDefinitions: workflowInjected.controlShareCodes,
        workflowButtonShareCodeDefinitions: workflowInjected.buttonShareCodes,
        workflowButtonShareCodeButtonIdents: workflowInjected.buttonShareCodeButtonIdents
      };

      componentsByKey.set(key, component);
      const baseName = this.getBaseNameFromKey(key);
      const variants = componentKeysByBaseName.get(baseName) ?? new Set<string>();
      variants.add(key);
      componentKeysByBaseName.set(baseName, variants);
      onProgress?.({
        phase: "components-progress",
        current: i + 1,
        total: componentEntries.length,
        uri: entry.uri
      });

      if ((i + 1) % 30 === 0) {
        await yieldToEventLoop();
      }
    }
    const componentsMs = Date.now() - componentsStart;
    onProgress?.({
      phase: "components-done",
      total: componentEntries.length,
      message: `Built ${componentEntries.length} components in ${componentsMs} ms.`
    });

    const provisionalIndex: WorkspaceIndex = {
      formsByIdent: new Map<string, IndexedForm>(),
      componentsByKey,
      componentKeysByBaseName,
      formIdentReferenceLocations: new Map<string, vscode.Location[]>(),
      mappingFormIdentReferenceLocations: new Map<string, vscode.Location[]>(),
      controlReferenceLocationsByFormIdent: new Map<string, Map<string, vscode.Location[]>>(),
      buttonReferenceLocationsByFormIdent: new Map<string, Map<string, vscode.Location[]>>(),
      sectionReferenceLocationsByFormIdent: new Map<string, Map<string, vscode.Location[]>>(),
      componentReferenceLocationsByKey: new Map<string, vscode.Location[]>(),
      componentSectionReferenceLocationsByKey: new Map<string, Map<string, vscode.Location[]>>(),
      componentUsageFormIdentsByKey: new Map<string, Set<string>>(),
      componentSectionUsageFormIdentsByKey: new Map<string, Map<string, Set<string>>>(),
      parsedFactsByUri: new Map(parsedFactsByUri),
      hasIgnoreDirectiveByUri: new Map(hasIgnoreDirectiveByUri),
      formsReady: true,
      componentsReady: true,
      fullReady: scope === "all"
    };

    const formEntries = parsedEntries.filter((entry) => entry.root === "form" && !!entry.facts.formIdent);
    const formsStart = Date.now();
    onProgress?.({
      phase: "forms-start",
      total: formEntries.length,
      message: `Building form index (${formEntries.length}).`
    });
    for (let i = 0; i < formEntries.length; i++) {
      const entry = formEntries[i];
      if (entry.root !== "form" || !entry.facts.formIdent) {
        continue;
      }

      const resolver = createRawResolver(entry.uri, entry.maskedText);
      const formIdentLocation = this.findFormIdentLocation(resolver, entry.maskedText) ?? new vscode.Location(entry.uri, new vscode.Position(0, 0));
      const controlDefinitions = this.collectAttributeDefinitions(resolver, /<Control\b([^>]*)>/gi, "Ident", entry.maskedText);
      const buttonDefinitions = this.collectAttributeDefinitions(resolver, /<Button\b([^>]*)>/gi, "Ident", entry.maskedText);
      const sectionDefinitions = this.collectAttributeDefinitions(resolver, /<Section\b([^>]*)>/gi, "Ident", entry.maskedText);

      const controls = new Set([...entry.facts.declaredControls]);
      const buttons = new Set([...entry.facts.declaredButtons]);
      const sections = new Set([...entry.facts.declaredSections]);

      for (const usingRef of entry.facts.usingReferences) {
        const component = resolveComponentByKey(provisionalIndex, usingRef.componentKey);
        if (!component) {
          continue;
        }

        mergeDefinitions(controls, controlDefinitions, component.formControlDefinitions);
        mergeDefinitions(buttons, buttonDefinitions, component.formButtonDefinitions);
        mergeDefinitions(sections, sectionDefinitions, component.formSectionDefinitions);
      }

      const form: IndexedForm = {
        ident: entry.facts.formIdent,
        uri: entry.uri,
        controls,
        buttons,
        sections,
        formIdentLocation,
        controlDefinitions,
        buttonDefinitions,
        sectionDefinitions
      };

      formsByIdent.set(entry.facts.formIdent, form);
      provisionalIndex.formsByIdent.set(entry.facts.formIdent, form);
      onProgress?.({
        phase: "forms-progress",
        current: i + 1,
        total: formEntries.length,
        uri: entry.uri
      });

      if ((i + 1) % 30 === 0) {
        await yieldToEventLoop();
      }
    }
    const formsMs = Date.now() - formsStart;
    onProgress?.({
      phase: "forms-done",
      total: formEntries.length,
      message: `Built ${formEntries.length} forms in ${formsMs} ms.`
    });

    let processedRefEntries = 0;
    const referencesStart = Date.now();
    onProgress?.({
      phase: "references-start",
      total: parsedEntries.length,
      message: `Resolving references (${parsedEntries.length}).`
    });
    for (const entry of parsedEntries) {
      const root = entry.root;
      const uri = entry.uri;
      const facts = entry.facts;

      for (const ref of facts.formIdentReferences) {
        addLocationMapValue(formIdentReferenceLocations, ref.formIdent, new vscode.Location(uri, ref.range));
      }

      for (const ref of facts.mappingFormIdentReferences) {
        addLocationMapValue(mappingFormIdentReferenceLocations, ref.formIdent, new vscode.Location(uri, ref.range));
      }

      for (const ref of facts.usingReferences) {
        addLocationMapValue(componentReferenceLocationsByKey, ref.componentKey, new vscode.Location(uri, ref.componentValueRange));
        if (ref.sectionValue && ref.sectionValueRange) {
          addNestedLocationMapValue(
            componentSectionReferenceLocationsByKey,
            ref.componentKey,
            ref.sectionValue,
            new vscode.Location(uri, ref.sectionValueRange)
          );
        }
      }

      const owningFormIdent = root === "workflow" ? facts.workflowFormIdent : facts.formIdent;
      if (owningFormIdent) {
        for (const ref of facts.usingReferences) {
          addNestedSetMapValue(componentUsageFormIdentsByKey, ref.componentKey, owningFormIdent);
          if (ref.sectionValue) {
            addNestedNestedSetMapValue(componentSectionUsageFormIdentsByKey, ref.componentKey, ref.sectionValue, owningFormIdent);
          }
        }
      }

      const owningFormIdentForRefs = root === "workflow" ? facts.workflowFormIdent : facts.formIdent;
      if (root === "workflow" && facts.workflowFormIdent) {
        for (const ref of facts.workflowReferences) {
          if (ref.kind === "formControl") {
            addNestedLocationMapValue(
              controlReferenceLocationsByFormIdent,
              facts.workflowFormIdent,
              ref.ident,
              new vscode.Location(uri, ref.range)
            );
            continue;
          }

          if (ref.kind === "button") {
            addNestedLocationMapValue(
              buttonReferenceLocationsByFormIdent,
              facts.workflowFormIdent,
              ref.ident,
              new vscode.Location(uri, ref.range)
            );
            continue;
          }

          if (ref.kind === "section") {
            addNestedLocationMapValue(
              sectionReferenceLocationsByFormIdent,
              facts.workflowFormIdent,
              ref.ident,
              new vscode.Location(uri, ref.range)
            );
          }
        }

        for (const ref of facts.requiredActionIdentReferences) {
          addNestedLocationMapValue(
            controlReferenceLocationsByFormIdent,
            facts.workflowFormIdent,
            ref.ident,
            new vscode.Location(uri, ref.range)
          );
        }

        for (const ref of facts.workflowControlIdentReferences) {
          addNestedLocationMapValue(
            controlReferenceLocationsByFormIdent,
            facts.workflowFormIdent,
            ref.ident,
            new vscode.Location(uri, ref.range)
          );
        }
      }

      if (owningFormIdentForRefs) {
        for (const mappingRef of facts.mappingIdentReferences) {
          if (mappingRef.kind === "fromIdent") {
            addNestedLocationMapValue(
              controlReferenceLocationsByFormIdent,
              owningFormIdentForRefs,
              mappingRef.ident,
              new vscode.Location(uri, mappingRef.range)
            );
            continue;
          }

          const targetFormIdent = mappingRef.mappingFormIdent ?? owningFormIdentForRefs;
          addNestedLocationMapValue(
            controlReferenceLocationsByFormIdent,
            targetFormIdent,
            mappingRef.ident,
            new vscode.Location(uri, mappingRef.range)
          );
        }
      }

      if (root === "form" && facts.formIdent) {
        for (const htmlRef of facts.htmlControlReferences) {
          addNestedLocationMapValue(
            controlReferenceLocationsByFormIdent,
            facts.formIdent,
            htmlRef.ident,
            new vscode.Location(uri, htmlRef.range)
          );
        }
      }

      processedRefEntries++;
      if (processedRefEntries % 100 === 0 || processedRefEntries === parsedEntries.length) {
        onProgress?.({
          phase: "references-progress",
          current: processedRefEntries,
          total: parsedEntries.length
        });
      }
      if (processedRefEntries % 50 === 0) {
        await yieldToEventLoop();
      }
    }
    const referencesMs = Date.now() - referencesStart;
    onProgress?.({
      phase: "references-done",
      total: parsedEntries.length,
      message: `Resolved references for ${parsedEntries.length} files in ${referencesMs} ms.`
    });

    this.index = {
      formsByIdent,
      componentsByKey,
      componentKeysByBaseName,
      formIdentReferenceLocations,
      mappingFormIdentReferenceLocations,
      controlReferenceLocationsByFormIdent,
      buttonReferenceLocationsByFormIdent,
      sectionReferenceLocationsByFormIdent,
      componentReferenceLocationsByKey,
      componentSectionReferenceLocationsByKey,
      componentUsageFormIdentsByKey,
      componentSectionUsageFormIdentsByKey,
      parsedFactsByUri,
      hasIgnoreDirectiveByUri,
      formsReady: true,
      componentsReady: true,
      fullReady: scope === "all"
    };
    const totalMs = Date.now() - allStart;
    onProgress?.({
      phase: "done",
      message:
        `Index ready in ${totalMs} ms: forms=${formsByIdent.size}, components=${componentsByKey.size}, ` +
        `discover=${discoverMs} ms, parse=${parseMs} ms, components=${componentsMs} ms, forms=${formsMs} ms, refs=${referencesMs} ms.`
    });

    return this.index;
  }

  private collectFormInjectedDefinitions(document: PositionResolver, preMaskedText?: string): {
    controls: Map<string, vscode.Location>;
    buttons: Map<string, vscode.Location>;
    sections: Map<string, vscode.Location>;
  } {
    const text = resolveMaskedText(document, preMaskedText);
    const controls = new Map<string, vscode.Location>();
    const buttons = new Map<string, vscode.Location>();
    const sections = new Map<string, vscode.Location>();

    const sectionRegex = /<Section\b([^>]*)>([\s\S]*?)<\/Section>/gi;
    for (const match of text.matchAll(sectionRegex)) {
      const attrs = match[1] ?? "";
      const content = match[2] ?? "";
      const full = match[0] ?? "";
      const start = match.index ?? 0;

      const root = extractAttributeValue(attrs, "Root");
      if (!appliesToFormRoot(root)) {
        continue;
      }

      const contentOffset = full.indexOf(content);
      if (contentOffset < 0) {
        continue;
      }

      const contentStart = start + contentOffset;
      mergeInto(
        controls,
        this.collectAttributeDefinitionsFromText(document, content, contentStart, /<Control\b([^>]*)>/gi, "Ident", true)
      );
      mergeInto(
        buttons,
        this.collectAttributeDefinitionsFromText(document, content, contentStart, /<Button\b([^>]*)>/gi, "Ident", true)
      );
      mergeInto(
        sections,
        this.collectAttributeDefinitionsFromText(document, content, contentStart, /<Section\b([^>]*)>/gi, "Ident", true)
      );
    }

    return { controls, buttons, sections };
  }

  private collectWorkflowInjectedDefinitions(document: PositionResolver, preMaskedText?: string): {
    controlShareCodes: Map<string, vscode.Location>;
    buttonShareCodes: Map<string, vscode.Location>;
    buttonShareCodeButtonIdents: Map<string, Set<string>>;
  } {
    const text = resolveMaskedText(document, preMaskedText);
    const controlShareCodes = new Map<string, vscode.Location>();
    const buttonShareCodes = new Map<string, vscode.Location>();
    const buttonShareCodeButtonIdents = new Map<string, Set<string>>();

    const sectionRegex = /<Section\b([^>]*)>([\s\S]*?)<\/Section>/gi;
    for (const match of text.matchAll(sectionRegex)) {
      const attrs = match[1] ?? "";
      const content = match[2] ?? "";
      const full = match[0] ?? "";
      const start = match.index ?? 0;

      const root = extractAttributeValue(attrs, "Root");
      if (!appliesToWorkflowRoot(root)) {
        continue;
      }

      const contentOffset = full.indexOf(content);
      if (contentOffset < 0) {
        continue;
      }

      const contentStart = start + contentOffset;
      mergeInto(
        controlShareCodes,
        this.collectAttributeDefinitionsFromText(document, content, contentStart, /<ControlShareCode\b([^>]*)>/gi, "Ident", true)
      );
      mergeInto(
        buttonShareCodes,
        this.collectAttributeDefinitionsFromText(document, content, contentStart, /<ButtonShareCode\b([^>]*)>/gi, "Ident", true)
      );
      mergeSetMapInto(buttonShareCodeButtonIdents, this.collectButtonShareCodeButtonIdentsFromText(content));
    }

    return { controlShareCodes, buttonShareCodes, buttonShareCodeButtonIdents };
  }

  private collectButtonShareCodeButtonIdentsFromText(text: string): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const match of text.matchAll(/<ButtonShareCode\b([^>]*)>([\s\S]*?)<\/ButtonShareCode>/gi)) {
      const attrs = match[1] ?? "";
      const identMatch = /\bIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
      const shareCodeIdent = (identMatch?.[2] ?? identMatch?.[3] ?? "").trim();
      if (!shareCodeIdent) {
        continue;
      }

      const set = out.get(shareCodeIdent) ?? new Set<string>();
      const body = match[2] ?? "";
      for (const buttonMatch of body.matchAll(/<Button\b([^>]*)>/gi)) {
        const buttonAttrs = buttonMatch[1] ?? "";
        const buttonIdentMatch = /\bIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(buttonAttrs);
        const buttonIdent = (buttonIdentMatch?.[2] ?? buttonIdentMatch?.[3] ?? "").trim();
        if (!buttonIdent) {
          continue;
        }

        const buttonTypeMatch = /\b(?:xsi:type|type)\s*=\s*("([^"]*)"|'([^']*)')/i.exec(buttonAttrs);
        const buttonType = (buttonTypeMatch?.[2] ?? buttonTypeMatch?.[3] ?? "").trim().toLowerCase();
        if (buttonType === "sharecodebutton") {
          continue;
        }

        set.add(buttonIdent);
      }

      out.set(shareCodeIdent, set);
    }

    return out;
  }

  private collectAttributeDefinitionsFromText(
    document: PositionResolver,
    text: string,
    globalTextOffset: number,
    tagRegex: RegExp,
    attributeName: string,
    commentsAlreadyMasked = false
  ): Map<string, vscode.Location> {
    const scanText = commentsAlreadyMasked ? text : maskXmlComments(text);
    const result = new Map<string, vscode.Location>();
    const attrRegex = new RegExp(`${attributeName}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");

    for (const m of scanText.matchAll(tagRegex)) {
      const attrs = m[1] ?? "";
      const attrMatch = attrRegex.exec(attrs);
      if (!attrMatch) {
        continue;
      }

      const value = (attrMatch[2] ?? attrMatch[3] ?? "").trim();
      if (!value) {
        continue;
      }

      const offsetInAttrs = attrs.indexOf(value);
      const attrsOffsetInTag = (m[0] ?? "").indexOf(attrs);
      if (offsetInAttrs < 0 || attrsOffsetInTag < 0) {
        continue;
      }

      const globalStart = globalTextOffset + (m.index ?? 0) + attrsOffsetInTag + offsetInAttrs;
      const start = document.positionAt(globalStart);
      const end = document.positionAt(globalStart + value.length);
      result.set(value, new vscode.Location(document.uri, new vscode.Range(start, end)));
    }

    return result;
  }

  private findFormIdentLocation(document: PositionResolver, preMaskedText?: string): vscode.Location | undefined {
    const text = resolveMaskedText(document, preMaskedText);
    const match = /<Form\b[^>]*\bIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(text);
    if (!match) {
      return undefined;
    }

    const value = (match[2] ?? match[3] ?? "").trim();
    if (!value) {
      return undefined;
    }

    const valueOffset = match[0].indexOf(value);
    if (valueOffset < 0) {
      return undefined;
    }

    const globalStart = (match.index ?? 0) + valueOffset;
    const start = document.positionAt(globalStart);
    const end = document.positionAt(globalStart + value.length);

    return new vscode.Location(document.uri, new vscode.Range(start, end));
  }

  private collectAttributeDefinitions(
    document: PositionResolver,
    tagRegex: RegExp,
    attributeName: string,
    preMaskedText?: string
  ): Map<string, vscode.Location> {
    const text = resolveMaskedText(document, preMaskedText);
    return this.collectAttributeDefinitionsFromText(document, text, 0, tagRegex, attributeName, true);
  }

  private readComponentSections(preMaskedText?: string): Set<string> {
    const text = preMaskedText ?? "";
    const sections = new Set<string>();
    for (const m of text.matchAll(/<Section\b[^>]*\bName\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const name = (m[2] ?? m[3] ?? "").trim();
      if (name) {
        sections.add(name);
      }
    }

    return sections;
  }

  private getComponentKey(uri: vscode.Uri): string {
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
    const relLower = rel.toLowerCase();
    const marker = "xml_components/";
    const markerWithSlash = `/${marker}`;
    const markerIndex = relLower.indexOf(markerWithSlash);

    let fromRoot = rel;
    if (relLower.startsWith(marker)) {
      fromRoot = rel.slice(marker.length);
    } else if (markerIndex >= 0) {
      fromRoot = rel.slice(markerIndex + markerWithSlash.length);
    }

    return normalizeComponentKey(fromRoot);
  }

  private getBaseNameFromKey(key: string): string {
    const pieces = key.split("/");
    return pieces[pieces.length - 1] ?? key;
  }
}

function mergeDefinitions(
  idsSet: Set<string>,
  targetDefinitions: Map<string, vscode.Location>,
  sourceDefinitions: Map<string, vscode.Location>
): void {
  for (const [key, location] of sourceDefinitions.entries()) {
    idsSet.add(key);
    if (!targetDefinitions.has(key)) {
      targetDefinitions.set(key, location);
    }
  }
}

function mergeInto(target: Map<string, vscode.Location>, source: Map<string, vscode.Location>): void {
  for (const [k, v] of source.entries()) {
    if (!target.has(k)) {
      target.set(k, v);
    }
  }
}

function mergeSetMapInto(target: Map<string, Set<string>>, source: Map<string, Set<string>>): void {
  for (const [k, v] of source.entries()) {
    const existing = target.get(k) ?? new Set<string>();
    for (const item of v) {
      existing.add(item);
    }

    target.set(k, existing);
  }
}

function addLocationMapValue(target: Map<string, vscode.Location[]>, key: string, location: vscode.Location): void {
  if (!key) {
    return;
  }

  const existing = target.get(key) ?? [];
  existing.push(location);
  target.set(key, existing);
}

function addNestedLocationMapValue(
  target: Map<string, Map<string, vscode.Location[]>>,
  formIdent: string,
  ident: string,
  location: vscode.Location
): void {
  if (!formIdent || !ident) {
    return;
  }

  const byIdent = target.get(formIdent) ?? new Map<string, vscode.Location[]>();
  const existing = byIdent.get(ident) ?? [];
  existing.push(location);
  byIdent.set(ident, existing);
  target.set(formIdent, byIdent);
}

function addNestedSetMapValue(target: Map<string, Set<string>>, key: string, value: string): void {
  if (!key || !value) {
    return;
  }

  const existing = target.get(key) ?? new Set<string>();
  existing.add(value);
  target.set(key, existing);
}

function addNestedNestedSetMapValue(
  target: Map<string, Map<string, Set<string>>>,
  key1: string,
  key2: string,
  value: string
): void {
  if (!key1 || !key2 || !value) {
    return;
  }

  const bySecond = target.get(key1) ?? new Map<string, Set<string>>();
  const existing = bySecond.get(key2) ?? new Set<string>();
  existing.add(value);
  bySecond.set(key2, existing);
  target.set(key1, bySecond);
}

function extractAttributeValue(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = regex.exec(attrs);
  if (!match) {
    return undefined;
  }

  return (match[2] ?? match[3] ?? "").trim();
}

function appliesToFormRoot(root: string | undefined): boolean {
  if (!root || root.length === 0) {
    return true;
  }

  const parts = root
    .split(/[\s,;|]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return parts.includes("form");
}

function appliesToWorkflowRoot(root: string | undefined): boolean {
  if (!root || root.length === 0) {
    return false;
  }

  const parts = root
    .split(/[\s,;|]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return parts.includes("workflow");
}

function isLikelyBootstrapPath(uri: vscode.Uri): boolean {
  const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)xml_components\//.test(rel)) {
    return true;
  }

  const file = rel.split("/").pop() ?? rel;
  if (file.includes("workflow") || file.includes("view") || file.includes("filter") || file.includes("dashboard")) {
    return false;
  }

  return true;
}

function containsIgnoreDirective(text: string): boolean {
  return /@Ignore/i.test(text);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function readWorkspaceFileText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function createRawResolver(uri: vscode.Uri, text: string): PositionResolver {
  const lineStarts = computeLineStarts(text);
  return {
    uri,
    positionAt(offset: number): vscode.Position {
      return offsetToPosition(lineStarts, offset, text.length);
    }
  };
}

function resolveMaskedText(document: PositionResolver, preMaskedText?: string): string {
  if (preMaskedText !== undefined) {
    return preMaskedText;
  }

  if (typeof document.getText === "function") {
    return maskXmlComments(document.getText());
  }

  return "";
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }

  return starts;
}

function offsetToPosition(lineStarts: readonly number[], offset: number, textLength: number): vscode.Position {
  const safe = Math.max(0, Math.min(offset, textLength));
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid];
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
    if (safe < start) {
      high = mid - 1;
    } else if (safe >= nextStart) {
      low = mid + 1;
    } else {
      return new vscode.Position(mid, safe - start);
    }
  }

  const line = Math.max(0, Math.min(lineStarts.length - 1, low));
  const start = lineStarts[line] ?? 0;
  return new vscode.Position(line, safe - start);
}

function findFormIdentByUri(formsByIdent: Map<string, IndexedForm>, uri: vscode.Uri): string | undefined {
  const key = uri.toString();
  for (const [ident, form] of formsByIdent.entries()) {
    if (form.uri.toString() === key) {
      return ident;
    }
  }

  return undefined;
}

function findComponentKeyByUri(componentsByKey: Map<string, IndexedComponent>, uri: vscode.Uri): string | undefined {
  const key = uri.toString();
  for (const [componentKey, component] of componentsByKey.entries()) {
    if (component.uri.toString() === key) {
      return componentKey;
    }
  }

  return undefined;
}

function removeBaseNameVariant(componentKeysByBaseName: Map<string, Set<string>>, baseName: string, key: string): void {
  const variants = componentKeysByBaseName.get(baseName);
  if (!variants) {
    return;
  }

  variants.delete(key);
  if (variants.size === 0) {
    componentKeysByBaseName.delete(baseName);
  } else {
    componentKeysByBaseName.set(baseName, variants);
  }
}
