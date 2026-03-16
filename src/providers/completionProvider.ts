import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots, normalizeComponentKey } from "../utils/paths";
import { collectTemplateAvailableControlIdents } from "../utils/templateControls";
import { collectResolvableControlIdents } from "../utils/controlIdents";
import { getSystemMetadata } from "../config/systemMetadata";
import { getAllFormIdentCandidates } from "../utils/formIdents";
import { buildDocumentCompositionModel } from "../composition/documentModel";
import { contributionMatchesDocumentRoot } from "../composition/usingImpact";
import { collectCompletionSymbolValues, CompletionSymbolKind } from "../utils/completionSymbolModel";
import { IndexedForm } from "../indexer/types";

type IndexAccessor = (uri?: vscode.Uri) => WorkspaceIndex;
type OwningFormResolver = (formIdent: string, preferredIndex: WorkspaceIndex) => { form: IndexedForm; index: WorkspaceIndex } | undefined;

const ROOT_ELEMENTS = ["Form", "WorkFlow", "DataView", "Filter", "Dashboard", "Configuration", "Feature", "Component", "Primitive"];

const CHILD_ELEMENTS: Record<string, string[]> = {
  form: ["Buttons", "Controls", "Sections", "Components", "Usings", "Using", "Includes", "Include", "DataPermissions", "CreatePermissions", "AccessPermissions", "DenyPermissions"],
  workflow: ["Definition", "Steps", "GlobalActions", "GlobalJavaScripts", "ActionShareCodes", "ButtonShareCodes", "ControlShareCodes", "Usings", "Using", "Includes", "Include"],
  globalactions: ["Action"],
  beforeopenactions: ["Action"],
  actionsharecodes: ["ActionShareCode"],
  actionsharecode: ["Actions"],
  actions: ["Action"],
  trueactions: ["Action"],
  falseactions: ["Action"],
  controls: ["Control", "FormControl"],
  buttons: ["Button"],
  sections: ["Section"],
  definition: ["States"],
  states: ["State"],
  steps: ["Step"],
  step: ["Groups"],
  groups: ["Group"],
  group: ["Permissions", "Buttons", "Controls", "Sections", "JavaScripts", "BeforeOpenActions", "Wizard"],
  usings: ["Using"],
  includes: ["Include"],
  contributions: ["Contribution"],
  using: ["SectionOverride"],
  include: ["SectionOverride"],
  feature: ["AccessPermissions", "DenyPermissions", "PackageIdents", "CssRelativePaths", "JavaScriptRelativePaths", "Setting", "Contributions", "Sections", "Manifest"],
  primitive: ["Template", "Templates", "Param", "Params"],
  templates: ["Template"],
  params: ["Param"],
  component: ["AccessPermissions", "DenyPermissions", "PackageIdents", "CssRelativePaths", "JavaScriptRelativePaths", "Setting", "Contributions", "Sections"]
};

const ATTRIBUTES_BY_TAG: Record<string, string[]> = {
  form: ["Ident", "SegmentType", "PackageIdent", "Title", "TitleResourceKey", "FormType"],
  workflow: ["Ident", "FormIdent", "StartState", "DeleteState"],
  control: [
    "xsi:type",
    "Ident",
    "DataType",
    "MaxLength",
    "Title",
    "TitleResourceKey",
    "IsReadOnly",
    "IsVisible",
    "IsRequired",
    "DefaultValue",
    "FormIdent",
    "DisplayMember",
    "ValueMember",
    "MappingFormIdent"
  ],
  formcontrol: ["xsi:type", "Ident", "IsVisible", "IsReadOnly", "IsRequired", "Title", "TitleResourceKey", "MappingFormIdent"],
  button: [
    "xsi:type",
    "Ident",
    "Title",
    "TitleResourceKey",
    "IsVisible",
    "IsSave",
    "ActionStart",
    "FormIdent",
    "PlacementType",
    "ColorType",
    "Color",
    "IconCssClass",
    "IsStopRedirect",
    "IsSystem",
    "MappingFormIdent"
  ],
  section: ["xsi:type", "Ident", "Name", "Title", "TitleResourceKey", "TargetXPath", "Insert", "Root"],
  contribution: ["xsi:type", "Ident", "Name", "Title", "TitleResourceKey", "TargetXPath", "Insert", "Root", "AllowMultipleInserts", "Kind", "Summary"],
  using: ["Feature", "Component", "Name", "Contribution", "Section", "Insert", "SuppressInheritance", "Inherit"],
  include: ["Feature", "Component", "Name", "Contribution", "Section", "Insert"],
  useprimitive: ["Primitive", "Name", "Feature", "Component", "Template", "Contribution", "Section"],
  sectionoverride: ["Name", "TargetXPath", "Insert", "Root"],
  state: ["Value", "Title", "TitleResourceKey", "ColorCssClass"],
  action: [
    "xsi:type",
    "Ident",
    "State",
    "ActionStart",
    "ControlIdent",
    "FormIdent",
    "ButtonIdent",
    "Value",
    "Type",
    "SubjectResourceKey",
    "BodyResourceKey",
    "EmailIdent",
    "MessageResourceKey",
    "AlertIdent",
    "IconCssClass",
    "IconColor",
    "ErrorMessageResourceKey",
    "IsStopSendActionCreator"
  ],
  javascript: ["xsi:type", "Ident", "ControlIdent", "ActionStart"],
  mapping: ["FromIdent", "ToIdent"],
  datasource: ["Ident", "FormIdent"]
  ,
  controllabel: ["ControlID"],
  htmllabel: ["ControlID"],
  controlplaceholder: ["ControlID"],
  parameter: ["xsi:type", "Ident", "DataType", "Value", "ConstantType", "LikeType", "MaxLength", "SetDataType"],
  "dsp:parameter": ["xsi:type", "Ident", "DataType", "Value", "ConstantType", "LikeType", "MaxLength", "SetDataType"]
};

const CONTROL_TYPES = [
  "TextBoxControl",
  "TextAreaControl",
  "DropDownListControl",
  "AutoCompleteControl",
  "SwitchControl",
  "CheckBoxControl",
  "CheckBoxListControl",
  "RadioButtonListControl",
  "FileControl",
  "RichTextBoxControl",
  "TagControl",
  "SubFormControl",
  "DataGridControl",
  "HiddenControl",
  "TimeLineControl",
  "PasswordControl",
  "HTMLContentControl",
  "HTMLContentViewControl"
];

const BUTTON_TYPES = ["FormButton", "ActionButton", "BackButton", "PrintButton", "DownloadButton", "ExportButton", "GroupButton", "ShareCodeButton", "LinkButton"];
const SECTION_TYPES = ["ContentSection", "HeaderSection", "PrintSection", "PDFSection", "DOCXSection", "XLSXSection", "ConfirmFormDialogSection", "DataSourceSection"];
const DATA_TYPES = [
  "None",
  "String",
  "VarChar",
  "Number",
  "Double",
  "Time",
  "Date",
  "DateTime",
  "Bool",
  "SmallNumber",
  "StringList",
  "VarCharList",
  "NumberList",
  "SmallNumberList",
  "ByteList",
  "Time24",
  "Guid",
  "BigNumber"
];
const DATA_TYPE_CHOICE_ALL = "None,String,VarChar,Number,Double,Time,Date,DateTime,Bool,SmallNumber,StringList,VarCharList,NumberList,SmallNumberList,ByteList,Time24,Guid,BigNumber";
const DATA_TYPE_CHOICE_TEXT = "String,VarChar,Number,Double,Date,DateTime,Time,Time24,Bool,Guid,BigNumber,SmallNumber";
const DATA_TYPE_CHOICE_LOOKUP_SINGLE = "String,VarChar,Number,Guid,SmallNumber,BigNumber";
const DATA_TYPE_CHOICE_LOOKUP_MULTI = "StringList,VarCharList,NumberList,SmallNumberList";
const INSERT_MODES = ["append", "prepend", "before", "after", "placeholder"];
const COLOR_CSS = ["danger", "warning", "primary", "info", "success", "dark"];
const ACTION_START_TYPES = ["BeforeValidation", "AfterValidation", "AfterSave", "AfterPermission"];
const ACTION_TYPES = [
  "ChangeState",
  "ShareCode",
  "ActionTrigger",
  "ActionValue",
  "GlobalValidation",
  "Email",
  "Required",
  "Communication",
  "Alert",
  "SetValue",
  "IF",
  "GenerateSubForm",
  "ClearCache",
  "GenerateForm",
  "History"
];
const PARAMETER_TYPES = ["dsp:VariableParameter", "dsp:ValueParameter", "dsp:TableParameter"];
const PARAMETER_CONSTANT_TYPES = ["UserID", "UserLanguageID", "UICultureCode"];
const PARAMETER_SET_DATA_TYPES = [
  "ActualData",
  "OldData",
  "ParentData",
  "QueryStringData",
  "POSTData",
  "HTTPData",
  "ExtensionData",
  "HTMLAttribute",
  "SelectedValueData",
  "SpecifyData"
];
const SQL_CONSTANT_PARAMETERS: Array<{ ident: string; dataType: string; constantType: string }> = [
  { ident: "UserID", dataType: "Number", constantType: "UserID" },
  { ident: "UserLanguageID", dataType: "Number", constantType: "UserLanguageID" },
  { ident: "UICultureCode", dataType: "String", constantType: "UICultureCode" }
];
const SUPPRESS_SQL_SUGGEST_COMMAND = "sfpXmlLinter.suppressNextSqlSuggest";

interface TagContext {
  inTag: boolean;
  inTagName: boolean;
  currentTag?: string;
  parentTag?: string;
  currentTagFragment: string;
  currentAttributeNames: Set<string>;
  valueAttribute?: string;
  valuePrefix?: string;
  usingComponentInTag?: string;
  mappingFormIdentInScope?: string;
  formControlTypeInTag?: string;
}

