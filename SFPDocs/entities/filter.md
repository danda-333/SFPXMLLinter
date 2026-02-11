# Filter Documentation

## Overview

Filter je samostatná XML definice pro filtrování dat v DataView a Report. Umožňuje definovat filtrovací kontroly, fulltext vyhledávání a pokročilé filtrovací podmínky. Filter lze definovat inline v DataView/Report nebo jako samostatný soubor pro znovupoužití.

## Root Element

```xml
<?xml version="1.0" encoding="utf-8"?>
<Filter xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        Ident="MyFilter">
  <Controls>
    <!-- Filter controls -->
  </Controls>
  <FullText>
    <!-- Full-text search configuration -->
  </FullText>
</Filter>
```

---

## Filter Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier |
| `Description` | string | No | "" | Filter description |
| `DescriptionResourceKey` | string | No | "" | Description from translations |
| `SetButtonTitle` | string | No | "" | "Apply" button label |
| `SetButtonTitleResourceKey` | string | No | "" | Button label from translations |
| `OpenButtonTitle` | string | No | "" | "Open filter" button label |
| `OpenButtonTitleResourceKey` | string | No | "" | Button label from translations |
| `IsAdvancedSetting` | bool | No | false | Show advanced settings option |
| `IsClickOutsideClose` | bool | No | true | Close filter dialog on outside click |
| `IsApplyImmediately` | bool | No | false | Apply filter immediately on change |
| `IsShowButton` | bool | No | true | Show filter button |
| `IsShowSelected` | bool | No | true | Show selected filter values |
| `IsOnlyQueryString` | bool | No | false | Only use URL query parameters |
| `IsSave` | bool | No | false | Save filter to database |
| `Priority` | int | No | 0 | Sort priority |
| `FilterRenderType` | enum | No | Default | Render type (Default, Inside) |
| `IsSegmnetFilterToStorageIdent` | bool | No | false | Include segment in storage key |

---

## Filter Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Controls` | List&lt;Control&gt; | Main filter controls (displayed in filter dialog) |
| `ExtensionControls` | List&lt;Control&gt; | Extended filter controls (user can add) |
| `DirectFilterControls` | List&lt;Control&gt; | Inline filter controls (displayed above grid) |
| `FullText` | FullTextFilter | Full-text search configuration |
| `ResultList` | ResultListFilter | Result list filter configuration |
| `SelectedRow` | SelectedRowFilter | Selected rows filter configuration |
| `Sections` | List&lt;Section&gt; | Additional content sections |
| `PackageIdents` | List&lt;string&gt; | Package dependencies |

---

## Supported Control Types

Filter supports these control types:

| Control Type | Description | Typical Use |
|--------------|-------------|-------------|
| `TextBoxControl` | Text input | Text search, date range |
| `DropDownListControl` | Dropdown select | Single value selection |
| `AutoCompleteControl` | Autocomplete input | Large datasets with search |
| `ListBoxControl` | Multi-select list | Multiple value selection |
| `CheckBoxControl` | Checkbox | Boolean filter |
| `SwitchControl` | Toggle switch | Boolean filter |
| `TagControl` | Tag input | Multiple text values |
| `CriteriaControl` | Dynamic criteria builder | Advanced filtering |
| `LabelControl` | Label/separator | Visual grouping |
| `EmptyControl` | Empty placeholder | Layout spacing |

---

## FilterConditions

Every filter control must have `FilterConditions` that define the SQL WHERE clause condition.

### Basic Structure

```xml
<Control xsi:type="DropDownListControl" Ident="Status" DataType="Number" TitleResourceKey="Status_Filter">
  <DataBind>
    <!-- DataBind configuration -->
  </DataBind>
  <FilterConditions>
    <DataSource>
      <SQL>TableAlias.[Status] = @Status</SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### FilterConditions Rules

1. **SQL Fragment**: Write only the WHERE condition fragment (without WHERE keyword)
2. **Parameter Reference**: Use `@ControlIdent` to reference the control value
3. **Table Alias**: Use the alias defined in DataView's DataSource
4. **Multiple Conditions**: Can include AND/OR operators

### Common Patterns

**Equality:**
```xml
<FilterConditions>
  <DataSource>
    <SQL>tbl.[DepartmentID] = @DepartmentID</SQL>
  </DataSource>
