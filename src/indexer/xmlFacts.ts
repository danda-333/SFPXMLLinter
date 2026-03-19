import * as vscode from "vscode";
import { normalizeComponentKey } from "../utils/paths";
import { maskXmlComments } from "../utils/xmlComments";

export interface XmlAttributeMatch {
  name: string;
  value: string;
  valueRange: vscode.Range;
}

export interface WorkflowReference {
  kind: "formControl" | "controlShareCode" | "button" | "buttonShareCode" | "section";
  ident: string;
  range: vscode.Range;
  scopeKey?: string;
}

export interface UsingReference {
  componentKey: string;
  rawComponentValue: string;
  componentValueRange: vscode.Range;
  sectionValue?: string;
  sectionValueRange?: vscode.Range;
  attributes?: ReadonlyArray<{ name: string; value: string }>;
  providedParamNames?: string[];
  suppressInheritance?: boolean;
}

export interface IncludeReference {
  componentKey: string;
  rawComponentValue: string;
  componentValueRange: vscode.Range;
  sectionValue?: string;
  sectionValueRange?: vscode.Range;
}

export interface PlaceholderReference {
  rawToken: string;
  range: vscode.Range;
  componentKey?: string;
  rawComponentValue?: string;
  contributionValue?: string;
}

export interface FormIdentReference {
  formIdent: string;
  range: vscode.Range;
  tagName: string;
}

export interface MappingIdentReference {
  kind: "fromIdent" | "toIdent";
  ident: string;
  range: vscode.Range;
  mappingFormIdent?: string;
}

export interface MappingFormIdentReference {
  formIdent: string;
  range: vscode.Range;
}

export interface RequiredActionIdentReference {
  ident: string;
  range: vscode.Range;
}

export interface WorkflowControlIdentReference {
  kind: "actionValue" | "showHideJavaScript";
  ident: string;
  range: vscode.Range;
}

export interface HtmlControlReference {
  tagName: "Control" | "ControlLabel" | "ControlPlaceHolder";
  attributeName: "ID" | "ControlID";
  ident: string;
  range: vscode.Range;
}

export interface NamedIdent {
  ident: string;
  range: vscode.Range;
  type?: string;
}

export interface IdentOccurrence {
  ident: string;
  range: vscode.Range;
  kind: "control" | "button" | "section";
  scopeKey?: string;
}

export interface ParsedDocumentFacts {
  rootTag?: string;
  rootIdent?: string;
  rootIdentRange?: vscode.Range;
  rootFormIdent?: string;
  rootFormIdentRange?: vscode.Range;
  formIdent?: string;
  workflowFormIdent?: string;
  workflowFormIdentRange?: vscode.Range;
  declaredControls: Set<string>;
  declaredButtons: Set<string>;
  declaredSections: Set<string>;
  workflowReferences: WorkflowReference[];
  usingReferences: UsingReference[];
  includeReferences: IncludeReference[];
  usingContributionInsertCounts: Map<string, number>;
  usingContributionInsertTraces: Map<string, UsingContributionInsertTrace>;
  placeholderReferences: PlaceholderReference[];
  formIdentReferences: FormIdentReference[];
  mappingIdentReferences: MappingIdentReference[];
  mappingFormIdentReferences: MappingFormIdentReference[];
  requiredActionIdentReferences: RequiredActionIdentReference[];
  workflowControlIdentReferences: WorkflowControlIdentReference[];
  htmlControlReferences: HtmlControlReference[];
  identOccurrences: IdentOccurrence[];
  declaredControlShareCodes: Set<string>;
  controlShareCodeDefinitions: Map<string, vscode.Range>;
  declaredActionShareCodes: Set<string>;
  actionShareCodeDefinitions: Map<string, vscode.Range>;
  declaredButtonShareCodes: Set<string>;
  buttonShareCodeDefinitions: Map<string, vscode.Range>;
  buttonShareCodeButtonIdents: Map<string, Set<string>>;
  actionShareCodeReferences: NamedIdent[];
  declaredControlInfos: NamedIdent[];
  declaredButtonInfos: NamedIdent[];
  rootControlScopeKeys?: Set<string>;
  rootButtonScopeKeys?: Set<string>;
  rootSectionScopeKeys?: Set<string>;
}

export interface UsingContributionInsertTrace {
  strategy: "placeholder" | "targetXPath" | "symbolCount";
  finalInsertCount: number;
  placeholderCount: number;
  targetXPathExpression?: string;
  targetXPathMatchCount: number;
  targetXPathClampedCount: number;
  allowMultipleInserts: boolean;
  fallbackSymbolCount: number;
}

const ATTR_REGEX = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

let lastIndexedText: string | undefined;
let lastLineStarts: number[] | undefined;

export function parseDocumentFacts(document: vscode.TextDocument): ParsedDocumentFacts {
  return parseDocumentFactsFromText(document.getText());
}

export function parseDocumentFactsFromText(rawText: string): ParsedDocumentFacts {
  return parseDocumentFactsCore(maskXmlComments(rawText));
}

export function parseDocumentFactsFromMaskedText(maskedText: string): ParsedDocumentFacts {
  return parseDocumentFactsCore(maskedText);
}

