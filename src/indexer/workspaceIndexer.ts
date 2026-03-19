import * as vscode from "vscode";
import * as nodeFs from "node:fs/promises";
import { WorkspaceIndex, IndexedComponent, IndexedForm, IndexedComponentContributionSummary } from "./types";
import { IndexedSymbolProvenanceProvider } from "./types";
import { globConfiguredXmlFiles, normalizeComponentKey } from "../utils/paths";
import { ParsedDocumentFacts, parseDocumentFactsFromMaskedText } from "./xmlFacts";
import { resolveComponentByKey } from "./componentResolve";
import { toIndexUriKey } from "./uriKey";
import { maskXmlComments } from "../utils/xmlComments";
import { populateUsingInsertTraceFromText } from "../composition/usingImpact";
import { collectEffectiveUsingRefs } from "../utils/effectiveUsings";

interface ParsedEntry {
  uri: vscode.Uri;
  maskedText: string;
  facts: ReturnType<typeof parseDocumentFactsFromMaskedText>;
  root: string;
  parseSignature: string;
}

interface ParsedEntryCacheRecord {
  mtimeMs: number;
  size: number;
  maskedText: string;
  facts: ReturnType<typeof parseDocumentFactsFromMaskedText>;
  root: string;
  hasIgnoreDirective: boolean;
  parseSignature: string;
}

interface UsingTraceCacheRecord {
  parseSignature: string;
  contextSignature: string;
  traces: Map<string, import("./xmlFacts").UsingContributionInsertTrace>;
}

interface PositionResolver {
  uri: vscode.Uri;
  positionAt(offset: number): vscode.Position;
  getText?: () => string;
}

export interface RefreshXmlDocumentOptions {
  composedOutput?: boolean;
  skipUsingTrace?: boolean;
  lightweightFormSymbols?: boolean;
  skipIgnoreDirectiveScan?: boolean;
}

export interface RefreshXmlBatchProfile {
  totalMs: number;
  perRootMs: Record<"form" | "workflow" | "dataview" | "component" | "feature" | "other", number>;
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

  private readonly parsedEntryCacheByUri = new Map<string, ParsedEntryCacheRecord>();
  private readonly usingTraceCacheByUri = new Map<string, UsingTraceCacheRecord>();

  private index: WorkspaceIndex = {
    formsByIdent: new Map<string, IndexedForm>(),
    formIdentByUri: new Map<string, string>(),
    componentsByKey: new Map<string, IndexedComponent>(),
    componentKeyByUri: new Map<string, string>(),
    componentKeysByBaseName: new Map<string, Set<string>>(),
    parsedFactsByUri: new Map(),
    hasIgnoreDirectiveByUri: new Map(),
    builtSymbolProvidersByUri: new Map(),
    formsReady: false,
    componentsReady: false,
    fullReady: false
  };

  public getIndex(): WorkspaceIndex {
    return this.index;
  }

  public setBuiltSymbolProvidersForUri(
    uri: vscode.Uri,
    providersBySymbolKey: Map<string, IndexedSymbolProvenanceProvider[]>
  ): void {
    if (!this.index.builtSymbolProvidersByUri) {
      this.index.builtSymbolProvidersByUri = new Map();
    }
    this.index.builtSymbolProvidersByUri.set(toIndexUriKey(uri), providersBySymbolKey);
  }

  public refreshXmlDocument(
    document: vscode.TextDocument,
    options?: RefreshXmlDocumentOptions
  ): {
    updated: boolean;
    reason: "updated" | "not-form" | "missing-ident" | "not-component" | "facts-only";
    rootKind: "form" | "workflow" | "dataview" | "component" | "feature" | "other";
    formIdent?: string;
    componentKey?: string;
    owningFormIdent?: string;
  } {
    const maskedText = maskXmlComments(document.getText());
    const root = options?.composedOutput === true
      ? extractRootTagFast(maskedText)
      : (parseDocumentFactsFromMaskedText(maskedText).rootTag ?? "").toLowerCase();

    const cleanupOldByUri = (): void => {
      this.removeIndexedEntitiesForUri(document.uri);
    };

    if (root === "form") {
      const refreshed = this.refreshFormDocument(document, options, maskedText);
      return {
        ...refreshed,
        rootKind: "form"
      };
    }

    if (root === "component" || root === "feature") {
      const refreshed = this.refreshComponentDocument(document);
      return {
        ...refreshed,
        rootKind: root
      };
    }

    // For workflow/dataview/other files we still keep parsed facts up to date,
    // so dependent diagnostics can run against fresh inherited usings/model.
    const facts = parseDocumentFactsFromMaskedText(maskedText);
    cleanupOldByUri();
    this.index.parsedFactsByUri.set(document.uri.toString(), facts);
    this.index.hasIgnoreDirectiveByUri.set(
      document.uri.toString(),
      options?.skipIgnoreDirectiveScan === true ? false : containsIgnoreDirective(document.getText())
    );

    const owningFormIdent = root === "workflow"
      ? (facts.workflowFormIdent ?? facts.rootFormIdent)
      : root === "dataview"
        ? facts.rootFormIdent
        : undefined;
    return {
      updated: true,
      reason: "facts-only",
      rootKind:
        root === "workflow"
          ? "workflow"
          : root === "dataview"
            ? "dataview"
            : "other",
      owningFormIdent
    };
  }

