# Library - XML Configuration Documentation

## Overview

**Library** is an IXMLDefinition type that manages SQL database objects (stored procedures, functions, views, and user-defined table types). Each Library definition creates or alters a corresponding database object.

**Key characteristics:**
- Defines SQL database objects
- Supports stored procedures, functions, views, and table types
- Command is executed during XML upload
- Can be versioned and tracked like other XML definitions
- Package dependencies for grouping related libraries

---

## XML Structure

### Minimal Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_GetActiveUsers"
         LibraryType="StoredProcedure">
	<Command><![CDATA[
		#MODIFIER# PROCEDURE #NAME#
		AS
		BEGIN
			SET NOCOUNT ON;
			SELECT ID, UserName, Email
			FROM dbo.Account
			WHERE [State] = 1
		END
	]]></Command>
</Library>
```

**Note:** `#MODIFIER#` and `#NAME#` are placeholders automatically replaced by the system:
- `#MODIFIER#` → `CREATE OR ALTER`
- `#NAME#` → `[dbo].[usp_GetActiveUsers]`

See [Placeholders in Command](#placeholders-in-command) for details.

---

## Library Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Database object name (without schema) |
| `LibraryType` | LibraryTypes | **Yes** | - | Type of database object (see enum below) |
| `Description` | string | No | "" | Human-readable description/notes about the library |

### LibraryTypes Enum

| Value | Description | SQL Object Type |
|-------|-------------|-----------------|
| `StoredProcedure` | SQL Stored Procedure | `CREATE PROCEDURE` |
| `Function` | SQL Function (scalar or table-valued) | `CREATE FUNCTION` |
| `TableType` | User-defined table type | `CREATE TYPE ... AS TABLE` |
| `View` | SQL View | `CREATE VIEW` |

---

## Child Elements

| Element | Type | Required | Description |
|---------|------|----------|-------------|
| `Command` | string | **Yes** | SQL command to create/alter the database object |
| `PackageIdents` | List&lt;string&gt; | No | Package dependencies (for grouping related libraries) |

### Command Element

**IMPORTANT:** Always wrap SQL commands in `<![CDATA[...]]>` to avoid XML parsing issues with special characters (`<`, `>`, `&`).

```xml
<Command><![CDATA[
	-- Your SQL code here
	-- Can contain <, >, & and other special characters
	CREATE OR ALTER PROCEDURE [dbo].[MyProc]
	AS
	BEGIN
		-- SQL statements
	END
]]></Command>
```

**Why CDATA?**
- SQL often contains comparison operators: `<`, `>`, `<=`, `>=`, `<>`
- Without CDATA, these characters break XML parsing
- CDATA ensures SQL remains readable and valid

### Placeholders in Command

SmartFormPlatform supports **placeholders (zástupné znaky)** in Library Command for automatic object naming and creation modifiers. This simplifies XML maintenance and ensures consistency.

| Placeholder | Description | Replaced With | Used In |
|-------------|-------------|---------------|---------|
| `#MODIFIER#` | SQL object creation/modification keyword | `CREATE OR ALTER`, `CREATE`, or `ALTER` | Function, View, StoredProcedure |
| `#NAME#` | Full database object name with schema | `[schema].[ObjectIdent]` | All types |

#### #MODIFIER# Placeholder

**Purpose:** Automatically determines whether to CREATE or ALTER the database object.

**Resolution logic:**
- If object doesn't exist → `CREATE`
- If object exists → `ALTER`
- On modern SQL Server → `CREATE OR ALTER` (recommended)

**Example:**
```xml
<Library Ident="fn_GetFullName" LibraryType="Function">
	<Command><![CDATA[
		#MODIFIER# FUNCTION #NAME#
		(
			@FirstName NVARCHAR(100),
			@LastName NVARCHAR(100)
		)
		RETURNS NVARCHAR(255)
		AS
		BEGIN
			RETURN LTRIM(RTRIM(@FirstName + ' ' + @LastName))
		END
	]]></Command>
</Library>
```

**System replaces with:**
```sql
CREATE OR ALTER FUNCTION [dbo].[fn_GetFullName]
(
	@FirstName NVARCHAR(100),
	@LastName NVARCHAR(100)
)
RETURNS NVARCHAR(255)
AS
BEGIN
	RETURN LTRIM(RTRIM(@FirstName + ' ' + @LastName))
END
```

**Note:** TableType does NOT support `#MODIFIER#` because SQL Server table types cannot be altered (must drop and recreate).

#### #NAME# Placeholder

**Purpose:** Automatically inserts full object name with schema prefix.

**Format:** `[schema].[Ident]`

**Schema resolution:**
- Default: `[dbo].[ObjectIdent]`
- Can be configured per environment

**Example:**
```xml
<Library Ident="vw_ActiveEmployees" LibraryType="View">
	<Command><![CDATA[
		#MODIFIER# VIEW #NAME#
		AS
		SELECT ID, FullName, Email
		FROM usr.Employee
		WHERE [State] = 3
	]]></Command>
</Library>
```

**System replaces with:**
```sql
CREATE OR ALTER VIEW [dbo].[vw_ActiveEmployees]
AS
SELECT ID, FullName, Email
FROM usr.Employee
WHERE [State] = 3
```

#### Benefits of Using Placeholders

✅ **Consistency** - Schema prefix is always correct
✅ **Portability** - Same XML works across environments (dev, test, prod)
✅ **Idempotency** - `CREATE OR ALTER` makes repeated uploads safe
✅ **Maintainability** - No need to manually write CREATE vs ALTER logic
✅ **Cleaner XML** - Less boilerplate in Command

#### When to Use Placeholders

**Use placeholders:**
- ✅ For Functions (scalar and table-valued)
- ✅ For Views
- ✅ For Stored Procedures
- ⚠️ For TableType (only `#NAME#`, not `#MODIFIER#`)

**Direct SQL (without placeholders):**
- When you need specific CREATE/ALTER logic
- When using complex DROP/CREATE sequences
- When schema must be explicitly controlled

#### Complete Examples with Placeholders

**Function:**
```xml
<Library Ident="tvf_GetUserPermissions" LibraryType="Function">
	<Command><![CDATA[
		#MODIFIER# FUNCTION #NAME#
		(
			@AccountID INT
		)
		RETURNS TABLE
		AS
		RETURN
		(
			SELECT DISTINCT p.Ident, p.Title
			FROM dbo.Permission p
			INNER JOIN dbo.GroupAccount ga ON p.GroupID = ga.GroupID
			WHERE ga.AccountID = @AccountID
		)
	]]></Command>
</Library>
```

**View:**
```xml
<Library Ident="vw_ProjectSummary" LibraryType="View">
	<Command><![CDATA[
		#MODIFIER# VIEW #NAME#
		AS
		SELECT
			p.ID,
			p.Name,
			COUNT(t.ID) AS TaskCount
		FROM usr.Project p
		LEFT JOIN usr.Task t ON p.ID = t.ProjectID
		WHERE p.[State] != 0
		GROUP BY p.ID, p.Name
	]]></Command>
</Library>
```

**Stored Procedure:**
```xml
<Library Ident="usp_GetEmployeeStats" LibraryType="StoredProcedure">
	<Command><![CDATA[
		#MODIFIER# PROCEDURE #NAME#
			@DepartmentID INT = NULL
		AS
		BEGIN
			SET NOCOUNT ON;
			
			SELECT
				COUNT(*) AS TotalEmployees,
				SUM(CASE WHEN [State] = 3 THEN 1 ELSE 0 END) AS ActiveCount
			FROM usr.Employee
			WHERE @DepartmentID IS NULL OR DepartmentID = @DepartmentID
		END
	]]></Command>
</Library>
```

**TableType (only #NAME#):**
```xml
<Library Ident="tt_IDList" LibraryType="TableType">
	<Command><![CDATA[
		IF TYPE_ID('#NAME#') IS NOT NULL
			DROP TYPE #NAME#
		GO
		
		CREATE TYPE #NAME# AS TABLE
		(
			ID INT NOT NULL PRIMARY KEY
		)
	]]></Command>
</Library>
```

**System replaces with:**
```sql
IF TYPE_ID('[dbo].[tt_IDList]') IS NOT NULL
	DROP TYPE [dbo].[tt_IDList]
GO

CREATE TYPE [dbo].[tt_IDList] AS TABLE
(
	ID INT NOT NULL PRIMARY KEY
)
```

---

## Naming Conventions

### Database Object Naming

Follow SQL Server naming conventions:

| Object Type | Prefix | Example |
|-------------|--------|---------|
| Stored Procedure | `usp_` | `usp_GetEmployeeStats` |
| Function (scalar) | `fn_` | `fn_CalculateTax` |
| Function (table-valued) | `tvf_` | `tvf_GetUserPermissions` |
| View | `vw_` | `vw_ActiveEmployees` |
| Table Type | `tt_` | `tt_IDList` |

### Library Ident

The `Ident` attribute should match the database object name **without schema prefix**:

```xml
<!-- CORRECT: Ident without schema -->
<Library Ident="usp_GetActiveUsers" LibraryType="StoredProcedure">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_GetActiveUsers]
		                          ^^^^^^
		                          Schema included in Command
	]]></Command>
</Library>

<!-- WRONG: Schema in Ident -->
<Library Ident="dbo.usp_GetActiveUsers" LibraryType="StoredProcedure">
```

### Schema Conventions

- **dbo schema**: System-wide utilities, shared functions
- **usr schema**: Application-specific objects (usually created via Form definitions)
- **Custom schemas**: Module-specific objects (e.g., `crm`, `hr`, `finance`)

---

## Examples by Type

### 1. Stored Procedure

#### Simple Procedure

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_GetEmployeeStats"
         LibraryType="StoredProcedure"
         Description="Returns employee statistics by department">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_GetEmployeeStats]
			@DepartmentID INT = NULL,
			@IncludeInactive BIT = 0
		AS
		BEGIN
			SET NOCOUNT ON;

			SELECT
				d.Name AS DepartmentName,
				COUNT(e.ID) AS TotalEmployees,
				SUM(CASE WHEN e.[State] = 3 THEN 1 ELSE 0 END) AS ActiveEmployees,
				SUM(CASE WHEN e.[State] != 3 THEN 1 ELSE 0 END) AS InactiveEmployees
			FROM usr.Employee e
			INNER JOIN usr.Department d ON e.DepartmentID = d.ID
			WHERE (@DepartmentID IS NULL OR e.DepartmentID = @DepartmentID)
			  AND (@IncludeInactive = 1 OR e.[State] = 3)
			GROUP BY d.ID, d.Name
			ORDER BY d.Name
		END
	]]></Command>
