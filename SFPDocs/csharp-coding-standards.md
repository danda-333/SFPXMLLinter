# C# Coding Standards - SmartFormPlatform

**Version:** 1.0
**Target Framework:** .NET 8.0
**Last Updated:** 2026-01-30

---

## Table of Contents

1. [Language and Comments](#language-and-comments)
2. [Naming Conventions](#naming-conventions)
3. [Code Formatting](#code-formatting)
4. [Project Structure](#project-structure)
5. [Dependency Injection](#dependency-injection)
6. [Error Handling and Logging](#error-handling-and-logging)
7. [LINQ and Async Patterns](#linq-and-async-patterns)
8. [Repository Pattern](#repository-pattern)
9. [Service Pattern](#service-pattern)
10. [Best Practices](#best-practices)

---

## Language and Comments

### 1.1 Code Language

**MANDATORY: All code identifiers MUST be in English.**

```csharp
// ✅ CORRECT: English identifiers
public class InvoiceProcessor
{
    public void ProcessInvoice(int invoiceID)
    {
        var customerName = GetCustomerName(invoiceID);
    }
}

// ❌ WRONG: Czech identifiers
public class ZpracovatelFaktur
{
    public void ZpracujFakturu(int faktura_id)
    {
        var jmenoZakaznika = VratJmenoZakaznika(faktura_id);
    }
}
```

**Rules:**
- ✅ Class names: English
- ✅ Method names: English
- ✅ Property names: English
- ✅ Variable names: English (including local variables)
- ✅ Parameter names: English
- ✅ Namespace names: English

### 1.2 Comments and Documentation

**Current Practice:** Comments may be in Czech or English, but **English is strongly recommended** for:
- Public APIs
- Plugin development
- Shared libraries
- Open-source contributions

**XML Documentation:**
```csharp
/// <summary>
/// Processes invoice data and returns the result
/// </summary>
/// <param name="invoiceID">Invoice identifier</param>
/// <returns>Processing result</returns>
public bool ProcessInvoice(int invoiceID)
{
    // Implementation
}
```

**Inline Comments:**
```csharp
// ACCEPTABLE (existing code): Czech comments for internal logic
/// <summary>
/// Ziska detail zaznamu dle jejich ID
/// </summary>
public List<Communication> Get(List<int> ids)
{
    // Odstrani duplicity
    ids = ids.Distinct().ToList();
}

// RECOMMENDED (new code): English comments
/// <summary>
/// Gets communication records by their IDs
/// </summary>
public List<Communication> Get(List<int> ids)
{
    // Remove duplicates
    ids = ids.Distinct().ToList();
}
```

---

## Naming Conventions

### 2.1 Private Fields

**MANDATORY: Private fields MUST use underscore prefix and be accessed with `this._`**

```csharp
// ✅ CORRECT
public class UserService : IUserService
{
    private readonly ILogger<UserService> _logger;
    private readonly IRepositoryFactory _repository;
    private readonly IMemoryCache _cache;

    public UserService(
        ILogger<UserService> logger,
        IRepositoryFactory repository,
        IMemoryCache cache)
    {
        this._logger = logger;
        this._repository = repository;
        this._cache = cache;
    }

    public User GetUser(int id)
    {
        this._logger.LogInformation("Getting user {ID}", id);
        return this._repository.CreateRepository<IUserRepository>().Get(id);
    }
}

// ❌ WRONG: No underscore or no this._
private readonly ILogger<UserService> logger;  // Missing underscore
_logger.LogInformation("...");                 // Missing this.
```

### 2.2 Identifier Casing

| Identifier Type | Casing | Example |
|----------------|--------|---------|
| **Namespace** | PascalCase | `SFP.Kernel.DAL.SqlRepositories` |
| **Class** | PascalCase | `CommunicationRepository` |
| **Interface** | PascalCase with `I` prefix | `ICommunicationRepository` |
| **Method** | PascalCase | `GetCommunication`, `ProcessData` |
| **Property (public)** | PascalCase | `AccountID`, `FirstName`, `IsActive` |
| **Property (private)** | `_camelCase` | `_logger`, `_repository` |
| **Field (const)** | PascalCase | `DefaultTimeout`, `MaxRetries` |
| **Field (private const)** | `_camelCase` | `_cacheName`, `_defaultValue` |
| **Field (static readonly)** | PascalCase | `EmptyGuid` |
| **Parameter** | camelCase | `invoiceID`, `userName` |
| **Local variable** | camelCase | `userId`, `orderCount` |

### 2.3 ID vs Id Convention

**CRITICAL: Always use `ID` (uppercase), NEVER `Id`**

```csharp
// ✅ CORRECT
public int AccountID { get; set; }
public int SiteID { get; set; }
public int UserID { get; set; }
public int OrderID { get; set; }

public User GetUser(int userID)
{
    int accountID = userID;
}

// ❌ WRONG
public int AccountId { get; set; }  // Wrong casing
public int SiteId { get; set; }
public User GetUser(int userId)
```

**Exception:** Only when interfacing with external libraries that require `Id`:
```csharp
// External library requirement
public class ExternalModel
{
    [JsonProperty("id")]  // External API requirement
    public int Id { get; set; }
    
    // Internal mapping
    public int AccountID => Id;
}
```

### 2.4 Boolean Properties

**Prefix with `Is`, `Has`, `Can`, `Should`:**

```csharp
// ✅ CORRECT
public bool IsActive { get; set; }
public bool HasPermission { get; set; }
public bool CanEdit { get; set; }
public bool ShouldValidate { get; set; }

// ❌ WRONG
public bool Active { get; set; }
public bool Permission { get; set; }
```

### 2.5 Collections

**Use plural names for collections:**

```csharp
// ✅ CORRECT
public List<User> Users { get; set; }
public IEnumerable<Order> Orders { get; set; }
public Dictionary<int, Customer> Customers { get; set; }

// ❌ WRONG
public List<User> UserList { get; set; }  // Don't add "List" suffix
public IEnumerable<Order> OrderCollection { get; set; }
```

---

## Code Formatting

### 3.1 Indentation and Braces

**Use tabs for indentation, K&R style braces:**

```csharp
// ✅ CORRECT
public class MyService
{
    public void ProcessData(int id)
    {
        if (id > 0)
        {
            DoSomething();
        }
        else
        {
            DoSomethingElse();
        }
    }
}

// ❌ WRONG: Braces on same line (Allman style not used in this project)
public class MyService {
    public void ProcessData(int id) {
        if (id > 0) {
            DoSomething();
        }
    }
}
```

### 3.2 Line Length

**Prefer lines under 120 characters. Break long lines logically:**

```csharp
// ✅ CORRECT
public CommunicationRepository(
    SqlCommand entities,
    IMemoryCache cache,
    ILogger<CommunicationRepository> logger)
    : base(entities, cache)
{
    this._logger = logger;
}

// ✅ CORRECT: Long method call
var result = this._repository
    .CreateRepository<ICommunicationRepository>()
    .Get(ids);

// ❌ AVOID: Single very long line
public CommunicationRepository(SqlCommand entities, IMemoryCache cache, ILogger<CommunicationRepository> logger) : base(entities, cache) { this._logger = logger; }
```

### 3.3 Spacing

**Use spaces consistently:**

```csharp
// ✅ CORRECT
if (condition)
{
    DoSomething(parameter1, parameter2);
}

for (int i = 0; i < count; i++)
{
    Process(i);
}

var result = Calculate(x, y, z);

// ❌ WRONG: Missing spaces
if(condition)
{
    DoSomething(parameter1,parameter2);
}

for(int i=0;i<count;i++)
```

### 3.4 Using Statements

**Order using statements: System, then third-party, then project namespaces:**

```csharp
// ✅ CORRECT
using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using SFP.Kernel.DAL.Base;
using SFP.Kernel.DAL.Extensions;
using SFP.Kernel.DAL.Interfaces.Repositories;
using SFP.Kernel.DAL.Models;

// ❌ WRONG: Mixed order
using SFP.Kernel.DAL.Models;
using System;
using Microsoft.Data.SqlClient;
using System.Collections.Generic;
```

**Implicit usings in .csproj:**
```xml
<PropertyGroup>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

---

## Project Structure

### 4.1 Solution Organization

```
SmartFormPlatform/
├── SFP.Kernel.Common/          # Core utilities, helpers, models
├── SFP.Kernel.DAL/             # Data Access Layer (repositories)
│   ├── Base/                   # Base repository classes
│   ├── Extensions/             # Extension methods
│   ├── Interfaces/             # Repository interfaces
│   │   └── Repositories/       # Specific repository interfaces
│   ├── Models/                 # Data models
│   └── SqlRepositories/        # SQL repository implementations
├── SFP.Kernel.Model/           # Domain models (Form, WorkFlow, etc.)
│   ├── Form/
│   ├── Library/
│   ├── WorkFlow/
│   └── DataSource/
├── SFP.Common/                 # Common services
│   ├── Models/
│   ├── Services/
│   │   └── Interfaces/
│   └── Extensions/
├── SFP.Google/                 # External integrations
├── SmartFormPlatform/          # Main web application
├── WebAPI/                     # API project
└── [ConsoleApps]/              # EmailSender, DataSync, etc.
```

### 4.2 File Organization

**One class per file, filename matches class name:**

```
CommunicationRepository.cs
ICommunicationRepository.cs
Communication.cs
```

**Exception:** Nested classes, partial classes, or related small classes may share a file.

### 4.3 Namespace Structure

**Namespace MUST match folder structure:**

```csharp
// File: SFP.Kernel.DAL/SqlRepositories/CommunicationRepository.cs
namespace SFP.Kernel.DAL.SqlRepositories
{
    public class CommunicationRepository { }
}

// File: SFP.Common/Services/UserService.cs
namespace SFP.Common.Services
{
    public class UserService { }
}
```

---

## Dependency Injection

### 5.1 Constructor Injection (Recommended)

**Use constructor injection with readonly fields:**

```csharp
// ✅ CORRECT
public class UserService : IUserService
{
    private readonly ILogger<UserService> _logger;
    private readonly IRepositoryFactory _repository;
    private readonly IMemoryCache _cache;

    public UserService(
        ILogger<UserService> logger,
        IRepositoryFactory repository,
        IMemoryCache cache)
    {
        this._logger = logger ?? throw new ArgumentNullException(nameof(logger));
        this._repository = repository ?? throw new ArgumentNullException(nameof(repository));
        this._cache = cache ?? throw new ArgumentNullException(nameof(cache));
    }
}

// ❌ WRONG: Public setters on dependencies
public class UserService
{
    public ILogger Logger { get; set; }  // Don't use property injection for required dependencies
}
```

### 5.2 Service Registration

**Register services in `Program.cs` or `Startup.cs`:**

```csharp
// Scoped (per-request lifetime)
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IRepositoryFactory, SqlRepositoryFactory>();

// Singleton (application lifetime)
builder.Services.AddSingleton<IMemoryCache, MemoryCache>();

// Transient (new instance each time)
builder.Services.AddTransient<IEmailService, EmailService>();
```

### 5.3 Plugin Dependency Injection

**For plugins, use `[Inject]` attribute:**

```csharp
using SFP.Kernel.Model.Attributes.Plugins;

public class MyPlugin : IParameterExecuteAction
{
    private readonly ILogger<MyPlugin> _logger;
    private readonly IUserService _userService;

    [Inject]
    public MyPlugin(
        ILogger<MyPlugin> logger,
        IUserService userService)
    {
        this._logger = logger;
        this._userService = userService;
    }
}
```

---

## Error Handling and Logging

### 6.1 Exception Handling

**Use try-catch-finally appropriately:**

```csharp
// ✅ CORRECT
public bool ProcessData(int id)
{
    try
    {
        var data = this._repository.CreateRepository<IDataRepository>().Get(id);
        
        if (data == null)
        {
            this._logger.LogWarning("Data not found for ID: {ID}", id);
            return false;
        }

        // Process data
        return true;
    }
    catch (SqlException ex)
    {
        this._logger.LogError(ex, "Database error while processing ID: {ID}", id);
        this._eventLogService.LogError(ex.ToString(), "ProcessData.SqlError");
        throw;  // Re-throw to let caller handle
    }
    catch (Exception ex)
    {
        this._logger.LogError(ex, "Unexpected error while processing ID: {ID}", id);
        this._eventLogService.LogError(ex.ToString(), "ProcessData.Error");
        return false;
    }
}

// ❌ WRONG: Empty catch or catching Exception without logging
try
{
    ProcessData();
}
catch (Exception ex)
{
    // Silent failure - BAD!
}
```

### 6.2 Logging Levels

**Use appropriate log levels:**

```csharp
// Trace: Very detailed debugging information
this._logger.LogTrace("Entering method with parameter: {Param}", param);

// Debug: Debugging information useful during development
this._logger.LogDebug("Cache hit for key: {Key}", cacheKey);

// Information: General informational messages
this._logger.LogInformation("User {UserID} logged in successfully", userID);

// Warning: Potentially harmful situations
this._logger.LogWarning("User {UserID} attempted unauthorized access", userID);

// Error: Error events that might still allow the application to continue
this._logger.LogError(ex, "Failed to process order {OrderID}", orderID);

// Critical: Very severe error events that might cause the application to abort
this._logger.LogCritical(ex, "Database connection lost");
```

### 6.3 EventLog Service (REQUIRED for Production Errors)

**Use `IEventLogService` for production error logging:**

```csharp
public bool ProcessInvoice(int invoiceID)
{
    try
    {
        // Business logic
        return true;
    }
    catch (Exception ex)
    {
        // Log to file (ILogger) for developers
        this._logger.LogError(ex, "ProcessInvoice failed for {InvoiceID}", invoiceID);
        
        // Log to EventLog (IEventLogService) for system/production monitoring
        this._eventLogService.LogError(ex.ToString(), "InvoiceService.ProcessInvoice.Error");
        
        return false;
    }
}
```

**EventLog path format:** `ClassName.MethodName.ErrorType`

Examples:
- `UserService.GetUser.NotFound`
- `InvoiceService.ProcessInvoice.Error`
- `CommunicationRepository.Save.SqlException`

---

## LINQ and Async Patterns

### 7.1 LINQ Queries

**Prefer method syntax over query syntax (project convention):**

```csharp
// ✅ CORRECT: Method syntax
var activeUsers = users
    .Where(u => u.State == 1)
    .OrderBy(u => u.FullName)
    .Select(u => new { u.ID, u.FullName })
    .ToList();

// ❌ AVOID: Query syntax (less common in this project)
var activeUsers = (from u in users
                   where u.State == 1
                   orderby u.FullName
                   select new { u.ID, u.FullName })
                  .ToList();
```

**Use LINQ extension methods effectively:**

```csharp
// ✅ CORRECT: Readable and efficient
var hasActive = users.Any(u => u.State == 1);
var firstActive = users.FirstOrDefault(u => u.State == 1);
var activeCount = users.Count(u => u.State == 1);

// ❌ WRONG: Inefficient
var hasActive = users.Where(u => u.State == 1).Count() > 0;  // Use Any()
var firstActive = users.Where(u => u.State == 1).First();     // Use FirstOrDefault()
```

### 7.2 Async/Await

**Use async/await for I/O operations:**

```csharp
// ✅ CORRECT
public async Task<User> GetUserAsync(int userID)
{
    var user = await this._repository
        .CreateRepository<IUserRepository>()
        .GetAsync(userID);
        
    return user;
}

public async Task<(List<Error> Errors, List<string> FileNames)> ProcessAsync(
    List<IFormFile> files,
    bool isExistsNotOverwrite)
{
    List<Error> errors = new List<Error>();
    List<string> fileNames = new List<string>();
    
    foreach (var item in files)
    {
        errors.AddRange(await ProcessFileAsync(item, isExistsNotOverwrite));
    }
    
    return (errors, fileNames);
}

// ❌ WRONG: Blocking on async code
public User GetUser(int userID)
{
    return GetUserAsync(userID).Result;  // Deadlock risk!
}

// ❌ WRONG: Async without await
public async Task<User> GetUser(int userID)
{
    return this._repository.CreateRepository<IUserRepository>().Get(userID);
    // Remove async if not awaiting anything
}
```

**Naming:** Async methods should end with `Async` suffix.

---

## Repository Pattern

### 8.1 Repository Interface

**Define interface in `Interfaces/Repositories/`:**

```csharp
// File: SFP.Kernel.DAL/Interfaces/Repositories/ICommunicationRepository.cs
namespace SFP.Kernel.DAL.Interfaces.Repositories
{
    public interface ICommunicationRepository
    {
        /// <summary>
        /// Gets communication by ID
        /// </summary>
        Communication Get(int id);

        /// <summary>
        /// Gets communications by list of IDs
        /// </summary>
        List<Communication> Get(List<int> ids);

        /// <summary>
        /// Saves communication
        /// </summary>
        int Save(Communication communication);

        /// <summary>
        /// Deletes communication by ID
        /// </summary>
        void Delete(int id);

        /// <summary>
        /// Clears cache for Get method
        /// </summary>
        void ClearCacheGet();

        /// <summary>
        /// Gets communications with caching
        /// </summary>
        List<Communication> CacheGet();
    }
}
```

### 8.2 Repository Implementation

**Implement in `SqlRepositories/`:**

```csharp
// File: SFP.Kernel.DAL/SqlRepositories/CommunicationRepository.cs
using System;
using System.Collections.Generic;
using Microsoft.Data.SqlClient;
using System.Data;
using Microsoft.Extensions.Caching.Memory;
using SFP.Kernel.DAL.Base;
using SFP.Kernel.DAL.Extensions;
using SFP.Kernel.DAL.Interfaces.Repositories;
using SFP.Kernel.DAL.Models;

namespace SFP.Kernel.DAL.SqlRepositories
{
    public class CommunicationRepository : RepositoryBase, ICommunicationRepository
    {
        private const string _cacheName = "SFP.Kernel.DAL.SqlRepositories.CommunicationRepository.Get";

        public CommunicationRepository(SqlCommand entities, IMemoryCache cache)
            : base(entities, cache)
        {
        }

        public Communication Get(int id)
        {
            this.entities.Parameters.Clear();
            this.entities.CommandType = CommandType.StoredProcedure;
            this.entities.CommandText = "CommunicationByIDSelect";
            this.entities.Parameters.Add("@ID", SqlDbType.Int).Value = id;

            using (SqlDataReader dr = this.entities.ExecuteReader())
            {
                return dr.ReadDataItem<Communication>();
            }
        }

        public List<Communication> Get(List<int> ids)
        {
            this.entities.Parameters.Clear();
            this.entities.CommandType = CommandType.StoredProcedure;
            this.entities.CommandText = "CommunicationByListIDSelect";

            var idTable = this.entities.Parameters.Add("@IDs", SqlDbType.Structured);
            idTable.TypeName = "dbo.ListIntType";
            
            if (ids == null || ids.Count <= 0)
            {
                ids = new List<int> { -1 };
            }
            
            idTable.Value = ids.ListIntType();

            using (SqlDataReader dr = this.entities.ExecuteReader())
            {
                return dr.ReadDataList<Communication>();
            }
        }

        public void Delete(int id)
        {
            this.entities.Parameters.Clear();
            this.entities.CommandType = CommandType.StoredProcedure;
            this.entities.CommandText = "CommunicationDelete";
            this.entities.Parameters.Add("@ID", SqlDbType.Int).Value = id;

            this.entities.ExecuteNonQuery();
        }

        public void ClearCacheGet()
        {
            this.ClearCacheObject(_cacheName);
        }

        public List<Communication> CacheGet()
        {
            return this.CacheObject<List<Communication>>(
                _cacheName,
                delegate { return this.Get(); },
                DateTimeOffset.MaxValue);
        }
    }
}
```

### 8.3 Repository Pattern Rules

**Rules:**
- ✅ Inherit from `RepositoryBase`
- ✅ Accept `SqlCommand` and `IMemoryCache` in constructor
- ✅ Call base constructor: `: base(entities, cache)`
- ✅ Clear parameters before each command: `this.entities.Parameters.Clear()`
- ✅ Use stored procedures (preferred) or parameterized queries
- ✅ Use `using` statement for `SqlDataReader`
- ✅ Use extension methods: `ReadDataItem<T>()`, `ReadDataList<T>()`
- ✅ Implement caching methods with `CacheObject<T>()`
- ✅ Use const for cache keys: `private const string _cacheName`

---

## Service Pattern

### 9.1 Service Interface

**Define interface in `Services/Interfaces/`:**

```csharp
// File: SFP.Common/Services/Interfaces/IUserService.cs
namespace SFP.Common.Services.Interfaces
{
    /// <summary>
    /// User management service
    /// </summary>
    public interface IUserService
    {
        /// <summary>
        /// Gets currently logged-in user from context
        /// </summary>
        User GetFromContext();

        /// <summary>
        /// Checks if user has specific role
        /// </summary>
        bool IsInRole(string roleName, User user);

        /// <summary>
        /// Gets user's language code
        /// </summary>
        string GetLanguageCode();

        /// <summary>
        /// Gets user by ID
        /// </summary>
        User GetUser(int userID);

        /// <summary>
        /// Saves user
        /// </summary>
        int SaveUser(User user);
    }
}
```

### 9.2 Service Implementation

**Implement in `Services/`:**

```csharp
// File: SFP.Common/Services/UserService.cs
using Microsoft.Extensions.Logging;
using SFP.Common.Models;
using SFP.Common.Services.Interfaces;
using SFP.Kernel.DAL.Interfaces;
using SFP.Kernel.DAL.Interfaces.Repositories;

namespace SFP.Common.Services
{
    /// <inheritdoc/>
    public class UserService : IUserService
    {
        private readonly ILogger<UserService> _logger;
        private readonly IRepositoryFactory _repository;
        private readonly IHttpContextAccessor _httpContextAccessor;

        public UserService(
            ILogger<UserService> logger,
            IRepositoryFactory repository,
            IHttpContextAccessor httpContextAccessor)
        {
            this._logger = logger;
            this._repository = repository;
            this._httpContextAccessor = httpContextAccessor;
        }

        /// <inheritdoc/>
        public User GetFromContext()
        {
            var context = this._httpContextAccessor.HttpContext;
            if (context?.User?.Identity?.IsAuthenticated == true)
            {
                // Get user from context
                var userId = GetUserIdFromContext(context);
                return this.GetUser(userId);
            }

            return null;
        }

        /// <inheritdoc/>
        public bool IsInRole(string roleName, User user)
        {
            if (user == null || string.IsNullOrEmpty(roleName))
            {
                return false;
            }

            return user.Permissions?.Any(p => p.RoleName == roleName) ?? false;
        }

        /// <inheritdoc/>
        public string GetLanguageCode()
        {
            var user = this.GetFromContext();
            return user?.LanguageCode ?? "en";
        }

        /// <inheritdoc/>
        public User GetUser(int userID)
        {
            this._logger.LogDebug("Getting user {UserID}", userID);
            
            return this._repository
                .CreateRepository<IUserRepository>()
                .Get(userID);
        }

        /// <inheritdoc/>
        public int SaveUser(User user)
        {
            this._logger.LogInformation("Saving user {UserID}", user.ID);
            
            return this._repository
                .CreateRepository<IUserRepository>()
                .Save(user);
        }
    }
}
```

### 9.3 Service Pattern Rules

**Rules:**
- ✅ Use `/// <inheritdoc/>` when implementing interface methods
- ✅ Inject dependencies via constructor
- ✅ Use `IRepositoryFactory` to create repositories (don't inject individual repositories)
- ✅ Log important operations
- ✅ Validate input parameters
- ✅ Return meaningful results (avoid `void` when possible)
- ✅ Use async/await for I/O operations

---

## Best Practices

### 10.1 Null Checking

**Use null-conditional operators and null-coalescing:**

```csharp
// ✅ CORRECT
var name = user?.FullName ?? "Unknown";
var hasPermission = user?.Permissions?.Any(p => p.RoleName == "Admin") ?? false;

// ✅ CORRECT: ArgumentNullException for required parameters
public UserService(ILogger<UserService> logger)
{
    this._logger = logger ?? throw new ArgumentNullException(nameof(logger));
}

// ❌ AVOID: Verbose null checks
string name;
if (user != null)
{
    name = user.FullName;
}
else
{
    name = "Unknown";
}
```

### 10.2 String Handling

**Use string interpolation or `string.Format`:**

```csharp
// ✅ CORRECT
var message = $"User {userName} has {count} orders";
this._logger.LogInformation("Processing order {OrderID} for user {UserID}", orderID, userID);

// ❌ AVOID: String concatenation
var message = "User " + userName + " has " + count + " orders";
```

### 10.3 Collection Initialization

**Use collection initializers:**

```csharp
// ✅ CORRECT
var numbers = new List<int> { 1, 2, 3, 4, 5 };

var permissions = new List<string>
{
    "Admin",
    "Editor",
    "Viewer"
};

var dict = new Dictionary<string, int>
{
    ["One"] = 1,
    ["Two"] = 2,
    ["Three"] = 3
};

// ❌ AVOID: Verbose initialization
var numbers = new List<int>();
numbers.Add(1);
numbers.Add(2);
numbers.Add(3);
```

### 10.4 Using Statements

**Use `using` for disposable resources:**

```csharp
// ✅ CORRECT: using statement
using (SqlDataReader dr = this.entities.ExecuteReader())
{
    return dr.ReadDataItem<Communication>();
}

// ✅ CORRECT: using declaration (C# 8.0+)
using var connection = new SqlConnection(connectionString);
connection.Open();
// connection.Dispose() called automatically at end of scope

// ❌ WRONG: Manual disposal
var dr = this.entities.ExecuteReader();
try
{
    return dr.ReadDataItem<Communication>();
}
finally
{
    dr.Dispose();
}
```

### 10.5 Avoid Magic Numbers

**Use constants or enums:**

```csharp
// ✅ CORRECT
private const int DeletedState = 0;
private const int ActiveState = 1;
private const int MaxRetries = 3;

public bool IsDeleted => this.State == DeletedState;

// ❌ WRONG: Magic numbers
public bool IsDeleted => this.State == 0;  // What does 0 mean?
```

### 10.6 Extension Methods

**Place extension methods in `Extensions` folder/namespace:**

```csharp
// File: SFP.Kernel.DAL/Extensions/DataItemExtension.cs
namespace SFP.Kernel.DAL.Extensions
{
    public static class DataItemExtension
    {
        /// <summary>
        /// Gets value from DataItem list by ident
        /// </summary>
        public static T Get<T>(this List<DataItem> items, string ident)
        {
            var item = items?.FirstOrDefault(i => i.Ident == ident);
            
            if (item?.Value == null || item.Value == DBNull.Value)
            {
                return default(T);
            }

            return (T)Convert.ChangeType(item.Value, typeof(T));
        }

        /// <summary>
        /// Adds or updates DataItem in list
        /// </summary>
        public static void AddOrUpdate(this List<DataItem> items, string ident, object value)
        {
            var existing = items?.FirstOrDefault(i => i.Ident == ident);
            
            if (existing != null)
            {
                existing.Value = value;
            }
            else
            {
                items?.Add(new DataItem(ident, value));
            }
        }
    }
}
```

### 10.7 Immutability

**Prefer readonly fields and get-only properties when possible:**

```csharp
// ✅ CORRECT
public class UserInfo
{
    private readonly int _userId;
    private readonly string _userName;

    public UserInfo(int userId, string userName)
    {
        this._userId = userId;
        this._userName = userName;
    }

    public int UserID => this._userId;
    public string UserName => this._userName;
}

// ❌ AVOID: Mutable state when not needed
public class UserInfo
{
    public int UserID { get; set; }
    public string UserName { get; set; }
}
```

### 10.8 Performance Considerations

**Avoid unnecessary allocations:**

```csharp
// ✅ CORRECT: Reuse StringBuilder
var sb = new StringBuilder();
foreach (var item in items)
{
    sb.Append(item.Name);
    sb.Append(", ");
}

// ❌ WRONG: String concatenation in loop
string result = "";
foreach (var item in items)
{
    result += item.Name + ", ";  // Creates new string each iteration
}

// ✅ CORRECT: Use Any() instead of Count()
if (users.Any())
{
    // Process users
}

// ❌ WRONG: Count() when you only need to know if collection is non-empty
if (users.Count() > 0)
{
    // Process users
}
```

---

## Project-Specific Conventions

### 11.1 Target Framework

**All projects target .NET 8.0:**

```xml
<PropertyGroup>
  <TargetFramework>net8.0</TargetFramework>
</PropertyGroup>
```

### 11.2 Nullable Reference Types

**Disable nullable for legacy compatibility:**

```xml
<PropertyGroup>
  <Nullable>disable</Nullable>
</PropertyGroup>
```

### 11.3 Versioning

**Version numbers defined in `Directory.Build.props`:**

```xml
<PropertyGroup>
  <SFPVersion>8.1.8</SFPVersion>
  <SFPAssemblyVersion>8.1.8</SFPAssemblyVersion>
  <SFPFileVersion>8.1.8</SFPFileVersion>
  <InformationalVersion>8.1.8</InformationalVersion>
</PropertyGroup>
```

### 11.4 NuGet Packages

**Common packages used across projects:**

- `Microsoft.Data.SqlClient` - SQL Server connectivity
- `Microsoft.Extensions.Caching.Memory` - In-memory caching
- `Microsoft.Extensions.Logging` - Logging abstraction
- `Microsoft.Extensions.DependencyInjection` - DI container
- `Newtonsoft.Json` - JSON serialization (legacy)
- `System.Text.Json` - JSON serialization (preferred for new code)

---

## Code Review Checklist

Before submitting code for review, verify:

- [ ] All identifiers are in English
- [ ] Private fields use underscore prefix and `this._`
- [ ] ID uses uppercase `ID`, not `Id`
- [ ] Methods and properties use PascalCase
- [ ] Local variables and parameters use camelCase
- [ ] Boolean properties start with Is/Has/Can/Should
- [ ] Collections have plural names
- [ ] Proper using statements order (System, third-party, project)
- [ ] Appropriate exception handling with logging
- [ ] IEventLogService used for production errors
- [ ] Async methods end with `Async` suffix
- [ ] LINQ queries use method syntax (preferred)
- [ ] No magic numbers (use constants)
- [ ] Null checks use null-conditional operators
- [ ] Disposable resources wrapped in `using`
- [ ] XML documentation for public APIs
- [ ] Repository pattern followed (if applicable)
- [ ] Service pattern followed (if applicable)
- [ ] Constructor injection for dependencies
- [ ] Tests written (if test project exists)

---

## References

- [Plugin Development](plugin-development.md) - C# conventions specific to plugins
- [XML Conventions](xml-conventions.md) - XML formatting and naming standards
- [Microsoft C# Coding Conventions](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions)
- [.NET API Design Guidelines](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-30 | Initial version based on project analysis |
