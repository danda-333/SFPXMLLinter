# DataView Documentation

DataView defines list/grid views for displaying data. Each DataView shows records from a DataSource in a tabular format with filtering, sorting, and pagination.

## Root Element

```xml
<DataView xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
          xmlns:dsf="http://www.gappex.com/sfp/DataSource/Froms"
          Ident="CustomerListView"
          SegmentType="CustomerSegment"
          TitleResourceKey="AllCustomers"
          Priority="100">
  <!-- Content -->
</DataView>
```

## Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Unique view identifier |
| `SegmentType` | string | "" | Module/segment this view belongs to |
| `Title` | string | "" | View title |
| `TitleResourceKey` | string | "" | View title from translations |
| `GroupTitle` | string | "" | Group name in menu |
| `GroupTitleResourceKey` | string | "" | Group name from translations |
| `IconCssClass` | string | "" | Icon CSS class |
| `IconColor` | string | "" | Icon color (hex) |
| `Priority` | int | 0 | Display order in menu (lower = first) |
| `IsVisible` | bool | true | Show view in menu |
| `IsSystem` | bool | false | System view (internal) |
| `ViewType` | enum | DataView | View type |
| `MenuType` | enum | Normal | Menu type (Normal, Tree) |
| `IsHiddenMenu` | string | "" | Hide menu panel |
| `DefaultFilterIdent` | string | "" | Default filter XML ident |
| `ShareFilterIdent` | string | "" | Share filter with other views |
| `ShareColumnSettingIdent` | string | "" | Share column settings |
| `CountColorCssClass` | string | "" | Badge color for count |
| `IsDynamicCountColor` | bool | false | Dynamic count color from data |
| `IsCheckBox` | bool | false | Show row selection checkboxes |
| `IsDetail` | bool | true | Enable row click to detail |
| `IsAutoOpenFirst` | bool | false | Auto-open first record |
| `IsManualPaging` | bool | false | Manual pagination |
| `IsGeneratePaging` | bool | false | Auto-generate paging SQL |
| `IsAutoRefresh` | bool | false | Auto-refresh data |
| `AutoRefreshInterval` | int | 0 | Refresh interval (seconds) |
| `IsCountAutoRefresh` | bool | false | Auto-refresh count |
| `CountAutoRefreshInterval` | int | 0 | Count refresh interval |
| `IsResultList` | bool | false | Enable user result lists |
| `IsSegmentFilter` | bool | true | Show segment filter |
| `IsMenuCount` | bool | true | Show count in menu |
| `IsRazorEngine` | bool | false | Enable Razor engine |
| `ActionAreaDataIdent` | string | "" | Action area data connection |
| `FolderGroupSegmentIdent` | string | "" | Folder group segment |

## ViewTypes Enum

| Value | Description | Speciální sekce |
|-------|-------------|-----------------|
| `DataView` | Standard data grid | - |
| `CalendarView` | Calendar display | - |
| `TransformTableView` | Pivot/transform table | - |
| **`ActionView`** | **Action-based view with action columns** | **ActionColumnSection, DynamicActionColumnSection** ⚠️ |
| `FileView` | File browser view | - |
| **`ContentView`** | **Content display with widgets** | **WidgetSection** ⚠️ |
| `SchedulerView` | Scheduler view | - |
| `GlobalSearchView` | Global search results | GlobalSearchSection |

**⚠️ DŮLEŽITÉ:**
- `ActionView` → Pouze tento ViewType podporuje `ActionColumnSection` a `DynamicActionColumnSection`!
- `ContentView` → Pouze tento ViewType podporuje `WidgetSection`!
- `GlobalSearchView` → Pouze tento ViewType podporuje `GlobalSearchSection`!

## Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataSource` | DataSource | **Required.** Main data query |
| `CountDataSource` | DataSource | Count query for menu badge |
| `HeadDataSource` | DataSource | Dynamic header query |
| `RowDataSource` | DataSource | Row detail query |
| `Filter` | Filter | Filter configuration |
| `Buttons` | List&lt;Button&gt; | Action buttons |
| `Sections` | List&lt;Section&gt; | Export, print, action, widget sections |
| `Settings` | List&lt;Setting&gt; | View settings |
| `AccessPermissions` | List&lt;string&gt; | Permissions that can access view |
| `DenyPermissions` | List&lt;string&gt; | Permissions denied access |
| `HTMLTemplate` | string | Custom HTML template |
| `BreadcrumbSource` | DataSource | Breadcrumb data |
| `QueryStringDataSource` | DataSource | Query string values |
| `Components` | List&lt;Component&gt; | Registered components |
| `ExternalCssRelativePaths` | List&lt;string&gt; | External CSS files |
| `ExternalJavaScriptRelativePaths` | List&lt;string&gt; | External JS files |
| `PackageIdents` | List&lt;string&gt; | Package references |

---

## DataSource

Main data query with columns definition.

### DataSource Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `FormIdent` | string | Form identifier for row detail link |
| `DetailUrl` | string | Custom detail URL |

### Column Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Column identifier |
| `Title` | string | "" | Column header |
| `TitleResourceKey` | string | "" | Header from translations |
| `Width` | int | 0 | Column width (percentage) |
| `IsPrimaryKey` | bool | false | Primary key column |
| `IsVisible` | bool | true | Show column |
| `IsOptional` | bool | false | User can show/hide |
| `IsDefaultSort` | bool | false | Default sort column |
| `SortType` | enum | ASC | Sort direction |
| `DataType` | enum | None | Data type for formatting |
| `Format` | string | "" | Display format |
| `TextAlign` | enum | Left | Text alignment |
| `TableAlterIdent` | string | "" | Table alias for SQL |
| `IsSortable` | bool | true | Allow sorting |
| `MaxLength` | int | 0 | Truncate text |
| `IsStripHTML` | bool | false | Remove HTML tags |
| `CssClass` | string | "" | Column CSS class |

### Column with SQL

Columns can have custom SQL expressions:

```xml
<Column Ident="FullName" TitleResourceKey="FullName" Width="30">
  <SQL>CONCAT(c.FirstName, ' ', c.LastName) AS FullName</SQL>
</Column>
```

### WorkFlowStateColumn

Special column for workflow state display:

```xml
<Column xsi:type="WorkFlowStateColumn"
        Ident="State"
        FormIdent="Customer"
        TitleResourceKey="Status"
        Width="15"
        IsColor="true" />
```

### Example DataSource

```xml
<DataSource FormIdent="Customer">
  <DataPermissions>
    <string>Admin</string>
    <string>SalesRep</string>
  </DataPermissions>
  <Columns>
    <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" DataType="Number" />
    <Column Ident="Name" TitleResourceKey="Name" Width="30" IsDefaultSort="true" />
    <Column Ident="Email" TitleResourceKey="Email" Width="25" />
    <Column Ident="Phone" TitleResourceKey="Phone" Width="20" />
    <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Customer"
            TitleResourceKey="Status" Width="15" IsColor="true" />
    <Column Ident="CreateDate" TitleResourceKey="Created" Width="10"
            DataType="DateTime" Format="{0:d}" IsOptional="true" />
  </Columns>
  <SQL>
    SELECT
      c.ID,
      c.Name,
      c.Email,
      c.Phone,
      c.State,
      c.CreateDate
    FROM usr.Customer c
    WHERE c.State != @DeletedState
      AND #PERMISSION[Customer(c)]#
      #FILTER#
    ORDER BY c.Name
  </SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="DeletedState" DataType="Number" Value="0" />
  </Parameters>
</DataSource>
```

---

## SQL Placeholders

Special placeholders in DataView SQL:

| Placeholder | Description |
|-------------|-------------|
| `#FILTER#` | Filter conditions (WHERE clause additions) |
| `#PERMISSION[Form(alias)]#` | Permission filter for form |
| `#PERMISSION[Form(alias)\|Perm1,Perm2\|]#` | Permission filter for specific permissions |
| `#ADDCOLUMN#` | Dynamic columns from Froms |
| `#ADDFROM#` | Dynamic JOINs from Froms |
| `#ROWNUM#` | Row number for paging |
| `@StartPage` | Paging start (with ConstantType="StartPage") |
| `@EndPage` | Paging end (with ConstantType="EndPage") |

---

## Froms (Dynamic JOINs)

Define conditional JOINs that are only added when needed:

```xml
<Froms>
  <dsf:From Ident="org">
    <dsf:Columns>
      <dsf:string>OrganizationName</dsf:string>
    </dsf:Columns>
    <dsf:SQL>
      LEFT JOIN usr.Organization AS org ON org.ID = c.OrganizationID
    </dsf:SQL>
  </dsf:From>
</Froms>
```

Usage in SQL:
```xml
<SQL>
  SELECT
    c.ID,
    c.Name,
    #ADDCOLUMN#
  FROM usr.Customer c
  #ADDFROM#
  WHERE c.State != 0
</SQL>
```

---

## CountDataSource

Separate query for menu count badge:

```xml
<CountDataSource>
  <SQL>
    SELECT COUNT(c.ID)
    FROM usr.Customer c
    WHERE c.State != @DeletedState
      AND #PERMISSION[Customer(c)]#
      #FILTER#
  </SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="DeletedState" DataType="Number" Value="0" />
  </Parameters>
</CountDataSource>
```

---

## Buttons

Action buttons in the view toolbar.

### LinkButton

Link to create new form:

```xml
<Button xsi:type="LinkButton"
        Ident="NewCustomerButton"
        FormIdent="Customer"
        TitleResourceKey="NewCustomer"
        IconCssClass="ph-plus"
        ColorType="Primary" />
```

### ActionButton

Custom action button:

```xml
<Button xsi:type="ActionButton"
        Ident="RefreshButton"
        TitleResourceKey="Refresh"
        IconCssClass="ph-arrows-clockwise" />
```

### GlobalChangeButton

Bulk edit button:

```xml
<Button xsi:type="GlobalChangeButton"
        Ident="BulkEditButton"
        TitleResourceKey="BulkEdit"
        FormIdent="Customer"
        SectionIdent="GlobalChangeSection" />
```

### DownloadButton

Download/export button:

```xml
<Button xsi:type="DownloadButton"
        Ident="ExportButton"
        TitleResourceKey="Export"
        SectionIdent="ExportSection"
        IconCssClass="ph-download" />
```

### PrintButton

Print button:

```xml
<Button xsi:type="PrintButton"
        Ident="PrintButton"
        TitleResourceKey="Print"
        SectionIdent="PrintSection"
        IconCssClass="ph-printer" />
```

### ImportButton

Import data button:

```xml
<Button xsi:type="ImportButton"
        Ident="ImportButton"
        TitleResourceKey="Import"
        IconCssClass="ph-upload" />
```

### GroupButton

Dropdown with multiple buttons:

```xml
<Button xsi:type="GroupButton"
        Ident="MoreActions"
        TitleResourceKey="More"
        IconCssClass="ph-dots-three">
  <Buttons>
    <Button xsi:type="DownloadButton" Ident="ExportExcel" TitleResourceKey="ExportExcel" />
    <Button xsi:type="PrintButton" Ident="PrintList" TitleResourceKey="Print" />
  </Buttons>
</Button>
```

---

## Sections

DataView podporuje různé typy sekcí pro export, tisk, akce a widgety:

| Section Type | Popis | ViewType |
|--------------|-------|----------|
| `ExportSection` | Export do Excel/CSV | Všechny |
| `PrintSection` | Tisknutelný layout | Všechny |
| `PDFSection` | Export do PDF | Všechny |
| `ExtensionInfoSection` | Detail řádku (expansion panel) | Všechny |
| **`ActionColumnSection`** | **Sloupec s akčními tlačítky** | **POUZE ActionView** ⚠️ |
| **`DynamicActionColumnSection`** | **Dynamický akční sloupec** | **POUZE ActionView** ⚠️ |
| **`WidgetSection`** | **Widgety (grafy, kalendář, vlastní HTML)** | **POUZE ContentView** ⚠️ |
| `ContentSourceSection` | Vlastní HTML obsah | Všechny |
| `GlobalSearchSection` | Globální vyhledávání | GlobalSearchView |

---

### ExportSection

Excel/CSV export configuration:

```xml
<Section xsi:type="ExportSection"
         Ident="BasicExport"
         TitleResourceKey="ExportData">
  <DataSource>
    <Columns>
      <Column Ident="ID" TitleResourceKey="ID" />
      <Column Ident="Name" TitleResourceKey="Name" />
      <Column Ident="Email" TitleResourceKey="Email" />
      <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Customer"
              TitleResourceKey="Status" IsColor="false" />
    </Columns>
    <SQL>
      SELECT c.ID, c.Name, c.Email, c.State
      FROM usr.Customer c
      WHERE c.State != 0
        AND #PERMISSION[Customer(c)]#
        #FILTER#
    </SQL>
  </DataSource>
</Section>
```

### PrintSection

Print layout:

```xml
<Section xsi:type="PrintSection"
         Ident="PrintSection"
         TitleResourceKey="PrintList">
  <HTMLTemplate>
    <h1>[#CustomerList#]</h1>
    <table class="table">
      [FOR Source="PrintData"]
      <tr>
        <td>[%Name%]</td>
        <td>[%Email%]</td>
      </tr>
      [/FOR]
    </table>
  </HTMLTemplate>
</Section>
```

### PDFSection

PDF export:

```xml
<Section xsi:type="PDFSection"
         Ident="PDFExport"
         TitleResourceKey="ExportPDF">
  <HTMLTemplate>
    <!-- PDF template -->
  </HTMLTemplate>
</Section>
```

### ExtensionInfoSection

Row detail/expansion panel:

```xml
<Section xsi:type="ExtensionInfoSection"
         Ident="RowDetail"
         TitleResourceKey="Details">
  <DataSources>
    <DataSource Ident="DetailData">
      <SQL>
        SELECT Description, Notes, CreateDate
        FROM usr.Customer
        WHERE ID = @ID
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
      </Parameters>
    </DataSource>
  </DataSources>
  <HTMLTemplate>
    <div class="p-3">
      <p><strong>[#Description#]:</strong> [%#DetailData.Description%]</p>
      <p><strong>[#Notes#]:</strong> [%#DetailData.Notes%]</p>
    </div>
  </HTMLTemplate>
</Section>
```

### ActionColumnSection

**C# Model:** `SFP.Kernel.Model.DataView.Sections.ActionColumnSection`
**Controller:** `ActionViewController`
**Service:** `ActionViewService`
**⚠️ DŮLEŽITÉ:** ActionColumnSection se používá **POUZE** s `ViewType="ActionView"`!

Action column in ActionView grid - zobrazuje akční tlačítka pro každou položku.

**Vlastnosti:**
- `Ident` (string) - Identifikátor sekce
- `Title` / `TitleResourceKey` (string) - Název sloupce
- `ButtonIdent` (string) - Ident tlačítka z Buttons sekce
- `Width` (int) - Šířka sloupce
- `DataSource` (DataSource) - Zdroj dat pro sloupec

**Příklad:**

```xml
<DataView ViewType="ActionView" Ident="TaskActionView">
  <Sections>
    <Section xsi:type="ActionColumnSection"
             Ident="ActionsColumn"
             TitleResourceKey="Actions"
             ButtonIdent="EditButton"
             Width="10">
      <DataSource>
        <Columns>
          <Column Ident="ID" />
        </Columns>
        <SQL>SELECT ID FROM usr.Task WHERE State != 0</SQL>
      </DataSource>
    </Section>
  </Sections>
</DataView>
```

### DynamicActionColumnSection

**C# Model:** `SFP.Kernel.Model.DataView.Sections.DynamicActionColumnSection`
**Controller:** `ActionViewController`
**Service:** `ActionViewService`
**⚠️ DŮLEŽITÉ:** DynamicActionColumnSection se používá **POUZE** s `ViewType="ActionView"`!

Dynamicky generované action sloupce z DataSource - umožňuje vytvářet akční sloupce na základě dat z databáze.

**Vlastnosti:**
- `Ident` (string) - Identifikátor sekce
- `ColumnDataSource` (DataSource) - Zdroj dat pro definici sloupců
- `DataSource` (DataSource) - Zdroj dat pro položky

**ColumnDataSource požadované sloupce:**
- `Ident` (string) - Identifikátor sloupce
- `Title` (string) - Název sloupce
- `Width` (int) - Šířka sloupce
- `ButtonIdent` (string) - Ident tlačítka

**Příklad:**

```xml
<DataView ViewType="ActionView" Ident="WorkflowActionView">
  <Sections>
    <Section xsi:type="DynamicActionColumnSection" Ident="DynamicActions">
      <!-- Definice sloupců (dynamicky z databáze) -->
      <ColumnDataSource>
        <Columns>
          <Column Ident="Ident" />
          <Column Ident="Title" />
          <Column Ident="Width" />
          <Column Ident="ButtonIdent" />
        </Columns>
        <SQL>
          SELECT
            ws.Ident,
            ws.Title,
            50 AS Width,
            CONCAT('MoveToState_', ws.Ident) AS ButtonIdent
          FROM usr.WorkflowState ws
          WHERE ws.WorkflowIdent = 'TaskWorkflow'
            AND ws.State != 0
          ORDER BY ws.Priority
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number"/>
        </Parameters>
      </ColumnDataSource>

      <!-- Zdroj dat pro položky -->
      <DataSource>
        <Columns>
          <Column Ident="ID" />
          <Column Ident="Title" />
        </Columns>
        <SQL>
          SELECT ID, Title
          FROM usr.Task
          WHERE State != 0 #FILTER#
        </SQL>
      </DataSource>
    </Section>
  </Sections>
</DataView>
```

**Účel:** Vhodné pro workflow systémy, kde počet stavů/akcí není pevně daný a mění se podle konfigurace.

---

### WidgetSection

**C# Model:** `SFP.Kernel.Model.DataView.Sections.WidgetSection`
**Controller:** `ContentViewController`
**⚠️ DŮLEŽITÉ:** WidgetSection se používá **POUZE** s `ViewType="ContentView"`!

Embedded widgets section for displaying interactive content like graphs, calendars, tabs, and custom HTML within ContentView.

**Účel:** Umožňuje vložit widgety (stejné jako v Dashboard) přímo do DataView s ViewType="ContentView" pro zobrazení doplňkových informací, grafů, kalendářů nebo vlastního HTML obsahu.

#### Supported Widget Types

WidgetSection podporuje **4 typy widgetů** (sdílené s Dashboard):

