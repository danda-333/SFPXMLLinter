# Dashboard Documentation

## Overview

Dashboard je entita typu `IXMLDefinition` sloužící k vytváření přehledových stránek (nástěnek) s widgety, grafy, kalendáři a vlastním HTML obsahem.

## Root Element

```xml
<?xml version="1.0" encoding="utf-8"?>
<Dashboard xmlns:xsd="http://www.w3.org/2001/XMLSchema"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="MyDashboard"
           SegmentType="Dashboard">
  ...
</Dashboard>
```

---

## Dashboard Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier for the dashboard |
| `SegmentType` | string | No | "" | Segment type for categorization |
| `IsRazorEngine` | bool | No | false | Enable Razor engine for HTMLTemplate |
| `IsShowMenu` | bool | No | true | Show left navigation menu |

---

## Dashboard Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Permissions required to access dashboard |
| `DenyPermissions` | List&lt;string&gt; | Permissions that deny access |
| `DataPermissions` | List&lt;string&gt; | Data-level permissions |
| `Widgets` | List&lt;Widget&gt; | Widget definitions |
| `HTMLTemplate` | string | Main layout HTML template |
| `Controls` | List&lt;Control&gt; | Filter controls (FilterControl, FilterSelectedControl, SearchBoxControl) |
| `Settings` | List&lt;Setting&gt; | Razor engine settings |
| `PackageIdents` | List&lt;string&gt; | Package identifiers to include |
| `ExternalCssRelativePaths` | List&lt;string&gt; | External CSS file paths |
| `ExternalJavaScriptRelativePaths` | List&lt;string&gt; | External JavaScript file paths |
| `Components` | List&lt;RegistrationComponent&gt; | Registered components |

---

## Widget Types

Dashboard supports 4 widget types:

### 1. ContentWidget

Widget for displaying custom HTML content with data from SQL sources.

#### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | Widget identifier |
| `IsRazorEngine` | bool | false | Enable Razor engine |

#### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Sources` | List&lt;DataSource&gt; | Data sources for the widget |
| `HTMLTemplate` | string | HTML template with placeholders |
| `Settings` | List&lt;Setting&gt; | Razor engine settings |

#### Example

```xml
<Widget xsi:type="ContentWidget" Ident="EmployeeInfo">
  <Sources>
    <DataSource Ident="Main">
      <Columns>
        <Column Ident="ID"/>
        <Column Ident="FullName"/>
        <Column Ident="Email"/>
      </Columns>
      <SQL>
        SELECT ID, FullName, Email
        FROM usr.Employee
        WHERE [State] = @ActiveState
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:ValueParameter"
                       Ident="ActiveState"
                       DataType="Number"
                       Value="3" />
      </Parameters>
    </DataSource>
  </Sources>
  <HTMLTemplate>
    <div class="card">
      <div class="card-header">Employees</div>
      <div class="card-body">
        [FOR Source="Main"]
        <div class="employee-row">
          <span>[%FullName%]</span>
          <span>[%Email%]</span>
        </div>
        [/FOR]
      </div>
    </div>
  </HTMLTemplate>
</Widget>
```

---

### 2. TabWidget

Widget with tabbed layout containing nested widgets.

#### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | Widget identifier |
| `CssClass` | string | "" | CSS class for tab container |
| `ItemCssClass` | string | "" | CSS class for each tab item |

#### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `TabDataSource` | DataSource | Data source for dynamic tabs |
| `Tabs` | List&lt;Tab&gt; | Static tab definitions |
| `Widgets` | List&lt;Widget&gt; | Nested widgets (ContentWidget, GraphWidget, CalendarWidget, TabWidget) |

#### Tab Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | Tab identifier |
| `IsRazorEngine` | bool | false | Enable Razor engine |

| Child Element | Type | Description |
|---------------|------|-------------|
| `HTMLTemplate` | string | Tab content HTML template |
| `Settings` | List&lt;Setting&gt; | Razor engine settings |

