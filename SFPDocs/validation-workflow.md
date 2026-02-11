# Validation Workflow

**Version:** 1.0
**Purpose:** Strukturovaný proces pro validaci vygenerovaných XML souborů proti dokumentaci

---

## Overview

Tento dokument definuje krok-za-krokem validační proces, který AI může použít k ověření správnosti vygenerovaných XML souborů před jejich dodáním uživateli.

**Kdy použít:**
- Po vygenerování jakéhokoliv XML souboru
- Po vygenerování jakéhokoliv SQL souboru (Permissions, Resources, Data)
- Před spuštěním XMLValidator
- Při review existujících XML/SQL souborů

---

## Validation Process Flow

### For XML Files:
```
1. Pre-Validation
   ↓
2. Entity Type Identification (Form/WorkFlow/DataView/etc.)
   ↓
3. Documentation Cross-Check
   ↓
4. Entity-Specific Checklist
   ↓
5. Common Errors Check
   ↓
6. XMLValidator
   ↓
7. Final Review
```

### For SQL Files:
```
1. File Type Identification (Permission/Resource/Data)
   ↓
2. Database Tables Check (Existing vs Non-existing)
   ↓
3. SQL-Specific Checklist
   ↓
4. Common SQL Errors Check
   ↓
5. Data Types & Format Validation
   ↓
6. Final Review
```

---

## Step 1: Pre-Validation

**Před zahájením validace:**

- [ ] **Identifikuj typ entity** (Form, WorkFlow, DataView, Filter, Configuration, Library)
- [ ] **Najdi příslušnou dokumentaci:**
  - Form → `.ai/docs/entities/form.md`
  - WorkFlow → `.ai/docs/entities/workflow.md`
  - DataView → `.ai/docs/entities/dataview.md`
  - Filter → `.ai/docs/entities/filter.md`
  - Configuration → `.ai/docs/entities/configuration.md`
  - Library → `.ai/docs/entities/library.md`
- [ ] **Načti AI-RULES.md** → `.ai/docs/AI-RULES.md`
- [ ] **Připrav checklist** pro daný typ entity

---

## Step 2: Universal XML Validation

**Tyto kontroly platí pro VŠECHNY XML soubory:**

### XML Structure
- [ ] **XML deklarace:** `<?xml version="1.0" encoding="utf-8"?>`
- [ ] **Root element** má správný typ (Form, WorkFlow, DataView, atd.)
- [ ] **Namespaces jsou správné:**
  ```xml
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
  ```
- [ ] **Žádné vymyšlené elementy** - každý element existuje v dokumentaci
- [ ] **Žádné vymyšlené atributy** - každý atribut existuje v dokumentaci

### CDATA Sections
- [ ] **SQL obsahuje CDATA:** `<SQL><![CDATA[ ... ]]></SQL>`
- [ ] **HTMLTemplate obsahuje CDATA:** `<HTMLTemplate><![CDATA[ ... ]]></HTMLTemplate>`
- [ ] **Command (Library) obsahuje CDATA:** `<Command><![CDATA[ ... ]]></Command>`
- [ ] **CDATA NEMÁ mezery:** `<![CDATA[` ne `<![CDATA [` nebo `<! [CDATA[`

### Naming Conventions
- [ ] **Ident** je PascalCase bez mezer a speciálních znaků
- [ ] **TitleResourceKey** používá formát: `FieldName_ModuleName`
- [ ] **SQL aliasy** jsou lowercase (např. `usr.Product p`, `dbo.Account acc`)

---

## Step 3: Form Validation Checklist

**Pro Form XML soubory (`<Form>`)**

### Root Attributes
- [ ] **Ident** je zadán (povinný)
- [ ] **SegmentType** je zadán (doporučený)
- [ ] Atributy odpovídají dokumentaci (form.md)

### Controls Section
- [ ] **❌ KRITICKÁ KONTROLA:** ŽÁDNÉ systémové sloupce jako Controls:
  - [ ] ❌ Není Control s Ident="ID"
  - [ ] ❌ Není Control s Ident="AccountID"
  - [ ] ❌ Není Control s Ident="CreateDate"
  - [ ] ❌ Není Control s Ident="LastUpdate"
  - [ ] ❌ Není Control s Ident="State"
  - [ ] ❌ Není Control s Ident="LastUpdateAccountID"
  - [ ] ❌ Není Control s Ident="CreatedBy" / "ModifiedBy" / "ModifiedDate"
