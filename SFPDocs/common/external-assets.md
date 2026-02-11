# External Assets (JavaScript & CSS)

SmartFormPlatform umožňuje přidávat vlastní JavaScript a CSS soubory k formulářům, DataViews, Dashboard a dalším entitám.

---

## Konfigurace v XML

### ExternalJavaScriptRelativePaths

Přidá vlastní JavaScript soubory k entitě:

```xml
<Form Ident="Product" ...>
  <ExternalJavaScriptRelativePaths>
    <string>~/AppAsset/Scripts/Product.js</string>
    <string>~/AppAsset/Scripts/ProductValidation.js?v=20240115</string>
  </ExternalJavaScriptRelativePaths>
  ...
</Form>
```

### ExternalCssRelativePaths

Přidá vlastní CSS styly k entitě:

```xml
<Form Ident="Product" ...>
  <ExternalCssRelativePaths>
    <string>~/AppAsset/Styles/Product.css</string>
  </ExternalCssRelativePaths>
  ...
</Form>
```

### Podporované entity

| Entita | ExternalJavaScriptRelativePaths | ExternalCssRelativePaths |
|--------|--------------------------------|--------------------------|
| Form | ✅ | ✅ |
| DataView | ✅ | ✅ |
| Dashboard | ✅ | ✅ |
| Report | ✅ | ✅ |
| Configuration (Global) | ✅ | ✅ |

---

## Umístění souborů

Soubory se ukládají do:
```
/AppAsset/
├── Scripts/
│   ├── ModuleName.js
│   └── ModuleNameValidation.js
└── Styles/
    └── ModuleName.css
```

Cesta `~/` odkazuje na kořen aplikace.

**Verzování:** Pro cache-busting přidejte query string:
```xml
<string>~/AppAsset/Scripts/Product.js?v=20240115</string>
```

---

## SFP JavaScript API

### Dostupné Namespace

| Namespace | Popis |
|-----------|-------|
| `nameSpaceCommonHelper` | Pomocné funkce (URL, ViewState, atd.) |
| `nameSpaceViewState` | Přístup k ViewState hodnotám |
| `nameSpaceDependenceComponent` | Práce se závislostmi mezi controls |
| `nameSpaceSubFormComponent` | SubForm komponenta |
| `nameSpaceFileComponent` | File upload komponenta |
| `nameSpaceReportDetail` | Report detail |
| `nameSpaceFormDialogComponent` | Modální dialogy |

### Callback funkce

Systém poskytuje callback hooks, které můžete přepsat:

```javascript
// SubForm - voláno po inicializaci SubForm
nameSpaceSubFormComponent.InitCallBack = function(element) {
    console.log("SubForm initialized", element);
};

// FileControl - voláno po úspěšném uploadu
nameSpaceFileComponent.UploadDoneCallBack = function(element) {
    console.log("File uploaded", element);
    // Např. refresh PDF preview
    nameSpaceCustomIFramePDFControl.Load($(element).attr("id"));
};

// Report - voláno po načtení detailu
nameSpaceReportDetail.DetailInitCallBack = function() {
    console.log("Report loaded");
};
```

### SFP Události (jQuery Events)

| Událost | Popis | Příklad |
|---------|-------|---------|
| `sfp.load` | Obsah byl načten | `$("#sfpContent").on("sfp.load", fn)` |
| `sfp.reload` | Komponenta byla přenačtena | `$("#SubFormIdent").on("sfp.reload", fn)` |
| `sfp.send` | Data byla odeslána | `$("#dialog").on("sfp.send", fn)` |
| `sfp.change` | Hodnota se změnila | `$("#ControlIdent").on("sfp.change", fn)` |

**Příklad použití:**

```javascript
$(document).ready(function() {
    // Reagovat na přenačtení SubFormu
    $("#StockMovementItemSubForm").on("sfp.reload", function(e) {
        console.log("Items reloaded");
        recalculateTotal();
    });

    // Reagovat na načtení obsahu
    $("#sfpContent").on("sfp.load", function() {
        initCustomComponents();
    });
});
```

### Pomocné funkce

```javascript
// Vytvoření URL
var url = nameSpaceCommonHelper.CreateURL("Form/Detail/Product/123");

// Přidání parametru do URL
url = nameSpaceCommonHelper.AddURLParameter(url, "backUrl", "~/DataView/Index/ProductAllView");

// Získání ViewState hodnoty
var viewStateIdent = nameSpaceCommonHelper.GetViewStateIdent($element);
var value = nameSpaceViewState.ViewState("SomeKey", viewStateIdent);

// Trigger změny závislosti
var fnc = nameSpaceDependenceComponent.Change.bind($("#ControlIdent"));
fnc();
```

### Přístup k formulářovým prvkům

```javascript
// Získání hodnoty inputu
var value = $("#ControlIdent").val();

// Získání hodnoty z AutoComplete (zobrazený text)
var text = $("#ControlIdentText").val();

// Nastavení hodnoty
$("#ControlIdent").val("newValue").trigger("change");

// Získání formuláře
var $form = $("#ControlIdent").closest("form");

// Získání TableID (ID záznamu)
var tableID = $form.attr("data-tableid");

// FormUniqueRandomIdent pro AJAX
var formUniqueRandomIdent = $("#FormUniqueRandomIdent", $form).val();
```

---

## Příklady

### 1. Základní JavaScript pro formulář

