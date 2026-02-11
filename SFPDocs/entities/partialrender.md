# PartialRender

Defines reusable HTML/JSON content fragments that can be dynamically loaded via AJAX calls. Used for creating dynamic UI components, API endpoints, and partial page updates without full page refresh.

---

## Overview

PartialRender slouží pro:
- **Dynamické načítání obsahu** - AJAX loading částí stránky
- **JSON API endpointy** - Generování JSON dat pro JavaScript komponenty
- **Reusable komponenty** - Znovupoužitelné HTML fragmenty
- **Dashboard widgety** - Dynamické widgety na dashboardech
- **Modal dialogy** - Obsah pro modální okna
- **Formulář integration** - Načítání dat na základě formulářových hodnot

---

## XML Structure

### Root Element Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier (used in URL path) |
| `PackageIdent` | string | No | "" | Reference to Package for JS/CSS dependencies |
| `XMLDescription` | string | No | "" | Internal documentation (CDATA recommended) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Required static permissions |
| `DenyPermissions` | List&lt;string&gt; | Denied permissions (blocks access) |
| `Sections` | List&lt;Section&gt; | Content sections (typically `ContentSection`) |
| `PackageIdents` | List&lt;string&gt; | Package dependencies (JS/CSS) |

---

## Sections

### ContentSection

Každá sekce reprezentuje jeden endpoint/render path.

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | **Required** | Section identifier (used in URL path) |
| `Title` | string | "" | Section title (internal documentation) |
| `ReturnType` | enum | HTML | `HTML` or `JSON` - output format |
| `IsRazorEngine` | bool | false | Enable Razor template syntax (@Model, @foreach, etc.) |
| `IsVisible` | bool | true | Section visibility |

#### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Section-level permissions (in addition to PartialRender permissions) |
| `Sources` | List&lt;DataSource&gt; | Data sources (available as `Model.Data.{Ident}`) |
| `HTMLTemplate` | string | Template content (HTML or Razor code) |
| `Settings` | List&lt;Setting&gt; | RazorEngineSetting for Usings/Assemblies |

---

## URL Endpoints

### MVC Application (AjaxAPI)

```
GET/POST /AjaxAPI/PartialRender/Render?ident={PartialRenderIdent}&sectionIdent={SectionIdent}
```

**S formulářovými daty:**
```
GET/POST /AjaxAPI/PartialRender/RenderWithFormData?ident={PartialRenderIdent}&sectionIdent={SectionIdent}&formIdent={FormIdent}&tableID={TableID}&formUniqueRandomIdent={Guid}
```

### REST API (WebAPI)

```
GET/POST /PartialRender/{ident}/{sectionIdent}
GET/POST /PartialRender/{ident}/{sectionIdent}/{formIdent}/{tableID}
```

**Checksum support:**
```
GET /PartialRender/{ident}/{sectionIdent}?checksum={previousChecksum}
```

Returns:
- `200 OK` - Content changed, new data returned
- `304 Not Modified` - Content unchanged (same checksum)
- `400 Bad Request` - Invalid parameters
- `403 Forbidden` - Permission denied
- `401 Unauthorized` - Not authenticated

---

## Data Sources

### Parameter Types

Parameters can be sourced from:

| SetDataType | Description | Example |
|-------------|-------------|---------|
| `QueryStringData` | URL query parameters | `?UserID=123` |
| `POSTData` | POST body parameters | Form data, JSON body |
| `FormData` | Form control values (with RenderWithFormData) | Form fields |
| `ConstantType` | System constants | `UserID`, `UserLanguageID` |

### Example DataSource

```xml
<DataSource Ident="EmployeeList">
  <Columns>
    <Column Ident="ID" />
    <Column Ident="FullName" />
    <Column Ident="Email" />
  </Columns>
  <SQL><![CDATA[
    SELECT ID, FullName, Email
    FROM usr.Employee
    WHERE DepartmentID = @DepartmentID
      AND State != @DeletedState
  ]]></SQL>
  <Parameters>
    <dsp:Parameter xsi:type="dsp:VariableParameter"
                   Ident="DepartmentID"
                   DataType="Number"
                   SetDataType="QueryStringData" />
    <dsp:Parameter xsi:type="dsp:ValueParameter"
                   Ident="DeletedState"
                   DataType="Number"
                   Value="0" />
  </Parameters>
</DataSource>
```