</FilterConditions>
```

**LIKE Search:**
```xml
<FilterConditions>
  <DataSource>
    <SQL>tbl.[Name] LIKE '%' + @Name + '%'</SQL>
  </DataSource>
</FilterConditions>
```

**IN Clause (for multi-select):**
```xml
<FilterConditions>
  <DataSource>
    <SQL>tbl.[State] IN (SELECT ID FROM @State)</SQL>
  </DataSource>
</FilterConditions>
```

**Date Range:**
```xml
<FilterConditions>
  <DataSource>
    <SQL>tbl.[CreatedDate] >= @DateFrom</SQL>
  </DataSource>
</FilterConditions>
```

**NULL Handling:**
```xml
<FilterConditions>
  <DataSource>
    <SQL>ISNULL(tbl.[IsActive], 0) = @IsActive</SQL>
  </DataSource>
</FilterConditions>
```

**Complex Condition:**
```xml
<FilterConditions>
  <DataSource>
    <SQL>
      (
        tbl.[DateFrom] >= @DateFrom
        AND ISNULL(tbl.[DateTo], '3000-01-01') >= @DateFrom
      )
    </SQL>
  </DataSource>
</FilterConditions>
```

---

## Control Examples

### DropDownListControl

Single value selection from dropdown.

```xml
<Control xsi:type="DropDownListControl"
         Ident="DepartmentID"
         DataType="Number"
         TitleResourceKey="Department_Filter">
  <DataBind DefaultTitleResourceKey="SelectAll" DefaultValue="">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name
      FROM usr.Department
      WHERE [State] != 0
      ORDER BY Name
    </SQL>
  </DataBind>
  <FilterConditions>
    <DataSource>
      <SQL>emp.[DepartmentID] = @DepartmentID</SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### ListBoxControl (Multi-select)

Multiple value selection.

```xml
<Control xsi:type="ListBoxControl"
         Ident="State"
         DataType="NumberList"
         TitleResourceKey="State_Filter">
  <ListItems>
    <ListItem TitleResourceKey="Draft_State" Value="10" />
    <ListItem TitleResourceKey="Pending_State" Value="20" />
    <ListItem TitleResourceKey="Approved_State" Value="30" />
    <ListItem TitleResourceKey="Rejected_State" Value="40" />
  </ListItems>
  <FilterConditions>
    <DataSource>
      <SQL>tbl.[State] IN (SELECT ID FROM @State)</SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### AutoCompleteControl

Search with autocomplete for large datasets.

```xml
<Control xsi:type="AutoCompleteControl"
         Ident="EmployeeID"
         DataType="Number"
         TitleResourceKey="Employee_Filter">
  <!-- Initial empty state - shows first N records -->
  <EmptyDataBind DefaultTitleResourceKey="SelectValue">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT TOP 20 ID, FullName
      FROM usr.Employee
      WHERE [State] = 3
      ORDER BY FullName
    </SQL>
  </EmptyDataBind>

  <!-- Search - triggered when user types -->
  <DataBind DefaultTitleResourceKey="SelectValue">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, FullName
      FROM usr.Employee
      WHERE FullName LIKE @EmployeeID
        AND [State] = 3
      ORDER BY FullName
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="EmployeeID"
                     DataType="String"
                     LikeType="Both" />
    </Parameters>
  </DataBind>

  <!-- Selected value display -->
  <SelectedDataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, FullName
      FROM usr.Employee
      WHERE ID = @EmployeeID
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="EmployeeID"
                     DataType="Number" />
    </Parameters>
  </SelectedDataBind>

  <FilterConditions>
    <DataSource>
      <SQL>tbl.[EmployeeID] = @EmployeeID</SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### AutoCompleteControl with Dependencies

Cascading filter - value depends on another control.