```javascript
// Product.js
$(document).ready(function() {
    // Inicializace při načtení
    initProductForm();

    // Reakce na změnu kategorie
    $("#CategoryID").on("change", function() {
        updateCategoryDependentFields();
    });
});

function initProductForm() {
    console.log("Product form initialized");
}

function updateCategoryDependentFields() {
    var categoryId = $("#CategoryID").val();
    // Custom logika...
}
```

### 2. SubForm s přepočtem součtu

```javascript
// StockMovement.js
$(document).ready(function() {
    // Přepočítat při změně položek
    $("#StockMovementItemSubForm").on("sfp.reload", recalculateTotal);

    // Inicializace
    recalculateTotal();
});

function recalculateTotal() {
    var total = 0;
    $("#StockMovementItemSubForm tbody tr").each(function() {
        var quantity = parseFloat($(this).find("td:eq(2)").text()) || 0;
        var price = parseFloat($(this).find("td:eq(3)").text()) || 0;
        total += quantity * price;
    });

    $("#TotalAmount").val(total.toFixed(2));
}
```

### 3. Custom callback pro FileControl

```javascript
// Invoice.js
nameSpaceFileComponent.UploadDoneCallBack = function(element) {
    console.log("File uploaded to:", $(element).attr("id"));

    // Refresh PDF preview v iframe
    refreshPDFPreview($(element).attr("id"));
};

function refreshPDFPreview(controlIdent) {
    var $element = $("#" + controlIdent);
    var viewStateIdent = nameSpaceCommonHelper.GetViewStateIdent($element);
    var url = nameSpaceViewState.ViewState("PreviewPDFControlUrl", viewStateIdent);
    url = nameSpaceCommonHelper.AddURLParameter(url, "controlIdent", controlIdent);

    $("#PDFPreviewIFrame").attr("src", url).show();
}
```

### 4. AJAX volání na PartialRender

```javascript
// CustomAjax.js
function loadPartialData() {
    var $form = $("form").first();
    var formData = new FormData($form[0]);
    var tableID = $form.attr("data-tableid");
    var formUniqueRandomIdent = $("#FormUniqueRandomIdent", $form).val();

    $.ajax({
        url: nameSpaceCommonHelper.CreateURL(
            `AjaxAPI/PartialRender/RenderWithFormData?` +
            `Ident=MyPartialRender&sectionIdent=DataSection&` +
            `formIdent=Product&tableID=${tableID}&` +
            `formUniqueRandomIdent=${formUniqueRandomIdent}`
        ),
        type: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function(data) {
            if (data.isError) {
                console.error(data);
            } else {
                $("#customDataContainer").html(data);
            }
        }
    });
}
```

### 5. ShowHide pomocí CSS tříd (spolupráce s WorkFlow JavaScript)

```javascript
// V WorkFlow XML definujte:
// <JavaScript xsi:type="ShowHide" Ident="ShowAdvanced" ControlIdent="ShowAdvancedOptions">
//   <Selectors><string>.js-showAdvanced</string></Selectors>
//   <ShowValues><string>1</string></ShowValues>
// </JavaScript>

// V HTMLTemplate:
// <div class="js-showAdvanced" style="display: none;">
//   ...advanced fields...
// </div>

// V JS můžete programově změnit:
$(document).ready(function() {
    // Trigger ShowHide při načtení
    var fnc = nameSpaceDependenceComponent.Change.bind($("#ShowAdvancedOptions"));
    fnc();
});
```

---

## CSS Styly

### Základní struktura

```css
/* Product.css */

/* Formulářové styly */
#ProductForm .custom-field {
    border: 1px solid #ddd;
    padding: 10px;
}

/* Grid styling */
#ProductAllView .highlight-row {
    background-color: #fff3cd;
}

/* Responzivní úpravy */
@media (max-width: 768px) {
    #ProductForm .col-md-4 {
        margin-bottom: 15px;
    }
}
```

### Přepsání výchozích stylů

```css
/* Custom dropdown styling */
.select2-container--default .select2-selection--single {
    border-radius: 4px;
}

/* Custom button colors */
.btn-custom-primary {
    background-color: #4a90a4;
    border-color: #4a90a4;
}

/* SubForm table */
[data-controltype="SubFormControl"] table {
    font-size: 0.9rem;
}
```

---

## Globální CSS v Configuration

V Configuration.xml lze definovat globální CSS pro celou aplikaci:

```xml
<Section xsi:type="SettingSection">
  <Global ...>
    <ExternalCssRelativePaths>
      <string>~/AppAsset/Styles/global.css</string>
      <string>~/AppAsset/Styles/branding.css</string>
    </ExternalCssRelativePaths>
  </Global>
</Section>
```

---

## Best Practices

1. **Verzování** - Vždy přidávejte verzi do URL pro cache-busting
2. **Namespace** - Zabalte kód do vlastního namespace pro prevenci konfliktů
3. **Document.ready** - Vždy inicializujte v `$(document).ready()`
4. **Události** - Používejte SFP události místo přímých DOM událostí kde je to možné
5. **Selektory** - Používejte ID selektory (např. `#ControlIdent`) pro rychlost
6. **CSS prefix** - Používejte vlastní prefix pro CSS třídy (např. `.mymodule-*`)

```javascript
// Doporučená struktura
var nameSpaceMyModule = {
    Init: function() {
        // Inicializace
    },
    CustomFunction: function() {
        // Custom logika
    }
};

$(document).ready(function() {
    nameSpaceMyModule.Init();
});
```
