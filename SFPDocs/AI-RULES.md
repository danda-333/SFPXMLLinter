# AI XML Generation Rules - MANDATORY

**Version:** 1.0
**Last Updated:** 2026-01-25

---

## CRITICAL: READ BEFORE GENERATING ANY XML

This document contains MANDATORY rules for AI when generating SmartFormPlatform XML files. Violation of these rules will result in non-functional XML.

---

## Rule 0: THE GOLDEN RULE

```
NEVER INVENT ELEMENTS, ATTRIBUTES, OR VALUES.
EVERY element, attribute, and value MUST exist in the documentation.
If it's not documented, IT DOES NOT EXIST.
```

---

## Rule 1: Mandatory Pre-Generation Steps

Before generating ANY XML file, you MUST:

1. **IDENTIFY** the entity type (Form, WorkFlow, DataView, Filter, Configuration, Library)
2. **READ** the corresponding documentation file:
   - Form → `ai/entities/form.md`
   - WorkFlow → `ai/entities/workflow.md`
   - DataView → `ai/entities/dataview.md`
   - Filter → `ai/entities/filter.md`
   - Configuration → `ai/entities/configuration.md`
   - Library → `ai/entities/library.md`
3. **READ** common documentation:
   - `ai/common/datasource.md` - for DataSource, Parameters
   - `ai/common/buttons.md` - for button types
   - `ai/controls/*.md` - for control types
4. **VERIFY** every element name against documentation
5. **VERIFY** every attribute name against documentation
6. **VERIFY** every attribute value against documentation

---

## Rule 2: Entity-Specific Button Rules

### Form Buttons
```xml
<!-- CORRECT: Form buttons use xsi:type="FormButton" -->
<Button xsi:type="FormButton"
        Ident="Save"
        TitleResourceKey="Save_Button"
        IsSave="true"
        ColorType="Primary" />
```

### WorkFlow Buttons
```xml
<!-- CORRECT: WorkFlow buttons ONLY reference by Ident, NO xsi:type -->
<Button Ident="Save" IsVisible="true">
  <Actions>
    <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
  </Actions>
</Button>
```

### DataView Buttons
```xml
<!-- CORRECT: DataView uses LinkButton for form navigation -->
<Button xsi:type="LinkButton"
        Ident="New"
        FormIdent="Movie"
        TitleResourceKey="New_Button"
        ColorType="Primary" />

<!-- CORRECT: DataView uses ActionButton for actions -->
<Button xsi:type="ActionButton"
        Ident="Delete"
        ActionType="Delete"
        IsConfirm="true" />
```

### DO NOT
- Use `xsi:type="FormButton"` in WorkFlow
- Use `FormButtonType` attribute (does not exist)
- Use `ActionButton` with `ActionType="FormSectionNew"` (use LinkButton)

---

## Rule 3: WorkFlow Structure

### CORRECT Structure
```
WorkFlow
├── Definition
│   └── States
│       └── State (Value, TitleResourceKey, ColorCssClass)
└── Steps
    └── Step (State)
        └── Groups           <-- REQUIRED wrapper
            └── Group
                ├── Permissions
                │   └── <string>PermissionName</string>
                ├── Buttons
                │   └── Button (Ident, IsVisible, Actions)
                └── Controls
                    └── FormControl (Ident, IsReadOnly)
```

### DO NOT
```xml
<!-- WRONG: Permissions directly in Step -->
<Step State="1">
  <Permissions>
    <string>Admin</string>
  </Permissions>
</Step>

<!-- WRONG: ControlSettings element -->
<ControlSettings>
  <ControlSetting Ident="Name" />
</ControlSettings>
```

---

## Rule 4: DataView DataSource Requirements

### MANDATORY
```xml
<DataSource FormIdent="EntityName">  <!-- FormIdent REQUIRED -->
  <Columns>
    <!-- ID column MUST have IsPrimaryKey and IsVisible="false" -->
    <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" DataType="Number" />

    <!-- One column SHOULD have IsDefaultSort -->
    <Column Ident="Name" TitleResourceKey="Name_Column" IsDefaultSort="true" />

    <!-- State column MUST use WorkFlowStateColumn -->
    <Column xsi:type="WorkFlowStateColumn"
            Ident="State"
            FormIdent="EntityName"
            TitleResourceKey="State_Column"
            IsColor="true" />
  </Columns>
</DataSource>
```

