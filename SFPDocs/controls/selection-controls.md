# Selection Controls

## DropDownListControl

Dropdown select box with static or dynamic items.

**Inherits from:** FormControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsAutoSelectFirst` | bool | false | Auto-select first item if only one option |
| `ClearDepedenciType` | enum | Append | Clear behavior on dependency change (Append, Clear) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `ListItems` | List&lt;ListItem&gt; | Static list items |
| `DataBind` | DataBind | Dynamic items from SQL |
| `ChangeActionDataSource` | DataSource | SQL to execute on selection change |

### ListItem Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `Value` | string | Option value |
| `Title` | string | Display text |
| `TitleResourceKey` | string | Display text from translations |

### Examples

**Static items:**
```xml
<Control xsi:type="DropDownListControl"
         Ident="Priority"
         DataType="Number"
         TitleResourceKey="Priority_Form">
  <ListItems>
    <ListItem Value="1" TitleResourceKey="Priority_Low" />
    <ListItem Value="2" TitleResourceKey="Priority_Medium" />
    <ListItem Value="3" TitleResourceKey="Priority_High" />
  </ListItems>
</Control>
```

**Dynamic items from SQL:**
```xml
<Control xsi:type="DropDownListControl"
         Ident="CategoryID"
         DataType="Number"
         TitleResourceKey="Category_Form">
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
</Control>
```

**With dependency (cascading dropdown):**
```xml
<Control xsi:type="DropDownListControl"
         Ident="CityID"
         DataType="Number"
         TitleResourceKey="City_Form">
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
</Control>
```

---

## AutoCompleteControl

Searchable dropdown with async loading. Best for large datasets.

**Inherits from:** FormControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `MinStartSearch` | int | 0 | Minimum characters before search starts |
| `MaxItems` | int | 0 | Max items in dropdown (0 = unlimited) |
| `IsAnyValue` | bool | false | Allow values not in DataBind results |
| `IsAutoSelectFirst` | bool | false | Auto-select first if only one result |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataBind` | DataBind | Search query (uses control value as search term) |
| `EmptyDataBind` | DataBind | Query when search is empty (initial dropdown) |
| `SelectedDataBind` | DataBind | Query to load selected value (for edit mode) |
| `DefaultDependencyDataBind` | DataBind | Default value based on dependencies |
| `ChangeActionDataSource` | DataSource | SQL on selection change |

### Examples

**Complete autocomplete:**
```xml
<Control xsi:type="AutoCompleteControl"
         Ident="CustomerID"
         DataType="Number"
         TitleResourceKey="Customer_Form"
         MinStartSearch="2"
         MaxItems="20">
  <!-- Search results -->
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

  <!-- Empty state (before typing) -->
  <EmptyDataBind DefaultTitleResourceKey="SelectValue">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT TOP 10 ID, Name
      FROM usr.Customer
      WHERE State != 0
      ORDER BY LastUpdate DESC
    </SQL>
  </EmptyDataBind>

  <!-- Load selected value (edit mode) -->
  <SelectedDataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name
      FROM usr.Customer
      WHERE ID = @CustomerID
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerID" DataType="Number" />
    </Parameters>
  </SelectedDataBind>
</Control>
```

---

## CheckBoxControl

Single checkbox (boolean field).

**Inherits from:** FormControl
**Default DataType:** Bool

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `LabelPlacementType` | enum | Right | Label position (Left, Right, Center) |
| `IsGenerateEmptyLable` | bool | true | Generate empty label element |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataBind` | DataBind | Dynamic checked state |

### Examples

**Basic checkbox:**
```xml
<Control xsi:type="CheckBoxControl"
         Ident="AcceptTerms"
         TitleResourceKey="AcceptTerms_Form"
         IsRequired="true" />
```

**With default value:**
```xml
<Control xsi:type="CheckBoxControl"
         Ident="IsActive"
         TitleResourceKey="IsActive_Form"
         Default="1" />
```

---

## SwitchControl

Toggle switch (styled checkbox).

**Inherits from:** CheckBoxControl
**Default DataType:** Bool

### Specific Attributes

Same as CheckBoxControl.

### Examples

**Basic switch:**
```xml
<Control xsi:type="SwitchControl"
         Ident="IsEnabled"
         TitleResourceKey="IsEnabled_Form"
         Default="1"
         LabelPlacementType="Center" />