function parseDocumentFactsCore(text: string): ParsedDocumentFacts {

  const facts: ParsedDocumentFacts = {
    declaredControls: new Set<string>(),
    declaredButtons: new Set<string>(),
    declaredSections: new Set<string>(),
    workflowReferences: [],
    usingReferences: [],
    includeReferences: [],
    usingContributionInsertCounts: new Map<string, number>(),
    usingContributionInsertTraces: new Map<string, UsingContributionInsertTrace>(),
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

  const rootMatch = /<\s*([A-Za-z_][\w:.-]*)\b/.exec(text);
  const rootTagLower = (rootMatch ? stripPrefix(rootMatch[1]) : "").toLowerCase();
  if (rootMatch) {
    facts.rootTag = stripPrefix(rootMatch[1]);

    const rawRootName = rootMatch[1] ?? "";
    const rootOpenTagRegex = new RegExp(`<\\s*${escapeRegExp(rawRootName)}\\b([^>]*)>`, "i");
    const rootOpenTagMatch = rootOpenTagRegex.exec(text);
    if (rootOpenTagMatch) {
      const attrs = parseAttributes(rootOpenTagMatch[1] ?? "", text, attributeStartIndex(rootOpenTagMatch));
      const formIdentAttr = attrs.get("FormIdent");
      if (formIdentAttr?.value) {
        facts.rootFormIdent = formIdentAttr.value;
        if (formIdentAttr.valueRange) {
          facts.rootFormIdentRange = formIdentAttr.valueRange;
        }
      }
    }
  }

  if (rootTagLower === "form") {
    const rootScopes = collectRootFormContainerScopeKeys(text);
    facts.rootControlScopeKeys = rootScopes.controls;
    facts.rootButtonScopeKeys = rootScopes.buttons;
    facts.rootSectionScopeKeys = rootScopes.sections;
  }

  const rootIdentMatch = /<\s*([A-Za-z_][\w:.-]*)\b[^>]*\bIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(text);
  if (rootIdentMatch) {
    const value = (rootIdentMatch[3] ?? rootIdentMatch[4] ?? "").trim();
    const valueOffset = rootIdentMatch[0].indexOf(value);
    if (value && valueOffset >= 0) {
      const start = (rootIdentMatch.index ?? 0) + valueOffset;
      facts.rootIdent = value;
      facts.rootIdentRange = new vscode.Range(indexToPosition(text, start), indexToPosition(text, start + value.length));
    }
  }

  const formMatch = /<Form\b[^>]*\bIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(text);
  if (formMatch) {
    facts.formIdent = (formMatch[2] ?? formMatch[3] ?? "").trim();
  }

  const workflowMatch = /<WorkFlow\b[^>]*\bFormIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(text);
  if (workflowMatch) {
    const value = (workflowMatch[2] ?? workflowMatch[3] ?? "").trim();
    facts.workflowFormIdent = value;

    const valueOffset = workflowMatch[0].indexOf(value);
    if (valueOffset >= 0) {
      const start = (workflowMatch.index ?? 0) + valueOffset;
      facts.workflowFormIdentRange = new vscode.Range(indexToPosition(text, start), indexToPosition(text, start + value.length));
    }
  }

  for (const m of text.matchAll(/<([A-Za-z_][\w:.-]*)\b([^>]*)>/g)) {
    const tagName = stripPrefix(m[1]);
    const attrsStart = attributeStartIndex(m, 2);
    const attrs = parseAttributes(m[2] ?? "", text, attrsStart);
    const formIdentAttr = attrs.get("FormIdent");
    if (formIdentAttr?.value && formIdentAttr.valueRange) {
      facts.formIdentReferences.push({
        formIdent: formIdentAttr.value,
        range: formIdentAttr.valueRange,
        tagName
      });
    }
  }

  const canDeclareFormNodes = rootTagLower === "form" || rootTagLower === "component" || rootTagLower === "feature";
  const canHaveWorkflowNodes = rootTagLower === "workflow" || rootTagLower === "component" || rootTagLower === "feature";

  const controlTags = canDeclareFormNodes && text.includes("<Control") ? collectControlTags(text) : [];
  if (canDeclareFormNodes && controlTags.length > 0) {
    for (const controlTag of controlTags) {
      const attrs = parseAttributes(controlTag.rawAttrs, text, controlTag.attrsStartIndex);
      const attr = attrs.get("Ident");
      const type = attrs.get("xsi:type")?.value ?? attrs.get("type")?.value;
      if (attr?.value) {
        facts.declaredControls.add(attr.value);
        if (attr.valueRange) {
          facts.identOccurrences.push({ ident: attr.value, range: attr.valueRange, kind: "control", scopeKey: controlTag.scopeKey });
          facts.declaredControlInfos.push({ ident: attr.value, range: attr.valueRange, type });
        }
      }
    }
  }

  const buttonTags = text.includes("<Button") ? collectButtonTags(text) : [];
  if ((canDeclareFormNodes || canHaveWorkflowNodes) && buttonTags.length > 0) {
    for (const buttonTag of buttonTags) {
      const attrs = parseAttributes(buttonTag.rawAttrs, text, buttonTag.attrsStartIndex);
      const ident = attrs.get("Ident");
      const type = attrs.get("xsi:type")?.value ?? attrs.get("type")?.value;
      if (ident?.value) {
        facts.declaredButtons.add(ident.value);
        if (ident.valueRange) {
          facts.identOccurrences.push({
            ident: ident.value,
            range: ident.valueRange,
            kind: "button",
            scopeKey: buttonTag.scopeKey
          });
          facts.declaredButtonInfos.push({ ident: ident.value, range: ident.valueRange, type });
        }
      }
    }
  }

  if (canDeclareFormNodes && text.includes("<UsePrimitive")) {
    const primitiveTags = collectPrimitiveTags(text);
    for (const primitiveTag of primitiveTags) {
      const attrs = parseAttributes(primitiveTag.rawAttrs, text, primitiveTag.attrsStartIndex);
      const primitiveName =
        attrs.get("Primitive")?.value ??
        attrs.get("Name")?.value ??
        attrs.get("Feature")?.value ??
        attrs.get("Component")?.value;
      if (!primitiveName || !isButtonPrimitiveKey(primitiveName)) {
        continue;
      }

      const ident = attrs.get("Ident");
      if (!ident?.value || !ident.valueRange) {
        continue;
      }

      facts.declaredButtons.add(ident.value);
      facts.identOccurrences.push({
        ident: ident.value,
        range: ident.valueRange,
        kind: "button",
        scopeKey: primitiveTag.scopeKey
      });
      facts.declaredButtonInfos.push({
        ident: ident.value,
        range: ident.valueRange,
        type: "UsePrimitiveButton"
      });
    }
  }

  if ((canDeclareFormNodes || canHaveWorkflowNodes) && text.includes("<Section")) {
    const sectionTags = collectSectionTags(text);
    for (const sectionTag of sectionTags) {
      const attrs = parseAttributes(sectionTag.rawAttrs, text, sectionTag.attrsStartIndex);
      const attr = attrs.get("Ident");
      if (!attr?.value) {
        continue;
      }

      facts.declaredSections.add(attr.value);
      if (attr.valueRange) {
        facts.identOccurrences.push({ ident: attr.value, range: attr.valueRange, kind: "section", scopeKey: sectionTag.scopeKey });
      }
      if (attr.valueRange && canHaveWorkflowNodes) {
        facts.workflowReferences.push({ kind: "section", ident: attr.value, range: attr.valueRange, scopeKey: sectionTag.scopeKey });
      }
    }
  }

  if (canHaveWorkflowNodes && text.includes("<FormControl")) {
    for (const m of text.matchAll(/<FormControl\b([^>]*)>/gi)) {
      const attrs = parseAttributes(m[1], text, attributeStartIndex(m));
      const attr = attrs.get("Ident");
      const type = attrs.get("xsi:type")?.value ?? attrs.get("type")?.value;
      if (attr?.value && attr.valueRange) {
        if ((type ?? "").toLowerCase() === "sharecodecontrol") {
          facts.workflowReferences.push({ kind: "controlShareCode", ident: attr.value, range: attr.valueRange });
        } else {
          facts.workflowReferences.push({ kind: "formControl", ident: attr.value, range: attr.valueRange });
        }
      }
    }
  }

  if (canHaveWorkflowNodes && text.includes("<ControlShareCode")) {
    for (const m of text.matchAll(/<ControlShareCode\b([^>]*)>/gi)) {
      const attr = findAttribute(m[1], "Ident", text, attributeStartIndex(m));
      if (!attr?.value || !attr.valueRange) {
        continue;
      }

      const key = attr.value;
      facts.declaredControlShareCodes.add(key);
      if (!facts.controlShareCodeDefinitions.has(key)) {
        facts.controlShareCodeDefinitions.set(key, attr.valueRange);
      }
    }
  }

  if (canHaveWorkflowNodes && text.includes("<ButtonShareCode")) {
    for (const m of text.matchAll(/<ButtonShareCode\b([^>]*)>/gi)) {
      const attr = findAttribute(m[1], "Ident", text, attributeStartIndex(m));
      if (!attr?.value || !attr.valueRange) {
        continue;
      }

      const key = attr.value;
      facts.declaredButtonShareCodes.add(key);
      if (!facts.buttonShareCodeDefinitions.has(key)) {
        facts.buttonShareCodeDefinitions.set(key, attr.valueRange);
      }
    }
  }

  if (canHaveWorkflowNodes && text.includes("<ActionShareCode")) {
    for (const m of text.matchAll(/<ActionShareCode\b([^>]*)>/gi)) {
      const attr = findAttribute(m[1], "Ident", text, attributeStartIndex(m));
      if (!attr?.value || !attr.valueRange) {
        continue;
      }

      const key = attr.value;
      facts.declaredActionShareCodes.add(key);
      if (!facts.actionShareCodeDefinitions.has(key)) {
        facts.actionShareCodeDefinitions.set(key, attr.valueRange);
      }
    }
  }

  if (canHaveWorkflowNodes && text.includes("<ButtonShareCode")) {
    for (const share of collectButtonShareCodeContents(text)) {
      const key = share.ident;
      const buttonIds = collectButtonIdentsFromText(share.content);
      if (!facts.buttonShareCodeButtonIdents.has(key)) {
        facts.buttonShareCodeButtonIdents.set(key, new Set<string>());
      }

      const target = facts.buttonShareCodeButtonIdents.get(key);
      if (!target) {
        continue;
      }

      for (const buttonId of buttonIds) {
        target.add(buttonId);
      }
    }
  }

  if (canHaveWorkflowNodes && buttonTags.length > 0) {
    for (const buttonTag of buttonTags) {
      const attrs = parseAttributes(buttonTag.rawAttrs, text, buttonTag.attrsStartIndex);
      const type = attrs.get("xsi:type")?.value ?? attrs.get("type")?.value;

      const ident = attrs.get("Ident");
      if (ident?.value && ident.valueRange) {
        if (type?.toLowerCase() === "sharecodebutton") {
          facts.workflowReferences.push({ kind: "buttonShareCode", ident: ident.value, range: ident.valueRange, scopeKey: buttonTag.scopeKey });
        } else {
          facts.workflowReferences.push({ kind: "button", ident: ident.value, range: ident.valueRange, scopeKey: buttonTag.scopeKey });
        }
      }
    }
  }

  if (text.includes("<Using")) {
    for (const m of text.matchAll(/<Using\b([^>]*)>/gi)) {
      const attrs = parseAttributes(m[1], text, attributeStartIndex(m));
      const componentAttr =
        getAttributeCaseInsensitive(attrs, "Feature") ??
        getAttributeCaseInsensitive(attrs, "Component") ??
        getAttributeCaseInsensitive(attrs, "Name");
      if (!componentAttr?.value || !componentAttr.valueRange) {
        continue;
      }

      const sectionAttr = getAttributeCaseInsensitive(attrs, "Contribution") ?? getAttributeCaseInsensitive(attrs, "Section");
      const providedParamNames = collectUsingProvidedParamNames(attrs);
      const suppressInheritance =
        parseBooleanAttribute(attrs.get("SuppressInheritance")?.value) === true ||
        parseBooleanAttribute(attrs.get("Inherit")?.value) === false;
      facts.usingReferences.push({
        componentKey: normalizeComponentKey(componentAttr.value),
        rawComponentValue: componentAttr.value,
        componentValueRange: componentAttr.valueRange,
        sectionValue: sectionAttr?.value,
        sectionValueRange: sectionAttr?.valueRange,
        attributes: [...attrs.values()].map((attr) => ({ name: attr.name, value: attr.value })),
        ...(providedParamNames.length > 0 ? { providedParamNames } : {}),
        ...(suppressInheritance ? { suppressInheritance: true } : {})
      });
    }
  }

  if (text.includes("<Include")) {
    for (const m of text.matchAll(/<Include\b([^>]*)\/?>/gi)) {
      const attrs = parseAttributes(m[1], text, attributeStartIndex(m));
      const componentAttr =
        getAttributeCaseInsensitive(attrs, "Feature") ??
        getAttributeCaseInsensitive(attrs, "Component") ??
        getAttributeCaseInsensitive(attrs, "Name");
      if (!componentAttr?.value || !componentAttr.valueRange) {
        continue;
      }

      const sectionAttr = getAttributeCaseInsensitive(attrs, "Contribution") ?? getAttributeCaseInsensitive(attrs, "Section");
      facts.includeReferences.push({
        componentKey: normalizeComponentKey(componentAttr.value),
        rawComponentValue: componentAttr.value,
        componentValueRange: componentAttr.valueRange,
        sectionValue: sectionAttr?.value,
        sectionValueRange: sectionAttr?.valueRange
      });
    }
  }

  if (text.includes("{{")) {
    for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
      const full = match[0] ?? "";
      const body = (match[1] ?? "").trim();
      const start = typeof match.index === "number" ? match.index : -1;
      if (!full || start < 0 || !body) {
        continue;
      }

      const fields = parsePlaceholderFields(body);
      const rawComponentValue = getPlaceholderField(fields, "Feature", "Component", "Name");
      const contributionValue = getPlaceholderField(fields, "Contribution", "Section");
      facts.placeholderReferences.push({
        rawToken: full,
        range: new vscode.Range(indexToPosition(text, start), indexToPosition(text, start + full.length)),
        rawComponentValue,
        componentKey: rawComponentValue ? normalizeComponentKey(rawComponentValue) : undefined,
        contributionValue
      });
    }
  }

  if (text.includes("<Mapping")) {
    const mappingContexts = collectMappingContexts(text);
    for (const m of text.matchAll(/<Mapping\b([^>]*)>/gi)) {
      const attrs = parseAttributes(m[1], text, attributeStartIndex(m));
      const fromIdent = attrs.get("FromIdent");
      const toIdent = attrs.get("ToIdent");
      const context = findMappingContext(mappingContexts, m.index ?? 0);
      const mappingFormIdent = context?.mappingFormIdent;

      if (fromIdent?.value && fromIdent.valueRange) {
        facts.mappingIdentReferences.push({
          kind: "fromIdent",
          ident: fromIdent.value,
          range: fromIdent.valueRange,
          mappingFormIdent
        });
      }

      if (toIdent?.value && toIdent.valueRange) {
        facts.mappingIdentReferences.push({
          kind: "toIdent",
          ident: toIdent.value,
          range: toIdent.valueRange,
          mappingFormIdent
        });
      }
    }

    for (const context of mappingContexts) {
      if (context.mappingFormIdent && context.mappingFormIdentRange) {
        facts.mappingFormIdentReferences.push({
          formIdent: context.mappingFormIdent,
          range: context.mappingFormIdentRange
        });
      }
    }
  }

  if (canHaveWorkflowNodes && text.includes("<Action")) {
    for (const actionMatch of text.matchAll(/<Action\b([^>]*)>([\s\S]*?)<\/Action>/gi)) {
      const attrs = parseAttributes(actionMatch[1] ?? "", text, attributeStartIndex(actionMatch));
      const actionType = (getAttributeCaseInsensitive(attrs, "xsi:type")?.value ?? getAttributeCaseInsensitive(attrs, "type")?.value ?? "").trim().toLowerCase();
      if (actionType !== "required") {
        continue;
      }

      const body = actionMatch[2] ?? "";
      const whole = actionMatch[0] ?? "";
      const bodyOffsetInWhole = whole.indexOf(body);
      if (bodyOffsetInWhole < 0) {
        continue;
      }

      const bodyStart = (actionMatch.index ?? 0) + bodyOffsetInWhole;
      for (const identMatch of body.matchAll(/<string\b[^>]*>([\s\S]*?)<\/string>/gi)) {
        const rawValue = identMatch[1] ?? "";
        const ident = rawValue.trim();
        if (!ident) {
          continue;
        }

        const fullStringTag = identMatch[0] ?? "";
        const rawValueOffset = fullStringTag.indexOf(rawValue);
        if (rawValueOffset < 0) {
          continue;
        }

        const leadingWhitespace = (/^\s*/.exec(rawValue)?.[0].length ?? 0);
        const start = bodyStart + (identMatch.index ?? 0) + rawValueOffset + leadingWhitespace;
        const range = new vscode.Range(indexToPosition(text, start), indexToPosition(text, start + ident.length));
        facts.requiredActionIdentReferences.push({ ident, range });
      }
    }

    for (const actionTag of text.matchAll(/<Action\b([^>]*)>/gi)) {
      const attrs = parseAttributes(actionTag[1] ?? "", text, attributeStartIndex(actionTag));
      const actionType = (getAttributeCaseInsensitive(attrs, "xsi:type")?.value ?? getAttributeCaseInsensitive(attrs, "type")?.value ?? "").trim().toLowerCase();
      const identAttr = getAttributeCaseInsensitive(attrs, "Ident");
      if (actionType === "sharecode" && identAttr?.value && identAttr.valueRange) {
        facts.actionShareCodeReferences.push({
          ident: identAttr.value,
          range: identAttr.valueRange
        });
      }

      if (actionType !== "actionvalue") {
        continue;
      }

      const controlIdentAttr = getAttributeCaseInsensitive(attrs, "ControlIdent");
      if (!controlIdentAttr?.value || !controlIdentAttr.valueRange) {
        continue;
      }

      facts.workflowControlIdentReferences.push({
        kind: "actionValue",
        ident: controlIdentAttr.value,
        range: controlIdentAttr.valueRange
      });
    }
  }

  if (canHaveWorkflowNodes && text.includes("<JavaScript")) {
    for (const jsTag of text.matchAll(/<JavaScript\b([^>]*)>/gi)) {
      const attrs = parseAttributes(jsTag[1] ?? "", text, attributeStartIndex(jsTag));
      const jsType = (getAttributeCaseInsensitive(attrs, "xsi:type")?.value ?? getAttributeCaseInsensitive(attrs, "type")?.value ?? "").trim().toLowerCase();
      if (jsType !== "showhide") {
        continue;
      }

      const controlIdentAttr = getAttributeCaseInsensitive(attrs, "ControlIdent");
      if (!controlIdentAttr?.value || !controlIdentAttr.valueRange) {
        continue;
      }

      facts.workflowControlIdentReferences.push({
        kind: "showHideJavaScript",
        ident: controlIdentAttr.value,
        range: controlIdentAttr.valueRange
      });
    }
  }

  if (rootTagLower === "form" && text.includes("<Control")) {
    for (const m of text.matchAll(/<(Control|ControlLabel|ControlPlaceHolder)\b([^>]*)>/gi)) {
      const rawTagName = (m[1] ?? "").trim();
      const tagName = normalizeHtmlControlTagName(rawTagName);
      if (!tagName) {
        continue;
      }

      const full = m[0] ?? "";
      const rawAttrs = m[2] ?? "";
      const fullStart = m.index ?? 0;
      const attrsOffset = full.indexOf(rawAttrs);
      const attrsStart = fullStart + (attrsOffset >= 0 ? attrsOffset : 0);
      const attrs = parseAttributes(rawAttrs, text, attrsStart);
      const attributeName = tagName === "Control" ? "ID" : "ControlID";
      const attr = getAttributeCaseInsensitive(attrs, attributeName) ?? (tagName === "Control" ? getAttributeCaseInsensitive(attrs, "ControlID") : undefined);
      if (!attr?.value || !attr.valueRange) {
        continue;
      }

      facts.htmlControlReferences.push({
        tagName,
        attributeName: attributeName === "ID" ? "ID" : "ControlID",
        ident: attr.value,
        range: attr.valueRange
      });
    }
  }

  return facts;
}