### DO NOT
- Omit `FormIdent` on DataSource
- Use `TitleResourceKey` on ID column
- Create CASE expressions for state names (use WorkFlowStateColumn)
- Use `HeaderResourceKey` (correct is `TitleResourceKey`)

---

## Rule 5: Attribute Value Rules

### Bool DataType Default Values
```xml
<!-- CORRECT -->
<Control xsi:type="CheckBoxControl"
         Ident="IsActive"
         DataType="Bool"
         Default="0" />  <!-- false = 0 -->

<Control xsi:type="CheckBoxControl"
         Ident="IsEnabled"
         DataType="Bool"
         Default="1" />  <!-- true = 1 -->
```

### DO NOT
```xml
<!-- WRONG: String values for Bool -->
Default="false"
Default="true"
```

### ColorType Enum - ONLY USE THESE VALUES

Based on `ColorTypes` enum in source code:

| Value | CSS Class | Usage |
|-------|-----------|-------|
| `Primary` | `btn-primary` | Blue - main actions |
| `Warning` | `btn-warning` | Yellow/Orange - caution |
| `Success` | `btn-success` | Green - positive actions |
| `Danger` | `btn-danger` | Red - destructive actions |
| `Light` | `btn-light` | Light background |

**DO NOT USE (these do not exist in enum):**
- `Secondary` - DOES NOT EXIST
- `Info` - DOES NOT EXIST
- `Dark` - DOES NOT EXIST

---

## Rule 6: System Columns - NEVER Create as Controls

**CRITICAL:** The following columns are AUTOMATICALLY generated by the system and stored in the database table created by Form. **DO NOT** create Controls (including HiddenControl) for these columns.

### System Columns (Auto-Generated)

| Column | Type | Description | Managed By |
|--------|------|-------------|------------|
| `ID` | int | Primary key (auto-increment) | System |
| `AccountID` | nvarchar(450) | User who created the record (FK to dbo.Account) | System |
| `CreateDate` | datetime | Creation timestamp | System |
| `LastUpdate` | datetime | Last modification timestamp | System |
| `State` | tinyint | Workflow state | WorkFlow |
| `LastUpdateAccountID` | nvarchar(450) | User who last modified (FK to dbo.Account) | System |

### Why NOT to Create Controls for System Columns

1. **They exist automatically** - Form creates these columns in the database table
2. **They are managed by the system** - Values are set automatically on save
3. **Controls would be redundant** - System overwrites any manual values
4. **Potential conflicts** - Manual Controls can interfere with system logic

### ❌ WRONG - Creating Controls for System Columns

```xml
<!-- WRONG: DO NOT create Controls for system columns -->
<Controls>
  <Control xsi:type="HiddenControl" Ident="ID" DataType="Number" />
  <Control xsi:type="HiddenControl" Ident="AccountID" DataType="String" />
  <Control xsi:type="HiddenControl" Ident="CreateDate" DataType="DateTime" />
  <Control xsi:type="HiddenControl" Ident="LastUpdate" DataType="DateTime" />
  <Control xsi:type="HiddenControl" Ident="State" DataType="Number" />
  <Control xsi:type="HiddenControl" Ident="LastUpdateAccountID" DataType="String" />

  <!-- Also WRONG with different names -->
  <Control xsi:type="HiddenControl" Ident="CreatedBy" DataType="String" />
  <Control xsi:type="HiddenControl" Ident="CreatedDate" DataType="DateTime" />
  <Control xsi:type="HiddenControl" Ident="ModifiedBy" DataType="String" />
  <Control xsi:type="HiddenControl" Ident="ModifiedDate" DataType="DateTime" />
</Controls>
```

### ✅ CORRECT - System Columns Exist Automatically

