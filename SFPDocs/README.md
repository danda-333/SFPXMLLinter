# SmartFormPlatform - AI Documentation

Dokumentace pro generování XML konfigurací SmartFormPlatform pomocí AI.

---

## Přehled systému

SmartFormPlatform (SFP) je low-code platforma pro tvorbu business aplikací. Konfigurace se definuje pomocí XML souborů, které popisují:

- **Formuláře** - datové entity s UI
- **WorkFlow** - stavový automat a business logika
- **DataView** - seznamy a přehledy dat
- **Dashboard** - přehledové widgety
- **Filter** - filtrovací formuláře
- **Configuration** - segmenty, oprávnění, nastavení

---

## Struktura dokumentace

### ⚠️ Administrace a coding standards

| Soubor | Popis |
|--------|-------|
| [administration.md](administration.md) | ⭐ **CRITICAL** - Jak nahrávat XML soubory (přes Admin UI, NE kopírování do složek) |
| [validation-workflow.md](validation-workflow.md) | ⭐ **VALIDATION WORKFLOW** - Krok-za-krokem checklist pro validaci XML a SQL souborů |
| [csharp-coding-standards.md](csharp-coding-standards.md) | ⭐ **C# Coding Standards** - Konvence pro psaní C# kódu v projektu |

### 🚀 Performance & Optimization

| Soubor | Popis |
|--------|-------|
| [performance-optimization-report.md](../performance-optimization-report.md) | 🚀 **PERFORMANCE REPORT** - Kompletní analýza a doporučení pro optimalizaci rychlosti (async/await, caching, N+1 queries, atd.) |

### Hlavní entity (`entities/`)

| Soubor | Popis |
|--------|-------|
| [form.md](entities/form.md) | Formuláře - definice datových entit a UI |
| [workflow.md](entities/workflow.md) | WorkFlow - stavy, přechody, akce, oprávnění |
| [dataview.md](entities/dataview.md) | DataView - seznamy, gridy, exporty |
| [dashboard.md](entities/dashboard.md) | Dashboard - widgety (Content, Tab, Calendar, Graph) |
| [filter.md](entities/filter.md) | Filter - filtrovací formuláře pro DataView |
| [configuration.md](entities/configuration.md) | Configuration - segmenty, menu, oprávnění, nastavení |
| [library.md](entities/library.md) | Library - SQL databázové objekty (procedures, functions, views, table types) |
| [partialrender.md](entities/partialrender.md) | PartialRender - AJAX content, JSON API, dashboard widgety, dynamic loading |
| [other-definitions.md](entities/other-definitions.md) | Další entity (AutomaticOperation, Variable, Report...) |

### Ovládací prvky (`controls/`)

| Soubor | Popis |
|--------|-------|
| [README.md](controls/README.md) | Přehled všech typů ovládacích prvků |
| [control-base.md](controls/control-base.md) | Základní atributy a DataTypes |
| [text-controls.md](controls/text-controls.md) | TextBox, TextArea, RichTextBox, Password, CodeEditor |
| [selection-controls.md](controls/selection-controls.md) | DropDownList, AutoComplete, CheckBox, RadioButton, Tag |
| [file-controls.md](controls/file-controls.md) | File, FileGallery, FileManager |
| [relationship-controls.md](controls/relationship-controls.md) | SubForm, DataGrid, TreeSelectBox |

### Společné komponenty (`common/`)

| Soubor | Popis |
|--------|-------|
| [xml-conventions.md](xml-conventions.md) | ⭐ **XML konvence** - formátování, pojmenování, design, struktura |
| [buttons.md](common/buttons.md) | Typy tlačítek (FormButton, ActionButton, LinkButton...) |
| [sections.md](common/sections.md) | Typy sekcí (ContentSection, HeaderSection, ExportSection...) |
| [validations.md](common/validations.md) | Validační pravidla (Email, Phone, Regex, Range...) |
| [datasource.md](common/datasource.md) | DataSource, DataBind, Parameters |
| [permissions.md](common/permissions.md) | Správa oprávnění - statická vs computed, SQL skripty |
| [resources.md](common/resources.md) | Překlady (Resources) - konvence, import CSV/SQL |
| [database-conventions.md](common/database-conventions.md) | Databázové konvence - systémové tabulky (dbo.Account, ...) a standardní vazby |