function findAttribute(rawAttrs: string, attrName: string, fullText: string, attrsStartIndex: number): XmlAttributeMatch | undefined {
  return parseAttributes(rawAttrs, fullText, attrsStartIndex).get(attrName);
}

function parseAttributes(rawAttrs: string, fullText: string, attrsStartIndex: number): Map<string, XmlAttributeMatch> {
  const map = new Map<string, XmlAttributeMatch>();
  ATTR_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTR_REGEX.exec(rawAttrs)) !== null) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? "";
    const quotePrefixLength = match[0].indexOf(value);
    const valueGlobalStart = attrsStartIndex + match.index + quotePrefixLength;
    const range = new vscode.Range(indexToPosition(fullText, valueGlobalStart), indexToPosition(fullText, valueGlobalStart + value.length));
    map.set(name, { name, value, valueRange: range });
  }

  return map;
}

function indexToPosition(text: string, index: number): vscode.Position {
  const safeIndex = Math.max(0, Math.min(text.length, index));
  const lineStarts = getLineStarts(text);

  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid];
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
    if (safeIndex < start) {
      high = mid - 1;
    } else if (safeIndex >= nextStart) {
      low = mid + 1;
    } else {
      return new vscode.Position(mid, safeIndex - start);
    }
  }

  const fallbackLine = Math.max(0, Math.min(lineStarts.length - 1, low));
  const fallbackStart = lineStarts[fallbackLine] ?? 0;
  return new vscode.Position(fallbackLine, safeIndex - fallbackStart);
}