---

## Template Syntax

### HTML Mode (ReturnType="HTML", IsRazorEngine="false")

```xml
<HTMLTemplate><![CDATA[
  <div class="employee-list">
    [FOR Source="EmployeeList"]
    <div class="employee-card">
      <h3>[%FullName%]</h3>
      <p>[%Email%]</p>
    </div>
    [/FOR]
  </div>
]]></HTMLTemplate>
```

**Available syntax:**
- `[%ColumnName%]` - Data from DataSource
- `[FOR Source="DataSourceIdent"]...[/FOR]` - Loop over rows
- `[#ResourceKey#]` - Translation resource

### Razor Mode (ReturnType="HTML", IsRazorEngine="true")

```xml
<HTMLTemplate>@{
  // C# code
  var total = Model.Data.EmployeeList.Count;
}
<div class="employee-list">
  <p>Total employees: @total</p>

  @foreach (var emp in Model.Data.EmployeeList) {
    <div class="employee-card">
      <h3>@emp.FullName</h3>
      <p>@emp.Email</p>
    </div>
  }
</div>
</HTMLTemplate>
```

**Available Model:**
- `Model.Data.{DataSourceIdent}` - List of dynamic objects
- `Model.SingleObject(Model.Data.Source)` - Get first row
- C# syntax: `@`, `@{ }`, `@foreach`, `@if`, etc.

### JSON Mode (ReturnType="JSON", IsRazorEngine="true")

```xml
<HTMLTemplate>@{
  var data = Model.Data.EmployeeList;
  var result = new {
    Count = data.Count,
    Employees = data.Select(e => new {
      ID = e.ID,
      Name = e.FullName,
      Email = e.Email
    }).ToList()
  };

  string json = Newtonsoft.Json.JsonConvert.SerializeObject(result);
}
@json</HTMLTemplate>
```

**Requirements:**
- Must output raw JSON string
- Use `@json` (not `@(json)`) to avoid escaping
- Configure RazorEngineSetting for Newtonsoft.Json if needed

---

## RazorEngineSetting

Pro použití externích knihoven v Razor enginu:

```xml
<Settings>
  <Setting xsi:type="RazorEngineSetting">
    <Usings>
      <string>Newtonsoft.Json</string>
      <string>System.Linq</string>
      <string>System.Collections.Generic</string>
    </Usings>
    <Assemblies>
      <string>Newtonsoft.Json</string>
    </Assemblies>
  </Setting>
</Settings>
```

---

## JavaScript Integration

### Basic AJAX Call

```javascript
$.ajax({
  url: "/AjaxAPI/PartialRender/Render",
  type: "GET",
  data: {
    ident: "UserProfileCard",
    sectionIdent: "ProfileCard",
    UserID: 123
  },
  success: function(response) {
    if (response.isError) {
      console.error(response.errors);
    } else {
      $("#container").html(response.html);
    }
  }
});
```

### With Form Data (POST)

```javascript
var $form = $("form").first();
var formData = new FormData($form[0]);
var tableID = $form.attr("data-tableid");
var formUniqueRandomIdent = $("#FormUniqueRandomIdent", $form).val();

$.ajax({
  url: `/AjaxAPI/PartialRender/RenderWithFormData?` +
       `ident=MyPartialRender&sectionIdent=DataSection&` +
       `formIdent=Product&tableID=${tableID}&` +
       `formUniqueRandomIdent=${formUniqueRandomIdent}`,
  type: "POST",
  data: formData,
  processData: false,
  contentType: false,
  success: function(response) {
    if (response.isError) {
      console.error(response.errors);
    } else {
      $("#container").html(response.html);
    }
  }
});
```

### REST API with Checksum

