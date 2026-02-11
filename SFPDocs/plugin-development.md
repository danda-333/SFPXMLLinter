# SFP Plugin Development Documentation

This documentation describes how to create plugins for the SFP (Smart Form Platform) system.

---

## Important: Code Conventions

**For complete C# coding standards, see [csharp-coding-standards.md](csharp-coding-standards.md)**

This section covers plugin-specific conventions. For general C# coding standards (naming, formatting, patterns, etc.), refer to the main coding standards document.

### Language Convention
**All code (classes, methods, properties, variables, comments) MUST be written in English.** This includes:
- Class names: `InvoiceProcessor`, not `ZpracovatelFaktur`
- Method names: `ProcessData`, not `ZpracujData`
- Variable names: `invoiceNumber`, not `cisloFaktury`
- Comments and documentation

### Naming Conventions for Plugins
**Private fields and properties MUST use `this._` prefix:**

```csharp
public class MyPlugin : IParameterExecuteAction
{
    // Private fields - use this._fieldName
    private readonly ILogger<MyPlugin> _logger;
    private readonly IUserService _userService;
    private readonly IEventLogService _eventLogService;
    private DependencyAssembly _dependencyAssembly;

    [Inject]
    public MyPlugin(
        ILogger<MyPlugin> logger,
        IUserService userService,
        IEventLogService eventLogService)
    {
        // Always use this._ when accessing private fields
        this._logger = logger;
        this._userService = userService;
        this._eventLogService = eventLogService;
        this._dependencyAssembly = new DependencyAssembly();
    }

    public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
    {
        // Access private fields with this._
        var user = this._userService.GetFromContext();
        this._logger.LogInformation("Processing started");

        // Local variables - camelCase
        int accountID = user.AccountID;  // Note: Property is AccountID (uppercase ID)
        int siteID = 123;                // Always use ID, not Id

        // ...
    }

    public void Dispose()
    {
        this._dependencyAssembly?.Dispose();
    }
}
```

**Rules:**
- Private fields: `this._fieldName` (with underscore)
- Local variables: `variableName` (camelCase, no prefix)
- Public properties: `PropertyName` (PascalCase)
- Methods: `MethodName` (PascalCase)
- **ID suffix: Always use `ID` (uppercase), not `Id`**
  - ✅ Correct: `AccountID`, `SiteID`, `UserID`, `OrderID`
  - ❌ Wrong: `AccountId`, `SiteId`, `UserId`, `OrderId`

**📖 For more detailed coding standards including:**
- Code formatting and indentation
- Repository and Service patterns
- Error handling and logging
- LINQ and async patterns
- Best practices and performance

**See:** [csharp-coding-standards.md](csharp-coding-standards.md)

---

## 1. Plugin Architecture Overview

Plugins in SFP are dynamically loaded DLL libraries that implement specific interfaces. The system supports the following plugin types:

| Interface | Description | Input | Output |
|-----------|-------------|-------|--------|
| `IExecuteAction` | Execute action without parameters | `formIdent`, `ids` | `bool` |
| `IParameterExecuteAction` | Execute action with XML parameters | `formIdent`, `ids`, `xmlContent` | `bool` |
| `IDownloadAction` | Download file | `formIdent`, `ids` | `File` |
| `IParameterDownloadAction` | Download file with XML parameters | `formIdent`, `ids`, `xmlContent` | `File` |
| `ISearchAction` | Search/modify data | `data` | `List<DataItem>` |
| `IParameterSearchAction` | Search/modify data with XML parameters | `data`, `xmlContent` | `List<DataItem>` |

---

## 2. Creating a Plugin Project

### 2.1 Project File Structure (.csproj)

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>disable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="SFP.Common" Version="$(SFPVersion)" ExcludeAssets="runtime" />
  </ItemGroup>

</Project>
```

**Important:**
- **TargetFramework:** `net8.0`
- **SFP.Common:** Main NuGet package containing all required references
- **ExcludeAssets="runtime":** Prevents copying runtime DLLs to output (uses DLLs from main application)

### 2.2 NuGet Source

SFP packages are available on a private NuGet server:

```
https://packages.gappex.com/nuget/index.json
```

Add to `nuget.config`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="SFP" value="https://packages.gappex.com/nuget/index.json" />
  </packageSources>
</configuration>
```

### 2.3 Recommended Project Structure

```
MyPlugin/
├── MyPlugin.csproj
├── Actions/
│   └── MyAction.cs           # Plugin implementation
├── Models/
│   ├── Settings/
│   │   └── MySetting.cs      # Model for XML configuration
│   └── MyModels.cs           # Other models
└── nuget.config               # NuGet configuration
```

---

## 3. Plugin Interfaces

### 3.1 IParameterExecuteAction

Main interface for executing actions with XML configuration.

```csharp
using SFP.Kernel.Model.WorkFlow.Actions.Plugins;
using System.Xml;

public interface IParameterExecuteAction : IDisposable
{
    /// <summary>
    /// Executes an action with XML content
    /// </summary>
    /// <param name="formIdent">Form identifier</param>
    /// <param name="ids">List of record IDs</param>
    /// <param name="xmlContent">XML configuration from workflow definition</param>
    /// <returns>true = success, false = error</returns>
    bool Start(string formIdent, List<int> ids, XmlNode xmlContent);
}
```

### 3.2 IExecuteAction

Simplified version without XML parameters.

```csharp
public interface IExecuteAction : IDisposable
{
    bool Start(string formIdent, List<int> ids);
}
```

### 3.3 IDownloadAction / IParameterDownloadAction

For generating files for download.

```csharp
public interface IDownloadAction : IDisposable
{
    File Start(string formIdent, List<int> ids);
}

public interface IParameterDownloadAction : IDisposable
{
    File Start(string formIdent, List<int> ids, XmlNode xmlContent);
}
```

### 3.4 ISearchAction / IParameterSearchAction

For searching, filtering, and modifying form data.

```csharp
public interface ISearchAction : IDisposable
{
    /// <summary>
    /// Processes data and returns modified data
    /// </summary>
    /// <param name="data">Input data from form</param>
    /// <param name="isFind">Out parameter - true if data was found/modified</param>
    /// <returns>List of DataItems to update the form</returns>
    List<DataItem> Start(List<DataItem> data, out bool isFind);
}

public interface IParameterSearchAction : IDisposable
{
    List<DataItem> Start(List<DataItem> data, out bool isFind, XmlNode xmlContent);
}
```

---

## 4. Dependency Injection using [Inject] Attribute

### 4.1 InjectAttribute

The `SFP.Kernel.Model.Attributes.Plugins.InjectAttribute` attribute marks constructors for automatic service injection from the DI container.

```csharp
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Constructor, AllowMultiple = false)]
public class InjectAttribute : Attribute { }
```

### 4.2 Recommended Approach - Constructor Injection

```csharp
using SFP.Kernel.Model.Attributes.Plugins;
using SFP.Common.Services.Interfaces;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;

public class MyPlugin : IParameterExecuteAction
{
    private readonly ILogger<MyPlugin> _logger;
    private readonly IConfiguration _configuration;
    private readonly IUserService _userService;
    private readonly IEventLogService _eventLogService;
    private readonly IDataSourceService _dataSourceService;

    [Inject]
    public MyPlugin(
        ILogger<MyPlugin> logger,
        IConfiguration configuration,
        IUserService userService,
        IEventLogService eventLogService,
        IDataSourceService dataSourceService)
    {
        _logger = logger;
        _configuration = configuration;
        _userService = userService;
        _eventLogService = eventLogService;
        _dataSourceService = dataSourceService;
    }

    public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
    {
        // ... implementation
    }

    public void Dispose() { }
}
```

### 4.3 Plugin Lifecycle

1. **Instance Creation:** Plugin is created for each action call (per-request)
2. **Dependency Injection:** Constructor with `[Inject]` attribute is called with DI services
3. **Execution:** `Start()` method is called
4. **Disposal:** `Dispose()` is called after completion

**Important:** Plugin is NOT a singleton - each call creates a new instance.

---

## 5. Available DI Services

### 5.1 Standard .NET Services

| Service | Description |
|---------|-------------|
| `ILogger<T>` | File logging |
| `IConfiguration` | Access to configuration (appsettings.json) |
| `IOptions<T>` | Typed configuration |
| `IOptions<ProxyConfig>` | Proxy configuration for HTTP communication (see section 11) |
| `IHttpContextAccessor` | Access to HTTP context |
| `IServiceProvider` | Manual service resolution |

### 5.2 SFP Services

#### IUserService
Working with users and permissions.

```csharp
[Inject]
public MyPlugin(IUserService userService) { ... }

// Get currently logged-in user
User user = _userService.GetFromContext();

// Check role
bool isAdmin = _userService.IsInRole("Admin", user);

// Get user language
string langCode = _userService.GetLanguageCode();
```

#### IEventLogService (REQUIRED for error logging)