```xml
<!-- CORRECT: No Controls for system columns needed -->
<Controls>
  <!-- Only create Controls for YOUR business fields -->
  <Control xsi:type="TextBoxControl" Ident="Name" DataType="String" MaxLength="200" />
  <Control xsi:type="TextBoxControl" Ident="Description" DataType="String" MaxLength="500" />
  <Control xsi:type="DropDownListControl" Ident="CategoryID" DataType="Number">
    <!-- DataBind... -->
  </Control>
</Controls>
```

### Using System Columns in DataView

System columns can be used in DataView SQL and displayed as columns:

```xml
<DataSource FormIdent="Task">
  <Columns>
    <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" DataType="Number" />
    <Column Ident="Name" TitleResourceKey="Name" Width="40" />

    <!-- Show creator name via JOIN -->
    <Column Ident="CreatedByName" TitleResourceKey="CreatedBy" Width="20">
      <SQL><![CDATA[acc.FullName AS CreatedByName]]></SQL>
    </Column>

    <!-- Show creation date -->
    <Column Ident="CreateDate" TitleResourceKey="Created" Width="15"
            DataType="DateTime" Format="{0:d}" />
  </Columns>
  <SQL><![CDATA[
    SELECT
      t.ID,
      t.Name,
      t.CreateDate,
      acc.FullName AS CreatedByName
    FROM usr.Task t
    LEFT JOIN dbo.Account acc ON acc.ID = t.AccountID
    WHERE t.State != 0
  ]]></SQL>
</DataSource>
```

### Using Current User ID in Parameters

To get the ID of the currently logged-in user, use `ConstantType="UserID"`:

```xml
<Parameters>
  <dsp:Parameter xsi:type="dsp:VariableParameter"
                 Ident="CurrentUserID"
                 DataType="Number"
                 ConstantType="UserID" />
</Parameters>
```

**See also:**
- [database-conventions.md](common/database-conventions.md) - AccountID and dbo.Account table
- [datasource.md](common/datasource.md) - ConstantType="UserID"

---

## Rule 7: Validation Types

### CORRECT Validation Types
```xml
<Validation xsi:type="EmailValidation" />
<Validation xsi:type="PhoneValidation" />
<Validation xsi:type="RegularExpressionValidation" Pattern="..." />
<Validation xsi:type="NumberValidation" />
<Validation xsi:type="DoubleValidation" Digits="2" />
<Validation xsi:type="RangeNumberValidation" Min="0" Max="100" />
<Validation xsi:type="BirthNumberValidation" />
```

### DO NOT
```xml
<!-- WRONG: RangeValidation does not exist -->
<Validation xsi:type="RangeValidation" Min="0" Max="100" />
```

---

## Rule 8: WorkFlow Action Types

### CORRECT Action Types
| Type | Purpose | Example |
|------|---------|---------|
| `ChangeState` | Change workflow state | `<Action xsi:type="ChangeState" State="10" />` |
| `SetValue` | Set field value | `<Action xsi:type="SetValue" Ident="Field" Value="1" />` |
| `ActionTrigger` | Execute SQL | With `<DataSource><SQL>...</SQL></DataSource>` |
| `Required` | Make fields required | With `<Idents><string>Field</string></Idents>` |
| `IF` / `IFExpression` | Conditional execution | With `<Condition>` and `<TrueActions>` |
| `Email` | Send email | With `<Recipients>` |
| `GlobalValidation` | Custom validation | With `<Condition>` and `ErrorMessageResourceKey` |

### DO NOT
```xml
<!-- WRONG: SQLAction does not exist -->
<Action xsi:type="SQLAction">
  <SQL>UPDATE ...</SQL>
</Action>
```

---

## Rule 9: DataSource Parameter Types

### CORRECT Parameter Types
```xml
<!-- For form field values -->
<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />

<!-- For static/constant values -->
<dsp:Parameter xsi:type="dsp:ValueParameter" Ident="Status" Value="1" DataType="Number" />

<!-- For row values in DataView -->
<dsp:Parameter xsi:type="dsp:RowParameter" Ident="ID" ColumnIdent="ID" DataType="Number" />

<!-- For system constants -->
<dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number" />
```