interface SqlCompletionResult {
  inSqlContext: boolean;
  items: vscode.CompletionItem[];
}

interface PlaceholderCompletionContext {
  mode: "key" | "value";
  key?: string;
  keyPrefix?: string;
  valuePrefix?: string;
  replaceRange: vscode.Range;
  fields: Map<string, string>;
  usedKeysLower: Set<string>;
}

export class SfpXmlCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly getIndex: IndexAccessor,
    private readonly resolveOwningForm?: OwningFormResolver
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
    }

    const sqlParameterCompletion = this.completeSqlParameterIdents(document, position);
    if (sqlParameterCompletion.inSqlContext) {
      // Mark as incomplete so VS Code asks again on each keystroke inside SQL/Command.
      return new vscode.CompletionList(sqlParameterCompletion.items, true);
    }

    const placeholderItems = this.completePlaceholderToken(document, position);
    if (placeholderItems) {
      return new vscode.CompletionList(placeholderItems, true);
    }

    const ctx = computeTagContext(document, position);
    if (!ctx.inTag) {
      const requiredActionIdents = this.completeRequiredActionIdents(document, position);
      if (requiredActionIdents.length > 0) {
        return requiredActionIdents;
      }

      return this.completeBodySnippets(document, position);
    }

    if (ctx.inTagName) {
      return this.completeElementNames(ctx);
    }

    if (ctx.valueAttribute) {
      return this.completeAttributeValues(document, position, ctx);
    }

    if (ctx.currentTag) {
      return this.completeAttributes(document, ctx.currentTag, ctx.currentAttributeNames, ctx.currentTagFragment);
    }

    return undefined;
  }

  private completeSqlParameterIdents(document: vscode.TextDocument, position: vscode.Position): SqlCompletionResult {
    const context = computeSqlParameterContext(document, position);
    if (!context) {
      return { items: [], inSqlContext: false };
    }

    const items = asValueItems(context.identifiers, vscode.CompletionItemKind.Variable);
    for (const item of items) {
      item.range = context.replaceRange;
      item.detail = "SFP SQL parameter";
      const value = typeof item.insertText === "string" ? item.insertText : item.label.toString();
      item.filterText = buildCaseInsensitiveSqlFilterText(value);
    }

    items.push(...appendSqlParameterItems(document, context));

    return { items, inSqlContext: true };
  }

  private completePlaceholderToken(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const context = computePlaceholderCompletionContext(document, position);
    if (!context) {
      return undefined;
    }

    const index = this.getIndex(document.uri);
    const facts = parseDocumentFacts(document);
    const componentKeyFromFields =
      context.fields.get("Feature") ??
      context.fields.get("Component") ??
      context.fields.get("Name") ??
      context.fields.get("Primitive");
    const componentKey = componentKeyFromFields ? normalizeComponentKey(componentKeyFromFields) : undefined;
    const component = componentKey ? resolveComponentByKey(index, componentKey) : undefined;

    if (context.mode === "key") {
      const keys = [
        "Feature",
        "Component",
        "Name",
        "Primitive",
        "Contribution",
        "Section",
        "Template"
      ];
      const available = keys.filter((key) => !context.usedKeysLower.has(key.toLowerCase()));
      if (component && (context.fields.get("Contribution") || context.fields.get("Section"))) {
        const selectedContribution =
          context.fields.get("Contribution") ??
          context.fields.get("Section");
        const contribution = selectedContribution ? component.contributionSummaries.get(selectedContribution) : undefined;
        if (contribution) {
          for (const requiredParamName of contribution.requiredParamNames) {
            if (!context.usedKeysLower.has(requiredParamName.toLowerCase())) {
              available.push(requiredParamName);
            }
          }
        }
      }

      const prefix = (context.keyPrefix ?? "").trim().toLowerCase();
      const filtered = prefix.length > 0
        ? available.filter((key) => key.toLowerCase().startsWith(prefix))
        : available;
      const items = asValueItems(filtered, vscode.CompletionItemKind.Property);
      for (const item of items) {
        item.range = context.replaceRange;
        item.insertText = `${item.label}:`;
      }
      return items;
    }

    const keyLower = (context.key ?? "").trim().toLowerCase();
    let values: vscode.CompletionItem[] = [];
    if (keyLower === "feature" || keyLower === "component" || keyLower === "name" || keyLower === "primitive") {
      values = asValueItems(sortedComponentKeys(index), vscode.CompletionItemKind.File);
    } else if (keyLower === "contribution" || keyLower === "section" || keyLower === "template") {
      if (!component) {
        return [];
      }
      values = buildContributionValueItems(component, facts.rootTag);
    }

    const prefix = (context.valuePrefix ?? "").trim().toLowerCase();
    for (const item of values) {
      item.range = context.replaceRange;
    }

    return prefix.length > 0
      ? values.filter((item) => String(item.label).toLowerCase().startsWith(prefix))
      : values;
  }

  private completeRequiredActionIdents(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const requiredContext = computeRequiredActionStringContext(document, position);
    if (!requiredContext) {
      return [];
    }

    const facts = parseDocumentFacts(document);
    const index = this.getIndex(document.uri);
    const documentComposition = buildDocumentCompositionModel(facts, index);
    const values = [...collectResolvableControlIdents(document, facts, index, { compositionModel: documentComposition })].sort((a, b) => a.localeCompare(b));
    const items = asValueItems(values, vscode.CompletionItemKind.Reference);
    for (const item of items) {
      item.range = requiredContext.replaceRange;
    }

    return items;
  }

  private completeBodySnippets(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.slice(0, offset);
    const parentTag = getParentTag(before)?.toLowerCase();
    if (!parentTag) {
      return undefined;
    }

    const snippets = this.snippetElementsForParent(parentTag, document);
    if (snippets.length === 0) {
      return undefined;
    }

    const line = document.lineAt(position.line).text;
    const currentPrefix = line.slice(0, position.character).match(/[A-Za-z_][\w:-]*$/)?.[0] ?? "";
    const start = position.translate(0, -currentPrefix.length);
    const replaceRange = new vscode.Range(start, position);

    return snippets.map((item) => {
      const clone = new vscode.CompletionItem(item.label, item.kind);
      clone.insertText = item.insertText;
      clone.filterText = item.filterText;
      clone.sortText = item.sortText;
      clone.detail = item.detail;
      clone.range = replaceRange;
      return clone;
    });
  }

  private completeElementNames(ctx: TagContext): vscode.CompletionItem[] {
    const parent = (ctx.parentTag ?? "").toLowerCase();
    const names = parent.length > 0 ? (CHILD_ELEMENTS[parent] ?? ROOT_ELEMENTS) : ROOT_ELEMENTS;
    const snippetItems = this.snippetElementsForParent(parent, undefined);
    if (snippetItems.length > 0) {
      return [...snippetItems, ...names.map((name) => this.createElementNameItem(name))];
    }

    return names.map((name) => this.createElementNameItem(name));
  }

  private createElementNameItem(name: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
    item.insertText = name;
    return item;
  }

  private completeAttributes(
    _document: vscode.TextDocument,
    tagName: string,
    alreadyPresent: Set<string>,
    tagFragment?: string
  ): vscode.CompletionItem[] {
    let attrs = ATTRIBUTES_BY_TAG[tagName.toLowerCase()] ?? [];
    if (tagName.toLowerCase() === "action" && tagFragment) {
      const actionType = (extractAttributeValue(tagFragment, "xsi:type") ?? extractAttributeValue(tagFragment, "type") ?? "").toLowerCase();
      if (actionType === "actionvalue") {
        attrs = attrs.filter((attr) => attr.toLowerCase() !== "value");
      }
    }
    const items: vscode.CompletionItem[] = [];

    for (const attr of attrs) {
      if (alreadyPresent.has(attr)) {
        continue;
      }

      const item = new vscode.CompletionItem(attr, vscode.CompletionItemKind.Property);
      item.insertText = new vscode.SnippetString(`${attr}="$1"`);
      items.push(item);
    }

    return items;
  }

  private async completeAttributeValues(document: vscode.TextDocument, position: vscode.Position, ctx: TagContext): Promise<vscode.CompletionItem[]> {
    const facts = parseDocumentFacts(document);
    const index = this.getIndex(document.uri);
    const documentComposition = buildDocumentCompositionModel(facts, index);
    const tag = (ctx.currentTag ?? "").toLowerCase();
    const attr = ctx.valueAttribute;

    if (!attr) {
      return [];
    }

    if (attr === "xsi:type" || attr === "type") {
      if (tag === "parameter" || tag === "dsp:parameter") {
        return asValueItems(PARAMETER_TYPES, vscode.CompletionItemKind.EnumMember);
      }

      if (tag === "action") {
        return asValueItems(ACTION_TYPES, vscode.CompletionItemKind.EnumMember);
      }

      if (tag === "control") {
        return asValueItems(CONTROL_TYPES, vscode.CompletionItemKind.EnumMember);
      }
      if (tag === "button") {
        return asValueItems(BUTTON_TYPES, vscode.CompletionItemKind.EnumMember);
      }
      if (tag === "section") {
        return asValueItems(SECTION_TYPES, vscode.CompletionItemKind.EnumMember);
      }
      return [];
    }

    if (attr === "datatype") {
      return asValueItems(DATA_TYPES, vscode.CompletionItemKind.EnumMember);
    }

    if (attr === "insert") {
      return asValueItems(INSERT_MODES, vscode.CompletionItemKind.EnumMember);
    }

    if (attr === "suppressinheritance" || attr === "inherit") {
      return asValueItems(["true", "false"], vscode.CompletionItemKind.EnumMember);
    }

    if (attr === "colorcssclass") {
      return asValueItems(COLOR_CSS, vscode.CompletionItemKind.EnumMember);
    }

    if (attr === "actionstart") {
      return asValueItems(ACTION_START_TYPES, vscode.CompletionItemKind.EnumMember);
    }

    if (attr === "constanttype") {
      const prefix = getActiveAttributeValuePrefixAtPosition(document, position, "ConstantType") ?? ctx.valuePrefix;
      return parameterConstantTypeItems(prefix);
    }

    if (attr === "setdatatype") {
      return asValueItems(PARAMETER_SET_DATA_TYPES, vscode.CompletionItemKind.EnumMember);
    }

    if (attr === "formident") {
      return asValueItems(sortedFormIdents(index), vscode.CompletionItemKind.Reference);
    }

    if (attr === "mappingformident") {
      return asValueItems(sortedFormIdents(index), vscode.CompletionItemKind.Reference);
    }

    if (attr === "controlident") {
      const actionType = tag === "action" ? ((extractAttributeValue(ctx.currentTagFragment, "xsi:type") ?? extractAttributeValue(ctx.currentTagFragment, "type") ?? "").toLowerCase()) : "";
      const jsType = tag === "javascript" ? ((extractAttributeValue(ctx.currentTagFragment, "xsi:type") ?? extractAttributeValue(ctx.currentTagFragment, "type") ?? "").toLowerCase()) : "";
      const supported =
        (tag === "action" && actionType === "actionvalue") ||
        (tag === "javascript" && jsType === "showhide");

      if (!supported) {
        return [];
      }

      const values = [...collectResolvableControlIdents(document, facts, index, { compositionModel: documentComposition })].sort((a, b) => a.localeCompare(b));
      return asValueItems(values, vscode.CompletionItemKind.Reference);
    }

    if (
      (tag === "control" && (attr === "id" || attr === "controlid")) ||
      (tag === "controllabel" && (attr === "controlid" || attr === "id")) ||
      (tag === "controlplaceholder" && (attr === "controlid" || attr === "id"))
    ) {
      const root = facts.rootTag?.toLowerCase();
      if (root !== "form") {
        return [];
      }

      const available = collectTemplateAvailableControlIdents(document, facts, index);
      const values = toDisplayControlIdents(available, facts);
      return asValueItems(values, vscode.CompletionItemKind.Reference);
    }

    if ((tag === "using" || tag === "include" || tag === "useprimitive") && (attr === "feature" || attr === "component" || attr === "name" || attr === "primitive")) {
      return asValueItems(sortedComponentKeys(index), vscode.CompletionItemKind.File);
    }

    if ((tag === "using" || tag === "include") && (attr === "section" || attr === "contribution")) {
      const componentKey = ctx.usingComponentInTag ? normalizeComponentKey(ctx.usingComponentInTag) : undefined;
      if (!componentKey) {
        return [];
      }

      const component = resolveComponentByKey(index, componentKey);
      if (!component) {
        return [];
      }

      return buildContributionValueItems(component, facts.rootTag);
    }

    if ((tag === "using" || tag === "include" || tag === "section" || tag === "contribution" || tag === "sectionoverride") && attr === "root") {
      return asValueItems(["Form", "WorkFlow", "DataView", "Filter", "View", "Dashboard", "Component"], vscode.CompletionItemKind.EnumMember);
    }

    if ((tag === "using" || tag === "include" || tag === "section" || tag === "contribution" || tag === "sectionoverride") && attr === "allowmultipleinserts") {
      return asValueItems(["true", "false"], vscode.CompletionItemKind.EnumMember);
    }

    if ((tag === "using" || tag === "include") && attr === "insert") {
      return asValueItems(INSERT_MODES, vscode.CompletionItemKind.EnumMember);
    }

    if (tag === "useprimitive" && (attr === "template" || attr === "contribution" || attr === "section")) {
      const componentKey = ctx.usingComponentInTag ? normalizeComponentKey(ctx.usingComponentInTag) : undefined;
      if (!componentKey) {
        return [];
      }

      const component = resolveComponentByKey(index, componentKey);
      if (!component) {
        return [];
      }

      const primitives = [...component.contributions].sort((a, b) => a.localeCompare(b));
      return asValueItems(primitives, vscode.CompletionItemKind.Reference);
    }

    if (attr === "ident") {
      if (facts.rootTag?.toLowerCase() === "workflow") {
        const symbolKind = resolveWorkflowIdentCompletionKind(tag, ctx.currentTagFragment, ctx.formControlTypeInTag);
        if (symbolKind) {
          const values = collectCompletionSymbolValues(symbolKind, {
            facts,
            index,
            composition: documentComposition,
            resolveOwningForm: this.resolveOwningForm
          });
          return asValueItems(values, vscode.CompletionItemKind.Reference);
        }
      }
    }

    if (tag === "mapping" && attr === "fromident") {
      const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow"
        ? facts.workflowFormIdent
        : facts.formIdent ?? facts.rootFormIdent;
      const owningForm = owningFormIdent ? index.formsByIdent.get(owningFormIdent) : undefined;
      if (!owningForm) {
        return [];
      }

      if (facts.rootTag?.toLowerCase() === "workflow") {
        const values = collectCompletionSymbolValues("workflowFormControl", {
          facts,
          index,
          composition: documentComposition,
          resolveOwningForm: this.resolveOwningForm
        });
        return asValueItems(values, vscode.CompletionItemKind.Reference);
      }

      return asValueItems([...owningForm.controls].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
    }

    if (tag === "mapping" && attr === "toident") {
      const targetFormIdent = ctx.mappingFormIdentInScope;
      const targetForm = targetFormIdent ? index.formsByIdent.get(targetFormIdent) : undefined;
      if (targetForm) {
        return asValueItems([...targetForm.controls].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
      }

      const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow"
        ? facts.workflowFormIdent
        : facts.formIdent ?? facts.rootFormIdent;
      const owningForm = owningFormIdent ? index.formsByIdent.get(owningFormIdent) : undefined;
      if (!owningForm) {
        return [];
      }

      if (facts.rootTag?.toLowerCase() === "workflow") {
        const values = collectCompletionSymbolValues("workflowFormControl", {
          facts,
          index,
          composition: documentComposition,
          resolveOwningForm: this.resolveOwningForm
        });
        return asValueItems(values, vscode.CompletionItemKind.Reference);
      }

      return asValueItems([...owningForm.controls].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
    }

    return [];
  }

  private snippetElementsForParent(parentTag: string, document: vscode.TextDocument | undefined): vscode.CompletionItem[] {
    const packageIdent = document ? readPackageIdent(document) : "Package";

    if (parentTag === "controls") {
      return [
        snippetItem(
          "text textbox",
          "TextBox",
          `<Control xsi:type="TextBoxControl" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_TEXT}|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}" IsRequired="\${4|false,true|}" $0/>`
        ),
        snippetItem(
          "textarea",
          "TextArea",
          `<Control xsi:type="TextAreaControl" Ident="$1" DataType="\${2|String,VarChar|}" Rows="\${3|3,5,8|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${4|true,false|}" IsRequired="\${5|false,true|}" $0/>`
        ),
        snippetItem(
          "drop dropdown generic",
          "DropDown (Generic)",
          `<Control xsi:type="DropDownListControl" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_LOOKUP_SINGLE}|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}" IsRequired="\${4|false,true|}"$0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}" DefaultValue="">
\t\t<Columns>
\t\t\t<Column Ident="Ident" DataBindType="Value" />
\t\t\t<Column Ident="Name" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT Ident, Name
\t\t\tFROM usr.\${5|YourSourceView|}
\t\t</SQL>
\t</DataBind>
\t<SelectedDataBind>
\t\t<Columns>
\t\t\t<Column Ident="Ident" DataBindType="Value" />
\t\t\t<Column Ident="Name" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT Ident, Name
\t\t\tFROM usr.\${5}
\t\t\tWHERE Ident = @$1
\t\t</SQL>
\t\t<Parameters>
\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$1" DataType="\${2}" />
\t\t</Parameters>
\t</SelectedDataBind>
</Control>`
        ),
        snippetItem(
          "drop dropdown account",
          "DropDown (Account)",
          `<Control xsi:type="DropDownListControl" Ident="$1" DataType="\${2|Number,Guid|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}" IsRequired="\${4|false,true|}"$0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}" DefaultValue="">
\t\t<Columns>
\t\t\t<Column Ident="ID" DataBindType="Value" />
\t\t\t<Column Ident="FullName" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT ID, FullName
\t\t\tFROM dbo.Account
\t\t\tWHERE [State] = 1
\t\t</SQL>
\t</DataBind>
\t<SelectedDataBind>
\t\t<Columns>
\t\t\t<Column Ident="ID" DataBindType="Value" />
\t\t\t<Column Ident="FullName" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT ID, FullName
\t\t\tFROM dbo.Account
\t\t\tWHERE ID = @$1
\t\t</SQL>
\t\t<Parameters>
\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$1" DataType="\${2}" />
\t\t</Parameters>
\t</SelectedDataBind>
</Control>`
        ),
        snippetItem(
          "auto autocomplete generic",
          "AutoComplete (Generic)",
          `<Control xsi:type="AutoCompleteControl" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_LOOKUP_SINGLE}|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}" IsRequired="\${4|false,true|}"$0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}">
\t\t<Columns>
\t\t\t<Column Ident="Ident" DataBindType="Value" />
\t\t\t<Column Ident="Name" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT Ident, Name
\t\t\tFROM usr.\${5|YourSourceView|}
\t\t\tWHERE Name LIKE @$1
\t\t</SQL>
\t\t<Parameters>
\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$1" DataType="String" LikeType="Both" />
\t\t</Parameters>
\t</DataBind>
\t<SelectedDataBind>
\t\t<Columns>
\t\t\t<Column Ident="Ident" DataBindType="Value" />
\t\t\t<Column Ident="Name" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT Ident, Name
\t\t\tFROM usr.\${5}
\t\t\tWHERE Ident = @$1
\t\t</SQL>
\t\t<Parameters>
\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$1" DataType="\${2}" />
\t\t</Parameters>
\t</SelectedDataBind>
</Control>`
        ),
        snippetItem(
          "auto autocomplete account",
          "AutoComplete (Account)",
          `<Control xsi:type="AutoCompleteControl" Ident="$1" DataType="\${2|Number,Guid|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}" IsRequired="\${4|false,true|}"$0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}">
\t\t<Columns>
\t\t\t<Column Ident="ID" DataBindType="Value" />
\t\t\t<Column Ident="FullName" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT ID, FullName
\t\t\tFROM dbo.Account
\t\t\tWHERE FullName LIKE @$1
\t\t\t\tAND [State] = 1
\t\t</SQL>
\t\t<Parameters>
\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$1" DataType="String" LikeType="Both" />
\t\t</Parameters>
\t</DataBind>
\t<SelectedDataBind>
\t\t<Columns>
\t\t\t<Column Ident="ID" DataBindType="Value" />
\t\t\t<Column Ident="FullName" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT ID, FullName
\t\t\tFROM dbo.Account
\t\t\tWHERE ID = @$1
\t\t</SQL>
\t\t<Parameters>
\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$1" DataType="\${2}" />
\t\t</Parameters>
\t</SelectedDataBind>
</Control>`
        ),
        snippetItem(
          "list listbox",
          "ListBox",
          `<Control xsi:type="ListBoxControl" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_LOOKUP_MULTI}|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}"$0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}">
\t\t<Columns>
\t\t\t<Column Ident="Value" DataBindType="Value"/>
\t\t\t<Column Ident="TitleResourceKey" DataBindType="Title" IsTranslate="true"/>
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT Value, TitleResourceKey
\t\t\tFROM dbo.\${4|GetWorkFlowState('YourWorkFlow')|}
\t\t</SQL>
\t</DataBind>
</Control>`
        ),
        snippetItem(
          "dual duallistbox",
          "DualListBox",
          `<Control xsi:type="DualListBoxControl" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_LOOKUP_MULTI}|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}"$0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}">
\t\t<Columns>
\t\t\t<Column Ident="ID" DataBindType="Value" />
\t\t\t<Column Ident="Name" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT ID, Name
\t\t\tFROM dbo.\${4|YourSource|}
\t\t</SQL>
\t</DataBind>
</Control>`
        ),
        snippetItem(
          "check checkbox",
          "CheckBox",
          `<Control xsi:type="CheckBoxControl" Ident="$1" DataType="\${2|Bool,Number,String|}" TitleResourceKey="$1_${packageIdent}" LabelPlacementType="\${3|Right,Left,Top,Bottom|}" Default="\${4|1,0|}" IsReadOnly="\${5|true,false|}" $0/>`
        ),
        snippetItem(
          "hidden",
          "HiddenControl",
          `<Control xsi:type="HiddenControl" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_ALL}|}" IsRequired="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "subform",
          "SubFormControl",
          `<Control xsi:type="SubFormControl" Ident="$1" FormIdent="$2" DataType="\${3|Number,String,Guid|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${4|true,false|}" $0/>`
        ),
        snippetItem(
          "datagrid",
          "DataGridControl",
          `<Control xsi:type="DataGridControl" Ident="$1DataGrid" FormIdent="$2" DataType="\${3|Number,String,Guid|}" TitleResourceKey="$1DataGrid_${packageIdent}" IsReadOnly="\${4|true,false|}" $0/>`
        ),
        snippetItem(
          "timeline",
          "TimeLineControl",
          `<Control xsi:type="TimeLineControl" Ident="$1" DataType="String" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${2|true,false|}" $0/>`
        ),
        snippetItem(
          "switch",
          "SwitchControl",
          `<Control xsi:type="SwitchControl" Ident="$1" DataType="\${2|Bool,Number,String|}" TitleResourceKey="$1_${packageIdent}" Default="\${3|1,0|}" IsReadOnly="\${4|true,false|}" $0/>`
        ),
        snippetItem(
          "file",
          "FileControl",
          `<Control xsi:type="FileControl" Ident="$1" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${2|true,false|}" $0/>`
        ),
        snippetItem(
          "filegallery",
          "FileGalleryControl",
          `<Control xsi:type="FileGalleryControl" Ident="$1Files" DataType="\${2|StringList,NumberList,Guid|}" TitleResourceKey="$1Files_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "richtext",
          "RichTextBoxControl",
          `<Control xsi:type="RichTextBoxControl" Ident="$1" DataType="\${2|String,VarChar|}" Height="\${3|200,300,400|}" EnterType="\${4|P,BR|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${5|true,false|}" $0/>`
        ),
        snippetItem(
          "tag",
          "TagControl",
          `<Control xsi:type="TagControl" Ident="$1Tags" DataType="\${2|StringList,VarCharList|}" TitleResourceKey="$1Tags_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "password",
          "PasswordControl",
          `<Control xsi:type="PasswordControl" Ident="$1" DataType="\${2|String,VarChar|}" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "checkboxlist",
          "CheckBoxListControl",
          `<Control xsi:type="CheckBoxListControl" Ident="$1Options" DataType="\${2|NumberList,StringList,VarCharList,SmallNumberList|}" TitleResourceKey="$1Options_${packageIdent}" IsReadOnly="\${3|true,false|}" $0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}">
\t\t<Columns>
\t\t\t<Column Ident="Value" DataBindType="Value" />
\t\t\t<Column Ident="Name" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT ID AS Value, Name
\t\t\tFROM dbo.\${4|YourSource|}
\t\t</SQL>
\t</DataBind>
</Control>`
        ),
        snippetItem(
          "radiobuttonlist",
          "RadioButtonListControl",
          `<Control xsi:type="RadioButtonListControl" Ident="$1Option" DataType="\${2|Number,String,VarChar,Guid,SmallNumber|}" TitleResourceKey="$1Option_${packageIdent}" IsReadOnly="\${3|true,false|}" $0>
\t<DataBind DefaultTitleResourceKey="SelectValue_${packageIdent}">
\t\t<Columns>
\t\t\t<Column Ident="Value" DataBindType="Value" />
\t\t\t<Column Ident="Name" DataBindType="Title" />
\t\t</Columns>
\t\t<SQL>
\t\t\tSELECT ID AS Value, Name
\t\t\tFROM dbo.\${4|YourSource|}
\t\t</SQL>
\t</DataBind>
</Control>`
        ),
        snippetItem(
          "communication",
          "CommunicationControl",
          `<Control xsi:type="CommunicationControl" Ident="$1" Height="\${2|300,400,500|}" DataType="String" TitleResourceKey="$1_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "communicationlist",
          "CommunicationListControl",
          `<Control xsi:type="CommunicationListControl" Ident="$1List" DataType="String" TitleResourceKey="$1List_${packageIdent}" IsReadOnly="\${2|true,false|}" $0/>`
        ),
        snippetItem(
          "placeholder",
          "PlaceHolderControl",
          `<Control xsi:type="PlaceHolderControl" Ident="$1PlaceHolder" DataType="String" IsReadOnly="\${2|true,false|}" $0/>`
        ),
        snippetItem(
          "foldertree",
          "FolderTreeControl",
          `<Control xsi:type="FolderTreeControl" Ident="$1FolderTreeIdent" DataType="\${2|VarChar,Guid,String|}" TitleResourceKey="$1FolderTreeIdent_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "folderpermission",
          "FolderPermissionControl",
          `<Control xsi:type="FolderPermissionControl" Ident="$1Permission" DataType="\${2|String,VarChar,Number|}" TitleResourceKey="$1Permission_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "treeselect",
          "TreeSelectBoxControl",
          `<Control xsi:type="TreeSelectBoxControl" Ident="$1TreeIdent" DataType="\${2|VarChar,Guid,String|}" TitleResourceKey="$1TreeIdent_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "sharemainfolder",
          "ShareMainFolderControl",
          `<Control xsi:type="ShareMainFolderControl" Ident="$1ShareMainFolderIdent" DataType="\${2|VarChar,Guid,String|}" TitleResourceKey="$1ShareMainFolderIdent_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "colorpicker",
          "ColorPickerControl",
          `<Control xsi:type="ColorPickerControl" Ident="$1Color" DataType="\${2|String,VarChar|}" TitleResourceKey="$1Color_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "icon",
          "IconControl",
          `<Control xsi:type="IconControl" Ident="$1Icon" DataType="\${2|String,VarChar|}" TitleResourceKey="$1Icon_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
        ),
        snippetItem(
          "htmlcontentraw",
          "HTMLContentControl",
          `<Control xsi:type="HTMLContentControl" Ident="$1" DataType="String" IsReadOnly="\${2|true,false|}" $0/>`
        ),
        snippetItem(
          "htmlcontent",
          "HTMLContentView",
          `<Control xsi:type="HTMLContentViewControl" Ident="$1" $0/>`
        )
      ];
    }

    if (parentTag === "buttons") {
      return [
        snippetItem(
          "button",
          "FormButton",
          `<Button xsi:type="FormButton" Ident="$1Button" TitleResourceKey="$2_${packageIdent}" IsSave="\${3|true,false|}" IsVisible="\${4|true,false|}" $0/>`
        ),
        snippetItem(
          "groupbutton",
          "GroupButton",
          `<Button xsi:type="GroupButton" Ident="$1GroupButton" TitleResourceKey="$2_${packageIdent}" IsVisible="\${3|true,false|}">\n\t<Button xsi:type="FormButton" Ident="$4Button" TitleResourceKey="$5_${packageIdent}" IsSave="\${6|true,false|}" IsVisible="\${7|true,false|}" />\n</Button>$0`
        ),
        snippetItem(
          "sharecodebutton",
          "ShareCodeButton",
          `<Button xsi:type="ShareCodeButton" Ident="$1" />`
        )
      ];
    }

    if (parentTag === "controlsharecodes") {
      return [
        snippetItem(
          "controlsharecode",
          "ControlShareCode",
          `<ControlShareCode Ident="$1">\n\t<FormControl Ident="$2" IsVisible="\${3|true,false|}" />\n</ControlShareCode>$0`
        )
      ];
    }

    if (parentTag === "buttonsharecodes") {
      return [
        snippetItem(
          "buttonsharecode",
          "ButtonShareCode",
          `<ButtonShareCode Ident="$1">\n\t<Button Ident="$2Button" IsVisible="\${3|true,false|}" />\n</ButtonShareCode>$0`
        )
      ];
    }

    if (parentTag === "group") {
      return [
        snippetItem(
          "workflow-formcontrol",
          "WorkFlow FormControl",
          `<FormControl Ident="$1" IsVisible="\${2|true,false|}" $0/>`
        ),
        snippetItem(
          "workflow-button",
          "WorkFlow Button",
          `<Button Ident="$1Button" IsVisible="\${2|true,false|}" $0/>`
        ),
        snippetItem(
          "workflow-sharecodebutton",
          "WorkFlow ShareCodeButton",
          `<Button xsi:type="ShareCodeButton" Ident="$1" />`
        ),
        snippetItem(
          "workflow-section",
          "WorkFlow Section",
          `<Section Ident="$1Section" IsVisible="\${2|true,false|}" $0/>`
        )
      ];
    }

    if (parentTag === "actionsharecodes") {
      return [
        actionSnippetItem(
          "actionsharecode",
          "ActionShareCode",
          `<ActionShareCode Ident="$1ActionShareCode">\n\t<Actions>\n\t\t<Action xsi:type="ShareCode" Ident="$2" ActionStart="\${3|AfterPermission,AfterSave|}" />\n\t</Actions>\n</ActionShareCode>$0`,
          2
        )
      ];
    }

    if (
      parentTag === "globalactions" ||
      parentTag === "beforeopenactions" ||
      parentTag === "actions" ||
      parentTag === "trueactions" ||
      parentTag === "falseactions"
    ) {
      return [
        actionSnippetItem(
          "action changestate",
          "Action ChangeState",
          `<Action xsi:type="ChangeState" State="$1" ActionStart="\${2|AfterSave,AfterPermission,AfterValidation|}" $0/>`,
          1
        ),
        actionSnippetItem(
          "action changestate datasource statedatasource",
          "Action ChangeState (StateDataSource)",
          `<Action xsi:type="ChangeState" ActionStart="\${1|AfterSave,AfterPermission,AfterValidation|}">\n\t<StateDataSource>\n\t\t<SQL><![CDATA[\n\t\t\tSELECT $2\n\t\t]]></SQL>\n\t\t<Parameters>\n\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />\n\t\t</Parameters>\n\t</StateDataSource>\n</Action>$0`,
          2
        ),
        actionSnippetItem(
          "action sharecode",
          "Action ShareCode",
          `<Action xsi:type="ShareCode" Ident="$1ActionShareCode" ActionStart="\${2|AfterPermission,AfterSave,BeforeValidation|}" $0/>`,
          3
        ),
        actionSnippetItem(
          "action trigger datasource",
          "Action ActionTrigger",
          `<Action xsi:type="ActionTrigger" Ident="$1ActionTrigger" ActionStart="\${2|AfterSave,AfterPermission,AfterValidation|}">\n\t<DataSource>\n\t\t<SQL><![CDATA[\n\t\t\t$3\n\t\t]]></SQL>\n\t\t<Parameters>\n\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />\n\t\t</Parameters>\n\t</DataSource>\n</Action>$0`,
          4
        ),
        actionSnippetItem(
          "action required",
          "Action Required",
          `<Action xsi:type="Required" ActionStart="\${1|BeforeValidation,AfterValidation|}">\n\t<Idents>\n\t\t<string>$2</string>\n\t</Idents>\n</Action>$0`,
          7
        ),
        actionSnippetItem(
          "action globalvalidation",
          "Action GlobalValidation",
          `<Action xsi:type="GlobalValidation" ActionStart="BeforeValidation" ErrorMessageResourceKey="$1_Error_${packageIdent}">\n\t<Condition>\n\t\t<SQL><![CDATA[\n\t\t\tSELECT IIF($2, 1, 0)\n\t\t]]></SQL>\n\t\t<Parameters>\n\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />\n\t\t</Parameters>\n\t</Condition>\n\t<ControlIdents>\n\t\t<string>$3</string>\n\t</ControlIdents>\n</Action>$0`,
          6
        ),
        actionSnippetItem(
          "action actionvalue",
          "Action ActionValue",
          `<Action xsi:type="ActionValue" Ident="$1ActionValue" ControlIdent="$2" ActionStart="\${3|AfterValidation,AfterPermission,AfterSave|}">\n\t<DataSource>\n\t\t<SQL><![CDATA[\n\t\t\tSELECT @$4\n\t\t]]></SQL>\n\t\t<Parameters>\n\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$4" DataType="\${5|Number,String,Guid,VarChar|}" />\n\t\t</Parameters>\n\t</DataSource>\n</Action>$0`,
          5
        ),
        actionSnippetItem(
          "action setvalue",
          "Action SetValue",
          `<Action xsi:type="SetValue" Ident="$1" Value="$2" ActionStart="\${3|AfterValidation,AfterSave,AfterPermission|}" $0/>`,
          10
        ),
        actionSnippetItem(
          "action if",
          "Action IF",
          `<Action xsi:type="IF" ActionStart="\${1|AfterPermission,AfterSave,BeforeValidation|}">\n\t<Condition>\n\t\t<SQL><![CDATA[\n\t\t\tSELECT IIF($2, 1, 0)\n\t\t]]></SQL>\n\t\t<Parameters>\n\t\t\t<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />\n\t\t</Parameters>\n\t</Condition>\n\t<TrueActions>\n\t\t$0\n\t</TrueActions>\n\t<FalseActions>\n\t</FalseActions>\n</Action>`,
          11
        ),
        actionSnippetItem(
          "action communication",
          "Action Communication",
          `<Action xsi:type="Communication" ControlIdent="$1" Type="\${2|Comment,State,System|}" ActionStart="\${3|AfterSave,AfterPermission|}" $0/>`,
          8
        ),
        actionSnippetItem(
          "action email",
          "Action Email",
          `<Action xsi:type="Email" Ident="$1_Email_${packageIdent}" EmailIdent="$1_Email_${packageIdent}" SubjectResourceKey="$2Subject_Email_${packageIdent}" BodyResourceKey="$3Body_Email_${packageIdent}" ActionStart="\${4|AfterPermission,AfterSave|}" IsStopSendActionCreator="\${5|true,false|}">\n\t<Recipients>\n\t\t<Recipient RecipientType="To" SourceType="Permission" Value="$6" />\n\t</Recipients>\n</Action>$0`,
          9
        ),
        actionSnippetItem(
          "action alert",
          "Action Alert",
          `<Action xsi:type="Alert" Ident="$1_Alert_${packageIdent}" AlertIdent="$1_Alert_${packageIdent}" MessageResourceKey="$2_Alert_${packageIdent}" IconCssClass="$3" IconColor="$4" ActionStart="\${5|AfterPermission,AfterSave|}" IsStopSendActionCreator="\${6|true,false|}">\n\t<Recipients>\n\t\t<Recipient SourceType="Permission" Value="$7"/>\n\t</Recipients>\n</Action>$0`,
          9
        ),
        actionSnippetItem(
          "action clearcache",
          "Action ClearCache",
          `<Action xsi:type="ClearCache" Ident="ClearCache" ActionStart="\${1|AfterSave,AfterPermission|}">\n\t<CacheKeys>\n\t\t<string>$2</string>\n\t</CacheKeys>\n</Action>$0`,
          13
        ),
        actionSnippetItem(
          "action generateform",
          "Action GenerateForm",
          `<Action xsi:type="GenerateForm" Ident="$1GenerateForm" FormIdent="$2" ActionStart="\${3|AfterPermission,AfterSave|}" ButtonIdent="$4">\n\t<Mappings>\n\t\t<Mapping FromIdent="$5" ToIdent="$6"/>\n\t</Mappings>\n\t<DataSource>\n\t\t<SQL><![CDATA[\n\t\t\tSELECT $7\n\t\t]]></SQL>\n\t</DataSource>\n</Action>$0`,
          14
        ),
        actionSnippetItem(
          "action generatesubform",
          "Action GenerateSubForm",
          `<Action xsi:type="GenerateSubForm" ControlIdent="$1" ActionStart="\${2|BeforeValidation,AfterValidation,AfterSave|}">\n\t<Mappings>\n\t\t<Mapping FromIdent="$3" ToIdent="$4" />\n\t</Mappings>\n</Action>$0`,
          12
        )
      ];
    }

    if (parentTag === "parameters") {
      const variable = snippetItem(
        "var variable parameter",
        "VariableParameter",
        `<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_ALL}|}"$0 />`
      );
      const value = snippetItem(
        "val value parameter",
        "ValueParameter",
        `<dsp:Parameter xsi:type="dsp:ValueParameter" Ident="$1" DataType="\${2|${DATA_TYPE_CHOICE_ALL}|}" Value="$3"$0 />`
      );
      const table = snippetItem(
        "table table parameter",
        "TableParameter",
        `<dsp:Parameter xsi:type="dsp:TableParameter" Ident="$1" />$0`
      );
      const constantUser = snippetItem(
        "user usr const constant",
        "Constant UserID",
        `<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" DataType="Number" ConstantType="UserID" />$0`
      );
      constantUser.sortText = "0000_constant_userid";
      constantUser.preselect = true;
      const constantLanguage = snippetItem(
        "lan language const constant",
        "Constant LanguageID",
        `<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserLanguageID" DataType="Number" ConstantType="UserLanguageID" />$0`
      );
      const constantCulture = snippetItem(
        "culture ui const constant",
        "Constant UICultureCode",
        `<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UICultureCode" DataType="String" ConstantType="UICultureCode" />$0`
      );

      return [
        variable,
        value,
        table,
        constantUser,
        constantLanguage,
        constantCulture
      ];
    }

    return [];
  }
}

function asValueItems(values: string[], kind: vscode.CompletionItemKind): vscode.CompletionItem[] {
  return values.map((value) => {
    const item = new vscode.CompletionItem(value, kind);
    item.insertText = value;
    return item;
  });
}

function parameterConstantTypeItems(valuePrefix?: string): vscode.CompletionItem[] {
  const typed = (valuePrefix ?? "").trim().toLowerCase();
  const preferredOrder = ["UserID", "UserLanguageID", "UICultureCode"];
  const values =
    typed.startsWith("user") || typed.startsWith("usr")
      ? ["UserID"]
      : preferredOrder;

  return values.map((value, index) => {
    const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember);
    item.insertText = value;
    item.sortText = `${index.toString().padStart(3, "0")}_${value}`;
    if (value === "UserID") {
      // Prefer exact "user" typing to resolve to UserID first.
      item.filterText = "user userid";
    } else if (value === "UserLanguageID") {
      // Search primarily by "lan"/"language", not by plain "user".
      item.filterText = "lan language languageid";
    } else {
      item.filterText = "culture uiculturecode";
    }
    if (value === "UserID") {
      item.preselect = true;
    }
    return item;
  });
}

