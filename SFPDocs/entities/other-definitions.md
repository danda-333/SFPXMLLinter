# Other IXMLDefinition Types Documentation

This document covers the remaining IXMLDefinition types that are less commonly used but important for system configuration and advanced features.

---

## AutomaticOperation

Defines automatic batch operations that run on multiple records. Uses the same Action types as WorkFlow.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |
| `FormIdent` | string | **Yes** | - | Form to execute operations on |
| `IsOnlyWorkFlowAction` | bool | No | false | Execute only WorkFlow actions without saving data |
| `IsComputePermission` | bool | No | false | Compute permissions before execution |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Source` | DataSource | SQL to get records for processing |
| `Actions` | List&lt;Action&gt; | Actions to execute (same as WorkFlow actions) |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<AutomaticOperation xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
                    Ident="SendReminders"
                    FormIdent="Task"
                    IsOnlyWorkFlowAction="false">
  <Source>
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" />
    </Columns>
    <SQL>
      SELECT ID
      FROM usr.Task
      WHERE [State] = 3
        AND DueDate = CAST(GETDATE() AS DATE)
        AND ReminderSent = 0
    </SQL>
  </Source>
  <Actions>
    <Action xsi:type="EmailAction" Ident="SendReminderEmail">
      <Recipients>
        <SQL>SELECT Email FROM dbo.Account WHERE ID = #AssignedUserID#</SQL>
      </Recipients>
      <Subject>Task Reminder: #Name#</Subject>
      <Body>
        <![CDATA[
          <p>Task "#Name#" is due today.</p>
        ]]>
      </Body>
    </Action>
    <Action xsi:type="SetValueAction" Ident="MarkSent">
      <Controls>
        <Control ControlIdent="ReminderSent" Value="1" />
      </Controls>
    </Action>
  </Actions>
</AutomaticOperation>
```

### Available Actions

AutomaticOperation supports the same actions as WorkFlow:
- ChangeStateAction, EmailAction, SMSAction, AlertAction
- SetValueAction, IFAction, SwitchCaseAction
- DLLExecuteAction, DLLSearchAction, DLLDownloadAction
- GenerateFileAction, GenerateFormAction, GenerateSubFormAction
- AccountConnectAction, UserPermissionReloadAction, UserLogOffAction
- AresAction, GeocodeAction, HistoryAction
- And more (see WorkFlow documentation)

---

## Filter

Standalone filter definition that can be referenced by DataViews and Reports.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |
| `Description` | string | No | "" | Filter description |
| `DescriptionResourceKey` | string | No | "" | Description from translations |
| `SetButtonTitle` | string | No | "" | Set button label |
| `SetButtonTitleResourceKey` | string | No | "" | Set button label from translations |
| `OpenButtonTitle` | string | No | "" | Open button label |
| `OpenButtonTitleResourceKey` | string | No | "" | Open button label from translations |
| `IsAdvancedSetting` | bool | No | false | Show advanced settings |
| `IsClickOutsideClose` | bool | No | true | Close when clicking outside |
| `IsApplyImmediately` | bool | No | false | Apply filter immediately on change |
| `IsShowButton` | bool | No | true | Show filter button |
| `IsShowSelected` | bool | No | true | Show selected filter values |
| `IsOnlyQueryString` | bool | No | false | Only use URL query string |
| `IsSave` | bool | No | false | Save filter to database |
| `Priority` | int | No | 0 | Sort priority |
| `FilterRenderType` | enum | No | Default | Render type (Default, Inside) |
| `IsSegmnetFilterToStorageIdent` | bool | No | false | Use segment in storage ident |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Controls` | List&lt;Control&gt; | Filter controls |
| `ExtensionControls` | List&lt;Control&gt; | Extended filter controls |
| `DirectFilterControls` | List&lt;Control&gt; | Direct (inline) filter controls |
| `FullText` | FullTextFilter | Full-text search configuration |
| `ResultList` | ResultListFilter | Result list configuration |
| `SelectedRow` | SelectedRowFilter | Selected rows configuration |
| `Sections` | List&lt;Section&gt; | Additional sections |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

### FullTextFilter

```xml
<FullText>
  <FilterConditions>
    <DataSource Ident="FullTextCondition">
      <SQL>
        SELECT 1 WHERE Name LIKE '%' + @FullText + '%'
           OR Description LIKE '%' + @FullText + '%'
      </SQL>
    </DataSource>
  </FilterConditions>