</Library>
```

#### Procedure with Output Parameters

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_CalculateInvoiceTotal"
         LibraryType="StoredProcedure"
         Description="Calculates invoice total with tax">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_CalculateInvoiceTotal]
			@InvoiceID INT,
			@SubTotal DECIMAL(18,2) OUTPUT,
			@TaxAmount DECIMAL(18,2) OUTPUT,
			@Total DECIMAL(18,2) OUTPUT
		AS
		BEGIN
			SET NOCOUNT ON;

			SELECT
				@SubTotal = SUM(Quantity * UnitPrice),
				@TaxAmount = SUM(Quantity * UnitPrice * TaxRate / 100)
			FROM usr.InvoiceItem
			WHERE InvoiceID = @InvoiceID

			SET @Total = ISNULL(@SubTotal, 0) + ISNULL(@TaxAmount, 0)
		END
	]]></Command>
</Library>
```

#### Procedure with Table-Valued Parameter

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_BulkUpdateEmployeeStatus"
         LibraryType="StoredProcedure"
         Description="Updates status for multiple employees">
	<PackageIdents>
		<string>LibraryTableTypes</string>
	</PackageIdents>
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_BulkUpdateEmployeeStatus]
			@EmployeeIDs [dbo].[tt_IDList] READONLY,
			@NewState INT,
			@UpdatedBy INT
		AS
		BEGIN
			SET NOCOUNT ON;

			UPDATE e
			SET
				e.[State] = @NewState,
				e.LastUpdate = GETDATE(),
				e.LastUpdateAccountID = @UpdatedBy
			FROM usr.Employee e
			INNER JOIN @EmployeeIDs ids ON e.ID = ids.ID

			SELECT @@ROWCOUNT AS UpdatedCount
		END
	]]></Command>
