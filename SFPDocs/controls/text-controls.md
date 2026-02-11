# Text Input Controls

## TextBoxControl

Single-line text input field. Most commonly used control.

**Inherits from:** FormControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsRefresh` | bool | false | Refresh value via DataBind when dependencies change |
| `IsNumberFormat` | bool | false | Format value as number (thousand separators) |
| `TimeFormatType` | enum | Time99 | Time format for DataType=Time (Time99, Time9999) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataBind` | DataBind | Dynamic value binding from SQL |
| `SessionDataBind` | SessionDataBind | Session-based data binding |
| `Settings` | List&lt;Setting&gt; | Additional settings (DateTimeSetting, IconSetting, TimeSetting) |

### Examples

**Basic text field:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="Name"
         DataType="String"
         MaxLength="100"
         TitleResourceKey="Name_Form"
         IsRequired="true" />
```

**Date/Time field:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="BirthDate"
         DataType="Date"
         TitleResourceKey="BirthDate_Form" />

<Control xsi:type="TextBoxControl"
         Ident="MeetingTime"
         DataType="DateTime"
         TitleResourceKey="MeetingTime_Form" />
```

**Number field with formatting:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="Amount"
         DataType="Number"
         TitleResourceKey="Amount_Form"
         IsNumberFormat="true" />
```

**With DataBind (calculated value):**
```xml
<Control xsi:type="TextBoxControl"
         Ident="FullName"
         DataType="String"
         IsCreateColumn="false"
         IsRefresh="true">
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

## TextAreaControl

Multi-line text input field.

**Inherits from:** FormControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Rows` | int | 0 | Number of visible rows (height) |
| `IsRefresh` | bool | false | Refresh value via DataBind when dependencies change |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataBind` | DataBind | Dynamic value binding from SQL |

### Examples

**Basic textarea:**
```xml
<Control xsi:type="TextAreaControl"
         Ident="Description"
         DataType="String"
         Rows="5"
         TitleResourceKey="Description_Form" />
```

**With max length:**
```xml
<Control xsi:type="TextAreaControl"
         Ident="Notes"
         DataType="String"
         MaxLength="2000"
         Rows="10"
         TitleResourceKey="Notes_Form" />
```

---

## RichTextBoxControl

WYSIWYG HTML editor (CKEditor).

**Inherits from:** FormControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Height` | int | 0 | Editor height in pixels |
| `DisallowedContent` | string | "" | HTML tags to disallow |
| `ToolBarSet` | string | null | Custom toolbar configuration |
| `IsFileManager` | bool | false | Enable file manager for images |
| `ContentCssRelativePath` | string | "" | External CSS for editor content |
| `IsRefresh` | bool | false | Refresh value via DataBind |
| `EnterType` | enum | BR | Enter key behavior (BR, P, DIV) |
| `EnterBlockType` | enum | P | Block enter behavior (P, DIV) |
| `IsAutoResize` | bool | false | Auto-resize based on content |
| `IsStatusBar` | bool | true | Show status bar |
| `IsToolBar` | bool | true | Show toolbar |
| `IsSpellcheck` | bool | false | Enable spell checking |
| `BaseDanyTag` | string | "script,link,..." | Dangerous tags to strip |
| `IsIFrame` | bool | false | Render in iframe |
| `IsAskBeforePasteHTML` | bool | true | Ask before pasting HTML |
| `IsAskBeforePasteFromWord` | bool | true | Ask before pasting from Word |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataBind` | DataBind | Dynamic value binding |
| `DictionaryHintDataSource` | DataSource | SQL for text hints/suggestions |

### Examples

**Basic rich text:**
```xml
<Control xsi:type="RichTextBoxControl"
         Ident="Content"
         DataType="String"
         Height="400"
         TitleResourceKey="Content_Form" />
```

**With file manager and custom height:**
```xml
<Control xsi:type="RichTextBoxControl"
         Ident="ArticleBody"
         DataType="String"
         Height="600"
         IsFileManager="true"
         TitleResourceKey="ArticleBody_Form" />
```

**Read-only display:**
```xml
<Control xsi:type="RichTextBoxControl"
         Ident="Preview"
         DataType="String"
         Height="300"
         IsReadOnly="true"
         IsToolBar="false"
         IsStatusBar="false" />
```

---

## PasswordControl

Password input with optional hashing.

**Inherits from:** FormControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `HashType` | enum | None | Hash algorithm (None, SHA256, SHA512, MD5) |

### Examples

**Basic password:**
```xml
<Control xsi:type="PasswordControl"
         Ident="Password"
         DataType="String"
         MaxLength="100"
         TitleResourceKey="Password_Form"
         IsRequired="true" />
```

**With SHA256 hashing:**
```xml
<Control xsi:type="PasswordControl"
         Ident="Password"
         DataType="String"
         TitleResourceKey="Password_Form"
         HashType="SHA256"
         IsRequired="true" />
```

---

## CodeEditorControl

Code editor with syntax highlighting (Monaco editor).

**Inherits from:** FormControl

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `CodeType` | enum | Text | Syntax highlighting (Text, SQL, HTML, JavaScript, CSS, JSON, XML, CSharp) |
| `Height` | int | 300 | Editor height in pixels |

### Examples

**SQL editor:**
```xml
<Control xsi:type="CodeEditorControl"
         Ident="SQLQuery"
         DataType="String"
         CodeType="SQL"
         Height="400"
         TitleResourceKey="SQLQuery_Form" />
```

**HTML editor:**
```xml
<Control xsi:type="CodeEditorControl"
         Ident="HTMLTemplate"
         DataType="String"
         CodeType="HTML"
         Height="500"
         TitleResourceKey="Template_Form" />
```

---

## HiddenControl

Hidden input field. Used for storing values not visible to user.

**Inherits from:** FormControl

### Specific Attributes

None additional. Uses base FormControl attributes.

### Examples

**Primary key:**
```xml
<Control xsi:type="HiddenControl"
         Ident="ID"
         DataType="Number"
         IsPrimaryKey="true" />
```

**Foreign key:**
```xml
<Control xsi:type="HiddenControl"
         Ident="ParentID"
         DataType="Number" />
```

**With default value:**
```xml
<Control xsi:type="HiddenControl"
         Ident="CreatedBy"
         DataType="Number"
         Default="[%ACCOUNT.ID%]" />
```