</FullText>
```

### Supported Controls for Filter

- TextBoxControl
- DropDownListControl
- AutoCompleteControl
- CheckBoxControl
- SwitchControl
- ListBoxControl
- TagControl
- CriteriaControl
- LabelControl
- EmptyControl

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Filter xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        Ident="EmployeeFilter"
        DescriptionResourceKey="EmployeeFilter_Description"
        IsApplyImmediately="false">

  <Controls>
    <Control xsi:type="DropDownListControl"
             Ident="Department"
             TitleResourceKey="Department_Filter">
      <DataBind>
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="Name" DataBindType="Title" />
        </Columns>
        <SQL>SELECT ID, Name FROM usr.Department WHERE [State] = 3</SQL>
      </DataBind>
      <FilterConditions>
        <DataSource>
          <SQL>DepartmentID = @Department</SQL>
        </DataSource>
      </FilterConditions>
    </Control>

    <Control xsi:type="CheckBoxControl"
             Ident="IsActive"
             TitleResourceKey="ShowActive_Filter"
             Default="1">
      <FilterConditions>
        <DataSource>
          <SQL>[State] = 3</SQL>
        </DataSource>
      </FilterConditions>
    </Control>
  </Controls>

  <DirectFilterControls>
    <Control xsi:type="TextBoxControl"
             Ident="QuickSearch"
             TitleResourceKey="QuickSearch_Filter">
      <FilterConditions>
        <DataSource>
          <SQL>Name LIKE '%' + @QuickSearch + '%'</SQL>
        </DataSource>
      </FilterConditions>
    </Control>
  </DirectFilterControls>

  <FullText>
    <FilterConditions>
      <DataSource>
        <SQL>
          Name LIKE '%' + @FullText + '%'
          OR Email LIKE '%' + @FullText + '%'
        </SQL>
      </DataSource>
    </FilterConditions>
  </FullText>
</Filter>
```

---

## Library

Defines SQL database objects (stored procedures, functions, views, table types).

📖 **For complete Library documentation with advanced examples and best practices, see [library.md](library.md)**

### Quick Reference

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `Ident` | string | **Yes** | Object name in database (without schema) |
| `LibraryType` | enum | **Yes** | StoredProcedure, Function, TableType, or View |
| `Description` | string | No | Human-readable description |

### Minimal Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_GetActiveUsers"
         LibraryType="StoredProcedure"
         Description="Returns all active users">
	<Command><![CDATA[
		#MODIFIER# PROCEDURE #NAME#
		AS
		BEGIN
			SET NOCOUNT ON;
			SELECT ID, UserName, Email
			FROM dbo.Account
			WHERE [State] = 1
		END
	]]></Command>
</Library>
```

**Important:**
- Always wrap `Command` in `<![CDATA[...]]>` to avoid XML parsing issues
- Use placeholders `#MODIFIER#` and `#NAME#` for automatic object management (recommended)
- Or use `CREATE OR ALTER` explicitly for idempotency
- Follow naming conventions: `usp_` (procedures), `fn_` (functions), `vw_` (views), `tt_` (table types)
- See [library.md](library.md) for complete documentation including placeholders

---

## Package

Groups resources (CSS, JS files) for reuse across definitions.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Sources` | List&lt;string&gt; | List of resource paths |

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="ChartPackage">
  <Sources>
    <string>~/lib/chart.js/chart.min.js</string>
    <string>~/lib/chart.js/chart.min.css</string>
    <string>~/AppAsset/Scripts/ChartHelpers.js</string>
  </Sources>
</Package>
```

### Usage in Other Definitions

```xml
<Dashboard Ident="MyDashboard">
  <PackageIdents>
    <string>ChartPackage</string>
    <string>DataTablesPackage</string>
  </PackageIdents>
  <!-- ... -->
</Dashboard>
```