### DO NOT
```xml
<!-- WRONG: IDParameter does not exist -->
<dsp:Parameter xsi:type="dsp:IDParameter" Ident="ID" />
```

---

## Rule 10: Permissions Management

### Two Types of Permissions

1. **Static Permissions** - Created via SQL scripts (see `ai/common/permissions.md`)
2. **Computed Permissions** - Defined in Configuration.xml PermissionSection

### Static Permissions - SQL Scripts

```sql
-- Create permission via SQL
DECLARE @Name nvarchar(256) = 'MovieEditor'
DECLARE @ParentRoleName nvarchar(256) = 'RoleMovie'
DECLARE @Weight smallint = 10

-- Insert into AspNetRoles, Permission, Role tables
-- (See ai/common/permissions.md for full script)
```

**Static permissions are NOT defined in XML.**

### Computed Permissions - Configuration.xml

```xml
<!-- CORRECT: Only for SQL-based computed permissions -->
<Section xsi:type="PermissionSection">
  <Computes>
    <ComputedPermission Permission="MovieAuthorComputed">
      <DataSource>
        <SQL>
          SELECT m.ID AS TableID, m.CreatedBy AS AccountID
          FROM usr.Movie m WHERE m.State != 0 #TABLE[m.ID]#
        </SQL>
      </DataSource>
    </ComputedPermission>
  </Computes>
</Section>
```

### DO NOT
```xml
<!-- WRONG: <Permissions>, <Permission>, <PermissionItem> do NOT exist -->
<Section xsi:type="PermissionSection">
  <Permissions>
    <Permission Ident="Admin">
      <Items>
        <PermissionItem Type="Segment" Value="..." />
      </Items>
    </Permission>
  </Permissions>
</Section>
```

**Key Principle:** Static permissions = SQL + admin UI. Computed permissions = Configuration.xml.

---

## Rule 11: Form Sections

### SUPPORTED Section Types in Form
- `ContentSection` - main content with HTML template
- `HeaderSection` - header outside tabs
- `ConfirmFormDialogSection` - modal dialog
- `PrintSection` - print layout
- `PDFSection` - PDF export
- `DOCXSection` - Word export
- `XLSXSection` - Excel export
- `GlobalChangeSection` - bulk edit
- `FastEditSection` - inline edit

### DO NOT
```xml
<!-- WRONG: ImportSection does not exist in Form -->
<Section xsi:type="ImportSection" />
```

---

## Quick Reference Checklist

Before submitting generated XML, verify:

- [ ] Every element name exists in documentation
- [ ] Every attribute name exists in documentation
- [ ] Every attribute value is valid for that attribute
- [ ] WorkFlow uses `Groups > Group > Permissions` structure
- [ ] WorkFlow buttons have no `xsi:type`
- [ ] DataView uses `LinkButton` for form navigation
- [ ] DataSource has `FormIdent` attribute
- [ ] ID column has `IsPrimaryKey="true"` and `IsVisible="false"`
- [ ] State column uses `WorkFlowStateColumn`
- [ ] Bool defaults use `0` or `1`, not `false` or `true`
- [ ] `ColorType` uses only Primary, Secondary, Success, Danger, Warning
- [ ] No invented elements or attributes

---

## Rule 12: XML Formatting Standards

### Required Formatting

All generated XML MUST follow these formatting rules:

1. **One element per line** - never put multiple elements on same line
2. **Tab indentation** - use ONE tab per nesting level (never spaces)
3. **Self-closing tags** - use when possible: `<Control />`
4. **Paired tags** - opening and closing tags on separate lines (except single text values)
5. **type parameter first** - `xsi:type` or `type` must be first attribute

```xml
<!-- CORRECT -->
<Control xsi:type="TextBoxControl"
         Ident="Name"
         DataType="String"
         IsReadOnly="true" />

<!-- WRONG: Multiple attributes on same line without proper breaks -->
<Control xsi:type="TextBoxControl" Ident="Name" DataType="String" IsReadOnly="true" />

<!-- WRONG: type parameter not first -->
<Control Ident="Name" xsi:type="TextBoxControl" />
```