function snippetItem(trigger: string, label: string, snippet: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
  item.insertText = new vscode.SnippetString(snippet);
  item.filterText = `${label} ${trigger}`;
  item.sortText = `0_${trigger}`;
  item.detail = "SFP XML snippet";
  return item;
}

function actionSnippetItem(trigger: string, label: string, snippet: string, rank: number): vscode.CompletionItem {
  const item = snippetItem(trigger, label, snippet);
  item.sortText = `00_action_${rank.toString().padStart(2, "0")}_${trigger}`;
  return item;
}

function readPackageIdent(document: vscode.TextDocument): string {
  const text = document.getText();
  const match = /<Form\b[^>]*\bPackageIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(text);
  const value = (match?.[2] ?? match?.[3] ?? "").trim();
  if (!value.length) {
    return "Package";
  }

  const normalized = value.replace(/Package$/i, "");
  return normalized.length > 0 ? normalized : value;
}

function sortedFormIdents(index: WorkspaceIndex): string[] {
  return getAllFormIdentCandidates(index, getSystemMetadata());
}

function sortedComponentKeys(index: WorkspaceIndex): string[] {
  return [...index.componentsByKey.keys()].sort((a, b) => a.localeCompare(b));
}

function buildContributionValueItems(
  component: import("../indexer/types").IndexedComponent,
  rootTag: string | undefined
): vscode.CompletionItem[] {
  const contributions = [...component.contributionSummaries.values()]
    .sort((a, b) => a.contributionName.localeCompare(b.contributionName))
    .map((summary) => summary.contributionName);
  if (contributions.length === 0) {
    return [];
  }

  const relevant = contributions.filter((name) => {
    const summary = component.contributionSummaries.get(name);
    return summary ? contributionMatchesDocumentRoot(rootTag, summary) : false;
  });
  const filtered = contributions.filter((name) => !relevant.includes(name));
  const ordered = [...relevant, ...filtered];
  const items = asValueItems(ordered, vscode.CompletionItemKind.Reference);
  for (const item of items) {
    const summary = component.contributionSummaries.get(String(item.label));
    const isRelevant = summary ? contributionMatchesDocumentRoot(rootTag, summary) : true;
    if (!isRelevant) {
      item.detail = "Contribution (filtered by current root)";
      item.sortText = `z_${item.label}`;
    } else {
      item.sortText = `a_${item.label}`;
    }
  }

  return items;
}

