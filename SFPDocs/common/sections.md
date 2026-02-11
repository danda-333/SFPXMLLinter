# Sections Documentation

> **DŮLEŽITÉ:** Vždy používejte `<![CDATA[...]]>` pro `<HTMLTemplate>` a `<SQL>` obsah. Viz [CDATA v README.md](../README.md#cdata-sekce-důležité).

## Section Base Class

All sections inherit from abstract `Section` class.

### Base Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Unique section identifier |
| `Title` | string | "" | Section title |
| `TitleResourceKey` | string | "" | Section title from translations |
| `IconCssClass` | string | "" | Icon CSS class for section tab |
| `IsVisible` | bool | true | Show section |
| `IsRazorEngine` | string | "" | Enable Razor engine (true/false/null) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Permissions that can see the section |
| `DenyPermissions` | List&lt;string&gt; | Permissions that cannot see the section |
| `VisibleCondition` | DataSource | SQL condition for visibility |

---

## ContentSection

Main section type with HTML template.

**Inherits from:** Section

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `ReturnType` | enum | HTML | Output type (HTML, JSON) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Sources` | List&lt;DataSource&gt; | Data sources for template |
| `HTMLTemplate` | string | HTML template content |
| `Settings` | List&lt;Setting&gt; | Additional settings (RazorEngineSetting) |

### Examples

**Basic section:**
```xml
<Section xsi:type="ContentSection"
         Ident="BasicInfo"
         TitleResourceKey="BasicInfo_Form"
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

**With DataSource:**
```xml
<Section xsi:type="ContentSection"
         Ident="SummarySection"
         TitleResourceKey="Summary_Form">
  <Sources>
    <DataSource Ident="SummaryData">
      <Columns>
        <Column Ident="TotalAmount" />
        <Column Ident="ItemCount" />
      </Columns>
      <SQL>
        SELECT
          SUM(Amount) as TotalAmount,
          COUNT(*) as ItemCount
        FROM usr.OrderItem
        WHERE OrderID = @ID AND State != 0
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
      </Parameters>
    </DataSource>
  </Sources>
  <HTMLTemplate>
    <div class="card">
      <div class="card-body">
        <h5>[#Summary_Form#]</h5>
        [FOR Source="SummaryData"]
        <p>[#TotalAmount_Form#]: [%TotalAmount%]</p>
        <p>[#ItemCount_Form#]: [%ItemCount%]</p>
        [/FOR]
      </div>
    </div>
  </HTMLTemplate>
</Section>
```

**With visibility condition:**
```xml
<Section xsi:type="ContentSection"
         Ident="AdminSection"
         TitleResourceKey="Admin_Form"
         IconCssClass="ph-gear">
  <VisibleCondition>
    <SQL>
      SELECT IIF(@State >= 20, 1, 0) AS IsVisible
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="State" DataType="Number" />
    </Parameters>
  </VisibleCondition>
  <HTMLTemplate>
    <!-- Admin-only content -->
  </HTMLTemplate>
</Section>
```

**With permissions:**
```xml
<Section xsi:type="ContentSection"
         Ident="FinanceSection"
         TitleResourceKey="Finance_Form">
  <AccessPermissions>
    <string>FinanceAdmin</string>
    <string>Manager</string>
  </AccessPermissions>
  <DenyPermissions>
    <string>Guest</string>
  </DenyPermissions>
  <HTMLTemplate>
    <!-- Finance data -->
  </HTMLTemplate>
</Section>
```

---

## HeaderSection

Form header displayed at the top (outside tabs).

**Inherits from:** ContentSection

### Examples

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
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4>[%ACTUALFORM.Name%]</h4>
      <span class="badge">[%#HeaderData.State%]</span>
    </div>
  </HTMLTemplate>
</Section>
```

---

## ConfirmFormDialogSection

Modal dialog section for form button extensions.

**Inherits from:** Section

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `CloseButtonTitle` | string | "" | Cancel button text |
| `CloseButtonTitleResourceKey` | string | "" | Cancel button from translations |
| `ConfirmButtonTitle` | string | "" | Confirm button text |
| `ConfirmButtonTitleResourceKey` | string | "" | Confirm button from translations |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `HTMLTemplate` | string | Dialog content HTML |
| `Settings` | List&lt;Setting&gt; | Additional settings |

### Examples

```xml
<Section xsi:type="ConfirmFormDialogSection"
         Ident="RejectDialogSection"
         TitleResourceKey="RejectReason_Form"
         CloseButtonTitleResourceKey="Cancel"
         ConfirmButtonTitleResourceKey="Confirm">
  <HTMLTemplate>
    <div class="form-group">
      <ControlLabel ControlID="RejectReason" />
      <Control ID="RejectReason" />
    </div>
    <div class="form-group">
      <ControlLabel ControlID="RejectComment" />
      <Control ID="RejectComment" />
    </div>
  </HTMLTemplate>
</Section>
```

---

## PrintSection

Section for print layout.

**Inherits from:** ContentSection

### Examples

```xml
<Section xsi:type="PrintSection"
         Ident="PrintSection"
         TitleResourceKey="Print_Form">
  <HTMLTemplate>
    <div class="print-header">
      <h1>[%ACTUALFORM.Name%]</h1>
      <p>Date: [%ACTUALFORM.CreateDate%]</p>
    </div>
    <div class="print-content">
      <!-- Print content -->
    </div>
  </HTMLTemplate>
</Section>
```

---

## PDFSection

Section for PDF export.

**Inherits from:** ContentSection

### Examples

```xml
<Section xsi:type="PDFSection"
         Ident="PDFExport"
         TitleResourceKey="PDFExport_Form">
  <HTMLTemplate>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          .header { text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>[%ACTUALFORM.Name%]</h1>
        </div>
        <!-- PDF content -->
      </body>
    </html>
  </HTMLTemplate>
</Section>
```

---

## DOCXSection

Section for Word document export.

**Inherits from:** ContentSection

---

## XLSXSection

Section for Excel export.

**Inherits from:** ContentSection

---

## GlobalChangeSection

Section for bulk edit operations.

**Inherits from:** Section

---

## FastEditSection

Section for quick inline editing.

**Inherits from:** Section

---

## HTMLTemplate Syntax

### Control Rendering

```html
<!-- Render control input -->
<Control ID="ControlIdent" />

<!-- Render control label -->
<ControlLabel ControlID="ControlIdent" />

<!-- Render button -->
<ControlButton ID="ButtonIdent" />
```

### Translations

```html
<!-- Resource key translation -->
[#ResourceKey#]

<!-- Example -->
<h3>[#FormTitle_MyModule#]</h3>
<label>[#Name_Label#]</label>
```

### Form Values

```html
<!-- Current form field value -->
[%ACTUALFORM.FieldName%]

<!-- Examples -->
<span>[%ACTUALFORM.Name%]</span>
<span>[%ACTUALFORM.CreateDate%]</span>
<span>[%ACTUALFORM.State%]</span>
```

### DataSource Values

```html
<!-- Value from section DataSource -->
[%#DataSourceIdent.ColumnIdent%]

<!-- Example -->
[%#SummaryData.TotalAmount%]
```

### FOR Loop

```html
<!-- Iterate over DataSource rows -->
[FOR Source="DataSourceIdent"]
  <tr>
    <td>[%ColumnName1%]</td>
    <td>[%ColumnName2%]</td>
  </tr>
[/FOR]
```

### System Variables

```html
<!-- Current user -->
[%ACCOUNT.ID%]
[%ACCOUNT.FullName%]
[%ACCOUNT.Email%]
[%ACCOUNT.UserName%]

<!-- URL parameters -->
[%URLPARAM.ParamName%]

<!-- Current date/time -->
[%NOW%]
[%TODAY%]
```

### Conditional Rendering

```html
<!-- Using CSS classes with conditions -->
<div class="[%ACTUALFORM.IsActive%] == 1 ? 'active' : 'inactive'">
```

### Hiding Elements

```html
<!-- Hide control but keep in DOM -->
<div class="d-none">
  <Control ID="HiddenField" />
</div>

<!-- Or use style -->
<div style="display: none;">
  <Control ID="HiddenField" />
</div>
```
