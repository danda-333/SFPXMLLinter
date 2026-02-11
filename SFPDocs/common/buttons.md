# Buttons Documentation

## Button Base Class

All buttons inherit from abstract `Button` class.

### Base Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Unique button identifier |
| `Title` | string | "" | Button text |
| `TitleResourceKey` | string | "" | Button text from translations |
| `AriaLabel` | string | "" | Accessibility label |
| `AriaLabelResourceKey` | string | "" | Accessibility label from translations |
| `IconCssClass` | string | "" | Icon CSS class (e.g., "ph-floppy-disk", "icon-bin2") |
| `IsMain` | bool | false | Main action button (highlighted) |
| `PlacementType` | enum | Top | Position (Top, Bottom, Top Bottom) |
| `IsVisible` | bool | true | Show button |
| `IsStopRedirect` | bool | false | Stay on form after action |
| `IsRenderTemplate` | bool | false | Render button in HTMLTemplate |
| `IsBackRedirect` | bool | false | Redirect back after action |
| `MappingFormIdent` | string | "" | Redirect to another form |
| `ColorType` | enum | Primary | Bootstrap color |
| `Color` | string | "" | Custom hex color |
| `IsOpenNewWindow` | bool | false | Open in new window/tab |
| `IsSystem` | bool | false | System button (internal use) |
| `ToolTip` | string | "" | Tooltip text |
| `ToolTipResourceKey` | string | "" | Tooltip from translations |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Permissions that can see the button |
| `DenyPermissions` | List&lt;string&gt; | Permissions that cannot see the button |
| `Mappings` | List&lt;Mapping&gt; | Value mappings to target form |
| `VisibleCondition` | DataSource | SQL condition for visibility |

### ColorType Enum

**SUPPORTED VALUES (from ColorTypes enum):**

| Value | CSS Class | Description |
|-------|-----------|-------------|
| `Primary` | `btn-primary` | Blue (main action) |
| `Warning` | `btn-warning` | Yellow/Orange (caution) |
| `Success` | `btn-success` | Green (positive action) |
| `Danger` | `btn-danger` | Red (destructive action) |
| `Light` | `btn-light` | Light background |

**IMPORTANT:** Only these 5 values are supported. Do NOT use: `Secondary`, `Info`, or `Dark`.

### PlacementType Enum

| Value | Description |
|-------|-------------|
| `Top` | Top of form only |
| `Bottom` | Bottom of form only |
| `Top Bottom` | Both top and bottom |

---

## FormButton

Primary button for form submission and workflow actions.

**Inherits from:** Button

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsSave` | bool | true | Save form data before executing actions |
| `PagingType` | enum | None | Pagination behavior (None, Next, Previous, Submit) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Extensions` | List&lt;Extension&gt; | Button extensions (dialogs, confirmations) |
| `BackUrlDataSource` | DataSource | Custom redirect URL after action |

### Examples

**Basic save button:**
```xml
<Button xsi:type="FormButton"
        Ident="SaveButton"
        TitleResourceKey="Save"
        IsSave="true"
        PlacementType="Top Bottom"
        ColorType="Primary"
        IconCssClass="ph-floppy-disk" />
```

**Delete button with confirmation:**
```xml
<Button xsi:type="FormButton"
        Ident="DeleteButton"
        TitleResourceKey="Delete"
        IsSave="false"
        PlacementType="Bottom"
        ColorType="Danger"
        IconCssClass="ph-trash">
  <Extensions>
    <Extension xsi:type="ConfirmDialogExtension"
               TitleResourceKey="ConfirmDelete"
               DescriptionResourceKey="ConfirmDeleteMessage" />
  </Extensions>
</Button>
```

**Submit for approval with form dialog:**
```xml
<Button xsi:type="FormButton"
        Ident="SubmitButton"
        TitleResourceKey="Submit"
        IsSave="true"
        ColorType="Success"
        IconCssClass="ph-paper-plane-tilt">
  <Extensions>
    <Extension xsi:type="ConfirmFormDialogExtension"
               Ident="SubmitDialog"
               ConfirmFormDialogSectionIdent="SubmitDialogSection" />
  </Extensions>
</Button>
```