function toDisplayControlIdents(available: Set<string>, facts: ReturnType<typeof parseDocumentFacts>): string[] {
  const displayByValue = new Map<string, string>();
  for (const value of available) {
    displayByValue.set(value, value);
  }

  for (const info of facts.declaredControlInfos) {
    displayByValue.set(info.ident, info.ident);
  }

  return [...displayByValue.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, display]) => display);
}

function computePlaceholderCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position
): PlaceholderCompletionContext | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const open = text.lastIndexOf("{{", offset);
  if (open < 0) {
    return undefined;
  }

  const close = text.indexOf("}}", open + 2);
  if (close < 0 || offset > close) {
    return undefined;
  }

  const bodyStart = open + 2;
  const beforeCursor = text.slice(bodyStart, offset);
  const segmentStartRel = beforeCursor.lastIndexOf(",") + 1;
  const segment = beforeCursor.slice(segmentStartRel);
  const segmentStartAbs = bodyStart + segmentStartRel;
  const colonIndex = segment.indexOf(":");
  const usedFields = parsePlaceholderFields(beforeCursor.slice(0, Math.max(0, segmentStartRel)));
  const usedKeysLower = new Set<string>();
  for (const key of usedFields.keys()) {
    usedKeysLower.add(key.toLowerCase());
  }

  if (colonIndex < 0) {
    const leading = /^\s*/.exec(segment)?.[0].length ?? 0;
    return {
      mode: "key",
      keyPrefix: segment.slice(leading),
      replaceRange: new vscode.Range(document.positionAt(segmentStartAbs + leading), position),
      fields: usedFields,
      usedKeysLower
    };
  }

  const key = segment.slice(0, colonIndex).trim();
  if (key) {
    usedFields.set(key, segment.slice(colonIndex + 1).trim());
    usedKeysLower.add(key.toLowerCase());
  }
  const valueStartAbs = segmentStartAbs + colonIndex + 1;
  const leading = /^\s*/.exec(segment.slice(colonIndex + 1))?.[0].length ?? 0;
  return {
    mode: "value",
    key,
    valuePrefix: segment.slice(colonIndex + 1 + leading),
    replaceRange: new vscode.Range(document.positionAt(valueStartAbs + leading), position),
    fields: usedFields,
    usedKeysLower
  };
}