- [ ] **Každý Control má:**
  - [ ] `xsi:type` (např. `TextBoxControl`, `DropDownListControl`)
  - [ ] `Ident` (unikátní)
  - [ ] `DataType` (String, Number, Bool, atd.)
  - [ ] `TitleResourceKey` (pro viditelné kontroly)
- [ ] **Bool Controls:**
  - [ ] Default je `"0"` nebo `"1"`, **NE** `"false"` nebo `"true"`
- [ ] **Všechny Controls mají `IsReadOnly="true"`** (default stav)

### Buttons Section
- [ ] **Všechny FormButtons mají `IsVisible="false"`** (default stav)
- [ ] **Buttons používají `xsi:type="FormButton"`**
- [ ] **Každý Button má:**
  - [ ] `Ident`
  - [ ] `TitleResourceKey`
  - [ ] `IsSave` (pro Save button)
  - [ ] `ColorType` (Primary, Danger, Warning, atd.)

### Sections
- [ ] **Alespoň jedna ContentSection** existuje
- [ ] **HTMLTemplate obsahuje CDATA**
- [ ] **HTMLTemplate používá správnou syntaxi:**
  - [ ] `<Control ID="ControlIdent" />`
  - [ ] `<ControlLabel ControlID="ControlIdent" />`
  - [ ] `[#ResourceKey#]` pro překlady
  - [ ] `[%FieldName%]` pro hodnoty

### Permissions
- [ ] **DataPermissions** jsou zadány (doporučené)
- [ ] **CreatePermissions** jsou zadány (doporučené)

---

## Step 4: WorkFlow Validation Checklist

**Pro WorkFlow XML soubory (`<WorkFlow>`)**

### Root Attributes
- [ ] **Ident** je zadán
- [ ] **FormIdent** odpovídá existujícímu Form
- [ ] **StartState** je definován (např. 1)
- [ ] **DeleteState** je definován (typicky 0)

### Definition Section
- [ ] **Definition/States existuje**
- [ ] **Každý State má:**
  - [ ] `Value` (číslo)
  - [ ] `TitleResourceKey`
  - [ ] `ColorCssClass` (primary, success, warning, danger)
- [ ] **DeleteState (0) je v Definition**
- [ ] **StartState je v Definition**

### ButtonShareCodes (pokud existují)
- [ ] **Každý ButtonShareCode má unikátní Ident**
- [ ] **Buttons v ShareCode:**
  - [ ] **Používají `Ident` (NE xsi:type)**
  - [ ] Mají `IsVisible="true"`
  - [ ] Mohou mít `Actions`

### Steps Section
- [ ] **Každý State z Definition má Step** (kromě DeleteState)
- [ ] **Každý Step má:**
  - [ ] `State` odpovídající Definition
  - [ ] Alespoň jednu `Group`
- [ ] **Každá Group má:**
  - [ ] `Permissions` nebo `ComputedPermissions` nebo `IsDefault="true"`
  - [ ] `Buttons` (reference na FormButton nebo ShareCode)
  - [ ] `Controls` (seznam FormControl s IsReadOnly)

### Controls v Steps
- [ ] **FormControl používá pouze `Ident`** (NE xsi:type)
- [ ] **Každý FormControl má `IsReadOnly` (true/false)**

### Actions (pokud existují)
- [ ] **Action má validní xsi:type:**
  - [ ] `ChangeState` - má `State`, `ActionStart`
  - [ ] `SendEmail` - má `BodyTemplate`, `TitleResourceKey`
  - [ ] `ValidateControl` - má validaci
- [ ] **ActionStart je platný:** `BeforeSave`, `AfterSave`, `OnClick`

---

## Step 5: DataView Validation Checklist

**Pro DataView XML soubory (`<DataView>`)**

