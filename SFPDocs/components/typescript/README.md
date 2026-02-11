# TypeScript Support for SFP Components

This directory contains TypeScript type definitions and configuration examples for developing SFP components.

---

## Files

| File | Description |
|------|-------------|
| [sfp-components.d.ts](sfp-components.d.ts) | TypeScript type definitions for SFP component system |
| [tsconfig.example.json](tsconfig.example.json) | Example TypeScript compiler configuration |

---

## Using Type Definitions

### Option 1: Reference in TypeScript Files

Add a reference at the top of your component TypeScript file:

```typescript
/// <reference path="path/to/sfp-components.d.ts" />

class MyComponent {
    private element: HTMLElement;
    private setting: ComponentSetting;
    private pageInfo: PageInfo;

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = JSON.parse(
            nameSpaceCommonHelper.Base64ToString(
                element.getAttribute('data-setting') || ''
            )
        );
        this.pageInfo = nameSpaceCommonHelper.GetPageInfo(element);
    }
}
```

### Option 2: Include in tsconfig.json

Add the type definition file to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "ES2015",
    "strict": true
  },
  "include": [
    "src/**/*.ts",
    "path/to/sfp-components.d.ts"
  ]
}
```

### Option 3: Global Declaration (Recommended)

Place `sfp-components.d.ts` in your project's `@types` directory or a `typings` directory and reference it in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "typeRoots": [
      "./node_modules/@types",
      "./typings"
    ]
  }
}
```

---

## TypeScript Compiler Setup

### 1. Install TypeScript

```bash
npm install -g typescript
```

Or locally in your project:

```bash
npm install --save-dev typescript
```

### 2. Create tsconfig.json

Copy `tsconfig.example.json` to your component directory and adjust paths:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "ES2015",
    "outDir": "./js",
    "sourceMap": true,
    "strict": true
  },
  "include": [
    "ts/**/*.ts"
  ]
}
```

### 3. Project Structure

```
MyComponent/
├── MyComponent.xml              # Component definition
├── ts/
│   └── myComponent.ts           # TypeScript source
├── js/
│   ├── myComponent.js           # Compiled JavaScript
│   └── myComponent.js.map       # Source map
├── css/
│   └── myComponent.css
└── tsconfig.json                # TypeScript config
```

### 4. Compile TypeScript

```bash
# Compile once
tsc

# Watch mode (auto-compile on save)
tsc --watch
```

### 5. Update XML to Reference Compiled JS

```xml
<JavaScriptRelativePaths>
  <string>~/AppAsset/Plugins/Components/MyComponent/js/myComponent.js</string>
</JavaScriptRelativePaths>
```

---

## Available Types

### Component Data Structures

```typescript
interface ComponentSetting {
    Config: { [key: string]: any };
    DataSource?: any;
    Translations: Array<{ [ident: string]: string }>;
}

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

interface ComponentResponse {
    isError: boolean;
    errors: string[];
    html: string;
}

interface DataSourceResponse {
    isError: boolean;
    errors: string[];
    data: any[];
}
```

### Helper Namespaces

```typescript
// Common helpers
nameSpaceCommonHelper.GetPageInfo(element?: HTMLElement): PageInfo
nameSpaceCommonHelper.CreateURL(relativePath: string): string
nameSpaceCommonHelper.Base64ToString(base64: string): string

// Component helpers
nameSpaceComponentHelper.CreatePath(
    existingPath: string,
    componentIdent: string,
    sectionIdent: string,
    pageInfo: PageInfo
): string
```

### Base Component Class

```typescript
abstract class ComponentBase {
    protected element: HTMLElement;
    protected setting: ComponentSetting;
    protected pageInfo: PageInfo;

    constructor(element: HTMLElement, componentType: string);

    protected parseSetting(): ComponentSetting;
    protected getTranslation(ident: string): string;
    protected getFormData(): FormData | null;
    protected createURL(path: string): string;
    protected loadContent(sectionIdent: string, formData?: FormData | null): Promise<ComponentResponse>;
    protected loadData(sectionIdent: string, formData?: FormData | null): Promise<DataSourceResponse>;
    protected handleErrors(errors: string[]): void;

    protected static createAll<T>(
        componentType: string,
        factory: (element: HTMLElement) => T,
        container?: HTMLElement | Document
    ): void;