```

---

## RadioButtonListControl

Radio button group (single selection).

**Inherits from:** DropDownListControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `DisplayType` | enum | Block | Layout (Block = vertical, Inline = horizontal) |

### Examples

**Static radio buttons:**
```xml
<Control xsi:type="RadioButtonListControl"
         Ident="Gender"
         DataType="String"
         TitleResourceKey="Gender_Form"
         DisplayType="Inline">
  <ListItems>
    <ListItem Value="M" TitleResourceKey="Male" />
    <ListItem Value="F" TitleResourceKey="Female" />
    <ListItem Value="O" TitleResourceKey="Other" />
  </ListItems>
</Control>
```

**Dynamic from SQL:**
```xml
<Control xsi:type="RadioButtonListControl"
         Ident="PaymentMethod"
         DataType="Number"
         TitleResourceKey="PaymentMethod_Form">
  <DataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name FROM usr.PaymentMethod WHERE State != 0 ORDER BY SortOrder
    </SQL>
  </DataBind>
</Control>
```

---

## CheckBoxListControl

Multiple checkboxes (multi-selection).

**Inherits from:** ListBoxControl
**Creates DB Column:** No (uses dbo.MultiSelect)

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `LabelPlacementType` | enum | Right | Label position |
| `DisplayType` | enum | Block | Layout (Block, Inline) |

### Examples

```xml
<Control xsi:type="CheckBoxListControl"
         Ident="Categories"
         DataType="StringList"
         TitleResourceKey="Categories_Form"
         DisplayType="Block">
  <DataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name FROM usr.Category WHERE State != 0 ORDER BY Name
    </SQL>
  </DataBind>
</Control>
```

---

## ListBoxControl

Multi-select listbox.

**Inherits from:** DropDownListControl
**Creates DB Column:** No (uses dbo.MultiSelect)

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `NumberDisplayed` | int | 4 | Number of visible items |

### Examples

```xml
<Control xsi:type="ListBoxControl"
         Ident="Permissions"
         DataType="StringList"
         TitleResourceKey="Permissions_Form"
         NumberDisplayed="6">
  <DataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, Name FROM dbo.Permission WHERE State != 0 ORDER BY Name
    </SQL>
  </DataBind>
</Control>
```

---

## DualListBoxControl

Two-column list transfer (available/selected).

**Inherits from:** ListBoxControl
**Creates DB Column:** No (uses dbo.MultiSelect)

### Examples

```xml
<Control xsi:type="DualListBoxControl"
         Ident="AssignedUsers"
         DataType="StringList"
         TitleResourceKey="AssignedUsers_Form">
  <DataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT ID, FullName FROM dbo.Account WHERE State != 0 ORDER BY FullName
    </SQL>
  </DataBind>
</Control>
```

---

## TagControl

Tag input with autocomplete suggestions.

**Inherits from:** AutoCompleteControl
**Creates DB Column:** No (uses dbo.MultiSelect)

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsAnyValue` | bool | false | Allow custom tags not in suggestions |

### Examples

```xml
<Control xsi:type="TagControl"
         Ident="Tags"
         DataType="StringList"
         TitleResourceKey="Tags_Form"
         IsAnyValue="true">
  <DataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Value" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT DISTINCT Value as ID, Value
      FROM dbo.MultiSelect
      WHERE FormIdent = 'MyForm' AND ControlIdent = 'Tags' AND Value LIKE @Tags
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="Tags" DataType="String" LikeType="Both" />
    </Parameters>
  </DataBind>
  <SelectedDataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Value" DataBindType="Title" />
    </Columns>
    <SQL>SELECT Value as ID, Value FROM @Tags</SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="Tags" DataType="StringList" />
    </Parameters>
  </SelectedDataBind>
</Control>
```

---

## TreeSelectBoxControl

Hierarchical tree select (for hierarchical data).

**Inherits from:** FormControl

### Examples

```xml
<Control xsi:type="TreeSelectBoxControl"
         Ident="DepartmentID"
         DataType="Number"
         TitleResourceKey="Department_Form">
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
</Control>
```