**Redirect to another form with mappings:**
```xml
<Button xsi:type="FormButton"
        Ident="CreateOrderButton"
        TitleResourceKey="CreateOrder"
        IsSave="true"
        MappingFormIdent="Order"
        IsBackRedirect="true"
        ColorType="Success">
  <Mappings>
    <Mapping FromIdent="ID" ToIdent="CustomerID" />
    <Mapping FromIdent="Name" ToIdent="CustomerName" />
  </Mappings>
</Button>
```

**With custom redirect URL:**
```xml
<Button xsi:type="FormButton"
        Ident="FinishButton"
        TitleResourceKey="Finish"
        IsSave="true"
        ColorType="Success">
  <BackUrlDataSource>
    <SQL>
      SELECT '~/View/Index/OrderList' as BackUrl
    </SQL>
  </BackUrlDataSource>
</Button>
```

**With visibility condition:**
```xml
<Button xsi:type="FormButton"
        Ident="ApproveButton"
        TitleResourceKey="Approve"
        IsSave="true"
        ColorType="Success"
        IsVisible="false">
  <VisibleCondition>
    <SQL>
      SELECT IIF(@State = 10 AND @IsManager = 1, 1, 0) AS IsVisible
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="State" DataType="Number" />
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="IsManager" DataType="Bool" />
    </Parameters>
  </VisibleCondition>
</Button>
```

---

## BackButton

Navigation button to go back.

**Inherits from:** Button

### Examples

```xml
<Button xsi:type="BackButton"
        Ident="BackButton"
        TitleResourceKey="Back"
        IconCssClass="ph-arrow-left" />
```

---

## ActionButton

Button that executes action without saving form.

**Inherits from:** Button

### Examples

```xml
<Button xsi:type="ActionButton"
        Ident="RefreshButton"
        TitleResourceKey="Refresh"
        IconCssClass="ph-arrows-clockwise" />
```

---

## PrintButton

Opens print dialog/preview.

**Inherits from:** Button

### Examples

```xml
<Button xsi:type="PrintButton"
        Ident="PrintButton"
        TitleResourceKey="Print"
        IconCssClass="ph-printer" />
```

---

## DownloadButton

Downloads file (e.g., PDF export).

**Inherits from:** Button

### Examples

```xml
<Button xsi:type="DownloadButton"
        Ident="ExportPDFButton"
        TitleResourceKey="ExportPDF"
        IconCssClass="ph-file-pdf" />
```

---

## ExportButton

Exports data to file.

**Inherits from:** Button

### Examples

```xml
<Button xsi:type="ExportButton"
        Ident="ExportExcelButton"
        TitleResourceKey="ExportExcel"
        IconCssClass="ph-file-xls" />
```

---

## GroupButton

Dropdown group of buttons.

**Inherits from:** Button

### Examples

```xml
<Button xsi:type="GroupButton"
        Ident="MoreActions"
        TitleResourceKey="MoreActions"
        IconCssClass="ph-dots-three">
  <Buttons>
    <Button xsi:type="FormButton" Ident="DuplicateButton" TitleResourceKey="Duplicate" />
    <Button xsi:type="FormButton" Ident="ArchiveButton" TitleResourceKey="Archive" />
    <Button xsi:type="PrintButton" Ident="PrintButton" TitleResourceKey="Print" />
  </Buttons>
</Button>
```

---

## Button Extensions

### ConfirmDialogExtension

Simple confirmation dialog (Yes/No).

| Attribute | Type | Description |
|-----------|------|-------------|
| `Title` | string | Dialog title |
| `TitleResourceKey` | string | Dialog title from translations |
| `Description` | string | Dialog message |
| `DescriptionResourceKey` | string | Dialog message from translations |