function getLineStarts(text: string): number[] {
  if (lastIndexedText === text && lastLineStarts) {
    return lastLineStarts;
  }

  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }

  lastIndexedText = text;
  lastLineStarts = starts;
  return starts;
}

function stripPrefix(value: string): string {
  const parts = value.split(":");
  return parts[parts.length - 1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributeStartIndex(match: RegExpMatchArray, attrsGroupIndex = 1): number {
  const full = match[0] ?? "";
  const attrs = match[attrsGroupIndex] ?? "";
  const fullStart = match.index ?? 0;
  const attrsOffset = full.indexOf(attrs);
  return fullStart + (attrsOffset >= 0 ? attrsOffset : 0);
}

interface ButtonTagMatch {
  rawAttrs: string;
  attrsStartIndex: number;
  scopeKey: string;
}

interface ControlTagMatch {
  rawAttrs: string;
  attrsStartIndex: number;
  scopeKey: string;
}

interface SectionTagMatch {
  rawAttrs: string;
  attrsStartIndex: number;
  scopeKey: string;
}

interface PrimitiveTagMatch {
  rawAttrs: string;
  attrsStartIndex: number;
  scopeKey: string;
}

function collectControlTags(text: string): ControlTagMatch[] {
  const out: ControlTagMatch[] = [];
  const stack: Array<{ name: string; start: number }> = [];
  const tagRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const isClosing = match[1] === "/";
    const name = stripPrefix(match[2]).toLowerCase();
    const rawAttrs = match[3] ?? "";
    const fullTag = match[0] ?? "";
    const tagStart = match.index ?? 0;
    const isSelfClosing = !isClosing && /\/\s*$/.test(rawAttrs);

    if (!isClosing && name === "control") {
      const attrsStartOffset = fullTag.indexOf(rawAttrs);
      const attrsStartIndex = tagStart + (attrsStartOffset >= 0 ? attrsStartOffset : 0);
      const parentControls = findNearestOpenTag(stack, "controls");
      const scopeKey = parentControls ? `controls@${parentControls.start}` : "__global_controls__";

      out.push({
        rawAttrs,
        attrsStartIndex,
        scopeKey
      });
    }

    if (isClosing) {
      popOpenTag(stack, name);
      continue;
    }

    if (!isSelfClosing) {
      stack.push({ name, start: tagStart });
    }
  }

  return out;
}

function collectButtonTags(text: string): ButtonTagMatch[] {
  const out: ButtonTagMatch[] = [];
  const stack: Array<{ name: string; start: number }> = [];
  const tagRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const isClosing = match[1] === "/";
    const name = stripPrefix(match[2]).toLowerCase();
    const rawAttrs = match[3] ?? "";
    const fullTag = match[0] ?? "";
    const tagStart = match.index ?? 0;
    const isSelfClosing = !isClosing && /\/\s*$/.test(rawAttrs);

    if (!isClosing && name === "button") {
      const attrsStartOffset = fullTag.indexOf(rawAttrs);
      const attrsStartIndex = tagStart + (attrsStartOffset >= 0 ? attrsStartOffset : 0);
      const parentButtons = findNearestOpenTag(stack, "buttons");
      const scopeKey = parentButtons ? `buttons@${parentButtons.start}` : "__global_buttons__";

      out.push({
        rawAttrs,
        attrsStartIndex,
        scopeKey
      });
    }

    if (isClosing) {
      popOpenTag(stack, name);
      continue;
    }

    if (!isSelfClosing) {
      stack.push({ name, start: tagStart });
    }
  }

  return out;
}