1. **ContentWidget** - Vlastní HTML obsah s daty z SQL
2. **GraphWidget** - Grafy (Chart.js, ApexCharts, atd.)
3. **CalendarWidget** - Kalendářové zobrazení
4. **TabWidget** - Záložky s vnořenými widgety

#### Supported Controls

WidgetSection také podporuje **3 typy kontrolů** pro filtrování:

1. **FilterControl** - Filtr
2. **FilterSelectedControl** - Vybrané hodnoty filtru
3. **SearchBoxControl** - Vyhledávací box

---

#### ContentWidget

Widget pro zobrazení vlastního HTML obsahu s daty z databáze.

**Vlastnosti:**
- `Ident` (string) - Identifikátor widgetu
- `IsRazorEngine` (bool) - Povolit Razor engine (default: false)
- `Sources` (List&lt;DataSource&gt;) - Zdroje dat
- `HTMLTemplate` (string) - HTML šablona
- `Settings` (List&lt;Setting&gt;) - Nastavení (RazorEngineSetting)

**Příklad:**

```xml
<Section xsi:type="WidgetSection" Ident="SummaryWidget" TitleResourceKey="Summary">
  <Widgets>
    <Widget xsi:type="ContentWidget" Ident="EmployeeSummary" IsRazorEngine="true">
      <Sources>
        <DataSource Ident="Stats">
          <Columns>
            <Column Ident="TotalEmployees" />
            <Column Ident="ActiveEmployees" />
            <Column Ident="InactiveEmployees" />
          </Columns>
          <SQL>
            SELECT
              COUNT(*) AS TotalEmployees,
              SUM(CASE WHEN State = 3 THEN 1 ELSE 0 END) AS ActiveEmployees,
              SUM(CASE WHEN State != 3 THEN 1 ELSE 0 END) AS InactiveEmployees
            FROM usr.Employee
            WHERE State != 0
          </SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number"/>
          </Parameters>
        </DataSource>
      </Sources>
      <HTMLTemplate>
        @*@model SFP.Common.Models.RazorEngines.ViewModelRazorEngine*@
        @{
          var stats = (List<dynamic>)Model.Data.Stats;
          var row = stats.FirstOrDefault();
        }
        <div class="row">
          <div class="col-md-4">
            <div class="card card-body bg-primary text-white">
              <h3>@row.TotalEmployees</h3>
              <p>[#TotalEmployees#]</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card card-body bg-success text-white">
              <h3>@row.ActiveEmployees</h3>
              <p>[#ActiveEmployees#]</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card card-body bg-warning text-white">
              <h3>@row.InactiveEmployees</h3>
              <p>[#InactiveEmployees#]</p>
            </div>
          </div>
        </div>
      </HTMLTemplate>
      <Settings>
        <rts:Setting xsi:type="rts:RazorEngineSetting" />
      </Settings>
    </Widget>
  </Widgets>
</Section>
```

---

#### GraphWidget

Widget pro zobrazení grafů (grafy, charts).

**Vlastnosti:**
- `Ident` (string) - Identifikátor widgetu
- `JsonSources` (List&lt;DataSource&gt;) - Zdroje dat pro JSON
- `JsonContent` (GraphJsonContent) - JSON konfigurace grafu

**Příklad:**

```xml
<Section xsi:type="WidgetSection" Ident="ChartWidget">
  <Widgets>
    <Widget xsi:type="GraphWidget" Ident="EmployeeChart">
      <JsonSources>
        <DataSource Ident="ChartData">
          <Columns>
            <Column Ident="Month" />
            <Column Ident="Count" />
          </Columns>
          <SQL>
            SELECT
              MONTH(CreateDate) AS Month,
              COUNT(*) AS Count
            FROM usr.Employee
            WHERE YEAR(CreateDate) = YEAR(GETDATE())
            GROUP BY MONTH(CreateDate)
            ORDER BY MONTH(CreateDate)
          </SQL>
        </DataSource>
      </JsonSources>
      <JsonContent>
        <HTMLTemplate>
          {
            "type": "bar",
            "data": {
              "labels": [FOR Source="ChartData"][%Month%][SEPARATOR],[/SEPARATOR][/FOR],
              "datasets": [{
                "label": "Employees per Month",
                "data": [FOR Source="ChartData"][%Count%][SEPARATOR],[/SEPARATOR][/FOR],
                "backgroundColor": "rgba(54, 162, 235, 0.5)"
              }]
            },
            "options": {
              "responsive": true,
              "plugins": {
                "title": {
                  "display": true,
                  "text": "Employee Registration by Month"
                }
              }
            }
          }
        </HTMLTemplate>
      </JsonContent>
    </Widget>
  </Widgets>
</Section>
```

---

#### CalendarWidget

Widget pro zobrazení kalendáře s událostmi.

**Vlastnosti:**
- `Ident` (string) - Identifikátor widgetu
- `IsDetail` (bool) - Proklikávat do detailu (default: true)
- `DataSource` (DataSource) - Zdroj dat pro kalendář
- `Settings` (List&lt;Setting&gt;) - Nastavení kalendáře

**Požadované sloupce v DataSource:**
- `ID` - Identifikátor záznamu
- `StartDate` - Datum začátku
- `EndDate` - Datum konce
- `Title` - Název události

**Příklad:**

```xml
<Section xsi:type="WidgetSection" Ident="CalendarWidget">
  <Widgets>
    <Widget xsi:type="CalendarWidget" Ident="AbsenceCalendar" IsDetail="true">
      <DataSource>
        <Columns>
          <Column Ident="ID" />
          <Column Ident="StartDate" />
          <Column Ident="EndDate" />
          <Column Ident="Title" />
          <Column Ident="EmployeeName" />
        </Columns>
        <SQL>
          SELECT
            att.ID,
            att.DateFrom AS StartDate,
            att.DateTo AS EndDate,
            CONCAT(emp.FullName, ' - ', attType.TextValue) AS Title,
            emp.FullName AS EmployeeName
          FROM usr.Attendance att
          JOIN usr.Employee emp ON emp.ID = att.EmployeeID
          JOIN usr.AttendanceType attType ON attType.Ident = att.AttendanceTypeIdent
          WHERE att.State != 0
            AND att.DateFrom >= DATEADD(month, -1, GETDATE())
            AND att.DateFrom <= DATEADD(month, 2, GETDATE())
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number"/>
        </Parameters>
      </DataSource>
      <Settings>
        <dvs:Setting xsi:type="dvs:DefaultCalendarSetting" DefaultView="month" />
      </Settings>
    </Widget>
  </Widgets>
</Section>
```