function parsePlaceholderFields(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw.trim()) {
    return out;
  }

  for (const part of raw.split(",")) {
    const idx = part.indexOf(":");
    if (idx < 0) {
      continue;
    }

    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    out.set(key, value);
  }

  return out;
}

function computeTagContext(document: vscode.TextDocument, position: vscode.Position): TagContext {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.slice(0, offset);

  const lastLt = before.lastIndexOf("<");
  const lastGt = before.lastIndexOf(">");

  if (lastLt < 0 || lastLt < lastGt) {
    return {
      inTag: false,
      inTagName: false,
      currentTagFragment: "",
      currentAttributeNames: new Set<string>()
    };
  }

  const fragment = before.slice(lastLt);
  if (fragment.startsWith("</")) {
    return {
      inTag: true,
      inTagName: false,
      currentTagFragment: fragment,
      currentAttributeNames: new Set<string>()
    };
  }

  const nameMatch = /^<\s*([A-Za-z_][\w:.-]*)?/.exec(fragment);
  const currentTag = nameMatch?.[1];

  const inTagName = /^<\s*[A-Za-z_\w:.-]*$/.test(fragment);

  const currentAttributeNames = new Set<string>();
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(fragment)) !== null) {
    currentAttributeNames.add(attrMatch[1]);
  }

  const partialValueMatch = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)|'([^']*))$/.exec(fragment);
  const valueAttribute = partialValueMatch ? partialValueMatch[1].toLowerCase() : undefined;
  const valuePrefix = partialValueMatch ? (partialValueMatch[3] ?? partialValueMatch[4] ?? "") : undefined;

  const parentTag = getParentTag(before.slice(0, lastLt));

  const usingComponentInTag =
    extractAttributeValue(fragment, "Feature") ??
    extractAttributeValue(fragment, "Primitive") ??
    extractAttributeValue(fragment, "Component") ??
    extractAttributeValue(fragment, "Name");
  const mappingFormIdentInScope = getOpenButtonMappingFormIdent(before.slice(0, lastLt));
  const formControlTypeInTag = currentTag?.toLowerCase() === "formcontrol" ? extractAttributeValue(fragment, "xsi:type") ?? extractAttributeValue(fragment, "type") : undefined;

  return {
    inTag: true,
    inTagName,
    currentTag,
    parentTag,
    currentTagFragment: fragment,
    currentAttributeNames,
    valueAttribute,
    valuePrefix,
    usingComponentInTag,
    mappingFormIdentInScope,
    formControlTypeInTag
  };
}