```xml
<Control xsi:type="AutoCompleteControl"
         Ident="CityID"
         DataType="Number"
         TitleResourceKey="City_Filter"
         IsFakeReadOnly="true">
  <DataBind DefaultTitleResourceKey="SelectValue">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name
      FROM usr.City
      WHERE CountryID = @CountryID
        AND Name LIKE @CityID
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="CityID"
                     DataType="String"
                     LikeType="Both" />
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="CountryID"
                     DataType="Number" />
    </Parameters>
  </DataBind>

  <SelectedDataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name FROM usr.City WHERE ID = @CityID
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="CityID"
                     DataType="Number" />
    </Parameters>
  </SelectedDataBind>

  <!-- Auto-populate when CountryID changes -->
  <DefaultDependencyDataBind>
    <Dependencies>
      <string>CountryID</string>
    </Dependencies>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT TOP 1 ID, Name
      FROM usr.City
      WHERE CountryID = @CountryID
      ORDER BY IsDefault DESC, Name
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="CountryID"
                     DataType="Number" />
    </Parameters>
  </DefaultDependencyDataBind>

  <FilterConditions>
    <DataSource>
      <SQL>tbl.[CityID] = @CityID</SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### TextBoxControl (Date)

Date input for date range filtering.

```xml
<Control xsi:type="TextBoxControl"
         Ident="DateFrom"
         DataType="DateTime"
         TitleResourceKey="DateFrom_Filter">
  <FilterConditions>
    <DataSource>
      <SQL>tbl.[CreatedDate] >= @DateFrom</SQL>
    </DataSource>
  </FilterConditions>
</Control>

<Control xsi:type="TextBoxControl"
         Ident="DateTo"
         DataType="DateTime"
         TitleResourceKey="DateTo_Filter">
  <FilterConditions>
    <DataSource>
      <SQL>tbl.[CreatedDate] <= @DateTo</SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### SwitchControl

Boolean toggle filter.

```xml
<Control xsi:type="SwitchControl"
         Ident="IsActive"
         TitleResourceKey="ShowActive_Filter">
  <FilterConditions>
    <DataSource>
      <SQL>ISNULL(tbl.[IsActive], 0) = @IsActive</SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### CheckBoxControl with Default

Checkbox with default value.

```xml
<Control xsi:type="CheckBoxControl"
         Ident="ShowArchived"
         TitleResourceKey="ShowArchived_Filter"
         Default="0">
  <FilterConditions>
    <DataSource>
      <SQL>
        (@ShowArchived = 1 OR tbl.[IsArchived] = 0)
      </SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

### TagControl

Multiple text values input.

```xml
<Control xsi:type="TagControl"
         Ident="Tags"
         DataType="StringList"
         TitleResourceKey="Tags_Filter">
  <FilterConditions>
    <DataSource>
      <SQL>
        EXISTS (
          SELECT 1
          FROM dbo.MultiSelect ms
          WHERE ms.FormIdent = 'MyForm'
            AND ms.ControlIdent = 'Tags'
            AND ms.TableID = tbl.ID
            AND ms.Value IN (SELECT Value FROM @Tags)
        )
      </SQL>
    </DataSource>
  </FilterConditions>
</Control>
```

---

## FullText Search

Full-text search configuration for searching across multiple columns.

### Basic FullText

```xml
<FullText>
  <FilterConditions>
    <DataSource>
      <SQL>
        (
          CONTAINS(tbl.*, @FullText)
        )
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter"
                       Ident="FullText"
                       ConstantType="FullText"
                       DataType="String" />
      </Parameters>
    </DataSource>
  </FilterConditions>
</FullText>
```

### FullText with Multiple Tables

```xml
<FullText>
  <FilterConditions>
    <DataSource>
      <SQL>
        (
          CONTAINS(emp.*, @FullText)
          OR CONTAINS(dept.*, @FullText)
          OR emp.Email LIKE '%' + @FullTextLike + '%'
        )
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter"
                       Ident="FullText"
                       ConstantType="FullText"
                       DataType="String" />
        <dsp:Parameter xsi:type="dsp:VariableParameter"
                       Ident="FullTextLike"
                       ConstantType="FullText"
                       DataType="String" />
      </Parameters>
    </DataSource>
  </FilterConditions>
</FullText>
```