```javascript
let currentChecksum = "";

function loadContent() {
  $.ajax({
    url: `/PartialRender/MyPartialRender/DataSection?checksum=${currentChecksum}`,
    type: "GET",
    success: function(response) {
      // Content changed
      currentChecksum = response.checksum;
      $("#container").html(response.html);
    },
    statusCode: {
      304: function() {
        // Content not modified, no update needed
        console.log("Content unchanged");
      }
    }
  });
}

// Poll for updates
setInterval(loadContent, 5000);
```

### JSON Response Handling

```javascript
$.ajax({
  url: "/AjaxAPI/PartialRender/Render",
  data: {
    ident: "EmployeeDataAPI",
    sectionIdent: "GetEmployees",
    DepartmentID: 5
  },
  success: function(response) {
    // response.data contains parsed JSON object
    console.log("Total:", response.data.Count);
    response.data.Employees.forEach(emp => {
      console.log(emp.Name, emp.Email);
    });
  }
});
```

---

## Common Use Cases

### 1. Dashboard Widget

```xml
<?xml version="1.0" encoding="utf-8"?>
<PartialRender xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
               Ident="SalesWidgetPartialRender">
  <AccessPermissions>
    <string>Dashboard</string>
  </AccessPermissions>

  <Sections>
    <Section xsi:type="ContentSection" Ident="WeeklySales" IsRazorEngine="true">
      <Sources>
        <DataSource Ident="Sales">
          <Columns>
            <Column Ident="TotalSales" />
            <Column Ident="OrderCount" />
          </Columns>
          <SQL><![CDATA[
            SELECT
              SUM(TotalAmount) AS TotalSales,
              COUNT(*) AS OrderCount
            FROM usr.Order
            WHERE CreateDate >= DATEADD(DAY, -7, GETDATE())
              AND State != 0
          ]]></SQL>
        </DataSource>
      </Sources>
      <HTMLTemplate>
        @{
          var data = Model.SingleObject(Model.Data.Sales);
        }
        <div class="card">
          <div class="card-body">
            <h3>Weekly Sales</h3>
            <p class="display-4">@data.TotalSales.ToString("C")</p>
            <p class="text-muted">@data.OrderCount orders</p>
          </div>
        </div>
      </HTMLTemplate>
    </Section>
  </Sections>
</PartialRender>
```

**Usage in Dashboard:**
```javascript
$(document).ready(function() {
  loadSalesWidget();
  setInterval(loadSalesWidget, 60000); // Refresh every minute
});

function loadSalesWidget() {
  $.get("/AjaxAPI/PartialRender/Render", {
    ident: "SalesWidgetPartialRender",
    sectionIdent: "WeeklySales"
  }, function(response) {
    $("#salesWidget").html(response.html);
  });
}
```

### 2. JSON API for JavaScript

```xml
<PartialRender Ident="ProductSearchAPI">
  <AccessPermissions>
    <string>ViewProducts</string>
  </AccessPermissions>

  <Sections>
    <Section xsi:type="ContentSection"
             Ident="Search"
             ReturnType="JSON"
             IsRazorEngine="true">
      <Settings>
        <Setting xsi:type="RazorEngineSetting">
          <Usings>
            <string>Newtonsoft.Json</string>
          </Usings>
          <Assemblies>
            <string>Newtonsoft.Json</string>
          </Assemblies>
        </Setting>
      </Settings>

      <Sources>
        <DataSource Ident="Products">
          <Columns>
            <Column Ident="ID" />
            <Column Ident="Name" />
            <Column Ident="Price" />
          </Columns>
          <SQL><![CDATA[
            SELECT TOP 10 ID, Name, Price
            FROM usr.Product
            WHERE Name LIKE '%' + @SearchTerm + '%'
              AND State != 0
            ORDER BY Name
          ]]></SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="SearchTerm"
                           DataType="String"
                           SetDataType="QueryStringData" />
          </Parameters>
        </DataSource>
      </Sources>

      <HTMLTemplate>@{
        var products = Model.Data.Products.Select(p => new {
          id = (long)p.ID,
          name = (string)p.Name,
          price = (decimal)p.Price
        }).ToList();

        string json = Newtonsoft.Json.JsonConvert.SerializeObject(products);
      }
@json</HTMLTemplate>
    </Section>
  </Sections>
</PartialRender>
```