---

#### TabWidget

Widget pro organizaci obsahu do záložek.

**Vlastnosti:**
- `Ident` (string) - Identifikátor widgetu
- `CssClass` (string) - CSS třída pro tab
- `ItemCssClass` (string) - CSS třída pro každou položku
- `Widgets` (List&lt;Widget&gt;) - Vnořené widgety
- `TabDataSource` (DataSource) - Zdroj dat pro záložky
- `Tabs` (List&lt;TabTabWidget&gt;) - HTML template pro záložky

**Příklad - Statické záložky:**

```xml
<Section xsi:type="WidgetSection" Ident="TabbedContent">
  <Widgets>
    <Widget xsi:type="TabWidget" Ident="EmployeeTabs">
      <Widgets>
        <!-- Záložka 1: ContentWidget -->
        <Widget xsi:type="ContentWidget" Ident="Tab1Content">
          <Sources>
            <DataSource Ident="ActiveEmployees">
              <SQL>SELECT ID, FullName FROM usr.Employee WHERE State = 3</SQL>
            </DataSource>
          </Sources>
          <HTMLTemplate>
            <h4>[#ActiveEmployees#]</h4>
            <ul>
              [FOR Source="ActiveEmployees"]
              <li>[%FullName%]</li>
              [/FOR]
            </ul>
          </HTMLTemplate>
        </Widget>

        <!-- Záložka 2: GraphWidget -->
        <Widget xsi:type="GraphWidget" Ident="Tab2Chart">
          <JsonSources>
            <DataSource Ident="Stats">
              <SQL>SELECT DepartmentName, EmployeeCount FROM usr.DepartmentStats</SQL>
            </DataSource>
          </JsonSources>
          <JsonContent>
            <HTMLTemplate>
              {
                "type": "pie",
                "data": {
                  "labels": [FOR Source="Stats"][%DepartmentName%][SEPARATOR],[/SEPARATOR][/FOR],
                  "datasets": [{
                    "data": [FOR Source="Stats"][%EmployeeCount%][SEPARATOR],[/SEPARATOR][/FOR]
                  }]
                }
              }
            </HTMLTemplate>
          </JsonContent>
        </Widget>
      </Widgets>
    </Widget>
  </Widgets>
</Section>
```

**Příklad - Dynamické záložky:**

```xml
<Widget xsi:type="TabWidget" Ident="DynamicTabs">
  <TabDataSource>
    <Columns>
      <Column Ident="ID" />
      <Column Ident="TabName" />
    </Columns>
    <SQL>
      SELECT ID, DepartmentName AS TabName
      FROM usr.Department
      WHERE State != 0
      ORDER BY Priority
    </SQL>
  </TabDataSource>
  <Tabs>
    <TabTabWidget Ident="DepartmentTab">
      <HTMLTemplate>
        <h4>[%TabName%]</h4>
        <p>Content for [%TabName%]</p>
      </HTMLTemplate>
    </TabTabWidget>
  </Tabs>
</Widget>
```

---

#### Controls v WidgetSection

WidgetSection může obsahovat i **filtrovací kontroly**:

```xml
<Section xsi:type="WidgetSection" Ident="FilteredWidget">
  <Controls>
    <!-- FilterControl - Filtr -->
    <Control xsi:type="FilterControl"
             Ident="MainFilter"
             FilterIdent="EmployeeFilter" />

    <!-- FilterSelectedControl - Zobrazení vybraných hodnot -->
    <Control xsi:type="FilterSelectedControl"
             Ident="SelectedFilters" />

    <!-- SearchBoxControl - Vyhledávací box -->
    <Control xsi:type="SearchBoxControl"
             Ident="SearchBox"
             PlaceholderResourceKey="Search_Placeholder" />
  </Controls>

  <Widgets>
    <!-- Widgety, které budou reagovat na filtry -->
    <Widget xsi:type="ContentWidget" Ident="FilteredContent">
      <!-- ... -->
    </Widget>
  </Widgets>
</Section>
```

---

#### Metody v C# (pro programátory)

**GetWidget(string ident)** - Najde widget podle identu (včetně vnořených v TabWidget):

```csharp
var widget = widgetSection.GetWidget("EmployeeSummary");
```

**GetControls&lt;T&gt;()** - Získá kontroly určitého typu:

```csharp
var filterControls = widgetSection.GetControls<FilterControl>();
var searchBoxes = widgetSection.GetControls<SearchBoxControl>();
```

---

#### Kompletní příklad WidgetSection

**⚠️ DŮLEŽITÉ:** Tento příklad vyžaduje `ViewType="ContentView"` v DataView!