function getParentTag(beforeCurrentTag: string): string | undefined {
  const stack: string[] = [];
  const tagRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(beforeCurrentTag)) !== null) {
    const isClosing = match[1] === "/";
    const name = match[2];
    const tail = match[3] ?? "";
    const selfClosing = tail.trim().endsWith("/");

    if (isClosing) {
      popFromStack(stack, name);
      continue;
    }

    if (!selfClosing) {
      stack.push(name);
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

function popFromStack(stack: string[], name: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].toLowerCase() === name.toLowerCase()) {
      stack.splice(i, 1);
      return;
    }
  }
}

function extractAttributeValue(tagFragment: string, attributeName: string): string | undefined {
  const escaped = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = regex.exec(tagFragment);
  if (!match) {
    return undefined;
  }

  return (match[2] ?? match[3] ?? "").trim();
}

function resolveWorkflowIdentCompletionKind(
  tag: string,
  currentTagFragment: string,
  formControlTypeInTag?: string
): CompletionSymbolKind | undefined {
  if (tag === "action") {
    const actionType = (extractAttributeValue(currentTagFragment, "xsi:type") ?? extractAttributeValue(currentTagFragment, "type") ?? "").toLowerCase();
    if (actionType === "sharecode") {
      return "workflowActionShareCode";
    }
  }

  if (tag === "formcontrol") {
    if ((formControlTypeInTag ?? "").toLowerCase() === "sharecodecontrol") {
      return "workflowControlShareCode";
    }
    return "workflowFormControl";
  }

  if (tag === "button") {
    const buttonType = (extractAttributeValue(currentTagFragment, "xsi:type") ?? extractAttributeValue(currentTagFragment, "type") ?? "").toLowerCase();
    if (buttonType === "sharecodebutton") {
      return "workflowButtonShareCode";
    }
    return "workflowFormButton";
  }

  if (tag === "section") {
    return "workflowFormSection";
  }

  return undefined;
}