**JavaScript Usage:**
```javascript
function searchProducts(term) {
  $.get("/PartialRender/ProductSearchAPI/Search", {
    SearchTerm: term
  }, function(response) {
    // response.data is already parsed JSON
    displayProducts(response.data);
  });
}
```

### 3. Modal Dialog Content

```xml
<PartialRender Ident="UserDetailModalPartialRender">
  <AccessPermissions>
    <string>ViewUsers</string>
  </AccessPermissions>

  <Sections>
    <Section xsi:type="ContentSection" Ident="UserDetail" IsRazorEngine="true">
      <Sources>
        <DataSource Ident="User">
          <Columns>
            <Column Ident="FullName" />
            <Column Ident="Email" />
            <Column Ident="Phone" />
            <Column Ident="Department" />
          </Columns>
          <SQL><![CDATA[
            SELECT
              FullName,
              Email,
              Phone,
              d.Name AS Department
            FROM dbo.Account a
            LEFT JOIN usr.Department d ON d.ID = a.DepartmentID
            WHERE a.ID = @UserID
          ]]></SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="UserID"
                           DataType="Number"
                           SetDataType="QueryStringData" />
          </Parameters>
        </DataSource>
      </Sources>

      <HTMLTemplate>
        @{
          var user = Model.SingleObject(Model.Data.User);
        }
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">@user.FullName</h5>
              <button type="button" class="close" data-bs-dismiss="modal">&times;</button>
            </div>
            <div class="modal-body">
              <p><strong>Email:</strong> @user.Email</p>
              <p><strong>Phone:</strong> @user.Phone</p>
              <p><strong>Department:</strong> @user.Department</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </HTMLTemplate>
    </Section>
  </Sections>
</PartialRender>
```

**JavaScript:**
```javascript
function showUserDetail(userID) {
  $.get("/AjaxAPI/PartialRender/Render", {
    ident: "UserDetailModalPartialRender",
    sectionIdent: "UserDetail",
    UserID: userID
  }, function(response) {
    // Create modal
    var $modal = $('<div class="modal fade" tabindex="-1"></div>');
    $modal.html(response.html);
    $('body').append($modal);
    $modal.modal('show');

    // Cleanup on close
    $modal.on('hidden.bs.modal', function() {
      $modal.remove();
    });
  });
}
```

### 4. Form-Dependent Content

```xml
<PartialRender Ident="ProductPricingPartialRender">
  <AccessPermissions>
    <string>ViewProducts</string>
  </AccessPermissions>

  <Sections>
    <Section xsi:type="ContentSection" Ident="CalculatePrice" IsRazorEngine="true">
      <Sources>
        <DataSource Ident="Calculation">
          <Columns>
            <Column Ident="BasePrice" />
            <Column Ident="Discount" />
            <Column Ident="Tax" />
            <Column Ident="FinalPrice" />
          </Columns>
          <SQL><![CDATA[
            DECLARE @BasePrice DECIMAL(18,2) = @Quantity * @UnitPrice
            DECLARE @DiscountAmount DECIMAL(18,2) = @BasePrice * (@DiscountPercent / 100.0)
            DECLARE @TaxAmount DECIMAL(18,2) = (@BasePrice - @DiscountAmount) * 0.21

            SELECT
              @BasePrice AS BasePrice,
              @DiscountAmount AS Discount,
              @TaxAmount AS Tax,
              @BasePrice - @DiscountAmount + @TaxAmount AS FinalPrice
          ]]></SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="Quantity"
                           DataType="Number"
                           SetDataType="POSTData" />
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="UnitPrice"
                           DataType="Double"
                           SetDataType="POSTData" />
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="DiscountPercent"
                           DataType="Double"
                           SetDataType="POSTData" />
          </Parameters>
        </DataSource>
      </Sources>

      <HTMLTemplate>
        @{
          var calc = Model.SingleObject(Model.Data.Calculation);
        }
        <div class="price-breakdown">
          <p>Base Price: @calc.BasePrice.ToString("C")</p>
          <p>Discount: -@calc.Discount.ToString("C")</p>
          <p>Tax (21%): +@calc.Tax.ToString("C")</p>
          <hr />
          <p class="h4">Final Price: @calc.FinalPrice.ToString("C")</p>
        </div>
      </HTMLTemplate>
    </Section>
  </Sections>
</PartialRender>
```

