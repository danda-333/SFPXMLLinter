import * as vscode from "vscode";
import { WorkflowTranslationSnapshot } from "../core/translations/workflowTranslations";

export const WORKFLOW_STATES_FACT_KIND = "fact.workflowStates";

export interface WorkflowTranslationInlaySettings {
  enabled: boolean;
}

export interface WorkflowButtonReference {
  titleResourceKey?: string;
  title?: string;
}
export interface WorkflowControlReference {
  titleResourceKey?: string;
  title?: string;
}

interface WorkflowStateEntry {
  value: string;
  titleKey?: string;
  title?: string;
  colorCssClass?: string;
  isOutOfSla?: string;
}

export class WorkflowTranslationInlayProvider implements vscode.InlayHintsProvider {
  public onDidChangeInlayHints?: vscode.Event<void> | undefined;
  private readonly lastProvideSignatureByUri = new Map<string, string>();
  private readonly hintCacheByUri = new Map<
    string,
    {
      documentVersion: number;
      snapshotRef: WorkflowTranslationSnapshot;
      settingsEnabled: boolean;
      isWorkflow: boolean;
      isForm: boolean;
      isGenericEligible: boolean;
      hints: vscode.InlayHint[];
    }
  >();

  public constructor(
    private readonly getTranslationSnapshot: () => WorkflowTranslationSnapshot,
    private readonly getSettings: () => WorkflowTranslationInlaySettings,
    private readonly getWorkflowButtonReferences: (document: vscode.TextDocument) => Map<string, WorkflowButtonReference>,
    private readonly getWorkflowControlReferences: (document: vscode.TextDocument) => Map<string, WorkflowControlReference>,
    private readonly getFormControlReferences: (document: vscode.TextDocument) => Map<string, WorkflowControlReference>,
    private readonly getWorkflowShareCodeButtonIdents: (document: vscode.TextDocument) => Map<string, Set<string>>,
    private readonly logDebug?: (message: string) => void
  ) {}

  public invalidateCache(): void {
    this.hintCacheByUri.clear();
    this.lastProvideSignatureByUri.clear();
  }

  public invalidateCacheForUri(uri: vscode.Uri): void {
    const key = uri.toString();
    this.hintCacheByUri.delete(key);
    this.lastProvideSignatureByUri.delete(key);
  }

  public provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.ProviderResult<vscode.InlayHint[]> {
    const settings = this.getSettings();
    const snapshot = this.getTranslationSnapshot();
    const relPath = document.uri.scheme === "file" ? vscode.workspace.asRelativePath(document.uri, false) : document.uri.toString();
    if (!settings.enabled || !snapshot.enabled) {
      this.logDebug?.(`inlay provide SKIP ${relPath} enabled=${settings.enabled} snapshotEnabled=${snapshot.enabled}`);
      return [];
    }

    const uriKey = document.uri.toString();
    const cached = this.hintCacheByUri.get(uriKey);
    const canReuse =
      cached &&
      cached.documentVersion === document.version &&
      cached.snapshotRef === snapshot &&
      cached.settingsEnabled === settings.enabled;

    let isWorkflow = false;
    let isForm = false;
    let isGenericEligible = false;
    let allHints: vscode.InlayHint[] = [];
    if (canReuse) {
      isWorkflow = cached.isWorkflow;
      isForm = cached.isForm;
      isGenericEligible = cached.isGenericEligible;
      allHints = cached.hints;
    } else {
      const computed = this.buildAllHints(document, snapshot);
      isWorkflow = computed.isWorkflow;
      isForm = computed.isForm;
      isGenericEligible = computed.isGenericEligible;
      allHints = computed.hints;
      this.hintCacheByUri.set(uriKey, {
        documentVersion: document.version,
        snapshotRef: snapshot,
        settingsEnabled: settings.enabled,
        isWorkflow,
        isForm,
        isGenericEligible,
        hints: allHints
      });
    }

    if (!isWorkflow && !isForm && !isGenericEligible) {
      this.logDebug?.(`inlay provide SKIP ${relPath} root=other`);
      return [];
    }

    const hints = allHints.filter((hint) => range.contains(hint.position));

    const signature = `${document.version}|w=${isWorkflow ? 1 : 0}|f=${isForm ? 1 : 0}|g=${isGenericEligible ? 1 : 0}|h=${hints.length}`;
    if (this.lastProvideSignatureByUri.get(uriKey) !== signature) {
      this.lastProvideSignatureByUri.set(uriKey, signature);
    }
    return hints;
  }