```xml
<Extension xsi:type="ConfirmDialogExtension"
           TitleResourceKey="ConfirmAction"
           DescriptionResourceKey="AreYouSure" />
```

### InfoDialogExtension

Information dialog (OK only).

```xml
<Extension xsi:type="InfoDialogExtension"
           TitleResourceKey="Information"
           DescriptionResourceKey="ActionCompleted" />
```

### ConfirmFormDialogExtension

Confirmation with form fields (modal form).

| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | Extension identifier |
| `ConfirmFormDialogSectionIdent` | string | Section to display in dialog |

```xml
<Extension xsi:type="ConfirmFormDialogExtension"
           Ident="RejectDialog"
           ConfirmFormDialogSectionIdent="RejectReasonSection" />
```

### FastClickExtension

Skip confirmation, execute immediately.

```xml
<Extension xsi:type="FastClickExtension" />
```

---

## Mapping

Maps values from current form to target form.

### Mapping Types

**Simple Mapping:**
```xml
<Mapping FromIdent="ID" ToIdent="ParentID" />
```

**DataSource Mapping:**
```xml
<Mapping xsi:type="DataSourceMapping" ToIdent="CustomerName">
  <DataSource>
    <SQL>SELECT Name FROM usr.Customer WHERE ID = @CustomerID</SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerID" DataType="Number" />
    </Parameters>
  </DataSource>
</Mapping>
```

---

## DO NOT - Common Mistakes

### ColorType Values That DO NOT Exist

The following values **DO NOT EXIST** in the ColorTypes enum and will cause errors:

| Value | Status | Alternative |
|-------|--------|-------------|
| `Secondary` | DOES NOT EXIST | Use `Light` for light buttons, or `Primary` |
| `Info` | DOES NOT EXIST | Use `Primary` |
| `Dark` | DOES NOT EXIST | Use `Primary` or `Danger` |

**ONLY USE:** `Primary`, `Warning`, `Success`, `Danger`, `Light`

### WorkFlow Button Errors

```xml
<!-- WRONG: Do NOT use xsi:type in WorkFlow buttons -->
<Button xsi:type="FormButton" Ident="Save" IsVisible="true" />

<!-- CORRECT: WorkFlow buttons only reference by Ident -->
<Button Ident="Save" IsVisible="true">
  <Actions>
    <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
  </Actions>
</Button>
```

### Non-Existent Attributes

```xml
<!-- WRONG: FormButtonType does NOT exist -->
<Button xsi:type="FormButton"
        Ident="Save"
        FormButtonType="Save" />

<!-- CORRECT: Use IsSave attribute -->
<Button xsi:type="FormButton"
        Ident="Save"
        IsSave="true" />
```

### DataView Button Errors

```xml
<!-- WRONG: ActionButton with FormSectionNew for navigation -->
<Button xsi:type="ActionButton"
        Ident="New"
        ActionType="FormSectionNew"
        FormIdent="Movie" />

<!-- CORRECT: Use LinkButton for form navigation -->
<Button xsi:type="LinkButton"
        Ident="New"
        FormIdent="Movie"
        TitleResourceKey="New_Button" />
```

```xml
<!-- WRONG: Using CssClass in DataView -->
<Button xsi:type="ActionButton"
        Ident="Delete"
        CssClass="btn-danger" />

<!-- CORRECT: Use ColorType -->
<Button xsi:type="ActionButton"
        Ident="Delete"
        ColorType="Danger" />
```

---

## Button Type by Context

| Context | Button Type | Example |
|---------|-------------|---------|
| Form - save action | `FormButton` | Save, Submit, Approve |
| Form - navigation | `BackButton` | Back, Cancel |
| Form - no save | `ActionButton` | Refresh |
| DataView - open form | `LinkButton` | New, Edit |
| DataView - action | `ActionButton` | Delete, Refresh |
| DataView - export | `DownloadButton` | Export PDF |
| WorkFlow | Reference only | `<Button Ident="..." />` |