---

## Variable

Defines system variables as key-value pairs.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Items` | List&lt;Item&gt; | Variable items |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

### Item Element

| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | Variable name |
| `Value` | string | Variable value |

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Variable xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          Ident="SystemSettings">
  <Items>
    <Item Ident="CompanyName" Value="Acme Corporation" />
    <Item Ident="SupportEmail" Value="support@acme.com" />
    <Item Ident="MaxFileSize" Value="10485760" />
    <Item Ident="DefaultLanguage" Value="cs-CZ" />
    <Item Ident="DateFormat" Value="dd.MM.yyyy" />
  </Items>
</Variable>
```

---

## TaskScheduler

Defines scheduled tasks that run automatically at specified times.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |
| `Title` | string | No | "" | Task title |
| `TitleResourceKey` | string | No | "" | Title from translations |
| `EncryptType` | EncryptTypes | No | PlainText | Encryption type |
| `IsRunUnderDiffUser` | bool | No | false | Run under different user |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Scheduler` | Scheduler | Scheduling configuration |
| `RunApps` | List&lt;RunApp&gt; | Applications to run |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

### Scheduler Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `TickInterval` | int | 60000 | Timer interval in milliseconds |

| Child Element | Type | Description |
|---------------|------|-------------|
| `Triggers` | List&lt;Trigger&gt; | Trigger definitions |

### DailyTrigger

| Attribute | Type | Description |
|-----------|------|-------------|
| `Time` | string | Time to run (HH:mm:ss format) |

### DLLRunApp

| Attribute | Type | Description |
|-----------|------|-------------|
| `Path` | string | Path to DLL file |
| `ClassType` | string | Full class name (namespace.class) |
| `DLLIdent` | string | DLL identifier from Configuration |

| Child Element | Type | Description |
|---------------|------|-------------|
| `Args` | List&lt;string&gt; | Command-line arguments |

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<TaskScheduler xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               Ident="DailyReportGenerator"
               Title="Daily Report Generator">
  <Scheduler TickInterval="60000">
    <Triggers>
      <Trigger xsi:type="DailyTrigger" Time="06:00:00" />
      <Trigger xsi:type="DailyTrigger" Time="18:00:00" />
    </Triggers>
  </Scheduler>
  <RunApps>
    <RunApp xsi:type="DLLRunApp"
            Path="~/bin/ReportGenerator.dll"
            ClassType="ReportGenerator.DailyReportTask"
            DLLIdent="ReportGeneratorDLL">
      <Args>
        <string>--output=/reports</string>
        <string>--format=pdf</string>
      </Args>
    </RunApp>
  </RunApps>
</TaskScheduler>
```

---

## Configuration

System-wide configuration with multiple section types.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Sections` | List&lt;Section&gt; | Configuration sections |

### Available Section Types

| Section Type | Description |
|--------------|-------------|
| `SegmentSection` | Segment/module configuration |
| `AccountSyncSection` | Account synchronization (AD/LDAP) |
| `SettingSection` | General settings |
| `EmailReciverSection` | Email receiving (IMAP/POP3) |
| `EmailSenderSection` | Email sending (SMTP) |
| `EmailSection` | Email general settings |
| `PermissionSection` | Permission configuration |
| `DataSyncSection` | Data synchronization |
| `ISDSSection` | ISDS (Czech data box) integration |
| `WebSection` | Web server settings |
| `DLLSection` | DLL/plugin configuration |
| `ExternalSettingSection` | External settings |
| `KioskSection` | Kiosk mode settings |
| `HeaderSection` | Page header settings |
| `LoginPageSection` | Login page customization |
| `APISection` | API configuration |
| `AutomaticOperationSection` | Automatic operations settings |
| `XMLDefinitionSection` | XML definition settings |
| `ImmediatelyRunAppSection` | Immediate app execution |
| `PWASection` | Progressive Web App settings |
| `PySection` | Python integration |
| `SLAWatchdogSection` | SLA monitoring |
| `ShortLinkSection` | Short URL configuration |
| `ComponentSection` | Component settings |

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Configuration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               Ident="Configuration">
  <Sections>
    <Section xsi:type="SegmentSection">
      <Segments>
        <Segment Ident="HR" Title="Human Resources" />
        <Segment Ident="Finance" Title="Finance" />
      </Segments>
    </Section>

    <Section xsi:type="EmailSenderSection"
             SMTPServer="smtp.company.com"
             SMTPPort="587"
             SMTPUsername="noreply@company.com"
             IsSSL="true" />

    <Section xsi:type="SettingSection">
      <Settings>
        <Setting Key="DefaultLanguage" Value="cs-CZ" />
        <Setting Key="SessionTimeout" Value="30" />
      </Settings>
    </Section>
  </Sections>
</Configuration>
```