</Library>
```

---

### 2. Function

#### Scalar Function

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="fn_GetFullName"
         LibraryType="Function"
         Description="Concatenates name parts into full name">
	<Command><![CDATA[
		CREATE OR ALTER FUNCTION [dbo].[fn_GetFullName]
		(
			@Title NVARCHAR(50),
			@FirstName NVARCHAR(100),
			@LastName NVARCHAR(100)
		)
		RETURNS NVARCHAR(255)
		AS
		BEGIN
			DECLARE @FullName NVARCHAR(255)

			SET @FullName = LTRIM(RTRIM(
				ISNULL(@Title + ' ', '') +
				ISNULL(@FirstName + ' ', '') +
				ISNULL(@LastName, '')
			))

			RETURN @FullName
		END
	]]></Command>
</Library>
```

#### Inline Table-Valued Function

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="tvf_GetUserPermissions"
         LibraryType="Function"
         Description="Returns all permissions for a user">
	<Command><![CDATA[
		CREATE OR ALTER FUNCTION [dbo].[tvf_GetUserPermissions]
		(
			@AccountID INT
		)
		RETURNS TABLE
		AS
		RETURN
		(
			SELECT DISTINCT
				p.Ident AS PermissionIdent,
				p.Title AS PermissionTitle,
				r.Name AS RoleName
			FROM dbo.Permission p
			INNER JOIN dbo.Role r ON p.RoleID = r.ID
			INNER JOIN dbo.GroupRole gr ON r.ID = gr.RoleID
			INNER JOIN dbo.GroupAccount ga ON gr.GroupID = ga.GroupID
			WHERE ga.AccountID = @AccountID
			  AND ga.[State] = 1
		)
	]]></Command>
