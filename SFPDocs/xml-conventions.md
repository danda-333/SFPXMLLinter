# XML Configuration Conventions

**Version:** 2.0.1 (based on "Konvence SFP konfigurací")
**Purpose:** Standards for formatting, naming, and structuring SFP XML configurations

---

## Overview

This document defines mandatory conventions for creating SmartFormPlatform XML configurations. These rules ensure consistency, readability, and maintainability across all projects.

---

## Table of Contents

1. [XML Formatting](#xml-formatting)
2. [HTML Formatting](#html-formatting)
3. [SQL Formatting](#sql-formatting)
4. [Naming Conventions](#naming-conventions)
5. [General Conventions](#general-conventions)
6. [Design Standards](#design-standards)
7. [Project Structure](#project-structure)

---

## XML Formatting

### Required Rules

1. **Valid XML** - all XML must be well-formed
2. **One element per line** - use "Word wrap" in VS Code for readability
3. **Paired vs. self-closing tags**:
   - Use self-closing tags when possible: `<Control />`
   - Use paired tags only when necessary
   - When using paired tags, opening and closing tags must be on separate lines

```xml
<!-- CORRECT: Self-closing -->
<Control xsi:type="TextBoxControl" Ident="Name" DataType="String" />

<!-- CORRECT: Paired tags on separate lines -->
<Buttons>
  <Button xsi:type="FormButton" Ident="Save" />
</Buttons>

<!-- WRONG: Paired tags on same line (unless single text value) -->
<Buttons><Button xsi:type="FormButton" Ident="Save" /></Buttons>
```

4. **Logical ordering** - group related elements, separate groups with blank lines or comments
5. **Indentation** - use exactly ONE tab for each nesting level
6. **Values** - either indented by one tab OR not indented at all
7. **SQL and HTML** - must be formatted according to their respective sections
8. **type parameter first** - if element has `xsi:type` or `type` attribute, it must be first

```xml
<!-- CORRECT: type parameter first -->
<Control xsi:type="TextBoxControl"
         Ident="Name"
         DataType="String" />

<!-- WRONG: type parameter not first -->
<Control Ident="Name"
         xsi:type="TextBoxControl"
         DataType="String" />
```

### DO NOT

- Never indent with spaces instead of tabs
- Do not copy XML from other projects without reformatting
- Do not copy XML from documentation without reformatting

### Recommendations

- Enable "Word wrap" globally in VS Code for all XML files
- Set editor tab size to 2 spaces (visual representation)
- Install VS Code extension "XML (XML Language Support by Red Hat)" for:
  - Proper folding
  - Complete XML validation
  - Auto-formatting

### Exceptions

1. **XML may be invalid** in `<Command>`, `<SQL>`, and `<HTMLTemplate>` elements
   - Future versions will add `<![CDATA[]]>` escape support
2. **Same-line paired tags** are allowed when content is only a simple string without line breaks
   - **REQUIRED for `<string>` elements** - system functionality depends on it

```xml
<!-- CORRECT: string element must be on one line -->
<Permissions>
  <string>ProductAdmin</string>
</Permissions>

<!-- WRONG: string element split across lines breaks system -->
<Permissions>
  <string>
    ProductAdmin
  </string>
</Permissions>
```

---

## HTML Formatting

### Required Rules

1. **Valid HTML** - all HTML must be well-formed
2. **Indent nested elements** - use one tab for each nesting level
3. **Multiple elements per line** - allowed only for inline (non-block) elements
4. **Opening and closing tags** - may be on same line if content is text-only

```xml
<HTMLTemplate><![CDATA[
  <div class="row">
    <div class="col-md-6">
      <h3>Product Details</h3>
      <p>Price: <strong>[%Price%]</strong></p>
    </div>
  </div>
]]></HTMLTemplate>
```

### DO NOT

- Do not copy HTML from documentation or other sources without reformatting

### Recommendations

- Use self-closing syntax for unpaired tags (e.g., `<img />`) until `<![CDATA[]]>` support is added

### Exceptions

- **Special tags and elements** (e.g., `[FOR]`, `[IF]`, `<ControlID>`) may be ignored for indentation purposes
  - Indent the special tags, but keep nested elements at same level

```xml
<HTMLTemplate><![CDATA[
  <div class="card">
    [FOR Source="ParentProjectTask"]
    <div class="card-header">
      <h6 class="card-title">[#BasicInfo_ProjectTask#]</h6>
    </div>
    <div class="card-body">
      <Control ID="Name" />
    </div>
    [/FOR]
  </div>
]]></HTMLTemplate>
```

---

## SQL Formatting

### Required Rules

1. **System words in UPPERCASE** - all SQL keywords: `SELECT`, `UPDATE`, `AS`, `IN`, `WHERE`, `JOIN`, etc.
2. **Use aliases** - in most cases (see exceptions)
3. **Column order matches XML** - columns in `SELECT` should match order in `<Columns>` (except justified exceptions)
4. **Readable formatting** - queries must be formatted for readability

```sql
SELECT
  p.ID,
  p.SKU,
  p.Name,
  c.Name AS CategoryName,
  p.UnitPrice,
  p.State
FROM usr.Product p
LEFT JOIN usr.Category c ON c.ID = p.CategoryID
WHERE p.State != @DeletedState
  AND #PERMISSION[Product(p)]#
  #FILTER#
ORDER BY p.SKU
```

### DO NOT

- **Never use** `[usr/dbo].[Table].[Column]` syntax - this is not allowed
- Do not copy queries from documentation or other sources without proper formatting
- Do not write single-line queries (except when it doesn't affect readability)

### Recommendations

- **Each column on new line**
- **Each JOIN on new line**
- **WHERE on new line**
  - Multiple conditions: each condition on new line
- **Blocks in parentheses** on new line and indented

```sql
-- GOOD: Readable formatting
SELECT
  att.ID,
  emp.FullNameNumberReverse AS EmployeeID,
  act.TestValue AS ActivityType,
  att.DateFrom AS DateFrom,
  IIF(
    att.DurationMinute IS NOT NULL,
    CONCAT(FORMAT(att.DurationMinute / 60, '0.H:mm'), ', FORMAT(att.DurationMinute % 60, 'čč-CZ')),
    ''
  ) AS Duration,
  att.State
FROM usr.Attendance att
LEFT JOIN usr.Employee emp ON emp.ID = att.EmployeeID
LEFT JOIN usr.ActivityType act ON act.Ident = att.ActivityType
WHERE att.[State] != @DeletedState
  AND att.ApproverID = @UserID
  AND #PERMISSION[Attendance](att)# #FILTER#
ORDER BY att.DateFrom DESC
```

### Exceptions

1. **Alias not needed** when querying only one table

---

## Naming Conventions

All identifiers and translations must follow these rules.

### General Rules

- **No diacritics** - use only ASCII characters
- **PascalCase** - all names use PascalCase (e.g., `ProductName`, `DateFrom`)

### Translation Keys (Resources)

**Format:** `[Value]_[Module]`

Where:
- `[Value]` = Closest English translation OR Ident of the element
- `[Module]` = Module Ident

| Translation Type | Format | Example |
|-----------------|--------|---------|
| Standard | `[Value]_[Module]` | `Company_Ticket` (Company) |
| Email subject | `[Value]Subject_Email_[Module]` | `AttendanceToYourApproveSubject_Email_Attendance` |
| Email body | `[Value]Body_Email_[Module]` | `AttendanceToYourApproveBody_Email_Attendance` |
| Error message | `[Value]_Error_[Module]` | `ValueCannotBeNegative_Error_Attendance` |
| Out of context | `[Value]_OOC_[Module]` | `BillingStreet_OOC_CRM` (Street (Billing)) - for use in views |
| Short version | `[Value]_Short_[Module]` | `BillingStreet_Short_CRM` |

### Identifiers (Idents)

#### Form Ident

**Format:** English name of form in **singular**

```
Form Ident: Attendance (not Attendances)
Form Ident: Product (not Products)
```

**File naming:**

```
Form file:     CRMProject.xml
WorkFlow file: CRMProjectWorkFlow.xml
View file:     CRMProjectAllView.xml
```

**Color coding:**
- Yellow = Segment Ident
- Pink = Form Ident
- Green = Function description
- Blue = Constant

#### Field Ident

**Format:** English field name

```
Field Ident: DateFrom (Date from)
Field Ident: FullName (Full name)
```

**For foreign keys:** `[EnglishValue][ForeignKeyName]`

```
Field Ident: EmployeeID (references Employee.ID)
Field Ident: TicketTypeIdent (references TicketType.Ident)
```

**For multi-select fields:** Use **plural** form

```
Field Ident: ActivityTagIdents (multiple tags can be selected)
```

**Field naming patterns:**

| Type | Pattern | Example |
|------|---------|---------|
| String, Int, Decimal | `FullName` | Name of field |
| Date | `CreateDate` | Date field |
| DateTime | `CreateDateTime` | DateTime field |
| Foreign key to form | `InvoiceCRMCountryID` | References CRMCountry form |
| Multi-select | `InvoiceCRMCountryIDs` | Multiple references |

#### Button Ident

**Format:** English button name with postfix `Button`

```
Button Ident: SaveButton
Button Ident: DeleteButton
Button Ident: ApproveButton
```

#### DataView Ident

**Format:** `[FormIdent][ViewPurpose]View`

```
View Ident: AttendanceAllView
View Ident: ProductActiveView
View Ident: TicketMyView
```

#### WorkFlow Ident

**Format:** `[FormIdent]WorkFlow`

```
WorkFlow Ident: AttendanceWorkFlow
WorkFlow Ident: ProductWorkFlow
```

#### ShareCode Ident

**Format:** `[Description][ShareCodeType]Share`

```
ShareCode Ident: EnableAllControlShare
ShareCode Ident: SaveButtonShare
```

#### Other Idents

**Format:** `[Description][Type]`

```
Ident: CRM (segment)
Ident: CRMSegment (segment type)
```

### Permissions (Rights)

**Format:** `[Segment][PermissionType]`

```
Permission: ProductAdmin
Permission: ProductEditor
Permission: ProductViewer
Permission: AttendanceApprover
```

---

## General Conventions

These conventions apply to all XML configurations.

### System Columns - NEVER Create as Controls

**⚠️ CRITICAL:** When creating a Form, the system automatically generates these columns in the database table:

- `ID` - Primary key (auto-increment)
- `AccountID` - User who created the record
- `CreateDate` - Creation timestamp
- `LastUpdate` - Last modification timestamp
- `State` - Workflow state
- `LastUpdateAccountID` - User who last modified

**DO NOT** create Controls (including HiddenControl) for these columns. They are managed automatically by the system.

❌ **WRONG:**
```xml
<Controls>
  <Control xsi:type="HiddenControl" Ident="ID" DataType="Number" />
  <Control xsi:type="HiddenControl" Ident="AccountID" DataType="String" />
  <Control xsi:type="HiddenControl" Ident="CreateDate" DataType="DateTime" />
  <!-- Also WRONG: CreatedBy, ModifiedDate, etc. -->
</Controls>
```

✅ **CORRECT:**
```xml
<Controls>
  <!-- Only create Controls for YOUR business fields -->
  <Control xsi:type="TextBoxControl" Ident="Name" DataType="String" MaxLength="200" />
  <Control xsi:type="DropDownListControl" Ident="CategoryID" DataType="Number" />
</Controls>
```

**See:** [AI-RULES.md](AI-RULES.md#rule-6-system-columns---never-create-as-controls) for full details.

---

### Form Fields

- **Default state:** All fields must be `IsReadOnly="true"`
- **Enable in WorkFlow:** Fields are set to editable (`IsReadOnly="false"`) in WorkFlow Steps

```xml
<!-- Form definition -->
<Control xsi:type="TextBoxControl"
         Ident="Name"
         DataType="String"
         IsReadOnly="true" />

<!-- WorkFlow enables editing -->
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

### Form Buttons

- **Default state:** All buttons must be `IsVisible="false"`
- **Enable in WorkFlow:** Buttons are made visible in WorkFlow Steps

```xml
<!-- Form definition -->
<Button xsi:type="FormButton"
        Ident="SaveButton"
        TitleResourceKey="Save_Button"
        IsVisible="false" />

<!-- WorkFlow makes button visible -->
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

### DataViews

- **System columns in DataView:** Columns like `ID`, `AccountID`, `CreateDate` can be displayed in DataView grids (they're auto-generated by Form). Use `IsOptional="true"` to allow users to show/hide them.
- **Pagination:** All user-facing views with many records should use `infinite-scroll` pagination

```xml
<DataSource FormIdent="Product">
  <Columns>
    <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" IsOptional="true" />
    <Column Ident="AccountID" IsOptional="true" />
    <Column Ident="CreateDate" IsOptional="true" />
    <Column Ident="Name" TitleResourceKey="Name_Product" />
  </Columns>
</DataSource>
```

---

## Design Standards

### Button Order

Buttons on forms must be ordered from right to left: **Back, Delete, Save and Close, Save, Other buttons**

### Button Icons

| Action | Icon Class |
|--------|-----------|
| Save | `icon-floppy-disk` |
| Save and Close | `icon-floppy-disk` |
| Delete | `icon-bin2` |
| Back | `icon-undo2` |
| Approve | `icon-checkmark` |
| Reject | `icon-cross2` |
| Cancel | `icon-cross2` |
| Submit for Approval | `icon-forward` |

### Tab Icons

| Purpose | Icon Class |
|---------|-----------|
| General tab | `icon-bookmark` |
| History tab | `icon-history` |

### Card Structure

Standard Bootstrap card with collapse functionality:

```html
<div class="card">
  <div class="card-header bg-white header-elements-inline">
    <h6 class="card-title">Title</h6>
    <div class="header-elements">
      <div class="list-icons">
        <a class="list-icons-item" data-action="collapse"></a>
      </div>
    </div>
  </div>
  <div class="card-body">
    Content
  </div>
</div>
```

**Collapsible card:** Use `data-action="collapse"` attribute to enable collapse functionality.

---

## Project Structure

Standard folder structure for SFP configuration projects:

```
ProjectName/
├── Documentation/          # Project documentation
├── Export/                 # Translation exports
├── HTML/                   # Translations for prints, PDFs
├── Resource/              # Translations except prints
├── UtilImport/            # Imports in Importer format
└── XML/                   # All XML files
    ├── FORM/
    │   └── view/
    └── [other XML types]
```

### File Naming for Manual Upload

Files that are **not intended for direct upload** but must be manually merged/edited should have suffix:

```
-DoNotUpload

Examples:
ProductManual-DoNotUpload.xml
ConfigurationPartial-DoNotUpload.xml
```

---

## Validation Checklist

Before finalizing any configuration, verify:

- [ ] XML is properly formatted (one element per line, proper indentation)
- [ ] HTML inside `<![CDATA[]]>` is properly formatted
- [ ] SQL uses UPPERCASE keywords and proper formatting
- [ ] All Idents follow naming conventions (no diacritics, PascalCase)
- [ ] Translation keys follow format `[Value]_[Module]`
- [ ] Form fields default to `IsReadOnly="true"`
- [ ] Form buttons default to `IsVisible="false"`
- [ ] DataView optional columns marked with `IsOptional="true"`
- [ ] Button order: Back, Delete, Save and Close, Save, Other
- [ ] Button icons match design standards
- [ ] Project structure follows standard layout
- [ ] Manual-upload files have `-DoNotUpload` suffix

---

## Common Mistakes to Avoid

### ❌ WRONG

```xml
<!-- Mixed spaces and tabs -->
<Control xsi:type="TextBoxControl"
      Ident="Name" />

<!-- Single-line query -->
<SQL><![CDATA[SELECT * FROM usr.Product WHERE State != 0]]></SQL>

<!-- Wrong translation format -->
TitleResourceKey="Name-Product"  <!-- Should be: Name_Product -->

<!-- Wrong Ident format -->
Ident="productName"  <!-- Should be: ProductName -->
Ident="date_from"    <!-- Should be: DateFrom -->

<!-- Button visible by default -->
<Button xsi:type="FormButton" Ident="Save" IsVisible="true" />

<!-- Field editable by default -->
<Control xsi:type="TextBoxControl" Ident="Name" IsReadOnly="false" />
```

### ✅ CORRECT

```xml
<!-- Consistent tab indentation -->
<Control xsi:type="TextBoxControl"
	Ident="Name" />

<!-- Formatted query -->
<SQL><![CDATA[
  SELECT
    p.ID,
    p.Name,
    p.State
  FROM usr.Product p
  WHERE p.State != 0
]]></SQL>

<!-- Correct translation format -->
TitleResourceKey="Name_Product"

<!-- Correct Ident format -->
Ident="ProductName"
Ident="DateFrom"

<!-- Button hidden by default -->
<Button xsi:type="FormButton" Ident="SaveButton" IsVisible="false" />

<!-- Field read-only by default -->
<Control xsi:type="TextBoxControl" Ident="Name" IsReadOnly="true" />
```

---

## References

- [AI-RULES.md](AI-RULES.md) - Mandatory XML generation rules
- [form.md](entities/form.md) - Form entity documentation
- [workflow.md](entities/workflow.md) - WorkFlow entity documentation
- [dataview.md](entities/dataview.md) - DataView entity documentation
- [buttons.md](common/buttons.md) - Button types documentation
