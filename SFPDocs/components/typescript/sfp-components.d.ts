/**
 * SFP Component System - TypeScript Type Definitions
 *
 * This file contains TypeScript definitions for SFP components,
 * helper functions, and data structures.
 */

// ============================================================================
// Component Data Structures
// ============================================================================

/**
 * Component setting structure (parsed from data-setting attribute)
 */
interface ComponentSetting {
    /**
     * Custom configuration from XmlContent
     * Structure depends on component definition
     */
    Config: {
        [key: string]: any;
    };

    /**
     * DataSource results (if DataSource is defined in Setting)
     */
    DataSource?: any;

    /**
     * Translations array
     */
    Translations: Array<{
        [ident: string]: string;
    }>;
}

/**
 * Page information structure
 */
interface PageInfo {
    /**
     * Type of current XML
     */
    xmlType: 'Dashboard' | 'DataView' | 'Form' | 'Configuration';

    /**
     * XML identifier
     */
    ident: string;

    /**
     * Record ID (for Form context)
     */
    tableID?: number;

    /**
     * Unique form identifier (for Form context)
     */
    formUniqueRandomIdent?: string;

    /**
     * Form element selector (for Form context)
     */
    formSelector?: string;

    /**
     * Is component inside SubForm
     */
    isSubForm: boolean;

    /**
     * SubForm information (if isSubForm is true)
     */
    subForm?: {
        /**
         * SubForm XML identifier
         */
        ident: string;

        /**
         * SubForm record ID
         */
        tableID?: number;

        /**
         * SubForm unique identifier
         */
        formUniqueRandomIdent?: string;

        /**
         * SubForm element selector
         */
        formSelector: string;
    };
}

/**
 * Component API response (ContentSection)
 */
interface ComponentResponse {
    /**
     * Error flag
     */
    isError: boolean;

    /**
     * Error messages
     */
    errors: string[];

    /**
     * Rendered HTML content
     */
    html: string;
}

/**
 * DataSource API response (DataSourceSection)
 */
interface DataSourceResponse {
    /**
     * Error flag
     */
    isError: boolean;

    /**
     * Error messages
     */
    errors: string[];

    /**
     * Data rows
     */
    data: any[];
}

// ============================================================================
// Helper Namespaces
// ============================================================================

/**
 * Common helper functions for SFP
 */
declare namespace nameSpaceCommonHelper {
    /**
     * Get information about current page context
     * @param element - Optional element to get context for (for component in SubForm)
     * @returns Page information object
     */
    function GetPageInfo(element?: HTMLElement): PageInfo;

    /**
     * Create absolute URL from relative path
     * @param relativePath - Relative path (e.g., 'AjaxAPI/Component/Render')
     * @returns Absolute URL (e.g., 'https://domain.com/AjaxAPI/Component/Render')
     */
    function CreateURL(relativePath: string): string;

    /**
     * Decode Base64 string to UTF-8 string
     * @param base64 - Base64 encoded string
     * @returns Decoded UTF-8 string
     */
    function Base64ToString(base64: string): string;

    /**
     * Encode UTF-8 string to Base64
     * @param text - UTF-8 string
     * @returns Base64 encoded string
     */
    function StringToBase64(text: string): string;
}

/**
 * Component-specific helper functions
 */
declare namespace nameSpaceComponentHelper {
    /**
     * Create query parameter string for component API endpoint
     * @param existingPath - Existing query parameters (or empty string)
     * @param componentIdent - Component registration identifier
     * @param sectionIdent - Section identifier to render
     * @param pageInfo - Page information object from GetPageInfo()
     * @returns Query parameter string (e.g., '?ident=Dashboard&componentIdent=Widget1&sectionIdent=Content&xmlType=Dashboard')
     *
     * @example
     * const path = nameSpaceComponentHelper.CreatePath('', 'Widget1', 'Content', pageInfo);
     * // Returns: '?ident=Dashboard&componentIdent=Widget1&sectionIdent=Content&xmlType=Dashboard'
     */
    function CreatePath(
        existingPath: string,
        componentIdent: string,
        sectionIdent: string,
        pageInfo: PageInfo
    ): string;
}

// ============================================================================
// SFP Events
// ============================================================================

/**
 * Custom SFP event types
 */
interface SFPEventMap {
    /**
     * Fired when content is dynamically loaded
     * Used in Dashboard tabs, DataView, etc.
     */
    'sfp.load': CustomEvent;

    /**
     * Fired when SubForm is initialized
     * Used in Form SubForm controls
     */
    'sfp.formInit': CustomEvent;

    /**
     * Fired when SubForm dialog is opened
     */
    'sfp.dialogOpen': CustomEvent;

    /**
     * Fired when form is submitted
     */
    'sfp.formSubmit': CustomEvent;

    /**
     * Fired when form is saved successfully
     */
    'sfp.formSaved': CustomEvent;
}

/**
 * Extend HTMLElement to support SFP events
 */