### Root Attributes
- [ ] **Ident** je zadán
- [ ] **SegmentType** je zadán (doporučený)
- [ ] **TitleResourceKey** je zadán
- [ ] **Priority** je zadán (pro pořadí v menu)
- [ ] **ViewType** je správný (DataView, ActionView, ContentView, atd.)

### DataSource Section
- [ ] **❌ KRITICKÁ KONTROLA: FormIdent MUSÍ být zadán**
- [ ] **Columns sekce existuje**
- [ ] **ID column:**
  - [ ] Má `IsPrimaryKey="true"`
  - [ ] Má `IsVisible="false"`
  - [ ] Má `DataType="Number"`
- [ ] **Alespoň jeden sloupec má `IsDefaultSort="true"`**
- [ ] **State column:**
  - [ ] Používá `xsi:type="WorkFlowStateColumn"`
  - [ ] Má `FormIdent`
  - [ ] Má `IsColor="true"` (doporučeno)
- [ ] **SQL obsahuje CDATA**
- [ ] **SQL obsahuje:**
  - [ ] `#PERMISSION[Form(alias)]#` (pokud má DataPermissions)
  - [ ] `#FILTER#` (pokud má Filter)
  - [ ] `WHERE State != @DeletedState` (nebo podobné)

### Buttons Section
- [ ] **New button používá `xsi:type="LinkButton"`** (NE ActionButton)
- [ ] **LinkButton má:**
  - [ ] `FormIdent`
  - [ ] `TitleResourceKey`
  - [ ] `ColorType="Primary"`
- [ ] **Export/Print buttons:**
  - [ ] Používají `xsi:type="DownloadButton"` nebo `PrintButton`
  - [ ] Mají `SectionIdent`

### CountDataSource (pokud existuje)
- [ ] **SQL obsahuje COUNT(...)**
- [ ] **SQL obsahuje stejné WHERE podmínky jako DataSource**

### Special ViewTypes
- [ ] **ActionView:**
  - [ ] Používá `ActionColumnSection` nebo `DynamicActionColumnSection`
- [ ] **ContentView:**
  - [ ] Používá `WidgetSection`

---

## Step 6: Filter Validation Checklist

**Pro Filter XML soubory (v DataView nebo samostatné)**

### Filter Attributes
- [ ] **Ident** je zadán
- [ ] **IsApplyImmediately** je nastaven (doporučeno false)

### Controls
- [ ] **Každý Filter Control má:**
  - [ ] `xsi:type` (TextBoxControl, DropDownListControl, atd.)
  - [ ] `Ident`
  - [ ] `DataType`
  - [ ] `TitleResourceKey`
- [ ] **DropDownList/AutoComplete mají:**
  - [ ] `DataBind` s `DefaultTitleResourceKey`
  - [ ] `Columns` (Value, Title)
  - [ ] `SQL` v CDATA

### FullText (pokud existuje)
- [ ] **Columns seznam existuje**
- [ ] **Sloupce odpovídají DataSource sloupcům**

---

## Step 7: Configuration Validation Checklist

**Pro Configuration XML soubory (`<Configuration>`)**

### Root Attributes
- [ ] **PackageIdent** je zadán (pokud je součást package)

### Segments
- [ ] **Každý Segment má:**
  - [ ] `Ident` (musí odpovídat dbo.SegmentType.ID)
  - [ ] `TitleResourceKey`
  - [ ] `SegmentType` odpovídá Permission (např. RoleModule)

### Menu
- [ ] **Menu položky mají:**
  - [ ] `Ident`
  - [ ] `TitleResourceKey`
  - [ ] `Type` (Segment, FormSectionNew, atd.)

---

## Step 8: Library Validation Checklist

**Para Library XML soubory (`<Library>`)**

### Root Attributes
- [ ] **Ident** je zadán (název SQL objektu)
- [ ] **LibraryType** je platný:
  - [ ] `StoredProcedure`
  - [ ] `Function`
  - [ ] `View`
  - [ ] `TableType`

### Command Section
- [ ] **Command obsahuje CDATA**
- [ ] **Command používá placeholders:**
  - [ ] `#MODIFIER#` (pro CREATE/ALTER)
  - [ ] `#NAME#` (pro plné jméno objektu)

