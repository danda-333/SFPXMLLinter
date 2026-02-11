# DataSource and DataBind Documentation

> **DŮLEŽITÉ:** Vždy používejte `<![CDATA[...]]>` pro SQL dotazy obsahující znaky `<`, `>`, `&`. Viz sekce [CDATA v README.md](../README.md#cdata-sekce-důležité).

## DataSource

DataSource is a fundamental element for loading data from SQL queries. Used throughout the system for data binding, filtering, permissions, and more.

### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | "" | **Required for named sources.** Unique identifier |
| `FormIdent` | string | "" | Related form identifier (for grid rows linking to form) |
| `DetailUrl` | string | "" | URL for detail view (clickable rows) |
| `DetailTarget` | string | "" | Target window for detail (_blank, _self) |
| `Title` | string | "" | Display title |
| `TitleResourceKey` | string | "" | Title from translations |
| `GroupIdent` | string | "" | Group identifier for organizing sources |
| `IsGeneratePaging` | bool | false | Auto-generate paging SQL |
| `RemoteConnectionStringIdent` | string | "" | Connection string for remote database |
| `IsPermissionInTempTable` | bool | true | Use temp table for permissions |
| `IsInitJSDependency` | bool | true | Initialize JS dependencies |
| `IsCache` | bool | false | Cache query results |
| `CacheAbsoluteExpiration` | double | 0.3 | Cache expiration in seconds |
| `PermissionModeType` | enum | Basic | Permission handling (Basic, TemporaryTable) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `SQL` | string | **Required.** SQL query |
| `Columns` | List&lt;Column&gt; | Column definitions for result mapping |
| `Parameters` | List&lt;Parameter&gt; | SQL parameters |
| `Dependencies` | List&lt;string&gt; | Control idents that trigger reload |
| `DataPermissions` | List&lt;string&gt; | Permissions required to load data |
| `Froms` | List&lt;From&gt; | FROM clause conditions |
| `DLLData` | DLLData | External DLL data source |

### Basic Examples

**Simple query:**
```xml
<DataSource>
  <SQL><![CDATA[
    SELECT ID, Name, State
    FROM usr.Customer
    WHERE State != 0
    ORDER BY Name
  ]]></SQL>
</DataSource>
```

**With parameters:**
```xml
<DataSource>
  <SQL><![CDATA[
    SELECT ID, Name, Email
    FROM usr.Customer
    WHERE ID = @ID AND State != 0
  ]]></SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
  </Parameters>
</DataSource>
```

**Named DataSource with columns:**
```xml
<DataSource Ident="CustomerList" FormIdent="Customer">
  <Columns>
    <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
    <Column Ident="Name" TitleResourceKey="Name" Width="40" />
    <Column Ident="Email" TitleResourceKey="Email" Width="30" />
    <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Customer" Width="20" IsColor="true" />
  </Columns>
  <SQL><![CDATA[
    SELECT ID, Name, Email, State
    FROM usr.Customer
    WHERE State != 0
    ORDER BY Name
  ]]></SQL>
</DataSource>
```

---

## DataBind

DataBind inherits from DataSource and adds default value support. Used primarily for dropdown/autocomplete controls.

### Additional Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `DefaultTitle` | string | "" | Default option text (e.g., "Select...") |
| `DefaultTitleResourceKey` | string | "" | Default option text from translations |
| `DefaultValue` | string | "" | Default option value (usually empty string) |

### Examples

**Dropdown DataBind:**
```xml
<DataBind DefaultTitleResourceKey="SelectValue" DefaultValue="">
  <Columns>
    <Column Ident="ID" DataBindType="Value" />
    <Column Ident="Name" DataBindType="Title" />
  </Columns>
  <SQL>
    SELECT ID, Name
    FROM usr.Category
    WHERE State != 0
    ORDER BY Name
  </SQL>
</DataBind>
```

**With dependencies (cascading):**
```xml
<DataBind DefaultTitleResourceKey="SelectValue" DefaultValue="">
  <Dependencies>
    <string>CountryID</string>
  </Dependencies>
  <Columns>
    <Column Ident="ID" DataBindType="Value" />
    <Column Ident="Name" DataBindType="Title" />
  </Columns>
  <SQL>
    SELECT ID, Name
    FROM usr.City
    WHERE CountryID = @CountryID AND State != 0
    ORDER BY Name
  </SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CountryID" DataType="Number" />
  </Parameters>
</DataBind>
```

---

## Parameters

Parameters define SQL query variables and their data sources.

### Parameter Base

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Parameter name (without @) |
| `IsNullIdent` | string | "" | Column for ISNULL fallback |
| `IsNullFormName` | string | "" | Table for ISNULL fallback |
| `IsNullFormAlterName` | string | "" | Alternative table alias for ISNULL |
| `IsCaseInsensitive` | bool | false | Case-insensitive matching |

---

### VariableParameter

Loads value from form control, URL parameter, or other variable source.

#### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `DataType` | enum | - | **Required.** Data type |
| `SetDataType` | enum | ActualData | Data source location |
| `AlterIdent` | string | "" | Alternative control ident |
| `MaxLength` | int | 0 | Max string length |
| `ConstantType` | enum | None | System constant value |
| `LikeType` | enum | None | LIKE pattern type |

#### SetDataTypes Enum

| Value | Description |
|-------|-------------|
| `ActualData` | Current form field values |
| `OldData` | Values before save (for change detection) |
| `ParentData` | Parent form data (SubForm context) |
| `QueryStringData` | URL GET parameters |
| `POSTData` | POST body parameters |
| `HTTPData` | Combined GET + POST |
| `ExtensionData` | Extension data |
| `HTMLAttribute` | HTML attribute value |
| `SelectedValueData` | Previously selected values |
| `SpecifyData` | Specification data |

#### ConstantTypes Enum

| Value | Description |
|-------|-------------|
| `None` | No constant, use control value |
| `UserID` | Current user ID |
| `UserLanguageID` | Current user's language ID |
| `DateTimeNow` | Current date/time |
| `DateFrom` | Start date (filter) |
| `DateTo` | End date (filter) |
| `MenuFolderTreeIdent` | Menu folder tree value |
| `StartPage` | Page start (pagination) |
| `EndPage` | Page end (pagination) |
| `FullTextRaw` | Raw search expression |
| `FullText` | Processed search expression |
| `ID` | Record ID |
| `LastRunDate` | Last application run date |
| `FileID` | Current file ID |
| `DeviceIdent` | Device identifier |
| `ResultListID` | Stored search results |
| `SegmentFilter` | Segment filter value |
| `TabIdent` | Current tab identifier |
| `UICultureCode` | UI Culture code |
| `SelectedRow` | List of selected records |
| `Token` | Token |
| `Value` | Any value |
| `WorkFlowState` | Current workflow state |
| `WorkFlowPermissions` | Workflow group permissions |
| `SegmentType` | Segment type |
| `GlobalVariable` | Global variable |
| `CommunicationID` | Added communication ID |
| `Ident` | Value identifier |
| `AnonymousID` | Anonymous user ID |
| `PathURL` | URL path |
| `LocalVariable` | Local variable within XML |
| `FormIdent` | Form identifier |
| `CultureCode` | Culture code |

#### LikeTypes Enum

| Value | Description |
|-------|-------------|
| `None` | Exact match |
| `Left` | `%value` (ends with) |
| `Right` | `value%` (starts with) |
| `Both` | `%value%` (contains) |

#### Examples

**From form field:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="CustomerID"
               DataType="Number" />
```

**Current record ID:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="ID"
               DataType="Number" />
```

**Current user ID:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="UserID"
               DataType="Number"
               ConstantType="UserID" />
```

**Search with LIKE:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="SearchName"
               DataType="String"
               LikeType="Both" />
```

**From URL parameter:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="CategoryID"
               DataType="Number"
               SetDataType="QueryStringData" />
```

**Boolean from form field:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="IsManager"
               DataType="Bool" />
```

**Global variable:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="MyVariable"
               DataType="String"
               ConstantType="GlobalVariable" />
```

**Local variable:**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="MyLocalVar"
               DataType="String"
               ConstantType="LocalVariable" />
```

**List parameter (for IN clause):**
```xml
<dsp:Parameter xsi:type="dsp:VariableParameter"
               Ident="SelectedIDs"
               DataType="NumberList" />
```

---

### ValueParameter

Static value parameter (constant in SQL).

#### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `DataType` | enum | - | **Required.** Data type |
| `Value` | string | - | **Required.** Static value |
| `MaxLength` | int | 0 | Max string length |
| `LikeType` | enum | None | LIKE pattern type |

#### Examples

**Static string:**
```xml
<dsp:Parameter xsi:type="dsp:ValueParameter"
               Ident="FormIdent"
               DataType="String"
               Value="Customer" />
```

**Static number:**
```xml
<dsp:Parameter xsi:type="dsp:ValueParameter"
               Ident="ActiveState"
               DataType="Number"
               Value="1" />
```

**Static with LIKE:**
```xml
<dsp:Parameter xsi:type="dsp:ValueParameter"
               Ident="Prefix"
               DataType="String"
               Value="CZ"
               LikeType="Right" />
```

---

### StrictParameter

Parameter with strict SQL injection prevention.

```xml
<dsp:Parameter xsi:type="dsp:StrictParameter"
               Ident="OrderBy"
               DataType="String" />
```

---

### TableParameter

Table-valued parameter for passing lists to SQL.

```xml
<dsp:Parameter xsi:type="dsp:TableParameter"
               Ident="IDs"
               DataType="NumberList" />
```

---

### DynamicParameter

Dynamically generated parameter.

```xml
<dsp:Parameter xsi:type="dsp:DynamicParameter"
               Ident="Filter"
               DataType="String" />
```

---

## DataTypes Enum

| Value | SQL Type | Description |
|-------|----------|-------------|
| `String` | NVARCHAR | Unicode string |
| `VarChar` | VARCHAR | ASCII string |
| `Number` | INT | Integer |
| `SmallNumber` | SMALLINT | Small integer |
| `BigNumber` | BIGINT | Large integer |
| `Double` | DECIMAL | Decimal number |
| `Bool` | BIT | Boolean |
| `Date` | DATE | Date only |
| `DateTime` | DATETIME | Date and time |
| `Time` | INT | Time in minutes |
| `Time24` | TIME | Time (HH:mm:ss) |
| `Guid` | UNIQUEIDENTIFIER | GUID |
| `ByteList` | VARBINARY | Binary data |
| `StringList` | TABLE | List of strings (for IN) |
| `NumberList` | TABLE | List of numbers (for IN) |
| `VarCharList` | TABLE | List of varchar strings |
| `SmallNumberList` | TABLE | List of small integers |

---

## Columns

Column definitions for DataSource results.

### Base Column Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** SQL column name |
| `Title` | string | "" | Column header text |
| `TitleResourceKey` | string | "" | Column header from translations |
| `IsVisible` | bool | true | Show column |
| `IsPrimaryKey` | bool | false | Mark as PK (required for grids) |
| `Width` | int | 0 | Column width (percentage or px) |
| `IsDefaultSort` | bool | false | Default sort column |
| `SortType` | enum | ASC | Sort direction (ASC, DESC) |
| `Format` | string | "" | Display format (e.g., "{0:N2}") |
| `DataType` | enum | None | Data type for formatting |
| `IsTranslate` | bool | false | Value is resource key |
| `IsClickable` | bool | true | Row is clickable |
| `IsSortable` | bool | true | Column is sortable |
| `MaxLength` | int | 0 | Truncate text at length |
| `IsStripHTML` | bool | false | Remove HTML tags |
| `CssClass` | string | "" | CSS class for column |
| `TextAlign` | enum | Left | Text alignment (Left, Right, Center) |
| `DataBindType` | enum | None | Mapping type (Value, Title, etc.) |

### DataBindType Enum

| Value | Description |
|-------|-------------|
| `None` | No special binding |
| `Value` | Option value (for dropdown) |
| `Title` | Display text (for dropdown) |
| `ToolTip` | Tooltip text |
| `Selected` | Pre-selected state |
| `Icon` | Icon CSS class |
| `Color` | Color value |
| `ParentValue` | Parent ID (for tree) |

### Column Examples

**Basic column:**
```xml
<Column Ident="Name" TitleResourceKey="Name_Form" Width="40" />
```

**Primary key (hidden):**
```xml
<Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
```

**Formatted number:**
```xml
<Column Ident="Amount" TitleResourceKey="Amount" Width="20" Format="{0:N2}" TextAlign="Right" />
```

**Date column:**
```xml
<Column Ident="CreateDate" TitleResourceKey="Created" Width="20" Format="{0:d}" DataType="Date" />
```

**Default sort descending:**
```xml
<Column Ident="CreateDate" TitleResourceKey="Created" IsDefaultSort="true" SortType="DESC" />
```

**DataBind value/title:**
```xml
<Column Ident="ID" DataBindType="Value" />
<Column Ident="Name" DataBindType="Title" />
```

---

## Special Column Types

### WorkFlowStateColumn

Displays workflow state with translation and optional color.

| Attribute | Type | Description |
|-----------|------|-------------|
| `FormIdent` | string | **Required.** Form identifier for state lookup |
| `IsColor` | bool | Show colored badge |

```xml
<Column xsi:type="WorkFlowStateColumn"
        Ident="State"
        FormIdent="Order"
        TitleResourceKey="Status"
        Width="20"
        IsColor="true" />
```

---

### BadgeColumn

Displays value as colored badge.

| Attribute | Type | Description |
|-----------|------|-------------|
| `ColorCssClass` | string | Static CSS class for color |
| `ColorCssClassColumnIdent` | string | Column with CSS class value |

```xml
<Column xsi:type="BadgeColumn"
        Ident="Priority"
        TitleResourceKey="Priority"
        ColorCssClassColumnIdent="PriorityColor" />
```

---

### ImageColumn

Displays image in column.

```xml
<Column xsi:type="ImageColumn"
        Ident="Avatar"
        TitleResourceKey="Photo"
        Width="10" />
```

---

### CheckBoxColumn

Displays checkbox for boolean values.

```xml
<Column xsi:type="CheckBoxColumn"
        Ident="IsActive"
        TitleResourceKey="Active"
        Width="10" />
```

---

### DeleteColumn

Action column for row deletion.

```xml
<Column xsi:type="DeleteColumn"
        Ident="Delete"
        TitleResourceKey="Delete"
        Width="10" />
```

---

### ToolBarColumn

Column with action buttons.

```xml
<Column xsi:type="ToolBarColumn" Ident="Actions" Width="15">
  <ToolBarItems>
    <ToolBarItem xsi:type="EditToolBarItem" />
    <ToolBarItem xsi:type="DeleteToolBarItem" />
  </ToolBarItems>
</Column>
```

---

### FileColumn

Displays file download link.

```xml
<Column xsi:type="FileColumn"
        Ident="FileName"
        TitleResourceKey="File"
        Width="30" />
```

---

### ExpanderColumn

Expandable row detail.

```xml
<Column xsi:type="ExpanderColumn" Ident="Detail">
  <DataSource>
    <SQL>SELECT * FROM usr.OrderItem WHERE OrderID = @ID</SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Column>
```

---

## Dependencies

Dependencies define which controls trigger DataSource reload.

```xml
<DataBind DefaultTitleResourceKey="SelectValue">
  <Dependencies>
    <string>CountryID</string>
    <string>RegionID</string>
  </Dependencies>
  <Columns>
    <Column Ident="ID" DataBindType="Value" />
    <Column Ident="Name" DataBindType="Title" />
  </Columns>
  <SQL>
    SELECT ID, Name
    FROM usr.City
    WHERE CountryID = @CountryID
      AND (RegionID = @RegionID OR @RegionID IS NULL)
      AND State != 0
    ORDER BY Name
  </SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CountryID" DataType="Number" />
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="RegionID" DataType="Number" />
  </Parameters>
</DataBind>
```

---

## XML Namespace

DataSource parameters require the namespace prefix:

```xml
xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
```

Full example:

```xml
<DataSource xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
  <SQL>SELECT * FROM usr.Customer WHERE ID = @ID</SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
  </Parameters>
</DataSource>
```

---

## Common Patterns

### Dropdown with static default

```xml
<Control xsi:type="DropDownListControl"
         Ident="Status"
         DataType="Number"
         TitleResourceKey="Status_Form">
  <DataBind DefaultTitleResourceKey="SelectValue" DefaultValue="">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name FROM usr.Status WHERE State != 0 ORDER BY SortOrder
    </SQL>
  </DataBind>
</Control>
```

### Autocomplete with search

```xml
<Control xsi:type="AutoCompleteControl"
         Ident="CustomerID"
         DataType="Number"
         TitleResourceKey="Customer_Form"
         MinStartSearch="2">
  <DataBind DefaultTitleResourceKey="SelectValue">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name
      FROM usr.Customer
      WHERE Name LIKE @CustomerID AND State != 0
      ORDER BY Name
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerID" DataType="String" LikeType="Both" />
    </Parameters>
  </DataBind>
  <SelectedDataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name FROM usr.Customer WHERE ID = @CustomerID
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerID" DataType="Number" />
    </Parameters>
  </SelectedDataBind>
</Control>
```

### Tree select with hierarchy

```xml
<DataBind DefaultTitleResourceKey="SelectValue">
  <Columns>
    <Column Ident="ID" DataBindType="Value" />
    <Column Ident="Name" DataBindType="Title" />
    <Column Ident="ParentID" DataBindType="ParentValue" />
  </Columns>
  <SQL>
    SELECT ID, Name, ParentID
    FROM usr.Department
    WHERE State != 0
    ORDER BY ParentID, Name
  </SQL>
</DataBind>
```

### Grid with detail link

```xml
<DataSource FormIdent="Order" DetailUrl="~/Form/Index/Order">
  <Columns>
    <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
    <Column Ident="OrderNumber" TitleResourceKey="OrderNumber" Width="20" />
    <Column Ident="CustomerName" TitleResourceKey="Customer" Width="40" />
    <Column Ident="Total" TitleResourceKey="Total" Width="20" Format="{0:N2}" TextAlign="Right" />
    <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Order" Width="20" IsColor="true" />
  </Columns>
  <SQL>
    SELECT o.ID, o.OrderNumber, c.Name as CustomerName, o.Total, o.State
    FROM usr.[Order] o
    INNER JOIN usr.Customer c ON o.CustomerID = c.ID
    WHERE o.State != 0
    ORDER BY o.CreateDate DESC
  </SQL>
</DataSource>
```

### Visibility condition

```xml
<VisibleCondition>
  <SQL>
    SELECT IIF(@State >= 20 AND @IsAdmin = 1, 1, 0) AS IsVisible
  </SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="State" DataType="Number" />
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="IsAdmin" DataType="Bool" />
  </Parameters>
</VisibleCondition>
```

### Multiple parameters with IN clause

```xml
<SQL>
  SELECT * FROM usr.Order
  WHERE CustomerID IN (SELECT Value FROM @CustomerIDs)
    AND State != 0
</SQL>
<Parameters>
  <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerIDs" DataType="NumberList" />
</Parameters>
```
