# Form - XML Configuration Documentation

## Overview

**Form** is the fundamental entity in SmartFormPlatform that defines data entry forms. Each Form creates a corresponding database table in the `usr` schema.

**Key characteristics:**
- Defines UI controls for data input
- Creates database table `usr.[FormIdent]`
- Linked to WorkFlow for state management
- Supports multiple sections and layouts via HTMLTemplate

---

## XML Structure

### Minimal Example
```xml
<?xml version="1.0" encoding="utf-8"?>
<Form xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns:xsd="http://www.w3.org/2001/XMLSchema"
      xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
      Ident="MyForm"
      SegmentType="MySegment">
  <Controls>
    <Control xsi:type="TextBoxControl" Ident="Name" DataType="String" MaxLength="100" />
  </Controls>
  <Sections>
    <Section xsi:type="ContentSection" Ident="MainSection">
      <HTMLTemplate>
        <div class="form-group">
          <ControlLabel ControlID="Name" />
          <Control ID="Name" />
        </div>
      </HTMLTemplate>
    </Section>
  </Sections>
</Form>
```

---

## Form Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier. Creates table `usr.[Ident]` |
| `SegmentType` | string | No | - | Module/segment type for menu grouping |
| `PackageIdent` | string | No | - | Package identifier for grouping configurations |
| `Title` | string | No | - | Form title (static text) |
| `TitleResourceKey` | string | No | - | Form title from translations |
| `FormType` | enum | No | Classic | Type of form (see FormTypes below) |
| `IsPublic` | bool | No | false | Public form (no login required) |
| `IsReCaptcha` | bool | No | false | Enable reCAPTCHA for public forms |
| `IsPaging` | bool | No | false | Enable pagination for form sections |
| `IsShowControlTitle` | bool | No | true | Show control labels |
| `IsRazorEngine` | bool | No | false | Enable Razor engine in templates |
| `IsPDF` | bool | No | false | Enable PDF generation |
| `IsShowSaveSuccessMessage` | bool | No | true | Show success message after save |

### FormTypes

| Value | Description |
|-------|-------------|
| `Classic` | Standard form with custom table |
| `Folder` | Form with folder tree integration |
| `FileExtension` | Extension for file metadata |
| `UserExtension` | Extension for user (Account) data |
| `GroupExtension` | Extension for group data |
| `TemporaryData` | Temporary data form |
| `FormFilter` | Filter form definition |

---

## Database Table Structure

When you create a Form with `Ident="MyForm"`, the system automatically creates a database table `usr.MyForm` with the following **system columns**:

### System Columns (Auto-Generated)

**⚠️ IMPORTANT:** These columns are created and managed automatically by the system. **DO NOT** create Controls for these columns!

| Column | Type | Description | Managed By |
|--------|------|-------------|------------|
| `ID` | int | Primary key (auto-increment) | System |
| `AccountID` | nvarchar(450) | User who created the record (FK to dbo.Account) | System |
| `CreateDate` | datetime | Creation timestamp | System |
| `LastUpdate` | datetime | Last modification timestamp | System |
| `State` | tinyint | Workflow state | WorkFlow |
| `LastUpdateAccountID` | nvarchar(450) | User who last modified (FK to dbo.Account) | System |

### Your Business Columns

In addition to system columns, the system creates one column for each Control in your Form:

```xml
<Controls>
  <!-- Creates column: Name (nvarchar(100)) -->
  <Control xsi:type="TextBoxControl" Ident="Name" DataType="String" MaxLength="100" />

  <!-- Creates column: Price (decimal(18,2)) -->
  <Control xsi:type="TextBoxControl" Ident="Price" DataType="Double" DataTypeSize="18,2" />

  <!-- Creates column: CategoryID (int) -->
  <Control xsi:type="DropDownListControl" Ident="CategoryID" DataType="Number" />

  <!-- Creates column: IsActive (bit) -->
  <Control xsi:type="SwitchControl" Ident="IsActive" DataType="Bool" />
</Controls>
```

**Result:** Table `usr.MyForm` will have columns:
- System: `ID`, `AccountID`, `CreateDate`, `LastUpdate`, `State`, `LastUpdateAccountID`
- Business: `Name`, `Price`, `CategoryID`, `IsActive`

### ❌ WRONG - Do NOT Create Controls for System Columns