function getOpenButtonMappingFormIdent(beforeCurrentTag: string): string | undefined {
  const stack: Array<string | undefined> = [];
  const tagRegex = /<\s*(\/?)\s*Button\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(beforeCurrentTag)) !== null) {
    const isClosing = match[1] === "/";
    const attrs = match[2] ?? "";
    const selfClosing = attrs.trim().endsWith("/");

    if (isClosing) {
      stack.pop();
      continue;
    }

    const mappingFormIdent = extractAttributeValue(attrs, "MappingFormIdent");
    if (!selfClosing) {
      stack.push(mappingFormIdent);
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

function getActiveAttributeValuePrefixAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  attributeName: string
): string | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.slice(0, offset);
  const lastLt = before.lastIndexOf("<");
  const lastGt = before.lastIndexOf(">");
  if (lastLt < 0 || lastLt < lastGt) {
    return undefined;
  }

  const fragment = before.slice(lastLt);
  if (fragment.startsWith("</")) {
    return undefined;
  }

  const escaped = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*(\"([^\"]*)|'([^']*))$`, "i");
  const match = regex.exec(fragment);
  if (!match) {
    return undefined;
  }

  return (match[2] ?? match[3] ?? "").trim();
}

interface RequiredActionStringContext {
  replaceRange: vscode.Range;
}

function computeRequiredActionStringContext(
  document: vscode.TextDocument,
  position: vscode.Position
): RequiredActionStringContext | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);

  const openStringStart = text.lastIndexOf("<string", offset);
  if (openStringStart < 0) {
    return undefined;
  }

  const openStringEnd = text.indexOf(">", openStringStart);
  if (openStringEnd < 0 || offset <= openStringEnd) {
    return undefined;
  }

  const closeStringStart = text.indexOf("</string>", openStringEnd);
  if (closeStringStart < 0 || offset > closeStringStart) {
    return undefined;
  }

  const stack = computeOpenTagStack(text.slice(0, openStringStart));
  const identsIndex = findNearestTagIndex(stack, "idents");
  if (identsIndex < 0) {
    return undefined;
  }

  const actionIndex = findNearestTagIndex(stack.slice(0, identsIndex), "action");
  if (actionIndex < 0) {
    return undefined;
  }

  const actionAttrs = stack[actionIndex].attrs;
  const actionType = (extractAttributeValue(actionAttrs, "xsi:type") ?? extractAttributeValue(actionAttrs, "type") ?? "").toLowerCase();
  if (actionType !== "required") {
    return undefined;
  }

  const textNodeStart = openStringEnd + 1;
  const textNodeEnd = closeStringStart;
  const clampedOffset = Math.max(textNodeStart, Math.min(offset, textNodeEnd));

  let replaceStart = clampedOffset;
  while (replaceStart > textNodeStart && /\S/.test(text[replaceStart - 1])) {
    replaceStart--;
  }

  let replaceEnd = clampedOffset;
  while (replaceEnd < textNodeEnd && /\S/.test(text[replaceEnd])) {
    replaceEnd++;
  }

  return {
    replaceRange: new vscode.Range(document.positionAt(replaceStart), document.positionAt(replaceEnd))
  };
}

interface OpenTagStackEntry {
  name: string;
  attrs: string;
  openStart: number;
  openEnd: number;
}

function computeOpenTagStack(input: string): OpenTagStackEntry[] {
  const stack: OpenTagStackEntry[] = [];
  const tagRegex = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(input)) !== null) {
    const isClosing = match[1] === "/";
    const name = match[2];
    const attrs = match[3] ?? "";
    const selfClosing = attrs.trim().endsWith("/");

    if (isClosing) {
      popFromOpenTagStack(stack, name);
      continue;
    }

    if (!selfClosing) {
      const openStart = match.index;
      const openEnd = openStart + match[0].length;
      stack.push({ name, attrs, openStart, openEnd });
    }
  }

  return stack;
}

interface SqlParameterCompletionContext {
  replaceRange: vscode.Range;
  identifiers: string[];
  typedIdent: string;
  typedValueLiteral?: string;
  sqlRegion: XmlTagBlockRegion;
  parametersRegion?: XmlTagBlockRegion;
}

interface XmlTagBlockRegion {
  name: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

function computeSqlParameterContext(
  document: vscode.TextDocument,
  position: vscode.Position
): SqlParameterCompletionContext | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const sqlRegion = findEnclosingSqlRegion(text, offset);
  if (!sqlRegion) {
    return undefined;
  }

  const beforeCursor = text.slice(sqlRegion.openEnd, offset);
  const parsedExpr = parseSqlParameterExpression(beforeCursor);
  if (!parsedExpr) {
    return undefined;
  }

  const typedPart = parsedExpr.ident;
  const typedValueLiteral = parsedExpr.valueLiteral;
  const wholeExpr = parsedExpr.wholeExpression;
  const replaceStart = offset - (wholeExpr.length - 1);

  const stack = computeOpenTagStack(text.slice(0, sqlRegion.openStart));
  const parent = findNearestNonSqlParent(stack);
  if (!parent) {
    return undefined;
  }

  const parentCloseStart = findClosingTagStart(text, parent.name, parent.openEnd);
  if (parentCloseStart === undefined || parentCloseStart <= parent.openEnd) {
    return undefined;
  }

  const parentContent = text.slice(parent.openEnd, parentCloseStart);
  const parametersRegion = findParametersRegion(text, parent.openEnd, parentCloseStart, sqlRegion.closeEnd);
  const identifiers = parametersRegion
    ? collectParameterIdents(text.slice(parametersRegion.openEnd, parametersRegion.closeStart))
    : collectParameterIdents(parentContent);

  return {
    replaceRange: new vscode.Range(document.positionAt(replaceStart), document.positionAt(offset)),
    identifiers,
    typedIdent: typedPart,
    typedValueLiteral,
    sqlRegion,
    parametersRegion
  };
}