### SQL Formatting

- **UPPERCASE keywords** - all SQL keywords: `SELECT`, `WHERE`, `JOIN`, `AS`, etc.
- **One column per line** - each SELECT column on new line
- **Readable layout** - proper indentation and line breaks

```xml
<SQL><![CDATA[
  SELECT
    p.ID,
    p.Name,
    p.State
  FROM usr.Product p
  WHERE p.State != 0
    AND #PERMISSION[Product(p)]#
  ORDER BY p.Name
]]></SQL>
```

See [xml-conventions.md](xml-conventions.md) for complete formatting rules.

---

## Rule 13: Naming Conventions

### Identifiers (Idents)

All identifiers MUST follow these rules:

- **No diacritics** - ASCII characters only
- **PascalCase** - `ProductName`, `DateFrom`, `AttendanceWorkFlow`
- **Singular forms** - Form Idents use singular: `Product` (not `Products`)
- **Plural for multi-select** - Field Idents for multi-select: `CategoryIDs`

### Translation Keys (TitleResourceKey)

**Format:** `[Value]_[Module]`

```xml
<!-- CORRECT -->
TitleResourceKey="Name_Product"
TitleResourceKey="SaveButton_Attendance"
TitleResourceKey="CompanyName_OOC_CRM"  <!-- Out of context -->

<!-- WRONG -->
TitleResourceKey="Name-Product"  <!-- Wrong separator -->
TitleResourceKey="product_name"  <!-- Wrong case -->
TitleResourceKey="NameProduct"   <!-- Missing separator -->
```

### Special Formats

| Type | Format | Example |
|------|--------|---------|
| Standard | `[Value]_[Module]` | `Name_Product` |
| Email subject | `[Value]Subject_Email_[Module]` | `ApprovalSubject_Email_Attendance` |
| Email body | `[Value]Body_Email_[Module]` | `ApprovalBody_Email_Attendance` |
| Error message | `[Value]_Error_[Module]` | `InvalidValue_Error_Product` |
| Out of context | `[Value]_OOC_[Module]` | `Street_OOC_CRM` |
| Short version | `[Value]_Short_[Module]` | `CompanyName_Short_CRM` |

See [xml-conventions.md](xml-conventions.md) for complete naming rules.

---

## Rule 14: Default States

### Form Fields - Must be Read-Only

All form fields MUST default to `IsReadOnly="true"`:

```xml
<!-- CORRECT -->
<Control xsi:type="TextBoxControl"
         Ident="Name"
         DataType="String"
         IsReadOnly="true" />
```

Fields are enabled in WorkFlow:

```xml
<Step State="1">
  <Groups>
    <Group>
      <Controls>
        <FormControl Ident="Name" IsReadOnly="false" />
      </Controls>
    </Group>
  </Groups>
</Step>
```

### Form Buttons - Must be Hidden

All form buttons MUST default to `IsVisible="false"`:

```xml
<!-- CORRECT -->
<Button xsi:type="FormButton"
        Ident="SaveButton"
        TitleResourceKey="Save_Button"
        IsVisible="false" />
```

Buttons are shown in WorkFlow:

```xml
<Step State="1">
  <Groups>
    <Group>
      <Buttons>
        <Button Ident="SaveButton" IsVisible="true" />
      </Buttons>
    </Group>
  </Groups>
</Step>
```

---

## Rule 15: WorkFlow State Management (CRITICAL)

**MOST COMMON MISTAKE: Using State 1 for both creating AND editing records.**

### Mandatory State Structure

Every WorkFlow MUST have at minimum:

| State | Purpose | ColorCssClass | Usage |
|-------|---------|---------------|-------|
| **0** | Deleted | `danger` | `DeleteState="0"` - record is deleted |
| **1** | New/Creating | `warning` | `StartState="1"` - record is BEING CREATED (not yet saved) |
| **10** | Saved/Draft | `primary` | Record EXISTS in DB and can be edited |

### CRITICAL Rule: State 1 Save Button MUST Change State