### FullText with LIKE Fallback

When full-text index is not available:

```xml
<FullText>
  <FilterConditions>
    <DataSource>
      <SQL>
        (
          tbl.[Name] LIKE '%' + @FullText + '%'
          OR tbl.[Description] LIKE '%' + @FullText + '%'
          OR tbl.[Email] LIKE '%' + @FullText + '%'
        )
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter"
                       Ident="FullText"
                       ConstantType="FullText"
                       DataType="String" />
      </Parameters>
    </DataSource>
  </FilterConditions>
</FullText>
```

---

## ResultList Filter

Filter for saved result lists (user-saved selections).

```xml
<ResultList>
  <FilterConditions>
    <DataSource>
      <SQL>
        tbl.ID IN (
          SELECT TableID
          FROM dbo.ResultList
          WHERE ResultListID = @ResultListID
        )
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter"
                       Ident="ResultListID"
                       ConstantType="ResultListID"
                       DataType="Number" />
      </Parameters>
    </DataSource>
  </FilterConditions>
</ResultList>
```

---

## SelectedRow Filter

Filter for currently selected rows in grid.

```xml
<SelectedRow>
  <FilterConditions>
    <DataSource>
      <SQL>
        tbl.ID IN (SELECT ID FROM @SelectedRows)
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter"
                       Ident="SelectedRows"
                       ConstantType="SelectedRow"
                       DataType="NumberList" />
      </Parameters>
    </DataSource>
  </FilterConditions>
</SelectedRow>
```

---

## DirectFilterControls

Controls displayed inline above the grid (not in filter dialog).

```xml
<DirectFilterControls>
  <Control xsi:type="TextBoxControl"
           Ident="QuickSearch"
           TitleResourceKey="QuickSearch_Filter"
           CssClass="quick-search">
    <FilterConditions>
      <DataSource>
        <SQL>
          (
            tbl.[Name] LIKE '%' + @QuickSearch + '%'
            OR tbl.[Code] LIKE '%' + @QuickSearch + '%'
          )
        </SQL>
      </DataSource>
    </FilterConditions>
  </Control>

  <Control xsi:type="DropDownListControl"
           Ident="QuickStatus"
           DataType="Number"
           TitleResourceKey="Status_Filter">
    <DataBind DefaultTitleResourceKey="AllStatuses" DefaultValue="">
      <SQL>SELECT ID, Name FROM dbo.Status WHERE IsActive = 1</SQL>
    </DataBind>
    <FilterConditions>
      <DataSource>
        <SQL>tbl.[StatusID] = @QuickStatus</SQL>
      </DataSource>
    </FilterConditions>
  </Control>
</DirectFilterControls>
```

---

## ExtensionControls

Additional controls that users can optionally add to their filter.

```xml
<ExtensionControls>
  <Control xsi:type="TextBoxControl"
           Ident="CreatedBy"
           DataType="String"
           TitleResourceKey="CreatedBy_Filter">
    <FilterConditions>
      <DataSource>
        <SQL>acc.[UserName] LIKE '%' + @CreatedBy + '%'</SQL>
      </DataSource>
    </FilterConditions>
  </Control>

  <Control xsi:type="TextBoxControl"
           Ident="ModifiedDateFrom"
           DataType="DateTime"
           TitleResourceKey="ModifiedFrom_Filter">
    <FilterConditions>
      <DataSource>
        <SQL>tbl.[ModifiedDate] >= @ModifiedDateFrom</SQL>
      </DataSource>
    </FilterConditions>
  </Control>
</ExtensionControls>
```

---

## CriteriaControl

Dynamic criteria builder for advanced filtering.

```xml
<Control xsi:type="CriteriaControl"
         Ident="AdvancedCriteria"
         TitleResourceKey="AdvancedFilter_Filter">
  <Controls>
    <Control xsi:type="DropDownListControl"
             Ident="Field"
             TitleResourceKey="Field_Filter">
      <DataBind>
        <ListItems>
          <ListItem Title="Name" Value="Name" />
          <ListItem Title="Email" Value="Email" />
          <ListItem Title="Phone" Value="Phone" />
        </ListItems>
      </DataBind>
    </Control>
  </Controls>
</Control>
```