```xml
<DataView xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
          Ident="EmployeeContentView"
          ViewType="ContentView"
          TitleResourceKey="Employee_Overview">

  <!-- AccessPermissions -->
  <AccessPermissions>
    <string>EmployeeViewer</string>
  </AccessPermissions>

  <!-- Sections -->
  <Sections>
    <Section xsi:type="WidgetSection"
             Ident="DashboardSection"
             TitleResourceKey="Dashboard_Title">

  <!-- Filtrovací kontroly -->
  <Controls>
    <Control xsi:type="FilterControl"
             Ident="MainFilter"
             FilterIdent="EmployeeFilter" />
    <Control xsi:type="SearchBoxControl"
             Ident="Search"
             PlaceholderResourceKey="Search_Employees" />
  </Controls>

  <!-- Widgety -->
  <Widgets>

    <!-- 1. Content Widget - Statistiky -->
    <Widget xsi:type="ContentWidget" Ident="Stats" IsRazorEngine="true">
      <Sources>
        <DataSource Ident="EmployeeStats">
          <Columns>
            <Column Ident="Total" />
            <Column Ident="Active" />
            <Column Ident="OnLeave" />
          </Columns>
          <SQL>
            SELECT
              COUNT(*) AS Total,
              SUM(CASE WHEN State = 3 THEN 1 ELSE 0 END) AS Active,
              SUM(CASE WHEN IsOnLeave = 1 THEN 1 ELSE 0 END) AS OnLeave
            FROM usr.Employee
            WHERE State != 0 #FILTER#
          </SQL>
        </DataSource>
      </Sources>
      <HTMLTemplate>
        @{
          var stats = ((List<dynamic>)Model.Data.EmployeeStats).FirstOrDefault();
        }
        <div class="row">
          <div class="col-md-4">
            <div class="card card-body bg-info">
              <h2>@stats.Total</h2>
              <p>[#TotalEmployees#]</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card card-body bg-success">
              <h2>@stats.Active</h2>
              <p>[#ActiveEmployees#]</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card card-body bg-warning">
              <h2>@stats.OnLeave</h2>
              <p>[#OnLeave#]</p>
            </div>
          </div>
        </div>
      </HTMLTemplate>
    </Widget>

    <!-- 2. Graph Widget - Graf -->
    <Widget xsi:type="GraphWidget" Ident="DepartmentChart">
      <JsonSources>
        <DataSource Ident="DepartmentData">
          <SQL>
            SELECT
              dept.Name AS DepartmentName,
              COUNT(emp.ID) AS EmployeeCount
            FROM usr.Department dept
            LEFT JOIN usr.Employee emp ON emp.DepartmentID = dept.ID
            WHERE dept.State != 0 AND emp.State != 0
            GROUP BY dept.Name
          </SQL>
        </DataSource>
      </JsonSources>
      <JsonContent>
        <HTMLTemplate>
          {
            "type": "bar",
            "data": {
              "labels": [FOR Source="DepartmentData"]"[%DepartmentName%]"[SEPARATOR],[/SEPARATOR][/FOR],
              "datasets": [{
                "label": "Employees",
                "data": [FOR Source="DepartmentData"][%EmployeeCount%][SEPARATOR],[/SEPARATOR][/FOR]
              }]
            }
          }
        </HTMLTemplate>
      </JsonContent>
    </Widget>

    <!-- 3. Calendar Widget - Kalendář nepřítomností -->
    <Widget xsi:type="CalendarWidget" Ident="AbsenceCalendar">
      <DataSource>
        <Columns>
          <Column Ident="ID" />
          <Column Ident="StartDate" />
          <Column Ident="EndDate" />
          <Column Ident="Title" />
        </Columns>
        <SQL>
          SELECT
            att.ID,
            att.DateFrom AS StartDate,
            att.DateTo AS EndDate,
            CONCAT(emp.FullName, ' - Absence') AS Title
          FROM usr.Attendance att
          JOIN usr.Employee emp ON emp.ID = att.EmployeeID
          WHERE att.IsAbsence = 1
            AND att.DateFrom >= DATEADD(month, -1, GETDATE())
            #FILTER#
        </SQL>
      </DataSource>
    </Widget>

    <!-- 4. Tab Widget - Záložky -->
    <Widget xsi:type="TabWidget" Ident="DetailTabs">
      <Widgets>
        <Widget xsi:type="ContentWidget" Ident="RecentActivity">
          <Sources>
            <DataSource Ident="Activity">
              <SQL>
                SELECT TOP 10
                  CreateDate,
                  ActivityDescription
                FROM usr.EmployeeActivity
                ORDER BY CreateDate DESC
              </SQL>
            </DataSource>
          </Sources>
          <HTMLTemplate>
            <ul>
              [FOR Source="Activity"]
              <li>[%CreateDate%] - [%ActivityDescription%]</li>
              [/FOR]
            </ul>
          </HTMLTemplate>
        </Widget>
      </Widgets>
    </Widget>

  </Widgets>
    </Section>
  </Sections>

</DataView>
```

---

#### Best Practices pro WidgetSection

**✅ DO:**

1. **VŽDY nastav ViewType="ContentView"** v DataView!
   ```xml
   <DataView ViewType="ContentView" Ident="MyContentView">
   ```

2. **Používej Razor engine** pro dynamický obsah
   ```xml
   <Widget xsi:type="ContentWidget" IsRazorEngine="true">
   ```

3. **Kombinuj různé typy widgetů** pro bohatší UI
   ```xml
   <Widgets>
     <Widget xsi:type="ContentWidget">...</Widget>
     <Widget xsi:type="GraphWidget">...</Widget>
     <Widget xsi:type="CalendarWidget">...</Widget>
   </Widgets>
   ```

3. **Používaj #FILTER#** pro propojení s filtry
   ```sql
   SELECT * FROM usr.Employee WHERE State != 0 #FILTER#
   ```

4. **Pojmenuj DataSource Ident srozumitelně**
   ```xml
   <DataSource Ident="EmployeeStats">
   ```

**❌ DON'T:**

1. ❌ **NIKDY nepoužívej WidgetSection bez ViewType="ContentView"** - nebude fungovat!
2. ❌ **Nevkládej příliš mnoho widgetů** do jedné sekce (max 5-7)
3. ❌ **Nezapomeň na IsRazorEngine="true"** pokud používáš Razor syntaxi
4. ❌ **Nepoužívej složité SQL dotazy** v GraphWidget JSON (předpočítej data v SQL)
5. ❌ **Nezapomeň na resource keys** pro nadpisy a popisky

---

#### Poznámky

- **⚠️ KRITICKÉ:** WidgetSection vyžaduje `ViewType="ContentView"` v DataView! Bez toho nebude fungovat.
- **Controller:** Zpracovává `ContentViewController` (ne `DataViewController`)
- **FilterType:** Používá `FilterTypes.ContentView`
- **Sdílené s Dashboard:** Widgety jsou stejné jako v Dashboard entity (viz `.ai/docs/entities/dashboard.md`)
- **C# Model:** `SFP.Kernel.Model.DataView.Sections.WidgetSection`
- **Widget modely:** `SFP.Kernel.Model.Widgets/`
- **Podporované widgety:** ContentWidget, GraphWidget, CalendarWidget, TabWidget
- **Podporované kontroly:** FilterControl, FilterSelectedControl, SearchBoxControl

---

## Filter

Filter configuration for the view.

### Filter Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | Filter identifier |
| `Description` | string | "" | Filter description |
| `DescriptionResourceKey` | string | "" | Description from translations |
| `IsAdvancedSetting` | bool | false | Allow advanced filter settings |
| `IsApplyImmediately` | bool | false | Apply filter on change |
| `IsShowButton` | bool | true | Show filter button |
| `IsShowSelected` | bool | true | Show selected filter values |
| `IsSave` | bool | false | Save filter to database |
| `IsClickOutsideClose` | bool | true | Close on click outside |
| `FilterRenderType` | enum | Default | Render type (Default, Inside) |

