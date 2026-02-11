# Control Base Classes

## Control (Abstract Base)

All controls inherit from `Control` base class.

### Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier. For FormControl becomes DB column name |
| `Title` | string | No | "" | Control label (static text) |
| `TitleResourceKey` | string | No | "" | Control label from translations |
| `IsVisible` | bool | No | true | Show/hide control |
| `IsReadOnly` | bool | No | false | Read-only mode (user cannot edit) |
| `IsFakeReadOnly` | bool | No | false | Appears read-only but value is still saved |
| `TabIndex` | int | No | 0 | Tab navigation order |
| `CssClass` | string | No | "" | Custom CSS class for styling |
| `HelpTitle` | string | No | "" | Help tooltip title |
| `HelpTitleResourceKey` | string | No | "" | Help tooltip title from translations |
| `HelpDescription` | string | No | "" | Help tooltip content |
| `HelpDescriptionResourceKey` | string | No | "" | Help tooltip content from translations |
| `IsShowUserWhere` | bool | No | true | Show in user filter conditions |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `FilterConditions` | List&lt;DataSource&gt; | Filter conditions for the control |

---

## FormControl (Abstract)

Controls that create database columns inherit from `FormControl` (which extends `Control`).

### Additional Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `DataType` | enum | **Yes** | - | Data type for DB column |
| `MaxLength` | int | No | 0 | Max length for String (0 = nvarchar(max)) |
| `IsCreateColumn` | bool | No | true | Create column in database |
| `IsFullText` | bool | No | false | Include in fulltext search index |
| `DataTypeSize` | string | No | "" | SQL data type size (e.g., "18,2" for decimal) |
| `IsRequired` | bool | No | false | Field is required |
| `IsShowRequired` | string | No | "" | Show required asterisk (true/false/null) |
| `ErrorMessage` | string | No | "" | Custom required validation error |
| `ErrorMessageResourceKey` | string | No | "" | Error message from translations |
| `IsAutoIncrement` | bool | No | false | Auto-increment field |
| `Default` | string | No | "" | Default value |
| `IsAutoUpdate` | bool | No | false | Update with Default value on every save |
| `ComputedExpression` | string | No | "" | SQL computed column expression |
| `IsAutoComplete` | bool | No | true | Browser autocomplete attribute |
| `IsClearFileSelected` | bool | No | false | Clear file selection after submit |
| `IsServerDataHackValidation` | bool | No | false | Validate server-side for data manipulation |
| `IsIllegalCharactersValidation` | bool | No | true | Validate for illegal characters (< >) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Validations` | List&lt;Validation&gt; | Validation rules |
| `DefaultDataSource` | DataSource | SQL for default value |

---

## DataType Enum

DataType určuje SQL datový typ sloupce v databázi a způsob zpracování hodnoty.

### Základní typy (vytváří DB sloupec)

| Value | SQL Type | C# Type | MaxLength | Description |
|-------|----------|---------|-----------|-------------|
| `None` | NVARCHAR | string | volitelně | Výchozí, jako String |
| `String` | NVARCHAR(n) | string | **doporučeno** | Unicode text. MaxLength=0 → NVARCHAR(MAX) |
| `VarChar` | VARCHAR(n) | string | **doporučeno** | ASCII text. MaxLength=0 → VARCHAR(MAX) |
| `Number` | INT | int | - | Celé číslo (-2,147,483,648 až 2,147,483,647) |
| `SmallNumber` | SMALLINT | short | - | Malé celé číslo (-32,768 až 32,767) |
| `BigNumber` | BIGINT | long | - | Velké celé číslo |
| `Double` | DECIMAL(p,s) | decimal | DataTypeSize | Desetinné číslo. DataTypeSize="18,2" |
| `Bool` | BIT | bool | - | Boolean (0/1, true/false) |
| `Date` | DATE | DateTime | - | Pouze datum (bez času) |
| `DateTime` | DATETIME | DateTime | - | Datum a čas |
| `Time` | INT | int | - | Čas v minutách (pro TimeControl) |
| `Time24` | TIME | TimeSpan | - | Čas ve formátu HH:mm:ss |
| `Guid` | UNIQUEIDENTIFIER | Guid | - | GUID/UUID |
| `ByteList` | VARBINARY | byte[] | MaxLength | Binární data |

### Multi-select typy (ukládá do dbo.MultiSelect)

Tyto typy **nevytváří sloupec** v tabulce usr.*, ale ukládají hodnoty do systémové tabulky `dbo.MultiSelect`.

| Value | Hodnoty | Description |
|-------|---------|-------------|
| `StringList` | NVARCHAR hodnoty | Seznam stringů (CheckBoxListControl, TagControl, DualListBoxControl) |
| `VarCharList` | VARCHAR hodnoty | Seznam ASCII stringů |
| `NumberList` | INT hodnoty | Seznam čísel |
| `SmallNumberList` | SMALLINT hodnoty | Seznam malých čísel |

### Použití DataTypeSize

Pro typ `Double` (DECIMAL) lze specifikovat přesnost a scale:

```xml
<!-- DECIMAL(18,2) - 18 číslic celkem, 2 desetinná místa -->
<Control xsi:type="TextBoxControl"
         Ident="Price"
         DataType="Double"
         DataTypeSize="18,2"
         TitleResourceKey="Price_Form" />

<!-- DECIMAL(10,4) - 10 číslic celkem, 4 desetinná místa -->
<Control xsi:type="TextBoxControl"
         Ident="ExchangeRate"
         DataType="Double"
         DataTypeSize="10,4"
         TitleResourceKey="ExchangeRate_Form" />