</Library>
```

#### Multi-Statement Table-Valued Function

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="tvf_GetEmployeeHierarchy"
         LibraryType="Function"
         Description="Returns employee hierarchy with recursive CTE">
	<Command><![CDATA[
		CREATE OR ALTER FUNCTION [dbo].[tvf_GetEmployeeHierarchy]
		(
			@RootEmployeeID INT
		)
		RETURNS @Hierarchy TABLE
		(
			EmployeeID INT,
			EmployeeName NVARCHAR(200),
			ManagerID INT,
			Level INT,
			HierarchyPath NVARCHAR(MAX)
		)
		AS
		BEGIN
			WITH EmployeeCTE AS
			(
				-- Anchor: Root employee
				SELECT
					ID AS EmployeeID,
					FullName AS EmployeeName,
					ManagerID,
					0 AS Level,
					CAST(FullName AS NVARCHAR(MAX)) AS HierarchyPath
				FROM usr.Employee
				WHERE ID = @RootEmployeeID

				UNION ALL

				-- Recursive: Subordinates
				SELECT
					e.ID,
					e.FullName,
					e.ManagerID,
					cte.Level + 1,
					CAST(cte.HierarchyPath + ' > ' + e.FullName AS NVARCHAR(MAX))
				FROM usr.Employee e
				INNER JOIN EmployeeCTE cte ON e.ManagerID = cte.EmployeeID
				WHERE e.[State] = 3
			)
			INSERT INTO @Hierarchy
			SELECT * FROM EmployeeCTE

			RETURN
		END
	]]></Command>
</Library>
```

---

### 3. View

#### Simple View

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="vw_ActiveEmployees"
         LibraryType="View"
         Description="View of active employees with department info">
	<Command><![CDATA[
		CREATE OR ALTER VIEW [dbo].[vw_ActiveEmployees]
		AS
		SELECT
			e.ID,
			e.FullName,
			e.Email,
			e.Phone,
			d.Name AS DepartmentName,
			e.HireDate,
			DATEDIFF(YEAR, e.HireDate, GETDATE()) AS YearsOfService
		FROM usr.Employee e
		LEFT JOIN usr.Department d ON e.DepartmentID = d.ID
		WHERE e.[State] = 3
	]]></Command>
</Library>
```

#### View with Complex Logic

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="vw_ProjectSummary"
         LibraryType="View"
         Description="Aggregated project statistics">
	<Command><![CDATA[
		CREATE OR ALTER VIEW [dbo].[vw_ProjectSummary]
		AS
		SELECT
			p.ID AS ProjectID,
			p.Name AS ProjectName,
			p.[State] AS ProjectState,
			COUNT(DISTINCT t.ID) AS TotalTasks,
			SUM(CASE WHEN t.[State] = 10 THEN 1 ELSE 0 END) AS CompletedTasks,
			SUM(CASE WHEN t.[State] NOT IN (10, 0) THEN 1 ELSE 0 END) AS PendingTasks,
			SUM(ISNULL(t.EstimatedHours, 0)) AS TotalEstimatedHours,
			SUM(ISNULL(t.ActualHours, 0)) AS TotalActualHours,
			CASE
				WHEN SUM(ISNULL(t.EstimatedHours, 0)) > 0
				THEN (SUM(ISNULL(t.ActualHours, 0)) / SUM(ISNULL(t.EstimatedHours, 0))) * 100
				ELSE 0
			END AS EfficiencyPercent,
			MIN(t.DueDate) AS EarliestDueDate,
			MAX(t.DueDate) AS LatestDueDate
		FROM usr.Project p
		LEFT JOIN usr.Task t ON p.ID = t.ProjectID AND t.[State] != 0
		WHERE p.[State] != 0
		GROUP BY p.ID, p.Name, p.[State]
	]]></Command>
</Library>
```

#### Indexed View (for performance)

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="vw_OrderTotals"
         LibraryType="View"
         Description="Indexed view for order totals (materialized)">
	<Command><![CDATA[
		-- Create view with SCHEMABINDING
		CREATE OR ALTER VIEW [dbo].[vw_OrderTotals]
		WITH SCHEMABINDING
		AS
		SELECT
			o.ID AS OrderID,
			o.CustomerID,
			o.OrderDate,
			SUM(oi.Quantity * oi.UnitPrice) AS SubTotal,
			SUM(oi.Quantity * oi.UnitPrice * oi.TaxRate / 100) AS TaxAmount,
			COUNT_BIG(*) AS ItemCount
		FROM dbo.Order o
		INNER JOIN dbo.OrderItem oi ON o.ID = oi.OrderID
		WHERE o.[State] != 0
		GROUP BY o.ID, o.CustomerID, o.OrderDate
		GO

		-- Create unique clustered index
		CREATE UNIQUE CLUSTERED INDEX IX_vw_OrderTotals_OrderID
		ON [dbo].[vw_OrderTotals](OrderID)
	]]></Command>
