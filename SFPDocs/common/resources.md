# Resources (Překlady)

Systém překladů SmartFormPlatform ukládá všechny textové řetězce do tabulky `dbo.Resource`. Každý text může mít překlad pro více jazyků.

---

## Struktura tabulky dbo.Resource

| Sloupec | Typ | Popis |
|---------|-----|-------|
| `ID` | int | Primární klíč (auto-increment) |
| `Key` | nvarchar(400) | **Unikátní klíč překladu** |
| `Value` | nvarchar(max) | Přeložený text |
| `LanguageID` | smallint | ID jazyka (FK na dbo.Language) |
| `Group` | nvarchar(100) | Skupina pro organizaci překladů |
| `IsSystem` | bit | Systémový překlad (true = nelze smazat v UI) |
| `State` | tinyint | Stav záznamu (1 = aktivní) |
| `CreateDate` | datetime | Datum vytvoření |
| `LastUpdate` | datetime | Datum poslední změny |

### Typické hodnoty LanguageID

| LanguageID | Jazyk |
|------------|-------|
| 1 | Čeština (cs-CZ) |
| 2 | Angličtina (en-US) |

### ⚠️ KRITICKÉ: Existující vs Neexistující Tabulky

**✅ Používej POUZE:**
- `dbo.Resource` (SINGULAR!)
- `dbo.Language`

**❌ NIKDY NEPOUŽÍVEJ:**
- ❌ `dbo.Resources` (PLURAL - tabulka neexistuje!)
- ❌ `dbo.Translation` (neexistuje, použij `dbo.Resource`)
- ❌ `dbo.Culture` (neexistuje, použij `dbo.Language`)
- ❌ Sloupec `CultureCode` (neexistuje, použij `LanguageID` s hodnotami 1=CS, 2=EN)

