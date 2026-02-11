# SFP Component Examples

Practical examples of SFP components for common use cases.

---

## Table of Contents

1. [Simple Content Component](#1-simple-content-component)
2. [Data Grid Component](#2-data-grid-component)
3. [Chart Component](#3-chart-component)
4. [Form Widget Component](#4-form-widget-component)
5. [Global Notification Component](#5-global-notification-component)

---

## 1. Simple Content Component

A basic component that displays custom HTML content.

### XML Definition (SimpleComponent.xml)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="SimpleComponent">

  <AccessPermissions>
    <string>Dashboard</string>
  </AccessPermissions>

  <CssRelativePaths>
    <string>~/AppAsset/Plugins/Components/SimpleComponent/css/simpleComponent.css</string>
  </CssRelativePaths>

  <JavaScriptRelativePaths>
    <string>~/AppAsset/Plugins/Components/SimpleComponent/js/simpleComponent.js</string>
  </JavaScriptRelativePaths>

  <Setting>
    <Config Title="Simple Component" BackgroundColor="#f5f5f5" />

    <Translations>
      <Translation Ident="Title" ResourceKey="SimpleComponent_Title" />
      <Translation Ident="Content" ResourceKey="SimpleComponent_Content" />
    </Translations>
  </Setting>

  <Sections>
    <Section xsi:type="ContentSection" Ident="Content">
      <HTMLTemplate><![CDATA[
        <div class="simple-content">
          <h4>[#SimpleComponent_Title#]</h4>
          <p>[#SimpleComponent_Content#]</p>
        </div>
      ]]></HTMLTemplate>
    </Section>
  </Sections>
</Component>
```

### TypeScript Implementation

```typescript
class SimpleComponent {
    private element: HTMLElement;
    private setting: any;

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = JSON.parse(
            nameSpaceCommonHelper.Base64ToString(
                element.getAttribute('data-setting') || ''
            )
        );

        this.initialize();
    }

    private async initialize(): Promise<void> {
        this.createUI();
        await this.loadContent();
    }

    private createUI(): void {
        const bgColor = this.setting.Config.Config?.['@BackgroundColor'] || '#f5f5f5';

        this.element.innerHTML = `
            <div class="simple-component" style="background-color: ${bgColor}">
                <div class="component-body"></div>
            </div>
        `;
    }

    private async loadContent(): Promise<void> {
        const pageInfo = nameSpaceCommonHelper.GetPageInfo(this.element);
        const path = nameSpaceComponentHelper.CreatePath('', this.element.id, 'Content', pageInfo);
        const url = nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);

        const response = await fetch(url, { method: 'POST' });
        const data = await response.json();

        if (!data.isError) {
            const body = this.element.querySelector('.component-body');
            if (body) {
                body.innerHTML = data.html;
            }
        }
    }

    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>('[data-componentType="SimpleComponent"]');
        elements.forEach(element => new SimpleComponent(element));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    SimpleComponent.create();
});
```

---

## 2. Data Grid Component

Component that displays data in a table format.

### XML Definition (DataGridComponent.xml)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="DataGridComponent">

  <Setting>
    <GridConfig ShowPagination="true" PageSize="10" />

    <Translations>
      <Translation Ident="Title" ResourceKey="DataGrid_Title" />
      <Translation Ident="NoData" ResourceKey="DataGrid_NoData" />
    </Translations>
  </Setting>

  <Sections>
    <!-- HTML Template Section -->
    <Section xsi:type="ContentSection" Ident="Header">
      <HTMLTemplate><![CDATA[
        <div class="data-grid-header">
          <h4>[#DataGrid_Title#]</h4>
        </div>
      ]]></HTMLTemplate>
    </Section>

    <!-- Data Source Section -->
    <Section xsi:type="DataSourceSection" Ident="Data">
      <DataSource>
        <SQL><![CDATA[
          SELECT TOP 10
            p.ID,
            p.Name,
            p.SKU,
            p.Price,
            c.Name AS CategoryName
          FROM usr.Product p
          LEFT JOIN usr.Category c ON c.ID = p.CategoryID
          WHERE p.State = 1
          ORDER BY p.Name
        ]]></SQL>
      </DataSource>
    </Section>
  </Sections>
</Component>
```

### TypeScript Implementation

```typescript
interface GridData {
    ID: number;
    Name: string;
    SKU: string;
    Price: number;
    CategoryName: string;
}

class DataGridComponent {
    private element: HTMLElement;
    private setting: any;
    private pageInfo: any;
    private data: GridData[] = [];

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = JSON.parse(
            nameSpaceCommonHelper.Base64ToString(element.getAttribute('data-setting') || '')
        );
        this.pageInfo = nameSpaceCommonHelper.GetPageInfo(element);

        this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.loadHeader();
        await this.loadData();
        this.renderGrid();
    }

    private async loadHeader(): Promise<void> {
        const path = nameSpaceComponentHelper.CreatePath('', this.element.id, 'Header', this.pageInfo);
        const url = nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);

        const response = await fetch(url, { method: 'POST' });
        const result = await response.json();

        if (!result.isError) {
            this.element.innerHTML = result.html;
        }
    }

    private async loadData(): Promise<void> {
        const path = nameSpaceComponentHelper.CreatePath('', this.element.id, 'Data', this.pageInfo);
        const url = nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);

        const response = await fetch(url, { method: 'POST' });
        const result = await response.json();

        if (!result.isError) {
            this.data = result.data;
        }
    }

    private renderGrid(): void {
        const noDataMsg = this.getTranslation('NoData');

        if (this.data.length === 0) {
            this.element.innerHTML += `
                <div class="alert alert-info">${noDataMsg}</div>
            `;
            return;
        }

        const tableHTML = `
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>SKU</th>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Price</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.data.map(row => `
                        <tr data-id="${row.ID}">
                            <td>${row.SKU}</td>
                            <td>${row.Name}</td>
                            <td>${row.CategoryName || '-'}</td>
                            <td>${row.Price.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        this.element.innerHTML += tableHTML;
    }

    private getTranslation(ident: string): string {
        const translation = this.setting.Translations?.find((t: any) => t[ident]);
        return translation ? translation[ident] : '';
    }

    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>('[data-componentType="DataGridComponent"]');
        elements.forEach(element => new DataGridComponent(element));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    DataGridComponent.create();
});
```

---

## 3. Chart Component

Component that displays data visualization using Chart.js.

### XML Definition (ChartComponent.xml)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="ChartComponent">

  <PackageIdents>
    <string>ChartJS</string>
  </PackageIdents>

  <JavaScriptRelativePaths>
    <string>~/AppAsset/Plugins/Components/ChartComponent/js/chartComponent.js</string>
  </JavaScriptRelativePaths>

  <Setting>
    <ChartConfig Type="bar" Height="300" />

    <Translations>
      <Translation Ident="Title" ResourceKey="Chart_Title" />
    </Translations>
  </Setting>

  <Sections>
    <Section xsi:type="DataSourceSection" Ident="ChartData">
      <DataSource>
        <SQL><![CDATA[
          SELECT
            c.Name AS CategoryName,
            COUNT(p.ID) AS ProductCount
          FROM usr.Category c
          LEFT JOIN usr.Product p ON p.CategoryID = c.ID AND p.State = 1
          WHERE c.State = 1
          GROUP BY c.ID, c.Name
          ORDER BY ProductCount DESC
        ]]></SQL>
      </DataSource>
    </Section>
  </Sections>
</Component>
```

### TypeScript Implementation

```typescript
// Requires Chart.js library
declare const Chart: any;

interface ChartDataItem {
    CategoryName: string;
    ProductCount: number;
}

class ChartComponent {
    private element: HTMLElement;
    private setting: any;
    private pageInfo: any;
    private chart: any = null;

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = JSON.parse(
            nameSpaceCommonHelper.Base64ToString(element.getAttribute('data-setting') || '')
        );
        this.pageInfo = nameSpaceCommonHelper.GetPageInfo(element);

        this.initialize();
    }

    private async initialize(): Promise<void> {
        this.createCanvas();
        await this.loadData();
    }

    private createCanvas(): void {
        const height = this.setting.Config.ChartConfig?.['@Height'] || '300';
        const title = this.getTranslation('Title');

        this.element.innerHTML = `
            <div class="chart-container">
                <h4>${title}</h4>
                <canvas id="chart-${this.element.id}" height="${height}"></canvas>
            </div>
        `;
    }

    private async loadData(): Promise<void> {
        const path = nameSpaceComponentHelper.CreatePath('', this.element.id, 'ChartData', this.pageInfo);
        const url = nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);

        const response = await fetch(url, { method: 'POST' });
        const result = await response.json();

        if (!result.isError) {
            this.renderChart(result.data);
        }
    }

    private renderChart(data: ChartDataItem[]): void {
        const canvas = this.element.querySelector<HTMLCanvasElement>(`#chart-${this.element.id}`);
        if (!canvas) return;

        const chartType = this.setting.Config.ChartConfig?.['@Type'] || 'bar';

        const labels = data.map(item => item.CategoryName);
        const values = data.map(item => item.ProductCount);

        this.chart = new Chart(canvas, {
            type: chartType,
            data: {
                labels: labels,
                datasets: [{
                    label: 'Products',
                    data: values,
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    private getTranslation(ident: string): string {
        const translation = this.setting.Translations?.find((t: any) => t[ident]);
        return translation ? translation[ident] : '';
    }

    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>('[data-componentType="ChartComponent"]');
        elements.forEach(element => new ChartComponent(element));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ChartComponent.create();
});
```

---

## 4. Form Widget Component

Component that interacts with Form data and updates on field changes.

### XML Definition (FormWidgetComponent.xml)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="FormWidgetComponent">

  <Setting>
    <WidgetConfig WatchFields="UnitPrice,Quantity" />

    <Translations>
      <Translation Ident="Total" ResourceKey="FormWidget_Total" />
    </Translations>
  </Setting>

  <Sections>
    <Section xsi:type="ContentSection" Ident="Calculator">
      <Sources>
        <DataSource Ident="FormData">
          <SQL><![CDATA[
            SELECT
              UnitPrice,
              Quantity,
              (UnitPrice * Quantity) AS Total
            FROM usr.Product
            WHERE ID = @ID
          ]]></SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" ConstantType="ID" DataType="Number" />
          </Parameters>
        </DataSource>
      </Sources>
      <HTMLTemplate><![CDATA[
        <div class="form-widget">
          <strong>[#FormWidget_Total#]:</strong>
          <span class="total-value">[%#FormData.Total%]</span>
        </div>
      ]]></HTMLTemplate>
    </Section>
  </Sections>
</Component>
```

### TypeScript Implementation

```typescript
class FormWidgetComponent {
    private element: HTMLElement;
    private setting: any;
    private pageInfo: any;
    private watchFields: string[] = [];

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = JSON.parse(
            nameSpaceCommonHelper.Base64ToString(element.getAttribute('data-setting') || '')
        );
        this.pageInfo = nameSpaceCommonHelper.GetPageInfo(element);

        // Parse watch fields
        const watchFieldsStr = this.setting.Config.WidgetConfig?.['@WatchFields'] || '';
        this.watchFields = watchFieldsStr.split(',').map((f: string) => f.trim());

        this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.loadContent();
        this.attachFieldListeners();
    }

    private async loadContent(): Promise<void> {
        const formData = this.getFormData();
        const path = nameSpaceComponentHelper.CreatePath('', this.element.id, 'Calculator', this.pageInfo);
        const url = nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);

        const response = await fetch(url, {
            method: 'POST',
            body: formData || undefined
        });

        const result = await response.json();

        if (!result.isError) {
            this.element.innerHTML = result.html;
        }
    }

    private attachFieldListeners(): void {
        if (this.pageInfo.xmlType !== 'Form') return;

        const formSelector = this.pageInfo.isSubForm
            ? this.pageInfo.subForm.formSelector
            : this.pageInfo.formSelector;

        const formElement = document.querySelector(formSelector);
        if (!formElement) return;

        // Watch for changes on specified fields
        this.watchFields.forEach(fieldName => {
            const input = formElement.querySelector<HTMLInputElement>(`[name="${fieldName}"]`);
            if (input) {
                input.addEventListener('change', () => this.onFieldChange());
                input.addEventListener('input', () => this.onFieldChange());
            }
        });
    }

    private onFieldChange(): void {
        // Debounce to avoid too many requests
        clearTimeout((this as any).debounceTimer);
        (this as any).debounceTimer = setTimeout(() => {
            this.loadContent();
        }, 300);
    }

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

    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>('[data-componentType="FormWidgetComponent"]');
        elements.forEach(element => new FormWidgetComponent(element));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    FormWidgetComponent.create();

    // Re-initialize on SubForm open
    document.querySelectorAll('.js-subFormList').forEach(subForm => {
        subForm.addEventListener('sfp.formInit', () => {
            const dialog = document.getElementById('sfpSubFormDialog');
            if (dialog) {
                FormWidgetComponent.create(dialog);
            }
        });
    });
});
```

---

## 5. Global Notification Component

Component registered in Configuration that appears on all pages.

### XML Definition (NotificationComponent.xml)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
           Ident="NotificationComponent">

  <CssRelativePaths>
    <string>~/AppAsset/Plugins/Components/NotificationComponent/css/notification.css</string>
  </CssRelativePaths>

  <JavaScriptRelativePaths>
    <string>~/AppAsset/Plugins/Components/NotificationComponent/js/notification.js</string>
  </JavaScriptRelativePaths>

  <Setting>
    <NotificationConfig IsGlobal="true" Position="top-right" />
  </Setting>

  <Sections>
    <Section xsi:type="DataSourceSection" Ident="Notifications">
      <DataSource>
        <SQL><![CDATA[
          SELECT TOP 5
            n.ID,
            n.Title,
            n.Message,
            n.CreateDate,
            n.IsRead
          FROM usr.Notification n
          WHERE n.AccountID = @UserID
            AND n.State = 1
            AND n.IsRead = 0
          ORDER BY n.CreateDate DESC
        ]]></SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number" />
        </Parameters>
      </DataSource>
    </Section>
  </Sections>
</Component>
```

### Registration in Configuration

```xml
<?xml version="1.0" encoding="utf-8"?>
<Configuration Ident="Configuration">

  <Sections>
    <Section xsi:type="ComponentSection">
      <Components>
        <Component Ident="GlobalNotifications" ComponentIdent="NotificationComponent">
          <Setting>
            <NotificationConfig IsGlobal="true" Position="top-right" CheckInterval="30000" />
          </Setting>
        </Component>
      </Components>
    </Section>
  </Sections>
</Configuration>
```

### TypeScript Implementation

```typescript
interface Notification {
    ID: number;
    Title: string;
    Message: string;
    CreateDate: string;
    IsRead: boolean;
}

class NotificationComponent {
    private element: HTMLElement;
    private setting: any;
    private notifications: Notification[] = [];
    private checkInterval: number = 30000; // 30 seconds

    constructor(element: HTMLElement) {
        this.element = element;
        this.setting = JSON.parse(
            nameSpaceCommonHelper.Base64ToString(element.getAttribute('data-setting') || '')
        );

        const intervalStr = this.setting.Config.NotificationConfig?.['@CheckInterval'];
        if (intervalStr) {
            this.checkInterval = parseInt(intervalStr, 10);
        }

        this.initialize();
    }

    private async initialize(): Promise<void> {
        this.createContainer();
        await this.loadNotifications();
        this.startPolling();
    }

    private createContainer(): void {
        const position = this.setting.Config.NotificationConfig?.['@Position'] || 'top-right';

        this.element.innerHTML = `
            <div class="notification-container ${position}">
                <div class="notification-list"></div>
            </div>
        `;
    }

    private async loadNotifications(): Promise<void> {
        const pageInfo = {
            xmlType: 'Configuration' as const,
            ident: 'Configuration'
        };

        const path = nameSpaceComponentHelper.CreatePath('', this.element.id, 'Notifications', pageInfo);
        const url = nameSpaceCommonHelper.CreateURL(`AjaxAPI/Component/Render${path}`);

        try {
            const response = await fetch(url, { method: 'POST' });
            const result = await response.json();

            if (!result.isError) {
                this.notifications = result.data;
                this.renderNotifications();
            }
        } catch (error) {
            console.error('Failed to load notifications:', error);
        }
    }

    private renderNotifications(): void {
        const listContainer = this.element.querySelector('.notification-list');
        if (!listContainer) return;

        if (this.notifications.length === 0) {
            listContainer.innerHTML = '';
            return;
        }

        const html = this.notifications.map(notif => `
            <div class="notification-item" data-id="${notif.ID}">
                <div class="notification-header">
                    <strong>${notif.Title}</strong>
                    <button class="close-btn" data-id="${notif.ID}">&times;</button>
                </div>
                <div class="notification-body">
                    ${notif.Message}
                </div>
                <div class="notification-footer">
                    <small>${new Date(notif.CreateDate).toLocaleString()}</small>
                </div>
            </div>
        `).join('');

        listContainer.innerHTML = html;

        // Attach close button handlers
        listContainer.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt((e.target as HTMLElement).getAttribute('data-id') || '0', 10);
                this.markAsRead(id);
            });
        });
    }

    private async markAsRead(notificationId: number): Promise<void> {
        // Call API to mark as read
        // Then remove from UI
        const item = this.element.querySelector(`[data-id="${notificationId}"]`);
        if (item) {
            item.remove();
        }

        this.notifications = this.notifications.filter(n => n.ID !== notificationId);
    }

    private startPolling(): void {
        setInterval(() => {
            this.loadNotifications();
        }, this.checkInterval);
    }

    static create(container?: HTMLElement | Document): void {
        const root = container || document;
        const elements = root.querySelectorAll<HTMLElement>('[data-componentType="NotificationComponent"]');
        elements.forEach(element => new NotificationComponent(element));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    NotificationComponent.create();
});
```

---

## Summary

These examples demonstrate:

1. **Simple Content** - Basic HTML rendering
2. **Data Grid** - Displaying tabular data
3. **Chart** - Data visualization
4. **Form Widget** - Interactive form components
5. **Global Component** - Site-wide functionality

Key patterns:
- Use `ContentSection` for HTML rendering
- Use `DataSourceSection` for JSON data
- Implement async/await for data loading
- Register for SFP events for dynamic content
- Use TypeScript for type safety

For more information, see [components.md](components.md).

---

**Last Updated:** 2026-01-26