  public refreshXmlDocumentsBatch(
    documents: readonly vscode.TextDocument[],
    options?: RefreshXmlDocumentOptions
  ): {
    updatedCount: number;
    byRootKind: Record<"form" | "workflow" | "dataview" | "component" | "feature" | "other", number>;
    owningFormIdents: Set<string>;
    profile: RefreshXmlBatchProfile;
  } {
    let updatedCount = 0;
    const byRootKind: Record<"form" | "workflow" | "dataview" | "component" | "feature" | "other", number> = {
      form: 0,
      workflow: 0,
      dataview: 0,
      component: 0,
      feature: 0,
      other: 0
    };
    const owningFormIdents = new Set<string>();
    const perRootMs: Record<"form" | "workflow" | "dataview" | "component" | "feature" | "other", number> = {
      form: 0,
      workflow: 0,
      dataview: 0,
      component: 0,
      feature: 0,
      other: 0
    };
    const startedAt = Date.now();

    for (const document of documents) {
      const docStartedAt = Date.now();
      const result = this.refreshXmlDocument(document, options);
      const elapsed = Date.now() - docStartedAt;
      byRootKind[result.rootKind] += 1;
      perRootMs[result.rootKind] += elapsed;
      if (result.updated) {
        updatedCount += 1;
      }
      if (result.owningFormIdent) {
        owningFormIdents.add(result.owningFormIdent);
      }
    }

    return {
      updatedCount,
      byRootKind,
      owningFormIdents,
      profile: {
        totalMs: Date.now() - startedAt,
        perRootMs
      }
    };
  }