---

## PartialRender

Defines reusable HTML/JSON content fragments that can be dynamically loaded via AJAX calls.

📖 **For complete PartialRender documentation with advanced examples, REST API, Razor engine, and JavaScript integration, see [partialrender.md](partialrender.md)**

### Quick Reference

| Feature | Description |
|---------|-------------|
| **Purpose** | Dynamic AJAX content, JSON APIs, dashboard widgets, modal dialogs |
| **Return Types** | HTML or JSON |
| **Template Engines** | Standard placeholders or Razor C# |
| **Endpoints** | `/AjaxAPI/PartialRender/Render`, `/PartialRender/{ident}/{section}` |
| **Data Sources** | Multiple SQL sources with parameters (QueryString, POST, Form) |
| **Permissions** | AccessPermissions, DenyPermissions (PartialRender + Section level) |
| **Caching** | Checksum support for cache invalidation (REST API) |

### Minimal Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<PartialRender xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
               Ident="UserProfileCard">
  <AccessPermissions>
    <string>ViewUsers</string>
  </AccessPermissions>

  <Sections>
    <Section xsi:type="ContentSection" Ident="ProfileCard">
      <Sources>
        <DataSource Ident="User">
          <Columns>
            <Column Ident="FullName" />
            <Column Ident="Email" />
          </Columns>
          <SQL><![CDATA[
            SELECT FullName, Email
            FROM usr.Employee WHERE ID = @UserID
          ]]></SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="UserID" DataType="Number"
                           SetDataType="QueryStringData" />
          </Parameters>
        </DataSource>
      </Sources>
      <HTMLTemplate><![CDATA[
        [FOR Source="User"]
        <div><h3>[%FullName%]</h3><p>[%Email%]</p></div>
        [/FOR]
      ]]></HTMLTemplate>
    </Section>
  </Sections>