interface HTMLElement {
    addEventListener<K extends keyof SFPEventMap>(
        type: K,
        listener: (this: HTMLElement, ev: SFPEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions
    ): void;

    removeEventListener<K extends keyof SFPEventMap>(
        type: K,
        listener: (this: HTMLElement, ev: SFPEventMap[K]) => any,
        options?: boolean | EventListenerOptions
    ): void;
}

// ============================================================================
// Component Base Class (Example)
// ============================================================================

/**
 * Base class for SFP components
 * Extend this class to create custom components
 *
 * @example
 * class MyComponent extends ComponentBase {
 *     constructor(element: HTMLElement) {
 *         super(element, 'MyComponent');
 *         this.initialize();
 *     }
 *
 *     protected initialize(): void {
 *         this.createUI();
 *         this.loadContent('Content');
 *     }
 *
 *     private createUI(): void {
 *         // Create component UI
 *     }
 * }
 */
abstract class ComponentBase {
    /**
     * Component root element
     */
    protected element: HTMLElement;

    /**
     * Component type identifier
     */
    protected componentType: string;

    /**
     * Component settings (parsed from data-setting attribute)
     */
    protected setting: ComponentSetting;

    /**
     * Page information
     */
    protected pageInfo: PageInfo;

    /**
     * Constructor
     * @param element - Component root element
     * @param componentType - Component type identifier
     */
    constructor(element: HTMLElement, componentType: string) {
        this.element = element;
        this.componentType = componentType;
        this.setting = this.parseSetting();
        this.pageInfo = nameSpaceCommonHelper.GetPageInfo(element);
    }

    /**
     * Parse component settings from data-setting attribute
     * @returns Parsed component settings
     */
    protected parseSetting(): ComponentSetting {
        const dataAttr = this.element.getAttribute('data-setting');
        if (!dataAttr) {
            throw new Error(`Component ${this.componentType}: data-setting attribute not found`);
        }

        const settingJson = nameSpaceCommonHelper.Base64ToString(dataAttr);
        return JSON.parse(settingJson);
    }

    /**
     * Get translation by identifier
     * @param ident - Translation identifier
     * @returns Translated string or empty string
     */
    protected getTranslation(ident: string): string {
        const translation = this.setting.Translations?.find(t => t[ident]);
        return translation ? translation[ident] : '';
    }

    /**
     * Get form data (for Form context)
     * @returns FormData object or null
     */
    protected getFormData(): FormData | null {
        if (this.pageInfo.xmlType !== 'Form') {
            return null;
        }

        const formSelector = this.pageInfo.isSubForm
            ? this.pageInfo.subForm!.formSelector
            : this.pageInfo.formSelector!;

        const formElement = document.querySelector<HTMLFormElement>(formSelector);
        return formElement ? new FormData(formElement) : null;
    }

    /**
     * Create absolute URL for component API
     * @param path - Query parameter string
     * @returns Absolute URL
     */
    protected createURL(path: string): string {
        return nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);
    }

    /**
     * Load content from ContentSection
     * @param sectionIdent - Section identifier
     * @param formData - Optional form data
     * @returns Promise with component response
     */
    protected async loadContent(
        sectionIdent: string,
        formData?: FormData | null
    ): Promise<ComponentResponse> {
        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            sectionIdent,
            this.pageInfo
        );