</Library>
```

---

### 4. Table Type

#### Simple ID List

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="tt_IDList"
         LibraryType="TableType"
         Description="Generic table type for passing ID lists to procedures">
	<Command><![CDATA[
		IF TYPE_ID('[dbo].[tt_IDList]') IS NOT NULL
			DROP TYPE [dbo].[tt_IDList]
		GO

		CREATE TYPE [dbo].[tt_IDList] AS TABLE
		(
			ID INT NOT NULL PRIMARY KEY
		)
	]]></Command>
</Library>
```

#### Complex Type with Multiple Columns

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="tt_BulkEmployeeUpdate"
         LibraryType="TableType"
         Description="Table type for bulk employee updates">
	<Command><![CDATA[
		IF TYPE_ID('[dbo].[tt_BulkEmployeeUpdate]') IS NOT NULL
			DROP TYPE [dbo].[tt_BulkEmployeeUpdate]
		GO

		CREATE TYPE [dbo].[tt_BulkEmployeeUpdate] AS TABLE
		(
			EmployeeID INT NOT NULL PRIMARY KEY,
			DepartmentID INT NULL,
			Position NVARCHAR(100) NULL,
			Salary DECIMAL(18,2) NULL,
			EffectiveDate DATE NOT NULL,
			Notes NVARCHAR(500) NULL
		)
	]]></Command>
</Library>
```

#### Type with Indexes

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="tt_OrderItems"
         LibraryType="TableType"
         Description="Table type for order items with indexes">
	<Command><![CDATA[
		IF TYPE_ID('[dbo].[tt_OrderItems]') IS NOT NULL
			DROP TYPE [dbo].[tt_OrderItems]
		GO

		CREATE TYPE [dbo].[tt_OrderItems] AS TABLE
		(
			RowID INT NOT NULL IDENTITY(1,1) PRIMARY KEY,
			ProductID INT NOT NULL,
			Quantity DECIMAL(18,2) NOT NULL,
			UnitPrice DECIMAL(18,2) NOT NULL,
			Discount DECIMAL(5,2) NULL DEFAULT 0,
			INDEX IX_ProductID NONCLUSTERED (ProductID)
		)
	]]></Command>
</Library>
```

---

## Package Dependencies

Use `PackageIdents` to group related libraries or declare dependencies:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_ProcessOrder"
         LibraryType="StoredProcedure"
         Description="Processes order with tax calculation">
	<PackageIdents>
		<string>LibraryTableTypes</string>
		<string>LibraryFinanceFunctions</string>
	</PackageIdents>
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_ProcessOrder]
			@OrderItems [dbo].[tt_OrderItems] READONLY
		AS
		BEGIN
			-- Uses tt_OrderItems from LibraryTableTypes package
			-- Uses fn_CalculateTax from LibraryFinanceFunctions package
			SELECT
				ProductID,
				Quantity,
				UnitPrice,
				[dbo].[fn_CalculateTax](UnitPrice, Quantity, Discount) AS TaxAmount
			FROM @OrderItems
		END
	]]></Command>
</Library>
```

### Package Definition Example

Create a Package to group related libraries:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="LibraryTableTypes">
	<!-- This package groups all table type libraries -->
	<!-- Referenced by stored procedures that use these types -->
</Package>
```

---

## Best Practices

### 1. Use Placeholders for Consistency

**RECOMMENDED:** Use `#MODIFIER#` and `#NAME#` placeholders for automatic object management:

```xml
<!-- GOOD: Uses placeholders -->
<Library Ident="usp_MyProc" LibraryType="StoredProcedure">
	<Command><![CDATA[
		#MODIFIER# PROCEDURE #NAME#
		AS
		BEGIN
			...
		END
	]]></Command>
</Library>

<!-- ALSO GOOD: Explicit CREATE OR ALTER -->
<Library Ident="usp_MyProc" LibraryType="StoredProcedure">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_MyProc]
		AS
		BEGIN
			...
		END
	]]></Command>
</Library>

<!-- BAD: Fails if procedure already exists -->
<Library Ident="usp_MyProc" LibraryType="StoredProcedure">
	<Command><![CDATA[
		CREATE PROCEDURE [dbo].[usp_MyProc]
		AS
		BEGIN
			...
		END
	]]></Command>
</Library>
```

**Benefits of placeholders:**
- ✅ Automatic CREATE OR ALTER logic
- ✅ Consistent schema naming
- ✅ Works across all environments
- ✅ Less manual maintenance

### 2. Always Use CDATA for Command

