# Component DataSource Parameters

Complete reference for all parameters available in component DataSource sections.

---

## Overview

When a component executes SQL queries in `<Section xsi:type="DataSourceSection">` or `<ContentSection><Sources>`, the system automatically provides a **DataSourceParameter** object with various data from different contexts.

This allows components to access:
- User context (AccountID, LanguageID)
- Form data (current values, original values, parent form)
- Request data (query string, POST data)
- Filter data (date ranges, saved filters)
- Temp data (menu selections, segment filters)

---

## Table of Contents

1. [User Context Parameters](#1-user-context-parameters)
2. [Form Context Parameters](#2-form-context-parameters)
3. [Request Parameters](#3-request-parameters)
4. [Filter & Temp Data Parameters](#4-filter--temp-data-parameters)
5. [Other Parameters](#5-other-parameters)
6. [Complete Reference](#6-complete-reference)
7. [Usage Examples](#7-usage-examples)

---

## 1. User Context Parameters

These parameters are **always available** and provide information about the current user.

| Parameter | Type | Description | Source |
|-----------|------|-------------|--------|
| `@AccountID` | `int` | Current user ID | `user.AccountID` |
| `@LanguageID` | `int` | User's language ID | `userService.GetLanguageID()` |
| `@AnonymousID` | `Guid?` | Anonymous user identifier (for non-logged users) | `userService.GetAnonymousID()` |

### Example

```xml
<Section xsi:type="DataSourceSection" Ident="UserData">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        u.ID,
        u.FullName,
        u.Email
      FROM dbo.Account u
      WHERE u.ID = @AccountID
    ]]></SQL>
  </DataSource>
</Section>
```

**Note:** You don't need to declare these parameters - they are automatically available.

---

## 2. Form Context Parameters

These parameters are **only available when component is on a Form** (`xmlType = 'Form'`).

### 2.1 Current Form Data

| Parameter | Type | Description | Source |
|-----------|------|-------------|--------|
| `@ControlIdent` | varies | Value of any form control | `form.Data` (DataItems) |

**Example:**

```xml
<!-- Form has controls: Name, Email, CategoryID -->
<Section xsi:type="DataSourceSection" Ident="FormData">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        @Name AS CurrentName,
        @Email AS CurrentEmail,
        @CategoryID AS CurrentCategoryID
    ]]></SQL>
  </DataSource>
</Section>
```

### 2.2 Original Form Data (Before Changes)

| Parameter List | Type | Description | Source |
|----------------|------|-------------|--------|
| `OldDataItems` | `List<DataItem>` | Original values before editing | `form.OldData` |

Access via special syntax (requires DataSource service):

```xml
<SQL><![CDATA[
  -- Compare current vs original value
  SELECT
    @Name AS CurrentName,
    -- Original value requires special handling
    (SELECT Value FROM @OldDataItems WHERE Ident = 'Name') AS OriginalName
]]></SQL>
```

### 2.3 Parent Form Data (SubForm Context)

| Parameter List | Type | Description | Source |
|----------------|------|-------------|--------|
| `ParentDataItems` | `List<DataItem>` | Values from parent form | `form.ParentData` |

**Example (in SubForm component):**

```xml
<SQL><![CDATA[
  -- Access parent form data
  SELECT
    p.ID,
    p.Name
  FROM usr.SubFormData s
  INNER JOIN usr.ParentFormData p ON p.ID = @ParentTableID
  WHERE s.ParentID = @ParentTableID
]]></SQL>
```

### 2.4 Variable Table Data

| Parameter List | Type | Description | Source |
|----------------|------|-------------|--------|
| `VariableTableData` | `List<VariableTableData>` | Data from variable tables | `formService.GetVariableTableData(form)` |

**Variable tables** are temporary tables created during form processing (e.g., from SubForm controls, file attachments).

---

## 3. Request Parameters

These parameters provide access to HTTP request data.

### 3.1 Query String Parameters

| Parameter List | Type | Description | Source |
|----------------|------|-------------|--------|
| `QueryStringDataItems` | `List<DataItem>` | All URL query parameters | `HttpContext.Request.Query` |

**Example:**

```
URL: /Dashboard?productID=123&categoryID=5
```

```xml
<SQL><![CDATA[
  SELECT
    p.ID,
    p.Name
  FROM usr.Product p
  WHERE p.ID = @productID
    AND p.CategoryID = @categoryID
]]></SQL>
```

### 3.2 POST Data Parameters

| Parameter List | Type | Description | Source |
|----------------|------|-------------|--------|
| `POSTDataItems` | `List<DataItem>` | All POST form data | `HttpContext.Request.Form` |

**Available when:**
- Request method is POST
- Content-Type is `application/x-www-form-urlencoded` or `multipart/form-data`

**Example:**

```xml
<SQL><![CDATA[
  -- Access posted form field
  SELECT * FROM usr.Product
  WHERE Name LIKE @SearchTerm
]]></SQL>
```

---

## 4. Filter & Temp Data Parameters

These parameters provide access to user's filter settings and temporary session data.

### 4.1 Date Range (from Filter)

| Parameter | Type | Description | Source |
|-----------|------|-------------|--------|
| `@DateFrom` | `DateTime` | Filter start date | `filter.DateFrom` |
| `@DateTo` | `DateTime` | Filter end date | `filter.DateTo` |

**Available when:**
- User has selected a date range in Filter control
- Component is used in DataView with filter

**Example:**

```xml
<SQL><![CDATA[
  SELECT
    o.ID,
    o.OrderNumber,
    o.OrderDate
  FROM usr.Order o
  WHERE o.OrderDate BETWEEN @DateFrom AND @DateTo
]]></SQL>
```

### 4.2 Menu Folder Tree Selection

| Parameter | Type | Description | Source |
|-----------|------|-------------|--------|
| `@MenuFolderTreeIdent` | `string` | Selected folder/category from menu | `userTempData.MenuFolderTreeIdent` |

**Example:**

```xml
<SQL><![CDATA[
  SELECT
    d.ID,
    d.DocumentName
  FROM usr.Document d
  WHERE d.FolderIdent = @MenuFolderTreeIdent
]]></SQL>
```

### 4.3 Segment Filter

| Parameter | Type | Description | Source |
|-----------|------|-------------|--------|
| `@SegmentFilter` | `string` | Current segment filter value | `userTempData.Filters` |

**Example:**

```xml
<SQL><![CDATA[
  SELECT * FROM usr.Invoice
  WHERE (@SegmentFilter IS NULL OR Status = @SegmentFilter)
]]></SQL>
```

### 4.4 Result List ID

| Parameter | Type | Description | Source |
|-----------|------|-------------|--------|
| `@ResultListID` | `int` | Saved result list identifier | `filter.ResultListID` |

Used for saved search results.

---

## 5. Other Parameters

### 5.1 Component-Specific Parameters

You can define custom parameters in DataSource using standard parameter syntax:

```xml
<Section xsi:type="DataSourceSection" Ident="Products">
  <DataSource>
    <SQL><![CDATA[
      SELECT * FROM usr.Product
      WHERE CategoryID = @CategoryID
        AND Price > @MinPrice
    ]]></SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="CategoryID" DataType="Number" Value="1" />
      <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="MinPrice" DataType="Double" Value="100.00" />
    </Parameters>
  </DataSource>
</Section>
```

### 5.2 Variable Parameters (From Form Controls)

```xml
<Parameters>
  <!-- Get value from form control -->
  <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CategoryID" DataType="Number" />

  <!-- Get value from query string -->
  <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="SearchTerm" DataType="String" MaxLength="100" />

  <!-- User ID constant -->
  <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" ConstantType="UserID" DataType="Number" />
</Parameters>
```

See [docs/ai/common/datasource.md](../common/datasource.md) for complete DataSource parameter documentation.

---

## 6. Complete Reference

### DataSourceParameter Class Properties

Complete list of all properties available in `DataSourceParameter` object:

```csharp
public class DataSourceParameter
{
    // User Context
    public int AccountID { get; set; }                      // Current user ID
    public int LanguageID { get; set; }                     // User language ID
    public Guid? AnonymousID { get; set; }                  // Anonymous user ID
    public List<string> Permissions { get; set; }           // User permissions

    // Form Context
    public List<DataItem> DataItems { get; set; }           // Current form data
    public List<DataItem> OldDataItems { get; set; }        // Original form data
    public List<DataItem> ParentDataItems { get; set; }     // Parent form data
    public List<VariableTableData> VariableTableData { get; set; } // Variable tables

    // Request Context
    public List<DataItem> QueryStringDataItems { get; set; } // URL query parameters
    public List<DataItem> POSTDataItems { get; set; }        // POST form data

    // Filter & Temp Data
    public Filter Filter { get; set; }                       // User filter
    public DateTime DateFrom { get; set; }                   // Filter date from
    public DateTime DateTo { get; set; }                     // Filter date to
    public string MenuFolderTreeIdent { get; set; }          // Menu selection
    public string SegmentFilter { get; set; }                // Segment filter value
    public int ResultListID { get; set; }                    // Saved result list

    // Other Context
    public List<DataItem> SelectedValueData { get; set; }    // Previously selected data
    public List<DataItem> ExtensionData { get; set; }        // Extension data
    public List<DataItem> SpecifyData { get; set; }          // Specific data
    public List<DataItem> HTMLAttributeDataItems { get; set; } // HTML attributes

    // Pagination & Sorting
    public int StartPage { get; set; }                       // Start page
    public int EndPage { get; set; }                         // End page
    public List<SortColumn> SortColumns { get; set; }        // Sort columns

    // Workflow
    public int WorkFlowState { get; set; }                   // Current workflow state
    public List<string> WorkFlowPermissions { get; set; }    // Workflow permissions

    // Other
    public List<string> ID { get; set; }                     // ID values
    public string FormIdent { get; set; }                    // Form identifier
    public string TabIdent { get; set; }                     // Tab identifier
    public string SegmentType { get; set; }                  // Segment type
    public string Ident { get; set; }                        // General identifier
    public string XMLIdent { get; set; }                     // XML identifier
    public XMLTypes XMLType { get; set; }                    // XML type
    public object Value { get; set; }                        // Any value
    public string Token { get; set; }                        // Token
    public string PathURL { get; set; }                      // URL path
    public List<IdentValue> LocalVariables { get; set; }     // Local variables
    public List<int> SelectedRows { get; set; }              // Selected rows
    public List<File> MemoryFiles { get; set; }              // In-memory files
    public DateTime LastRunDate { get; set; }                // Last run date
    public int FileID { get; set; }                          // File ID
    public int CommunicationID { get; set; }                 // Communication ID
    public string DeviceIdent { get; set; }                  // Device identifier
}
```

---

## 7. Usage Examples

### Example 1: User-Specific Data

```xml
<Section xsi:type="DataSourceSection" Ident="MyTasks">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        t.ID,
        t.Title,
        t.DueDate,
        t.Status
      FROM usr.Task t
      WHERE t.AssignedToID = @AccountID
        AND t.State != 0
      ORDER BY t.DueDate
    ]]></SQL>
  </DataSource>
</Section>
```

**Available parameters:**
- `@AccountID` - automatically filled from user context

---

### Example 2: Form-Based Filtering

```xml
<!-- Form has controls: CategoryID, MinPrice, MaxPrice -->
<Section xsi:type="DataSourceSection" Ident="FilteredProducts">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        p.ID,
        p.Name,
        p.Price,
        c.Name AS CategoryName
      FROM usr.Product p
      LEFT JOIN usr.Category c ON c.ID = p.CategoryID
      WHERE (@CategoryID IS NULL OR p.CategoryID = @CategoryID)
        AND (@MinPrice IS NULL OR p.Price >= @MinPrice)
        AND (@MaxPrice IS NULL OR p.Price <= @MaxPrice)
        AND p.State = 1
      ORDER BY p.Name
    ]]></SQL>
  </DataSource>
</Section>
```

**Available parameters:**
- `@CategoryID`, `@MinPrice`, `@MaxPrice` - from form controls (DataItems)

---

### Example 3: Query String Parameters

```xml
<!-- URL: /Dashboard?departmentID=5 -->
<Section xsi:type="DataSourceSection" Ident="DepartmentEmployees">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        e.ID,
        e.FullName,
        e.Position
      FROM usr.Employee e
      WHERE e.DepartmentID = @departmentID
        AND e.State = 1
      ORDER BY e.FullName
    ]]></SQL>
  </DataSource>
</Section>
```

**Available parameters:**
- `@departmentID` - from URL query string (QueryStringDataItems)

---

### Example 4: Date Range Filter

```xml
<!-- Used in DataView with Filter control -->
<Section xsi:type="DataSourceSection" Ident="Orders">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        o.ID,
        o.OrderNumber,
        o.OrderDate,
        o.Total
      FROM usr.Order o
      WHERE o.OrderDate BETWEEN @DateFrom AND @DateTo
        AND o.CustomerID = @AccountID
      ORDER BY o.OrderDate DESC
    ]]></SQL>
  </DataSource>
</Section>
```

**Available parameters:**
- `@DateFrom`, `@DateTo` - from Filter control (user temp data)
- `@AccountID` - from user context

---

### Example 5: SubForm Context

```xml
<!-- Component in SubForm - has access to parent form data -->
<Section xsi:type="DataSourceSection" Ident="SubFormItems">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        si.ID,
        si.ItemName,
        si.Quantity,
        si.Price,
        (si.Quantity * si.Price) AS Total
      FROM usr.OrderItem si
      WHERE si.OrderID = @ParentTableID
        AND si.State = 1
      ORDER BY si.OrderNumber
    ]]></SQL>
    <Parameters>
      <!-- ParentTableID is available from ParentDataItems -->
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ParentTableID" DataType="Number" />
    </Parameters>
  </DataSource>
</Section>
```

**Available parameters:**
- `@ParentTableID` - from parent form (ParentDataItems)
- Form field values from SubForm (DataItems)

---

### Example 6: Combined Context

```xml
<!-- Complex example using multiple parameter sources -->
<Section xsi:type="DataSourceSection" Ident="ComplexQuery">
  <DataSource>
    <SQL><![CDATA[
      SELECT
        i.ID,
        i.InvoiceNumber,
        i.InvoiceDate,
        i.Total,
        c.CompanyName,
        s.StatusName
      FROM usr.Invoice i
      INNER JOIN usr.Customer c ON c.ID = i.CustomerID
      LEFT JOIN usr.InvoiceStatus s ON s.ID = i.StatusID
      WHERE i.CreatedBy = @AccountID                    -- User context
        AND i.InvoiceDate BETWEEN @DateFrom AND @DateTo  -- Filter
        AND (@StatusID IS NULL OR i.StatusID = @StatusID) -- Form control
        AND (@SearchTerm IS NULL OR i.InvoiceNumber LIKE '%' + @SearchTerm + '%') -- Query string
        AND i.State = 1
      ORDER BY i.InvoiceDate DESC
    ]]></SQL>
    <Parameters>
      <!-- Define expected parameters (optional but recommended) -->
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="StatusID" DataType="Number" />
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="SearchTerm" DataType="String" MaxLength="50" />
    </Parameters>
  </DataSource>
</Section>
```

**Available parameters:**
- `@AccountID` - user context (always available)
- `@DateFrom`, `@DateTo` - filter (from user temp data)
- `@StatusID` - form control or query string
- `@SearchTerm` - query string or POST data

---

## Summary

### Automatic Parameters (Always Available)

These parameters are **automatically available** without declaration:

- ✅ `@AccountID` - Current user ID
- ✅ `@LanguageID` - User language ID
- ✅ `@AnonymousID` - Anonymous user ID (if applicable)

### Context-Dependent Parameters

These parameters are **available depending on context**:

| Context | Available Parameters |
|---------|---------------------|
| **Form** | `@ControlIdent` (all form controls), `OldDataItems`, `ParentDataItems`, `VariableTableData` |
| **Request** | `QueryStringDataItems` (URL params), `POSTDataItems` (POST data) |
| **Filter** | `@DateFrom`, `@DateTo`, `@ResultListID` |
| **Temp Data** | `@MenuFolderTreeIdent`, `@SegmentFilter` |

### Best Practices

1. **Always check for NULL** - Optional parameters should be checked:
   ```sql
   WHERE (@CategoryID IS NULL OR p.CategoryID = @CategoryID)
   ```

2. **Use explicit parameters** - Declare parameters in `<Parameters>` for clarity:
   ```xml
   <Parameters>
     <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="CategoryID" DataType="Number" />
   </Parameters>
   ```

3. **Test in different contexts** - Test your component in Dashboard, Form, and DataView

4. **Document assumptions** - Comment which parameters are required:
   ```xml
   <!-- Requires: CategoryID from form control or query string -->
   ```

---

## Related Documentation

- [DataSource Configuration](../common/datasource.md) - Complete DataSource reference
- [Component Development](components.md) - Main component documentation
- [Form Definition](../entities/form.md) - Form controls and data

---

**Last Updated:** 2026-01-26