  private buildAllHints(
    document: vscode.TextDocument,
    snapshot: WorkflowTranslationSnapshot
  ): { isWorkflow: boolean; isForm: boolean; isGenericEligible: boolean; hints: vscode.InlayHint[] } {
    const text = document.getText();
    const isWorkflow = /<\s*WorkFlow\b/i.test(text);
    const isForm = /<\s*Form\b/i.test(text);
    const isGenericEligible =
      /<\s*DataView\b/i.test(text) ||
      /<\s*Section\b/i.test(text) ||
      /<\s*Column\b/i.test(text) ||
      /<\s*Control\b/i.test(text) ||
      /<\s*Action\b/i.test(text);

    const statesByValue = isWorkflow ? this.collectStates(text) : new Map<string, WorkflowStateEntry>();
    const hints: vscode.InlayHint[] = [];
    const usedHintKeys = new Set<string>();

    if (isWorkflow) {
      const stateTagRegex = /<State\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(stateTagRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }

        const attrs = parseAttributes(match[1] ?? "");
        const value = attrs.get("Value");
        const titleKey = attrs.get("TitleResourceKey");
        if (!value || !titleKey) {
          continue;
        }

        const titleKeyStart = (match[0] ?? "").indexOf(titleKey);
        if (titleKeyStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + titleKeyStart;
        const position = document.positionAt(absoluteOffset + titleKey.length);

        const translation = snapshot.byKey.get(titleKey);
        if (!translation) {
          continue;
        }
        pushHint(hints, usedHintKeys, position, translation);
      }
    }

    if (isForm) {
      const formControlRefs = this.getFormControlReferences(document);
      const htmlControlTagRegex = /<(Control|ControlLabel|ControlPlaceHolder)\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(htmlControlTagRegex)) {
        const tagName = (match[1] ?? "").trim().toLowerCase();
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }
        const attrs = parseAttributes(match[2] ?? "");
        const refAttrName = tagName === "control" ? "ID" : "ControlID";
        const controlIdent = attrs.get(refAttrName) ?? (tagName === "control" ? attrs.get("ControlID") : undefined);
        if (!controlIdent) {
          continue;
        }
        const reference = formControlRefs.get(controlIdent);
        if (!reference) {
          continue;
        }
        const titleKey = reference.titleResourceKey ?? "";
        const translation = titleKey
          ? (snapshot.byKey.get(titleKey) ?? titleKey)
          : (reference.title ?? "");
        if (!translation.trim()) {
          continue;
        }
        const attrStart = (match[0] ?? "").indexOf(controlIdent);
        if (attrStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + attrStart;
        const position = document.positionAt(absoluteOffset + controlIdent.length);
        if (lineHasXmlComment(document, position.line)) {
          continue;
        }
        pushHint(hints, usedHintKeys, position, translation);
      }

      const formControlRegex = /<Control\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(formControlRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }

        const attrs = parseAttributes(match[1] ?? "");
        const titleKey = attrs.get("TitleResourceKey");
        if (!titleKey) {
          continue;
        }
        const translation = snapshot.byKey.get(titleKey);
        if (!translation) {
          continue;
        }
        const titleKeyStart = (match[0] ?? "").indexOf(titleKey);
        if (titleKeyStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + titleKeyStart;
        const position = document.positionAt(absoluteOffset + titleKey.length);
        pushHint(hints, usedHintKeys, position, translation);
      }

      const formButtonRegex = /<Button\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(formButtonRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }

        const attrs = parseAttributes(match[1] ?? "");
        const titleKey = attrs.get("TitleResourceKey");
        if (!titleKey) {
          continue;
        }
        const translation = snapshot.byKey.get(titleKey);
        if (!translation) {
          continue;
        }
        const titleKeyStart = (match[0] ?? "").indexOf(titleKey);
        if (titleKeyStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + titleKeyStart;
        const position = document.positionAt(absoluteOffset + titleKey.length);
        pushHint(hints, usedHintKeys, position, translation);
      }
    }