```xml
<!-- CORRECT: State 1 Save button changes to State 10 -->
<Step State="1">
  <Groups>
    <Group>
      <Permissions>
        <string>User</string>
      </Permissions>
      <Buttons>
        <Button Ident="SaveButton" IsVisible="true">
          <Actions>
            <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
          </Actions>
        </Button>
      </Buttons>
      <Controls>
        <FormControl Ident="Name" IsReadOnly="false" />
      </Controls>
    </Group>
  </Groups>
</Step>

<!-- MANDATORY: State 10 must exist for saved records -->
<Step State="10">
  <Groups>
    <Group>
      <Permissions>
        <string>User</string>
      </Permissions>
      <Buttons>
        <!-- Save button can stay in State 10 -->
        <Button Ident="SaveButton" IsVisible="true" />

        <!-- Submit button moves to next workflow state -->
        <Button Ident="SubmitButton" IsVisible="true">
          <Actions>
            <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
          </Actions>
        </Button>
      </Buttons>
      <Controls>
        <FormControl Ident="Name" IsReadOnly="false" />
      </Controls>
    </Group>
  </Groups>
</Step>
```

### DO NOT - Common Mistakes

```xml
<!-- WRONG: State 1 Save button without ChangeState -->
<Step State="1">
  <Groups>
    <Group>
      <Buttons>
        <Button Ident="SaveButton" IsVisible="true" />  <!-- NO ChangeState! -->
      </Buttons>
    </Group>
  </Groups>
</Step>

<!-- WRONG: No Step State="10" defined -->
<Steps>
  <Step State="1">...</Step>
  <Step State="20">...</Step>  <!-- Jumped from 1 to 20 without State 10 -->
</Steps>
```

### State Numbering Conventions

| Range | Purpose | Examples | ColorCssClass |
|-------|---------|----------|---------------|
| 0 | Deleted | `Deleted` | `danger` |
| 1 | Creating | `New`, `Creating` | `warning` |
| 2-9 | First save | `Saved`, `Draft` | `primary` |
| 10-29 | In progress | `InProgress`, `Concept`, `Developed` | `primary` |
| 30-49 | Waiting | `WaitingForApproval`, `Submitted` | `info` |
| 50-69 | Rejected | `Rejected`, `Paused`, `CriteriaNotFilled` | `danger` |
| 70-99 | Approved | `Approved`, `Active`, `Published` | `success` |
| 100+ | Closed | `Completed`, `Archived`, `Closed` | `dark` |

### Pre-Generation Checklist for WorkFlow

Before generating WorkFlow, verify:

- [ ] State 0 exists with `ColorCssClass="danger"`
- [ ] State 1 exists with `ColorCssClass="warning"`
- [ ] State 10 exists with `ColorCssClass="primary"`
- [ ] `StartState="1"` and `DeleteState="0"` are set
- [ ] Step State="1" has Save button with ChangeState action to State 10
- [ ] Step State="10" exists
- [ ] State numbers follow logical progression (1, 10, 20, 30...)
- [ ] No state is used for both "creating" and "editing"

**SEE ALSO:**
- `ai/entities/workflow.md` - Complete WorkFlow documentation with State Best Practices section
- `ai/workflow-state-checklist.md` - Quick reference checklist

---

## Rule 16: Library Placeholders

When generating Library XML for SQL database objects, **ALWAYS use placeholders** for consistency and idempotency.

### MANDATORY Placeholders

| Placeholder | Purpose | Used In |
|-------------|---------|---------|
| `#MODIFIER#` | CREATE, ALTER, or CREATE OR ALTER | StoredProcedure, Function, View |
| `#NAME#` | Full object name with schema `[schema].[Ident]` | All Library types |

### CORRECT - Using Placeholders (RECOMMENDED)

```xml
<Library Ident="usp_GetEmployees" LibraryType="StoredProcedure">
	<Command><![CDATA[
		#MODIFIER# PROCEDURE #NAME#
			@DepartmentID INT = NULL
		AS
		BEGIN
			SET NOCOUNT ON;
			SELECT * FROM usr.Employee
			WHERE @DepartmentID IS NULL OR DepartmentID = @DepartmentID
		END
	]]></Command>
</Library>
```