### Filter Controls

Available filter controls:
- `TextBoxControl` - Text search
- `DropDownListControl` - Dropdown select
- `AutoCompleteControl` - Autocomplete search
- `CheckBoxControl` / `SwitchControl` - Boolean filter
- `ListBoxControl` - Multi-select
- `TagControl` - Tag selection
- `CriteriaControl` - Custom criteria

### Filter Example

```xml
<Filter Ident="CustomerFilter">
  <Controls>
    <Control xsi:type="TextBoxControl"
             Ident="SearchName"
             TitleResourceKey="SearchName"
             DataType="String" />

    <Control xsi:type="DropDownListControl"
             Ident="State"
             TitleResourceKey="Status"
             DataType="Number">
      <DataBind DefaultTitleResourceKey="All">
        <Columns>
          <Column Ident="Value" DataBindType="Value" />
          <Column Ident="Title" DataBindType="Title" />
        </Columns>
        <SQL>
          SELECT Value, Title FROM dbo.WorkFlowState
          WHERE FormIdent = 'Customer' AND Value != 0
        </SQL>
      </DataBind>
    </Control>

    <Control xsi:type="AutoCompleteControl"
             Ident="OrganizationID"
             TitleResourceKey="Organization"
             DataType="Number">
      <DataBind DefaultTitleResourceKey="All">
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="Name" DataBindType="Title" />
        </Columns>
        <SQL>
          SELECT ID, Name FROM usr.Organization
          WHERE Name LIKE @OrganizationID AND State != 0
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="OrganizationID"
                         DataType="String" LikeType="Both" />
        </Parameters>
      </DataBind>
    </Control>
  </Controls>

  <DirectFilterControls>
    <Control xsi:type="SwitchControl"
             Ident="ShowActive"
             TitleResourceKey="ActiveOnly"
             Default="1" />
  </DirectFilterControls>

  <FullText>
    <Columns>
      <string>Name</string>
      <string>Email</string>
      <string>Phone</string>
    </Columns>
  </FullText>
</Filter>
```

---

## Settings

### DataTableSetting

Custom data table settings:

```xml
<Settings xmlns:dvs="http://www.gappex.com/sfp/DataView/Settings">
  <dvs:Setting xsi:type="dvs:DataTableSetting">
    <!-- Settings -->
  </dvs:Setting>
</Settings>
```

### TransformTableSetting

Pivot table configuration:

```xml
<dvs:Setting xsi:type="dvs:TransformTableSetting">
  <!-- Pivot settings -->
</dvs:Setting>
```

### CalendarSetting

Calendar view settings:

```xml
<dvs:Setting xsi:type="dvs:DefaultCalendarSetting">
  <dvs:DateFromColumnIdent>StartDate</dvs:DateFromColumnIdent>
  <dvs:DateToColumnIdent>EndDate</dvs:DateToColumnIdent>
  <dvs:TitleColumnIdent>Title</dvs:TitleColumnIdent>
</dvs:Setting>
```

---

## Permissions

### AccessPermissions

Who can see the view:

```xml
<AccessPermissions>
  <string>Admin</string>
  <string>Manager</string>
  <string>SalesRep</string>
</AccessPermissions>
```

### DenyPermissions

Who cannot see the view:

```xml
<DenyPermissions>
  <string>Guest</string>
  <string>ReadOnly</string>
</DenyPermissions>
```

### DataPermissions

Who can see the data:

```xml
<DataSource>
  <DataPermissions>
    <string>Admin</string>
    <string>Manager</string>
  </DataPermissions>
  <!-- ... -->
</DataSource>
```

---