### Examples
```xml
<!-- Správný formát -->
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

---

## Step 9: Common Errors Checklist

**Kontrola nejčastějších chyb (viz user feedback):**

### ❌ Error 1: Bool Default Values
- [ ] **ŽÁDNÝ Control nemá `Default="true"` nebo `Default="false"`**
- [ ] **Všechny Bool Controls mají `Default="0"` nebo `Default="1"`**

### ❌ Error 2: System Columns as Controls
- [ ] **ŽÁDNÝ Control s Ident: ID, AccountID, CreateDate, LastUpdate, State, LastUpdateAccountID**
- [ ] **ŽÁDNÝ Control s Ident: CreatedBy, CreatedDate, ModifiedBy, ModifiedDate**

### ❌ Error 3: Resource SQL Format
- [ ] **Resource SQL je SINGLE-LINE** (ne multi-line)
- [ ] **Používá `LanguageID`** (1=CS, 2=EN), **NE `CultureCode`**
- [ ] **Naming je `FieldName_Module`**, ne jiný formát

### ❌ Error 4: Permissions/Segments
- [ ] **Používá `AspNetRoles`**, ne `dbo.ACL`
- [ ] **Používá `dbo.Permission`**, ne neexistující tabulky
- [ ] **Používá `dbo.SegmentType`**, ne `dbo.Segment` nebo `dbo.MenuSegment`

### ❌ Error 5: Button Types
- [ ] **Form: používá `xsi:type="FormButton"`**
- [ ] **WorkFlow: používá pouze `Ident` (ne xsi:type)**
- [ ] **DataView: používá `xsi:type="LinkButton"` pro New**

### ❌ Error 6: Column Attributes
- [ ] **Používá `TitleResourceKey`**, **NE `HeaderResourceKey`**
- [ ] **ID má `IsPrimaryKey="true"`**, ne jen `IsVisible="false"`

### ❌ Error 7: ColorType Values
- [ ] **Používá pouze:** Primary, Warning, Success, Danger, Light
- [ ] **NEPOUŽÍVÁ:** Secondary, Info, Dark (neexistují)

---

## Step 10: XMLValidator Execution

**Po úspěšné manuální validaci spusť XMLValidator:**

```bash
cd /workspace/SFP.XMLValidator/bin/Debug/net8.0
dotnet SFP.XMLValidator.dll <cesta-k-souboru.xml>
```

### XMLValidator Checklist
- [ ] **Validator našel soubor**
- [ ] **Žádné XSD chyby** (schema validation)
- [ ] **Žádné case-sensitivity chyby** (názvy atributů)
- [ ] **Žádné polymorphic type chyby** (xsi:type)
- [ ] **CDATA byl správně zpracován**

### Common XMLValidator Errors
| Error | Cause | Fix |
|-------|-------|-----|
| `Attribute 'ident' not found` | Case-sensitive: ident vs Ident | Use `Ident` |
| `Element not expected` | Špatný xsi:type nebo element | Check documentation |
| `CDATA expected` | Missing CDATA in SQL/HTMLTemplate | Add `<![CDATA[...]]>` |

---

## Step 11: Resource Keys Validation

**Kontrola, že všechny ResourceKeys existují v SQL nebo CSV:**

### Resource Keys Checklist
- [ ] **Každý `TitleResourceKey` má odpovídající SQL INSERT**
- [ ] **Resource naming je `FieldName_ModuleName`**
- [ ] **Existují resources pro OBA jazyky** (LanguageID 1=CS, 2=EN)
- [ ] **Resource SQL je single-line formát**

### Resource SQL Format
```sql
-- CORRECT: Single-line format
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Name_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Name_Product',N'Název produktu',1,0,1,'Product') END
```

---

## Step 12: SQL Syntax Validation

**Kontrola SQL dotazů v DataSource:**

### SQL Checklist
- [ ] **SQL je v CDATA**
- [ ] **Používá správné aliasy** (lowercase: p, acc, c, atd.)
- [ ] **LEFT JOIN pro AccountID** (může být NULL)
- [ ] **Obsahuje WHERE State != @DeletedState**
- [ ] **Používá placeholders správně:**
  - [ ] `#PERMISSION[Form(alias)]#`
  - [ ] `#FILTER#`
  - [ ] `#ADDCOLUMN#` a `#ADDFROM#` (pokud má Froms)