```

### Doporučení pro výběr DataType

| Účel | DataType | MaxLength | Poznámka |
|------|----------|-----------|----------|
| Krátký text (jméno, email) | String | 100-255 | Vždy nastavit MaxLength |
| Dlouhý text (popis, poznámka) | String | 0 nebo 4000 | 0 = NVARCHAR(MAX) |
| Celé číslo (ID, množství) | Number | - | INT |
| Cena, částka | Double | "18,2" | DECIMAL s 2 desetinnými místy |
| Procenta | Double | "5,2" | DECIMAL pro 0.00-100.00 |
| Ano/Ne | Bool | - | BIT |
| Datum narození, termín | Date | - | Bez času |
| Timestamp, vytvořeno | DateTime | - | S časem |
| Čas trvání (minuty) | Time | - | INT, ukládá minuty |
| Čas ve dne | Time24 | - | TIME, HH:mm:ss |
| Výběr více hodnot | StringList/NumberList | - | Multi-select |
| ASCII kód (ISO, SKU) | VarChar | 50 | Šetří místo |

### Příklady použití jednotlivých DataType

**String - textové pole:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="Name"
         DataType="String"
         MaxLength="100"
         TitleResourceKey="Name_Form"
         IsRequired="true" />
```

**Number - celé číslo:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="Quantity"
         DataType="Number"
         TitleResourceKey="Quantity_Form"
         Default="1" />
```

**Double - desetinné číslo (cena):**
```xml
<Control xsi:type="TextBoxControl"
         Ident="UnitPrice"
         DataType="Double"
         DataTypeSize="18,2"
         TitleResourceKey="UnitPrice_Form" />
```

**Bool - checkbox:**
```xml
<Control xsi:type="CheckBoxControl"
         Ident="IsActive"
         DataType="Bool"
         TitleResourceKey="IsActive_Form"
         Default="1" />
```

**Date - pouze datum:**
```xml
<Control xsi:type="DateTimeControl"
         Ident="BirthDate"
         DataType="Date"
         TitleResourceKey="BirthDate_Form" />
```

**DateTime - datum a čas:**
```xml
<Control xsi:type="DateTimeControl"
         Ident="EventStart"
         DataType="DateTime"
         TitleResourceKey="EventStart_Form" />
```

**Time - čas v minutách:**
```xml
<Control xsi:type="TimeControl"
         Ident="Duration"
         DataType="Time"
         TitleResourceKey="Duration_Form" />
```

**StringList - multi-select:**
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

**NumberList - multi-select s číselnými ID:**
```xml
<Control xsi:type="DualListBoxControl"
         Ident="AssignedUsers"
         DataType="NumberList"
         TitleResourceKey="AssignedUsers_Form">
  <DataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL>SELECT ID, FullName FROM dbo.Account WHERE State != 0</SQL>
  </DataBind>
</Control>
```

**Guid - unikátní identifikátor:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="ExternalID"
         DataType="Guid"
         TitleResourceKey="ExternalID_Form"
         IsReadOnly="true" />
```

---

## Typické kombinace Control + DataType

| Control | Typický DataType | Poznámka |
|---------|------------------|----------|
| TextBoxControl | String, VarChar | S MaxLength |
| TextBoxControl | Number, Double | Pro číselný vstup |
| TextAreaControl | String | MaxLength=0 pro dlouhý text |
| RichTextBoxControl | String | MaxLength=0, HTML obsah |
| PasswordBoxControl | String | MaxLength=100-255 |
| HiddenControl | String, Number, Guid | Skryté hodnoty |
| CheckBoxControl | Bool | Vždy Bool |
| SwitchControl | Bool | Vždy Bool |
| DropDownListControl | Number, String | Number pro FK, String pro enum |
| AutoCompleteControl | Number, String | Number pro FK |
| RadioButtonListControl | Number, String | Podle typu hodnot |
| CheckBoxListControl | StringList, NumberList | Multi-select |
| ListBoxControl | StringList, NumberList | Multi-select |
| DualListBoxControl | StringList, NumberList | Multi-select |
| TagControl | StringList | Tagy |
| TreeSelectBoxControl | Number | FK na hierarchickou tabulku |
| DateTimeControl | Date, DateTime | Date bez času, DateTime s časem |
| TimeControl | Time | Čas v minutách |
| ColorControl | String | MaxLength=7 (#RRGGBB) |
| CodeEditorControl | String | MaxLength=0 pro kód |

## Kontroly bez DataType (nedědí z FormControl)

Tyto kontroly nevytváří sloupec v databázi:

| Control | Popis |
|---------|-------|
| SubFormControl | 1:N relace, data v jiné tabulce |
| InlineSubFormControl | Inline 1:N relace |
| DataGridControl | Read-only grid |
| FileControl | Soubory v dbo.File |
| FileGalleryControl | Galerie obrázků |
| FileManagerControl | Správce souborů |
| TimeLineControl | Historie změn |
| CommunicationControl | Komentáře |
| PlaceHolderControl | Placeholder pro layout |
| AlertControl | Informační alert |

---

## Example

```xml
<Control xsi:type="TextBoxControl"
         Ident="Email"
         DataType="String"
         MaxLength="100"
         TitleResourceKey="Email_Form"
         IsRequired="true"
         IsShowRequired="true"
         HelpDescriptionResourceKey="EmailHelp_Form">
  <Validations>
    <Validation xsi:type="EmailValidation"
                Ident="EmailFormat"
                ErrorMessageResourceKey="InvalidEmail" />
  </Validations>
</Control>
```