**JavaScript (triggered on form change):**
```javascript
$("#Quantity, #UnitPrice, #DiscountPercent").on("change", function() {
  updatePriceCalculation();
});

function updatePriceCalculation() {
  $.ajax({
    url: "/AjaxAPI/PartialRender/Render",
    type: "POST",
    data: {
      ident: "ProductPricingPartialRender",
      sectionIdent: "CalculatePrice",
      Quantity: $("#Quantity").val(),
      UnitPrice: $("#UnitPrice").val(),
      DiscountPercent: $("#DiscountPercent").val()
    },
    success: function(response) {
      $("#priceBreakdown").html(response.html);
    }
  });
}
```

---

## Response Format

### HTML ReturnType (MVC AjaxAPI)

```json
{
  "html": "<div>...</div>",
  "data": null,
  "isError": false,
  "errors": []
}
```

### JSON ReturnType (MVC AjaxAPI)

```json
{
  "html": null,
  "data": { /* parsed JSON object */ },
  "isError": false,
  "errors": []
}
```

### REST API (WebAPI)

```json
{
  "html": "<div>...</div>",
  "data": null,
  "checksum": "abc123..."
}
```

**Error Response:**
```json
{
  "html": null,
  "data": null,
  "isError": true,
  "errors": [
    {
      "key": "PartialRender",
      "message": "PartialRenderNotFound"
    }
  ]
}
```

---

## Security

### Permission Checks

Systém kontroluje oprávnění na **dvou úrovních**:

1. **PartialRender level** - `AccessPermissions` / `DenyPermissions`
2. **Section level** - `AccessPermissions` na konkrétní sekci

```xml
<PartialRender Ident="AdminPanel">
  <!-- Pouze SuperAdmin má přístup k celému PartialRender -->
  <AccessPermissions>
    <string>SuperAdmin</string>
  </AccessPermissions>

  <Sections>
    <!-- Tato sekce má dodatečnou kontrolu -->
    <Section xsi:type="ContentSection" Ident="UserList">
      <AccessPermissions>
        <string>ViewUsers</string>
      </AccessPermissions>
      <!-- ... -->
    </Section>
  </Sections>
</PartialRender>
```

### DenyPermissions

```xml
<!-- Zamezit přístup pro určité role -->
<DenyPermissions>
  <string>Guest</string>
  <string>ExternalUser</string>
</DenyPermissions>
```

### DataSource Permissions

```xml
<DataSource Ident="SensitiveData">
  <DataPermissions>
    <string>ViewConfidentialData</string>
  </DataPermissions>
  <!-- ... -->
</DataSource>
```

---

## Best Practices

### 1. Naming Conventions

```
{Module}{Purpose}PartialRender
└─ Section: {Action/View}

Example:
- PartialRender: SalesReportPartialRender
  └─ Section: WeeklySummary
  └─ Section: MonthlySummary
```

### 2. Performance

- **Omezit SQL dotazy** - Pouze potřebná data
- **Použít checksum** (REST API) pro cache invalidation
- **Index DataSource sloupce** v databázi
- **Minimize Razor complexity** - Heavy logic patří do SQL nebo C# service layer

### 3. Caching Strategy

```javascript
// Client-side caching with checksum
var cache = {};

function loadContent(ident, sectionIdent, params) {
  var cacheKey = ident + "/" + sectionIdent + "/" + JSON.stringify(params);
  var checksum = cache[cacheKey] || "";

  $.get("/PartialRender/" + ident + "/" + sectionIdent,
    { ...params, checksum: checksum },
    function(response) {
      cache[cacheKey] = response.checksum;
      updateUI(response.html);
    }
  ).fail(function(xhr) {
    if (xhr.status === 304) {
      // Content not modified, use cached version
      console.log("Using cached content");
    }
  });
}
```