- [ ] **Parametry jsou definovány v Parameters sekci**
- [ ] **Column SQL výrazy odpovídají SELECT**

---

## Step 13: Cross-File Validation

**Kontrola konzistence mezi soubory:**

### Form + WorkFlow
- [ ] **WorkFlow.FormIdent odpovídá Form.Ident**
- [ ] **WorkFlow States obsahují všechny State hodnoty z Form**
- [ ] **WorkFlow Steps referují všechny Buttons z Form**
- [ ] **WorkFlow Steps referují všechny Controls z Form**

### DataView + Form
- [ ] **DataView.DataSource.FormIdent odpovídá Form.Ident**
- [ ] **DataView.Buttons.FormIdent odpovídá Form.Ident**
- [ ] **WorkFlowStateColumn.FormIdent odpovídá Form.Ident**

### Configuration + Segments
- [ ] **Segment.Ident odpovídá Form.SegmentType**
- [ ] **SegmentType existuje v SQL (dbo.SegmentType)**

---

## Validation Summary Template

**Po dokončení všech kroků vyplň summary:**

### For XML Files:

```markdown
## Validation Summary: [FileName.xml]

**Entity Type:** [Form/WorkFlow/DataView/Filter/Configuration/Library]

### ✅ Passed Checks
- Universal XML structure
- Entity-specific requirements
- Common errors check
- XMLValidator execution
- [další...]

### ⚠️ Warnings
- [žádné / seznam warningů]

### ❌ Errors Found
- [žádné / seznam chyb]

### 📋 Actions Required
- [žádné / seznam akcí k provedení]

### 🔗 References
- Documentation: [odkaz na příslušnou .md]
- AI-RULES: [relevantní rules]

**Status:** ✅ VALID / ⚠️ WARNINGS / ❌ INVALID
```

### For SQL Files:

```markdown
## Validation Summary: [FileName.sql]

**SQL Type:** [Permission/Resource/Data/Mixed]

### ✅ Passed Checks
- Database tables validation (no non-existing tables)
- Permission SQL structure (AspNetRoles, dbo.Permission, dbo.Role, dbo.SegmentType)
- Resource SQL format (LanguageID, single-line, IF NOT EXISTS)
- Data types validation
- Common SQL errors check
- [další...]

### ⚠️ Warnings
- [žádné / seznam warningů]

### ❌ Errors Found
- [žádné / seznam chyb]

### ❌ Non-Existing Tables Used (CRITICAL)
- [ ] NO dbo.ACL
- [ ] NO dbo.Segment
- [ ] NO dbo.MenuSegment
- [ ] NO dbo.Permissions (plural)
- [ ] NO dbo.Roles (plural)
- [ ] NO dbo.Resources (plural)

### 📋 Actions Required
- [žádné / seznam akcí k provedení]

### 🔗 References
- Documentation: [permissions.md](common/permissions.md) or [resources.md](common/resources.md)
- AI-RULES: Rule 10 (Permissions Management)

**Status:** ✅ VALID / ⚠️ WARNINGS / ❌ INVALID
```

---

## SQL Files Validation

**KRITICKÉ:** AI často vymýšlí neexistující tabulky a sloupce v SQL souborech!

### Step 14: Permission SQL Validation

**Pro SQL soubory vytvářející permissions a segments:**

#### ✅ Existující Tabulky (POUŽÍVEJ TYTO)

| Tabulka | Účel | Důležité sloupce |
|---------|------|------------------|
| `AspNetRoles` | ASP.NET Identity roles | `Id`, `Name`, `NormalizedName`, `ConcurrencyStamp` |
| `dbo.Permission` | Permission definitions | `ID`, `Name`, `Weight` |
| `dbo.Role` | Role mappings | `ID`, `ASPNETRoleID`, `PermissionID`, `ParentID` |
| `dbo.SegmentType` | Segment definitions | `ID`, `ASPNETRoleID` |

#### ❌ Neexistující Tabulky (NIKDY NEPOUŽÍVEJ)

