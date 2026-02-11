# HTMLTemplate Syntax

HTMLTemplate je šablonovací systém SmartFormPlatform pro generování dynamického HTML obsahu v sekcích, emailech, reportech a dalších komponentách.

> **DŮLEŽITÉ:** Vždy používejte `<![CDATA[...]]>` pro HTMLTemplate a SQL obsah. Zajistí validní XML a čitelnost bez escapování `<`, `>`, `&`. Viz [CDATA v README.md](../README.md#cdata-sekce-důležité).

---

## Přehled zástupných znaků

| Syntax | Popis |
|--------|-------|
| `[%ControlIdent%]` | Data z formuláře |
| `[#ResourceKey#]` | Překlad z dbo.Resource |
| `[@CONSTANT@]` | Systémové konstanty |
| `[$VariableIdent$]` | Hodnoty z Variable.xml |
| `[FOR][/FOR]` | Cyklus přes DataSource |
| `[IF()][ELSE][/IF]` | Podmínka |
| `[HTMLENCODE][/HTMLENCODE]` | HTML encoding |
| `[HTMLDECODE][/HTMLDECODE]` | HTML decoding |
| `[FORMAT()][/FORMAT]` | Formátování hodnoty |
| `[REPLACE()][/REPLACE]` | Nahrazení textu |

---

## 1. Data z formuláře `[%...%]`

### Aktuální formulář

```html
<!-- Hodnota pole z aktuálního formuláře -->
<span>[%Name%]</span>
<span>[%Email%]</span>

<!-- Explicitně aktuální formulář -->
<span>[%ACTUALFORM.Name%]</span>
<span>[%ACTUALFORM.ID%]</span>
```

### Jiný formulář (FK relace)

```html
<!-- Data z jiného formuláře podle ID -->
<span>[%Customer.Name%]</span>
<span>[%Category.Title%]</span>
```

### Systémové tabulky (dbo.*, usr.*)

```html
<!-- Přístup k systémovým tabulkám -->
<span>[%dbo.Account.FullName(ACTUALFORM.AccountID)%]</span>
<span>[%usr.Category.Name(ACTUALFORM.CategoryID)%]</span>

<!-- S přímým ID -->
<span>[%dbo.Account.FullName(ID_123)%]</span>

<!-- S vlastním PK -->
<span>[%dbo.Language(Code).Name(ACTUALFORM.LanguageCode)%]</span>
```

### Data z DataSource (v sekcích)

```html
<!-- V ContentSection se Sources -->
<span>[%#DataSourceIdent.ColumnIdent%]</span>

<!-- Příklad -->
<span>[%#CustomerData.FullName%]</span>
<span>[%#OrderStats.TotalAmount%]</span>
```

### Formátování hodnot

```html
<!-- S formátem -->
<span>[%Price{N2}%]</span>
<span>[%CreateDate{dd.MM.yyyy}%]</span>
<span>[%Duration{time}%]</span>
```

---

## 2. Překlady `[#...#]`

```html
<!-- Překlad z dbo.Resource -->
<h3>[#BasicInfo_Product#]</h3>
<label>[#Name_Product#]</label>
<button>[#SaveButton_Product#]</button>

<!-- Dynamický klíč (vnořený) -->
<span>[#[%StatusResourceKey%]#]</span>
```

---

## 3. Systémové konstanty `[@...@]`

| Konstanta | Popis |
|-----------|-------|
| `[@WORKFLOWSTATE@]` | Aktuální stav workflow (přeložený název) |
| `[@USERFULLNAME@]` | Jméno přihlášeného uživatele |
| `[@USERID@]` | ID přihlášeného uživatele (AccountID) |
| `[@URL@]` | Aktuální URL |
| `[@FORMURL@]` | URL aktuálního formuláře (`~/Form/Detail/FormIdent/ID`) |
| `[@CATEGORY@]` | Cesta ve složkové struktuře |
| `[@PROXYDOMAIN@]` | Proxy doména |
| `[@NOTE@]` | Poznámka (kontextová) |
| `[@FULLNAME@]` | Celé jméno (kontextové) |
| `[@SCRIPTTOKENNONCE@]` | Nonce pro inline skripty (CSP) |

### URL soubory

```html
<!-- URL obrázku podle FileID -->
<img src="[@IMAGEURL([%FileID%])@]" />

<!-- URL souboru podle FileID -->
<a href="[@FILEURL([%AttachmentID%])@]">Stáhnout</a>

<!-- URL souboru podle GUID -->
<a href="[@FILEGUIDURL([%FileID%])@]">Stáhnout</a>

<!-- Avatar uživatele -->
<img src="[@AVATARURL([%AccountID%])@]" />
```

**Příklad použití:**

```html
<div class="header">
    <h3>ID: [%ACTUALFORM.ID%] | [%Name%] | [@WORKFLOWSTATE@]</h3>
    <small>Vytvořil: [@USERFULLNAME@]</small>
</div>
```

---

## 4. Variable `[$...$]`

Hodnoty definované v `Variable.xml`:

```html
<!-- Použití proměnné -->
<span>Verze: [$AppVersion$]</span>
<a href="[$SupportEmail$]">Podpora</a>
```

---

## 5. Cyklus `[FOR][/FOR]`

### Základní použití

```html
[FOR Source="Items"]
<tr>
    <td>[%Name%]</td>
    <td>[%Quantity%]</td>
    <td>[%Price%]</td>
</tr>
[/FOR]
```

### Atributy FOR cyklu

| Atribut | Popis |
|---------|-------|
| `Source` | Název DataSource (povinný) |
| `Distinct` | Odstraní duplicity podle sloupců |
| `Connect` | Napojí na nadřazený cyklus |
| `Name` | Pojmenuje cyklus pro Head |
| `Head` | Napojí na pojmenovaný cyklus |
| `DefaultValue` | Výchozí hodnota pro chybějící data |
| `IgnoreValue` | Hodnota k ignorování |
| `IgnoreIdent` | Sloupec pro IgnoreValue |

### Vnořené cykly

```html
[FOR Source="Categories" Name="cat"]
<h4>[%CategoryName%]</h4>
<ul>
    [FOR Source="Products" Connect="CategoryID"]
    <li>[%ProductName%] - [%Price%]</li>
    [/FOR]
</ul>
[/FOR]
```

### Distinct - odstranění duplicit

```html
[FOR Source="Orders" Distinct="CustomerID"]
<tr>
    <td>[%CustomerName%]</td>
    <td>[%OrderCount%]</td>
</tr>
[/FOR]
```

### IgnoreValue - filtrování

```html
[FOR Source="Items" IgnoreIdent="Status" IgnoreValue="Deleted"]
<tr>
    <td>[%Name%]</td>
</tr>
[/FOR]
```

---

## 6. Podmínky `[IF][/IF]`

### Rovnost

```html
[IF('[%Status%]'=='Active')]
<span class="badge badge-success">Aktivní</span>
[/IF]
```

### Nerovnost

```html
[IF('[%Status%]'!='Deleted')]
<span>[%Name%]</span>
[/IF]
```

### S ELSE

```html
[IF('[%IsActive%]'=='1')]
<span class="text-success">Aktivní</span>
[ELSE]
<span class="text-danger">Neaktivní</span>
[/IF]
```

### Vnořené podmínky

```html
[IF('[%Type%]'=='Premium')]
<div class="premium">
    [IF('[%HasDiscount%]'=='1')]
    <span class="discount">Se slevou!</span>
    [/IF]
</div>
[/IF]
```

---

## 7. Funkce

### HTMLENCODE

```html
<!-- Escapuje HTML znaky -->
[HTMLENCODE][%UserInput%][/HTMLENCODE]
```

### HTMLDECODE

```html
<!-- Dekóduje HTML entity -->
[HTMLDECODE][%EncodedContent%][/HTMLDECODE]
```

### FORMAT

```html
<!-- Formátování hodnoty -->
[FORMAT("N2","Double")][%Price%][/FORMAT]
[FORMAT("dd.MM.yyyy","Date")][%CreateDate%][/FORMAT]
[FORMAT("HH:mm","Time24")][%StartTime%][/FORMAT]
[FORMAT("N0","Number")][%Quantity%][/FORMAT]

<!-- Podporované DataTypes: Number, SmallNumber, BigNumber, Double, DateTime, Date, Time24, Time -->
```

### REPLACE

```html
<!-- Nahrazení textu -->
[REPLACE("\n","<br/>")][%Description%][/REPLACE]
[REPLACE(" ","-")][%Slug%][/REPLACE]
```

---

## 8. Razor Engine

Pro pokročilé šablony lze aktivovat Razor engine pomocí `IsRazorEngine="true"`.

### Aktivace v XML

```xml
<Section xsi:type="ContentSection" Ident="RazorSection">
  <HTMLTemplate IsRazorEngine="true">
    @{
      var items = Model.Data.Items;
      var total = items.Sum(x => (decimal)x.Price);
    }
    <p>Celkem: @total.ToString("N2")</p>
  </HTMLTemplate>
</Section>
```

### RazorEngineSetting - custom Usings a Assemblies

```xml
<HTMLTemplate IsRazorEngine="true">
  <RazorEngineSetting>
    <Usings>
      <string>System.Text.Json</string>
      <string>MyCompany.CustomHelpers</string>
    </Usings>
    <Assemblies>
      <string>System.Text.Json</string>
      <string>MyCompany.CustomHelpers</string>
    </Assemblies>
  </RazorEngineSetting>
  <![CDATA[
    @using System.Text.Json
    @{
      var json = JsonSerializer.Serialize(Model.Data);
    }
    <pre>@json</pre>
  ]]>
</HTMLTemplate>
```

### Dostupné objekty v Razor

| Objekt | Popis |
|--------|-------|
| `Model.Data` | Data z formuláře (dynamic) |
| `Model.TableID` | ID záznamu |
| `Model.LanguageID` | ID jazyka |
| `Model.UICultureCode` | Kód kultury |
| `Model.[SourceIdent]` | Data z pojmenovaných DataSource |
| `Resx["Key"]` | Přístup k překladům |
| `Url.Content("~/...")` | URL helper |
| `Html.Raw(...)` | Raw HTML output |

### Příklad Razor šablony

```xml
<HTMLTemplate IsRazorEngine="true">
<![CDATA[
@{
    var items = Model.Items ?? new List<dynamic>();
    decimal total = 0;
}

<table class="table">
    <thead>
        <tr>
            <th>@Resx["Product_Order"]</th>
            <th>@Resx["Quantity_Order"]</th>
            <th>@Resx["Price_Order"]</th>
            <th>@Resx["Subtotal_Order"]</th>
        </tr>
    </thead>
    <tbody>
        @foreach(var item in items)
        {
            var subtotal = (decimal)item.Quantity * (decimal)item.Price;
            total += subtotal;
            <tr>
                <td>@item.ProductName</td>
                <td>@item.Quantity</td>
                <td>@item.Price.ToString("N2")</td>
                <td>@subtotal.ToString("N2")</td>
            </tr>
        }
    </tbody>
    <tfoot>
        <tr>
            <th colspan="3">@Resx["Total_Order"]</th>
            <th>@total.ToString("N2")</th>
        </tr>
    </tfoot>
</table>
]]>
</HTMLTemplate>
```

---

## 9. Control rendering

V HTMLTemplate sekcí formuláře lze renderovat Controls:

```html
<!-- Renderování controlu -->
<Control ID="Name" />
<Control ID="CategoryID" />

<!-- Label pro control -->
<ControlLabel ControlID="Name" />

<!-- Tlačítko -->
<ControlButton ID="SaveButton" />
```

**Typická struktura:**

```html
<div class="form-group">
    <ControlLabel ControlID="Name" />
    <Control ID="Name" />
</div>
```

---

## 10. Příklady použití

### ContentSection s DataSource

```xml
<Section xsi:type="ContentSection" Ident="OrderSummary">
  <Sources>
    <DataSource Ident="OrderItems">
      <Columns>
        <Column Ident="ProductName" />
        <Column Ident="Quantity" />
        <Column Ident="Price" />
      </Columns>
      <SQL>
        SELECT p.Name AS ProductName, oi.Quantity, oi.Price
        FROM usr.OrderItem oi
        INNER JOIN usr.Product p ON p.ID = oi.ProductID
        WHERE oi.OrderID = @ID AND oi.State != 0
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
      </Parameters>
    </DataSource>
  </Sources>
  <HTMLTemplate>
    <h4>[#OrderItems_Order#]</h4>
    <table class="table">
      <thead>
        <tr>
          <th>[#Product_Order#]</th>
          <th>[#Quantity_Order#]</th>
          <th>[#Price_Order#]</th>
        </tr>
      </thead>
      <tbody>
        [FOR Source="OrderItems"]
        <tr>
          <td>[%ProductName%]</td>
          <td>[%Quantity%]</td>
          <td>[%Price%]</td>
        </tr>
        [/FOR]
      </tbody>
    </table>
  </HTMLTemplate>
</Section>
```

### Email BodyTemplate s Razor

```xml
<Action xsi:type="Email" SubjectResourceKey="OrderConfirmation_Email" EmailIdent="OrderConfirmation">
  <Recipients>
    <Recipient RecipientType="To" SourceType="SQL">
      <DataSource>
        <SQL>SELECT Email, LanguageID FROM usr.Customer WHERE ID = @CustomerID</SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerID" DataType="Number" />
        </Parameters>
      </DataSource>
    </Recipient>
  </Recipients>
  <BodyTemplate IsRazorEngine="true">
    <Sources>
      <DataSource Ident="OrderData">
        <Columns>
          <Column Ident="OrderNumber" />
          <Column Ident="TotalAmount" />
          <Column Ident="CustomerName" />
        </Columns>
        <SQL>
          SELECT o.OrderNumber, o.TotalAmount, c.FullName AS CustomerName
          FROM usr.Order o
          INNER JOIN usr.Customer c ON c.ID = o.CustomerID
          WHERE o.ID = @ID
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
        </Parameters>
      </DataSource>
    </Sources>
    <HTMLTemplate>
<![CDATA[
@{
    var order = Model.OrderData?.FirstOrDefault();
}
<p>Dobrý den @order?.CustomerName,</p>
<p>Děkujeme za Vaši objednávku č. <strong>@order?.OrderNumber</strong>.</p>
<p>Celková částka: <strong>@order?.TotalAmount?.ToString("N2") Kč</strong></p>
<p>S pozdravem,<br/>Váš tým</p>
]]>
    </HTMLTemplate>
  </BodyTemplate>
</Action>
```

### HeaderSection s dynamickým obsahem

```xml
<Section xsi:type="HeaderSection" Ident="HeaderSection">
  <Sources>
    <DataSource Ident="HeaderData">
      <Columns>
        <Column Ident="CustomerName" />
        <Column Ident="OrderCount" />
      </Columns>
      <SQL>
        SELECT c.FullName AS CustomerName, COUNT(o.ID) AS OrderCount
        FROM usr.Customer c
        LEFT JOIN usr.Order o ON o.CustomerID = c.ID AND o.State != 0
        WHERE c.ID = @ID
        GROUP BY c.FullName
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
      </Parameters>
    </DataSource>
  </Sources>
  <HTMLTemplate>
    <div class="row">
      <div class="col-md-12">
        <h3>
          ID: [%ACTUALFORM.ID%] |
          [FOR Source="HeaderData"][%CustomerName%] ([%OrderCount%] objednávek)[/FOR] |
          [@WORKFLOWSTATE@]
        </h3>
      </div>
    </div>
  </HTMLTemplate>
</Section>
```
