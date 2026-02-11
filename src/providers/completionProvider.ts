import * as vscode from "vscode";
import { WorkspaceIndex } from "../indexer/types";
import { resolveComponentByKey } from "../indexer/componentResolve";
import { parseDocumentFacts } from "../indexer/xmlFacts";
import { documentInConfiguredRoots, normalizeComponentKey } from "../utils/paths";
import { collectTemplateAvailableControlIdents } from "../utils/templateControls";
import { collectResolvableControlIdents } from "../utils/controlIdents";

type IndexAccessor = (uri?: vscode.Uri) => WorkspaceIndex;

const ROOT_ELEMENTS = ["Form", "WorkFlow", "DataView", "Filter", "Dashboard", "Configuration", "Component"];

const CHILD_ELEMENTS: Record<string, string[]> = {
  form: ["Buttons", "Controls", "Sections", "Components", "Usings", "Using", "DataPermissions", "CreatePermissions", "AccessPermissions", "DenyPermissions"],
  workflow: ["Definition", "Steps", "GlobalActions", "GlobalJavaScripts", "ActionShareCodes", "ButtonShareCodes", "ControlShareCodes", "Usings", "Using"],
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
  using: ["SectionOverride"],
  component: ["AccessPermissions", "DenyPermissions", "PackageIdents", "CssRelativePaths", "JavaScriptRelativePaths", "Setting", "Sections"]
};