    protected static registerEvents<T>(
        componentType: string,
        factory: (container?: HTMLElement | Document) => void
    ): void;
}
```

### SFP Events

```typescript
interface SFPEventMap {
    'sfp.load': CustomEvent;
    'sfp.formInit': CustomEvent;
    'sfp.dialogOpen': CustomEvent;
    'sfp.formSubmit': CustomEvent;
    'sfp.formSaved': CustomEvent;
}

// Usage
element.addEventListener('sfp.load', (e) => {
    // Handle dynamic content loaded
});
```

---

## Example Component with Full Type Safety

```typescript
/// <reference path="../../docs/ai/components/typescript/sfp-components.d.ts" />

/**
 * MyComponent - Example component with full TypeScript support
 */
class MyComponent extends ComponentBase {
    private cardBody: HTMLElement | null = null;

    constructor(element: HTMLElement) {
        super(element, 'MyComponent');
        this.initialize();
    }

    private async initialize(): Promise<void> {
        this.createUI();
        await this.loadComponentContent();
        await this.loadComponentData();
    }

    private createUI(): void {
        const color = this.setting.Config.MyConfig?.['@Color'] || 'blue';
        const title = this.getTranslation('Title');

        this.element.innerHTML = `
            <div class="card" style="border-color: ${color}">
                <div class="card-header">${title}</div>
                <div class="card-body">Loading...</div>
            </div>
        `;

        this.cardBody = this.element.querySelector('.card-body');
    }

    private async loadComponentContent(): Promise<void> {
        try {
            const formData = this.getFormData();
            const response = await this.loadContent('Content', formData);

            if (response.isError) {
                this.handleErrors(response.errors);
                this.showError('Failed to load content');
                return;
            }

            if (this.cardBody) {
                this.cardBody.innerHTML = response.html;
            }
        } catch (error) {
            console.error('Load content error:', error);
            this.showError('Network error');
        }
    }

    private async loadComponentData(): Promise<void> {
        try {
            const formData = this.getFormData();
            const response = await this.loadData('GetData', formData);

            if (response.isError) {
                this.handleErrors(response.errors);
                return;
            }

            console.log('Data loaded:', response.data);
            this.processData(response.data);
        } catch (error) {
            console.error('Load data error:', error);
        }
    }

    private processData(data: any[]): void {
        // Process loaded data
        data.forEach(item => {
            console.log('Item:', item);
        });
    }

    private showError(message: string): void {
        if (this.cardBody) {
            this.cardBody.innerHTML = `
                <div class="alert alert-danger">
                    ${message}
                </div>
            `;
        }
    }

    /**
     * Static factory method - creates all components
     */
    static create(container?: HTMLElement | Document): void {
        ComponentBase.createAll(
            'MyComponent',
            (element) => new MyComponent(element),
            container
        );
    }

    /**
     * Register for dynamic content loading
     */
    static register(): void {
        ComponentBase.registerEvents(
            'MyComponent',
            (container) => MyComponent.create(container)
        );
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    MyComponent.create();
    MyComponent.register();
});
```

---

## IDE Support

### Visual Studio Code

1. Install extensions:
   - **TypeScript and JavaScript Language Features** (built-in)
   - **ESLint** (for code quality)

2. Configure settings (`.vscode/settings.json`):

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.formatOnSave": true,
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

### Visual Studio

TypeScript is supported out of the box. Ensure TypeScript SDK is installed via Visual Studio Installer.

---

## Best Practices

✅ **DO:**
- Use strict mode (`"strict": true`)
- Define interfaces for custom config structures
- Use async/await for promises
- Add JSDoc comments for public methods
- Use TypeScript's built-in types (HTMLElement, FormData, etc.)

❌ **DON'T:**
- Don't use `any` type (use `unknown` and type guards)
- Don't disable strict checks
- Don't mix TypeScript and JavaScript in same project
- Don't commit compiled .js files to version control (compile during build)

---

## Troubleshooting

### Type Errors

**Issue:** `Property does not exist on type`

**Solution:** Ensure types are properly defined. Use type assertions if needed:

```typescript
const config = this.setting.Config as { MyConfig: { '@Color': string } };
```

### Module Resolution

**Issue:** `Cannot find module`

**Solution:** Check `tsconfig.json` moduleResolution and paths:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "baseUrl": ".",
    "paths": {
      "@types/*": ["typings/*"]
    }
  }
}
```

### DOM Types

**Issue:** `Cannot find name 'document'`

**Solution:** Add DOM lib to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "lib": ["ES2017", "DOM"]
  }
}
```

---

## Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [SFP Component Documentation](../components.md)

---

**Last Updated:** 2026-01-26