#### Example

```xml
<Widget xsi:type="TabWidget" Ident="MainTabs">
  <TabDataSource>
    <SQL>
      SELECT 'Tab1' AS Ident, 'First Tab' AS Title, 'Tab1' AS TemplateIdent
      UNION ALL
      SELECT 'Tab2' AS Ident, 'Second Tab' AS Title, 'Tab2' AS TemplateIdent
    </SQL>
  </TabDataSource>
  <Tabs>
    <Tab Ident="Tab1">
      <HTMLTemplate>
        <div class="row">
          <div class="col-md-6">
            <Widget ID="Widget1" />
          </div>
          <div class="col-md-6">
            <Widget ID="Widget2" />
          </div>
        </div>
      </HTMLTemplate>
    </Tab>
    <Tab Ident="Tab2">
      <HTMLTemplate>
        <Widget ID="Widget3" />
      </HTMLTemplate>
    </Tab>
  </Tabs>
  <Widgets>
    <Widget xsi:type="ContentWidget" Ident="Widget1">
      <!-- Widget content -->
    </Widget>
    <Widget xsi:type="ContentWidget" Ident="Widget2">
      <!-- Widget content -->
    </Widget>
    <Widget xsi:type="ContentWidget" Ident="Widget3">
      <!-- Widget content -->
    </Widget>
  </Widgets>
</Widget>
```

---

### 3. CalendarWidget

Widget for displaying calendar with events.

#### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | Widget identifier |
| `IsDetail` | bool | true | Enable click-through to detail |

#### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataSource` | DataSource | Data source for calendar events |
| `Settings` | List&lt;CalendarSetting&gt; | Calendar settings |

#### Calendar DataSource Columns

Calendar events require specific columns:

| Column | Type | Description |
|--------|------|-------------|
| `ID` | Number | Event ID (for detail link) |
| `Title` | String | Event title |
| `Start` | DateTime | Event start date/time |
| `End` | DateTime | Event end date/time |
| `AllDay` | Bool | All-day event flag |
| `Color` | String | Event background color |
| `TextColor` | String | Event text color |
| `Url` | String | Custom URL for event |
| `ResourceId` | String | Resource identifier (for resource views) |

#### DefaultCalendarSetting

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `ViewType` | ViewTypes | None | Default view type |
| `DefaultView` | string | "" | Default view name |
| `DefaultDate` | string | "" | Default date (SQL expression) |
| `MinTime` | string | "" | Minimum time displayed (e.g., "08:00:00") |
| `MaxTime` | string | "" | Maximum time displayed (e.g., "18:00:00") |
| `SlotDuration` | string | "" | Time slot duration (e.g., "00:15:00") |
| `AspectRatio` | decimal | 1.35 | Width-to-height ratio |
| `IsFixedWeekCount` | bool | true | Show fixed 6 weeks |
| `FormIdent` | string | "" | Form ident for creating new events |
| `DisplayEventTime` | string | "" | Show event time |
| `DisplayEventEnd` | bool | true | Show event end time |
| `IsHTMLRender` | bool | false | Render event as HTML |
| `IsAllDaySlot` | bool | false | Show all-day slot |
| `IsScrollToDate` | bool | false | Scroll to current date |
| `IsSortByViewSettings` | bool | false | Sort views by ViewSettings order |
| `IsShowHolidayName` | bool | false | Show holiday names |

#### ViewTypes Enum

| Value | Description |
|-------|-------------|
| `None` | No specific view |
| `DayGridMonth` | Monthly grid view |
| `DayGridWeek` | Weekly grid view |
| `DayGridDay` | Daily grid view |
| `DayGridYear` | Yearly grid view (all days) |
| `TimeGridWeek` | Weekly time grid |
| `TimeGridDay` | Daily time grid |
| `ResourceTimelineDay` | Daily resource timeline |
| `ResourceTimelineWeek` | Weekly resource timeline |
| `ResourceTimelineMonth` | Monthly resource timeline |
| `ResourceTimeGridDay` | Vertical resource grid |
| `MultiMonthYear` | All months in year |