---

## Default Values

### DefaultDataSource

Load default value from SQL.

```xml
<Control xsi:type="AutoCompleteControl"
         Ident="AssignedTo"
         DataType="Number"
         TitleResourceKey="AssignedTo_Filter">
  <DefaultDataSource>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT TOP 1 ID, FullName
      FROM usr.Employee
      WHERE AssignedAccountID = @UserID
        AND [State] = 3
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="UserID"
                     DataType="Number"
                     ConstantType="UserID" />
    </Parameters>
  </DefaultDataSource>
  <!-- ... rest of control ... -->
</Control>
```

### Static Default

```xml
<Control xsi:type="CheckBoxControl"
         Ident="ShowActive"
         TitleResourceKey="ShowActive_Filter"
         Default="1">
  <!-- ... -->
</Control>
```

---

## Complete Filter Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Filter xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        Ident="EmployeeFilter"
        IsApplyImmediately="false"
        IsShowSelected="true">

  <Controls>
    <!-- Multi-select status filter -->
    <Control xsi:type="ListBoxControl"
             Ident="State"
             DataType="NumberList"
             TitleResourceKey="State_Filter">
      <ListItems>
        <ListItem TitleResourceKey="Active_State" Value="3" />
        <ListItem TitleResourceKey="Inactive_State" Value="2" />
        <ListItem TitleResourceKey="Pending_State" Value="1" />
      </ListItems>
      <FilterConditions>
        <DataSource>
          <SQL>emp.[State] IN (SELECT ID FROM @State)</SQL>
        </DataSource>
      </FilterConditions>
    </Control>

    <!-- Department dropdown -->
    <Control xsi:type="DropDownListControl"
             Ident="DepartmentID"
             DataType="Number"
             TitleResourceKey="Department_Filter">
      <DataBind DefaultTitleResourceKey="AllDepartments" DefaultValue="">
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="Name" DataBindType="Title" />
        </Columns>
        <SQL>
          SELECT ID, Name
          FROM usr.Department
          WHERE [State] = 3
          ORDER BY Name
        </SQL>
      </DataBind>
      <FilterConditions>
        <DataSource>
          <SQL>emp.[DepartmentID] = @DepartmentID</SQL>
        </DataSource>
      </FilterConditions>
    </Control>

    <!-- Manager autocomplete -->
    <Control xsi:type="AutoCompleteControl"
             Ident="ManagerID"
             DataType="Number"
             TitleResourceKey="Manager_Filter">
      <EmptyDataBind DefaultTitleResourceKey="SelectManager">
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="FullName" DataBindType="Title" />
        </Columns>
        <SQL>
          SELECT TOP 20 ID, FullName
          FROM usr.Employee
          WHERE IsManager = 1 AND [State] = 3
          ORDER BY FullName
        </SQL>
      </EmptyDataBind>
      <DataBind DefaultTitleResourceKey="SelectManager">
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="FullName" DataBindType="Title" />
        </Columns>
        <SQL>
          SELECT ID, FullName
          FROM usr.Employee
          WHERE IsManager = 1
            AND [State] = 3
            AND FullName LIKE @ManagerID
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter"
                         Ident="ManagerID"
                         DataType="String"
                         LikeType="Both" />
        </Parameters>
      </DataBind>
      <SelectedDataBind>
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="FullName" DataBindType="Title" />
        </Columns>
        <SQL>
          SELECT ID, FullName
          FROM usr.Employee
          WHERE ID = @ManagerID
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter"
                         Ident="ManagerID"
                         DataType="Number" />
        </Parameters>
      </SelectedDataBind>
      <FilterConditions>
        <DataSource>
          <SQL>emp.[ManagerID] = @ManagerID</SQL>
        </DataSource>
      </FilterConditions>
    </Control>

    <!-- Date range -->
    <Control xsi:type="TextBoxControl"
             Ident="HireDateFrom"
             DataType="Date"
             TitleResourceKey="HiredFrom_Filter">
      <FilterConditions>
        <DataSource>
          <SQL>emp.[HireDate] >= @HireDateFrom</SQL>
        </DataSource>
      </FilterConditions>
    </Control>

    <Control xsi:type="TextBoxControl"
             Ident="HireDateTo"
             DataType="Date"
             TitleResourceKey="HiredTo_Filter">
      <FilterConditions>
        <DataSource>
          <SQL>emp.[HireDate] <= @HireDateTo</SQL>
        </DataSource>
      </FilterConditions>
    </Control>

    <!-- Boolean switch -->
    <Control xsi:type="SwitchControl"
             Ident="IsRemote"
             TitleResourceKey="RemoteOnly_Filter">
      <FilterConditions>
        <DataSource>
          <SQL>emp.[IsRemote] = @IsRemote</SQL>
        </DataSource>
      </FilterConditions>
    </Control>
  </Controls>

  <!-- Quick search above grid -->
  <DirectFilterControls>
    <Control xsi:type="TextBoxControl"
             Ident="QuickSearch"
             TitleResourceKey="Search_Filter">
      <FilterConditions>
        <DataSource>
          <SQL>
            (
              emp.[FullName] LIKE '%' + @QuickSearch + '%'
              OR emp.[Email] LIKE '%' + @QuickSearch + '%'
              OR emp.[EmployeeNumber] LIKE '%' + @QuickSearch + '%'
            )
          </SQL>
        </DataSource>
      </FilterConditions>
    </Control>
  </DirectFilterControls>

  <!-- Optional extended filters -->
  <ExtensionControls>
    <Control xsi:type="TextBoxControl"
             Ident="Salary"
             DataType="Double"
             TitleResourceKey="MinSalary_Filter">
      <FilterConditions>
        <DataSource>
          <SQL>emp.[Salary] >= @Salary</SQL>
        </DataSource>
      </FilterConditions>
    </Control>
  </ExtensionControls>

  <!-- Full-text search -->
  <FullText>
    <FilterConditions>
      <DataSource>
        <SQL>
          (
            CONTAINS(emp.*, @FullText)
          )
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter"
                         Ident="FullText"
                         ConstantType="FullText"
                         DataType="String" />
        </Parameters>
      </DataSource>
    </FilterConditions>
  </FullText>

  <!-- Selected rows filter -->
  <SelectedRow>
    <FilterConditions>
      <DataSource>
        <SQL>emp.ID IN (SELECT ID FROM @SelectedRows)</SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter"
                         Ident="SelectedRows"
                         ConstantType="SelectedRow"
                         DataType="NumberList" />
        </Parameters>
      </DataSource>
    </FilterConditions>
  </SelectedRow>