| Tabulka | Proč neexistuje | Použij místo toho |
|---------|-----------------|-------------------|
| ❌ `dbo.ACL` | Neexistuje | `AspNetRoles` + `dbo.Permission` |
| ❌ `dbo.Segment` | Neexistuje | `dbo.SegmentType` |
| ❌ `dbo.MenuSegment` | Neexistuje | `dbo.SegmentType` |
| ❌ `dbo.Permissions` (plural) | Neexistuje | `dbo.Permission` (singular) |
| ❌ `dbo.Roles` (plural) | Neexistuje | `dbo.Role` (singular) |

#### Permission SQL Checklist

- [ ] **❌ KRITICKÁ KONTROLA: NEPOUŽÍVÁ neexistující tabulky**
  - [ ] ❌ Žádný `INSERT INTO dbo.ACL`
  - [ ] ❌ Žádný `INSERT INTO dbo.Segment`
  - [ ] ❌ Žádný `INSERT INTO dbo.MenuSegment`
- [ ] **✅ Používá správné tabulky:**
  - [ ] ✅ `AspNetRoles` pro role
  - [ ] ✅ `dbo.Permission` pro permissions
  - [ ] ✅ `dbo.Role` pro role mappings
  - [ ] ✅ `dbo.SegmentType` pro segmenty

#### Správný Formát Permission SQL

```sql
-- =============================================
-- CREATE PERMISSION AND ROLE
-- =============================================

DECLARE @Name nvarchar(256) = 'Movie'  -- Module name
DECLARE @Weight smallint = 10

DECLARE @Id nvarchar(450) = NEWID()
DECLARE @RoleName nvarchar(256) = 'Role'+@Name
DECLARE @ParentID nvarchar(450) = NULL

-- 1. Insert into AspNetRoles (NOT dbo.ACL!)
INSERT INTO AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp)
VALUES(@Id, @RoleName, UPPER(@RoleName), NEWID())

-- 2. Insert into dbo.Permission
INSERT INTO [dbo].[Permission](ID, [Name], [Weight])
VALUES(@Id, @Name, @Weight)

-- 3. Insert into dbo.Role
INSERT INTO [dbo].[Role](ID, ASPNETRoleID, PermissionID, ParentID)
VALUES(NEWID(), @Id, @Id, @ParentID)

-- 4. Assign segment to role (NOT dbo.Segment!)
INSERT INTO dbo.SegmentType(ID, ASPNETRoleID)
SELECT 'MovieSegment', Id FROM AspNetRoles WHERE Name = 'RoleMovie'
```

#### ❌ ŠPATNÉ Příklady (Často generované AI)

```sql
-- WRONG: Neexistující tabulky
INSERT INTO dbo.ACL (RoleName, Permission) VALUES ('Admin', 'MovieEdit')
INSERT INTO dbo.Segment (Name, Type) VALUES ('Movie', 'Module')
INSERT INTO dbo.MenuSegment (SegmentID, MenuID) VALUES (1, 5)
INSERT INTO dbo.Permissions (Name) VALUES ('MovieViewer')  -- plural!
```

---

### Step 15: Resource SQL Validation

**Pro SQL soubory vytvářející překlady (Resources):**

#### ✅ Existující Tabulky

| Tabulka | Sloupce |
|---------|---------|
| `dbo.Resource` | `ID`, `Key`, `Value`, `LanguageID`, `Group`, `IsSystem`, `State`, `CreateDate`, `LastUpdate` |
| `dbo.Language` | `ID`, `Name`, `CultureCode` |

#### Resource SQL Checklist

- [ ] **Používá správnou tabulku `dbo.Resource`** (NE `dbo.Resources` plural)
- [ ] **Používá `LanguageID`** (1=CS, 2=EN), **NE `CultureCode`**
- [ ] **Single-line formát** (celý INSERT na jednom řádku)
- [ ] **Correct sloupce:**
  - [ ] `Key` - Resource key (např. `Name_Product`)
  - [ ] `Value` - Překlad (např. `N'Název produktu'`)
  - [ ] `LanguageID` - 1 nebo 2
  - [ ] `IsSystem` - 0 nebo 1 (ne true/false)
  - [ ] `State` - 1
  - [ ] `Group` - Název modulu