```xml
<!-- WRONG: These Controls are redundant and can cause conflicts -->
<Controls>
  <Control xsi:type="HiddenControl" Ident="ID" DataType="Number" />
  <Control xsi:type="HiddenControl" Ident="AccountID" DataType="String" />
  <Control xsi:type="HiddenControl" Ident="CreateDate" DataType="DateTime" />
  <Control xsi:type="HiddenControl" Ident="State" DataType="Number" />

  <!-- These names don't match system columns - system will ignore them -->
  <Control xsi:type="HiddenControl" Ident="CreatedBy" DataType="String" />
  <Control xsi:type="HiddenControl" Ident="ModifiedDate" DataType="DateTime" />
</Controls>
```

**See also:**
- [AI-RULES.md](../AI-RULES.md#rule-6-system-columns---never-create-as-controls) - Rule 6: System Columns
- [database-conventions.md](../common/database-conventions.md) - AccountID and dbo.Account table

---

## Permissions

```xml
<Form Ident="MyForm">
  <!-- Who can view/edit records -->
  <DataPermissions>
    <string>Admin</string>
    <string>Editor</string>
  </DataPermissions>

  <!-- Who can create new records -->
  <CreatePermissions>
    <string>Admin</string>
    <string>Creator</string>
  </CreatePermissions>

  <!-- Who can access the form at all -->
  <AccessPermissions>
    <string>Admin</string>
  </AccessPermissions>

  <!-- Who is explicitly denied access -->
  <DenyPermissions>
    <string>Guest</string>
  </DenyPermissions>
</Form>
```

---

## Controls

Controls define input fields that map to database columns.

### Control Base Attributes (all controls)

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Unique identifier, becomes DB column name |
| `Title` | string | - | Control label (static) |
| `TitleResourceKey` | string | - | Control label from translations |
| `IsVisible` | bool | true | Show/hide control |
| `IsReadOnly` | bool | false | Read-only mode |
| `IsFakeReadOnly` | bool | false | Appears read-only but value is saved |
| `TabIndex` | int | 0 | Tab order index |
| `CssClass` | string | - | Custom CSS class |
| `HelpTitle` | string | - | Help tooltip title |
| `HelpTitleResourceKey` | string | - | Help tooltip title from translations |
| `HelpDescription` | string | - | Help tooltip content |
| `HelpDescriptionResourceKey` | string | - | Help tooltip content from translations |
| `IsShowUserWhere` | bool | true | Show in user filters |

### FormControl Attributes (controls with DB column)

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `DataType` | enum | - | Data type (String, Number, DateTime, Date, Bool, Guid, StringList) |
| `MaxLength` | int | 0 | Max length for String (0 = MAX/nvarchar(max)) |
| `IsCreateColumn` | bool | true | Create column in database |
| `IsFullText` | bool | false | Include in fulltext search |
| `DataTypeSize` | string | - | SQL data type size specification |
| `IsRequired` | bool | false | Required field validation |
| `IsShowRequired` | string | - | Show required asterisk (true/false/null) |
| `ErrorMessage` | string | - | Custom required error message |
| `ErrorMessageResourceKey` | string | - | Error message from translations |
| `IsAutoIncrement` | bool | false | Auto-increment field |
| `Default` | string | - | Default value |
| `IsAutoUpdate` | bool | false | Update with default value on every save |
| `ComputedExpression` | string | - | SQL computed column expression |
| `IsAutoComplete` | bool | true | Browser autocomplete |

### DataTypes

| Type | SQL Equivalent | Description |
|------|----------------|-------------|
| `String` | nvarchar(MaxLength) | Text, nvarchar(max) if MaxLength=0 |
| `Number` | int | Integer number |
| `DateTime` | datetime | Date and time |
| `Date` | date | Date only |
| `Bool` | bit | Boolean (0/1) |
| `Guid` | uniqueidentifier | GUID |
| `StringList` | - | Multiple values (stored in dbo.MultiSelect) |

---

## Control Types

### TextBoxControl
Single-line text input.

```xml
<Control xsi:type="TextBoxControl"
         Ident="Name"
         DataType="String"
         MaxLength="100"
         TitleResourceKey="Name_Form"
         IsRequired="true" />
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsRefresh` | bool | false | Refresh via DataBind on dependency change |
| `IsNumberFormat` | bool | false | Format as number |
| `TimeFormatType` | enum | Time99 | Time format (for DataType=Time) |

**With DataBind (dynamic value):**
```xml
<Control xsi:type="TextBoxControl" Ident="FullName" DataType="String" IsCreateColumn="false">
  <DataBind>
    <Dependencies>
      <string>FirstName</string>
      <string>LastName</string>
    </Dependencies>
    <Columns>
      <Column Ident="Value" DataBindType="Value" />
    </Columns>
    <SQL>
      SELECT CONCAT(@FirstName, ' ', @LastName) AS [Value]
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="FirstName" DataType="String" />
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="LastName" DataType="String" />
    </Parameters>
  </DataBind>
</Control>
```

---

### TextAreaControl
Multi-line text input.

```xml
<Control xsi:type="TextAreaControl"
         Ident="Description"
         DataType="String"
         Rows="5"
         TitleResourceKey="Description_Form" />
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Rows` | int | 3 | Number of visible rows |

---

### DropDownListControl
Dropdown select box.

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

**With static items:**
```xml
<Control xsi:type="DropDownListControl" Ident="Priority" DataType="Number">
  <ListItems>
    <ListItem Value="1" Title="Low" />
    <ListItem Value="2" Title="Medium" />
    <ListItem Value="3" Title="High" />
  </ListItems>
</Control>
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsAutoSelectFirst` | bool | false | Auto-select first item if only one |
| `ClearDepedenciType` | enum | Append | Clear behavior on dependency change (Append/Clear) |

---

### AutoCompleteControl
Searchable dropdown with async loading.

```xml
<Control xsi:type="AutoCompleteControl"
         Ident="CustomerID"
         DataType="Number"
         TitleResourceKey="Customer_Form"
         MinStartSearch="2"
         MaxItems="20">
  <!-- Search query -->
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

  <!-- Empty state query (shown before typing) -->
  <EmptyDataBind DefaultTitleResourceKey="SelectValue">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>
      SELECT TOP 10 ID, Name
      FROM usr.Customer
      WHERE State != 0
      ORDER BY Name
    </SQL>
  </EmptyDataBind>

  <!-- Selected value query (for edit mode) -->
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

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `MinStartSearch` | int | 0 | Min characters to start search |
| `MaxItems` | int | 0 | Max items in dropdown (0 = unlimited) |
| `IsAnyValue` | bool | false | Allow values not in DataBind |
| `IsAutoSelectFirst` | bool | false | Auto-select first if only one result |

---

### SwitchControl
Toggle switch (boolean).

```xml
<Control xsi:type="SwitchControl"
         Ident="IsActive"
         TitleResourceKey="IsActive_Form"
         Default="1"
         LabelPlacementType="Center" />
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Default` | string | "0" | Default value (0=off, 1=on) |
| `LabelPlacementType` | enum | Left | Label position (Left/Center/Right) |

---

### CheckBoxControl
Single checkbox.

```xml
<Control xsi:type="CheckBoxControl"
         Ident="AcceptTerms"
         TitleResourceKey="AcceptTerms_Form" />
```

---

### CheckBoxListControl
Multiple checkboxes.

```xml
<Control xsi:type="CheckBoxListControl"
         Ident="Categories"
         DataType="StringList"
         TitleResourceKey="Categories_Form">
  <DataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="Name" DataBindType="Title" />
    </Columns>
    <SQL>SELECT ID, Name FROM usr.Category WHERE State != 0</SQL>
  </DataBind>
</Control>
```

---

### RadioButtonListControl
Radio button group.

```xml
<Control xsi:type="RadioButtonListControl"
         Ident="Gender"
         DataType="String"
         TitleResourceKey="Gender_Form">
  <ListItems>
    <ListItem Value="M" TitleResourceKey="Male" />
    <ListItem Value="F" TitleResourceKey="Female" />
  </ListItems>
</Control>
```

---

### FileControl
File upload.

```xml
<Control xsi:type="FileControl"
         Ident="Attachment"
         TitleResourceKey="Attachment_Form"
         IsSingleFile="false"
         IsShowDeleteButton="true" />
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsSingleFile` | bool | false | Allow only one file |
| `IsShowDeleteButton` | bool | true | Show delete button |
| `AcceptExtensions` | string | - | Allowed extensions (e.g., ".pdf,.doc") |
| `MaxFileSize` | int | 0 | Max file size in bytes |

---

### RichTextBoxControl
WYSIWYG HTML editor.

```xml
<Control xsi:type="RichTextBoxControl"
         Ident="Content"
         DataType="String"
         Height="400"
         TitleResourceKey="Content_Form" />
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Height` | int | 300 | Editor height in pixels |

---

### TagControl
Tag input with autocomplete.

```xml
<Control xsi:type="TagControl"
         Ident="Tags"
         DataType="StringList"
         IsAnyValue="true"
         TitleResourceKey="Tags_Form">
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
</Control>
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsAnyValue` | bool | false | Allow custom tags not in DataBind |

---

### SubFormControl
Embedded sub-form (1:N relationship).

```xml
<Control xsi:type="SubFormControl"
         Ident="Items"
         FormIdent="OrderItem"
         TitleResourceKey="Items_Form"
         IsImmediatelySave="true"
         IsSortable="true"
         SortableControlIdent="SortOrder">
  <DataSource FormIdent="OrderItem">
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
      <Column Ident="ProductName" TitleResourceKey="Product" Width="50" />
      <Column Ident="Quantity" TitleResourceKey="Quantity" Width="20" />
      <Column Ident="Price" TitleResourceKey="Price" Width="30" />
    </Columns>
    <SQL>
      SELECT ID, ProductName, Quantity, Price
      FROM usr.OrderItem
      WHERE OrderID = @ID AND State != 0
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Control>
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `FormIdent` | string | - | **Required.** Sub-form identifier |
| `IsImmediatelySave` | bool | false | Save immediately without main form save |
| `IsShowList` | bool | true | Show list of existing records |
| `IsCreateButton` | bool | true | Show "Add" button |
| `IsDependencyOnParent` | bool | true | Link to parent record |
| `IsSortable` | bool | false | Enable drag-and-drop sorting |
| `SortableControlIdent` | string | - | Field for sort order |
| `InsertButtonIdent` | string | - | Custom insert button |
| `UpdateButtonIdent` | string | - | Custom update button |
| `DeleteButtonIdent` | string | - | Custom delete button |

---

### DataGridControl
Read-only data grid (for displaying related data).

```xml
<Control xsi:type="DataGridControl"
         Ident="RelatedRecords"
         TitleResourceKey="Related_Form">
  <DataSource FormIdent="RelatedForm">
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
      <Column Ident="Name" TitleResourceKey="Name" Width="60" />
      <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="RelatedForm" Width="40" />
    </Columns>
    <SQL>
      SELECT ID, Name, State
      FROM usr.RelatedForm
      WHERE ParentID = @ID AND State != 0
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Control>
```

---

### HiddenControl
Hidden field.

```xml
<Control xsi:type="HiddenControl"
         Ident="ParentID"
         DataType="Number" />

<!-- Primary key (auto-generated) -->
<Control xsi:type="HiddenControl"
         Ident="ID"
         DataType="Number"
         IsPrimaryKey="true" />
```

---

### TimeLineControl
History timeline display.

```xml
<Control xsi:type="TimeLineControl"
         Ident="Timeline"
         TitleResourceKey="History_Form"
         SortType="DESC">
  <HistoryTypes>
    <string>Create</string>
    <string>ChangeState</string>
    <string>Update</string>
  </HistoryTypes>
</Control>
```

---

### PasswordControl
Password input with hashing.

```xml
<Control xsi:type="PasswordControl"
         Ident="Password"
         DataType="String"
         TitleResourceKey="Password_Form"
         HashType="SHA256" />
```

**Additional attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `HashType` | enum | None | Hash algorithm (None/SHA256/SHA512/MD5) |

---

### Other Control Types

| Control Type | Description |
|--------------|-------------|
| `ColorPickerControl` | Color picker |
| `SignatureControl` | Digital signature capture |
| `MapDialogControl` | Map location picker |
| `TreeSelectBoxControl` | Hierarchical tree select |
| `DualListBoxControl` | Two-column list transfer |
| `ListBoxControl` | Multi-select listbox |
| `FilterControl` | Embedded filter |
| `CriteriaControl` | Query builder |
| `GraphControl` | Chart/graph display |
| `HTMLContentControl` | Static HTML content |
| `HTMLContentViewControl` | Dynamic HTML content |
| `CommunicationControl` | Comments/discussion |
| `CommunicationListControl` | List of communications |
| `DocumentApprovalControl` | Document approval workflow |
| `ToDoListControl` | Task list |
| `TimeControl` | Time entry |
| `QRCodeControl` | QR code display |
| `IconControl` | Icon picker |
| `TableControl` | Simple table |
| `ClientInlineTableControl` | Inline editable table |
| `FormDialogControl` | Modal form dialog |
| `PlaceHolderControl` | Placeholder for dynamic content |
| `SearchBoxControl` | Search input |
| `FolderTreeControl` | Folder tree display |
| `FolderPermissionControl` | Folder permissions editor |
| `CodeEditorControl` | Code editor with syntax highlighting |
| `LabelControl` | Static label |
| `AlertControl` | Alert/notification display |
| `EmptyControl` | Empty placeholder |
| `LanguageControl` | Language selector |
| `ExControl` | Extension control |
| `ExFormControl` | Extension form control |

---

## Validations

Add validations to FormControls:

```xml
<Control xsi:type="TextBoxControl" Ident="Email" DataType="String" MaxLength="100">
  <Validations>
    <Validation xsi:type="EmailValidation"
                Ident="EmailValidation"
                ErrorMessageResourceKey="InvalidEmail" />
  </Validations>
</Control>
```

### Validation Types

| Type | Description | Key Attributes |
|------|-------------|----------------|
| `EmailValidation` | Email format | - |
| `PhoneValidation` | Phone format | - |
| `NumberValidation` | Numeric value | - |
| `NumberOverflowValidation` | Number range check | Min, Max |
| `DoubleValidation` | Decimal number | - |
| `DoubleOverflowValidation` | Decimal range | Min, Max |
| `DateValidation` | Date format | - |
| `DateTimeValidation` | DateTime format | - |
| `DateTimePastValidation` | Date in past | - |
| `TimeValidation` | Time format | - |
| `RangeNumberValidation` | Number in range | Min, Max |
| `RegularExpressionValidation` | Regex pattern | Expression |
| `RequiredTrueValidation` | Must be true (checkbox) | - |
| `CompareValidation` | Compare with other field | CompareControlIdent |
| `RequiredIfValidation` | Required based on condition | ConditionControlIdent |
| `BirthNumberValidation` | Czech birth number | - |
| `MaxEmbedImageSizeValidation` | Image size limit | MaxSize |

**RegularExpressionValidation example:**
```xml
<Validation xsi:type="RegularExpressionValidation"
            Ident="PostalCodeValidation"
            Expression="^\d{3}\s?\d{2}$"
            ErrorMessageResourceKey="InvalidPostalCode" />
```

---

## Buttons

### Button Types

| Type | Description |
|------|-------------|
| `FormButton` | Submit button with save |
| `ActionButton` | Action without save |
| `BackButton` | Navigate back |
| `PrintButton` | Print form |
| `DownloadButton` | Download file |
| `ExportButton` | Export data |
| `GroupButton` | Button group/dropdown |

### FormButton

```xml
<Button xsi:type="FormButton"
        Ident="SaveButton"
        TitleResourceKey="Save"
        IsSave="true"
        PlacementType="Top Bottom"
        ColorType="Primary"
        IconCssClass="icon-floppy-disk" />
```

**Attributes:**
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Button identifier |
| `Title` | string | - | Button text |
| `TitleResourceKey` | string | - | Button text from translations |
| `IsSave` | bool | true | Save form data |
| `IsVisible` | bool | true | Show button |
| `PlacementType` | enum | Bottom | Position (Top/Bottom/Top Bottom) |
| `ColorType` | enum | Default | Bootstrap color (Primary/Success/Warning/Danger/Info) |
| `IconCssClass` | string | - | Icon CSS class |
| `IsBackRedirect` | bool | false | Redirect back after action |
| `IsStopRedirect` | bool | false | Stay on form after action |
| `MappingFormIdent` | string | - | Redirect to another form |

**With confirmation dialog:**
```xml
<Button xsi:type="FormButton" Ident="DeleteButton" TitleResourceKey="Delete" IsSave="false" ColorType="Danger">
  <Extensions>
    <Extension xsi:type="ConfirmDialogExtension"
               TitleResourceKey="ConfirmDelete"
               DescriptionResourceKey="ConfirmDeleteDesc" />
  </Extensions>
</Button>
```

**With form dialog:**
```xml
<Button xsi:type="FormButton" Ident="RejectButton" TitleResourceKey="Reject" IsSave="true">
  <Extensions>
    <Extension xsi:type="ConfirmFormDialogExtension"
               Ident="RejectDialog"
               ConfirmFormDialogSectionIdent="RejectDialogSection" />
  </Extensions>
</Button>
```

**With mapping (pass values to another form):**
```xml
<Button xsi:type="FormButton" Ident="CreateRelated" MappingFormIdent="RelatedForm" IsBackRedirect="true">
  <Mappings>
    <Mapping FromIdent="ID" ToIdent="ParentID" />
    <Mapping FromIdent="Name" ToIdent="ParentName" />
  </Mappings>
</Button>
```

---

## Sections

Sections organize form layout using HTMLTemplate.

### Section Types

| Type | Description |
|------|-------------|
| `ContentSection` | Main content section with HTML template |
| `HeaderSection` | Form header (shown at top) |
| `PrintSection` | Print-specific layout |
| `PDFSection` | PDF export layout |
| `DOCXSection` | Word export layout |
| `XLSXSection` | Excel export layout |
| `ConfirmFormDialogSection` | Modal dialog section |

### ContentSection

```xml
<Section xsi:type="ContentSection"
         Ident="MainSection"
         TitleResourceKey="BasicInfo"
         IconCssClass="ph-info">
  <HTMLTemplate>
    <div class="row">
      <div class="col-md-6">
        <div class="form-group">
          <ControlLabel ControlID="Name" />
          <Control ID="Name" />
        </div>
      </div>
      <div class="col-md-6">
        <div class="form-group">
          <ControlLabel ControlID="Email" />
          <Control ID="Email" />
        </div>
      </div>
    </div>
  </HTMLTemplate>
</Section>
```

**With visibility condition:**
```xml
<Section xsi:type="ContentSection" Ident="AdminSection">
  <VisibleCondition>
    <SQL>
      SELECT IIF(@State >= 10, 1, 0) AS IsVisible
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="State" DataType="Number" />
    </Parameters>
  </VisibleCondition>
  <HTMLTemplate>...</HTMLTemplate>
</Section>
```

### HeaderSection

```xml
<Section xsi:type="HeaderSection" Ident="Header">
  <Sources>
    <DataSource Ident="HeaderData">
      <Columns>
        <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="MyForm" IsColor="true" />
      </Columns>
      <SQL>SELECT State FROM usr.MyForm WHERE ID = @ID</SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
      </Parameters>
    </DataSource>
  </Sources>
  <HTMLTemplate>
    <h4>[%ACTUALFORM.Name%] - [%#HeaderData.State%]</h4>
  </HTMLTemplate>
</Section>
```

### ConfirmFormDialogSection

```xml
<Section xsi:type="ConfirmFormDialogSection"
         Ident="RejectDialog"
         TitleResourceKey="RejectReason"
         CloseButtonTitleResourceKey="Cancel"
         ConfirmButtonTitleResourceKey="Confirm">
  <HTMLTemplate>
    <div class="form-group">
      <ControlLabel ControlID="RejectReason" />
      <Control ID="RejectReason" />
    </div>
  </HTMLTemplate>
</Section>
```

---

## HTMLTemplate Syntax

### Control Rendering

```html
<!-- Render control -->
<Control ID="ControlIdent" />

<!-- Render control label -->
<ControlLabel ControlID="ControlIdent" />

<!-- Render button -->
<ControlButton ID="ButtonIdent" />
```

### Translations

```html
<!-- From resource key -->
[#ResourceKey#]

<!-- Example -->
<h3>[#FormTitle_MyModule#]</h3>
```

### Form Data

```html
<!-- Current form field value -->
[%ACTUALFORM.FieldName%]

<!-- Example -->
<span>Name: [%ACTUALFORM.Name%]</span>
<span>Created: [%ACTUALFORM.CreateDate%]</span>
```

### DataSource Values

```html
<!-- From DataSource in Section.Sources -->
[%#DataSourceIdent.ColumnIdent%]

<!-- Example with FOR loop -->
[FOR Source="ItemsDataSource"]
  <tr>
    <td>[%Name%]</td>
    <td>[%Price%]</td>
  </tr>
[/FOR]
```

### System Variables

```html
<!-- Logged-in user -->
[%ACCOUNT.ID%]
[%ACCOUNT.FullName%]
[%ACCOUNT.Email%]

<!-- URL parameters -->
[%URLPARAM.ParamName%]
```

---

## DataBind and DataSource

### DataBind Structure

```xml
<DataBind DefaultTitleResourceKey="SelectValue" DefaultValue="">
  <!-- Dependencies trigger reload when these controls change -->
  <Dependencies>
    <string>ParentControl</string>
  </Dependencies>

  <!-- Column mapping -->
  <Columns>
    <Column Ident="ID" DataBindType="Value" />
    <Column Ident="Name" DataBindType="Title" />
    <Column Ident="Description" DataBindType="Description" />
  </Columns>

  <!-- SQL query -->
  <SQL>
    SELECT ID, Name, Description
    FROM usr.MyTable
    WHERE ParentID = @ParentControl AND State != @DeletedState
    ORDER BY Name
  </SQL>

  <!-- Parameters -->
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ParentControl" DataType="Number" />
    <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="DeletedState" DataType="Number" Value="0" />
  </Parameters>
</DataBind>
```

### Parameter Types

| Type | Description |
|------|-------------|
| `dsp:VariableParameter` | Value from form control |
| `dsp:ValueParameter` | Static value |
| `dsp:ConstantParameter` | System constant |

**VariableParameter attributes:**
| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | Parameter/control name |
| `DataType` | enum | Data type |
| `LikeType` | enum | LIKE pattern (None/Left/Right/Both) |
| `MaxLength` | int | Max length for string |
| `ConstantType` | enum | System constant (UserID/UserLanguageID/FolderTreeID/...) |

### ConstantTypes

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

---

## Complete Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Form xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns:xsd="http://www.w3.org/2001/XMLSchema"
      xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
      Ident="Customer"
      SegmentType="CRMSegment"
      PackageIdent="CRMPackage">

  <DataPermissions>
    <string>CRMAdmin</string>
    <string>SalesRep</string>
  </DataPermissions>

  <CreatePermissions>
    <string>CRMAdmin</string>
    <string>SalesRep</string>
  </CreatePermissions>

  <Buttons>
    <Button xsi:type="FormButton" Ident="SaveButton" TitleResourceKey="Save_CRM"
            IsSave="true" PlacementType="Top Bottom" ColorType="Primary"
            IconCssClass="icon-floppy-disk" IsVisible="false" />

    <Button xsi:type="FormButton" Ident="DeleteButton" TitleResourceKey="Delete_CRM"
            IsSave="false" ColorType="Danger" PlacementType="Bottom" IsVisible="false">
      <Extensions>
        <Extension xsi:type="ConfirmDialogExtension"
                   TitleResourceKey="ConfirmDelete_CRM"
                   DescriptionResourceKey="ConfirmDeleteCustomer_CRM" />
      </Extensions>
    </Button>

    <Button xsi:type="BackButton" Ident="BackButton" TitleResourceKey="Back_CRM"
            IconCssClass="icon-undo2" />
  </Buttons>

  <Controls>
    <Control xsi:type="TextBoxControl" Ident="CompanyName" DataType="String"
             MaxLength="200" TitleResourceKey="CompanyName_CRM" IsRequired="true" />

    <Control xsi:type="TextBoxControl" Ident="Email" DataType="String"
             MaxLength="100" TitleResourceKey="Email_CRM">
      <Validations>
        <Validation xsi:type="EmailValidation" Ident="EmailVal"
                    ErrorMessageResourceKey="InvalidEmail_CRM" />
      </Validations>
    </Control>

    <Control xsi:type="TextBoxControl" Ident="Phone" DataType="String"
             MaxLength="20" TitleResourceKey="Phone_CRM" />

    <Control xsi:type="DropDownListControl" Ident="CategoryID" DataType="Number"
             TitleResourceKey="Category_CRM">
      <DataBind DefaultTitleResourceKey="SelectValue_CRM">
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="Name" DataBindType="Title" />
        </Columns>
        <SQL>
          SELECT ID, Name FROM usr.CustomerCategory WHERE State != 0 ORDER BY Name
        </SQL>
      </DataBind>
    </Control>

    <Control xsi:type="TextAreaControl" Ident="Notes" DataType="String"
             Rows="5" TitleResourceKey="Notes_CRM" />

    <Control xsi:type="SwitchControl" Ident="IsActive"
             TitleResourceKey="IsActive_CRM" Default="1" />

    <Control xsi:type="FileControl" Ident="Documents"
             TitleResourceKey="Documents_CRM" IsSingleFile="false" />

    <Control xsi:type="TimeLineControl" Ident="History" TitleResourceKey="History_CRM">
      <HistoryTypes>
        <string>Create</string>
        <string>ChangeState</string>
      </HistoryTypes>
    </Control>
  </Controls>

  <Sections>
    <Section xsi:type="HeaderSection" Ident="Header">
      <Sources>
        <DataSource Ident="WFState">
          <Columns>
            <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Customer" IsColor="true" />
          </Columns>
          <SQL>SELECT State FROM usr.Customer WHERE ID = @ID</SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
          </Parameters>
        </DataSource>
      </Sources>
      <HTMLTemplate>
        <div class="d-flex justify-content-between align-items-center">
          <h4>[%ACTUALFORM.CompanyName%]</h4>
          <span>[%#WFState.State%]</span>
        </div>
      </HTMLTemplate>
    </Section>

    <Section xsi:type="ContentSection" Ident="BasicInfo"
             TitleResourceKey="BasicInfo_CRM" IconCssClass="ph-user">
      <HTMLTemplate>
        <div class="row">
          <div class="col-md-6">
            <div class="form-group">
              <ControlLabel ControlID="CompanyName" />
              <Control ID="CompanyName" />
            </div>
          </div>
          <div class="col-md-6">
            <div class="form-group">
              <ControlLabel ControlID="CategoryID" />
              <Control ID="CategoryID" />
            </div>
          </div>
        </div>
        <div class="row">
          <div class="col-md-4">
            <div class="form-group">
              <ControlLabel ControlID="Email" />
              <Control ID="Email" />
            </div>
          </div>
          <div class="col-md-4">
            <div class="form-group">
              <ControlLabel ControlID="Phone" />
              <Control ID="Phone" />
            </div>
          </div>
          <div class="col-md-4">
            <div class="form-group">
              <Control ID="IsActive" />
            </div>
          </div>
        </div>
        <div class="row">
          <div class="col-md-12">
            <div class="form-group">
              <ControlLabel ControlID="Notes" />
              <Control ID="Notes" />
            </div>
          </div>
        </div>
      </HTMLTemplate>
    </Section>

    <Section xsi:type="ContentSection" Ident="Documents"
             TitleResourceKey="Documents_CRM" IconCssClass="ph-files">
      <HTMLTemplate>
        <div class="row">
          <div class="col-md-12">
            <Control ID="Documents" />
          </div>
        </div>
      </HTMLTemplate>
    </Section>

    <Section xsi:type="ContentSection" Ident="HistorySection"
             TitleResourceKey="History_CRM" IconCssClass="ph-clock">
      <HTMLTemplate>
        <Control ID="History" />
      </HTMLTemplate>
    </Section>
  </Sections>
</Form>
```

---

## Database Table Structure

Form with `Ident="Customer"` creates table:

```sql
CREATE TABLE usr.Customer (
    ID int IDENTITY(1,1) PRIMARY KEY,
    AccountID int NOT NULL,                    -- Creator user ID (FK to dbo.Account)
    CreateDate datetime NOT NULL DEFAULT(GETDATE()),
    LastUpdate datetime NOT NULL DEFAULT(GETDATE()),
    State tinyint NOT NULL DEFAULT(1),         -- WorkFlow state
    LastUpdateAccountID int NULL,              -- Last editor (FK to dbo.Account)
    FolderTreeID int NULL,                     -- Folder (FK to dbo.FolderTree)

    -- Custom columns from Controls:
    CompanyName nvarchar(200) NULL,
    Email nvarchar(100) NULL,
    Phone nvarchar(20) NULL,
    CategoryID int NULL,
    Notes nvarchar(max) NULL,
    IsActive bit NULL
)
```

**Note:** Files (FileControl) are stored in `dbo.File` table with reference to FormIdent and TableID.

---

## Related Entities

- **WorkFlow** - Define states, transitions, actions for this form
- **DataView** - Create list views for this form's data
- **AutomaticOperation** - Schedule automatic actions on form records
- **Package** - Group form with related configurations

---

## Best Practices

1. **Naming conventions:**
   - `Ident`: PascalCase (e.g., `CustomerForm`, `OrderItem`)
   - `TitleResourceKey`: `FieldName_Module` (e.g., `CompanyName_CRM`)
   - `SegmentType`: `ModuleSegment` (e.g., `CRMSegment`)

2. **Always set `MaxLength`** for String fields to optimize database

3. **Use `IsCreateColumn="false"`** for calculated/display-only fields

4. **Use `TitleResourceKey`** instead of `Title` for multi-language support

5. **Set `IsVisible="false"`** on buttons and use WorkFlow to control visibility

6. **Use DataBind with `DefaultTitleResourceKey`** for better UX

7. **Group related controls** in separate ContentSections

8. **Use HeaderSection** for quick record identification