#### HideViewTypeCalendarSetting

Hides specific view type from calendar:

```xml
<Settings>
  <Setting xsi:type="HideViewTypeCalendarSetting" ViewType="ResourceTimelineMonth" />
</Settings>
```

#### Example

```xml
<Widget xsi:type="CalendarWidget" Ident="EventCalendar" IsDetail="true">
  <DataSource>
    <Columns>
      <Column Ident="ID" />
      <Column Ident="Title" />
      <Column Ident="Start" />
      <Column Ident="End" />
      <Column Ident="AllDay" />
      <Column Ident="Color" />
    </Columns>
    <SQL>
      SELECT
        ID,
        Name AS Title,
        StartDate AS Start,
        EndDate AS [End],
        IsAllDay AS AllDay,
        ColorCode AS Color
      FROM usr.Event
      WHERE [State] = 3
    </SQL>
  </DataSource>
  <Settings>
    <Setting xsi:type="DefaultCalendarSetting"
             ViewType="DayGridMonth"
             MinTime="08:00:00"
             MaxTime="20:00:00"
             FormIdent="Event" />
    <Setting xsi:type="HideViewTypeCalendarSetting" ViewType="ResourceTimelineMonth" />
  </Settings>
</Widget>
```

---

### 4. GraphWidget

Widget for displaying charts and graphs.

#### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | Widget identifier |

#### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `JsonSources` | List&lt;GraphDataSource&gt; | Data sources for JSON generation |
| `JsonContent` | GraphJsonContent | Configuration for JSON content with HTMLTemplate |

#### GraphDataSource

Extends DataSource with additional attribute:

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsRowAsDataItem` | bool | false | Each row is one data item (true) or each column (false) |

#### GraphJsonContent

| Attribute | Type | Description |
|-----------|------|-------------|
| `IsRenderRazorEngine` | bool | Enable Razor engine |

| Child Element | Type | Description |
|---------------|------|-------------|
| `Sources` | List&lt;DataSource&gt; | Data sources |
| `HTMLTemplate` | string | Template for rendering chart JSON |
| `Settings` | List&lt;Setting&gt; | Razor engine settings |

#### Example

```xml
<Widget xsi:type="GraphWidget" Ident="SalesChart">
  <JsonSources>
    <DataSource Ident="ChartData" IsRowAsDataItem="true">
      <Columns>
        <Column Ident="Month" />
        <Column Ident="Sales" />
        <Column Ident="Target" />
      </Columns>
      <SQL>
        SELECT
          FORMAT(OrderDate, 'yyyy-MM') AS Month,
          SUM(Amount) AS Sales,
          100000 AS Target
        FROM usr.Orders
        WHERE YEAR(OrderDate) = YEAR(GETDATE())
        GROUP BY FORMAT(OrderDate, 'yyyy-MM')
        ORDER BY Month
      </SQL>
    </DataSource>
  </JsonSources>
  <JsonContent IsRenderRazorEngine="true">
    <Sources>
      <DataSource Ident="Config">
        <SQL>SELECT 'Sales Overview' AS ChartTitle</SQL>
      </DataSource>
    </Sources>
    <HTMLTemplate>
      {
        "type": "line",
        "data": {
          "labels": [@Model.JsonArray("ChartData", "Month")],
          "datasets": [{
            "label": "Sales",
            "data": [@Model.JsonArray("ChartData", "Sales")]
          }]
        }
      }
    </HTMLTemplate>
  </JsonContent>
</Widget>
```

---

## HTMLTemplate Syntax

### Widget Placeholder

Reference widgets in main HTMLTemplate:

```xml
<HTMLTemplate>
  <div class="row">
    <div class="col-md-6">
      <Widget ID="WidgetIdent" />
    </div>
    <div class="col-md-6">
      <Widget ID="AnotherWidget" />
    </div>
  </div>