</Filter>
```

---

## Usage in DataView

Reference filter in DataView:

```xml
<DataView Ident="EmployeeAllView" DefaultFilterIdent="EmployeeFilter">
  <!-- Or inline: -->
  <Filter>
    <Controls>
      <!-- Filter controls -->
    </Controls>
  </Filter>
</DataView>
```

---

## Filter Structure Summary

```
Filter
├── Ident (required)
├── Attributes (IsApplyImmediately, IsShowSelected, etc.)
├── Controls
│   └── Control (with FilterConditions)
│       ├── DataBind / ListItems
│       ├── EmptyDataBind (AutoComplete)
│       ├── SelectedDataBind (AutoComplete)
│       ├── DefaultDataSource
│       ├── DefaultDependencyDataBind (cascading)
│       └── FilterConditions
│           └── DataSource
│               └── SQL (WHERE clause fragment)
├── DirectFilterControls (inline above grid)
│   └── Control (with FilterConditions)
├── ExtensionControls (optional user-added)
│   └── Control (with FilterConditions)
├── FullText
│   └── FilterConditions
│       └── DataSource (CONTAINS or LIKE)
├── ResultList
│   └── FilterConditions
├── SelectedRow
│   └── FilterConditions
├── Sections (ContentSection)
└── PackageIdents
```