        const response = await fetch(this.createURL(path), {
            method: 'POST',
            body: formData || undefined
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Load data from DataSourceSection
     * @param sectionIdent - Section identifier
     * @param formData - Optional form data
     * @returns Promise with data source response
     */
    protected async loadData(
        sectionIdent: string,
        formData?: FormData | null
    ): Promise<DataSourceResponse> {
        const path = nameSpaceComponentHelper.CreatePath(
            '',
            this.element.id,
            sectionIdent,
            this.pageInfo
        );

        const response = await fetch(this.createURL(path), {
            method: 'POST',
            body: formData || undefined
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Handle API errors
     * @param errors - Error messages
     */
    protected handleErrors(errors: string[]): void {
        errors.forEach(error => console.error(`[${this.componentType}]`, error));
    }

    /**
     * Static factory method - creates all components on page
     * @param componentType - Component type identifier
     * @param factory - Factory function to create component instance
     * @param container - Container element (defaults to document)
     */
    protected static createAll<T>(
        componentType: string,
        factory: (element: HTMLElement) => T,
        container?: HTMLElement | Document
    ): void {
        const root = container || document;
        const selector = `[data-componentType="${componentType}"]`;
        const elements = root.querySelectorAll<HTMLElement>(selector);

        elements.forEach(element => {
            factory(element);
        });
    }

    /**
     * Register component for dynamic content loading
     * @param componentType - Component type identifier
     * @param factory - Factory function to create component instance
     */
    protected static registerEvents<T>(
        componentType: string,
        factory: (container?: HTMLElement | Document) => void
    ): void {
        const pageInfo = nameSpaceCommonHelper.GetPageInfo();

        if (pageInfo.xmlType === 'Dashboard') {
            // Dashboard content loading
            const sfpContent = document.getElementById('sfpContent');
            if (sfpContent) {
                sfpContent.addEventListener('sfp.load', (e) => {
                    factory(e.target as HTMLElement);
                });
            }

            // Dashboard tabs loading
            document.querySelectorAll('.tab-pane').forEach(tab => {
                tab.addEventListener('sfp.load', (e) => {
                    factory(e.target as HTMLElement);
                });
            });
        } else if (pageInfo.xmlType === 'DataView') {
            // DataView content loading
            const dataTable = document.getElementById('dataTable');
            if (dataTable) {
                dataTable.addEventListener('sfp.load', (e) => {
                    factory(e.target as HTMLElement);
                });
            }
        } else if (pageInfo.xmlType === 'Form') {
            // SubForm dialog loading
            document.querySelectorAll('.js-subFormList').forEach(subForm => {
                subForm.addEventListener('sfp.formInit', () => {
                    const dialog = document.getElementById('sfpSubFormDialog');
                    if (dialog) {
                        factory(dialog);
                    }
                });
            });
        }
    }
}

// ============================================================================
// Fetch API Extensions
// ============================================================================

/**
 * Extended RequestInit with SFP-specific options
 */
interface SFPRequestInit extends RequestInit {
    /**
     * Ignore global loader (don't show loading spinner)
     */
    globalLoaderIgnore?: boolean;
}

// ============================================================================
// jQuery Compatibility (if jQuery is used)
// ============================================================================

/**
 * jQuery AJAX settings for SFP
 */
interface JQueryAjaxSettings {
    /**
     * Ignore global loader (don't show loading spinner)
     */
    globalLoaderIgnore?: boolean;
}

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * Example component implementation
 *
 * @example
 * ```typescript
 * class MyComponent {
 *     private element: HTMLElement;
 *     private setting: ComponentSetting;
 *     private pageInfo: PageInfo;
 *
 *     constructor(element: HTMLElement) {
 *         this.element = element;
 *         this.setting = JSON.parse(
 *             nameSpaceCommonHelper.Base64ToString(
 *                 element.getAttribute('data-setting') || ''
 *             )
 *         );
 *         this.pageInfo = nameSpaceCommonHelper.GetPageInfo(element);
 *
 *         this.initialize();
 *     }
 *
 *     private async initialize(): Promise<void> {
 *         // Create UI
 *         this.createUI();
 *
 *         // Load content from ContentSection
 *         const path = nameSpaceComponentHelper.CreatePath(
 *             '',
 *             this.element.id,
 *             'Content',
 *             this.pageInfo
 *         );
 *
 *         const response = await fetch(
 *             nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`),
 *             { method: 'POST' }
 *         );
 *
 *         const data: ComponentResponse = await response.json();
 *
 *         if (!data.isError) {
 *             this.renderContent(data.html);
 *         }
 *     }
 *
 *     private createUI(): void {
 *         const color = this.setting.Config.MyConfig?.['@Color'] || 'blue';
 *         const title = this.getTranslation('Title');
 *
 *         this.element.innerHTML = `
 *             <div class="component" style="border-color: ${color}">
 *                 <h3>${title}</h3>
 *                 <div class="content"></div>
 *             </div>
 *         `;
 *     }
 *
 *     private getTranslation(ident: string): string {
 *         const translation = this.setting.Translations?.find(t => t[ident]);
 *         return translation ? translation[ident] : '';
 *     }
 *
 *     private renderContent(html: string): void {
 *         const container = this.element.querySelector('.content');
 *         if (container) {
 *             container.innerHTML = html;
 *         }
 *     }
 *
 *     static create(container?: HTMLElement | Document): void {
 *         const root = container || document;
 *         const elements = root.querySelectorAll<HTMLElement>(
 *             '[data-componentType="MyComponent"]'
 *         );
 *
 *         elements.forEach(element => {
 *             new MyComponent(element);
 *         });
 *     }
 * }
 *
 * // Initialize on page load
 * document.addEventListener('DOMContentLoaded', () => {
 *     MyComponent.create();
 *
 *     // Register for dynamic content
 *     const pageInfo = nameSpaceCommonHelper.GetPageInfo();
 *
 *     if (pageInfo.xmlType === 'Dashboard') {
 *         document.getElementById('sfpContent')?.addEventListener('sfp.load', (e) => {
 *             MyComponent.create(e.target as HTMLElement);
 *         });
 *     }
 * });
 * ```
 */

// ============================================================================
// Export
// ============================================================================

export {
    ComponentSetting,
    PageInfo,
    ComponentResponse,
    DataSourceResponse,
    nameSpaceCommonHelper,
    nameSpaceComponentHelper,
    ComponentBase,
    SFPEventMap,
    SFPRequestInit,
    JQueryAjaxSettings
};