function parseSqlParameterExpression(beforeCursor: string): { ident: string; valueLiteral?: string; wholeExpression: string } | undefined {
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) {
    return undefined;
  }

  const tail = beforeCursor.slice(atIndex);
  const match = /^@([A-Za-z_][\w]*)?(?:==([^\s<>"']*))?$/.exec(tail);
  if (!match) {
    return undefined;
  }

  const ident = match[1] ?? "";
  const valueLiteral = match[2] ?? undefined;

  return {
    ident,
    valueLiteral,
    wholeExpression: match[0]
  };
}

function appendSqlParameterItems(
  document: vscode.TextDocument,
  context: SqlParameterCompletionContext
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  const existing = new Set(context.identifiers);
  const typed = context.typedIdent.trim();

  if (isParameterIdent(typed) && !existing.has(typed)) {
    const variableItem = new vscode.CompletionItem(`@${typed} append as VariableParameter`, vscode.CompletionItemKind.Snippet);
    variableItem.insertText = typed;
    variableItem.range = context.replaceRange;
    variableItem.filterText = buildSqlAppendFilterText(typed, context.typedValueLiteral);
    variableItem.detail = "Append to <Parameters>";
    variableItem.sortText = `z1_${typed}`;
    variableItem.command = { command: SUPPRESS_SQL_SUGGEST_COMMAND, title: "Suppress SQL suggest once" };
    const variableEdit = createSqlParameterAppendEdit(document, context, buildVariableParameterLine(typed));
    if (variableEdit) {
      variableItem.additionalTextEdits = [variableEdit];
      items.push(variableItem);
    }

    const parsedValue = parseValueLiteral(context.typedValueLiteral);
    const valuePreview =
      context.typedValueLiteral !== undefined
        ? ` Value="${escapeXmlAttribute(parsedValue.value)}" (${parsedValue.dataType})`
        : "";
    const valueItem = new vscode.CompletionItem(`@${typed} append as ValueParameter${valuePreview}`, vscode.CompletionItemKind.Snippet);
    valueItem.insertText = typed;
    valueItem.range = context.replaceRange;
    valueItem.filterText = buildSqlAppendFilterText(typed, context.typedValueLiteral);
    valueItem.detail = "Append to <Parameters>";
    valueItem.sortText = `z2_${typed}`;
    valueItem.command = { command: SUPPRESS_SQL_SUGGEST_COMMAND, title: "Suppress SQL suggest once" };
    const valueEdit = createSqlParameterAppendEdit(
      document,
      context,
      buildValueParameterLine(typed, parsedValue.value, parsedValue.dataType)
    );
    if (valueEdit) {
      valueItem.additionalTextEdits = [valueEdit];
      items.push(valueItem);
    }
  }

  const typedLower = typed.toLowerCase();
  for (const constant of SQL_CONSTANT_PARAMETERS) {
    if (existing.has(constant.ident)) {
      continue;
    }

    if (typedLower.length > 0 && !constant.ident.toLowerCase().startsWith(typedLower)) {
      continue;
    }

    const item = new vscode.CompletionItem(`@${constant.ident} append as ConstantType`, vscode.CompletionItemKind.Snippet);
    item.insertText = constant.ident;
    item.range = context.replaceRange;
    item.filterText = buildSqlAppendFilterText(constant.ident, context.typedValueLiteral);
    item.detail = "Append to <Parameters>";
    item.sortText = `z0_${constant.ident}`;
    item.command = { command: SUPPRESS_SQL_SUGGEST_COMMAND, title: "Suppress SQL suggest once" };
    const edit = createSqlParameterAppendEdit(document, context, buildConstantParameterLine(constant.ident, constant.dataType, constant.constantType));
    if (edit) {
      item.additionalTextEdits = [edit];
      items.push(item);
    }
  }

  return items;
}

function findParametersRegion(
  text: string,
  parentOpenEnd: number,
  parentCloseStart: number,
  anchorOffset: number
): XmlTagBlockRegion | undefined {
  const segment = text.slice(parentOpenEnd, parentCloseStart);
  const openRegex = /<\s*((?:[A-Za-z_][\w.-]*:)?Parameters)\b[^>]*>/gi;
  const regions: XmlTagBlockRegion[] = [];
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(segment)) !== null) {
    const name = match[1];
    const openStart = parentOpenEnd + match.index;
    const openEnd = openStart + match[0].length;
    const closeStart = findClosingTagStart(text, name, openEnd);
    if (closeStart === undefined || closeStart > parentCloseStart) {
      continue;
    }

    const closeTagRegex = new RegExp(`<\\s*\\/\\s*${escapeRegex(name)}\\s*>`, "i");
    const closeMatch = closeTagRegex.exec(text.slice(closeStart));
    if (!closeMatch) {
      continue;
    }

    const closeEnd = closeStart + closeMatch[0].length;
    regions.push({ name, openStart, openEnd, closeStart, closeEnd });
  }

  if (regions.length === 0) {
    return undefined;
  }

  const afterAnchor = regions
    .filter((r) => r.openStart >= anchorOffset)
    .sort((a, b) => a.openStart - b.openStart);
  if (afterAnchor.length > 0) {
    return afterAnchor[0];
  }

  return regions.sort((a, b) => b.openStart - a.openStart)[0];
}

function createSqlParameterAppendEdit(
  document: vscode.TextDocument,
  context: SqlParameterCompletionContext,
  parameterLine: string
): vscode.TextEdit | undefined {
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  if (context.parametersRegion) {
    const closePos = document.positionAt(context.parametersRegion.closeStart);
    const insertPos = document.lineAt(closePos.line).range.start;
    const parameterIndent = detectParameterIndent(document, context.parametersRegion);
    return vscode.TextEdit.insert(insertPos, `${parameterIndent}${parameterLine}${eol}`);
  }

  const insertPos = document.positionAt(context.sqlRegion.closeEnd);
  const parentIndent = lineIndentAtOffset(document, context.sqlRegion.openStart);
  const indentUnit = detectIndentUnit(document);
  const parameterIndent = `${parentIndent}${indentUnit}`;
  const newBlock =
    `${eol}${parentIndent}<Parameters>${eol}` +
    `${parameterIndent}${parameterLine}${eol}` +
    `${parentIndent}</Parameters>`;
  return vscode.TextEdit.insert(insertPos, newBlock);
}

function detectParameterIndent(document: vscode.TextDocument, region: XmlTagBlockRegion): string {
  const inside = document.getText(new vscode.Range(document.positionAt(region.openEnd), document.positionAt(region.closeStart)));
  const existingMatch = /(?:^|\r?\n)([ \t]*)<\s*(?:[A-Za-z_][\w.-]*:)?Parameter\b/m.exec(inside);
  if (existingMatch) {
    return existingMatch[1];
  }

  const closingIndent = lineIndentAtOffset(document, region.closeStart);
  return `${closingIndent}${detectIndentUnit(document)}`;
}

function lineIndentAtOffset(document: vscode.TextDocument, offset: number): string {
  const position = document.positionAt(offset);
  const line = document.lineAt(position.line).text;
  const match = /^([ \t]*)/.exec(line);
  return match?.[1] ?? "";
}

function detectIndentUnit(document: vscode.TextDocument): string {
  const editor =
    vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === document.uri.toString()) ??
    vscode.window.activeTextEditor;
  const options = editor?.options;
  if (options?.insertSpaces) {
    const size = typeof options.tabSize === "number" ? options.tabSize : 2;
    return " ".repeat(Math.max(1, size));
  }

  return "\t";
}

function isParameterIdent(value: string): boolean {
  return /^[A-Za-z_][\w]*$/.test(value);
}

function buildVariableParameterLine(ident: string): string {
  return `<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="${ident}" DataType="String" />`;
}

function buildConstantParameterLine(ident: string, dataType: string, constantType: string): string {
  return `<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="${ident}" DataType="${dataType}" ConstantType="${constantType}" />`;
}

function buildValueParameterLine(ident: string, value: string, dataType: "Number" | "String"): string {
  return `<dsp:Parameter xsi:type="dsp:ValueParameter" Ident="${ident}" DataType="${dataType}" Value="${escapeXmlAttribute(value)}" />`;
}

function parseValueLiteral(literal: string | undefined): { value: string; dataType: "Number" | "String" } {
  const raw = (literal ?? "").trim();
  if (!raw) {
    return { value: "", dataType: "String" };
  }

  if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    return { value: raw.replace(",", "."), dataType: "Number" };
  }

  return { value: raw, dataType: "String" };
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildSqlAppendFilterText(ident: string, valueLiteral?: string): string {
  const base = `@${ident}`;
  const baseLower = `@${ident.toLowerCase()}`;
  const plain = ident;
  const plainLower = ident.toLowerCase();
  const value = (valueLiteral ?? "").trim();
  if (!value) {
    return `${base} ${baseLower} ${plain} ${plainLower}`;
  }

  return `${base} ${baseLower} ${plain} ${plainLower} ${base}==${value} ${baseLower}==${value.toLowerCase()} ${plain}==${value} ${plainLower}==${value.toLowerCase()} ${value} ${value.toLowerCase()}`;
}

function buildCaseInsensitiveSqlFilterText(ident: string): string {
  const base = `@${ident}`;
  return `${base} @${ident.toLowerCase()} ${ident} ${ident.toLowerCase()}`;
}

function findEnclosingSqlRegion(text: string, offset: number): XmlTagBlockRegion | undefined {
  const openRegex = /<\s*((?:[A-Za-z_][\w.-]*:)?(?:SQL|Command))\b[^>]*>/gi;
  let best: XmlTagBlockRegion | undefined;
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(text)) !== null) {
    const name = match[1];
    const openStart = match.index;
    const openEnd = openStart + match[0].length;
    if (offset < openEnd) {
      continue;
    }

    const closingRegex = new RegExp(`<\\s*\\/\\s*${escapeRegex(name)}\\s*>`, "gi");
    closingRegex.lastIndex = openEnd;
    const close = closingRegex.exec(text);
    if (!close) {
      continue;
    }

    const closeStart = close.index;
    const closeEnd = closeStart + close[0].length;
    if (offset > closeStart) {
      continue;
    }

    if (!best || openStart > best.openStart) {
      best = { name, openStart, openEnd, closeStart, closeEnd };
    }
  }

  return best;
}

function findNearestNonSqlParent(stack: OpenTagStackEntry[]): OpenTagStackEntry | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const name = stripPrefix(stack[i].name).toLowerCase();
    if (name === "sql" || name === "command") {
      continue;
    }

    return stack[i];
  }

  return undefined;
}

function findClosingTagStart(text: string, tagName: string, searchFrom: number): number | undefined {
  const regex = new RegExp(`<\\s*(\\/?)\\s*${escapeRegex(tagName)}\\b([^>]*)>`, "gi");
  regex.lastIndex = searchFrom;

  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const isClosing = match[1] === "/";
    const attrs = match[2] ?? "";
    const selfClosing = !isClosing && attrs.trim().endsWith("/");

    if (selfClosing) {
      continue;
    }

    if (isClosing) {
      depth--;
      if (depth === 0) {
        return match.index;
      }
    } else {
      depth++;
    }
  }

  return undefined;
}

function collectParameterIdents(xmlSegment: string): string[] {
  const out = new Set<string>();
  const regex = /<\s*(?:[A-Za-z_][\w.-]*:)?Parameter\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlSegment)) !== null) {
    const ident = extractAttributeValue(match[1] ?? "", "Ident");
    if (ident) {
      out.add(ident);
    }
  }

  return [...out].sort((a, b) => a.localeCompare(b));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripPrefix(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function popFromOpenTagStack(stack: OpenTagStackEntry[], closingName: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name.toLowerCase() === closingName.toLowerCase()) {
      stack.splice(i, 1);
      return;
    }
  }
}

function findNearestTagIndex(stack: OpenTagStackEntry[], name: string): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name.toLowerCase() === name.toLowerCase()) {
      return i;
    }
  }

  return -1;
}