const ATTRIBUTES_BY_TAG: Record<string, string[]> = {
  form: ["Ident", "SegmentType", "PackageIdent", "Title", "TitleResourceKey", "FormType"],
  workflow: ["Ident", "FormIdent", "StartState", "DeleteState"],
  control: [
    "xsi:type",
    "Ident",
    "DataType",
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
  using: ["Component", "Name", "Section"],
  sectionoverride: ["Name", "TargetXPath", "Insert", "Root"],
  state: ["Value", "Title", "TitleResourceKey", "ColorCssClass"],
  action: ["xsi:type", "Ident", "State", "ActionStart"]
  ,
  javascript: ["xsi:type", "Ident", "ControlIdent", "ActionStart"],
  mapping: ["FromIdent", "ToIdent"],
  datasource: ["Ident", "FormIdent"]
  ,
  controllabel: ["ControlID"],
  htmllabel: ["ControlID"],
  controlplaceholder: ["ControlID"]
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

interface TagContext {
  inTag: boolean;
  inTagName: boolean;
  currentTag?: string;
  parentTag?: string;
  currentTagFragment: string;
  currentAttributeNames: Set<string>;
  valueAttribute?: string;
  usingComponentInTag?: string;
  mappingFormIdentInScope?: string;
  formControlTypeInTag?: string;
}

export class SfpXmlCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getIndex: IndexAccessor) {}

  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
    if (!documentInConfiguredRoots(document)) {
      return undefined;
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
      return this.completeAttributeValues(document, ctx);
    }

    if (ctx.currentTag) {
      return this.completeAttributes(document, ctx.currentTag, ctx.currentAttributeNames);
    }

    return undefined;
  }

  private completeRequiredActionIdents(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const requiredContext = computeRequiredActionStringContext(document, position);
    if (!requiredContext) {
      return [];
    }

    const facts = parseDocumentFacts(document);
    const index = this.getIndex(document.uri);
    const values = [...collectResolvableControlIdents(document, facts, index)].sort((a, b) => a.localeCompare(b));
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

  private completeAttributes(_document: vscode.TextDocument, tagName: string, alreadyPresent: Set<string>): vscode.CompletionItem[] {
    const attrs = ATTRIBUTES_BY_TAG[tagName.toLowerCase()] ?? [];
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

  private async completeAttributeValues(document: vscode.TextDocument, ctx: TagContext): Promise<vscode.CompletionItem[]> {
    const facts = parseDocumentFacts(document);
    const index = this.getIndex(document.uri);
    const tag = (ctx.currentTag ?? "").toLowerCase();
    const attr = ctx.valueAttribute;

    if (!attr) {
      return [];
    }

    if (attr === "xsi:type" || attr === "type") {
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

    if (attr === "colorcssclass") {
      return asValueItems(COLOR_CSS, vscode.CompletionItemKind.EnumMember);
    }

    if (attr === "actionstart") {
      return asValueItems(ACTION_START_TYPES, vscode.CompletionItemKind.EnumMember);
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

      const values = [...collectResolvableControlIdents(document, facts, index)].sort((a, b) => a.localeCompare(b));
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

    if (tag === "using" && (attr === "component" || attr === "name")) {
      return asValueItems(sortedComponentKeys(index), vscode.CompletionItemKind.File);
    }

    if (tag === "using" && attr === "section") {
      const componentKey = ctx.usingComponentInTag ? normalizeComponentKey(ctx.usingComponentInTag) : undefined;
      if (!componentKey) {
        return [];
      }

      const component = resolveComponentByKey(index, componentKey);
      if (!component) {
        return [];
      }

      const sections = [...component.sections].sort((a, b) => a.localeCompare(b));
      return asValueItems(sections, vscode.CompletionItemKind.Reference);
    }

    if (attr === "ident") {
      if (facts.rootTag?.toLowerCase() === "workflow") {
        if (tag === "button") {
          const buttonType = extractAttributeValue(ctx.currentTagFragment, "xsi:type") ?? extractAttributeValue(ctx.currentTagFragment, "type");
          if ((buttonType ?? "").toLowerCase() === "sharecodebutton") {
            const values = collectWorkflowButtonShareCodeIdents(facts, index);
            return asValueItems(values, vscode.CompletionItemKind.Reference);
          }
        }

        if (tag === "formcontrol") {
          if ((ctx.formControlTypeInTag ?? "").toLowerCase() === "sharecodecontrol") {
            const values = collectWorkflowControlShareCodeIdents(facts, index);
            return asValueItems(values, vscode.CompletionItemKind.Reference);
          }

          const formIdent = facts.workflowFormIdent;
          if (!formIdent) {
            return [];
          }

          const form = index.formsByIdent.get(formIdent);
          if (!form) {
            return [];
          }

          return asValueItems([...form.controls].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
        }

        const formIdent = facts.workflowFormIdent;
        if (!formIdent) {
          return [];
        }

        const form = index.formsByIdent.get(formIdent);
        if (!form) {
          return [];
        }

        if (tag === "button") {
          return asValueItems([...form.buttons].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
        }

        if (tag === "section") {
          return asValueItems([...form.sections].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
        }
      }
    }

    if (tag === "mapping" && attr === "fromident") {
      const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow" ? facts.workflowFormIdent : facts.formIdent;
      const owningForm = owningFormIdent ? index.formsByIdent.get(owningFormIdent) : undefined;
      if (!owningForm) {
        return [];
      }

      return asValueItems([...owningForm.controls].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
    }

    if (tag === "mapping" && attr === "toident") {
      const targetFormIdent = ctx.mappingFormIdentInScope;
      const targetForm = targetFormIdent ? index.formsByIdent.get(targetFormIdent) : undefined;
      if (targetForm) {
        return asValueItems([...targetForm.controls].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
      }

      const owningFormIdent = facts.rootTag?.toLowerCase() === "workflow" ? facts.workflowFormIdent : facts.formIdent;
      const owningForm = owningFormIdent ? index.formsByIdent.get(owningFormIdent) : undefined;
      if (!owningForm) {
        return [];
      }

      return asValueItems([...owningForm.controls].sort((a, b) => a.localeCompare(b)), vscode.CompletionItemKind.Reference);
    }

    return [];
  }

  private snippetElementsForParent(parentTag: string, document: vscode.TextDocument | undefined): vscode.CompletionItem[] {
    if (parentTag === "controls") {
      const packageIdent = document ? readPackageIdent(document) : "Package";
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
          `<Control xsi:type="FileControl" Ident="$1FileID" DataType="\${2|Number,Guid,String|}" TitleResourceKey="$1FileID_${packageIdent}" IsReadOnly="\${3|true,false|}" $0/>`
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
          `<Button xsi:type="FormButton" Ident="$1Button" TitleResourceKey="$2" IsSave="\${3|true,false|}" IsVisible="\${4|true,false|}" $0/>`
        ),
        snippetItem(
          "groupbutton",
          "GroupButton",
          `<Button xsi:type="GroupButton" Ident="$1GroupButton" TitleResourceKey="$2" IsVisible="\${3|true,false|}">\n\t<Button xsi:type="FormButton" Ident="$4Button" TitleResourceKey="$5" IsSave="\${6|true,false|}" IsVisible="\${7|true,false|}" />\n</Button>$0`
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

function snippetItem(trigger: string, label: string, snippet: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
  item.insertText = new vscode.SnippetString(snippet);
  item.filterText = `${label} ${trigger}`;
  item.sortText = `0_${trigger}`;
  item.detail = "SFP XML snippet";
  return item;
}

function readPackageIdent(document: vscode.TextDocument): string {
  const text = document.getText();
  const match = /<Form\b[^>]*\bPackageIdent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(text);
  const value = (match?.[2] ?? match?.[3] ?? "").trim();
  return value.length > 0 ? value : "Package";
}

function sortedFormIdents(index: WorkspaceIndex): string[] {
  return [...index.formsByIdent.values()]
    .map((v) => v.ident)
    .sort((a, b) => a.localeCompare(b));
}

function sortedComponentKeys(index: WorkspaceIndex): string[] {
  return [...index.componentsByKey.keys()].sort((a, b) => a.localeCompare(b));
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

  const parentTag = getParentTag(before.slice(0, lastLt));

  const usingComponentInTag = extractAttributeValue(fragment, "Component") ?? extractAttributeValue(fragment, "Name");
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

function collectWorkflowControlShareCodeIdents(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): string[] {
  const values = new Set<string>(facts.declaredControlShareCodes);
  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const key of component.workflowControlShareCodeDefinitions.keys()) {
      values.add(key);
    }
  }

  return [...values].sort((a, b) => a.localeCompare(b));
}

function collectWorkflowButtonShareCodeIdents(
  facts: ReturnType<typeof parseDocumentFacts>,
  index: WorkspaceIndex
): string[] {
  const values = new Set<string>(facts.declaredButtonShareCodes);
  for (const usingRef of facts.usingReferences) {
    const component = resolveComponentByKey(index, usingRef.componentKey);
    if (!component) {
      continue;
    }

    for (const key of component.workflowButtonShareCodeDefinitions.keys()) {
      values.add(key);
    }
  }

  return [...values].sort((a, b) => a.localeCompare(b));
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
      stack.push({ name, attrs });
    }
  }

  return stack;
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