```xml
<!-- GOOD: CDATA prevents XML parsing issues -->
<Command><![CDATA[
	CREATE OR ALTER PROCEDURE [dbo].[usp_GetUsers]
		@MinAge INT
	AS
	BEGIN
		SELECT * FROM usr.User WHERE Age > @MinAge
		                                    ^
		                                    No XML escape needed
	END
]]></Command>

<!-- BAD: XML parsing error because of > character -->
<Command>
	CREATE OR ALTER PROCEDURE [dbo].[usp_GetUsers]
		@MinAge INT
	AS
	BEGIN
		SELECT * FROM usr.User WHERE Age > @MinAge
	END
</Command>
```

### 3. Include SET NOCOUNT ON

For procedures and functions, always include `SET NOCOUNT ON`:

```sql
CREATE OR ALTER PROCEDURE [dbo].[usp_MyProc]
AS
BEGIN
	SET NOCOUNT ON;  -- Prevents extra result sets
	
	-- Your code here
END
```

### 4. Use Schema Prefixes in Command

Always specify schema in the Command:

```xml
<Library Ident="usp_GetUsers" LibraryType="StoredProcedure">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_GetUsers]
		                          ^^^^^^
		                          Schema prefix required
	]]></Command>
</Library>
```

### 5. Handle NULL Parameters

Always handle NULL parameters explicitly:

```sql
CREATE OR ALTER PROCEDURE [dbo].[usp_GetEmployees]
	@DepartmentID INT = NULL,
	@IsActive BIT = 1
AS
BEGIN
	SELECT *
	FROM usr.Employee
	WHERE (@DepartmentID IS NULL OR DepartmentID = @DepartmentID)
	  AND (@IsActive IS NULL OR ([State] = CASE WHEN @IsActive = 1 THEN 3 ELSE 0 END))
END
```

### 6. Document Parameters

Use SQL comments to document parameters:

```sql
CREATE OR ALTER PROCEDURE [dbo].[usp_GetEmployeeStats]
	@DepartmentID INT = NULL,  -- NULL = all departments
	@StartDate DATE = NULL,    -- NULL = no date filter
	@EndDate DATE = NULL,      -- NULL = today
	@IncludeInactive BIT = 0   -- 0 = active only, 1 = include inactive
AS
BEGIN
	...
END
```

### 7. Error Handling

Implement proper error handling:

```sql
CREATE OR ALTER PROCEDURE [dbo].[usp_ProcessPayment]
	@InvoiceID INT,
	@Amount DECIMAL(18,2)
AS
BEGIN
	SET NOCOUNT ON;
	BEGIN TRY
		BEGIN TRANSACTION

		-- Process payment
		UPDATE usr.Invoice
		SET PaidAmount = PaidAmount + @Amount,
		    LastUpdate = GETDATE()
		WHERE ID = @InvoiceID

		-- Verify payment
		IF @@ROWCOUNT = 0
		BEGIN
			RAISERROR('Invoice not found', 16, 1)
		END

		COMMIT TRANSACTION
		RETURN 0  -- Success
	END TRY
	BEGIN CATCH
		IF @@TRANCOUNT > 0
			ROLLBACK TRANSACTION

		-- Log error
		DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE()
		RAISERROR(@ErrorMessage, 16, 1)
		RETURN -1  -- Error
	END CATCH
END
```

### 8. Performance Considerations

**For Procedures:**
- Use appropriate indexes on referenced tables
- Avoid SELECT * (list columns explicitly)
- Use EXISTS instead of COUNT when checking existence
- Avoid cursors when possible (use set-based operations)

**For Views:**
- Keep views simple (avoid complex joins and subqueries)
- Consider indexed views for frequently queried aggregations
- Use NOEXPAND hint for indexed views: `SELECT * FROM vw_MyView WITH (NOEXPAND)`

**For Functions:**
- Prefer inline table-valued functions over multi-statement
- Avoid scalar functions in WHERE clauses (performance issue)
- Consider replacing scalar functions with inline calculations

---

## SQL Formatting in Command

Follow SQL formatting conventions from [xml-conventions.md](../xml-conventions.md):

```sql
-- GOOD: Formatted SQL
<Command><![CDATA[
	CREATE OR ALTER PROCEDURE [dbo].[usp_GetEmployees]
		@DepartmentID INT = NULL,
		@IsActive BIT = 1
	AS
	BEGIN
		SET NOCOUNT ON;

		SELECT
			e.ID,
			e.FullName,
			e.Email,
			d.Name AS DepartmentName,
			e.[State]
		FROM usr.Employee e
		LEFT JOIN usr.Department d ON e.DepartmentID = d.ID
		WHERE (@DepartmentID IS NULL OR e.DepartmentID = @DepartmentID)
		  AND (@IsActive IS NULL OR e.[State] = CASE WHEN @IsActive = 1 THEN 3 ELSE 0 END)
		ORDER BY e.FullName
	END
]]></Command>

-- BAD: Single-line SQL
<Command><![CDATA[CREATE OR ALTER PROCEDURE [dbo].[usp_GetEmployees] @DepartmentID INT = NULL AS BEGIN SELECT * FROM usr.Employee WHERE DepartmentID = @DepartmentID END]]></Command>
```