- [ ] **IF NOT EXISTS kontrola:**
  - [ ] Kontroluje `Key` AND `LanguageID`
  - [ ] Kontroluje existenci `dbo.Language` WHERE ID = X

#### Správný Formát Resource SQL

```sql
-- CORRECT: Single-line format
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Name_Product' AND LanguageID = 1)
   AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1)
BEGIN
  INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group])
  VALUES ('Name_Product',N'Název produktu',1,0,1,'Product')
END

IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Name_Product' AND LanguageID = 2)
   AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2)
BEGIN
  INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group])
  VALUES ('Name_Product',N'Product name',2,0,1,'Product')
END
```

#### ❌ ŠPATNÉ Příklady

```sql
-- WRONG: Multi-line format
INSERT INTO dbo.[Resource] (
  [Key],
  Value,
  CultureCode  -- WRONG: Should be LanguageID!
) VALUES (
  'Name_Product',
  N'Název produktu',
  'cs-CZ'  -- WRONG: Should be 1 or 2!
)

-- WRONG: Missing IF NOT EXISTS
INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group])
VALUES ('Name_Product',N'Název produktu',1,0,1,'Product')

-- WRONG: Plural table name
INSERT INTO dbo.Resources ([Key], Value) VALUES ('Name', 'Value')
```

---

### Step 16: Database Tables Reference

**Kompletní seznam existujících vs neexistujících tabulek:**

#### ✅ EXISTUJÍCÍ Tabulky (Safe to Use)

**System Tables:**
- `dbo.Account` - User accounts
- `dbo.Language` - Languages (ID: 1=CS, 2=EN)
- `dbo.Resource` - Translations
- `dbo.File` - File attachments

**Permission Tables:**
- `AspNetRoles` - ASP.NET Identity roles
- `dbo.Permission` - Permission definitions (singular!)
- `dbo.Role` - Role mappings (singular!)
- `dbo.SegmentType` - Segment definitions

**WorkFlow Tables:**
- `dbo.WorkFlowState` - Workflow states
- `dbo.WorkFlowInstance` - Workflow instances

**Configuration Tables:**
- `dbo.Configuration` - System configuration
- `dbo.Menu` - Menu items

**User Tables (created by Forms):**
- `usr.[FormIdent]` - Tables created by Form definitions

#### ❌ NEEXISTUJÍCÍ Tabulky (Never Use!)

| ❌ Neexistuje | ✅ Použij místo toho |
|--------------|---------------------|
| `dbo.ACL` | `AspNetRoles` + `dbo.Permission` + `dbo.Role` |
| `dbo.Segment` | `dbo.SegmentType` |
| `dbo.MenuSegment` | `dbo.SegmentType` |
| `dbo.Permissions` (plural) | `dbo.Permission` (singular) |
| `dbo.Roles` (plural) | `dbo.Role` (singular) + `AspNetRoles` |
| `dbo.Resources` (plural) | `dbo.Resource` (singular) |
| `dbo.Users` | `dbo.Account` |
| `dbo.Translation` | `dbo.Resource` |
| `dbo.Culture` | `dbo.Language` |

---

### Step 17: SQL File Structure Validation

**Pro všechny SQL soubory:**

#### SQL File Checklist

- [ ] **Hlavička s popisem:**
  ```sql
  -- =============================================
  -- MODULE: [ModuleName]
  -- PURPOSE: [Description]
  -- =============================================
  ```
- [ ] **Sekvence v správném pořadí:**
  1. Permissions/Roles (pokud existují)
  2. SegmentType (pokud existuje)
  3. Resources (pokud existují)
  4. Data (pokud existují)
- [ ] **Používá pouze existující tabulky** (viz Step 16)
- [ ] **Správné datové typy:**
  - [ ] `nvarchar(450)` pro ASPNETRoleID, AccountID
  - [ ] `nvarchar(256)` pro jména (Name, RoleName)
  - [ ] `nvarchar(max)` pro Value v Resources
  - [ ] `smallint` pro LanguageID, Weight
  - [ ] `bit` pro IsSystem
  - [ ] `tinyint` pro State