function collectSectionTags(text: string): SectionTagMatch[] {
  const out: SectionTagMatch[] = [];
  const stack: Array<{ name: string; start: number }> = [];
  const tagRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const isClosing = match[1] === "/";
    const name = stripPrefix(match[2]).toLowerCase();
    const rawAttrs = match[3] ?? "";
    const fullTag = match[0] ?? "";
    const tagStart = match.index ?? 0;
    const isSelfClosing = !isClosing && /\/\s*$/.test(rawAttrs);

    if (!isClosing && name === "section") {
      const attrsStartOffset = fullTag.indexOf(rawAttrs);
      const attrsStartIndex = tagStart + (attrsStartOffset >= 0 ? attrsStartOffset : 0);
      const parentSections = findNearestOpenTag(stack, "sections");
      const scopeKey = parentSections ? `sections@${parentSections.start}` : "__global_sections__";

      out.push({
        rawAttrs,
        attrsStartIndex,
        scopeKey
      });
    }

    if (isClosing) {
      popOpenTag(stack, name);
      continue;
    }

    if (!isSelfClosing) {
      stack.push({ name, start: tagStart });
    }
  }

  return out;
}

function collectPrimitiveTags(text: string): PrimitiveTagMatch[] {
  const out: PrimitiveTagMatch[] = [];
  const stack: Array<{ name: string; start: number }> = [];
  const tagRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const isClosing = match[1] === "/";
    const name = stripPrefix(match[2]).toLowerCase();
    const rawAttrs = match[3] ?? "";
    const fullTag = match[0] ?? "";
    const tagStart = match.index ?? 0;
    const isSelfClosing = !isClosing && /\/\s*$/.test(rawAttrs);

    if (!isClosing && name === "useprimitive") {
      const attrsStartOffset = fullTag.indexOf(rawAttrs);
      const attrsStartIndex = tagStart + (attrsStartOffset >= 0 ? attrsStartOffset : 0);
      const parentButtons = findNearestOpenTag(stack, "buttons");
      const scopeKey = parentButtons ? `buttons@${parentButtons.start}` : "__global_buttons__";

      out.push({
        rawAttrs,
        attrsStartIndex,
        scopeKey
      });
    }

    if (isClosing) {
      popOpenTag(stack, name);
      continue;
    }

    if (!isSelfClosing) {
      stack.push({ name, start: tagStart });
    }
  }

  return out;
}