</PartialRender>
```

**See [partialrender.md](partialrender.md) for:**
- Razor engine templates with C# code
- JSON API examples
- Dashboard widgets
- Modal dialog patterns
- Form-dependent content
- REST API with checksum
- Security best practices
- Troubleshooting guide

---

## Report

Defines printable/exportable reports with filters and sections.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |
| `SegmentType` | string | No | "" | Segment categorization |
| `Title` | string | No | "" | Report title |
| `TitleResourceKey` | string | No | "" | Title from translations |
| `Description` | string | No | "" | Report description |
| `DescriptionResourceKey` | string | No | "" | Description from translations |
| `Priority` | int | No | 0 | Sort order |
| `IsVisible` | bool | No | true | Show in report list |
| `IsReportBuilder` | bool | No | false | Enable report builder |
| `IsRazorEngine` | bool | No | false | Enable Razor engine |
| `IsFilterRequired` | bool | No | false | Require filter before display |
| `IsDefaultPDFExport` | bool | No | true | Show default PDF export |
| `IsWebData` | bool | No | false | Use clean data for exports |
| `CssClass` | string | No | "" | CSS class |
| `Color` | string | No | "" | Hex color |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Required permissions |
| `DenyPermissions` | List&lt;string&gt; | Denied permissions |
| `DataPermissions` | List&lt;string&gt; | Data-level permissions |
| `AccessDataSource` | DataSource | SQL-based access control |
| `Filter` | Filter | Embedded filter definition |
| `DefaultFilterIdent` | string | Reference to external Filter |
| `Sections` | List&lt;Section&gt; | Report content sections |
| `ColumnSettings` | List&lt;Column&gt; | Column configuration |
| `Widgets` | List&lt;Widget&gt; | Graph widgets |
| `Settings` | List&lt;Setting&gt; | Report settings |
| `ExternalCssRelativePaths` | List&lt;string&gt; | External CSS |
| `ExternalJavaScriptRelativePaths` | List&lt;string&gt; | External JS |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

### Available Section Types

- `ContentSection` - HTML content with data
- `ItemSection` - Report item section
- `ExportSection` - Export configuration
- `DOCXSection` - Word export
- `PDFSection` - PDF export
- `XLSXSection` - Excel export
- `FileTemplateSection` - File template
- `PrintSection` - Print configuration

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Report xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        Ident="EmployeeReport"
        SegmentType="HR"
        TitleResourceKey="EmployeeReport_Title"
        IsRazorEngine="true"
        IsFilterRequired="true">

  <AccessPermissions>
    <string>HR</string>
    <string>Manager</string>
  </AccessPermissions>

  <Filter>
    <Controls>
      <Control xsi:type="DropDownListControl"
               Ident="Department"
               TitleResourceKey="Department_Filter">
        <DataBind>
          <SQL>SELECT ID, Name FROM usr.Department WHERE [State] = 3</SQL>
        </DataBind>
        <FilterConditions>
          <DataSource><SQL>DepartmentID = @Department</SQL></DataSource>
        </FilterConditions>
      </Control>
    </Controls>
  </Filter>

  <Sections>
    <Section xsi:type="ContentSection" Ident="MainContent">
      <Sources>
        <DataSource Ident="Employees">
          <Columns>
            <Column Ident="ID" />
            <Column Ident="FullName" />
            <Column Ident="Email" />
            <Column Ident="Department" />
            <Column Ident="HireDate" />
          </Columns>
          <SQL>
            SELECT
              e.ID,
              e.FullName,
              e.Email,
              d.Name AS Department,
              e.HireDate
            FROM usr.Employee e
            LEFT JOIN usr.Department d ON e.DepartmentID = d.ID
            WHERE e.[State] = 3
              AND #FILTER#
            ORDER BY e.FullName
          </SQL>
        </DataSource>
      </Sources>
      <HTMLTemplate>
        <h1>[#EmployeeReport_Title#]</h1>
        <table class="report-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Hire Date</th>
            </tr>
          </thead>
          <tbody>
            [FOR Source="Employees"]
            <tr>
              <td>[%FullName%]</td>
              <td>[%Email%]</td>
              <td>[%Department%]</td>
              <td>[%HireDate%]</td>
            </tr>
            [/FOR]
          </tbody>
        </table>
      </HTMLTemplate>
    </Section>

    <Section xsi:type="PDFSection" Ident="PDFExport">
      <!-- PDF export configuration -->
    </Section>

    <Section xsi:type="XLSXSection" Ident="ExcelExport">
      <!-- Excel export configuration -->
    </Section>
  </Sections>
</Report>
```

---

## Component

Reusable UI component definition.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Required permissions |
| `DenyPermissions` | List&lt;string&gt; | Denied permissions |
| `Setting` | ComponentSetting | Component settings |
| `Sections` | List&lt;Section&gt; | Component content |
| `CssRelativePaths` | List&lt;string&gt; | CSS files |
| `JavaScriptRelativePaths` | List&lt;string&gt; | JavaScript files |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="UserAvatar">
  <CssRelativePaths>
    <string>~/AppAsset/Styles/avatar.css</string>
  </CssRelativePaths>

  <Sections>
    <Section xsi:type="ContentSection" Ident="Avatar">
      <Sources>
        <DataSource Ident="User">
          <SQL>SELECT Initials, AvatarColor FROM dbo.Account WHERE ID = @UserID</SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="UserID"
                           DataType="Number"
                           ConstantType="UserID" />
          </Parameters>
        </DataSource>
      </Sources>
      <HTMLTemplate>
        [FOR Source="User"]
        <div class="avatar" style="background-color: [%AvatarColor%]">
          [%Initials%]
        </div>
        [/FOR]
      </HTMLTemplate>
    </Section>
  </Sections>