- [ ] **IF NOT EXISTS kontroly** (předchází duplikátům)
- [ ] **Transaction handling** (BEGIN/COMMIT/ROLLBACK, pokud potřebný)

---

### Step 18: SQL Common Errors Checklist

**Kontrola nejčastějších SQL chyb:**

#### ❌ Error 1: Neexistující Tabulky
- [ ] **ŽÁDNÝ `INSERT INTO dbo.ACL`**
- [ ] **ŽÁDNÝ `INSERT INTO dbo.Segment`**
- [ ] **ŽÁDNÝ `INSERT INTO dbo.MenuSegment`**
- [ ] **ŽÁDNÝ `INSERT INTO dbo.Permissions`** (plural)
- [ ] **ŽÁDNÝ `INSERT INTO dbo.Roles`** (plural)
- [ ] **ŽÁDNÝ `INSERT INTO dbo.Resources`** (plural)

#### ❌ Error 2: Špatné Sloupce v Resource
- [ ] **NEPOUŽÍVÁ `CultureCode`** (mělo by být `LanguageID`)
- [ ] **NEPOUŽÍVÁ hodnoty jako 'cs-CZ'** (mělo by být 1 nebo 2)

#### ❌ Error 3: Multi-line Resource INSERT
- [ ] **Resource INSERT není rozebraný na více řádků**
- [ ] **Je single-line formát**

#### ❌ Error 4: Chybějící IF NOT EXISTS
- [ ] **Permissions mají kontrolu duplicit**
- [ ] **Resources mají IF NOT EXISTS kontrolu**
- [ ] **SegmentType má kontrolu duplicit**

#### ❌ Error 5: Špatné Datové Typy
- [ ] **IsSystem je 0/1** (ne true/false)
- [ ] **LanguageID je 1/2** (ne 'cs-CZ'/'en-US')
- [ ] **State je 0/1** (ne 'Active'/'Deleted')

---

## Quick Reference: Validation Order

### Pro XML Soubory:

1. ✅ **Universal XML** (structure, CDATA, namespaces)
2. ✅ **Entity-Specific** (dle typu: Form/WorkFlow/DataView/atd.)
3. ✅ **Common Errors** (Bool defaults, System columns, Resources, Permissions)
4. ✅ **XMLValidator** (spustit tool)
5. ✅ **Resources** (kontrola resource keys)
6. ✅ **SQL** (syntax, placeholders, JOINs)
7. ✅ **Cross-Files** (konzistence mezi soubory)

### Pro SQL Soubory:

1. ✅ **Database Tables** (existující vs neexistující tabulky)
2. ✅ **Permission SQL** (AspNetRoles, dbo.Permission, dbo.Role, dbo.SegmentType)
3. ✅ **Resource SQL** (LanguageID, single-line, IF NOT EXISTS)
4. ✅ **Data Types** (nvarchar, smallint, bit, tinyint)
5. ✅ **SQL Common Errors** (ACL, Segment, MenuSegment, plural names)
6. ✅ **File Structure** (header, correct order, transactions)

---

## Appendix: Validation Tools

### Manual Validation
- **Read documentation:** `.ai/docs/entities/[type].md`
- **Check AI-RULES:** `.ai/docs/AI-RULES.md`
- **Use checklists** from this document

### Automated Validation
- **XMLValidator:** `/workspace/SFP.XMLValidator/bin/Debug/net8.0/`
- **SQL validation:** Run SQL queries to check consistency

### Documentation Links
- [AI-RULES.md](AI-RULES.md) - Mandatory rules
- [form.md](entities/form.md) - Form documentation
- [workflow.md](entities/workflow.md) - WorkFlow documentation
- [dataview.md](entities/dataview.md) - DataView documentation
- [xml-conventions.md](xml-conventions.md) - General conventions
- [database-conventions.md](common/database-conventions.md) - Database standards

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial validation workflow |

---

**Pro AI:** Tento dokument je MANDATORY checklist před dodáním jakéhokoliv XML souboru uživateli. Po vygenerování XML souboru vždy projdi příslušný checklist a vytvoř Validation Summary.
