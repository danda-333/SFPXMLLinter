export interface BuiltinHoverDocEntry {
  tag?: string;
  attribute?: string;
  value?: string;
  summary: string;
  details?: string;
}

// Built-in defaults based on SFPDocs, used as fallback when no external hover docs are available.
export const BUILTIN_HOVER_DOCS: BuiltinHoverDocEntry[] = [
  {
    tag: "Form",
    summary: "Form definuje entitu a vytvari tabulku usr.[Ident].",
    details: "V Controls definuj business pole. Systemove sloupce (ID, AccountID, CreateDate, LastUpdate, LastUpdateAccountID, State) nevytvarej jako Control."
  },
  {
    tag: "WorkFlow",
    summary: "WorkFlow ridi stavy, prava a akce nad Form.",
    details: "Atribut FormIdent musi odkazovat na existujici Form. Typicky StartState=1, DeleteState=0."
  },
  {
    tag: "DataView",
    summary: "DataView definuje seznam/detail pohledy nad daty.",
    details: "Columns poradi drzte konzistentni se SELECT dotazem, pouzivej #FILTER# a #PERMISSION[...]# placeholdery."
  },
  {
    tag: "Filter",
    summary: "Filter definuje vyhledavaci podminky pro DataView/Form.",
    details: "Control identy drzte konzistentni s navazujicimi SQL parametry."
  },
  {
    tag: "Using",
    summary: "Using vklada komponentu nebo sekci z XML_Components.",
    details: "Component/Name odkazuje na komponentu, Section na konkretni Section Name."
  },
  {
    tag: "SectionOverride",
    summary: "SectionOverride prepisuje cilovou sekci vlozene komponenty.",
    details: "Pouziva se uvnitr Using pro upravu target xpath/insert/root bez upravy komponenty."
  },
  {
    tag: "Component",
    summary: "Komponenta je znovupouzitelna cast XML konfigurace.",
    details: "Obsahuje Setting a Sections; registrace v entitach muze prepisovat setting/sections."
  },
  {
    tag: "SQL",
    summary: "SQL blok muze obsahovat dotaz i nevalidni XML znaky.",
    details: "Dodrzuj SQL konvence (UPPERCASE keywordy, citelne formatovani, mezery kolem '=')."
  },
  {
    tag: "Command",
    summary: "Command blok je specialni SQL-like blok s preserve-inner formatovanim.",
    details: "Formatovani vnitrku je standardne potlaceno, vkladej pouze validni business logiku."
  },
  {
    tag: "HTMLTemplate",
    summary: "HTMLTemplate obsahuje render sablonu (HTML + SFP placeholdery).",
    details: "Podporuje napr. [#Resource#], {{TemplateExpr}}, [FOR]/[IF] pseudo-direktivy."
  },
  {
    tag: "Action",
    summary: "Action definuje behavior ve WorkFlow (validace, trigger, notifikace, zmeny stavu).",
    details: "Nejcastejsi typy: ChangeState, ShareCode, ActionTrigger, ActionValue, Required, GlobalValidation, Communication, Email, Alert."
  },
  {
    tag: "Mapping",
    summary: "Mapping prenasi hodnotu z FromIdent do ToIdent.",
    details: "Pri MappingFormIdent se ToIdent validuje proti controls ciloveho Form."
  },
  {
    attribute: "FormIdent",
    summary: "FormIdent je reference na Form Ident.",
    details: "Musí odkazovat na existujici Form nebo povolenou systemovou/external tabulku dle nastaveni."
  },
  {
    attribute: "MappingFormIdent",
    summary: "MappingFormIdent urcuje cilovy Form pro Mapping ToIdent.",
    details: "Pokud je vyplnen, ToIdent se vyhodnocuje proti controls ciloveho Form."
  },
  {
    attribute: "xsi:type",
    summary: "xsi:type urcuje konkretni implementacni typ prvku.",
    details: "U Control/Section/Button/Action preferuj hodnoty nabizene IntelliSense."
  },
  {
    attribute: "Ident",
    summary: "Ident je klicovy identifikator prvku v danem scope.",
    details: "Dodrzuj PascalCase a ASCII. U Button konvence konci na Button/GroupButton."
  },
  {
    attribute: "TitleResourceKey",
    summary: "TitleResourceKey je vazba na prekladovy resource.",
    details: "Pouzivej konzistentni konvenci [Value]_[Module] (napr. Name_ITSM)."
  },
  {
    attribute: "ActionStart",
    summary: "ActionStart urcuje fazi spusteni akce.",
    details: "Bezna pouziti: BeforeValidation, AfterValidation, AfterSave, AfterPermission."
  },
  {
    attribute: "DataType",
    summary: "DataType urcuje typ hodnoty controlu/parametru.",
    details: "Pouzij typ podle kontextu (String/VarChar/Number/Guid/... nebo list varianty)."
  },
  {
    tag: "Parameter",
    summary: "dsp:Parameter definuje SQL parametr pro DataSource.",
    details: "Nejcastejsi typy: VariableParameter, ValueParameter, TableParameter."
  }
];