    if (isWorkflow) {
      const workflowButtonRefs = this.getWorkflowButtonReferences(document);
      const workflowControlRefs = this.getWorkflowControlReferences(document);
      const shareCodeButtonIdents = this.getWorkflowShareCodeButtonIdents(document);
      const shareCodeLabelsByIdent = collectWorkflowButtonShareCodeLabels(text, workflowButtonRefs, shareCodeButtonIdents, snapshot);

      const formControlTagRegex = /<FormControl\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(formControlTagRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }
        const attrs = parseAttributes(match[1] ?? "");
        const ident = attrs.get("Ident");
        if (!ident) {
          continue;
        }
        const reference = workflowControlRefs.get(ident);
        if (!reference) {
          continue;
        }
        const titleKey = reference.titleResourceKey ?? "";
        const translation = titleKey
          ? (snapshot.byKey.get(titleKey) ?? titleKey)
          : (reference.title ?? "");
        const identStart = (match[0] ?? "").indexOf(ident);
        if (identStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + identStart;
        const position = document.positionAt(absoluteOffset + ident.length);
        if (lineHasXmlComment(document, position.line)) {
          continue;
        }
        if (!translation.trim()) {
          continue;
        }
        const hint = new vscode.InlayHint(position, ` ${translation}`, vscode.InlayHintKind.Type);
        hint.paddingLeft = true;
        hints.push(hint);
      }

      const shareCodeTagRegex = /<ButtonShareCode\b([^>]*)>([\s\S]*?)<\/ButtonShareCode>/gi;
      for (const match of text.matchAll(shareCodeTagRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }
        const attrs = parseAttributes(match[1] ?? "");
        const ident = attrs.get("Ident");
        if (!ident) {
          continue;
        }
        const label = shareCodeLabelsByIdent.get(ident);
        if (!label) {
          continue;
        }
        const identStart = (match[0] ?? "").indexOf(ident);
        if (identStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + identStart;
        const position = document.positionAt(absoluteOffset + ident.length);
        pushHint(hints, usedHintKeys, position, label);
      }

      const stepTagRegex = /<Step\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(stepTagRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }

        const attrs = parseAttributes(match[1] ?? "");
        const stateValue = attrs.get("State");
        if (!stateValue) {
          continue;
        }
        const stepIdent = attrs.get("Ident") ?? "";
        const stateInfo = statesByValue.get(stateValue);
        const titleKey = stateInfo?.titleKey ?? "";
        const translation = titleKey
          ? (snapshot.byKey.get(titleKey) ?? titleKey)
          : (stateInfo?.title ?? "");

        const valueStart = (match[0] ?? "").indexOf(stateValue);
        if (valueStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + valueStart;
        const position = document.positionAt(absoluteOffset + stateValue.length);
        if (lineHasXmlComment(document, position.line)) {
          continue;
        }

        const label = applyFormat("{translation}", {
          translation,
          stepIdent,
          stateValue,
          titleKey
        });
        if (!label.trim()) {
          continue;
        }
        const hint = new vscode.InlayHint(position, ` ${label}`, vscode.InlayHintKind.Type);
        hint.paddingLeft = true;
        hints.push(hint);
      }

      const actionTagRegex = /<Action\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(actionTagRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }
        const attrs = parseAttributes(match[1] ?? "");
        const actionType = (attrs.get("xsi:type") ?? attrs.get("type") ?? "").trim().toLowerCase();
        if (actionType !== "changestate") {
          continue;
        }
        const stateValue = attrs.get("State");
        if (!stateValue) {
          continue;
        }
        const stateInfo = statesByValue.get(stateValue);
        const titleKey = stateInfo?.titleKey ?? "";
        const translation = titleKey
          ? (snapshot.byKey.get(titleKey) ?? titleKey)
          : (stateInfo?.title ?? "");

        const valueStart = (match[0] ?? "").indexOf(stateValue);
        if (valueStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + valueStart;
        const position = document.positionAt(absoluteOffset + stateValue.length);
        if (lineHasXmlComment(document, position.line)) {
          continue;
        }

        const label = applyFormat("{translation}", {
          translation,
          stepIdent: "",
          stateValue,
          titleKey
        });
        if (!label.trim()) {
          continue;
        }
        pushHint(hints, usedHintKeys, position, label);
      }

      const buttonTagRegex = /<Button\b([^>]*)\/?>/gi;
      for (const match of text.matchAll(buttonTagRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }
        const attrs = parseAttributes(match[1] ?? "");
        const ident = attrs.get("Ident");
        if (!ident) {
          continue;
        }
        if (isShareCodeButton(attrs.get("xsi:type"))) {
          const shareCodeLabel = shareCodeLabelsByIdent.get(ident);
          if (!shareCodeLabel) {
            continue;
          }
          const identStart = (match[0] ?? "").indexOf(ident);
          if (identStart < 0) {
            continue;
          }
          const absoluteOffset = fullStart + identStart;
          const position = document.positionAt(absoluteOffset + ident.length);
          if (lineHasXmlComment(document, position.line)) {
            continue;
          }
        pushHint(hints, usedHintKeys, position, shareCodeLabel);
          continue;
        }
        const reference = workflowButtonRefs.get(ident);
        const titleKey = reference?.titleResourceKey ?? attrs.get("TitleResourceKey") ?? "";
        const translation = titleKey
          ? (snapshot.byKey.get(titleKey) ?? titleKey)
          : (reference?.title ?? attrs.get("Title") ?? "");
        const identStart = (match[0] ?? "").indexOf(ident);
        if (identStart < 0) {
          continue;
        }
        const absoluteOffset = fullStart + identStart;
        const position = document.positionAt(absoluteOffset + ident.length);
        if (lineHasXmlComment(document, position.line)) {
          continue;
        }
        if (!translation.trim()) {
          continue;
        }
        pushHint(hints, usedHintKeys, position, translation);
      }
    }

    this.collectGenericTranslationHints(document, text, snapshot, isForm, hints, usedHintKeys);

    return { isWorkflow, isForm, isGenericEligible, hints };
  }