### Rozšíření systému

| Soubor | Popis |
|--------|-------|
| [plugin-development.md](plugin-development.md) | Complete guide for developing SFP plugins (C#, DI, interfaces, examples) |
| [csharp-coding-standards.md](csharp-coding-standards.md) | C# coding conventions, patterns, and best practices for SmartFP development |
| [components/](components/) | Reusable UI components (TypeScript, XML definition, examples, API) |

---

## Typický postup vytvoření modulu

### 1. Návrh datového modelu

```
Product (Produkt)
├── SKU (VarChar 50)
├── Name (String 200)
├── CategoryID (Number) → FK na Category
├── UnitPrice (Double 18,2)
├── MinStock (Number)
└── IsActive (Bool)
```

### 2. Vytvoření souborů

```
ModuleName/
├── Product/
│   ├── Product.xml              # Form
│   ├── ProductWorkFlow.xml      # WorkFlow
│   └── view/
│       ├── ProductAllView.xml   # DataView
│       └── ProductFilter.xml    # Filter
├── Category/
│   ├── Category.xml
│   ├── CategoryWorkFlow.xml
│   └── view/
│       └── CategoryAllView.xml
└── Configuration.xml            # Segment, oprávnění
```

### 3. Překlady

```sql
-- Resources pro modul
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Name_Product' AND LanguageID = 1)
   AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1)
BEGIN
  INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group])
  VALUES ('Name_Product', N'Název produktu', 1, 0, 1, 'Product')
END
```

### 4. Oprávnění (Permissions)

Před vytvořením segmentu vytvořte statická oprávnění pomocí SQL skriptů.

```sql
-- 1. Hlavní oprávnění pro segment
DECLARE @Name nvarchar(256) = 'Product'
DECLARE @Weight smallint = 10

-- INSERT do AspNetRoles, Permission, Role
-- (Viz common/permissions.md pro kompletní skript)

-- 2. Přiřazení segmentu k oprávnění
INSERT INTO dbo.SegmentType(ID, ASPNETRoleID)
SELECT 'ProductSegment', Id FROM AspNetRoles WHERE Name = 'RoleProduct'

-- 3. Dodatečná oprávnění (ProductEditor, ProductViewer)
-- (Viz common/permissions.md)
```

**Poznámka:** Statická oprávnění se NEVYTVÁŘEJÍ v XML. Viz [common/permissions.md](common/permissions.md).

---

## XML Namespaces

Standardní namespace pro XML soubory:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Form xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns:xsd="http://www.w3.org/2001/XMLSchema"
      xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
```

Pro DataView s Froms:
```xml
xmlns:dsf="http://www.gappex.com/sfp/DataSource/Froms"
```

Pro DataView se Settings:
```xml
xmlns:dvs="http://www.gappex.com/sfp/DataView/Settings"
```

---

## CDATA sekce (DŮLEŽITÉ)

**Vždy používejte `<![CDATA[...]]>` pro obsah obsahující HTML nebo SQL!**

### Proč CDATA?

1. **Validní XML** - znaky `<`, `>`, `&` nemusí být escapované
2. **Čitelnost** - SQL a HTML zůstává čitelné bez `&lt;`, `&gt;`, `&amp;`
3. **Bezpečnost** - XML parser neinterpretuje obsah jako značky

### Kde používat CDATA

| Element | Vyžaduje CDATA |
|---------|----------------|
| `<SQL>` | ✅ ANO - obsahuje `<`, `>` v porovnáních |
| `<HTMLTemplate>` | ✅ ANO - obsahuje HTML tagy |
| `<BodyTemplate>` | ✅ ANO - email HTML obsah |
| `<JavaScript>` | ✅ ANO - JS kód |
| `<XMLDescription>` | ✅ ANO - může obsahovat speciální znaky |

### Příklad správného použití

```xml
<!-- SPRÁVNĚ - SQL v CDATA -->
<SQL><![CDATA[
  SELECT p.ID, p.Name, p.Price
  FROM usr.Product p
  WHERE p.State != 0
    AND p.Price > 100
    AND p.CreateDate < GETDATE()
  ORDER BY p.Name
]]></SQL>

<!-- SPRÁVNĚ - HTMLTemplate v CDATA -->
<HTMLTemplate><![CDATA[
  <div class="row">
    <div class="col-md-6">
      <h3>[#Title_Product#]</h3>
      <p>Cena: [%Price%] &gt; 100</p>
    </div>
  </div>
]]></HTMLTemplate>

<!-- ŠPATNĚ - bez CDATA způsobí XML parsing error -->
<SQL>
  SELECT * FROM usr.Product WHERE Price > 100
</SQL>
```

### CDATA v DataBind

```xml
<DataBind>
  <Columns>
    <Column Ident="ID" DataBindType="Value" />
    <Column Ident="Name" DataBindType="Title" />
  </Columns>
  <SQL><![CDATA[
    SELECT ID, Name
    FROM usr.Category
    WHERE State != 0
      AND ParentID < 100
    ORDER BY Name
  ]]></SQL>
</DataBind>
```

### CDATA v HTMLTemplate s Razor

```xml
<HTMLTemplate IsRazorEngine="true"><![CDATA[
  @{
    var total = Model.Items.Sum(x => (decimal)x.Price);
  }
  <table class="table">
    @foreach(var item in Model.Items) {
      <tr>
        <td>@item.Name</td>
        <td>@item.Price.ToString("N2")</td>
      </tr>
    }
  </table>
  <p>Celkem: @total.ToString("N2")</p>
]]></HTMLTemplate>
```

---

## Klíčové koncepty

### 1. Ident a pojmenování

- **Form Ident** → vytvoří tabulku `usr.[Ident]`
- **Control Ident** → vytvoří sloupec v tabulce
- **TitleResourceKey** → klíč překladu v `dbo.Resource`

### 2. Stavy (State)

- `0` = Smazáno (DeleteState)
- `1` = Nový (StartState)
- `10+` = Vlastní stavy workflow

### 3. Oprávnění

- **Static** - přiřazeno uživateli přímo (např. `Admin`, `Editor`)
- **Computed** - vypočítáno SQL dotazem (např. `TaskAssignedComputed`)

### 4. SQL Placeholders (DataSource)

| Placeholder | Popis |
|-------------|-------|
| `#FILTER#` | Filtrovací podmínky z Filter |
| `#PERMISSION[Form(alias)]#` | Kontrola oprávnění |
| `#ADDCOLUMN#` | Dynamické sloupce z Froms |
| `#ADDFROM#` | Dynamické JOINy z Froms |
| `#TABLE[alias.ID]#` | Omezení na konkrétní záznamy |
| `@DeletedState` | Stav smazání (obvykle 0) |

### 4.1 Library Placeholders

| Placeholder | Popis | Použití |
|-------------|-------|---------|
| `#MODIFIER#` | CREATE, ALTER, nebo CREATE OR ALTER | Functions, Views, Procedures |
| `#NAME#` | Plné jméno objektu se schématem `[schema].[Ident]` | Všechny Library typy |

**Příklad:**
```xml
<Library Ident="usp_GetUsers" LibraryType="StoredProcedure">
	<Command><![CDATA[
		#MODIFIER# PROCEDURE #NAME#
		AS
		BEGIN
			SELECT * FROM dbo.Account
		END
	]]></Command>
</Library>
```

Systém nahradí: `CREATE OR ALTER PROCEDURE [dbo].[usp_GetUsers]`

**Viz:** [library.md](entities/library.md) pro kompletní dokumentaci

### 5. DataBind Dependencies

```xml
<DataBind>
  <Dependencies>
    <string>ParentControlIdent</string>
  </Dependencies>
  <!-- SQL se znovu vykoná při změně ParentControlIdent -->
</DataBind>
```

### 6. HTMLTemplate Syntax

```html
<!-- Překlad -->
[#ResourceKey#]

<!-- Hodnota z formuláře -->
[%ACTUALFORM.FieldName%]

<!-- Hodnota z DataSource -->
[%#DataSourceIdent.ColumnIdent%]

<!-- Systémové proměnné -->
[%ACCOUNT.ID%]
[%ACCOUNT.FullName%]

<!-- FOR cyklus -->
[FOR Source="DataSourceIdent"]
  <tr><td>[%ColumnName%]</td></tr>
[/FOR]

<!-- Control rendering -->
<Control ID="ControlIdent" />
<ControlLabel ControlID="ControlIdent" />
<ControlButton ID="ButtonIdent" />
```

---

## Příklad: Minimální modul

### Product.xml (Form)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Form xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns:xsd="http://www.w3.org/2001/XMLSchema"
      xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
      Ident="Product"
      SegmentType="ProductSegment">

  <DataPermissions>
    <string>ProductAdmin</string>
  </DataPermissions>

  <CreatePermissions>
    <string>ProductAdmin</string>
  </CreatePermissions>

  <Buttons>
    <Button xsi:type="FormButton" Ident="SaveButton" TitleResourceKey="SaveButton_Product"
            IsSave="true" PlacementType="Top Bottom" ColorType="Primary" IsVisible="false" />
    <Button xsi:type="FormButton" Ident="DeleteButton" TitleResourceKey="DeleteButton_Product"
            IsSave="false" ColorType="Danger" IsVisible="false">
      <Extensions>
        <Extension xsi:type="ConfirmDialogExtension"
                   TitleResourceKey="ConfirmDeleteTitle_Product" />
      </Extensions>
    </Button>
    <Button xsi:type="BackButton" Ident="BackButton" TitleResourceKey="BackButton_Product" />
  </Buttons>

  <Controls>
    <Control xsi:type="TextBoxControl" Ident="SKU" DataType="VarChar" MaxLength="50"
             TitleResourceKey="SKU_Product" IsRequired="true" />
    <Control xsi:type="TextBoxControl" Ident="Name" DataType="String" MaxLength="200"
             TitleResourceKey="Name_Product" IsRequired="true" />
    <Control xsi:type="DropDownListControl" Ident="CategoryID" DataType="Number"
             TitleResourceKey="Category_Product">
      <DataBind DefaultTitleResourceKey="SelectValue">
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="Name" DataBindType="Title" />
        </Columns>
        <SQL><![CDATA[
          SELECT ID, Name FROM usr.Category WHERE State != 0 ORDER BY Name
        ]]></SQL>
      </DataBind>
    </Control>
    <Control xsi:type="TextBoxControl" Ident="UnitPrice" DataType="Double" DataTypeSize="18,2"
             TitleResourceKey="UnitPrice_Product" />
    <Control xsi:type="SwitchControl" Ident="IsActive" TitleResourceKey="IsActive_Product"
             Default="1" />
  </Controls>

  <Sections>
    <Section xsi:type="ContentSection" Ident="BasicInfo" TitleResourceKey="BasicInfo_Product">
      <HTMLTemplate><![CDATA[
        <div class="row">
          <div class="col-md-4">
            <div class="form-group">
              <ControlLabel ControlID="SKU" />
              <Control ID="SKU" />
            </div>
          </div>
          <div class="col-md-8">
            <div class="form-group">
              <ControlLabel ControlID="Name" />
              <Control ID="Name" />
            </div>
          </div>
        </div>
        <div class="row">
          <div class="col-md-4">
            <div class="form-group">
              <ControlLabel ControlID="CategoryID" />
              <Control ID="CategoryID" />
            </div>
          </div>
          <div class="col-md-4">
            <div class="form-group">
              <ControlLabel ControlID="UnitPrice" />
              <Control ID="UnitPrice" />
            </div>
          </div>
          <div class="col-md-4">
            <div class="form-group">
              <Control ID="IsActive" />
            </div>
          </div>
        </div>
      ]]></HTMLTemplate>
    </Section>
  </Sections>
</Form>
```

### ProductWorkFlow.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<WorkFlow xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
          Ident="ProductWorkFlow"
          FormIdent="Product"
          StartState="1"
          DeleteState="0">

  <Definition>
    <States>
      <State Value="0" TitleResourceKey="Deleted_Product" ColorCssClass="danger" />
      <State Value="1" TitleResourceKey="Active_Product" ColorCssClass="success" />
    </States>
  </Definition>

  <ButtonShareCodes>
    <ButtonShareCode Ident="SaveButtonShare">
      <Buttons>
        <Button Ident="SaveButton" IsVisible="true" />
      </Buttons>
    </ButtonShareCode>
    <ButtonShareCode Ident="DeleteButtonShare">
      <Buttons>
        <Button Ident="DeleteButton" IsVisible="true">
          <Actions>
            <Action xsi:type="ChangeState" State="0" ActionStart="AfterSave" />
          </Actions>
        </Button>
      </Buttons>
    </ButtonShareCode>
  </ButtonShareCodes>

  <Steps>
    <Step State="1">
      <Groups>
        <Group>
          <Permissions>
            <string>ProductAdmin</string>
          </Permissions>
          <Buttons>
            <Button xsi:type="ShareCodeButton" Ident="SaveButtonShare" />
            <Button xsi:type="ShareCodeButton" Ident="DeleteButtonShare" />
          </Buttons>
          <Controls>
            <FormControl Ident="SKU" IsReadOnly="false" />
            <FormControl Ident="Name" IsReadOnly="false" />
            <FormControl Ident="CategoryID" IsReadOnly="false" />
            <FormControl Ident="UnitPrice" IsReadOnly="false" />
            <FormControl Ident="IsActive" IsReadOnly="false" />
          </Controls>
        </Group>
      </Groups>
    </Step>
  </Steps>
</WorkFlow>
```

### ProductAllView.xml (DataView)

```xml
<?xml version="1.0" encoding="utf-8"?>
<DataView xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
          Ident="ProductAllView"
          SegmentType="ProductSegment"
          TitleResourceKey="ProductAllView_Product"
          Priority="100"
          CountColorCssClass="primary">

  <AccessPermissions>
    <string>ProductAdmin</string>
  </AccessPermissions>

  <Buttons>
    <Button xsi:type="LinkButton" Ident="NewProductButton" FormIdent="Product"
            TitleResourceKey="NewProductButton_Product" IconCssClass="ph-plus" ColorType="Primary" />
  </Buttons>

  <DataSource FormIdent="Product">
    <DataPermissions>
      <string>ProductAdmin</string>
    </DataPermissions>
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" DataType="Number" />
      <Column Ident="SKU" TitleResourceKey="SKU_Product" Width="15" IsDefaultSort="true" />
      <Column Ident="Name" TitleResourceKey="Name_Product" Width="35" />
      <Column Ident="CategoryName" TitleResourceKey="Category_Product" Width="20">
        <SQL><![CDATA[c.Name AS CategoryName]]></SQL>
      </Column>
      <Column Ident="UnitPrice" TitleResourceKey="UnitPrice_Product" Width="15" DataType="Double" />
      <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Product"
              TitleResourceKey="State_Product" Width="15" IsColor="true" />
    </Columns>
    <SQL><![CDATA[
      SELECT
        p.ID,
        p.SKU,
        p.Name,
        c.Name AS CategoryName,
        p.UnitPrice,
        p.State
      FROM usr.Product p
      LEFT JOIN usr.Category c ON c.ID = p.CategoryID
      WHERE p.State != @DeletedState
        AND #PERMISSION[Product(p)]#
        #FILTER#
      ORDER BY p.SKU
    ]]></SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="DeletedState" DataType="Number" Value="0" />
    </Parameters>
  </DataSource>

  <CountDataSource>
    <SQL><![CDATA[
      SELECT COUNT(p.ID)
      FROM usr.Product p
      WHERE p.State != @DeletedState
        AND #PERMISSION[Product(p)]#
        #FILTER#
    ]]></SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="DeletedState" DataType="Number" Value="0" />
    </Parameters>
  </CountDataSource>
</DataView>
```

---

## Checklist pro nový modul

- [ ] Form XML s Controls a Sections
- [ ] WorkFlow XML s Definition, Steps, Actions
- [ ] DataView XML s DataSource, Columns, Filter
- [ ] Filter XML (volitelně)
- [ ] Configuration.xml - Segment
- [ ] Resources (překlady) - SQL INSERT nebo CSV
- [ ] Oprávnění (static/computed)