## Complete Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<DataView xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
          xmlns:dsf="http://www.gappex.com/sfp/DataSource/Froms"
          Ident="CustomerAllView"
          SegmentType="CustomerSegment"
          TitleResourceKey="AllCustomers"
          GroupTitleResourceKey="Customers"
          Priority="100"
          CountColorCssClass="primary"
          DefaultFilterIdent="CustomerFilter">

  <AccessPermissions>
    <string>Admin</string>
    <string>SalesRep</string>
  </AccessPermissions>

  <Buttons>
    <Button xsi:type="LinkButton"
            Ident="NewCustomerButton"
            FormIdent="Customer"
            TitleResourceKey="NewCustomer"
            IconCssClass="ph-plus"
            ColorType="Primary" />
    <Button xsi:type="GroupButton"
            Ident="ExportGroup"
            TitleResourceKey="Export"
            IconCssClass="ph-export">
      <Buttons>
        <Button xsi:type="DownloadButton"
                Ident="ExportExcel"
                TitleResourceKey="ExportExcel"
                SectionIdent="ExcelExport" />
        <Button xsi:type="PrintButton"
                Ident="PrintList"
                TitleResourceKey="Print"
                SectionIdent="PrintSection" />
      </Buttons>
    </Button>
  </Buttons>

  <DataSource FormIdent="Customer">
    <DataPermissions>
      <string>Admin</string>
      <string>SalesRep</string>
    </DataPermissions>
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" DataType="Number" />
      <Column Ident="Name" TitleResourceKey="Name" Width="25" IsDefaultSort="true" />
      <Column Ident="Email" TitleResourceKey="Email" Width="25" />
      <Column Ident="Phone" TitleResourceKey="Phone" Width="15" />
      <Column Ident="OrganizationName" TitleResourceKey="Organization" Width="20">
        <SQL>org.Name AS OrganizationName</SQL>
      </Column>
      <Column xsi:type="WorkFlowStateColumn"
              Ident="State"
              FormIdent="Customer"
              TitleResourceKey="Status"
              Width="15"
              IsColor="true" />
    </Columns>
    <Froms>
      <dsf:From Ident="org">
        <dsf:Columns>
          <dsf:string>OrganizationName</dsf:string>
        </dsf:Columns>
        <dsf:SQL>
          LEFT JOIN usr.Organization AS org ON org.ID = c.OrganizationID
        </dsf:SQL>
      </dsf:From>
    </Froms>
    <SQL>
      SELECT
        c.ID,
        c.Name,
        c.Email,
        c.Phone,
        c.State
        #ADDCOLUMN#
      FROM usr.Customer c
      #ADDFROM#
      WHERE c.State != @DeletedState
        AND #PERMISSION[Customer(c)]#
        #FILTER#
      ORDER BY c.Name
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="DeletedState" DataType="Number" Value="0" />
    </Parameters>
  </DataSource>

  <CountDataSource>
    <SQL>
      SELECT COUNT(c.ID)
      FROM usr.Customer c
      WHERE c.State != @DeletedState
        AND #PERMISSION[Customer(c)]#
        #FILTER#
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="DeletedState" DataType="Number" Value="0" />
    </Parameters>
  </CountDataSource>

  <Filter Ident="CustomerFilter">
    <Controls>
      <Control xsi:type="TextBoxControl"
               Ident="SearchName"
               TitleResourceKey="Search"
               DataType="String" />
      <Control xsi:type="DropDownListControl"
               Ident="State"
               TitleResourceKey="Status"
               DataType="Number">
        <DataBind DefaultTitleResourceKey="AllStatuses">
          <Columns>
            <Column Ident="Value" DataBindType="Value" />
            <Column Ident="Title" DataBindType="Title" />
          </Columns>
          <SQL>
            SELECT Value, Title
            FROM dbo.WorkFlowState
            WHERE FormIdent = 'Customer' AND Value != 0
          </SQL>
        </DataBind>
      </Control>
    </Controls>
    <FullText>
      <Columns>
        <string>Name</string>
        <string>Email</string>
      </Columns>
    </FullText>
  </Filter>

  <Sections>
    <Section xsi:type="ExportSection"
             Ident="ExcelExport"
             TitleResourceKey="ExportToExcel">
      <DataSource>
        <Columns>
          <Column Ident="Name" TitleResourceKey="Name" />
          <Column Ident="Email" TitleResourceKey="Email" />
          <Column Ident="Phone" TitleResourceKey="Phone" />
          <Column xsi:type="WorkFlowStateColumn"
                  Ident="State"
                  FormIdent="Customer"
                  TitleResourceKey="Status" />
        </Columns>
        <SQL>
          SELECT c.Name, c.Email, c.Phone, c.State
          FROM usr.Customer c
          WHERE c.State != 0
            AND #PERMISSION[Customer(c)]#
            #FILTER#
        </SQL>
      </DataSource>
    </Section>
  </Sections>

</DataView>
```

---

## XML Namespaces

Required namespaces for DataView:

```xml
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema"
xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
xmlns:dsf="http://www.gappex.com/sfp/DataSource/Froms"
xmlns:dvs="http://www.gappex.com/sfp/DataView/Settings"
```

---

## DO NOT - Common Mistakes

### DataSource Errors

```xml
<!-- WRONG: Missing FormIdent on DataSource -->
<DataSource>
  <Columns>...</Columns>
  <SQL>...</SQL>
</DataSource>

<!-- CORRECT: Always include FormIdent -->
<DataSource FormIdent="EntityName">
  <Columns>...</Columns>
  <SQL>...</SQL>
</DataSource>
```

### ID Column Errors

```xml
<!-- WRONG: ID column with TitleResourceKey and visible -->
<Column Ident="ID" TitleResourceKey="ID_Column" DataType="Number" IsSortable="true" />

<!-- CORRECT: ID column must be primary key and hidden -->
<Column Ident="ID" IsPrimaryKey="true" IsVisible="false" DataType="Number" />
```

### Column Header Attribute

```xml
<!-- WRONG: HeaderResourceKey does NOT exist -->
<Column Ident="Name" HeaderResourceKey="Name_Column" DataType="String" />

<!-- CORRECT: Use TitleResourceKey -->
<Column Ident="Name" TitleResourceKey="Name_Column" DataType="String" />
```

### State Column Errors

```xml
<!-- WRONG: Manual CASE expression for state -->
<Column Ident="StateName" DataType="String" />
<SQL>
  SELECT
    CASE
      WHEN t.State = 0 THEN N'Deleted'
      WHEN t.State = 1 THEN N'New'
    END AS StateName
</SQL>

<!-- CORRECT: Use WorkFlowStateColumn -->
<Column xsi:type="WorkFlowStateColumn"
        Ident="State"
        FormIdent="EntityName"
        TitleResourceKey="State_Column"
        IsColor="true" />
```

### Button Type Errors

```xml
<!-- WRONG: ActionButton for creating new record -->
<Button xsi:type="ActionButton"
        Ident="New"
        FormIdent="Movie"
        ActionType="FormSectionNew"
        CssClass="btn-primary" />

<!-- CORRECT: Use LinkButton for form navigation -->
<Button xsi:type="LinkButton"
        Ident="New"
        FormIdent="Movie"
        TitleResourceKey="New_Button"
        ColorType="Primary" />
```

### Styling Errors

```xml
<!-- WRONG: Using CssClass for button color -->
<Button xsi:type="ActionButton"
        Ident="Delete"
        CssClass="btn-danger" />

<!-- CORRECT: Use ColorType -->
<Button xsi:type="ActionButton"
        Ident="Delete"
        ColorType="Danger" />
```

---

## Required DataSource Configuration Checklist

- [ ] `FormIdent` attribute on DataSource element
- [ ] ID column with `IsPrimaryKey="true"` and `IsVisible="false"`
- [ ] At least one column with `IsDefaultSort="true"`
- [ ] State column using `WorkFlowStateColumn` xsi:type
- [ ] `TitleResourceKey` on visible columns (not `HeaderResourceKey`)
- [ ] DataType specified on all columns

---

## Valid DataView Button Types

| Button Type | Purpose | Key Attributes |
|-------------|---------|----------------|
| `LinkButton` | Navigate to form (New, Edit) | `FormIdent` |
| `ActionButton` | Execute action (Delete, Refresh) | `ActionType` |
| `DownloadButton` | Export file | `SectionIdent` |
| `PrintButton` | Print | `SectionIdent` |
| `ImportButton` | Import data | |
| `GlobalChangeButton` | Bulk edit | |
| `GroupButton` | Dropdown menu | `Buttons` child |

**NOT VALID in DataView:** `FormButton` (use in Form only)