  private collectGenericTranslationHints(
    document: vscode.TextDocument,
    text: string,
    snapshot: WorkflowTranslationSnapshot,
    isForm: boolean,
    hints: vscode.InlayHint[],
    usedHintKeys: Set<string>
  ): void {
    const addByAttr = (tagRegex: RegExp, attrName: string, skipOnFormControl = false): void => {
      for (const match of text.matchAll(tagRegex)) {
        const fullStart = match.index ?? -1;
        if (fullStart < 0) {
          continue;
        }
        const tagName = (match[1] ?? "").trim().toLowerCase();
        if (skipOnFormControl && isForm && tagName === "control") {
          continue;
        }
        const attrs = parseAttributes(match[2] ?? "");
        const key = attrs.get(attrName);
        if (!key) {
          continue;
        }
        const translation = snapshot.byKey.get(key);
        if (!translation) {
          continue;
        }
        const keyStart = (match[0] ?? "").indexOf(key);
        if (keyStart < 0) {
          continue;
        }
        const position = document.positionAt(fullStart + keyStart + key.length);
        if (lineHasXmlComment(document, position.line)) {
          continue;
        }
        pushHint(hints, usedHintKeys, position, translation);
      }
    };

    addByAttr(/<(Section)\b([^>]*)\/?>/gi, "TitleResourceKey");
    addByAttr(/<(Column)\b([^>]*)\/?>/gi, "TitleResourceKey");
    addByAttr(/<(Control)\b([^>]*)\/?>/gi, "TitleResourceKey", true);

    const dataViewRootRegex = /<\s*DataView\b([^>]*)>/i;
    const dataViewRootMatch = dataViewRootRegex.exec(text);
    if (dataViewRootMatch) {
      const attrs = parseAttributes(dataViewRootMatch[1] ?? "");
      for (const attrName of ["TitleResourceKey", "GroupTitleResourceKey"]) {
        const key = attrs.get(attrName);
        if (!key) {
          continue;
        }
        const translation = snapshot.byKey.get(key);
        if (!translation) {
          continue;
        }
        const keyStart = (dataViewRootMatch[0] ?? "").indexOf(key);
        if (keyStart < 0) {
          continue;
        }
        const fullStart = dataViewRootMatch.index ?? -1;
        if (fullStart < 0) {
          continue;
        }
        const position = document.positionAt(fullStart + keyStart + key.length);
        if (lineHasXmlComment(document, position.line)) {
          continue;
        }
        pushHint(hints, usedHintKeys, position, translation);
      }
    }

    const globalValidationActionRegex = /<(Action)\b([^>]*)\/?>/gi;
    for (const match of text.matchAll(globalValidationActionRegex)) {
      const fullStart = match.index ?? -1;
      if (fullStart < 0) {
        continue;
      }
      const attrs = parseAttributes(match[2] ?? "");
      const actionType = (attrs.get("xsi:type") ?? attrs.get("type") ?? "").trim().toLowerCase();
      if (actionType !== "globalvalidation") {
        continue;
      }
      const key = attrs.get("ErrorMessageResourceKey");
      if (!key) {
        continue;
      }
      const translation = snapshot.byKey.get(key);
      if (!translation) {
        continue;
      }
      const keyStart = (match[0] ?? "").indexOf(key);
      if (keyStart < 0) {
        continue;
      }
      const position = document.positionAt(fullStart + keyStart + key.length);
      if (lineHasXmlComment(document, position.line)) {
        continue;
      }
      pushHint(hints, usedHintKeys, position, translation);
    }
  }