function findNearestOpenTag(
  stack: Array<{ name: string; start: number }>,
  name: string
): { name: string; start: number } | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name === name) {
      return stack[i];
    }
  }

  return undefined;
}

function popOpenTag(stack: Array<{ name: string; start: number }>, closingName: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name === closingName) {
      stack.splice(i, 1);
      return;
    }
  }
}

function collectRootFormContainerScopeKeys(text: string): {
  controls: Set<string>;
  buttons: Set<string>;
  sections: Set<string>;
} {
  const controls = new Set<string>();
  const buttons = new Set<string>();
  const sections = new Set<string>();
  const stack: Array<{ name: string; start: number }> = [];
  const tagRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const isClosing = match[1] === "/";
    const name = stripPrefix(match[2]).toLowerCase();
    const rawAttrs = match[3] ?? "";
    const tagStart = match.index ?? 0;
    const isSelfClosing = !isClosing && /\/\s*$/.test(rawAttrs);

    if (!isClosing && (name === "controls" || name === "buttons" || name === "sections")) {
      const inSection = stack.some((item) => item.name === "section");
      if (!inSection) {
        if (name === "controls") {
          controls.add(`controls@${tagStart}`);
        } else if (name === "buttons") {
          buttons.add(`buttons@${tagStart}`);
        } else {
          sections.add(`sections@${tagStart}`);
        }
      }
    }

    if (isClosing) {
      popOpenTag(stack, name);
      continue;
    }

    if (!isSelfClosing) {
      stack.push({ name, start: tagStart });
    }
  }

  return { controls, buttons, sections };
}