**Key formatting rules:**
- SQL keywords in UPPERCASE (`SELECT`, `FROM`, `WHERE`, `JOIN`)
- Each major clause on new line
- Indentation with tabs
- Column list: one column per line
- Use aliases for tables

---

## Integration with SmartFormPlatform

### Using in DataSource

Call stored procedures from DataSource:

```xml
<DataSource>
	<Columns>
		<Column Ident="EmployeeID" />
		<Column Ident="FullName" />
		<Column Ident="TotalHours" />
	</Columns>
	<SQL><![CDATA[
		EXEC [dbo].[usp_GetEmployeeStats]
			@DepartmentID = @Department,
			@IncludeInactive = 0
	]]></SQL>
	<Parameters>
		<dsp:Parameter xsi:type="dsp:VariableParameter"
		               Ident="Department"
		               DataType="Number" />
	</Parameters>
</DataSource>
```

### Using Functions in Queries

Use scalar functions in SELECT:

```xml
<SQL><![CDATA[
	SELECT
		e.ID,
		[dbo].[fn_GetFullName](e.Title, e.FirstName, e.LastName) AS FullName,
		e.Email
	FROM usr.Employee e
	WHERE e.[State] = 3
]]></SQL>
```

Use table-valued functions in FROM:

```xml
<SQL><![CDATA[
	SELECT
		p.PermissionIdent,
		p.PermissionTitle,
		p.RoleName
	FROM [dbo].[tvf_GetUserPermissions](@UserID) p
	ORDER BY p.PermissionIdent
]]></SQL>
```

### Using Views

Reference views like tables:

```xml
<SQL><![CDATA[
	SELECT
		v.ID,
		v.FullName,
		v.Email,
		v.DepartmentName,
		v.YearsOfService
	FROM [dbo].[vw_ActiveEmployees] v
	WHERE v.DepartmentName = @Department
	ORDER BY v.FullName
]]></SQL>
```

---

## Upload and Execution

### How Libraries are Processed

1. **Upload XML** via Admin UI (Configuration > XML Definitions > Library)
2. **System validates** XML structure
3. **Command is executed** against database
4. **Object is created/altered** in database
5. **XML is stored** in system for versioning

### Error Handling

If Command execution fails:
- Error is logged in EventLog
- XML upload is aborted (transaction rollback)
- User sees error message with SQL error details

