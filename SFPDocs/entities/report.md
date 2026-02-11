# Report - XML Dokumentace

> **C# Model:** `SFP.Kernel.Model.Report.Report`
> **Namespace:** `SFP.Kernel.Model.Report`
> **Příklady:** `.ai/sampls/XML/2/010_Report/` a `.ai/sampls/XML/3/010_Report/`

## 📋 Obsah

- [Účel](#účel)
- [Základní struktura](#základní-struktura)
- [Hlavní atributy](#hlavní-atributy)
- [Sections (Sekce)](#sections-sekce)
- [Filter](#filter)
- [Permissions](#permissions)
- [Export možnosti](#export-možnosti)
- [Razor Engine](#razor-engine)
- [Column Settings](#column-settings)
- [Widgets](#widgets)
- [Příklady použití](#příklady-použití)

---

## 🎯 Účel

**Report** je XML konfigurace pro vytváření **dynamických reportů** v SmartFormPlatform. Umožňuje:

- 📊 Zobrazování dat v tabulkách s vlastním HTML template
- 📥 Export dat do různých formátů (PDF, DOCX, XLSX, Excel)
- 🔍 Filtrování dat přes Filter XML
- 🎨 Vlastní Razor views s dynamickým obsahem
- 📄 Tisk reportů s vlastním layoutem
- 👥 Řízení přístupu přes permissions
- 📈 Widgety a grafy

---

## 🏗️ Základní struktura

```xml
<?xml version="1.0" encoding="utf-8"?>
<Report xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        xmlns:rts="http://www.gappex.com/sfp/Report/Settings"
        Ident="MyReport"
        SegmentType="Report"
        Priority="1"
        TitleResourceKey="MyReportTitle"
        IsRazorEngine="true">

  <XMLDescription><![CDATA[
    Popis účelu reportu
  ]]></XMLDescription>

  <AccessPermissions>
    <string>Permission1</string>
    <string>Permission2</string>
  </AccessPermissions>

  <ColumnSettings>
    <Column Ident="Column1" TitleResourceKey="Column1Title" IsOptional="false"/>
  </ColumnSettings>

  <Sections>
    <!-- ContentSection, ItemSection, PrintSection, PDFSection, DOCXSection, XLSXSection, ExportSection -->
  </Sections>

  <Filter>
    <!-- Filter XML definice -->
  </Filter>

</Report>
```

---

## 📦 Hlavní atributy

### Povinné atributy

| Atribut | Typ | Popis | Příklad |
|---------|-----|-------|---------|
| `Ident` | string | Unikátní identifikátor reportu | `"AbsenceReport"` |
| `SegmentType` | string | Typ segmentu (vždy "Report") | `"Report"` |

### Volitelné atributy

| Atribut | Typ | Default | Popis |
|---------|-----|---------|-------|
| `Priority` | int | 0 | Pořadí zobrazení v seznamu reportů |
| `IsVisible` | bool | true | Zda je report viditelný v UI |
| `IsReportBuilder` | bool | false | Zda lze na reportu vytvářet sestavy |
| `Title` | string | "" | Název reportu (přímo) |
| `TitleResourceKey` | string | "" | Název reportu (z resource) |
| `Description` | string | "" | Popis reportu (přímo) |
| `DescriptionResourceKey` | string | "" | Popis reportu (z resource) |
| `DescriptionUnderLine` | string | "" | Popis pod čarou |
| `DescriptionUnderLineResourceKey` | string | "" | Popis pod čarou (z resource) |
| `CssClass` | string | "" | CSS třída pro box reportu |
| `Color` | string | "" | Hex barva pro report |
| `ColorCssClass` | string | "" | CSS třída pro barvu |
| `IsRazorEngine` | bool | false | Povolí Razor engine pro templates |
| `IsFilterRequired` | bool | false | Vyžaduje filtr před zobrazením |
| `IsDefaultPDFExport` | bool | true | Zobrazí defaultní PDF export |
| `IsWebData` | bool | false | Čistá data pro exporty (Excel) |
| `DefaultFilterIdent` | string | "" | Ident defaultního filtru |
| `PackageIdent` | string | "" | Ident balíčku |

---

## 🎨 Sections (Sekce)

Report může obsahovat **různé typy sekcí** pro zobrazení a export dat.

### Typy sekcí

#### 1. **ContentSection** - Zobrazení dat v HTML

```xml
<Section xsi:type="ContentSection">
  <DataSources>
    <DataSource Ident="Data">
      <Columns>
        <Column Ident="ID" />
        <Column Ident="FullName" />
      </Columns>
      <SQL>
        SELECT ID, FullName FROM usr.Employee #FILTER#
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number"/>
      </Parameters>
    </DataSource>
  </DataSources>

  <HTMLTemplate>
    @*@model SFP.Common.Models.RazorEngines.ViewModelRazorEngine*@
    @{
      var data = (List<dynamic>)Model.Data.Data;
    }
    <table>
      <thead>
        <tr><th>ID</th><th>Jméno</th></tr>
      </thead>
      <tbody>
        @foreach(var row in data) {
          <tr>
            <td>@row.ID</td>
            <td>@row.FullName</td>
          </tr>
        }
      </tbody>
    </table>
  </HTMLTemplate>
</Section>
```

**Účel:** Hlavní sekce pro zobrazení dat v reportu s Razor syntaxí.

**C# Model:** `SFP.Kernel.Model.Sections.ContentSection`

**Vlastnosti:**
- `DataSources` - List DataSource pro načtení dat
- `HTMLTemplate` - Razor view s HTML/Razor syntaxí

---

#### 2. **ItemSection** - Jednotlivá položka v reportu

```xml
<Section xsi:type="ItemSection">
  <HTMLTemplate>
    <div class="card card-body bg-success-400">
      <h6>[#ReportTitle#]</h6>
      <span>[#ReportDescription#]</span>
    </div>
  </HTMLTemplate>
  <Settings>
    <rts:Setting xsi:type="rts:RazorEngineSetting" />
  </Settings>
</Section>
```

**Účel:** Zobrazení jednotlivé položky (např. header, info box).

**C# Model:** `SFP.Kernel.Model.Report.Sections.ItemSection`

**Vlastnosti:**
- `HTMLTemplate` - HTML šablona
- `Settings` - Nastavení (např. RazorEngineSetting)

---

#### 3. **PrintSection** - Tisknutelná verze reportu

```xml
<Section xsi:type="PrintSection"
         Ident="ExportPrint"
         TitleResourceKey="ExportPrint_Report"
         IsShowExportButton="true"
         IsUsedStyleSheet="false">
  <NameDataSource>
    <Columns>
      <Column Ident="Name" />
    </Columns>
    <SQL>
      SELECT CONCAT(FORMAT(GETDATE(), 'yyyyMMddHHmmss'), '_Report') AS Name
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserLanguageID" ConstantType="UserLanguageID" DataType="Number" />
    </Parameters>
  </NameDataSource>

  <Sources>
    <DataSource Ident="Data">
      <!-- SQL a Parameters -->
    </DataSource>
  </Sources>

  <HTMLTemplate>
    <style>
      @page { size: A4 landscape; }
    </style>
    <!-- HTML pro tisk -->
  </HTMLTemplate>
</Section>
```

**Účel:** Verze reportu optimalizovaná pro tisk.

**C# Model:** `SFP.Kernel.Model.Report.Sections.PrintSection`

**Vlastnosti:**
- `IsShowExportButton` - Zobrazit tlačítko exportu
- `IsUsedStyleSheet` - Načíst defaultní CSS
- `NameDataSource` - DataSource pro název souboru
- `Sources` - List DataSource pro data
- `HTMLTemplate` - HTML template pro tisk
- `ExternalCssRelativePaths` - Externí CSS soubory

---

#### 4. **PDFSection** - Export do PDF

```xml
<Section xsi:type="PDFSection"
         Ident="ExportPDF"
         TitleResourceKey="ExportPDF_Report"
         IsShowExportButton="true">
  <NameDataSource>
    <!-- SQL pro název souboru -->
  </NameDataSource>
  <Sources>
    <!-- DataSources -->
  </Sources>
  <HTMLTemplate>
    <!-- HTML pro PDF (bez thead v table!) -->
  </HTMLTemplate>
</Section>
```

**Účel:** Export reportu do PDF formátu.

**C# Model:** `SFP.Kernel.Model.Sections.PDFSection`

**Poznámky:**
- HTML musí být optimalizovaný pro PDF rendering
- Použití `@page { size: A4 landscape; }` pro orientaci stránky

---

#### 5. **DOCXSection** - Export do Word

```xml
<Section xsi:type="DOCXSection"
         Ident="ExportDOCX"
         TitleResourceKey="ExportDOCX_Report"
         IsShowExportButton="true">
  <NameDataSource>
    <!-- SQL pro název souboru -->
  </NameDataSource>
  <Sources>
    <!-- DataSources -->
  </Sources>
  <HTMLTemplate>
    <!-- HTML pro DOCX -->
  </HTMLTemplate>
</Section>
```

**Účel:** Export reportu do Word dokumentu.

**C# Model:** `SFP.Kernel.Model.Sections.DOCXSection`

---

#### 6. **XLSXSection** - Export do Excel

```xml
<Section xsi:type="XLSXSection"
         Ident="ExportXLSX"
         TitleResourceKey="ExportXLSX_Report"
         IsShowExportButton="true">
  <NameDataSource>
    <Columns>
      <Column Ident="Name" />
    </Columns>
    <SQL>
      SELECT CONCAT(FORMAT(GETDATE(), 'yyyyMMddHHmmss'), '_Report') AS Name
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserLanguageID" ConstantType="UserLanguageID" DataType="Number" />
    </Parameters>
  </NameDataSource>
</Section>
```

**Účel:** Export dat do Excel formátu.

**C# Model:** `SFP.Kernel.Model.Sections.XLSXSection`

**Poznámky:**
- Nevyžaduje HTMLTemplate, data se exportují přímo z DataSource

---

#### 7. **ExportSection** - Export do Excel (starší formát)

```xml
<Section xsi:type="ExportSection" Ident="Main" Title="Export" IsShowExportButton="true">
  <NameDataSource>
    <!-- SQL pro název souboru -->
  </NameDataSource>
  <DataSource>
    <Columns>
      <Column Ident="ID" TitleResourceKey="ID_Report" />
      <Column Ident="FullName" TitleResourceKey="FullName_Report" />
    </Columns>
    <SQL>
      SELECT ID, FullName FROM usr.Employee #FILTER#
    </SQL>
    <Parameters>
      <!-- Parameters -->
    </Parameters>
  </DataSource>
</Section>
```

**Účel:** Export čistých dat do Excelu.

**C# Model:** `SFP.Kernel.Model.Sections.ExportSection`

---

## 🔍 Filter

Report může mít **vlastní filtr** pro omezení zobrazovaných dat.

```xml
<Report ...>
  <Filter>
    <Controls>
      <Control xsi:type="DateControl" Ident="DateFrom" LabelResourceKey="DateFrom_Filter" />
      <Control xsi:type="DateControl" Ident="DateTo" LabelResourceKey="DateTo_Filter" />
      <Control xsi:type="SelectControl" Ident="DepartmentID" LabelResourceKey="Department_Filter">
        <DataSource>
          <SQL>SELECT ID, Name FROM usr.Department</SQL>
        </DataSource>
      </Control>
    </Controls>
  </Filter>
</Report>
```

**Odkaz na dokumentaci:** `.ai/docs/entities/filter.md`

**#FILTER# placeholder:**
V SQL dotazech se používá `#FILTER#` placeholder, který se automaticky nahradí WHERE podmínkami z filtru:

```sql
SELECT * FROM usr.Employee
WHERE State != 0 #FILTER#
```

---

## 🔐 Permissions

### AccessPermissions - Kdo má přístup k reportu

```xml
<AccessPermissions>
  <string>EmployeeManager</string>
  <string>EmployeeEditor</string>
  <string>AttendanceEditorAll</string>
</AccessPermissions>
```

**Účel:** Uživatel musí mít **alespoň jedno** z uvedených oprávnění.

### DenyPermissions - Kdo NEMÁ přístup

```xml
<DenyPermissions>
  <string>Guest</string>
</DenyPermissions>
```

**Účel:** Uživatelé s tímto oprávněním **nemají přístup**.

### DataPermissions - Filtrování dat

```xml
<DataPermissions>
  <string>ViewOwnDepartmentOnly</string>
</DataPermissions>
```

**Účel:** Omezení zobrazovaných dat podle oprávnění.

### AccessDataSource - SQL pro access control

```xml
<AccessDataSource>
  <SQL>
    SELECT CASE WHEN @UserID IN (SELECT UserID FROM usr.Admins) THEN 1 ELSE 0 END AS HasAccess
  </SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number"/>
  </Parameters>
</AccessDataSource>
```

**Účel:** Dynamický přístup na základě SQL dotazu.

---

## 📥 Export možnosti

### NameDataSource

Definuje **název souboru** pro export:

```xml
<NameDataSource>
  <Columns>
    <Column Ident="Name" />
  </Columns>
  <SQL>
    SELECT CONCAT(
      FORMAT(GETDATE(), 'yyyyMMddHHmmss'),
      '_',
      usr.GetResourceText('ReportTitle', @UserLanguageID)
    ) AS Name
  </SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserLanguageID" ConstantType="UserLanguageID" DataType="Number" />
  </Parameters>
</NameDataSource>
```

**Výsledek:** `20260131153045_NepritomnostiReport.pdf`

### IsDefaultPDFExport

```xml
<Report ... IsDefaultPDFExport="false">
```

- `true` (default) - Zobrazí standardní PDF export tlačítko
- `false` - Skryje defaultní PDF export (použijte vlastní PDFSection)

---

## 🎨 Razor Engine

### Povolení Razor Engine

```xml
<Report ... IsRazorEngine="true">
```

### Razor syntax v HTMLTemplate

```html
@*@model SFP.Common.Models.RazorEngines.ViewModelRazorEngine*@

@{
  var data = (List<dynamic>)Model.Data.DataSourceIdent;
}

<table>
  <tbody>
    @foreach(var row in data) {
      <tr>
        <td>@row.ColumnName</td>
        <td>@row.AnotherColumn</td>
      </tr>
    }
  </tbody>
</table>
```

### Přístup k datům

```csharp
// DataSource s Ident="Data"
var data = (List<dynamic>)Model.Data.Data;

// DataSource s Ident="Header"
var header = (List<dynamic>)Model.Data.Header;

// Přístup k hodnotám
var id = row.ID;
var name = row.FullName;
```

### Resource keys v HTML

```html
<td>[#ResourceKey_Module#]</td>
```

Automaticky se nahradí překladem z resource souboru.

---

## 📊 Column Settings

Definuje **volitelné sloupce** pro zobrazení v reportu.

```xml
<ColumnSettings>
  <Column Ident="PersonalNumber" TitleResourceKey="PersonalNumber_Report" IsOptional="false"/>
  <Column Ident="FullName" TitleResourceKey="FullName_Report" IsOptional="false"/>
  <Column Ident="Email" TitleResourceKey="Email_Report" IsOptional="true"/>
  <Column Ident="Phone" TitleResourceKey="Phone_Report" IsOptional="true"/>
</ColumnSettings>
```

**Vlastnosti:**
- `Ident` - Identifikátor sloupce (musí odpovídat Column v DataSource)
- `TitleResourceKey` - Název sloupce (z resource)
- `IsOptional` - Zda je sloupec volitelný (uživatel si může vybrat)

**Použití v Razor:**

```csharp
var columns = (List<dynamic>)Model.Data.ColumnSetting;

@foreach(var col in columns) {
  switch(col.Ident) {
    case "PersonalNumber":
      <th>[#PersonalNumber_Report#]</th>
      break;
    case "FullName":
      <th>[#FullName_Report#]</th>
      break;
  }
}
```

---

## 📈 Widgets

Report může obsahovat **widgety** (grafy, statistiky).

```xml
<Widgets>
  <Widget xsi:type="GraphWidget" Ident="MyGraph">
    <!-- Widget konfigurace -->
  </Widget>
</Widgets>
```

**Dokumentace:** `.ai/docs/entities/` (TODO: vytvořit widget.md)

---

## 📚 Příklady použití

### Příklad 1: Jednoduchý report s tabulkou

```xml
<?xml version="1.0" encoding="utf-8"?>
<Report xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        Ident="SimpleEmployeeReport"
        SegmentType="Report"
        TitleResourceKey="EmployeeReport_Title"
        IsRazorEngine="true">

  <AccessPermissions>
    <string>EmployeeManager</string>
  </AccessPermissions>

  <Sections>
    <Section xsi:type="ContentSection">
      <DataSources>
        <DataSource Ident="Employees">
          <Columns>
            <Column Ident="ID" />
            <Column Ident="FullName" />
            <Column Ident="Email" />
          </Columns>
          <SQL>
            SELECT ID, FullName, Email
            FROM usr.Employee
            WHERE State != 0 #FILTER#
            ORDER BY FullName
          </SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number"/>
          </Parameters>
        </DataSource>
      </DataSources>

      <HTMLTemplate>
        @*@model SFP.Common.Models.RazorEngines.ViewModelRazorEngine*@
        @{
          var employees = (List<dynamic>)Model.Data.Employees;
        }

        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>[#FullName_Employee#]</th>
              <th>[#Email_Employee#]</th>
            </tr>
          </thead>
          <tbody>
            @foreach(var emp in employees) {
              <tr>
                <td>@emp.ID</td>
                <td>@emp.FullName</td>
                <td>@emp.Email</td>
              </tr>
            }
          </tbody>
        </table>
      </HTMLTemplate>
    </Section>
  </Sections>

</Report>
```

---

### Příklad 2: Report s filtrem a exportem

```xml
<?xml version="1.0" encoding="utf-8"?>
<Report xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        xmlns:rts="http://www.gappex.com/sfp/Report/Settings"
        Ident="AttendanceReport"
        SegmentType="Report"
        Priority="1"
        DefaultFilterIdent="AttendanceReportFilter"
        TitleResourceKey="AttendanceReport_Title"
        IsRazorEngine="true"
        IsFilterRequired="true"
        IsDefaultPDFExport="false">

  <AccessPermissions>
    <string>AttendanceManager</string>
  </AccessPermissions>

  <ColumnSettings>
    <Column Ident="PersonalNumber" TitleResourceKey="PersonalNumber_Report" IsOptional="false"/>
    <Column Ident="FullName" TitleResourceKey="FullName_Report" IsOptional="false"/>
    <Column Ident="Date" TitleResourceKey="Date_Report" IsOptional="false"/>
    <Column Ident="Hours" TitleResourceKey="Hours_Report" IsOptional="true"/>
  </ColumnSettings>

  <Sections>
    <!-- Zobrazení dat -->
    <Section xsi:type="ContentSection">
      <DataSources>
        <DataSource Ident="Data">
          <Columns>
            <Column Ident="PersonalNumber" />
            <Column Ident="FullName" />
            <Column Ident="Date" />
            <Column Ident="Hours" />
          </Columns>
          <SQL>
            SELECT
              emp.PersonalNumber,
              emp.FullName,
              att.Date,
              att.Hours
            FROM usr.Attendance att
            JOIN usr.Employee emp ON emp.ID = att.EmployeeID
            WHERE att.State != 0 #FILTER#
            ORDER BY emp.FullName, att.Date
          </SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number"/>
          </Parameters>
        </DataSource>
      </DataSources>
      <HTMLTemplate>
        @{
          var data = (List<dynamic>)Model.Data.Data;
        }
        <table class="table">
          <thead>
            <tr>
              <th>[#PersonalNumber_Report#]</th>
              <th>[#FullName_Report#]</th>
              <th>[#Date_Report#]</th>
              <th>[#Hours_Report#]</th>
            </tr>
          </thead>
          <tbody>
            @foreach(var row in data) {
              <tr>
                <td>@row.PersonalNumber</td>
                <td>@row.FullName</td>
                <td>@row.Date</td>
                <td>@row.Hours</td>
              </tr>
            }
          </tbody>
        </table>
      </HTMLTemplate>
    </Section>

    <!-- PDF Export -->
    <Section xsi:type="PDFSection" Ident="ExportPDF" TitleResourceKey="ExportPDF_Report" IsShowExportButton="true">
      <NameDataSource>
        <Columns><Column Ident="Name" /></Columns>
        <SQL>
          SELECT CONCAT(FORMAT(GETDATE(), 'yyyyMMddHHmmss'), '_Attendance') AS Name
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserLanguageID" ConstantType="UserLanguageID" DataType="Number" />
        </Parameters>
      </NameDataSource>
      <Sources>
        <!-- Stejné DataSources jako v ContentSection -->
      </Sources>
      <HTMLTemplate>
        <style>@page { size: A4 landscape; }</style>
        <!-- HTML pro PDF -->
      </HTMLTemplate>
    </Section>

    <!-- Excel Export -->
    <Section xsi:type="XLSXSection" Ident="ExportXLSX" TitleResourceKey="ExportXLSX_Report" IsShowExportButton="true">
      <NameDataSource>
        <Columns><Column Ident="Name" /></Columns>
        <SQL>
          SELECT CONCAT(FORMAT(GETDATE(), 'yyyyMMddHHmmss'), '_Attendance') AS Name
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserLanguageID" ConstantType="UserLanguageID" DataType="Number" />
        </Parameters>
      </NameDataSource>
    </Section>
  </Sections>

  <Filter>
    <Controls>
      <Control xsi:type="DateControl" Ident="DateFrom" LabelResourceKey="DateFrom_Filter" />
      <Control xsi:type="DateControl" Ident="DateTo" LabelResourceKey="DateTo_Filter" />
    </Controls>
  </Filter>

</Report>
```

---

## 🎯 Best Practices

### ✅ DO (Dělej)

1. **Používej ResourceKeys** pro všechny texty
   ```xml
   <Report TitleResourceKey="MyReport_Title" ...>
   ```

2. **Vždy testuj Razor syntaxi** před nasazením
   ```csharp
   var data = (List<dynamic>)Model.Data.DataSourceIdent;
   ```

3. **Používej #FILTER# placeholder** v SQL
   ```sql
   WHERE State != 0 #FILTER#
   ```

4. **Definuj ColumnSettings** pro volitelné sloupce
   ```xml
   <ColumnSettings>
     <Column Ident="Email" IsOptional="true"/>
   </ColumnSettings>
   ```

5. **Používej NameDataSource** pro export
   ```xml
   <NameDataSource>
     <SQL>SELECT CONCAT(FORMAT(GETDATE(), 'yyyyMMddHHmmss'), '_Report') AS Name</SQL>
   </NameDataSource>
   ```

6. **Nastavuj AccessPermissions** vždy
   ```xml
   <AccessPermissions>
     <string>ReportViewer</string>
   </AccessPermissions>
   ```

### ❌ DON'T (Nedělej)

1. ❌ **Nekombinuj hardcoded texty** s resource keys
   ```xml
   <!-- ❌ Špatně -->
   <Report Title="Můj Report" TitleResourceKey="MyReport_Title">
   ```

2. ❌ **Nezapomeň na #FILTER#** v SQL
   ```sql
   /* ❌ Špatně - chybí #FILTER# */
   SELECT * FROM usr.Employee WHERE State != 0
   ```

3. ❌ **Nepoužívej <thead> v PDF sections**
   ```html
   <!-- ❌ Špatně pro PDF -->
   <table>
     <thead><tr><th>...</th></tr></thead>
   </table>
   ```

4. ❌ **Nezapomeň na IsRazorEngine="true"**
   ```xml
   <!-- ❌ Razor nebude fungovat bez tohoto -->
   <Report IsRazorEngine="true">
   ```

5. ❌ **Nepoužívej přímo SQL injection** náchylné dotazy
   ```sql
   /* ❌ Nebezpečné! */
   SELECT * FROM usr.Employee WHERE Name = '@UserInput'

   /* ✅ Bezpečné */
   SELECT * FROM usr.Employee WHERE Name = @UserInput
   ```

---

## 🔗 Související dokumentace

- **Filter:** `.ai/docs/entities/filter.md`
- **DataSource:** `.ai/docs/common/datasource.md`
- **Permissions:** `.ai/docs/common/permissions.md`
- **Sections:** `.ai/docs/common/sections.md`
- **Resources:** `.ai/docs/common/resources.md`
- **Razor Engine:** `.ai/docs/common/html-template.md`

---

## 📂 Příklady v projektu

**Lokace:** `.ai/sampls/XML/2/010_Report/` a `.ai/sampls/XML/3/010_Report/`

### Dostupné příklady:

| Složka | Popis |
|--------|-------|
| `Absence/` | Report pro nepřítomnosti |
| `Attendance/` | Docházkový report |
| `FutureAbsence/` | Plánované nepřítomnosti |
| `HomeOffice/` | Home office report |
| `Library/` | Knihovna reportů |
| `MealVoucher/` | Stravenky report |
| `MonthlyOverview/` | Měsíční přehled |
| `OnCallTime/` | Pohotovostní čas |
| `OverTimeUseOrPayment/` | Přesčasy report |
| `OvertimeWork/` | Nadčasová práce |
| `PeriodOverview/` | Periodický přehled |
| `Summary/` | Sumární report |

---

## 📝 C# Model Lokace

**Hlavní třída:**
```
SFP.Kernel.Model/Report/Report.cs
```

**Sekce:**
```
SFP.Kernel.Model/Report/Sections/
├── ItemSection.cs
├── PrintSection.cs
└── ContentSection.cs (v SFP.Kernel.Model/Sections/)
```

**Další sekce:**
```
SFP.Kernel.Model/Sections/
├── ContentSection.cs
├── ExportSection.cs
├── PDFSection.cs
├── DOCXSection.cs
├── XLSXSection.cs
└── FileTemplateSection.cs
```

---

**Poslední aktualizace:** 2026-01-31
**Verze:** 3.0
**Pro AI asistenty:** Tato dokumentace je optimalizována pro rychlé pochopení Report XML struktury v SmartFormPlatform.