interface ButtonShareCodeContent {
  ident: string;
  content: string;
}

function collectButtonShareCodeContents(text: string): ButtonShareCodeContent[] {
  const out: ButtonShareCodeContent[] = [];
  for (const match of text.matchAll(/<ButtonShareCode\b([^>]*)>([\s\S]*?)<\/ButtonShareCode>/gi)) {
    const attrs = match[1] ?? "";
    if (/\/\s*$/.test(attrs)) {
      // Ignore self-closing tags: <ButtonShareCode ... />
      continue;
    }
    const parsed = parseAttributes(attrs, text, attributeStartIndex(match));
    const ident = parsed.get("Ident")?.value?.trim();
    if (!ident) {
      continue;
    }

    out.push({
      ident,
      content: match[2] ?? ""
    });
  }

  return out;
}

function collectButtonIdentsFromText(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/<Button\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1] ?? "", text, 0);
    const ident = attrs.get("Ident")?.value?.trim();
    if (!ident) {
      continue;
    }

    const type = attrs.get("xsi:type")?.value ?? attrs.get("type")?.value;
    if ((type ?? "").toLowerCase() === "sharecodebutton") {
      continue;
    }

    out.add(ident);
  }

  return out;
}

interface MappingContext {
  start: number;
  end: number;
  mappingFormIdent?: string;
  mappingFormIdentRange?: vscode.Range;
}