**Common errors:**
- Syntax error in SQL
- Object dependencies not met (referenced objects don't exist)
- Permission issues (database user lacks CREATE/ALTER permission)

### Testing Libraries

After uploading, test the library:

**For Procedures:**
```sql
-- In SSMS or SQL query tool
EXEC [dbo].[usp_MyProcedure] @Param1 = 123
```

**For Functions:**
```sql
-- Scalar function
SELECT [dbo].[fn_MyFunction]('test', 123)

-- Table-valued function
SELECT * FROM [dbo].[tvf_MyFunction](456)
```

**For Views:**
```sql
SELECT * FROM [dbo].[vw_MyView]
```

---

## Versioning and Migration

### Updating Libraries

To update a library:
1. Modify the XML file
2. Re-upload via Admin UI
3. Command executes and updates database object

**Example: Adding parameter to procedure**

```xml
<!-- Version 1 -->
<Library Ident="usp_GetEmployees" LibraryType="StoredProcedure">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_GetEmployees]
			@DepartmentID INT = NULL
		AS
		BEGIN
			SELECT * FROM usr.Employee
			WHERE (@DepartmentID IS NULL OR DepartmentID = @DepartmentID)
		END
	]]></Command>
</Library>

<!-- Version 2: Added @IsActive parameter -->
<Library Ident="usp_GetEmployees" LibraryType="StoredProcedure">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_GetEmployees]
			@DepartmentID INT = NULL,
			@IsActive BIT = 1
		AS
		BEGIN
			SELECT * FROM usr.Employee
			WHERE (@DepartmentID IS NULL OR DepartmentID = @DepartmentID)
			  AND ([State] = CASE WHEN @IsActive = 1 THEN 3 ELSE 0 END)
		END
	]]></Command>
</Library>
```

### Backward Compatibility

When updating libraries:
- Use default parameter values for new parameters
- Don't remove parameters (add optional parameters instead)
- Don't change return structure of functions/procedures (add new columns at end)

---

## Common Patterns

### 1. Audit Trail Procedure

```xml
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_LogAudit"
         LibraryType="StoredProcedure"
         Description="Logs audit trail for entity changes">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_LogAudit]
			@EntityType NVARCHAR(50),
			@EntityID INT,
			@Action NVARCHAR(50),
			@OldValue NVARCHAR(MAX) = NULL,
			@NewValue NVARCHAR(MAX) = NULL,
			@AccountID INT
		AS
		BEGIN
			SET NOCOUNT ON;

			INSERT INTO dbo.AuditLog
			(
				EntityType,
				EntityID,
				[Action],
				OldValue,
				NewValue,
				AccountID,
				CreateDate
			)
			VALUES
			(
				@EntityType,
				@EntityID,
				@Action,
				@OldValue,
				@NewValue,
				@AccountID,
				GETDATE()
			)
		END
	]]></Command>
</Library>
```

### 2. Soft Delete Procedure

```xml
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="usp_SoftDeleteEntity"
         LibraryType="StoredProcedure"
         Description="Generic soft delete procedure">
	<Command><![CDATA[
		CREATE OR ALTER PROCEDURE [dbo].[usp_SoftDeleteEntity]
			@TableName NVARCHAR(128),
			@ID INT,
			@DeleteState INT = 0,
			@AccountID INT
		AS
		BEGIN
			SET NOCOUNT ON;

			DECLARE @SQL NVARCHAR(MAX)

			SET @SQL = N'UPDATE usr.' + QUOTENAME(@TableName) + N'
						 SET [State] = @DeleteState,
						     LastUpdate = GETDATE(),
						     LastUpdateAccountID = @AccountID
						 WHERE ID = @ID'

			EXEC sp_executesql @SQL,
			                   N'@DeleteState INT, @AccountID INT, @ID INT',
			                   @DeleteState, @AccountID, @ID
		END
	]]></Command>
</Library>
```

### 3. Permission Check Function

```xml
<Library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         Ident="fn_HasPermission"
         LibraryType="Function"
         Description="Checks if user has specific permission">
	<Command><![CDATA[
		CREATE OR ALTER FUNCTION [dbo].[fn_HasPermission]
		(
			@AccountID INT,
			@PermissionIdent NVARCHAR(256)
		)
		RETURNS BIT
		AS
		BEGIN
			DECLARE @HasPermission BIT = 0

			IF EXISTS (
				SELECT 1
				FROM dbo.Permission p
				INNER JOIN dbo.Role r ON p.RoleID = r.ID
				INNER JOIN dbo.GroupRole gr ON r.ID = gr.RoleID
				INNER JOIN dbo.GroupAccount ga ON gr.GroupID = ga.GroupID
				WHERE ga.AccountID = @AccountID
				  AND p.Ident = @PermissionIdent
				  AND ga.[State] = 1
			)
			BEGIN
				SET @HasPermission = 1
			END

			RETURN @HasPermission
		END
	]]></Command>
</Library>
```

---

## Troubleshooting

### Common Issues

**Issue: "Invalid object name"**
- Cause: Referenced table/view doesn't exist
- Solution: Ensure dependent objects exist first (use PackageIdents for ordering)

**Issue: "There is already an object named 'X' in the database"**
- Cause: Using `CREATE` instead of `CREATE OR ALTER`
- Solution: Use `CREATE OR ALTER` for idempotency

**Issue: "Cannot DROP TYPE because it is being referenced"**
- Cause: Table type is used by existing procedures
- Solution: Drop dependent procedures first, or use `CREATE OR ALTER` for procedures

**Issue: "XML parsing error"**
- Cause: Missing CDATA or special characters in Command
- Solution: Wrap Command in `<![CDATA[...]]>`

**Issue: "Permission denied"**
- Cause: Database user lacks CREATE/ALTER permission
- Solution: Grant appropriate permissions to application database user

---

## References

- [xml-conventions.md](../xml-conventions.md) - XML and SQL formatting conventions
- [datasource.md](../common/datasource.md) - Using libraries in DataSource
- [configuration.md](configuration.md) - DLLSection for plugin configuration
- [other-definitions.md](other-definitions.md) - Other IXMLDefinition types

---

## Summary

**Library** XML definitions provide a structured way to manage SQL database objects:

- ✅ Version control for database objects
- ✅ Deployment via XML upload
- ✅ Consistent with other SFP definitions
- ✅ Package dependencies for organization
- ✅ Automatic execution on upload

**Key points:**
- Always use `<![CDATA[]]>` for Command
- Use `CREATE OR ALTER` for idempotency
- Follow naming conventions (usp_, fn_, vw_, tt_)
- Document parameters and purpose
- Test after upload
- Consider backward compatibility when updating