**Viz také:** [validation-workflow.md](../validation-workflow.md#step-15-resource-sql-validation) - Resource SQL Validation

---

## Konvence pojmenování klíčů

### Formát: `NázevPole_ModulNeboEntita`

| Typ | Vzor | Příklad |
|-----|------|---------|
| Formulářové pole | `FieldName_Module` | `Name_Warehouse`, `SKU_Product` |
| Tlačítko | `ButtonNameButton_Module` | `SaveButton_Warehouse`, `DeleteButton_Product` |
| Stav workflow | `StateName_Module` | `Approved_Warehouse`, `Draft_Product` |
| Chybová zpráva | `ErrorDescription_Module` | `RequiredField_Warehouse`, `InvalidEmail_Customer` |
| Sekce formuláře | `SectionNameSection_Module` | `BasicInfoSection_Warehouse` |
| Název sekce | `SectionName_Module` | `BasicInfo_Warehouse` |
| DataView název | `ViewNameView_Module` | `ProductAllView_Warehouse` |
| DataView skupina | `GroupName_Module` | `ProductGroup_Warehouse` |
| Segment | `SegmentName_Module` | `WarehouseSegment_Warehouse` |
| Nápověda | `FieldNameHelp_Module` | `SKUHelp_Product` |
| Validace | `ValidationName_Module` | `EmailValidation_Customer` |
| Dialog | `DialogTitle_Module` | `ConfirmDeleteTitle_Warehouse` |
| Email předmět | `EmailNameSubject_Email_Module` | `ApprovalSubject_Email_Order` |
| Email tělo | `EmailNameBody_Email_Module` | `ApprovalBody_Email_Order` |

### Příklady pro modul Warehouse (Sklad)

```
# Formulář Product
Name_Product                    = "Název produktu" / "Product name"
SKU_Product                     = "SKU kód" / "SKU code"
Category_Product                = "Kategorie" / "Category"
UnitPrice_Product               = "Jednotková cena" / "Unit price"
MinStock_Product                = "Minimální zásoba" / "Minimum stock"
IsActive_Product                = "Aktivní" / "Active"

# Sekce
BasicInfoSection_Product        = "Základní informace" / "Basic information"
StockSection_Product            = "Skladové informace" / "Stock information"

# Tlačítka
SaveButton_Product              = "Uložit" / "Save"
DeleteButton_Product            = "Smazat" / "Delete"
BackButton_Product              = "Zpět" / "Back"

# Workflow stavy
Draft_Product                   = "Návrh" / "Draft"
Active_Product                  = "Aktivní" / "Active"
Discontinued_Product            = "Ukončený" / "Discontinued"
Deleted_Product                 = "Smazáno" / "Deleted"

# DataView
ProductAllView_Product          = "Všechny produkty" / "All products"
ProductActiveView_Product       = "Aktivní produkty" / "Active products"

# Chybové zprávy
RequiredSKU_Product             = "SKU kód je povinný" / "SKU code is required"
DuplicateSKU_Product            = "SKU kód již existuje" / "SKU code already exists"
```

---

## Import překladů

### 1. CSV/XLSX Import (přes Admin UI)

Formát souboru (oddělovač středník):

```csv
Key;Value;LanguageID;Group;IsSystem
Name_Product;Název produktu;1;Product;false
Name_Product;Product name;2;Product;false
SKU_Product;SKU kód;1;Product;false
SKU_Product;SKU code;2;Product;false
Category_Product;Kategorie;1;Product;false
Category_Product;Category;2;Product;false
```

**Sloupce:**
1. `Key` - Klíč překladu
2. `Value` - Přeložený text
3. `LanguageID` - ID jazyka (1=CS, 2=EN)
4. `Group` - Skupina pro organizaci
5. `IsSystem` - true/false

### 2. SQL INSERT (přímý import do databáze)

Pro hromadný import nebo deployment lze použít SQL INSERT s kontrolou existence:

```sql
-- Vzor pro jeden překlad
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'KeyName' AND LanguageID = 1)
   AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1)
BEGIN
  INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group])
  VALUES ('KeyName', N'Český text', 1, 0, 1, 'ModuleName')
END
```

**Kompletní příklad pro modul Product:**

```sql
-- =============================================
-- PRODUCT MODULE - Czech (LanguageID = 1)
-- =============================================

-- Form fields
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Name_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Name_Product',N'Název produktu',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'SKU_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('SKU_Product',N'SKU kód',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Category_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Category_Product',N'Kategorie',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'UnitPrice_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('UnitPrice_Product',N'Jednotková cena',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'MinStock_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('MinStock_Product',N'Minimální zásoba',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'IsActive_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('IsActive_Product',N'Aktivní',1,0,1,'Product') END

-- Sections
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'BasicInfoSection_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('BasicInfoSection_Product',N'Základní informace',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'StockSection_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('StockSection_Product',N'Skladové informace',1,0,1,'Product') END

-- Buttons
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'SaveButton_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('SaveButton_Product',N'Uložit',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'DeleteButton_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('DeleteButton_Product',N'Smazat',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'BackButton_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('BackButton_Product',N'Zpět',1,0,1,'Product') END

-- Workflow states
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Draft_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Draft_Product',N'Návrh',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Active_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Active_Product',N'Aktivní',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Discontinued_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Discontinued_Product',N'Ukončený',1,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Deleted_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Deleted_Product',N'Smazáno',1,0,1,'Product') END

-- DataView
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'ProductAllView_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('ProductAllView_Product',N'Všechny produkty',1,0,1,'Product') END

-- Errors
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'RequiredSKU_Product' AND LanguageID = 1) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 1) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('RequiredSKU_Product',N'SKU kód je povinný',1,0,1,'Product') END

-- =============================================
-- PRODUCT MODULE - English (LanguageID = 2)
-- =============================================

-- Form fields
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Name_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Name_Product',N'Product name',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'SKU_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('SKU_Product',N'SKU code',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Category_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Category_Product',N'Category',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'UnitPrice_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('UnitPrice_Product',N'Unit price',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'MinStock_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('MinStock_Product',N'Minimum stock',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'IsActive_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('IsActive_Product',N'Active',2,0,1,'Product') END

-- Sections
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'BasicInfoSection_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('BasicInfoSection_Product',N'Basic information',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'StockSection_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('StockSection_Product',N'Stock information',2,0,1,'Product') END

-- Buttons
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'SaveButton_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('SaveButton_Product',N'Save',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'DeleteButton_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('DeleteButton_Product',N'Delete',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'BackButton_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('BackButton_Product',N'Back',2,0,1,'Product') END

-- Workflow states
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Draft_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Draft_Product',N'Draft',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Active_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Active_Product',N'Active',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Discontinued_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Discontinued_Product',N'Discontinued',2,0,1,'Product') END
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'Deleted_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('Deleted_Product',N'Deleted',2,0,1,'Product') END

-- DataView
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'ProductAllView_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('ProductAllView_Product',N'All products',2,0,1,'Product') END

-- Errors
IF NOT EXISTS(SELECT null FROM dbo.[Resource] WHERE [Key] = 'RequiredSKU_Product' AND LanguageID = 2) AND EXISTS(SELECT null FROM dbo.[Language] WHERE ID = 2) BEGIN INSERT INTO dbo.[Resource]([Key], Value, LanguageID, IsSystem, [State], [Group]) VALUES ('RequiredSKU_Product',N'SKU code is required',2,0,1,'Product') END
```

---

## Použití v XML konfiguracích

### V atributech

```xml
<!-- Místo Title použij TitleResourceKey -->
<Control xsi:type="TextBoxControl"
         Ident="Name"
         TitleResourceKey="Name_Product" />

<!-- Místo ErrorMessage použij ErrorMessageResourceKey -->
<Validation xsi:type="RequiredValidation"
            ErrorMessageResourceKey="RequiredSKU_Product" />

<!-- Místo HelpDescription použij HelpDescriptionResourceKey -->
<Control xsi:type="TextBoxControl"
         Ident="SKU"
         HelpDescriptionResourceKey="SKUHelp_Product" />
```

### V HTMLTemplate

```html
<!-- Překlad pomocí [#ResourceKey#] -->
<h3>[#BasicInfoSection_Product#]</h3>
<p>[#ProductDescription_Product#]</p>
```

### V DataView

```xml
<Column Ident="Name" TitleResourceKey="Name_Product" Width="30" />
```

### Ve WorkFlow

```xml
<State Value="10" TitleResourceKey="Draft_Product" ColorCssClass="warning" />
```

---

## Doporučení

1. **Konzistence** - Používejte stejný suffix pro celý modul (např. `_Product`, `_Warehouse`)

2. **Skupina** - Nastavte `Group` podle modulu pro snadnou organizaci v Admin UI

3. **IsSystem** - Nastavte `true` pouze pro systémové překlady, které nesmí uživatel měnit

4. **Vždy oba jazyky** - Vytvořte překlad pro všechny podporované jazyky

5. **N prefix** - V SQL INSERT vždy používejte `N'text'` pro Unicode podporu

6. **Escapování** - V hodnotě escapujte apostrofy: `N'It''s working'`

---

## Generování překladů pro nový modul

Při vytváření nového modulu je potřeba vytvořit překlady pro:

1. **Form**
   - Všechna pole (`TitleResourceKey`)
   - Nápovědy (`HelpDescriptionResourceKey`)
   - Sekce (`TitleResourceKey`)
   - Tlačítka (`TitleResourceKey`)
   - Validace (`ErrorMessageResourceKey`)
   - Dialogy (`TitleResourceKey`, `DescriptionResourceKey`)

2. **WorkFlow**
   - Všechny stavy (`TitleResourceKey`)
   - Email předměty a těla

3. **DataView**
   - Název pohledu (`TitleResourceKey`)
   - Skupina (`GroupTitleResourceKey`)
   - Sloupce (`TitleResourceKey`)
   - Tlačítka (`TitleResourceKey`)
   - Export sekce (`TitleResourceKey`)

4. **Filter**
   - Popisek filtru (`DescriptionResourceKey`)
   - Filtrovací pole (`TitleResourceKey`)

5. **Configuration**
   - Segment (`TitleResourceKey`)
   - Menu položky (`TitleResourceKey`)