function collectMappingContexts(text: string): MappingContext[] {
  const contexts: MappingContext[] = [];

  for (const m of text.matchAll(/<Button\b([^>]*)>([\s\S]*?)<\/Button>/gi)) {
    const full = m[0] ?? "";
    const attrs = m[1] ?? "";
    const start = m.index ?? 0;
    const end = start + full.length;

    const attrsOffset = full.indexOf(attrs);
    const attrsStart = start + (attrsOffset >= 0 ? attrsOffset : 0);
    const parsedAttrs = parseAttributes(attrs, text, attrsStart);
    const mappingFormIdentAttr = parsedAttrs.get("MappingFormIdent");
    const mappingFormIdent = mappingFormIdentAttr?.value?.trim();

    contexts.push({
      start,
      end,
      mappingFormIdent: mappingFormIdent?.length ? mappingFormIdent : undefined,
      mappingFormIdentRange: mappingFormIdentAttr?.valueRange
    });
  }

  for (const m of text.matchAll(/<Action\b([^>]*)>([\s\S]*?)<\/Action>/gi)) {
    const full = m[0] ?? "";
    const attrs = m[1] ?? "";
    const start = m.index ?? 0;
    const end = start + full.length;

    const attrsOffset = full.indexOf(attrs);
    const attrsStart = start + (attrsOffset >= 0 ? attrsOffset : 0);
    const parsedAttrs = parseAttributes(attrs, text, attrsStart);
    const actionType = (
      getAttributeCaseInsensitive(parsedAttrs, "xsi:type")?.value ??
      getAttributeCaseInsensitive(parsedAttrs, "type")?.value ??
      ""
    ).trim().toLowerCase();
    if (actionType !== "generateform") {
      continue;
    }

    const mappingFormIdentAttr = getAttributeCaseInsensitive(parsedAttrs, "FormIdent");
    const mappingFormIdent = mappingFormIdentAttr?.value?.trim();
    if (!mappingFormIdent) {
      continue;
    }

    contexts.push({
      start,
      end,
      mappingFormIdent,
      mappingFormIdentRange: mappingFormIdentAttr?.valueRange
    });
  }

  contexts.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.end - b.end;
  });

  return contexts;
}

function findMappingContext(contexts: MappingContext[], offset: number): MappingContext | undefined {
  let best: MappingContext | undefined;
  for (const context of contexts) {
    if (offset >= context.start && offset <= context.end) {
      if (!best || (context.end - context.start) <= (best.end - best.start)) {
        best = context;
      }
    }
  }

  return best;
}

function getAttributeCaseInsensitive(attrs: Map<string, XmlAttributeMatch>, attributeName: string): XmlAttributeMatch | undefined {
  for (const [name, value] of attrs.entries()) {
    if (name.toLowerCase() === attributeName.toLowerCase()) {
      return value;
    }
  }

  return undefined;
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

function isButtonPrimitiveKey(value: string): boolean {
  const normalized = normalizeComponentKey(value).toLowerCase();
  return /\/buttons\/[^/]*button$/i.test(normalized);
}

function parsePlaceholderFields(rawBody: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of rawBody.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) {
      continue;
    }

    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) {
      continue;
    }
    out.set(key, value);
  }

  return out;
}

function getPlaceholderField(fields: Map<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (fields.has(key)) {
      return fields.get(key);
    }
  }
  for (const [name, value] of fields.entries()) {
    const lower = name.toLowerCase();
    if (keys.some((key) => key.toLowerCase() === lower)) {
      return value;
    }
  }
  return undefined;
}

function collectUsingProvidedParamNames(attrs: Map<string, XmlAttributeMatch>): string[] {
  const excluded = new Set([
    "feature",
    "component",
    "name",
    "contribution",
    "section",
    "suppressinheritance",
    "inherit"
  ]);
  const out: string[] = [];
  for (const name of attrs.keys()) {
    const lower = name.toLowerCase();
    if (excluded.has(lower)) {
      continue;
    }
    out.push(name);
  }

  return out;
}

function normalizeHtmlControlTagName(value: string): "Control" | "ControlLabel" | "ControlPlaceHolder" | undefined {
  const lower = value.toLowerCase();
  if (lower === "control") {
    return "Control";
  }

  if (lower === "controllabel") {
    return "ControlLabel";
  }

  if (lower === "controlplaceholder") {
    return "ControlPlaceHolder";
  }

  return undefined;
}