  private collectStates(text: string): Map<string, WorkflowStateEntry> {
    const out = new Map<string, WorkflowStateEntry>();
    const stateTagRegex = /<State\b([^>]*)\/?>/gi;
    for (const match of text.matchAll(stateTagRegex)) {
      const attrs = parseAttributes(match[1] ?? "");
      const value = attrs.get("Value");
      if (!value) {
        continue;
      }
      out.set(value, {
        value,
        titleKey: attrs.get("TitleResourceKey"),
        title: attrs.get("Title"),
        colorCssClass: attrs.get("ColorCssClass"),
        isOutOfSla: attrs.get("IsOutOfSLA")
      });
    }
    return out;
  }
}

function collectWorkflowButtonShareCodeLabels(
  workflowText: string,
  workflowButtonRefs: Map<string, WorkflowButtonReference>,
  inheritedShareCodeButtonIdents: Map<string, Set<string>>,
  snapshot: WorkflowTranslationSnapshot
): Map<string, string> {
  const out = new Map<string, string>();
  const byShareCodeButtonIdents = new Map<string, Set<string>>();

  for (const [shareCodeIdent, buttonIdents] of inheritedShareCodeButtonIdents.entries()) {
    if (!byShareCodeButtonIdents.has(shareCodeIdent)) {
      byShareCodeButtonIdents.set(shareCodeIdent, new Set<string>());
    }
    const target = byShareCodeButtonIdents.get(shareCodeIdent);
    if (!target) {
      continue;
    }
    for (const buttonIdent of buttonIdents) {
      target.add(buttonIdent);
    }
  }

  const shareCodeTagRegex = /<ButtonShareCode\b([^>]*)>([\s\S]*?)<\/ButtonShareCode>/gi;
  for (const match of workflowText.matchAll(shareCodeTagRegex)) {
    const attrs = parseAttributes(match[1] ?? "");
    const ident = attrs.get("Ident");
    if (!ident) {
      continue;
    }
    if (!byShareCodeButtonIdents.has(ident)) {
      byShareCodeButtonIdents.set(ident, new Set<string>());
    }
    const target = byShareCodeButtonIdents.get(ident);
    if (!target) {
      continue;
    }
    const body = match[2] ?? "";
    const nestedButtonRegex = /<Button\b([^>]*)\/?>/gi;
    for (const nestedMatch of body.matchAll(nestedButtonRegex)) {
      const nestedAttrs = parseAttributes(nestedMatch[1] ?? "");
      const buttonIdent = nestedAttrs.get("Ident");
      if (!buttonIdent) {
        continue;
      }
      target.add(buttonIdent);
    }
  }

  for (const [shareCodeIdent, buttonIdents] of byShareCodeButtonIdents.entries()) {
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const buttonIdent of buttonIdents) {
      const ref = workflowButtonRefs.get(buttonIdent);
      const label = resolveWorkflowButtonReferenceLabel(buttonIdent, ref ?? {}, snapshot);
      if (!label || seen.has(label)) {
        continue;
      }
      seen.add(label);
      labels.push(label);
    }
    const rendered = labels.join(", ").trim();
    if (rendered) {
      out.set(shareCodeIdent, rendered);
    }
  }
  return out;
}

