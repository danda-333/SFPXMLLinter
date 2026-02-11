# SFP Component Development Documentation

This documentation describes how to create reusable components for the SFP (Smart Form Platform) system.

---

## Overview

**Components** are reusable UI elements that can be embedded in various SFP entities (Dashboard, DataView, Form, Configuration). They consist of:
- **XML Definition** - component structure, settings, sections
- **JavaScript/TypeScript** - client-side logic and interactions
- **CSS** - styling
- **Server-side rendering** - via AjaxAPI endpoint

Components support:
- Custom configuration via XML
- Data loading from SQL DataSources
- Translations (i18n)
- Access permissions
- Section-based rendering
- Settings override when registering

---

## Table of Contents

1. [Component Architecture](#1-component-architecture)
2. [XML Component Definition](#2-xml-component-definition)
3. [Registering Components](#3-registering-components)
4. [JavaScript/TypeScript Implementation](#4-javascripttypescript-implementation)
5. [Component Rendering](#5-component-rendering)
6. [API Endpoint](#6-api-endpoint)
7. [Helper Functions](#7-helper-functions)
8. [Complete Example](#8-complete-example)
9. [Best Practices](#9-best-practices)

---

## 1. Component Architecture

### 1.1 Component Lifecycle

```
1. XML Definition (Component.xml)
   ↓
2. Registration in Dashboard/Form/DataView/Configuration
   ↓
3. Server-side rendering (HTML with data-* attributes)
   ↓
4. JavaScript initialization (on document.ready)
   ↓
5. Data loading via AjaxAPI/Component/Render
   ↓
6. Event handling and user interaction
```

### 1.2 Component Types

Components can be registered in:

| Entity | Registration Element | Global Component |
|--------|---------------------|------------------|
| **Dashboard** | `<Components>` in Dashboard | No |
| **DataView** | `<Components>` in DataView | No |
| **Form** | `<Components>` in Form | No |
| **Configuration** | `<Components>` in `<ComponentSection>` | Yes (rendered at page end) |

**Global components** (in Configuration) are automatically rendered at the end of every page.

### 1.3 File Structure

```
AppAsset/Plugins/Components/MyComponent/
├── MyComponent.xml              # Component definition
├── js/
│   └── myComponent.ts           # TypeScript implementation
└── css/
    └── myComponent.css          # Component styling
```

---

## 2. XML Component Definition

### 2.1 Component.xml Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:xsd="http://www.w3.org/2001/XMLSchema"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="MyComponent">

  <!-- Access permissions -->
  <AccessPermissions>
    <string>Dashboard</string>
    <string>ProductAdmin</string>
  </AccessPermissions>

  <!-- Deny permissions -->
  <DenyPermissions>
    <string>Guest</string>
  </DenyPermissions>

  <!-- Package dependencies (optional) -->
  <PackageIdents>
    <string>ChartJS</string>
  </PackageIdents>

  <!-- CSS files (relative paths from root) -->
  <CssRelativePaths>
    <string>~/AppAsset/Plugins/Components/MyComponent/css/myComponent.css</string>
  </CssRelativePaths>

  <!-- JavaScript files (relative paths from root) -->
  <JavaScriptRelativePaths>
    <string>~/AppAsset/Plugins/Components/MyComponent/js/myComponent.js</string>
  </JavaScriptRelativePaths>

  <!-- Component settings -->
  <Setting>
    <!-- Custom XML configuration (any structure) -->
    <MyConfig Color="Blue" MaxItems="10">
      <Option Name="ShowTitle" Value="true" />
    </MyConfig>

    <!-- DataSource for settings -->
    <DataSource>
      <SQL><![CDATA[
        SELECT 'Default Value' AS ConfigValue
      ]]></SQL>
    </DataSource>

    <!-- Translations -->
    <Translations>
      <Translation Ident="Title" ResourceKey="MyComponent_Title" />
      <Translation Ident="Description" ResourceKey="MyComponent_Description" />
    </Translations>
  </Setting>

  <!-- Sections -->
  <Sections>
    <!-- Content section - renders HTML -->
    <Section xsi:type="ContentSection" Ident="Content">
      <HTMLTemplate><![CDATA[
        <div class="component-content">
          <h3>[#MyComponent_Title#]</h3>
          <p>Content goes here</p>
        </div>
      ]]></HTMLTemplate>
    </Section>

    <!-- DataSource section - returns JSON data -->
    <Section xsi:type="DataSourceSection" Ident="GetData">
      <DataSource>
        <SQL><![CDATA[
          SELECT TOP 10 ID, Name, Value
          FROM usr.MyTable
          WHERE State != 0
        ]]></SQL>
      </DataSource>
    </Section>
  </Sections>
</Component>
```

### 2.2 Component Model (C#)

**Class:** `SFP.Kernel.Model.Component.Component`

```csharp
public class Component
{
    [XmlAttribute]
    public string Ident { get; set; }

    public List<string> PackageIdents { get; set; }
    public List<string> AccessPermissions { get; set; }
    public List<string> DenyPermissions { get; set; }
    public List<string> CssRelativePaths { get; set; }
    public List<string> JavaScriptRelativePaths { get; set; }

    public ComponentSetting Setting { get; set; }
    public List<Section> Sections { get; set; }
}
```

### 2.3 ComponentSetting Structure

**Class:** `SFP.Kernel.Model.Component.Settings.ComponentSetting`

```csharp
public class ComponentSetting
{
    // Custom XML configuration (any structure)
    [XmlAnyElement]
    public XmlNode XmlContent { get; set; }

    // DataSource for loading settings from DB
    public DataSource DataSource { get; set; }

    // Translations
    public List<Translation> Translations { get; set; }
}
```

### 2.4 Sections

Components support two section types:

#### ContentSection
Renders HTML content (optionally with Razor engine).

```xml
<Section xsi:type="ContentSection" Ident="MySection">
  <Sources>
    <DataSource Ident="Products">
      <SQL><![CDATA[
        SELECT ID, Name, Price FROM usr.Product WHERE State = 1
      ]]></SQL>
    </DataSource>
  </Sources>
  <HTMLTemplate><![CDATA[
    <div class="products">
      [FOR Source="Products"]
        <div class="product">[%Name%]: [%Price%]</div>
      [/FOR]
    </div>
  ]]></HTMLTemplate>
</Section>
```

#### DataSourceSection
Returns JSON data from SQL query.

```xml
<Section xsi:type="DataSourceSection" Ident="GetProducts">
  <DataSource>
    <SQL><![CDATA[
      SELECT ID, Name, Price
      FROM usr.Product
      WHERE State = 1
        AND CategoryID = @CategoryID  -- Parameter from form control or query string
        AND AccountID = @AccountID    -- Parameter from user context (always available)
    ]]></SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CategoryID" DataType="Number" />
    </Parameters>
  </DataSource>
</Section>
```

**Available Parameters:** Components have access to various parameters in SQL queries:
- **User Context**: `@AccountID`, `@LanguageID` (always available)
- **Form Data**: `@ControlIdent` for each form control (when on Form)
- **Request Data**: URL query parameters, POST data
- **Filter Data**: `@DateFrom`, `@DateTo` (when used with filters)

See **[datasource-parameters.md](datasource-parameters.md)** for complete reference of all available parameters.

### 2.5 Translations

```xml
<Translations>
  <Translation Ident="Key1" ResourceKey="ResourceKey_InDB" />
  <Translation Ident="Key2" ResourceKey="AnotherResourceKey" />
</Translations>
```

**Access in JavaScript:**
```typescript
const translation = this.getSetting().Translations.find(t => t.Key1);
```

---

## 3. Registering Components

### 3.1 RegistrationComponent Model (C#)

**Class:** `SFP.Kernel.Model.Component.RegistrationComponent`

```csharp
public class RegistrationComponent
{
    [XmlAttribute]
    public string Ident { get; set; }            // Registration identifier

    [XmlAttribute]
    public string ComponentIdent { get; set; }   // Component definition identifier

    public ComponentSetting Setting { get; set; }  // Override settings
    public List<Section> Sections { get; set; }    // Override sections
}
```

### 3.2 Registration in Dashboard

```xml
<?xml version="1.0" encoding="utf-8"?>
<Dashboard xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="Dashboard">

  <Components>
    <Component Ident="Widget1" ComponentIdent="MyComponent">
      <!-- Override settings -->
      <Setting>
        <MyConfig Color="Red" MaxItems="5" />
        <DataSource>
          <SQL><![CDATA[
            SELECT 'Dashboard Override' AS ConfigValue
          ]]></SQL>
        </DataSource>
        <Translations>
          <Translation Ident="Title" ResourceKey="Dashboard_Widget_Title" />
        </Translations>
      </Setting>

      <!-- Override sections -->
      <Sections>
        <Section xsi:type="ContentSection" Ident="Content">
          <HTMLTemplate><![CDATA[
            <div class="dashboard-widget">
              <h3>Dashboard Widget</h3>
            </div>
          ]]></HTMLTemplate>
        </Section>
      </Sections>
    </Component>
  </Components>

  <HTMLTemplate><![CDATA[
    <div class="row">
      <div class="col-6">
        <!-- Render component -->
        <Component ID="Widget1" />
      </div>
    </div>
  ]]></HTMLTemplate>
</Dashboard>
```

### 3.3 Registration in Form

```xml
<?xml version="1.0" encoding="utf-8"?>
<Form xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      Ident="Product">

  <Components>
    <Component Ident="ProductWidget" ComponentIdent="MyComponent">
      <Setting>
        <MyConfig Color="Green" />
      </Setting>
    </Component>
  </Components>

  <Sections>
    <Section xsi:type="ContentSection" Ident="BasicInfo">
      <HTMLTemplate><![CDATA[
        <div class="row">
          <div class="col-12">
            <Component ID="ProductWidget" />
          </div>
        </div>
      ]]></HTMLTemplate>
    </Section>
  </Sections>
</Form>
```

### 3.4 Registration in DataView (ContentView)

```xml
<?xml version="1.0" encoding="utf-8"?>
<DataView xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          Ident="ProductContentView"
          ViewType="ContentView">

  <Components>
    <Component Ident="ProductList" ComponentIdent="MyComponent" />
  </Components>

  <HTMLTemplate><![CDATA[
    <div class="content-view">
      <Component ID="ProductList" />
    </div>
  ]]></HTMLTemplate>
</DataView>
```

### 3.5 Global Component (Configuration)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Configuration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               Ident="Configuration">

  <Sections>
    <Section xsi:type="ComponentSection">
      <Components>
        <Component Ident="GlobalWidget" ComponentIdent="MyComponent">
          <Setting>
            <MyConfig IsGlobal="true" />
          </Setting>
        </Component>
      </Components>
    </Section>
  </Sections>
</Configuration>
```

**Important:** Global components are rendered automatically at page end. No need for `<Component ID="..." />` tag.

---

## 4. JavaScript/TypeScript Implementation

### 4.1 Component Class Structure

**IMPORTANT: Use TypeScript without jQuery.**

```typescript
// myComponent.ts

/**
 * MyComponent - Reusable component example
 */
class MyComponent {
    private element: HTMLElement;
    private setting: ComponentSetting;
    private pageInfo: PageInfo;

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = this.parseSetting();
        this.pageInfo = nameSpaceCommonHelper.GetPageInfo(this.element);

        this.initialize();
    }

    /**
     * Parse component settings from data-setting attribute
     */
    private parseSetting(): ComponentSetting {
        const dataAttr = this.element.getAttribute('data-setting');
        if (!dataAttr) {
            throw new Error('Component setting not found');
        }

        const settingJson = nameSpaceCommonHelper.Base64ToString(dataAttr);
        return JSON.parse(settingJson);
    }

    /**
     * Initialize component
     */
    private initialize(): void {
        // Check if this is a global component
        const isGlobal = this.setting.Config?.MyConfig?.['@IsGlobal'] === 'true';

        if (!isGlobal) {
            this.createUI();
            this.loadContent();
            this.loadData();
        } else {
            this.loadGlobalContent();
        }
    }

    /**
     * Create component UI
     */
    private createUI(): void {
        const color = this.setting.Config?.MyConfig?.['@Color'] || 'blue';
        const title = this.getTranslation('Title');

        this.element.innerHTML = `
            <div class="card" style="border-color: ${color}">
                <div class="card-header">
                    ${title}
                </div>
                <div class="card-body">
                    Loading...
                </div>
            </div>
        `;
    }

    /**
     * Get translation by identifier
     */
    private getTranslation(ident: string): string {
        const translation = this.setting.Translations?.find(t => t[ident]);
        return translation ? translation[ident] : '';
    }

    /**
     * Load content from ContentSection
     */
    private async loadContent(): Promise<void> {
        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            'Content',
            this.pageInfo
        );

        const formData = this.getFormData();

        try {
            const response = await this.ajaxRequest<ComponentResponse>(path, formData);

            if (response.isError) {
                this.handleError(response.errors);
                return;
            }

            const cardBody = this.element.querySelector('.card-body');
            if (cardBody) {
                cardBody.innerHTML = response.html;
            }
        } catch (error) {
            console.error('Load content error:', error);
            this.handleError(['Failed to load content']);
        }
    }

    /**
     * Load data from DataSourceSection
     */
    private async loadData(): Promise<void> {
        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            'GetData',
            this.pageInfo
        );

        const formData = this.getFormData();

        try {
            const response = await this.ajaxRequest<DataSourceResponse>(path, formData);

            if (response.isError) {
                this.handleError(response.errors);
                return;
            }

            console.log('Data loaded:', response.data);
            // Process data...
        } catch (error) {
            console.error('Load data error:', error);
        }
    }

    /**
     * Load content for global component
     */
    private async loadGlobalContent(): Promise<void> {
        const pageInfo: PageInfo = {
            xmlType: 'Configuration',
            ident: 'Configuration'
        };

        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            'Content',
            pageInfo
        );

        try {
            const response = await this.ajaxRequest<ComponentResponse>(path, null);

            if (!response.isError) {
                console.log('Global content loaded:', response.html);
            }
        } catch (error) {
            console.error('Load global content error:', error);
        }
    }

    /**
     * Get form data (for Form context)
     */
    private getFormData(): FormData | null {
        if (this.pageInfo.xmlType !== 'Form') {
            return null;
        }

        const formSelector = this.pageInfo.isSubForm
            ? this.pageInfo.subForm.formSelector
            : this.pageInfo.formSelector;

        const formElement = document.querySelector<HTMLFormElement>(formSelector);
        return formElement ? new FormData(formElement) : null;
    }

    /**
     * Create absolute URL
     */
    private createURL(path: string): string {
        return nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);
    }

    /**
     * AJAX request helper
     */
    private async ajaxRequest<T>(path: string, formData: FormData | null): Promise<T> {
        const response = await fetch(this.createURL(path), {
            method: 'POST',
            body: formData,
            headers: formData ? {} : { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Handle errors
     */
    private handleError(errors: string[]): void {
        errors.forEach(error => console.error(error));

        const cardBody = this.element.querySelector('.card-body');
        if (cardBody) {
            cardBody.innerHTML = '<div class="alert alert-danger">Error loading component</div>';
        }
    }

    /**
     * Static factory method - creates all components on page
     */
    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>('[data-componentType="MyComponent"]');

        elements.forEach(element => {
            new MyComponent(element);
        });
    }
}

// Initialize on document ready
document.addEventListener('DOMContentLoaded', () => {
    MyComponent.create();

    // Register for dynamic content loading
    const pageInfo = nameSpaceCommonHelper.GetPageInfo();

    if (pageInfo.xmlType === 'Dashboard') {
        document.getElementById('sfpContent')?.addEventListener('sfp.load', (e) => {
            MyComponent.create(e.target as HTMLElement);
        });

        document.querySelectorAll('.tab-pane').forEach(tab => {
            tab.addEventListener('sfp.load', (e) => {
                MyComponent.create(e.target as HTMLElement);
            });
        });
    } else if (pageInfo.xmlType === 'DataView') {
        document.getElementById('dataTable')?.addEventListener('sfp.load', (e) => {
            MyComponent.create(e.target as HTMLElement);
        });
    } else if (pageInfo.xmlType === 'Form') {
        document.querySelectorAll('.js-subFormList').forEach(subForm => {
            subForm.addEventListener('sfp.formInit', () => {
                const dialog = document.getElementById('sfpSubFormDialog');
                if (dialog) {
                    MyComponent.create(dialog);
                }
            });
        });
    }
});
```

### 4.2 TypeScript Interfaces

See [typescript/sfp-components.d.ts](typescript/sfp-components.d.ts) for complete type definitions.

### 4.3 Component Settings Structure

```typescript
interface ComponentSetting {
    Config: {
        [key: string]: any;  // Custom XML config (XmlContent)
    };
    DataSource?: {
        // DataSource results
    };
    Translations: Array<{
        [ident: string]: string;  // Translation key-value pairs
    }>;
}
```

**Example settings object:**
```typescript
{
    "Config": {
        "MyConfig": {
            "@Color": "Blue",
            "@MaxItems": "10",
            "Option": {
                "@Name": "ShowTitle",
                "@Value": "true"
            }
        }
    },
    "Translations": [
        { "Title": "My Component Title" },
        { "Description": "Component description text" }
    ]
}
```

---

## 5. Component Rendering

### 5.1 Server-side HTML Output

When a component is rendered, the system generates:

```html
<div id="Widget1"
     data-componentType="MyComponent"
     data-setting="eyJDb25maWciO...">
</div>
```

**Attributes:**
- `id` - Registration Ident (from `<Component Ident="Widget1" />`)
- `data-componentType` - Component Ident (from `ComponentIdent="MyComponent"`)
- `data-setting` - Base64-encoded JSON with merged settings (base + override)

### 5.2 Settings Merge Priority

Settings are merged in this order (later overrides earlier):

1. **Base Component** (`Component.xml` → `<Setting>`)
2. **Registration Override** (`Dashboard.xml` → `<Component><Setting>`)

**Example:**

**Base Component (MyComponent.xml):**
```xml
<Setting>
  <MyConfig Color="Blue" MaxItems="10" />
  <Translations>
    <Translation Ident="Title" ResourceKey="BaseTitle" />
  </Translations>
</Setting>
```

**Registration (Dashboard.xml):**
```xml
<Component Ident="Widget1" ComponentIdent="MyComponent">
  <Setting>
    <MyConfig Color="Red" />
    <Translations>
      <Translation Ident="Title" ResourceKey="DashboardTitle" />
    </Translations>
  </Setting>
</Component>
```

**Merged Result:**
```json
{
  "Config": {
    "MyConfig": {
      "@Color": "Red",        // Overridden
      "@MaxItems": "10"       // From base
    }
  },
  "Translations": [
    { "Title": "Dashboard Title" }  // Overridden
  ]
}
```

### 5.3 Sections Override

Sections are overridden by **Ident**:

```xml
<!-- Base Component -->
<Sections>
  <Section xsi:type="ContentSection" Ident="Content">
    <HTMLTemplate>Base content</HTMLTemplate>
  </Section>
  <Section xsi:type="DataSourceSection" Ident="GetData">
    <DataSource>...</DataSource>
  </Section>
</Sections>

<!-- Registration Override -->
<Sections>
  <Section xsi:type="ContentSection" Ident="Content">
    <HTMLTemplate>Dashboard content</HTMLTemplate>
  </Section>
  <!-- GetData section not overridden, uses base -->
</Sections>
```

---

## 6. API Endpoint

### 6.1 Endpoint URL

```
POST/GET: AjaxAPI/Component/Render
```

### 6.2 Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ident` | Yes | XML identifier (Dashboard, Form, Configuration, etc.) |
| `componentIdent` | Yes | Registration Ident (from `<Component Ident="..."/>`) |
| `sectionIdent` | Yes | Section Ident to render (from `<Section Ident="..."/>`) |
| `xmlType` | Yes | XML type (`Dashboard`, `Form`, `DataView`, `Configuration`) |
| `id` | No | Record ID (for Form context) |
| `formIdent` | No | Form Ident (for access validation) |
| `tableID` | No | TableID (for access validation) |
| `formUniqueRandomIdent` | No | Unique form identifier (for Form context) |

### 6.3 Request Example

```
POST AjaxAPI/Component/Render?ident=Dashboard&componentIdent=Widget1&sectionIdent=Content&xmlType=Dashboard
```

### 6.4 Response Format

**ContentSection Response:**
```json
{
  "isError": false,
  "errors": [],
  "html": "<div>Rendered HTML content</div>"
}
```

**DataSourceSection Response:**
```json
{
  "isError": false,
  "errors": [],
  "data": [
    { "ID": 1, "Name": "Product 1", "Price": 100.00 },
    { "ID": 2, "Name": "Product 2", "Price": 200.00 }
  ]
}
```

**Error Response:**
```json
{
  "isError": true,
  "errors": [
    "Access denied",
    "Section not found"
  ]
}
```

---

## 7. Helper Functions

### 7.1 nameSpaceCommonHelper

#### GetPageInfo(element?)

Returns information about the current page context.

```typescript
interface PageInfo {
    xmlType: 'Dashboard' | 'DataView' | 'Form' | 'Configuration';
    ident: string;
    tableID?: number;
    formUniqueRandomIdent?: string;
    formSelector?: string;
    isSubForm: boolean;
    subForm?: {
        ident: string;
        tableID?: number;
        formUniqueRandomIdent?: string;
        formSelector: string;
    };
}

// Usage
const pageInfo = nameSpaceCommonHelper.GetPageInfo();
console.log(pageInfo.xmlType);  // 'Dashboard'
console.log(pageInfo.ident);    // 'Dashboard'
```

#### CreateURL(path)

Creates absolute URL from relative path.

```typescript
const url = nameSpaceCommonHelper.CreateURL('AjaxAPI/Component/Render?ident=Dashboard');
// Returns: https://domain.com/AjaxAPI/Component/Render?ident=Dashboard
```

#### Base64ToString(base64)

Decodes Base64 string to UTF-8 string.

```typescript
const decoded = nameSpaceCommonHelper.Base64ToString(base64String);
```

### 7.2 nameSpaceComponentHelper

#### CreatePath(existingPath, componentIdent, sectionIdent, pageInfo)

Creates query parameter string for component API endpoint.

```typescript
const path = nameSpaceComponentHelper.CreatePath(
    '',                    // existing query parameters
    'Widget1',             // componentIdent
    'Content',             // sectionIdent
    pageInfo               // PageInfo object
);

// Returns: ?ident=Dashboard&componentIdent=Widget1&sectionIdent=Content&xmlType=Dashboard
```

**Parameters:**
- `existingPath` - Existing query parameters (or empty string)
- `componentIdent` - Registration Ident
- `sectionIdent` - Section Ident to render
- `pageInfo` - PageInfo object from `GetPageInfo()`

---

## 8. Complete Example

### 8.1 WidgetComponent.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:xsd="http://www.w3.org/2001/XMLSchema"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="WidgetComponent">

  <AccessPermissions>
    <string>Dashboard</string>
  </AccessPermissions>

  <CssRelativePaths>
    <string>~/AppAsset/Plugins/Components/WidgetComponent/css/widgetComponent.css</string>
  </CssRelativePaths>

  <JavaScriptRelativePaths>
    <string>~/AppAsset/Plugins/Components/WidgetComponent/js/widgetComponent.js</string>
  </JavaScriptRelativePaths>

  <Setting>
    <WidgetConfig Color="Red" />

    <DataSource>
      <SQL><![CDATA[
        SELECT 'Jan Nemec' AS FullName
      ]]></SQL>
    </DataSource>

    <Translations>
      <Translation Ident="Key1" ResourceKey="Preklad1" />
      <Translation Ident="Key2" ResourceKey="Preklad2" />
    </Translations>
  </Setting>

  <Sections>
    <Section xsi:type="ContentSection" Ident="Content">
      <HTMLTemplate><![CDATA[
        <b>Content</b>
      ]]></HTMLTemplate>
    </Section>

    <Section xsi:type="DataSourceSection" Ident="Account">
      <DataSource>
        <SQL><![CDATA[
          SELECT TOP 10 ID, FullName
          FROM dbo.Account
        ]]></SQL>
      </DataSource>
    </Section>
  </Sections>
</Component>
```

### 8.2 Dashboard Registration

```xml
<?xml version="1.0" encoding="utf-8"?>
<Dashboard Ident="Dashboard">

  <Components>
    <Component Ident="Widget1" ComponentIdent="WidgetComponent">
      <Setting>
        <WidgetConfig Color="Blue" />
        <DataSource>
          <SQL><![CDATA[
            SELECT 'Override Name' AS FullName
          ]]></SQL>
        </DataSource>
        <Translations>
          <Translation Ident="Key1" ResourceKey="PRETIZENI" />
        </Translations>
      </Setting>
      <Sections>
        <Section xsi:type="ContentSection" Ident="Content">
          <HTMLTemplate><![CDATA[
            <b>Dashboard Override Content</b>
          ]]></HTMLTemplate>
        </Section>
      </Sections>
    </Component>
  </Components>

  <HTMLTemplate><![CDATA[
    <div class="row">
      <div class="col-12">
        <Component ID="Widget1" />
      </div>
    </div>
  ]]></HTMLTemplate>
</Dashboard>
```

### 8.3 TypeScript Implementation

```typescript
class WidgetComponent {
    private element: HTMLElement;
    private setting: any;
    private pageInfo: any;

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = JSON.parse(
            nameSpaceCommonHelper.Base64ToString(
                element.getAttribute('data-setting') || ''
            )
        );
        this.pageInfo = nameSpaceCommonHelper.GetPageInfo(element);

        if (this.setting.Config.WidgetConfig?.['@IsGlobal'] !== 'true') {
            this.createBox();
            this.loadContent();
            this.loadTestDataSource();
        } else {
            this.globalContent();
        }
    }

    private createBox(): void {
        const color = this.setting.Config.WidgetConfig?.['@Color'] || 'red';
        const key1 = this.getTranslation('Key1');

        this.element.innerHTML = `
            <div class="card" style="border-color: ${color}">
                <div class="card-footer text-right">
                    ${key1}
                </div>
                <div class="card-body">
                    Loading...
                </div>
            </div>
        `;
    }

    private getTranslation(ident: string): string {
        const result = this.setting.Translations?.find((t: any) => t[ident]);
        return result ? result[ident] : '';
    }

    private async loadContent(): Promise<void> {
        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            'Content',
            this.pageInfo
        );

        const formData = this.getFormData();

        try {
            const response = await fetch(this.createURL(path), {
                method: 'POST',
                body: formData || undefined
            });

            const data = await response.json();

            if (data.isError) {
                data.errors.forEach((err: string) => console.error(err));
                this.element.querySelector('.card-body')!.innerHTML = 'Error...';
                return;
            }

            this.element.querySelector('.card-body')!.innerHTML = data.html;
        } catch (error) {
            console.error(error);
            this.element.querySelector('.card-body')!.innerHTML = 'Error...';
        }
    }

    private async loadTestDataSource(): Promise<void> {
        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            'Account',
            this.pageInfo
        );

        const formData = this.getFormData();

        try {
            const response = await fetch(this.createURL(path), {
                method: 'POST',
                body: formData || undefined
            });

            const data = await response.json();

            if (data.isError) {
                data.errors.forEach((err: string) => console.error(err));
                return;
            }

            console.log('Account data:', data.data);
        } catch (error) {
            console.error(error);
        }
    }

    private async globalContent(): Promise<void> {
        const pageInfo = {
            xmlType: 'Configuration',
            ident: 'Configuration'
        };

        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            'Content',
            pageInfo
        );

        try {
            const response = await fetch(this.createURL(path), { method: 'POST' });
            const data = await response.json();

            if (!data.isError) {
                console.log('Global content:', data.html);
            }
        } catch (error) {
            console.error(error);
        }
    }

    private getFormData(): FormData | null {
        if (this.pageInfo.xmlType !== 'Form') {
            return null;
        }

        const selector = this.pageInfo.isSubForm
            ? this.pageInfo.subForm.formSelector
            : this.pageInfo.formSelector;

        const form = document.querySelector<HTMLFormElement>(selector);
        return form ? new FormData(form) : null;
    }

    private createURL(path: string): string {
        return nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);
    }

    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>(
            '[data-componentType="WidgetComponent"]'
        );

        elements.forEach(element => {
            new WidgetComponent(element);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    WidgetComponent.create();

    const pageInfo = nameSpaceCommonHelper.GetPageInfo();

    if (pageInfo.xmlType === 'Dashboard') {
        document.getElementById('sfpContent')?.addEventListener('sfp.load', (e) => {
            WidgetComponent.create(e.target as HTMLElement);
        });

        document.querySelectorAll('.tab-pane').forEach(tab => {
            tab.addEventListener('sfp.load', (e) => {
                WidgetComponent.create(e.target as HTMLElement);
            });
        });
    } else if (pageInfo.xmlType === 'DataView') {
        document.getElementById('dataTable')?.addEventListener('sfp.load', (e) => {
            WidgetComponent.create(e.target as HTMLElement);
        });
    } else if (pageInfo.xmlType === 'Form') {
        document.querySelectorAll('.js-subFormList').forEach(subForm => {
            subForm.addEventListener('sfp.formInit', () => {
                const dialog = document.getElementById('sfpSubFormDialog');
                if (dialog) {
                    WidgetComponent.create(dialog);
                }
            });
        });
    }
});
```

### 8.4 CSS Styling

```css
/* widgetComponent.css */

[data-componentType="WidgetComponent"] .card {
    border-width: 3px;
    border-style: solid;
    margin-bottom: 1rem;
}

[data-componentType="WidgetComponent"] .card-header {
    font-weight: 600;
    text-transform: uppercase;
}

[data-componentType="WidgetComponent"] .card-body {
    min-height: 100px;
}
```

---

## 9. Best Practices

### 9.1 Code Quality

✅ **DO:**
- Write components in **TypeScript** without jQuery
- Use **async/await** for AJAX requests
- Use **fetch API** instead of XMLHttpRequest
- Implement proper **error handling**
- Use **CSS classes** for styling, not inline styles (except dynamic values)
- Create **static factory method** for component initialization
- Listen to **SFP events** for dynamic content loading

❌ **DON'T:**
- Don't use jQuery (unless absolutely necessary)
- Don't use global variables
- Don't hardcode URLs (use `CreateURL`)
- Don't hardcode translations (use `<Translations>`)
- Don't ignore errors

### 9.2 Performance

✅ **DO:**
- Cache DOM elements in constructor
- Use **event delegation** for dynamic elements
- Debounce frequent API calls
- Use `globalLoaderIgnore: true` for background requests

❌ **DON'T:**
- Don't query DOM repeatedly (cache references)
- Don't create components multiple times for same element
- Don't make unnecessary API requests

### 9.3 Security

✅ **DO:**
- Use `AccessPermissions` and `DenyPermissions` in XML
- Validate user input in JavaScript
- Encode HTML output (use textContent or sanitize)
- Use HTTPS for production

❌ **DON'T:**
- Don't trust client-side data
- Don't expose sensitive information in settings
- Don't use `innerHTML` with user input (XSS risk)

### 9.4 Maintainability

✅ **DO:**
- Follow SFP naming conventions
- Document complex logic with comments
- Use meaningful variable names
- Split large components into smaller methods
- Create reusable helper functions

❌ **DON'T:**
- Don't create monolithic components
- Don't duplicate code across components
- Don't use magic numbers (use constants)

### 9.5 File Organization

```
AppAsset/Plugins/Components/
├── MyComponent/
│   ├── MyComponent.xml          # Component definition
│   ├── js/
│   │   ├── myComponent.ts       # TypeScript source
│   │   └── myComponent.js       # Compiled JavaScript
│   └── css/
│       └── myComponent.css      # Component styles
```

### 9.6 Debugging

**Enable console logging:**
```typescript
console.log('Component initialized', this.setting);
console.log('Page info', this.pageInfo);
console.log('API response', response);
```

**Check data attributes:**
```typescript
console.log('Element ID:', this.element.id);
console.log('Component type:', this.element.getAttribute('data-componentType'));
console.log('Settings:', this.element.getAttribute('data-setting'));
```

**Network debugging:**
- Use browser DevTools Network tab
- Check request/response for `AjaxAPI/Component/Render`
- Verify query parameters

### 9.7 Asset Management

**Important:** JS and CSS files are automatically deduplicated by path (before `?` character).

```xml
<!-- These are considered the same file: -->
<string>~/AppAsset/Plugins/Components/MyComponent/js/myComponent.js</string>
<string>~/AppAsset/Plugins/Components/MyComponent/js/myComponent.js?v=1.0</string>

<!-- Only loaded once per page -->
```

### 9.8 Testing

✅ **Test in all contexts:**
- Dashboard (with tabs)
- DataView (ContentView)
- Form (with SubForms)
- Configuration (global components)

✅ **Test overrides:**
- Settings override
- Sections override
- Translations override

✅ **Test permissions:**
- AccessPermissions
- DenyPermissions
- Data permissions

---

## Summary

**Components** provide a powerful way to create reusable UI elements in SFP. Key points:

1. **XML Definition** - Define structure, settings, sections in XML
2. **Registration** - Register in Dashboard, Form, DataView, or Configuration
3. **TypeScript Implementation** - Client-side logic without jQuery
4. **Server-side Rendering** - AjaxAPI endpoint for content/data
5. **Override Support** - Settings and sections can be overridden per registration
6. **Context Awareness** - Components adapt to Dashboard, Form, DataView contexts
7. **Event Integration** - Listen to SFP events for dynamic loading

For TypeScript definitions, see [typescript/sfp-components.d.ts](typescript/sfp-components.d.ts).

---

**Next Steps:**
- See [datasource-parameters.md](datasource-parameters.md) for available SQL parameters
- See [examples.md](examples.md) for practical component examples
- Check existing components in `AppAsset/Plugins/Components/`
- Review TypeScript definitions in [typescript/](typescript/)