</HTMLTemplate>
```

### FOR Loop

Iterate over DataSource rows:

```xml
[FOR Source="DataSourceIdent"]
  <div>[%ColumnName%]</div>
[/FOR]
```

### IF Condition

Conditional rendering:

```xml
[IF('[%ColumnName%]'=='')]
  <span>Empty</span>
[ELSE]
  <span>[%ColumnName%]</span>
[/IF]
```

### Column Values

Display column values:

```xml
[%ColumnName%]
```

### Translation Keys

Display translated text:

```xml
[#TranslationKey_Context#]
```

### Script Nonce Token

For inline scripts (security):

```xml
<script nonce="[@SCRIPTTOKENNONCE@]">
  // Your JavaScript code
</script>
```

---

## Razor Engine

When `IsRazorEngine="true"`, you can use Razor syntax:

### Basic Razor Syntax

```xml
<HTMLTemplate>
  @{
    var data = Model.SingleObject(Model.Data.Main);
  }

  <div>@data.FullName</div>

  @if(data.IsActive == 1)
  {
    <span class="badge badge-success">Active</span>
  }

  @foreach(var item in Model.Data.Items)
  {
    <div>@item.Name</div>
  }
</HTMLTemplate>
```

### RazorEngineSetting

Configure Razor engine:

```xml
<Settings>
  <Setting xsi:type="RazorEngineSetting">
    <Usings>
      <string>System.Linq</string>
      <string>System.Collections.Generic</string>
    </Usings>
    <Assemblies>
      <string>System.Core</string>
    </Assemblies>
  </Setting>
</Settings>
```

---

## External Resources

### CSS Files

```xml
<ExternalCssRelativePaths>
  <string>~/AppAsset/Styles/CustomDashboard.css</string>
</ExternalCssRelativePaths>
```

### JavaScript Files

```xml
<ExternalJavaScriptRelativePaths>
  <string>~/AppAsset/Scripts/CustomDashboard.js</string>
</ExternalJavaScriptRelativePaths>
```

---

## Permissions

### AccessPermissions

Users with these permissions can access:

```xml
<AccessPermissions>
  <string>Dashboard</string>
  <string>Admin</string>
</AccessPermissions>
```

### DenyPermissions

Users with these permissions are denied access (takes precedence):

```xml
<DenyPermissions>
  <string>Guest</string>
  <string>Inactive</string>
</DenyPermissions>
```

### DataPermissions

Data-level permissions for filtering:

```xml
<DataPermissions>
  <string>DashboardData</string>
</DataPermissions>
```

---

## Complete Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Dashboard xmlns:xsd="http://www.w3.org/2001/XMLSchema"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="HRDashboard"
           SegmentType="Dashboard"
           IsRazorEngine="true">

  <AccessPermissions>
    <string>HR</string>
    <string>Manager</string>
  </AccessPermissions>

  <DenyPermissions>
    <string>Guest</string>
  </DenyPermissions>

  <ExternalCssRelativePaths>
    <string>~/AppAsset/Styles/Dashboard.css</string>
  </ExternalCssRelativePaths>

  <ExternalJavaScriptRelativePaths>
    <string>~/AppAsset/Scripts/Dashboard.js</string>
  </ExternalJavaScriptRelativePaths>

  <Widgets>
    <!-- Quick Links Widget -->
    <Widget xsi:type="ContentWidget" Ident="QuickLinks">
      <HTMLTemplate>
        <div class="card">
          <div class="card-header">Quick Links</div>
          <div class="card-body">
            <a href="~/Form/Index/Employee" class="btn btn-primary">
              New Employee
            </a>
            <a href="~/DataView/Index/EmployeeAllView" class="btn btn-secondary">
              View Employees
            </a>
          </div>
        </div>
      </HTMLTemplate>
    </Widget>

    <!-- Statistics Widget with Data -->
    <Widget xsi:type="ContentWidget" Ident="Statistics">
      <Sources>
        <DataSource Ident="Stats">
          <Columns>
            <Column Ident="TotalEmployees" />
            <Column Ident="ActiveEmployees" />
            <Column Ident="NewThisMonth" />
          </Columns>
          <SQL>
            SELECT
              COUNT(*) AS TotalEmployees,
              SUM(CASE WHEN [State] = 3 THEN 1 ELSE 0 END) AS ActiveEmployees,
              SUM(CASE WHEN CreatedDate >= DATEADD(MONTH, -1, GETDATE()) THEN 1 ELSE 0 END) AS NewThisMonth
            FROM usr.Employee
            WHERE [State] != 0
          </SQL>
        </DataSource>
      </Sources>
      <HTMLTemplate>
        [FOR Source="Stats"]
        <div class="row">
          <div class="col-md-4">
            <div class="stat-card">
              <h3>[%TotalEmployees%]</h3>
              <p>Total Employees</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="stat-card">
              <h3>[%ActiveEmployees%]</h3>
              <p>Active</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="stat-card">
              <h3>[%NewThisMonth%]</h3>
              <p>New This Month</p>
            </div>
          </div>
        </div>
        [/FOR]
      </HTMLTemplate>
    </Widget>

    <!-- Calendar Widget -->
    <Widget xsi:type="CalendarWidget" Ident="EventCalendar" IsDetail="true">
      <DataSource>
        <Columns>
          <Column Ident="ID" />
          <Column Ident="Title" />
          <Column Ident="Start" />
          <Column Ident="End" />
          <Column Ident="Color" />
        </Columns>
        <SQL>
          SELECT
            ID,
            Name AS Title,
            StartDate AS Start,
            EndDate AS [End],
            '#3498db' AS Color
          FROM usr.Event
          WHERE [State] = 3
        </SQL>
      </DataSource>
      <Settings>
        <Setting xsi:type="DefaultCalendarSetting"
                 ViewType="DayGridMonth"
                 FormIdent="Event" />
      </Settings>
    </Widget>
  </Widgets>

  <HTMLTemplate>
    <div class="dashboard-container">
      <div class="row mb-4">
        <div class="col-md-12">
          <Widget ID="QuickLinks" />
        </div>
      </div>
      <div class="row mb-4">
        <div class="col-md-12">
          <Widget ID="Statistics" />
        </div>
      </div>
      <div class="row">
        <div class="col-md-12">
          <Widget ID="EventCalendar" />
        </div>
      </div>
    </div>
  </HTMLTemplate>
</Dashboard>
```

---

## Widget Hierarchy Summary

```
Dashboard
├── Widgets
│   ├── ContentWidget
│   │   ├── Sources (DataSource[])
│   │   ├── HTMLTemplate
│   │   └── Settings
│   ├── TabWidget
│   │   ├── TabDataSource
│   │   ├── Tabs (Tab[])
│   │   │   ├── Ident
│   │   │   ├── HTMLTemplate
│   │   │   └── Settings
│   │   └── Widgets (nested widgets)
│   ├── CalendarWidget
│   │   ├── DataSource
│   │   └── Settings (CalendarSetting[])
│   │       ├── DefaultCalendarSetting
│   │       └── HideViewTypeCalendarSetting
│   └── GraphWidget
│       ├── JsonSources (GraphDataSource[])
│       └── JsonContent
│           ├── Sources
│           ├── HTMLTemplate
│           └── Settings
├── HTMLTemplate (main layout)
├── Controls (FilterControl, FilterSelectedControl, SearchBoxControl)
├── Settings (RazorEngineSetting)
├── AccessPermissions
├── DenyPermissions
├── DataPermissions
├── ExternalCssRelativePaths
└── ExternalJavaScriptRelativePaths
```
