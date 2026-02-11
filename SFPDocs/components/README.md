# SFP Components Documentation

Documentation for creating reusable UI components in SmartFormPlatform.

---

## Overview

**Components** are reusable, configurable UI elements that can be embedded in Dashboard, DataView, Form, and Configuration entities. They combine:
- Server-side XML configuration
- Client-side TypeScript/JavaScript
- CSS styling
- Data loading capabilities

---

## Documentation Files

| File | Description |
|------|-------------|
| [components.md](components.md) | **Main documentation** - Complete guide for component development |
| [datasource-parameters.md](datasource-parameters.md) | **DataSource parameters** - All available parameters in SQL queries |
| [examples.md](examples.md) | Practical component examples (data grid, charts, forms, notifications) |
| [typescript/sfp-components.d.ts](typescript/sfp-components.d.ts) | TypeScript type definitions for component system |

---

## Quick Start

### 1. Create Component Definition (XML)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="MyComponent">

  <CssRelativePaths>
    <string>~/AppAsset/Plugins/Components/MyComponent/css/myComponent.css</string>
  </CssRelativePaths>

  <JavaScriptRelativePaths>
    <string>~/AppAsset/Plugins/Components/MyComponent/js/myComponent.js</string>
  </JavaScriptRelativePaths>

  <Setting>
    <MyConfig Color="Blue" />
  </Setting>

  <Sections>
    <Section xsi:type="ContentSection" Ident="Content">
      <HTMLTemplate><![CDATA[
        <div class="my-component">Hello World</div>
      ]]></HTMLTemplate>
    </Section>
  </Sections>
</Component>
```

### 2. Register in Dashboard/Form/DataView

```xml
<Components>
  <Component Ident="Widget1" ComponentIdent="MyComponent">
    <Setting>
      <MyConfig Color="Red" />
    </Setting>
  </Component>
</Components>

<HTMLTemplate><![CDATA[
  <Component ID="Widget1" />
]]></HTMLTemplate>
```

### 3. Implement TypeScript

```typescript
class MyComponent {
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

        this.initialize();
    }

    private async initialize(): Promise<void> {
        // Load content from server
        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            'Content',
            this.pageInfo
        );

        const url = nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);
        const response = await fetch(url, { method: 'POST' });
        const data = await response.json();

        if (!data.isError) {
            this.element.innerHTML = data.html;
        }
    }

    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>(
            '[data-componentType="MyComponent"]'
        );

        elements.forEach(element => {
            new MyComponent(element);
        });
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    MyComponent.create();
});
```

---

## Key Concepts

### Component Lifecycle

```
1. XML Definition → 2. Registration → 3. Server Rendering → 4. JS Initialization → 5. Data Loading
```

### Where Components Can Be Used

- **Dashboard** - Dynamic widgets
- **DataView** (ContentView) - Custom data visualizations
- **Form** - Embedded UI elements
- **Configuration** - Global components (rendered on all pages)

### Component Features

✅ Custom XML configuration
✅ SQL DataSources
✅ HTML templates (with Razor support)
✅ Translations (i18n)
✅ Access permissions
✅ Settings override
✅ Section override

---

## Examples

See existing components in:
```
/workspace/Components/Sample/WidgetComponent/
```

Files:
- `WidgetComponent.xml` - Component definition
- `js/widgetComponent.js` - JavaScript implementation
- `css/widgetComponent.css` - Styling

---

## API Reference

### AjaxAPI Endpoint

```
POST/GET: AjaxAPI/Component/Render
```

**Query Parameters:**
- `ident` - XML identifier (Dashboard, Form, etc.)
- `componentIdent` - Registration Ident
- `sectionIdent` - Section to render
- `xmlType` - XML type (Dashboard, Form, DataView, Configuration)
- `id` - Record ID (optional, for Form)
- `formIdent` - Form Ident (optional)

**Response (ContentSection):**
```json
{
  "isError": false,
  "errors": [],
  "html": "<div>Rendered HTML</div>"
}
```

**Response (DataSourceSection):**
```json
{
  "isError": false,
  "errors": [],
  "data": [
    { "ID": 1, "Name": "Item 1" }
  ]
}
```

---

## Helper Functions

### nameSpaceCommonHelper

| Function | Description |
|----------|-------------|
| `GetPageInfo(element?)` | Get current page context information |
| `CreateURL(path)` | Create absolute URL from relative path |
| `Base64ToString(base64)` | Decode Base64 to UTF-8 string |

### nameSpaceComponentHelper

| Function | Description |
|----------|-------------|
| `CreatePath(path, componentIdent, sectionIdent, pageInfo)` | Create query string for component API |

---

## Best Practices

✅ **DO:**
- Write TypeScript without jQuery
- Use async/await for AJAX
- Implement error handling
- Cache DOM elements
- Listen to SFP events for dynamic loading

❌ **DON'T:**
- Don't use jQuery (unless necessary)
- Don't hardcode URLs (use helpers)
- Don't ignore errors
- Don't query DOM repeatedly

---

## File Structure

```
AppAsset/Plugins/Components/
├── MyComponent/
│   ├── MyComponent.xml          # Component definition
│   ├── js/
│   │   ├── myComponent.ts       # TypeScript source
│   │   └── myComponent.js       # Compiled JS
│   └── css/
│       └── myComponent.css      # Styles
```

---

## TypeScript Support

Use type definitions for better development experience:

```typescript
/// <reference path="docs/ai/components/typescript/sfp-components.d.ts" />

import {
    ComponentSetting,
    PageInfo,
    ComponentResponse,
    nameSpaceCommonHelper,
    nameSpaceComponentHelper
} from 'sfp-components';
```

---

## Related Documentation

- [XML Conventions](../xml-conventions.md) - XML formatting standards
- [Plugin Development](../plugin-development.md) - Server-side plugin development
- [DataSource](../common/datasource.md) - SQL DataSource configuration
- [Dashboard](../entities/dashboard.md) - Dashboard widgets
- [Form](../entities/form.md) - Form definition

---

## Need Help?

1. Read the [complete documentation](components.md)
2. Check [TypeScript definitions](typescript/sfp-components.d.ts)
3. Review existing examples in `/workspace/Components/`
4. Check component rendering in browser DevTools

---

**Last Updated:** 2026-01-26