### 4. Error Handling

```javascript
function loadPartialRender(ident, sectionIdent, params) {
  $.ajax({
    url: "/AjaxAPI/PartialRender/Render",
    data: { ident, sectionIdent, ...params },
    success: function(response) {
      if (response.isError) {
        // Server-side validation errors
        response.errors.forEach(err => {
          console.error(err.key, err.message);
        });
        showErrorMessage("Failed to load content");
      } else {
        $("#container").html(response.html);
      }
    },
    error: function(xhr, status, error) {
      // Network or HTTP errors
      if (xhr.status === 403) {
        showErrorMessage("Access denied");
      } else if (xhr.status === 401) {
        redirectToLogin();
      } else {
        showErrorMessage("Failed to load content: " + error);
      }
    }
  });
}
```

### 5. Testing

```javascript
// Mock endpoint for unit testing
var mockPartialRender = {
  "UserProfileCard": {
    "ProfileCard": {
      html: "<div>Mock User Profile</div>",
      isError: false
    }
  }
};

function loadPartialRender(ident, sectionIdent, params) {
  if (window.TESTING_MODE) {
    return Promise.resolve(mockPartialRender[ident][sectionIdent]);
  }

  return $.ajax({
    url: "/AjaxAPI/PartialRender/Render",
    data: { ident, sectionIdent, ...params }
  });
}
```

---

## Troubleshooting

### Common Issues

**1. "PartialRenderNotFound" Error**
- Ověřte `Ident` v XML
- Zkontrolujte, zda je XML nahrán v Admin UI
- Restartujte aplikaci (XML cache)

**2. "AccessDeny" Error**
- Zkontrolujte `AccessPermissions` na PartialRender i Section level
- Ověřte, že uživatel má požadovaná oprávnění
- Zkontrolujte `DenyPermissions`

**3. "SectionNotFound" Error**
- Ověřte `sectionIdent` v URL
- Zkontrolujte `Section Ident` v XML
- Case-sensitive!

**4. Empty Response**
- Zkontrolujte SQL dotaz v DataSource
- Ověřte parametry (QueryStringData, POSTData)
- Zkontrolujte DataSource `Ident` vs. `Model.Data.{Ident}`

**5. Razor Engine Errors**
- Zkontrolujte `IsRazorEngine="true"`
- Ověřte RazorEngineSetting (Usings, Assemblies)
- Validujte Razor syntax (@, @{ }, @foreach)

**6. JSON Parsing Error**
- Ujistěte se, že `ReturnType="JSON"`
- Ověřte JSON serialization v template
- Použijte `@json` (ne `@(json)`)

---

## XML Validation

**Vždy validujte XML před nahráním:**

```bash
cd XMLValidator
dotnet run -- "path/to/PartialRender.xml"
```

**Common validation errors:**
- Missing `xmlns:xsi` namespace
- Missing `xmlns:dsp` namespace (if using Parameters)
- Invalid `ReturnType` value (must be "HTML" or "JSON")
- Missing CDATA for SQL/HTMLTemplate
- Invalid parameter `xsi:type`

---

## Related Documentation

- [DataSource Parameters](../components/datasource-parameters.md) - Parameter types a configuration
- [HTMLTemplate Syntax](../common/html-template.md) - Template placeholders a FOR loops
- [External Assets](../common/external-assets.md) - JavaScript integration
- [Sections](../common/sections.md) - Section types a configuration
- [Dashboard](dashboard.md) - Using PartialRender in Dashboard widgets

---

## Migration from other-definitions.md

**IMPORTANT:** PartialRender dokumentace byla přesunuta z `other-definitions.md` do samostatného souboru `partialrender.md` kvůli komplexnosti a rozsahu použití.

**Change log:**
- **2026-02-10:** Vytvořena kompletní dokumentace na základě:
  - C# Model: `SFP.Kernel.Model.PartialRender.PartialRender`
  - Controllers: `PartialRenderController` (AjaxAPI + WebAPI)
  - XML Samples: `.ai/sampls/XML/PartialRender/`