  public refreshFormDocument(
    document: vscode.TextDocument,
    options?: RefreshXmlDocumentOptions,
    preMaskedText?: string
  ): {
    updated: boolean;
    reason: "updated" | "not-form" | "missing-ident";
    formIdent?: string;
  } {
    const maskedText = preMaskedText ?? maskXmlComments(document.getText());
    const facts = parseDocumentFactsFromMaskedText(maskedText);
    const root = (facts.rootTag ?? "").toLowerCase();
    if (root !== "form") {
      return { updated: false, reason: "not-form" };
    }

    if (!facts.formIdent) {
      return { updated: false, reason: "missing-ident" };
    }

    const uriKey = toIndexUriKey(document.uri);
    const existingComponentKeyByUri = this.index.componentKeyByUri.get(uriKey);
    if (existingComponentKeyByUri) {
      this.index.componentsByKey.delete(existingComponentKeyByUri);
      this.index.componentKeyByUri.delete(uriKey);
      removeBaseNameVariant(
        this.index.componentKeysByBaseName,
        this.getBaseNameFromKey(existingComponentKeyByUri),
        existingComponentKeyByUri
      );
    }
    const existingIdentByUri = this.index.formIdentByUri.get(uriKey);
    if (existingIdentByUri && existingIdentByUri !== facts.formIdent) {
      this.index.formsByIdent.delete(existingIdentByUri);
      this.index.formIdentByUri.delete(uriKey);
    }

    const lightweightFormSymbols = options?.lightweightFormSymbols === true;
    const formIdentLocation = lightweightFormSymbols
      ? new vscode.Location(document.uri, new vscode.Position(0, 0))
      : (this.findFormIdentLocation(document, maskedText) ?? new vscode.Location(document.uri, new vscode.Position(0, 0)));
    const controlDefinitions = lightweightFormSymbols
      ? new Map<string, vscode.Location>()
      : this.collectAttributeDefinitions(document, /<Control\b([^>]*)>/gi, "Ident", maskedText);
    const buttonDefinitions = lightweightFormSymbols
      ? new Map<string, vscode.Location>()
      : this.collectAttributeDefinitions(document, /<Button\b([^>]*)>/gi, "Ident", maskedText);
    const sectionDefinitions = lightweightFormSymbols
      ? new Map<string, vscode.Location>()
      : this.collectAttributeDefinitions(document, /<Section\b([^>]*)>/gi, "Ident", maskedText);

    const controls = new Set([...facts.declaredControls]);
    const buttons = new Set([...facts.declaredButtons]);
    const sections = new Set([...facts.declaredSections]);
    const isComposedOutput = options?.composedOutput === true;

    if (!isComposedOutput) {
      for (const usingRef of facts.usingReferences) {
        const component = resolveComponentByKey(this.index, usingRef.componentKey);
        if (!component) {
          continue;
        }
        if (lightweightFormSymbols) {
          mergeDefinitionKeys(controls, component.formControlDefinitions);
          mergeDefinitionKeys(buttons, component.formButtonDefinitions);
          mergeDefinitionKeys(sections, component.formSectionDefinitions);
        } else {
          mergeDefinitions(controls, controlDefinitions, component.formControlDefinitions);
          mergeDefinitions(buttons, buttonDefinitions, component.formButtonDefinitions);
          mergeDefinitions(sections, sectionDefinitions, component.formSectionDefinitions);
        }
      }

      for (const includeRef of facts.includeReferences) {
        const component = resolveComponentByKey(this.index, includeRef.componentKey);
        if (!component) {
          continue;
        }
        if (lightweightFormSymbols) {
          mergeDefinitionKeys(controls, component.formControlDefinitions);
          mergeDefinitionKeys(buttons, component.formButtonDefinitions);
          mergeDefinitionKeys(sections, component.formSectionDefinitions);
        } else {
          mergeDefinitions(controls, controlDefinitions, component.formControlDefinitions);
          mergeDefinitions(buttons, buttonDefinitions, component.formButtonDefinitions);
          mergeDefinitions(sections, sectionDefinitions, component.formSectionDefinitions);
        }
      }
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

    if (!isComposedOutput && options?.skipUsingTrace !== true) {
      populateUsingInsertTraceFromText(facts, maskedText, this.index);
    }
    this.index.formsByIdent.set(facts.formIdent, form);
    this.index.formIdentByUri.set(uriKey, facts.formIdent);
    this.index.parsedFactsByUri.set(document.uri.toString(), facts);
    this.index.hasIgnoreDirectiveByUri.set(
      document.uri.toString(),
      options?.skipIgnoreDirectiveScan === true ? false : containsIgnoreDirective(document.getText())
    );
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
    if (root !== "component" && root !== "feature") {
      return { updated: false, reason: "not-component" };
    }

    const key = this.getComponentKey(document.uri);
    const uriKey = toIndexUriKey(document.uri);
    const existingFormIdentByUri = this.index.formIdentByUri.get(uriKey);
    if (existingFormIdentByUri) {
      this.index.formsByIdent.delete(existingFormIdentByUri);
      this.index.formIdentByUri.delete(uriKey);
    }
    const oldKey = this.index.componentKeyByUri.get(uriKey);
    if (oldKey && oldKey !== key) {
      this.index.componentsByKey.delete(oldKey);
      this.index.componentKeyByUri.delete(uriKey);
      removeBaseNameVariant(this.index.componentKeysByBaseName, this.getBaseNameFromKey(oldKey), oldKey);
    }

    const contributionDefinitions = this.collectAttributeDefinitions(document, /<(?:Contribution|Section)\b([^>]*)>/gi, "Name", maskedText);
    const formInjected = this.collectFormInjectedDefinitions(document, maskedText);
    const workflowInjected = this.collectWorkflowInjectedDefinitions(document, maskedText);
    const contributionSummaries = this.collectComponentContributionSummaries(maskedText);

    const component: IndexedComponent = {
      key,
      uri: document.uri,
      contributions: this.readComponentContributions(maskedText),
      componentLocation: new vscode.Location(document.uri, new vscode.Position(0, 0)),
      contributionDefinitions,
      contributionSummaries,
      formControlDefinitions: formInjected.controls,
      formButtonDefinitions: formInjected.buttons,
      formSectionDefinitions: formInjected.sections,
      workflowActionShareCodeDefinitions: workflowInjected.actionShareCodes,
      workflowControlShareCodeDefinitions: workflowInjected.controlShareCodes,
      workflowButtonShareCodeDefinitions: workflowInjected.buttonShareCodes,
      workflowButtonShareCodeButtonIdents: workflowInjected.buttonShareCodeButtonIdents
    };

    populateUsingInsertTraceFromText(facts, maskedText, this.index);
    this.index.componentsByKey.set(key, component);
    this.index.componentKeyByUri.set(uriKey, key);
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
          return this.readParsedEntry(uri, scope, hasIgnoreDirectiveByUri);
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
    const formIdentByUri = new Map<string, string>();
    const componentsByKey = new Map<string, IndexedComponent>();
    const componentKeyByUri = new Map<string, string>();
    const componentKeysByBaseName = new Map<string, Set<string>>();
    const componentEntries = parsedEntries.filter((entry) => entry.root === "component" || entry.root === "feature");
    const componentsStart = Date.now();
    onProgress?.({
      phase: "components-start",
      total: componentEntries.length,
      message: `Building component index (${componentEntries.length}).`
    });
    for (let i = 0; i < componentEntries.length; i++) {
      const entry = componentEntries[i];
      if (entry.root !== "component" && entry.root !== "feature") {
        continue;
      }

      const resolver = createRawResolver(entry.uri, entry.maskedText);
      const key = this.getComponentKey(entry.uri);
      const contributionDefinitions = this.collectAttributeDefinitions(resolver, /<(?:Contribution|Section)\b([^>]*)>/gi, "Name", entry.maskedText);
      const formInjected = this.collectFormInjectedDefinitions(resolver, entry.maskedText);
      const workflowInjected = this.collectWorkflowInjectedDefinitions(resolver, entry.maskedText);
      const contributionSummaries = this.collectComponentContributionSummaries(entry.maskedText);

      const component: IndexedComponent = {
        key,
        uri: entry.uri,
        contributions: this.readComponentContributions(entry.maskedText),
        componentLocation: new vscode.Location(entry.uri, new vscode.Position(0, 0)),
        contributionDefinitions,
        contributionSummaries,
        formControlDefinitions: formInjected.controls,
        formButtonDefinitions: formInjected.buttons,
        formSectionDefinitions: formInjected.sections
        ,
        workflowActionShareCodeDefinitions: workflowInjected.actionShareCodes,
        workflowControlShareCodeDefinitions: workflowInjected.controlShareCodes,
        workflowButtonShareCodeDefinitions: workflowInjected.buttonShareCodes,
        workflowButtonShareCodeButtonIdents: workflowInjected.buttonShareCodeButtonIdents
      };

      componentsByKey.set(key, component);
      componentKeyByUri.set(toIndexUriKey(entry.uri), key);
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
      formIdentByUri: new Map<string, string>(),
      componentsByKey,
      componentKeyByUri,
      componentKeysByBaseName,
      parsedFactsByUri: new Map(parsedFactsByUri),
      hasIgnoreDirectiveByUri: new Map(hasIgnoreDirectiveByUri),
      builtSymbolProvidersByUri: new Map(),
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

      for (const usingRef of collectEffectiveUsingRefs(entry.facts, provisionalIndex)) {
        const component = resolveComponentByKey(provisionalIndex, usingRef.componentKey);
        if (!component) {
          continue;
        }

        mergeDefinitions(controls, controlDefinitions, component.formControlDefinitions);
        mergeDefinitions(buttons, buttonDefinitions, component.formButtonDefinitions);
        mergeDefinitions(sections, sectionDefinitions, component.formSectionDefinitions);
      }

      for (const includeRef of entry.facts.includeReferences) {
        const component = resolveComponentByKey(provisionalIndex, includeRef.componentKey);
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
      formIdentByUri.set(toIndexUriKey(entry.uri), entry.facts.formIdent);
      provisionalIndex.formIdentByUri.set(toIndexUriKey(entry.uri), entry.facts.formIdent);
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

    const formIdentsWithUsings = new Set<string>();
    for (const entry of parsedEntries) {
      if (entry.root === "form" && entry.facts.formIdent && entry.facts.usingReferences.length > 0) {
        formIdentsWithUsings.add(entry.facts.formIdent);
      }
    }

    // Compute using insert traces once after forms are available.
    // This keeps inherited workflow/dataview usings correct while avoiding an extra full pass.
    const traceEligibleEntries = parsedEntries.filter((entry) => {
      if (entry.facts.usingReferences.length > 0) {
        return true;
      }

      if (entry.root === "workflow") {
        return !!entry.facts.workflowFormIdent && formIdentsWithUsings.has(entry.facts.workflowFormIdent);
      }

      if (entry.root === "dataview") {
        return !!entry.facts.rootFormIdent && formIdentsWithUsings.has(entry.facts.rootFormIdent);
      }

      return false;
    });
    const traceContextSignature = this.computeUsingTraceContextSignature(parsedEntries, traceEligibleEntries);

    const usingTraceStart = Date.now();
    let usingTraceCacheHits = 0;
    let usingTraceComputed = 0;
    for (let i = 0; i < traceEligibleEntries.length; i++) {
      const entry = traceEligibleEntries[i];
      const uriKey = entry.uri.toString();
      const cachedTrace = this.usingTraceCacheByUri.get(uriKey);
      if (cachedTrace && cachedTrace.parseSignature === entry.parseSignature && cachedTrace.contextSignature === traceContextSignature) {
        entry.facts.usingContributionInsertTraces = cloneUsingTraceMap(cachedTrace.traces);
        usingTraceCacheHits++;
      } else {
        populateUsingInsertTraceFromText(entry.facts, entry.maskedText, provisionalIndex);
        this.usingTraceCacheByUri.set(uriKey, {
          parseSignature: entry.parseSignature,
          contextSignature: traceContextSignature,
          traces: cloneUsingTraceMap(entry.facts.usingContributionInsertTraces ?? new Map())
        });
        usingTraceComputed++;
      }
      if ((i + 1) % 80 === 0) {
        await yieldToEventLoop();
      }
    }
    const usingTraceMs = Date.now() - usingTraceStart;

    const referencesMs = 0;
    onProgress?.({
      phase: "references-done",
      total: parsedEntries.length,
      message: "Legacy reference buckets removed; references resolved from facts/symbols on demand."
    });

    this.index = {
      formsByIdent,
      formIdentByUri,
      componentsByKey,
      componentKeyByUri,
      componentKeysByBaseName,
      parsedFactsByUri,
      hasIgnoreDirectiveByUri,
      builtSymbolProvidersByUri: new Map(),
      formsReady: true,
      componentsReady: true,
      fullReady: scope === "all"
    };
    const totalMs = Date.now() - allStart;
    onProgress?.({
      phase: "done",
      message:
        `Index ready in ${totalMs} ms: forms=${formsByIdent.size}, components=${componentsByKey.size}, ` +
        `discover=${discoverMs} ms, parse=${parseMs} ms, components=${componentsMs} ms, forms=${formsMs} ms, refs=${referencesMs} ms, ` +
        `trace=${usingTraceMs} ms (${traceEligibleEntries.length}/${parsedEntries.length}, cache=${usingTraceCacheHits}/${traceEligibleEntries.length}, computed=${usingTraceComputed}).`
    });

    return this.index;
  }

  private removeIndexedEntitiesForUri(uri: vscode.Uri): void {
    const uriKey = toIndexUriKey(uri);
    const formIdent = this.index.formIdentByUri.get(uriKey);
    if (formIdent) {
      this.index.formsByIdent.delete(formIdent);
      this.index.formIdentByUri.delete(uriKey);
    }

    const componentKey = this.index.componentKeyByUri.get(uriKey);
    if (componentKey) {
      this.index.componentsByKey.delete(componentKey);
      this.index.componentKeyByUri.delete(uriKey);
      removeBaseNameVariant(
        this.index.componentKeysByBaseName,
        this.getBaseNameFromKey(componentKey),
        componentKey
      );
    }
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

    const sectionRegex = /<(Contribution|Section)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    for (const match of text.matchAll(sectionRegex)) {
      const attrs = match[2] ?? "";
      const content = match[3] ?? "";
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
    actionShareCodes: Map<string, vscode.Location>;
    controlShareCodes: Map<string, vscode.Location>;
    buttonShareCodes: Map<string, vscode.Location>;
    buttonShareCodeButtonIdents: Map<string, Set<string>>;
  } {
    const text = resolveMaskedText(document, preMaskedText);
    const actionShareCodes = new Map<string, vscode.Location>();
    const controlShareCodes = new Map<string, vscode.Location>();
    const buttonShareCodes = new Map<string, vscode.Location>();
    const buttonShareCodeButtonIdents = new Map<string, Set<string>>();

    const sectionRegex = /<(Contribution|Section)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    for (const match of text.matchAll(sectionRegex)) {
      const attrs = match[2] ?? "";
      const content = match[3] ?? "";
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
        actionShareCodes,
        this.collectAttributeDefinitionsFromText(document, content, contentStart, /<ActionShareCode\b([^>]*)>/gi, "Ident", true)
      );
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

    return { actionShareCodes, controlShareCodes, buttonShareCodes, buttonShareCodeButtonIdents };
  }

  private collectComponentContributionSummaries(preMaskedText?: string): Map<string, IndexedComponentContributionSummary> {
    const text = preMaskedText ?? "";
    const out = new Map<string, IndexedComponentContributionSummary>();
    const contractExpectedXPathByContribution = collectContributionContractExpectedXPathByContributionName(text);
    const sectionRegex = /<(Contribution|Section)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    for (const match of text.matchAll(sectionRegex)) {
      const attrsText = match[2] ?? "";
      const body = match[3] ?? "";
      const name = extractAttributeValue(attrsText, "Name");
      if (!name) {
        continue;
      }
      const primitiveUsage = collectPrimitiveUsageSummary(body);
      const directFormButtonIdents = collectAttributeIdents(body, /<Button\b([^>]*)>/gi, "Ident");
      const primitiveFormButtonIdents = collectPrimitiveFormButtonIdents(body);
      const formButtonIdents = new Set<string>(directFormButtonIdents);
      for (const ident of primitiveFormButtonIdents) {
        formButtonIdents.add(ident);
      }

      const rootRaw = (extractAttributeValue(attrsText, "Root") ?? "").trim().toLowerCase();
      const root: IndexedComponentContributionSummary["root"] =
        rootRaw.length === 0 || rootRaw === "form" ? "form" : rootRaw === "workflow" ? "workflow" : "other";

      out.set(name, {
        contributionName: name,
        root,
        rootExpression: rootRaw.length > 0 ? rootRaw : undefined,
        insert: extractAttributeValue(attrsText, "Insert"),
        isInsertOptional: parseBooleanAttribute(extractAttributeValue(attrsText, "IsInsertOptional")),
        targetXPath: extractAttributeValue(attrsText, "TargetXPath"),
        expectsXPath: new Set([
          ...(contractExpectedXPathByContribution.get(name.toLowerCase()) ?? []),
          ...collectExpectedXPathValuesFromText(body)
        ]),
        allowMultipleInserts: parseBooleanAttribute(extractAttributeValue(attrsText, "AllowMultipleInserts")),
        hasContent: /\S/.test(body),
        formControlCount: countTagOccurrences(body, /<Control\b[^>]*>/gi),
        formButtonCount: countTagOccurrences(body, /<Button\b[^>]*>/gi),
        formSectionCount: countTagOccurrences(body, /<Section\b[^>]*>/gi),
        workflowActionShareCodeCount: countTagOccurrences(body, /<ActionShareCode\b[^>]*>/gi),
        workflowControlShareCodeCount: countTagOccurrences(body, /<ControlShareCode\b[^>]*>/gi),
        workflowButtonShareCodeCount: countTagOccurrences(body, /<ButtonShareCode\b[^>]*>/gi),
        formControlIdents: collectAttributeIdents(body, /<Control\b([^>]*)>/gi, "Ident"),
        formButtonIdents,
        formSectionIdents: collectAttributeIdents(body, /<Section\b([^>]*)>/gi, "Ident"),
        workflowReferencedActionShareCodeIdents: collectActionShareCodeReferenceIdents(body),
        workflowActionShareCodeIdents: collectAttributeIdents(body, /<ActionShareCode\b([^>]*)>/gi, "Ident"),
        workflowControlShareCodeIdents: collectAttributeIdents(body, /<ControlShareCode\b([^>]*)>/gi, "Ident"),
        workflowButtonShareCodeIdents: collectAttributeIdents(body, /<ButtonShareCode\b([^>]*)>/gi, "Ident"),
        requiredParamNames: collectRequiredContributionParamNames(body),
        primitiveUsageCountByKey: primitiveUsage.usageCountByKey,
        primitiveTemplateNamesByKey: primitiveUsage.templateNamesByKey,
        primitiveProvidedParamNamesByKey: primitiveUsage.providedParamNamesByKey,
        primitiveProvidedSlotNamesByKey: primitiveUsage.providedSlotNamesByKey
      });
    }

    return out;
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

  private readComponentContributions(preMaskedText?: string): Set<string> {
    const text = preMaskedText ?? "";
    const contributions = new Set<string>();
    for (const m of text.matchAll(/<(?:Contribution|Section)\b[^>]*\bName\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const name = (m[2] ?? m[3] ?? "").trim();
      if (name) {
        contributions.add(name);
      }
    }

    return contributions;
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

  private computeUsingTraceContextSignature(
    parsedEntries: readonly ParsedEntry[],
    traceEligibleEntries: readonly ParsedEntry[]
  ): string {
    const componentSignatures = parsedEntries
      .filter((entry) => entry.root === "component" || entry.root === "feature")
      .map((entry) => `${entry.uri.toString()}@${entry.parseSignature}`)
      .sort((a, b) => a.localeCompare(b));

    const formSignatures = parsedEntries
      .filter((entry) => entry.root === "form")
      .map((entry) => `${entry.uri.toString()}@${entry.parseSignature}`)
      .sort((a, b) => a.localeCompare(b));

    const traceEligibleSignatures = traceEligibleEntries
      .map((entry) => `${entry.uri.toString()}@${entry.parseSignature}`)
      .sort((a, b) => a.localeCompare(b));

    return [
      `components:${componentSignatures.join(";")}`,
      `forms:${formSignatures.join(";")}`,
      `eligible:${traceEligibleSignatures.join(";")}`
    ].join("|");
  }

  private async readParsedEntry(
    uri: vscode.Uri,
    scope: "all" | "bootstrap",
    hasIgnoreDirectiveByUri: Map<string, boolean>
  ): Promise<ParsedEntry | undefined> {
    if (scope === "bootstrap" && !isLikelyBootstrapPath(uri)) {
      return undefined;
    }

    const uriKey = uri.toString();
    const signature = await getFileSignature(uri);
    if (signature) {
      const cached = this.parsedEntryCacheByUri.get(uriKey);
      if (cached && cached.mtimeMs === signature.mtimeMs && cached.size === signature.size) {
        hasIgnoreDirectiveByUri.set(uriKey, cached.hasIgnoreDirective);
        if (scope === "bootstrap" && cached.root !== "component" && cached.root !== "feature" && cached.root !== "form") {
          return undefined;
        }
        return {
          uri,
          maskedText: cached.maskedText,
          facts: cached.facts,
          root: cached.root,
          parseSignature: cached.parseSignature
        };
      }
    }

    const text = await readWorkspaceFileText(uri);
    const maskedText = maskXmlComments(text);
    const facts = parseDocumentFactsFromMaskedText(maskedText);
    const root = (facts.rootTag ?? "").toLowerCase();
    const hasIgnoreDirective = containsIgnoreDirective(text);
    const parseSignature = signature
      ? `${Math.trunc(signature.mtimeMs)}:${signature.size}`
      : `h:${fastHashText(maskedText)}`;
    hasIgnoreDirectiveByUri.set(uriKey, hasIgnoreDirective);
    if (signature) {
      this.parsedEntryCacheByUri.set(uriKey, {
        mtimeMs: signature.mtimeMs,
        size: signature.size,
        maskedText,
        facts,
        root,
        hasIgnoreDirective,
        parseSignature
      });
    } else {
      this.parsedEntryCacheByUri.delete(uriKey);
    }

    if (scope === "bootstrap" && root !== "component" && root !== "feature" && root !== "form") {
      return undefined;
    }

    return {
      uri,
      maskedText,
      facts,
      root,
      parseSignature
    };
  }
}

function collectContributionContractExpectedXPathByContributionName(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const manifestMatch = /<\s*Manifest\b[^>]*>([\s\S]*?)<\/\s*Manifest\s*>/i.exec(text);
  if (!manifestMatch) {
    return out;
  }

  const manifestBody = manifestMatch[1] ?? "";
  const contractRegex = /<\s*ContributionContract\b([^>]*)>([\s\S]*?)<\/\s*ContributionContract\s*>/gi;
  for (const contractMatch of manifestBody.matchAll(contractRegex)) {
    const attrs = contractMatch[1] ?? "";
    const body = contractMatch[2] ?? "";
    const forName =
      extractAttributeValue(attrs, "For") ??
      extractAttributeValue(attrs, "Name") ??
      extractAttributeValue(attrs, "Id");
    if (!forName) {
      continue;
    }
    const expectsXPath = collectExpectedXPathValuesFromText(body);
    if (expectsXPath.length === 0) {
      continue;
    }
    const key = forName.trim().toLowerCase();
    const existing = out.get(key) ?? [];
    out.set(key, uniqueStrings([...existing, ...expectsXPath]));
  }

  return out;
}

function collectExpectedXPathValuesFromText(text: string): string[] {
  const out: string[] = [];
  const blockRegex = /<\s*ExpectsXPath(s)?\b[^>]*>([\s\S]*?)<\/\s*ExpectsXPath(s)?\s*>/gi;
  for (const block of text.matchAll(blockRegex)) {
    const body = block[2] ?? "";
    const xpathRegex = /<\s*XPath\b[^>]*>([\s\S]*?)<\/\s*XPath\s*>/gi;
    for (const xpathMatch of body.matchAll(xpathRegex)) {
      const value = (xpathMatch[1] ?? "").trim();
      if (value.length > 0) {
        out.push(value);
      }
    }
  }
  return uniqueStrings(out);
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
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

function mergeDefinitionKeys(idsSet: Set<string>, sourceDefinitions: Map<string, vscode.Location>): void {
  for (const key of sourceDefinitions.keys()) {
    idsSet.add(key);
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

function collectAttributeIdents(text: string, tagRegex: RegExp, attributeName: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(tagRegex)) {
    const value = extractAttributeValue(match[1] ?? "", attributeName);
    if (value) {
      out.add(value);
    }
  }

  return out;
}

function collectActionShareCodeReferenceIdents(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<Action\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const actionType = (extractAttributeValue(attrs, "xsi:type") ?? extractAttributeValue(attrs, "type") ?? "").trim().toLowerCase();
    if (actionType !== "sharecode") {
      continue;
    }

    const ident = extractAttributeValue(attrs, "Ident");
    if (ident) {
      out.add(ident);
    }
  }

  return out;
}

function collectRequiredContributionParamNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const tokenMatch of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const token = (tokenMatch[1] ?? "").trim();
    if (!token) {
      continue;
    }

    if (token.includes(":") || token.includes(",")) {
      continue;
    }

    if (!/^[A-Za-z_][\w.-]*$/.test(token)) {
      continue;
    }

    out.add(token);
  }

  return out;
}

function collectPrimitiveFormButtonIdents(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<UsePrimitive\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const primitiveKey =
      extractAttributeValue(attrs, "Primitive") ??
      extractAttributeValue(attrs, "Name") ??
      extractAttributeValue(attrs, "Feature") ??
      extractAttributeValue(attrs, "Component");
    if (!primitiveKey) {
      continue;
    }

    const normalized = normalizeComponentKey(primitiveKey).toLowerCase();
    if (!/\/buttons\/[^/]*button$/i.test(normalized)) {
      continue;
    }

    const ident = extractAttributeValue(attrs, "Ident");
    if (!ident) {
      continue;
    }

    out.add(ident);
  }
  return out;
}

function collectPrimitiveUsageSummary(text: string): {
  usageCountByKey: Map<string, number>;
  templateNamesByKey: Map<string, Set<string>>;
  providedParamNamesByKey: Map<string, Set<string>>;
  providedSlotNamesByKey: Map<string, Set<string>>;
} {
  const usageCountByKey = new Map<string, number>();
  const templateNamesByKey = new Map<string, Set<string>>();
  const providedParamNamesByKey = new Map<string, Set<string>>();
  const providedSlotNamesByKey = new Map<string, Set<string>>();
  for (const match of text.matchAll(/<UsePrimitive\b([^>]*)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const primitiveKey =
      extractAttributeValue(attrs, "Primitive") ??
      extractAttributeValue(attrs, "Name") ??
      extractAttributeValue(attrs, "Feature") ??
      extractAttributeValue(attrs, "Component");
    if (!primitiveKey) {
      continue;
    }

    const normalized = normalizeComponentKey(primitiveKey);
    usageCountByKey.set(normalized, (usageCountByKey.get(normalized) ?? 0) + 1);

    const providedParams = providedParamNamesByKey.get(normalized) ?? new Set<string>();
    for (const attrName of collectAttributeNames(attrs)) {
      if (["primitive", "name", "feature", "component", "template", "contribution", "section"].includes(attrName.toLowerCase())) {
        continue;
      }
      providedParams.add(attrName);
    }
    if (providedParams.size > 0) {
      providedParamNamesByKey.set(normalized, providedParams);
    }

    const templateName =
      extractAttributeValue(attrs, "Template") ??
      extractAttributeValue(attrs, "Contribution") ??
      extractAttributeValue(attrs, "Section");
    if (!templateName) {
      continue;
    }

    const existingNames = templateNamesByKey.get(normalized) ?? new Set<string>();
    existingNames.add(templateName);
    templateNamesByKey.set(normalized, existingNames);
  }

  for (const block of text.matchAll(/<UsePrimitive\b([^>]*)>([\s\S]*?)<\/UsePrimitive>/gi)) {
    const attrs = block[1] ?? "";
    const body = block[2] ?? "";
    const primitiveKey =
      extractAttributeValue(attrs, "Primitive") ??
      extractAttributeValue(attrs, "Name") ??
      extractAttributeValue(attrs, "Feature") ??
      extractAttributeValue(attrs, "Component");
    if (!primitiveKey) {
      continue;
    }

    const normalized = normalizeComponentKey(primitiveKey);
    const providedSlots = providedSlotNamesByKey.get(normalized) ?? new Set<string>();
    for (const slotMatch of body.matchAll(/<Slot\b([^>]*)>([\s\S]*?)<\/Slot>/gi)) {
      const slotName = extractAttributeValue(slotMatch[1] ?? "", "Name");
      if (slotName) {
        providedSlots.add(slotName);
      }
    }
    if (providedSlots.size > 0) {
      providedSlotNamesByKey.set(normalized, providedSlots);
    }
  }

  return { usageCountByKey, templateNamesByKey, providedParamNamesByKey, providedSlotNamesByKey };
}

function collectAttributeNames(attrs: string): string[] {
  const out: string[] = [];
  for (const match of attrs.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const name = (match[1] ?? "").trim();
    if (!name) {
      continue;
    }
    out.push(name);
  }
  return out;
}

function countTagOccurrences(text: string, regex: RegExp): number {
  let count = 0;
  for (const _ of text.matchAll(regex)) {
    count++;
  }
  return count;
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return undefined;
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

function extractRootTagFast(maskedText: string): string {
  const rootMatch = /<\s*([A-Za-z_][\w:.-]*)\b/.exec(maskedText);
  const rootRaw = (rootMatch?.[1] ?? "").trim();
  if (!rootRaw) {
    return "";
  }
  const withoutPrefix = rootRaw.includes(":") ? rootRaw.slice(rootRaw.lastIndexOf(":") + 1) : rootRaw;
  return withoutPrefix.toLowerCase();
}

function createLightweightParsedFormFacts(maskedText: string): ParsedDocumentFacts {
  const formIdentMatch = /<Form\b[^>]*\bIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(maskedText);
  const formIdent = (formIdentMatch?.[2] ?? formIdentMatch?.[3] ?? "").trim();
  const facts: ParsedDocumentFacts = {
    rootTag: "Form",
    rootIdent: formIdent || undefined,
    formIdent: formIdent || undefined,
    declaredControls: collectAttributeIdents(maskedText, /<Control\b([^>]*)>/gi, "Ident"),
    declaredButtons: collectAttributeIdents(maskedText, /<Button\b([^>]*)>/gi, "Ident"),
    declaredSections: collectAttributeIdents(maskedText, /<Section\b([^>]*)>/gi, "Ident"),
    workflowReferences: [],
    usingReferences: [],
    includeReferences: [],
    usingContributionInsertCounts: new Map<string, number>(),
    usingContributionInsertTraces: new Map<string, import("./xmlFacts").UsingContributionInsertTrace>(),
    placeholderReferences: [],
    formIdentReferences: [],
    mappingIdentReferences: [],
    mappingFormIdentReferences: [],
    requiredActionIdentReferences: [],
    workflowControlIdentReferences: [],
    htmlControlReferences: [],
    identOccurrences: [],
    declaredControlShareCodes: new Set<string>(),
    controlShareCodeDefinitions: new Map<string, vscode.Range>(),
    declaredActionShareCodes: new Set<string>(),
    actionShareCodeDefinitions: new Map<string, vscode.Range>(),
    declaredButtonShareCodes: new Set<string>(),
    buttonShareCodeDefinitions: new Map<string, vscode.Range>(),
    buttonShareCodeButtonIdents: new Map<string, Set<string>>(),
    actionShareCodeReferences: [],
    declaredControlInfos: [],
    declaredButtonInfos: [],
    rootControlScopeKeys: new Set<string>(),
    rootButtonScopeKeys: new Set<string>(),
    rootSectionScopeKeys: new Set<string>()
  };
  return facts;
}

function cloneUsingTraceMap(
  source: ReadonlyMap<string, import("./xmlFacts").UsingContributionInsertTrace>
): Map<string, import("./xmlFacts").UsingContributionInsertTrace> {
  const out = new Map<string, import("./xmlFacts").UsingContributionInsertTrace>();
  for (const [key, value] of source.entries()) {
    out.set(key, {
      strategy: value.strategy,
      finalInsertCount: value.finalInsertCount,
      placeholderCount: value.placeholderCount,
      targetXPathExpression: value.targetXPathExpression,
      targetXPathMatchCount: value.targetXPathMatchCount,
      targetXPathClampedCount: value.targetXPathClampedCount,
      allowMultipleInserts: value.allowMultipleInserts,
      fallbackSymbolCount: value.fallbackSymbolCount
    });
  }
  return out;
}

function fastHashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function readWorkspaceFileText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function getFileSignature(uri: vscode.Uri): Promise<{ mtimeMs: number; size: number } | undefined> {
  if (uri.scheme !== "file") {
    return undefined;
  }

  try {
    const stat = await nodeFs.stat(uri.fsPath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
  } catch {
    return undefined;
  }
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