function resolveWorkflowButtonReferenceLabel(
  ident: string,
  reference: WorkflowButtonReference,
  snapshot: WorkflowTranslationSnapshot
): string {
  const titleKey = reference.titleResourceKey ?? "";
  if (titleKey) {
    return snapshot.byKey.get(titleKey) ?? titleKey;
  }
  return reference.title?.trim() || ident;
}

function isShareCodeButton(rawType: string | undefined): boolean {
  if (!rawType) {
    return false;
  }
  const normalized = rawType.trim().toLowerCase();
  return normalized === "sharecodebutton" || normalized.endsWith(":sharecodebutton");
}

function parseAttributes(rawAttrs: string): Map<string, string> {
  const out = new Map<string, string>();
  const regex = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawAttrs)) !== null) {
    out.set(match[1], match[3] ?? match[4] ?? "");
  }
  return out;
}

function lineHasXmlComment(document: vscode.TextDocument, line: number): boolean {
  const text = document.lineAt(line).text;
  const open = text.indexOf("<!--");
  if (open < 0) {
    return false;
  }
  const close = text.indexOf("-->", open + 4);
  return close > open;
}

function applyFormat(format: string, values: Record<string, string>): string {
  return format.replace(/\{([A-Za-z0-9_]+)\}/g, (_token, key: string) => values[key] ?? "");
}

function pushHint(
  hints: vscode.InlayHint[],
  usedHintKeys: Set<string>,
  position: vscode.Position,
  label: string
): void {
  const trimmed = label.trim();
  if (!trimmed) {
    return;
  }
  const key = `${position.line}:${position.character}:${trimmed}`;
  if (usedHintKeys.has(key)) {
    return;
  }
  usedHintKeys.add(key);
  const hint = new vscode.InlayHint(position, ` ${trimmed}`, vscode.InlayHintKind.Type);
  hint.paddingLeft = true;
  hints.push(hint);
}