</Component>
```

---

## Course

Defines interactive learning courses with steps.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |
| `FormIdent` | string | No | "" | Associated form |
| `IsRazorEngine` | bool | No | false | Enable Razor engine |
| `IsShowFinishButton` | bool | No | false | Show finish button |
| `IsDefaultLayout` | bool | No | false | Use standard page layout |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Required permissions |
| `Source` | DataSource | Course steps data |
| `Sections` | List&lt;Section&gt; | Course sections (HeaderSection, InfoSection) |
| `HTMLTemplate` | string | Main HTML template |
| `Settings` | List&lt;Setting&gt; | Razor engine settings |
| `FinishCondition` | DataSource | Completion condition |
| `CourseStateDataSource` | DataSource | Current course state |
| `DictionaryHintDataSource` | DataSource | Dictionary hints |
| `ExternalCssRelativePaths` | List&lt;string&gt; | External CSS |
| `ExternalJavaScriptRelativePaths` | List&lt;string&gt; | External JS |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

### Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Course xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        Ident="OnboardingCourse"
        FormIdent="Employee"
        IsShowFinishButton="true">

  <AccessPermissions>
    <string>NewEmployee</string>
  </AccessPermissions>

  <Source>
    <Columns>
      <Column Ident="StepID" />
      <Column Ident="Title" />
      <Column Ident="Content" />
      <Column Ident="OrderNumber" />
    </Columns>
    <SQL>
      SELECT ID AS StepID, Title, Content, OrderNumber
      FROM usr.CourseStep
      WHERE CourseIdent = 'OnboardingCourse'
      ORDER BY OrderNumber
    </SQL>
  </Source>

  <Sections>
    <Section xsi:type="HeaderSection" Ident="Header">
      <Title>Welcome to the Company</Title>
    </Section>
  </Sections>

  <HTMLTemplate>
    <div class="course-container">
      <div class="course-progress">
        Step @Model.CurrentStep of @Model.TotalSteps
      </div>
      <div class="course-content">
        @Model.CurrentContent
      </div>
    </div>
  </HTMLTemplate>

  <FinishCondition>
    <SQL>
      SELECT CASE WHEN CompletedSteps = TotalSteps THEN 1 ELSE 0 END
      FROM usr.CourseProgress
      WHERE UserID = @UserID AND CourseIdent = 'OnboardingCourse'
    </SQL>
  </FinishCondition>
</Course>
```

---

## IXMLDefinition Summary

| Type | Purpose | Primary Use Case | Documentation |
|------|---------|------------------|----------------|
| `Form` | Data entry forms | CRUD operations | [form.md](form.md) |
| `WorkFlow` | Business logic and state management | Form state transitions | [workflow.md](workflow.md) |
| `DataView` | Data display grids | Listing and searching | [dataview.md](dataview.md) |
| `Dashboard` | Overview pages | Widgets and statistics | [dashboard.md](dashboard.md) |
| `Filter` | Reusable filters | DataView/Report filtering | [filter.md](filter.md) |
| `Configuration` | System settings | Global configuration | [configuration.md](configuration.md) |
| `Library` | Database objects | SQL procedures/functions | **[library.md](library.md)** ⭐ |
| `AutomaticOperation` | Batch operations | Scheduled or bulk updates | this document |
| `Package` | Resource bundles | CSS/JS grouping | this document |
| `Variable` | System variables | Configuration values | this document |
| `TaskScheduler` | Scheduled tasks | Automated jobs | this document |
| `PartialRender` | AJAX content | Dynamic HTML/JSON loading | **[partialrender.md](partialrender.md)** ⭐ |
| `Report` | Printable reports | PDF/Excel generation | this document |
| `Component` | Reusable UI parts | UI components | this document |
| `Course` | Learning content | Training modules | this document |