```csharp
[Inject]
public MyPlugin(IEventLogService eventLogService) { ... }

// Log error
_eventLogService.LogError(ex.ToString(), "MyPlugin.Start.Error");

// Log warning
_eventLogService.LogWarning("Data is empty", "MyPlugin.Start.NoData");

// Log info (use sparingly!)
_eventLogService.LogInfo("Processed", "MyPlugin.Start.Info");
```

#### IDataSourceService
Working with database using DataSource definitions.

```csharp
[Inject]
public MyPlugin(IDataSourceService dataSourceService) { ... }

// Get data from DataSource
var rows = _dataSourceService.GetDataSource(dataSource, dataSourceParameter);

// Execute SQL command
_dataSourceService.Execute(dataSource, dataSourceParameter);

// Get single value
object value = _dataSourceService.GetSingleValue(dataSource, dataSourceParameter);
```

#### IConfigurationService
Access to SFP configuration.

```csharp
[Inject]
public MyPlugin(IConfigurationService configurationService) { ... }

// Get DLL section
DLLSection dllSection = _configurationService.GetDLLSection();
```

#### IFormService
Working with forms.

```csharp
[Inject]
public MyPlugin(IFormService formService) { ... }

// Save form
FormServiceSaveReturn result = _formService.Save(form, id, dataItems);

// Get form data
List<DataItem> data = _formService.GetData(form, id);
```

#### IFileService
Working with files.

```csharp
[Inject]
public MyPlugin(IFileService fileService) { ... }

// Get file by ID
File file = _fileService.GetFile(fileId);

// Save files
List<File> savedFiles = _fileService.Save(files, accountId);
```

---

## 6. User Model

The `User` object contains information about the logged-in user.

```csharp
namespace SFP.Common.Models
{
    public class User
    {
        // Basic identification
        public int AccountID { get; set; }          // User ID
        public string UserName { get; set; }        // Login name
        public string FullName { get; set; }        // Full name
        public string Email { get; set; }           // Email
        public string Phone { get; set; }           // Phone

        // Language settings
        public short LanguageID { get; set; }       // Language ID
        public string LanguageCode { get; set; }    // Language code (cs, en, ...)
        public string UICultureCode { get; set; }   // UI culture

        // Permissions
        public List<Permission> Permissions { get; set; }           // List of permissions
        public List<Permission> AllPermissions { get; set; }        // All permissions
        public List<FolderTreePermission> FolderTreePermissions { get; set; }

        // Special flags
        public bool IsSuperAdmin { get; set; }      // Is super admin?
        public bool IsSystem { get; set; }          // Is system account?
        public bool IsPublic { get; set; }          // Is public account?

        // Other properties
        public string ASPNETUserID { get; set; }    // ASP.NET User ID
        public UserData Data { get; set; }          // Additional data
        public Account.ThemeTypes ThemeType { get; set; }  // Theme type
    }
}
```

**Usage example:**
```csharp
var user = _userService.GetFromContext();
if (user == null)
{
    _eventLogService.LogError("User is not logged in", "Plugin.Start.NoUser");
    return false;
}

_logger.LogInformation($"Plugin started by user: {user.UserName} (ID: {user.AccountID})");

if (user.IsSuperAdmin)
{
    // Special logic for super admin
}
```

---

## 7. Extension Methods

### 7.1 DataItemExtension (SFP.Kernel.DAL.Extensions)

Extension methods for working with `List<DataItem>`.

```csharp
using SFP.Kernel.DAL.Extensions;

// Get value as object
object value = data.Get("ColumnName");

// Get value with case-insensitive search
object value = data.Get("columnname", isCaseInsensitive: true);

// Get typed value (with automatic conversion)
string name = data.Get<string>("Name");
int count = data.Get<int>("Count");
decimal amount = data.Get<decimal>("Amount");
bool isActive = data.Get<bool>("IsActive");

// Get value as formatted string (respects culture for decimals)
string formattedValue = data.GetString("Amount");

// Add or update value
data.AddOrUpdate("ColumnName", newValue);

// Find DataItem object
DataItem item = data.FindItem("ColumnName");
```

**Important:** If value doesn't exist or is `DBNull.Value`, methods return `null` or `default(T)`.

### 7.2 UserExtension (SFP.Common.Extensions)

Extension method for converting user data to DataSourceParameter.

```csharp
using SFP.Common.Extensions;

var user = _userService.GetFromContext();

DataSourceParameter dataSourceParameter = new DataSourceParameter();
dataSourceParameter.DataItems = data;
dataSourceParameter.Ident = Guid.NewGuid().ToString();

// Adds AccountID, LanguageID, and AnonymousID to DataSourceParameter
user.ConvertToDataSourceParameter(dataSourceParameter, _userService);
```

**What it adds:**
- `dataSourceParameter.AccountID` - User's AccountID
- `dataSourceParameter.LanguageID` - User's language ID
- `dataSourceParameter.AnonymousID` - Anonymous user ID (if applicable)

---

## 8. Parsing XML Configuration

### 8.1 Deserializing XML to Object

Use `SerializationHelper` for parsing XML configuration:

```csharp
using SFP.Kernel.Common.Helpers;

public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
{
    // Convert XmlNode to string
    string xml = SerializationHelper.SerializeToString(xmlContent);

    // Deserialize to custom model
    MySetting setting = SerializationHelper.Deserialize<MySetting>(xml);

    // Use settings
    if (string.IsNullOrEmpty(setting.APIKey))
    {
        _eventLogService.LogError("APIKey is not set", "Plugin.Start.Config");
        return false;
    }

    // ...
}
```

### 8.2 Model for XML Configuration

```csharp
using SFP.Kernel.Model.DataSource;
using SFP.Kernel.Model.Mappings;
using System.Xml.Serialization;
using System.ComponentModel;

namespace MyPlugin.Models.Settings
{
    public class MySetting
    {
        /// <summary>
        /// DataSource for getting input data
        /// </summary>
        public DataSource InputDataSource { get; set; }

        /// <summary>
        /// DataSource for processing results
        /// </summary>
        public DataSource ResultDataSource { get; set; }

        /// <summary>
        /// Response type enumeration
        /// </summary>
        public enum ResponseTypes { Text, JSON }

        [XmlAttribute, DefaultValue(ResponseTypes.Text)]
        public ResponseTypes ResponseType { get; set; } = ResponseTypes.Text;

        /// <summary>
        /// Value mappings
        /// </summary>
        public List<Mapping> Mappings { get; set; }

        /// <summary>
        /// API key (from XML attribute)
        /// </summary>
        [XmlAttribute]
        public string APIKey { get; set; }
    }
}
```

### 8.3 Working with DataSource in Plugin

```csharp
using SFP.Common.Models.Parameters;
using SFP.Common.Extensions;
using SFP.Kernel.DAL.Extensions;

public List<DataItem> Start(List<DataItem> data, out bool isFind, XmlNode xmlContent)
{
    isFind = false;

    // Deserialize configuration
    string xml = SerializationHelper.SerializeToString(xmlContent);
    MySetting setting = SerializationHelper.Deserialize<MySetting>(xml);

    // Prepare DataSource parameters
    var user = _userService.GetFromContext();

    DataSourceParameter dataSourceParameter = new DataSourceParameter();
    dataSourceParameter.DataItems = data;  // Data from form
    dataSourceParameter.Ident = Guid.NewGuid().ToString();

    // Add user parameters (AccountID, LanguageID, AnonymousID)
    user.ConvertToDataSourceParameter(dataSourceParameter, _userService);

    // Execute DataSource
    var rows = _dataSourceService.GetDataSource(setting.InputDataSource, dataSourceParameter);

    if (rows?.Any() ?? false)
    {
        // Get value from first row
        var firstRow = rows.FirstOrDefault().Value;
        string name = firstRow.Get<string>("Name");

        isFind = true;
        return firstRow;
    }

    return null;
}
```

### 8.4 DataSource XML Configuration

For **complete DataSource and Parameter XML documentation**, see:

📖 **[docs/ai/common/datasource.md](../../docs/ai/common/datasource.md)**

The datasource.md documentation contains:
- Complete Parameter types (VariableParameter, ValueParameter, TableParameter, etc.)
- All DataType values (Number, String, DateTime, Double, Bool, NumberList, StringList, etc.)
- SetDataType enum values (ActualData, OldData, ParentData, ExtensionData, etc.)
- ConstantType values (UserID, LanguageID, AnonymousID, FormIdent)
- Complete XML examples with correct namespaces
- Column definitions, DataBind, and advanced features

**Quick Reference for Plugin Development:**

```xml
<MySettingModel
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">

    <MyDataSource>
        <SQL><![CDATA[
            SELECT CustomerID, CustomerName, Email
            FROM dbo.Customers
            WHERE ID = @ID
              AND CreatedBy = @UserID
        ]]></SQL>
        <Parameters>
            <!-- Regular parameter from form data -->
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
            
            <!-- System constant - current user ID -->
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" DataType="Number" ConstantType="UserID" />
        </Parameters>
    </MyDataSource>
</MySettingModel>
```