**System replaces:**
- `#MODIFIER#` → `CREATE OR ALTER`
- `#NAME#` → `[dbo].[usp_GetEmployees]`

### ALSO CORRECT - Explicit CREATE OR ALTER

```xml
<Library Ident="fn_GetFullName" LibraryType="Function">
	<Command><![CDATA[
		CREATE OR ALTER FUNCTION [dbo].[fn_GetFullName]
		(
			@FirstName NVARCHAR(100),
			@LastName NVARCHAR(100)
		)
		RETURNS NVARCHAR(255)
		AS
		BEGIN
			RETURN @FirstName + ' ' + @LastName
		END
	]]></Command>
</Library>
```

### DO NOT

```xml
<!-- WRONG: Using CREATE without OR ALTER - fails on re-upload -->
<Library Ident="vw_ActiveUsers" LibraryType="View">
	<Command><![CDATA[
		CREATE VIEW [dbo].[vw_ActiveUsers]
		AS
		SELECT * FROM dbo.Account WHERE [State] = 1
	]]></Command>
</Library>
```

### TableType Special Case

TableType does NOT support `#MODIFIER#` (only `#NAME#`) because table types cannot be altered:

```xml
<Library Ident="tt_IDList" LibraryType="TableType">
	<Command><![CDATA[
		IF TYPE_ID('#NAME#') IS NOT NULL
			DROP TYPE #NAME#
		GO
		
		CREATE TYPE #NAME# AS TABLE
		(
			ID INT NOT NULL PRIMARY KEY
		)
	]]></Command>
</Library>
```

### Naming Conventions

| Object Type | Prefix | Example |
|-------------|--------|---------|
| StoredProcedure | `usp_` | `usp_GetEmployees` |
| Function (scalar) | `fn_` | `fn_CalculateTax` |
| Function (table-valued) | `tvf_` | `tvf_GetPermissions` |
| View | `vw_` | `vw_ActiveEmployees` |
| TableType | `tt_` | `tt_IDList` |

### Pre-Generation Checklist for Library

Before generating Library XML, verify:

- [ ] `LibraryType` is one of: `StoredProcedure`, `Function`, `View`, `TableType`
- [ ] `Ident` follows naming conventions (usp_, fn_, vw_, tt_)
- [ ] Command is wrapped in `<![CDATA[...]]>`
- [ ] `#MODIFIER#` is used for Procedure/Function/View (recommended)
- [ ] `#NAME#` is used instead of hardcoded schema.name
- [ ] TableType uses only `#NAME#` (not `#MODIFIER#`)
- [ ] SQL keywords are UPPERCASE (SELECT, FROM, WHERE...)
- [ ] `SET NOCOUNT ON;` is included in procedures

**SEE ALSO:**
- `ai/entities/library.md` - Complete Library documentation with advanced examples

---

## Error Recovery

If you realize you've generated invalid XML:

1. **STOP** - don't continue building on broken foundation
2. **IDENTIFY** - which rule was violated
3. **READ** - the relevant documentation section
4. **FIX** - replace incorrect elements with documented ones
5. **VERIFY** - against this checklist again

---

## References

| Entity | Documentation |
|--------|---------------|
| **XML Conventions** | `ai/xml-conventions.md` ⭐ **Read for XML formatting & naming** |
| **C# Coding Standards** | `ai/csharp-coding-standards.md` ⭐ **Read for C# coding conventions** |
| Form | `ai/entities/form.md` |
| WorkFlow | `ai/entities/workflow.md` |
| DataView | `ai/entities/dataview.md` |
| Filter | `ai/entities/filter.md` |
| Configuration | `ai/entities/configuration.md` |
| Library | `ai/entities/library.md` ⭐ **SQL objects: procedures, functions, views, table types** |
| Plugin Development | `ai/plugin-development.md` ⭐ **C# plugin development guide** |
| Controls | `ai/controls/*.md` |
| DataSource | `ai/common/datasource.md` |
| Buttons | `ai/common/buttons.md` |
| Validations | `ai/common/validations.md` |
