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
  formIdent?: string;
  workflowFormIdent?: string;
  workflowFormIdentRange?: vscode.Range;
  declaredControls: Set<string>;
  declaredButtons: Set<string>;
  declaredSections: Set<string>;
  workflowReferences: WorkflowReference[];
  usingReferences: UsingReference[];
  formIdentReferences: FormIdentReference[];
  mappingIdentReferences: MappingIdentReference[];
  mappingFormIdentReferences: MappingFormIdentReference[];
  requiredActionIdentReferences: RequiredActionIdentReference[];
  workflowControlIdentReferences: WorkflowControlIdentReference[];
  htmlControlReferences: HtmlControlReference[];
  identOccurrences: IdentOccurrence[];
  declaredControlShareCodes: Set<string>;
  controlShareCodeDefinitions: Map<string, vscode.Range>;
  declaredButtonShareCodes: Set<string>;
  buttonShareCodeDefinitions: Map<string, vscode.Range>;
  buttonShareCodeButtonIdents: Map<string, Set<string>>;
  declaredControlInfos: NamedIdent[];
  declaredButtonInfos: NamedIdent[];
}

const ATTR_REGEX = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

let lastIndexedText: string | undefined;
let lastLineStarts: number[] | undefined;

export function parseDocumentFacts(document: vscode.TextDocument): ParsedDocumentFacts {
  return parseDocumentFactsFromText(document.getText());
}

export function parseDocumentFactsFromText(rawText: string): ParsedDocumentFacts {
  const text = maskXmlComments(rawText);

  const facts: ParsedDocumentFacts = {
    declaredControls: new Set<string>(),
    declaredButtons: new Set<string>(),
    declaredSections: new Set<string>(),
    workflowReferences: [],
    usingReferences: [],
    formIdentReferences: [],
    mappingIdentReferences: [],
    mappingFormIdentReferences: [],
    requiredActionIdentReferences: [],
    workflowControlIdentReferences: [],
    htmlControlReferences: [],
    identOccurrences: [],
    declaredControlShareCodes: new Set<string>(),
    controlShareCodeDefinitions: new Map<string, vscode.Range>(),
    declaredButtonShareCodes: new Set<string>(),
    buttonShareCodeDefinitions: new Map<string, vscode.Range>(),
    buttonShareCodeButtonIdents: new Map<string, Set<string>>(),
    declaredControlInfos: [],
    declaredButtonInfos: []
  };

  const rootMatch = /<\s*([A-Za-z_][\w:.-]*)\b/.exec(text);
  if (rootMatch) {
    facts.rootTag = stripPrefix(rootMatch[1]);
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

  for (const m of text.matchAll(/<Control\b([^>]*)>/gi)) {
    const attrs = parseAttributes(m[1], text, attributeStartIndex(m));
    const attr = attrs.get("Ident");
    const type = attrs.get("xsi:type")?.value ?? attrs.get("type")?.value;
    if (attr?.value) {
      facts.declaredControls.add(attr.value);
      if (attr.valueRange) {
        facts.identOccurrences.push({ ident: attr.value, range: attr.valueRange, kind: "control" });
        facts.declaredControlInfos.push({ ident: attr.value, range: attr.valueRange, type });
      }
    }
  }

  const buttonTags = collectButtonTags(text);
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
    if (attr.valueRange) {
      facts.workflowReferences.push({ kind: "section", ident: attr.value, range: attr.valueRange, scopeKey: sectionTag.scopeKey });
    }
  }

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

  for (const m of text.matchAll(/<Using\b([^>]*)>/gi)) {
    const attrs = parseAttributes(m[1], text, attributeStartIndex(m));
    const componentAttr = attrs.get("Component") ?? attrs.get("Name");
    if (!componentAttr?.value || !componentAttr.valueRange) {
      continue;
    }

    const sectionAttr = attrs.get("Section");
    facts.usingReferences.push({
      componentKey: normalizeComponentKey(componentAttr.value),
      rawComponentValue: componentAttr.value,
      componentValueRange: componentAttr.valueRange,
      sectionValue: sectionAttr?.value,
      sectionValueRange: sectionAttr?.valueRange
    });
  }

  const buttonContexts = collectButtonMappingContexts(text);
  for (const m of text.matchAll(/<Mapping\b([^>]*)>/gi)) {
    const attrs = parseAttributes(m[1], text, attributeStartIndex(m));
    const fromIdent = attrs.get("FromIdent");
    const toIdent = attrs.get("ToIdent");
    const context = findButtonContext(buttonContexts, m.index ?? 0);
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

  for (const context of buttonContexts) {
    if (context.mappingFormIdent && context.mappingFormIdentRange) {
      facts.mappingFormIdentReferences.push({
        formIdent: context.mappingFormIdent,
        range: context.mappingFormIdentRange
      });
    }
  }

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

interface SectionTagMatch {
  rawAttrs: string;
  attrsStartIndex: number;
  scopeKey: string;
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

interface ButtonMappingContext {
  start: number;
  end: number;
  mappingFormIdent?: string;
  mappingFormIdentRange?: vscode.Range;
}

function collectButtonMappingContexts(text: string): ButtonMappingContext[] {
  const contexts: ButtonMappingContext[] = [];

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

  return contexts;
}

function findButtonContext(contexts: ButtonMappingContext[], offset: number): ButtonMappingContext | undefined {
  for (const context of contexts) {
    if (offset >= context.start && offset <= context.end) {
      return context;
    }
  }

  return undefined;
}

function getAttributeCaseInsensitive(attrs: Map<string, XmlAttributeMatch>, attributeName: string): XmlAttributeMatch | undefined {
  for (const [name, value] of attrs.entries()) {
    if (name.toLowerCase() === attributeName.toLowerCase()) {
      return value;
    }
  }

  return undefined;
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