**Critical Rules:**
1. ✅ Always use namespace: `xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"`
2. ✅ Use `<dsp:Parameter>` with `dsp:` prefix
3. ✅ Always include `xsi:type="dsp:VariableParameter"` (note the `dsp:` prefix)
4. ✅ Use `Ident` attribute (NOT `Name`)
5. ✅ Use correct DataType values: `Number`, `String`, `DateTime`, `Double`, `Bool`, `NumberList`, `StringList`
6. ✅ For ExtensionData or OldDataItems: use `SetDataType="ExtensionData"` or `SetDataType="OldDataItems"`

**Common Mistakes:**
- ❌ `xmlns:dsp="SFP.Kernel.Model.DataSource"` (C# namespace - WRONG!)
- ❌ `DataType="TableNumber"` (doesn't exist - use `NumberList`)
- ❌ `DataType="Int"` or `DataType="Text"` (use `Number` and `String`)
- ❌ `Source="ExtensionData"` (should be `SetDataType="ExtensionData"`)
- ❌ `Name="ID"` (should be `Ident="ID"`)

---
## 9. Plugin Configuration

### 9.1 Registration in DLLSection

Plugin must be registered in the configuration file in `DLLSection`:

```xml
<Section xsi:type="DLLSection" AbsolutePath="C:\Projects\SmartFormPlatform">
    <DLLs>
        <DLL
            Ident="MyPlugin"
            Path="~\Plugins\MyPlugin\bin\Debug\net8.0\MyPlugin.dll"
            ClassType="MyPlugin.Actions.MyAction" />
    </DLLs>
</Section>
```

**Attributes:**
- `Ident` - Unique plugin identifier (used in workflow as `DLLIdent`)
- `Path` - Path to DLL (`~` = relative to AbsolutePath)
- `ClassType` - Fully qualified class name (`Namespace.ClassName`)

### 9.2 Usage in Workflow

Plugin is assigned to workflow using XML action:

```xml
<!-- For IParameterExecuteAction -->
<Action xsi:type="DLLParameterExecute" DLLIdent="MyPlugin" ActionStart="AfterSave">
    <MySetting
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        APIKey="xxx">
        <InputDataSource>
            <SQL>SELECT * FROM table WHERE ID = @ID</SQL>
            <Parameters>
                <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
            </Parameters>
        </InputDataSource>
    </MySetting>
</Action>

<!-- For IParameterSearchAction -->
<Action xsi:type="DLLParameterSearch" DLLIdent="MyPlugin" ActionStart="AfterValidation">
    <MySetting
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
        <!-- configuration -->
    </MySetting>
</Action>
```

**ActionStart values:**
- `BeforeValidation` - Before form validation
- `AfterValidation` - After form validation passes
- `AfterSave` - After data is saved to database
- `AfterPermission` - After permissions are calculated for the form

### 9.3 ActionStart Context - When to Use Which

Understanding when each `ActionStart` triggers and which plugin type to use:

| ActionStart | When Triggered | Recommended Plugin Type | Use Case |
|-------------|----------------|------------------------|----------|
| `BeforeValidation` | Before form data validation | `DLLParameterSearch` | Modify/populate form fields before validation (auto-fill, calculations) |
| `AfterValidation` | After validation passes, before save | `DLLParameterSearch` | Final data modifications after validation (computed fields) |
| `AfterSave` | After data is saved to DB | `DLLParameterExecute` | External actions (email, API calls, file upload to external systems) |
| `AfterPermission` | After permissions are calculated | `DLLParameterSearch` / `DLLParameterExecute` | Permission-dependent logic |

**Important Notes:**

1. **`DLLParameterSearchAction` with `AfterSave` is NOT recommended** - The form data is already saved, so returning modified `List<DataItem>` would require implementing your own save logic.

2. **`DLLParameterExecuteAction` with `BeforeValidation`/`AfterValidation`** - Can be used but cannot modify form fields (only returns true/false).

**Choosing the Right Plugin Interface:**

| Interface | Purpose | Best ActionStart |
|-----------|---------|------------------|
| `IParameterSearchAction` | Modify/populate form data | `BeforeValidation`, `AfterValidation` |
| `IParameterExecuteAction` | Perform external action, return success/failure | `AfterSave` |
| `IParameterDownloadAction` | Generate and return file for download | Any |

**Practical Examples:**

```xml
<!-- IParameterSearchAction + BeforeValidation = Auto-fill form fields -->
<!-- Example: Load customer data when customer ID is entered -->
<Action xsi:type="DLLParameterSearch" DLLIdent="CustomerLookup" ActionStart="BeforeValidation">

<!-- IParameterSearchAction + AfterValidation = Calculate values before save -->
<!-- Example: Calculate total price from quantity and unit price -->
<Action xsi:type="DLLParameterSearch" DLLIdent="PriceCalculator" ActionStart="AfterValidation">

<!-- IParameterExecuteAction + AfterSave = Send notification/sync external system -->
<!-- Example: Send email notification after order is saved -->
<Action xsi:type="DLLParameterExecute" DLLIdent="OrderNotification" ActionStart="AfterSave">

<!-- IParameterExecuteAction + AfterSave = Upload file to external storage -->
<!-- Example: Upload document to SharePoint after record save -->
<Action xsi:type="DLLParameterExecute" DLLIdent="SharePointUpload" ActionStart="AfterSave">
```

**Data Flow in IParameterSearchAction (BeforeValidation/AfterValidation):**

```
User submits form
       ↓
[BeforeValidation] → Plugin.Start(data) → Modified Data → Validation
       ↓
[AfterValidation] → Plugin.Start(data) → Modified Data → Save to DB
```

The plugin receives `List<DataItem>` and returns modified `List<DataItem>` that updates form fields before save.

**Data Flow in IParameterExecuteAction (AfterSave):**

```
Data saved to DB
       ↓
[AfterSave] → Plugin.Start(formIdent, ids, xml) → true/false
                                                ↓
                                  External Action (email, API, file upload)
```

The plugin performs an external action after data is already persisted.

---

## 10. Loading Third-Party Libraries (DependencyAssembly)

If plugin needs to load external libraries (NuGet packages), use `SFP.Kernel.Common.DependencyAssembly`.

```csharp
using SFP.Kernel.Common;

public class MyPlugin : IParameterExecuteAction
{
    private DependencyAssembly _dependencyAssembly;

    [Inject]
    public MyPlugin(ILogger<MyPlugin> logger)
    {
        _dependencyAssembly = new DependencyAssembly();

        // Load external libraries
        _dependencyAssembly.LoadAssembly("Newtonsoft.Json");
    }

    public void Dispose()
    {
        // IMPORTANT: Always dispose!
        _dependencyAssembly?.Dispose();
    }
}
```

---

## 11. Working with Proxy (ProxyConfig and HttpClient)

When your plugin needs to communicate with external APIs or services via HTTP/HTTPS, you should support proxy configuration. SFP provides `ProxyConfig` model and extension methods to easily configure HttpClient with proxy settings.

### 11.1 ProxyConfig Model

The `ProxyConfig` model is available in `SFP.Common.Models.Configs`:

```csharp
namespace SFP.Common.Models.Configs
{
    public class ProxyConfig
    {
        /// <summary>
        /// Proxy server address (e.g., "proxy.company.com")
        /// </summary>
        public string Address { get; set; }

        /// <summary>
        /// Proxy server port (e.g., 8080)
        /// </summary>
        public int Port { get; set; }

        /// <summary>
        /// Username for proxy authentication
        /// </summary>
        public string UserName { get; set; }

        /// <summary>
        /// Password for proxy authentication
        /// </summary>
        public string Password { get; set; }

        /// <summary>
        /// Domain for proxy authentication
        /// </summary>
        public string Domain { get; set; }
    }
}
```

### 11.2 ProxyConfig Extension Method

The `CreateWebProxy()` extension method is available in `SFP.Common.Extensions`:

```csharp
using SFP.Common.Extensions;
using System.Net;

// Extension method signature
public static WebProxy CreateWebProxy(this ProxyConfig proxyConfig)
```

This method:
- Returns `null` if proxy is not configured (Address is empty)
- Creates `WebProxy` with address and optional port
- Sets credentials if UserName and Password are provided
- Supports domain authentication

### 11.3 Injecting ProxyConfig in Plugin

Use `IOptions<ProxyConfig>` to inject proxy configuration:

```csharp
using Microsoft.Extensions.Options;
using SFP.Common.Models.Configs;
using SFP.Common.Extensions;
using System.Net.Http;

public class MyApiPlugin : IParameterExecuteAction
{
    private readonly ProxyConfig _proxyConfig;
    private readonly ILogger<MyApiPlugin> _logger;
    private HttpClient _httpClient;
    private HttpClientHandler _httpClientHandler;

    [Inject]
    public MyApiPlugin(
        IOptions<ProxyConfig> proxyConfig,
        ILogger<MyApiPlugin> logger)
    {
        this._proxyConfig = proxyConfig.Value;
        this._logger = logger;
    }

    public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
    {
        try
        {
            // Create HttpClientHandler with proxy
            this._httpClientHandler = new HttpClientHandler();

            var webProxy = this._proxyConfig.CreateWebProxy();
            if (webProxy != null)
            {
                this._httpClientHandler.Proxy = webProxy;
                this._httpClientHandler.UseProxy = true;
            }

            // Create HttpClient with handler
            this._httpClient = new HttpClient(this._httpClientHandler);

            // Use HttpClient for API calls
            var response = this._httpClient.GetAsync("https://api.example.com/data").Result;
            // ...

            return true;
        }
        catch (Exception ex)
        {
            this._logger.LogError(ex, "MyApiPlugin.Start.Exception");
            return false;
        }
    }

    public void Dispose()
    {
        this._httpClient?.Dispose();
        this._httpClientHandler?.Dispose();
    }
}
```

### 11.4 Complete Example - Azure Graph API with Proxy

Real-world example based on `SFP.EmailSender.Services.AzureEmailService`:

```csharp
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using SFP.Common.Models.Configs;
using SFP.Common.Extensions;
using SFP.Common.Services.Interfaces;
using SFP.Kernel.Model.Attributes.Plugins;
using Azure.Core;
using Azure.Core.Pipeline;
using Azure.Identity;
using Microsoft.Graph;
using System.Net.Http;

namespace MyPlugin.Actions
{
    public class AzureGraphAction : IParameterExecuteAction
    {
        private readonly ProxyConfig _proxyConfig;
        private readonly ILogger<AzureGraphAction> _logger;
        private readonly IEventLogService _eventLogService;

        private HttpClient _httpClient;
        private GraphServiceClient _graphClient;
        private HttpClientHandler _httpClientHandler;

        [Inject]
        public AzureGraphAction(
            IOptions<ProxyConfig> proxyConfig,
            ILogger<AzureGraphAction> logger,
            IEventLogService eventLogService)
        {
            this._proxyConfig = proxyConfig.Value;
            this._logger = logger;
            this._eventLogService = eventLogService;
        }

        public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
        {
            try
            {
                // Initialize Graph client with proxy support
                var graphClient = this.GetAuthenticatedGraphClient();

                // Use Graph API
                // var user = graphClient.Users["user@domain.com"].GetAsync().Result;

                return true;
            }
            catch (Exception ex)
            {
                this._logger.LogError(ex, "AzureGraphAction.Start.Exception");
                this._eventLogService.LogError(ex.ToString(), "AzureGraphAction.Start.Exception");
                return false;
            }
        }

        /// <summary>
        /// Creates authenticated Graph client with proxy support
        /// </summary>
        private GraphServiceClient GetAuthenticatedGraphClient()
        {
            var scopes = new[] { "https://graph.microsoft.com/.default" };

            // Configure token credential with proxy
            var tokenCredentialOptions = new TokenCredentialOptions();
            tokenCredentialOptions.AuthorityHost = AzureAuthorityHosts.AzurePublicCloud;

            // Create HttpClientHandler with proxy
            this._httpClientHandler = new HttpClientHandler();
            var webProxy = this._proxyConfig.CreateWebProxy();

            if (webProxy != null)
            {
                // Set proxy for HttpClient
                this._httpClientHandler.Proxy = webProxy;
                this._httpClientHandler.UseProxy = true;

                // Set proxy for Azure token credential transport
                tokenCredentialOptions.Transport = new HttpClientTransport(new HttpClientHandler
                {
                    Proxy = this._proxyConfig.CreateWebProxy(),
                    UseProxy = true
                });
            }

            // Create credential with proxy support
            TokenCredential credential = new ClientSecretCredential(
                tenantID: "your-tenant-id",
                clientID: "your-client-id",
                clientSecret: "your-client-secret",
                options: tokenCredentialOptions);

            // Create HttpClient and Graph client
            this._httpClient = new HttpClient(this._httpClientHandler);
            this._graphClient = new GraphServiceClient(this._httpClient, credential, scopes);

            return this._graphClient;
        }

        public void Dispose()
        {
            this._graphClient?.Dispose();
            this._httpClient?.Dispose();
            this._httpClientHandler?.Dispose();
        }
    }
}
```

### 11.5 Key Points

**Required Namespaces:**
```csharp
using Microsoft.Extensions.Options;
using SFP.Common.Models.Configs;
using SFP.Common.Extensions;
using System.Net;
using System.Net.Http;
```

**Injection:**
- Use `IOptions<ProxyConfig>` in constructor
- Access config via `.Value` property

**HttpClientHandler Setup:**
```csharp
this._httpClientHandler = new HttpClientHandler();
var webProxy = this._proxyConfig.CreateWebProxy();
if (webProxy != null)
{
    this._httpClientHandler.Proxy = webProxy;
    this._httpClientHandler.UseProxy = true;
}
this._httpClient = new HttpClient(this._httpClientHandler);
```

**Always Dispose:**
- HttpClient
- HttpClientHandler
- GraphServiceClient (if used)

**Azure-Specific:**
- Set proxy for both HttpClientHandler AND TokenCredentialOptions.Transport
- This ensures proxy is used for both token acquisition and API calls

### 11.6 Configuration in appsettings.json

ProxyConfig is typically configured in `appsettings.json`:

```json
{
  "ProxyConfig": {
    "Address": "proxy.company.com",
    "Port": 8080,
    "UserName": "domain\\username",
    "Password": "password",
    "Domain": "DOMAIN"
  }
}
```

**Note:** Leave `Address` empty to disable proxy:
```json
{
  "ProxyConfig": {
    "Address": "",
    "Port": 0
  }
}
```

---

## 12. Error Logging (REQUIRED)

**IMPORTANT:** When an error occurs in a plugin, you MUST use `IEventLogService` to write to the central log.

### 11.1 Logging Methods

```csharp
// For errors (in try-catch blocks)
_eventLogService.LogError(ex.ToString(), "MyPlugin.Start.Error");

// For warnings (application can continue)
_eventLogService.LogWarning("Data is empty", "MyPlugin.Start.NoData");

// For info (use sparingly!)
_eventLogService.LogInfo("Processed 10 records", "MyPlugin.Start.Info");
```

### 11.2 Path Parameter Format

Recommended format: `ClassName.MethodName.Info`

Examples:
- `MyPlugin.Start.Error`
- `InvoiceProcessor.ProcessItem.ValidationFailed`
- `AIChatAction.Start.Deserialize`

---

## 13. Data Models

### 12.1 DataItem

Represents a data item from a form.

```csharp
public class DataItem
{
    public string Ident { get; set; }       // Column/field name (matches ControlIdent)
    public object Value { get; set; }       // Value
    public string DataType { get; set; }    // Data type
    public string FormIdent { get; set; }   // Form identifier
    public string Title { get; set; }       // Display title
}

// Usage
var dataItem = new DataItem("EmailTo", "user@example.com");

// Reading value from collection (using extension method)
string value = data.Get<string>("EmailTo");
```

### 12.2 File (Complete Model)

Represents a file stored in SFP. Location: `SFP.Kernel.DAL.Models.File`

```csharp
public class File
{
    // Primary key
    public int ID { get; set; }

    // File content
    public byte[] Data { get; set; }            // Binary file content
    public string Name { get; set; }            // File name
    public string Extension { get; set; }       // File extension (.pdf, .jpg, etc.)
    public string ContentType { get; set; }     // MIME type (application/pdf, image/jpeg, etc.)
    public decimal Size { get; set; }           // File size in bytes

    // Form association
    public string FormIdent { get; set; }       // Form identifier
    public string ControlIdent { get; set; }    // Control identifier
    public int TableID { get; set; }            // Record ID in form table

    // User tracking
    public int AccountID { get; set; }          // Creator user ID
    public DateTime CreateDate { get; set; }    // Creation date
    public int? LastUpdateAccountID { get; set; }  // Last modifier user ID
    public DateTime? LastUpdate { get; set; }   // Last modification date

    // State management
    public byte State { get; set; }             // File state
    public StateTypes StateType { get; set; }   // State type enum

    // File placement
    public string Placement { get; set; }       // Placement (Left, Right, etc.)
    public PlacementTypes PlacementType { get; set; }  // Placement type enum

    // Grouping and identification
    public Guid DataGuid { get; set; }          // Unique file data GUID
    public Guid GroupIdent { get; set; }        // Group identifier for versioning

    // Locking
    public bool IsLock { get; set; }            // Is file locked?
    public int? LockAccountID { get; set; }     // User who locked the file

    // External storage
    public string ExternalStorageIdent { get; set; }  // External storage identifier
    public string Path { get; set; }            // Path in external storage

    // Additional metadata (from MetaData partial class)
    public bool IsSession { get; set; }         // Is stored in session?
    public bool IsCanTemporaryDelete { get; set; }  // Can be temporarily deleted?
    public bool IsOtherSource { get; set; }     // Is from external source?
    public bool IsSelect { get; set; }          // Is selected?
    public bool IsFileView { get; set; }        // Uploaded via FileView?
    public bool IsEdit { get; set; }            // Can edit?
    public bool IsDelete { get; set; }          // Can delete?
    public string AccountFullName { get; set; } // Creator full name
    public string LastUpdateAccountFullName { get; set; }  // Last modifier full name
    public Guid Token { get; set; }             // Access token
    public List<DataItem> FormData { get; set; }  // Extended form data
    public List<string> SettingPermissions { get; set; }  // Permissions
}
```

**Usage example:**
```csharp
// Get file by ID
File file = _fileService.GetFile(fileId);

if (file != null && file.Data != null)
{
    // File content is available
    byte[] content = file.Data;
    string fileName = file.Name;
    string mimeType = file.ContentType;

    // Upload to external service
    await externalService.UploadAsync(content, fileName, mimeType);
}
```

### 12.3 DataSourceParameter (Complete Model)

Parameters for DataSource operations. Location: `SFP.Kernel.Model.Models.Parameters.DataSourceParameter`

```csharp
public class DataSourceParameter
{
    // Constructor
    public DataSourceParameter() { }
    public DataSourceParameter(bool isDataSourceDeepClose) { }

    // Data collections
    public List<DataItem> DataItems { get; set; }           // Current form data
    public List<DataItem> OldDataItems { get; set; }        // Previous form data
    public List<DataItem> ParentDataItems { get; set; }     // Parent form data
    public List<DataItem> SelectedValueData { get; set; }   // Previously selected values
    public List<DataItem> QueryStringDataItems { get; set; } // Data from query string
    public List<DataItem> POSTDataItems { get; set; }       // Data from POST
    public List<DataItem> ExtensionData { get; set; }       // Extension/custom data
    public List<DataItem> SpecifyData { get; set; }         // Specific data
    public List<DataItem> HTMLAttributeDataItems { get; set; } // HTML attribute data

    // User context
    public int AccountID { get; set; }          // User account ID
    public int LanguageID { get; set; }         // User language ID
    public Guid? AnonymousID { get; set; }      // Anonymous user ID
    public List<string> Permissions { get; set; }  // User permissions

    // Form context
    public string FormIdent { get; set; }       // Form identifier
    public string Ident { get; set; }           // Custom identifier

    // **ID Collection - IMPORTANT for loops!**
    public List<string> ID { get; set; }        // List of IDs for iteration

    // Pagination
    public int StartPage { get; set; }          // Start page
    public int EndPage { get; set; }            // End page

    // Sorting
    public List<SortColumn> SortColumns { get; set; }  // Sort columns

    // Date filters
    public DateTime DateFrom { get; set; }      // Date from
    public DateTime DateTo { get; set; }        // Date to
    public DateTime LastRunDate { get; set; }   // Last run date

    // File handling
    public int FileID { get; set; }             // File ID
    public List<File> MemoryFiles { get; set; } // Files in memory

    // Table data - for passing multiple rows to SQL (see section 12.4)
    public List<VariableTableData> VariableTableData { get; set; }

    // Deep clone settings - IMPORTANT for loops!
    public bool IsDataSourceDeepClose { get; set; }  // Clone DataSource in loop
    public DeepCloneHelper.DeepCloneTypes DeepCloneType { get; set; }  // Clone method

    // Other
    public string MenuFolderTreeIdent { get; set; }
    public string DeviceIdent { get; set; }
    public int ResultListID { get; set; }
    public string SegmentFilter { get; set; }
    public string TabIdent { get; set; }
    public List<int> SelectedRows { get; set; }
    public string Token { get; set; }
    public object Value { get; set; }
    public int WorkFlowState { get; set; }
    public List<string> WorkFlowPermissions { get; set; }
    public string SegmentType { get; set; }
    public int CommunicationID { get; set; }
    public string PathURL { get; set; }
    public List<IdentValue> LocalVariables { get; set; }
    public string XMLIdent { get; set; }
    public XMLDefinition.XMLTypes XMLType { get; set; }
}
```

**Important: Using ID property and IsDataSourceDeepClose in loops:**

```csharp
// When iterating over multiple records with DataSource
public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
{
    // Prepare parameter with IDs
    DataSourceParameter param = new DataSourceParameter(isDataSourceDeepClose: true);
    param.ID = ids.Select(id => id.ToString()).ToList();  // Pass IDs as strings
    param.IsDataSourceDeepClose = true;  // IMPORTANT: Clone DataSource for each iteration

    // In XML DataSource, use @ID parameter
    // <SQL>SELECT * FROM table WHERE ID IN (SELECT value FROM @ID)</SQL>

    // Or iterate manually
    foreach (var id in ids)
    {
        DataSourceParameter itemParam = new DataSourceParameter(isDataSourceDeepClose: true);
        itemParam.ID = new List<string> { id.ToString() };

        var rows = _dataSourceService.GetDataSource(setting.DataSource, itemParam);
        // Process each row...
    }
}
```

### 12.4 VariableTableData (Passing Table Data to SQL)

`VariableTableData` allows you to pass tabular data (multiple rows) to SQL queries as a table variable. This is useful when you need to:
- Pass a list of items to a stored procedure
- Insert multiple rows at once
- Join dynamic data with database tables

**Location:** `SFP.Kernel.Model.Models.VariableTableData`

```csharp
public class VariableTableData
{
    /// <summary>
    /// Form definition (use when data comes from a form)
    /// </summary>
    public Form.Form Form { get; set; }

    /// <summary>
    /// Control identifier - used to match with #VARIABLECONTROLTABLE[Ident;ControlIdent]#
    /// </summary>
    public string ControlIdent { get; set; }

    /// <summary>
    /// Constant type identifier - used to match with #VARIABLECONSTANTTYPETABLE[Ident;ConstantType]#
    /// </summary>
    public string ConstantType { get; set; }

    /// <summary>
    /// Column definitions (when Form is not used)
    /// </summary>
    public List<FormControl> Controls { get; set; }

    /// <summary>
    /// Row data - Dictionary where key is row index, value is list of DataItems
    /// </summary>
    public Dictionary<int, List<DataItem>> Rows { get; set; }
}
```

**How to use:**
1. Create a `VariableTableData` with column definitions (`Controls`) and row data (`Rows`)
2. Set `ControlIdent` to identify the table (used by DataSource configuration)
3. Add it to `DataSourceParameter.VariableTableData`
4. Execute DataSource - the service handles SQL generation internally

**Practical Example - Passing AI Chat Messages to SQL:**

```csharp
using SFP.Kernel.Model.Models;
using SFP.Kernel.Model.Form.Controls;
using SFP.Kernel.Model.Commons;

public List<DataItem> Start(List<DataItem> data, out bool isFind, XmlNode xmlContent)
{
    isFind = false;

    // ... get AI response with messages ...

    // 1. Create DataSourceParameter
    DataSourceParameter dataSourceParameter = new DataSourceParameter();
    dataSourceParameter.DataItems = data;
    user.ConvertToDataSourceParameter(dataSourceParameter, this._userService);

    // 2. Add extra data to ExtensionData (single values)
    dataSourceParameter.ExtensionData = new List<DataItem>();
    dataSourceParameter.ExtensionData.Add(new DataItem("PromptTokens", result.Usage.PromptTokens));
    dataSourceParameter.ExtensionData.Add(new DataItem("CompletionTokens", result.Usage.CompletionTokens));
    dataSourceParameter.ExtensionData.Add(new DataItem("TotalTokens", result.Usage.TotalTokens));

    // 3. Create VariableTableData for multiple messages
    dataSourceParameter.VariableTableData = new List<VariableTableData>();

    VariableTableData variableTableData = new VariableTableData();
    variableTableData.ControlIdent = "Message";  // Used to match in SQL

    // 4. Define columns (like table schema)
    variableTableData.Controls = new List<FormControl>();
    variableTableData.Controls.Add(new TextBoxControl()
    {
        Ident = "Role",
        DataType = CommonType.DataTypes.String
    });
    variableTableData.Controls.Add(new TextBoxControl()
    {
        Ident = "Content",
        DataType = CommonType.DataTypes.String
    });

    // 5. Add row data
    variableTableData.Rows = new Dictionary<int, List<DataItem>>();
    int rowIndex = 0;
    foreach (var message in result.Messages)
    {
        List<DataItem> rowData = new List<DataItem>();
        rowData.Add(new DataItem("Role", message.Role));
        rowData.Add(new DataItem("Content", message.Content));

        variableTableData.Rows.Add(rowIndex, rowData);
        rowIndex++;
    }

    dataSourceParameter.VariableTableData.Add(variableTableData);

    // 6. Execute DataSource with table data
    var rows = this._dataSourceService.GetDataSource(setting.ResultDataSource, dataSourceParameter);

    if (rows?.Any() ?? false)
    {
        isFind = true;
        return rows.FirstOrDefault().Value;
    }

    return null;
}
```

### 12.5 DataSourceParameter Properties Explained

Here's a detailed explanation of the key `DataSourceParameter` properties:

| Property | Type | Purpose |
|----------|------|---------|
| `DataItems` | `List<DataItem>` | Current form data - main source for `@Parameter` values |
| `OldDataItems` | `List<DataItem>` | Previous form data (before edit) - useful for comparison |
| `ParentDataItems` | `List<DataItem>` | Parent form data (for sub-forms) |
| `ExtensionData` | `List<DataItem>` | **Custom/extra data** - use for passing additional values not from form (e.g., API responses, computed values) |
| `SpecifyData` | `List<DataItem>` | Specific data for special cases |
| `QueryStringDataItems` | `List<DataItem>` | Data from URL query string |
| `POSTDataItems` | `List<DataItem>` | Data from HTTP POST body |
| `VariableTableData` | `List<VariableTableData>` | **Table data** - for passing multiple rows to SQL |
| `MemoryFiles` | `List<File>` | Files in memory (not yet saved to DB) |
| `AccountID` | `int` | Current user's account ID |
| `LanguageID` | `int` | Current user's language ID |
| `AnonymousID` | `Guid?` | Anonymous user identifier |
| `Permissions` | `List<string>` | Current user's permissions |
| `ID` | `List<string>` | List of record IDs for batch operations |
| `FormIdent` | `string` | Form identifier |
| `Ident` | `string` | Custom identifier (often set to `Guid.NewGuid().ToString()`) |

**Parameter Source in DataSource XML:**

When defining parameters in XML, use `Source` attribute to specify where the value comes from:

```xml
<Parameters>
    <!-- From DataItems (default) -->
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerID" DataType="Number" />

    <!-- From ExtensionData -->
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="TotalTokens" DataType="Number" SetDataType="ExtensionData" />

    <!-- From OldDataItems -->
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="OldStatus" DataType="Text" SetDataType="OldDataItems" />

    <!-- From ParentDataItems -->
    <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ParentID" DataType="Number" SetDataType="ParentDataItems" />
</Parameters>
```

---

## 14. Complete Example - IParameterSearchAction

Sample implementation with proper naming conventions:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SFP.Common.Extensions;
using SFP.Common.Models.Parameters;
using SFP.Common.Services.Interfaces;
using SFP.Kernel.Common;
using SFP.Kernel.Common.Helpers;
using SFP.Kernel.DAL.Extensions;
using SFP.Kernel.DAL.Models;
using SFP.Kernel.Model.Attributes.Plugins;
using System.Xml;

namespace MyPlugin.Actions
{
    public class MyAction : SFP.Kernel.Model.WorkFlow.Actions.Plugins.IParameterSearchAction
    {
        private DependencyAssembly _dependencyAssembly;
        private readonly ILogger<MyAction> _logger;
        private readonly IConfiguration _configuration;
        private readonly IDataSourceService _dataSourceService;
        private readonly IUserService _userService;
        private readonly IEventLogService _eventLogService;

        [Inject]
        public MyAction(
            ILogger<MyAction> logger,
            IConfiguration configuration,
            IDataSourceService dataSourceService,
            IUserService userService,
            IEventLogService eventLogService)
        {
            this._dependencyAssembly = new DependencyAssembly();
            this._logger = logger;
            this._configuration = configuration;
            this._dataSourceService = dataSourceService;
            this._userService = userService;
            this._eventLogService = eventLogService;
        }

        public List<DataItem> Start(List<DataItem> data, out bool isFind, XmlNode xmlContent)
        {
            isFind = false;

            try
            {
                // 1. Deserialize XML configuration
                string xml = SerializationHelper.SerializeToString(xmlContent);
                MySetting setting = SerializationHelper.Deserialize<MySetting>(xml);

                // 2. Validate configuration
                if (!(setting.InputDataSource?.IsSet() ?? false))
                {
                    this._logger.LogError("MyAction.Start - InputDataSource is not set");
                    this._eventLogService.LogError("InputDataSource is not set", "MyAction.Start");
                    return null;
                }

                // 3. Get user
                var user = this._userService.GetFromContext();
                if (user == null)
                {
                    this._eventLogService.LogWarning("User is not logged in", "MyAction.Start.NoUser");
                    return null;
                }

                // 4. Prepare DataSource parameters
                DataSourceParameter dataSourceParameter = new DataSourceParameter();
                dataSourceParameter.DataItems = data;
                dataSourceParameter.Ident = Guid.NewGuid().ToString();
                user.ConvertToDataSourceParameter(dataSourceParameter, this._userService);

                // 5. Get data from InputDataSource
                var rows = this._dataSourceService.GetDataSource(setting.InputDataSource, dataSourceParameter);
                if (!(rows?.Any() ?? false))
                {
                    this._logger.LogDebug("MyAction.Start - No data");
                    return null;
                }

                // 6. Process data
                List<DataItem> result = this.ProcessData(rows, setting);

                // 7. Process ResultDataSource (if defined)
                if (setting.ResultDataSource?.IsSet() ?? false)
                {
                    rows = this._dataSourceService.GetDataSource(setting.ResultDataSource, dataSourceParameter);
                    if (rows?.Any() ?? false)
                    {
                        isFind = true;
                        return rows.FirstOrDefault().Value;
                    }
                }

                // 8. Map results
                if (result?.Any() ?? false && (setting.Mappings?.Any() ?? false))
                {
                    List<DataItem> mappedResult = new List<DataItem>();
                    foreach (var mapping in setting.Mappings)
                    {
                        var item = result.FirstOrDefault(t => t.Ident == mapping.FromIdent);
                        if (item != null)
                        {
                            mappedResult.Add(new DataItem(mapping.ToIdent, item.Value));
                        }
                    }

                    isFind = true;
                    return mappedResult;
                }

                return null;
            }
            catch (Exception ex)
            {
                this._logger.LogError(ex, "MyAction.Start.Exception");
                this._eventLogService.LogError(ex.ToString(), "MyAction.Start.Exception");
                return null;
            }
        }

        private List<DataItem> ProcessData(Dictionary<int, List<DataItem>> rows, MySetting setting)
        {
            List<DataItem> result = new List<DataItem>();

            foreach (var key in rows.Keys)
            {
                var row = rows[key];

                // Read values using extension methods
                string name = row.Get<string>("Name");
                int count = row.Get<int>("Count");

                // Process data...
            }

            return result;
        }

        public void Dispose()
        {
            this._dependencyAssembly?.Dispose();
        }
    }
}
```

---

## 15. Practical Examples

### 15.1 Complete SharePoint Upload Plugin

Plugin that uploads files from SFP to SharePoint:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SFP.Common.Extensions;
using SFP.Common.Models.Parameters;
using SFP.Common.Services.Interfaces;
using SFP.Kernel.Common;
using SFP.Kernel.Common.Helpers;
using SFP.Kernel.DAL.Extensions;
using SFP.Kernel.DAL.Models;
using SFP.Kernel.Model.Attributes.Plugins;
using System.Xml;

namespace SharePointPlugin.Actions
{
    public class SharePointUploadAction : SFP.Kernel.Model.WorkFlow.Actions.Plugins.IParameterExecuteAction
    {
        private DependencyAssembly _dependencyAssembly;
        private readonly ILogger<SharePointUploadAction> _logger;
        private readonly IConfiguration _configuration;
        private readonly IDataSourceService _dataSourceService;
        private readonly IUserService _userService;
        private readonly IEventLogService _eventLogService;
        private readonly IFileService _fileService;

        [Inject]
        public SharePointUploadAction(
            ILogger<SharePointUploadAction> logger,
            IConfiguration configuration,
            IDataSourceService dataSourceService,
            IUserService userService,
            IEventLogService eventLogService,
            IFileService fileService)
        {
            this._dependencyAssembly = new DependencyAssembly();
            // Load SharePoint library
            this._dependencyAssembly.LoadAssembly("PnP.Framework");

            this._logger = logger;
            this._configuration = configuration;
            this._dataSourceService = dataSourceService;
            this._userService = userService;
            this._eventLogService = eventLogService;
            this._fileService = fileService;
        }

        public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
        {
            try
            {
                // 1. Parse XML configuration
                string xml = SerializationHelper.SerializeToString(xmlContent);
                SharePointSetting setting = SerializationHelper.Deserialize<SharePointSetting>(xml);

                // 2. Validate configuration
                if (string.IsNullOrEmpty(setting.SiteUrl))
                {
                    this._eventLogService.LogError("SiteUrl is not configured", "SharePointUpload.Start.Config");
                    return false;
                }

                // 3. Get user context
                var user = this._userService.GetFromContext();
                if (user == null)
                {
                    this._eventLogService.LogError("User not authenticated", "SharePointUpload.Start.NoUser");
                    return false;
                }

                // 4. Prepare DataSource parameters for file query
                DataSourceParameter param = new DataSourceParameter(isDataSourceDeepClose: true);
                param.ID = ids.Select(id => id.ToString()).ToList();
                param.Ident = Guid.NewGuid().ToString();
                user.ConvertToDataSourceParameter(param, this._userService);

                // 5. Get file IDs from DataSource
                var rows = this._dataSourceService.GetDataSource(setting.FileDataSource, param);
                if (!(rows?.Any() ?? false))
                {
                    this._logger.LogInformation("No files to upload");
                    return true;
                }

                // 6. Process each file
                int successCount = 0;
                foreach (var row in rows.Values)
                {
                    int fileId = row.Get<int>("FileID");
                    string targetPath = row.Get<string>("TargetPath") ?? setting.DefaultPath;

                    // Get file with binary data
                    File file = this._fileService.GetFile(fileId);
                    if (file?.Data == null)
                    {
                        this._eventLogService.LogWarning(
                            $"File {fileId} has no data",
                            "SharePointUpload.Start.NoData");
                        continue;
                    }

                    // Upload to SharePoint
                    bool uploaded = this.UploadToSharePoint(file, setting, targetPath);
                    if (uploaded) successCount++;
                }

                this._eventLogService.LogInfo(
                    $"Uploaded {successCount} files to SharePoint",
                    "SharePointUpload.Start.Success");

                return true;
            }
            catch (Exception ex)
            {
                this._logger.LogError(ex, "SharePointUploadAction.Start.Exception");
                this._eventLogService.LogError(ex.ToString(), "SharePointUploadAction.Start.Exception");
                return false;
            }
        }

        private bool UploadToSharePoint(File file, SharePointSetting setting, string targetPath)
        {
            try
            {
                // SharePoint upload implementation
                // Using PnP.Framework or Microsoft.SharePoint.Client

                this._logger.LogInformation(
                    $"Uploading {file.Name} ({file.Size} bytes) to {targetPath}");

                // ... SharePoint API calls ...

                return true;
            }
            catch (Exception ex)
            {
                this._eventLogService.LogError(
                    $"Failed to upload {file.Name}: {ex.Message}",
                    "SharePointUpload.Upload.Error");
                return false;
            }
        }

        public void Dispose()
        {
            this._dependencyAssembly?.Dispose();
        }
    }

    // Settings model for XML configuration
    public class SharePointSetting
    {
        [System.Xml.Serialization.XmlAttribute]
        public string SiteUrl { get; set; }

        [System.Xml.Serialization.XmlAttribute]
        public string DefaultPath { get; set; }

        [System.Xml.Serialization.XmlAttribute]
        public string ClientID { get; set; }

        [System.Xml.Serialization.XmlAttribute]
        public string ClientSecret { get; set; }

        public SFP.Kernel.Model.DataSource.DataSource FileDataSource { get; set; }
    }
}
```

**XML Workflow Configuration:**
```xml
<Action xsi:type="DLLParameterExecute" DLLIdent="SharePointUpload" ActionStart="AfterSave">
    <SharePointSetting
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
        SiteUrl="https://company.sharepoint.com/sites/documents"
        DefaultPath="/Shared Documents/Uploads"
        ClientID="your-client-id"
        ClientSecret="your-client-secret">
        <FileDataSource>
            <SQL>
                SELECT f.ID as FileID, '/Documents/' + @FormIdent as TargetPath
                FROM dbo.Files f
                WHERE f.TableID IN (SELECT value FROM @ID)
                  AND f.FormIdent = @FormIdent
            </SQL>
            <Parameters>
                <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="NumberList" />
                <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="FormIdent" DataType="Text" />
            </Parameters>
        </FileDataSource>
    </SharePointSetting>
</Action>
```

### 15.2 Auto-Fill Plugin (IParameterSearchAction)

Plugin that auto-fills form fields based on selected value:

```csharp
namespace AutoFillPlugin.Actions
{
    public class CustomerLookupAction : SFP.Kernel.Model.WorkFlow.Actions.Plugins.IParameterSearchAction
    {
        private readonly IDataSourceService _dataSourceService;
        private readonly IUserService _userService;
        private readonly IEventLogService _eventLogService;

        [Inject]
        public CustomerLookupAction(
            IDataSourceService dataSourceService,
            IUserService userService,
            IEventLogService eventLogService)
        {
            this._dataSourceService = dataSourceService;
            this._userService = userService;
            this._eventLogService = eventLogService;
        }

        public List<DataItem> Start(List<DataItem> data, out bool isFind, XmlNode xmlContent)
        {
            isFind = false;

            try
            {
                // Get customer ID from form data
                int? customerId = data.Get<int?>("CustomerID");
                if (!customerId.HasValue)
                    return null;

                // Parse settings
                string xml = SerializationHelper.SerializeToString(xmlContent);
                var setting = SerializationHelper.Deserialize<CustomerLookupSetting>(xml);

                // Prepare parameters
                var user = this._userService.GetFromContext();
                var param = new DataSourceParameter();
                param.DataItems = data;
                user.ConvertToDataSourceParameter(param, this._userService);

                // Execute lookup query
                var rows = this._dataSourceService.GetDataSource(setting.LookupDataSource, param);
                if (!(rows?.Any() ?? false))
                    return null;

                // Return data to fill form fields
                var customerData = rows.FirstOrDefault().Value;
                isFind = true;

                // Map fields using Mappings
                List<DataItem> result = new List<DataItem>();
                foreach (var mapping in setting.Mappings)
                {
                    var value = customerData.Get(mapping.FromIdent);
                    if (value != null)
                    {
                        result.Add(new DataItem(mapping.ToIdent, value));
                    }
                }

                return result;
            }
            catch (Exception ex)
            {
                this._eventLogService.LogError(ex.ToString(), "CustomerLookup.Start.Error");
                return null;
            }
        }

        public void Dispose() { }
    }
}
```

**XML Workflow Configuration:**
```xml
<!-- BeforeValidation is ideal for auto-fill - data is populated before validation -->
<Action xsi:type="DLLParameterSearch" DLLIdent="CustomerLookup" ActionStart="BeforeValidation">
    <CustomerLookupSetting
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
        <LookupDataSource>
            <SQL>
                SELECT Name, Email, Phone, Address, City, PostalCode
                FROM dbo.Customers
                WHERE ID = @CustomerID
            </SQL>
            <Parameters>
                <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CustomerID" DataType="Number" />
            </Parameters>
        </LookupDataSource>
        <Mappings>
            <Mapping FromIdent="Name" ToIdent="CustomerName" />
            <Mapping FromIdent="Email" ToIdent="CustomerEmail" />
            <Mapping FromIdent="Phone" ToIdent="CustomerPhone" />
            <Mapping FromIdent="Address" ToIdent="DeliveryAddress" />
            <Mapping FromIdent="City" ToIdent="DeliveryCity" />
            <Mapping FromIdent="PostalCode" ToIdent="DeliveryPostalCode" />
        </Mappings>
    </CustomerLookupSetting>
</Action>
```

---

## 16. Best Practices

### 16.1 Always Implement Dispose
```csharp
public void Dispose()
{
    _dependencyAssembly?.Dispose();
    // Release other resources
}
```

### 16.2 Always Log Errors Using IEventLogService
```csharp
catch (Exception ex)
{
    _logger.LogError(ex, "ClassName.MethodName.Exception");
    _eventLogService.LogError(ex.ToString(), "ClassName.MethodName.Exception");
    return false; // or null
}
```

### 16.3 Validate XML Configuration
```csharp
if (!(setting.InputDataSource?.IsSet() ?? false))
{
    _eventLogService.LogError("InputDataSource is not set", "Plugin.Start.Config");
    return null;
}
```

### 16.6 Always Include XML Namespaces in DataSource Configuration
```xml
<!-- ✅ CORRECT - With namespace declarations -->
<MySetting
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
    <MyDataSource>
        <SQL>SELECT * FROM table WHERE ID = @ID</SQL>
        <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
        </Parameters>
    </MyDataSource>
</MySetting>

<!-- ❌ WRONG - Missing namespaces -->
<MySetting>
    <MyDataSource>
        <SQL>SELECT * FROM table WHERE ID = @ID</SQL>
        <Parameters>
            <Parameter Name="ID" />
        </Parameters>
    </MyDataSource>
</MySetting>
```

**See section 8.4 for complete DataSource XML reference.**

### 16.4 Check for Null Values
```csharp
var user = _userService.GetFromContext();
if (user == null)
{
    _eventLogService.LogWarning("User is not logged in", "Plugin.Start.NoUser");
    return false;
}
```

### 16.5 Use Correct Path Format for Logging
```
ClassName.MethodName.Info
```

### 16.7 Write All Code in English
- Class names, method names, variable names, comments - everything in English
- This ensures consistency and maintainability across the codebase

### 16.8 Support Proxy Configuration for HTTP Communication
When your plugin communicates with external APIs, always support proxy configuration:

```csharp
[Inject]
public MyPlugin(IOptions<ProxyConfig> proxyConfig)
{
    this._proxyConfig = proxyConfig.Value;
}

// In Start() method:
this._httpClientHandler = new HttpClientHandler();
var webProxy = this._proxyConfig.CreateWebProxy();
if (webProxy != null)
{
    this._httpClientHandler.Proxy = webProxy;
    this._httpClientHandler.UseProxy = true;
}
this._httpClient = new HttpClient(this._httpClientHandler);
```

**See section 11 for complete proxy configuration guide.**

---

## 17. Configuration in appsettings.json

For custom plugin configuration, add a section to `appsettings.json`:

```json
{
  "MyPluginConfig": {
    "APIKey": "xxx",
    "Endpoint": "https://api.example.com"
  }
}
```

And load it in the plugin:

```csharp
public class MyPluginConfig
{
    public string APIKey { get; set; }
    public string Endpoint { get; set; }
}

[Inject]
public MyPlugin(IConfiguration configuration)
{
    _config = new MyPluginConfig();
    configuration.GetSection("MyPluginConfig").Bind(_config);
}
```

---

## 18. Troubleshooting

### Plugin Doesn't Load
1. Check the path in DLLSection
2. Verify that `ClassType` matches namespace and class name
3. Check that DLL contains all dependencies
4. Verify `TargetFramework` is `net8.0`

### DI Service is Null
1. Verify that constructor has `[Inject]` attribute
2. Check that service is registered in DI container

### XML Parsing Error
1. Verify that XML matches model structure
2. Check XML attributes (`[XmlAttribute]`)
3. Use `DefaultValue` for optional attributes

---

## 19. All Available SFP Services

All services are in namespace `SFP.Common.Services.Interfaces` and can be injected via `[Inject]`.

### 20.1 Core Services

| Service | Description |
|---------|-------------|
| `IUserService` | User management, authentication, permissions |
| `IFormService` | Form data operations (get, save, validate) |
| `IFileService` | File upload, download, management |
| `IDataSourceService` | Execute SQL DataSources |
| `IEventLogService` | Error and event logging (REQUIRED!) |
| `IConfigurationService` | SFP configuration access |
| `IWorkFlowService` | Workflow operations |
| `IPermissionService` | Permission checking |

### 20.2 Communication Services

| Service | Description |
|---------|-------------|
| `ICommunicationService` | Comments and communication management |
| `IHubClientService` | SignalR hub client |

### 20.3 Export/Import Services

| Service | Description |
|---------|-------------|
| `IExportService` | Export to CSV, TXT, XLSX |
| `IImportService` | Import data from files |
| `IPDFService` | PDF generation from forms, reports |
| `IDOCXService` | DOCX document generation |
| `IXLSXService` | Excel file operations |

### 19.4 Data Services

| Service | Description |
|---------|-------------|
| `IDataTableService` | DataTable formatting |
| `IDataViewService` | DataView operations |
| `IFilterService` | Filter operations |
| `IHistoryService` | Record history tracking |
| `IMultiSelectService` | Multi-select control data |
| `ISubFormService` | Sub-form operations |

### 19.5 UI Services

| Service | Description |
|---------|-------------|
| `ILanguageService` | Localization and translations |
| `IMenuFolderTreeService` | Menu tree operations |
| `IFolderService` | Folder operations |
| `IComponentService` | UI component services |
| `IRazorEngineService` | Razor template rendering |
| `ITextFormatterService` | Text formatting |

### 19.6 Security Services

| Service | Description |
|---------|-------------|
| `IACLService` | Access control lists |
| `IDataProtectionService` | Data encryption/decryption |
| `IFolderPermissionService` | Folder permissions |
| `IPermissionGroupService` | Permission groups |
| `IPermissionSettingService` | Permission settings |
| `IServerDataHackValidationService` | Input validation against hacks |

### 19.7 Utility Services

| Service | Description |
|---------|-------------|
| `ISessionStorageService` | Session storage operations |
| `ICacheReloadService` | Cache management |
| `IClearService` | Clear operations |
| `ITimeService` | Time-related operations |
| `IDebugService` | Debugging utilities |
| `IProfilerQueueService` | Performance profiling |

### 19.8 External Integration Services

| Service | Description |
|---------|-------------|
| `IAPICallService` | External API calls |
| `IGeocodeService` | Geocoding addresses |
| `IAddressValidationService` | Address validation |
| `ISignatureService` | Digital signatures |

### 19.9 Notification Services

| Service | Description |
|---------|-------------|
| `INotificationSettingService` | Notification settings |
| `ISLANotificationService` | SLA notifications |
| `IToDoListService` | To-do list management |
| `ITaskSchedulerService` | Scheduled tasks |

---

## 20. Database Access (Repository Pattern)

For direct database access, SFP uses repository pattern via `SFP.Kernel.DAL.DataFactories.SqlRepositoryFactory`.

### 20.1 Available Repositories

The following repositories are available through `IRepositoryFactory`:

**Core Repositories:**
- `ITableRepository` - Generic table operations
- `ISqlCommandRepository` - Raw SQL commands
- `IGenericCommandRepository` - Generic database commands
- `IAccountRepository` - User accounts
- `IFileRepository` - File storage
- `ILanguageRepository` - Languages
- `IResourceRepository` - Resources/translations

**Permission Repositories:**
- `IPermissionRepository` - Permissions
- `IRoleRepository` - Roles
- `IGroupRepository` - Groups
- `IGroupRoleRepository` - Group-role associations
- `IGroupAccountRepository` - Group-account associations

**Communication Repositories:**
- `ICommunicationRepository` - Communications
- `IEmailRepository` - Emails
- `IEmailFileRepository` - Email attachments
- `ISMSRepository` - SMS messages

**Workflow Repositories:**
- `IHistoryRepository` - History records
- `IEventLogRepository` - Event logs
- `IAuditLogRepository` - Audit logs

**File Repositories:**
- `IFileRepository` - Files
- `IFilePermissionRepository` - File permissions
- `IFileTokenRepository` - File access tokens
- `IFileTimestampRepository` - File timestamps

### 20.2 Using Repository in Plugin

**Important:** For most operations, use `IDataSourceService` instead of direct repository access. Direct repository access should only be used for complex scenarios.

```csharp
using SFP.Common.Models.Parameters;
using SFP.Kernel.DAL.DataFactories;
using SFP.Kernel.DAL.Interfaces;
using SFP.Kernel.DAL.Interfaces.Repositories;

public class MyPlugin : IParameterExecuteAction
{
    private readonly IConfiguration _configuration;

    [Inject]
    public MyPlugin(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public bool Start(string formIdent, List<int> ids, XmlNode xmlContent)
    {
        // Get connection string from configuration
        string connectionString = _configuration.GetConnectionString("DefaultConnection");

        // Create repository factory
        using (var factory = new SqlRepositoryFactory(connectionString, cache: null))
        {
            // Get specific repository
            var fileRepository = factory.CreateRepository<IFileRepository>();

            // Use repository
            var file = fileRepository.Get(fileId);

            // For transactions
            using (var transactionFactory = new SqlRepositoryFactory(connectionString, isTransaction: true, cache: null))
            {
                var repo = transactionFactory.CreateRepository<ITableRepository>();
                // ... operations ...
                transactionFactory.Commit();  // or RollBack()
            }
        }

        return true;
    }
}
```

### 20.3 DataSourceParameter with Repository

When using `SFP.Common.Models.Parameters.DataSourceParameter`, you can attach a repository:

```csharp
using SFP.Common.Models.Parameters;

// Extended DataSourceParameter with Repository property
public class DataSourceParameter : SFP.Kernel.Model.Models.Parameters.DataSourceParameter
{
    public IRepositoryFactory Repository { get; set; }
}

// Usage
var param = new DataSourceParameter();
param.Repository = factory;  // Attach repository factory
```

---

## 21. Reference

- **Plugin Interfaces:** `SFP.Kernel.Model.WorkFlow.Actions.Plugins`
- **Inject Attribute:** `SFP.Kernel.Model.Attributes.Plugins.InjectAttribute`
- **DependencyAssembly:** `SFP.Kernel.Common.DependencyAssembly`
- **SerializationHelper:** `SFP.Kernel.Common.Helpers.SerializationHelper`
- **Services:** `SFP.Common.Services.Interfaces`
- **Models:** `SFP.Kernel.DAL.Models`, `SFP.Common.Models`
- **DataSource:** `SFP.Kernel.Model.DataSource`
- **Extensions:** `SFP.Kernel.DAL.Extensions`, `SFP.Common.Extensions`
- **Repository Factory:** `SFP.Kernel.DAL.DataFactories.SqlRepositoryFactory`
- **Repository Interfaces:** `SFP.Kernel.DAL.Interfaces.Repositories`
