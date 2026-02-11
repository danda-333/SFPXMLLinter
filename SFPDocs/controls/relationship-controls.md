# Relationship Controls

## SubFormControl

Embedded sub-form for 1:N relationships. Creates master-detail interface.

**Inherits from:** Control (not FormControl - no DB column)

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `FormIdent` | string | "" | **Required.** Sub-form identifier |
| `IsImmediatelySave` | bool | false | Save sub-records immediately (without parent save) |
| `IsShowList` | bool | true | Show list of existing records |
| `IsCreateButton` | bool | true | Show "Add" button |
| `IsDependencyOnParent` | bool | true | Link sub-records to parent via FK |
| `CreateButtonTitle` | string | "" | Custom "Add" button text |
| `CreateButtonTitleResourceKey` | string | "" | "Add" button text from translations |
| `IsReloadDataSource` | bool | false | Reload DataSource after each save |
| `IsSortable` | bool | false | Enable drag-and-drop sorting |
| `SortableControlIdent` | string | "" | Field for sort order value |
| `SortablePositionNewItem` | enum | ASC | New item position (ASC = end, DESC = beginning) |
| `IsOverwriteCheck` | bool | false | Check for concurrent modifications |
| `InsertButtonIdent` | string | "" | Custom insert button from sub-form |
| `UpdateButtonIdent` | string | "" | Custom update button from sub-form |
| `DeleteButtonIdent` | string | "" | Custom delete button from sub-form |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataSource` | DataSource | Query for listing sub-records |
| `RowDataSource` | DataSource | Query for single row data |
| `OwnButtons` | List&lt;string&gt; | Additional button identifiers to show |

### Examples

**Basic sub-form:**
```xml
<Control xsi:type="SubFormControl"
         Ident="OrderItems"
         FormIdent="OrderItem"
         TitleResourceKey="Items_Order">
  <DataSource FormIdent="OrderItem">
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
      <Column Ident="ProductName" TitleResourceKey="Product" Width="40" />
      <Column Ident="Quantity" TitleResourceKey="Quantity" Width="20" />
      <Column Ident="UnitPrice" TitleResourceKey="Price" Width="20" />
      <Column Ident="Total" TitleResourceKey="Total" Width="20" />
    </Columns>
    <SQL>
      SELECT
        oi.ID,
        p.Name as ProductName,
        oi.Quantity,
        oi.UnitPrice,
        oi.Quantity * oi.UnitPrice as Total
      FROM usr.OrderItem oi
      INNER JOIN usr.Product p ON oi.ProductID = p.ID
      WHERE oi.OrderID = @ID AND oi.State != 0
      ORDER BY oi.ID
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Control>
```

**With immediate save and sorting:**
```xml
<Control xsi:type="SubFormControl"
         Ident="Tasks"
         FormIdent="ProjectTask"
         TitleResourceKey="Tasks_Project"
         IsImmediatelySave="true"
         IsSortable="true"
         SortableControlIdent="SortOrder"
         SortablePositionNewItem="DESC">
  <DataSource FormIdent="ProjectTask">
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
      <Column Ident="Name" TitleResourceKey="TaskName" Width="50" />
      <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="ProjectTask" Width="20" />
      <Column Ident="DueDate" TitleResourceKey="DueDate" Width="30" />
    </Columns>
    <SQL>
      SELECT ID, Name, State, DueDate
      FROM usr.ProjectTask
      WHERE ProjectID = @ID AND State != 0
      ORDER BY SortOrder ASC
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Control>
```

**With custom buttons:**
```xml
<Control xsi:type="SubFormControl"
         Ident="Attachments"
         FormIdent="DocumentAttachment"
         TitleResourceKey="Attachments_Document"
         InsertButtonIdent="SaveAttachment"
         DeleteButtonIdent="RemoveAttachment"
         CreateButtonTitleResourceKey="AddAttachment">
  <OwnButtons>
    <string>DownloadButton</string>
    <string>PreviewButton</string>
  </OwnButtons>
  <DataSource FormIdent="DocumentAttachment">
    <!-- columns and SQL -->
  </DataSource>
</Control>
```

---

## InlineSubFormControl

Inline sub-form displayed directly in parent form (no popup).

**Inherits from:** SubFormControl

### Examples

```xml
<Control xsi:type="InlineSubFormControl"
         Ident="ContactInfo"
         FormIdent="ContactDetails"
         TitleResourceKey="Contact_Form"
         IsImmediatelySave="false">
  <DataSource FormIdent="ContactDetails">
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
      <Column Ident="Type" TitleResourceKey="Type" Width="30" />
      <Column Ident="Value" TitleResourceKey="Value" Width="70" />
    </Columns>
    <SQL>
      SELECT ID, Type, Value
      FROM usr.ContactDetails
      WHERE PersonID = @ID AND State != 0
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Control>
```

---

## DataGridControl

Read-only data grid for displaying related data (no editing).

**Inherits from:** Control

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsSupportCopyToClipboard` | bool | true | Enable copy to clipboard |
| `RowHeight` | int | 0 | Fixed row height (0 = auto) |
| `IsClassicPaging` | bool | false | Use classic pagination |
| `IsResponsive` | bool | true | Responsive table layout |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataSource` | DataSource | Query for grid data |
| `RowDataSource` | DataSource | Query for row detail |

### Examples

**Basic data grid:**
```xml
<Control xsi:type="DataGridControl"
         Ident="RelatedOrders"
         TitleResourceKey="Orders_Customer">
  <DataSource FormIdent="Order">
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
      <Column Ident="OrderNumber" TitleResourceKey="OrderNumber" Width="20" />
      <Column Ident="OrderDate" TitleResourceKey="Date" Width="20" />
      <Column Ident="Total" TitleResourceKey="Total" Width="20" />
      <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Order" Width="20" IsColor="true" />
    </Columns>
    <SQL>
      SELECT ID, OrderNumber, OrderDate, Total, State
      FROM usr.[Order]
      WHERE CustomerID = @ID AND State != 0
      ORDER BY OrderDate DESC
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Control>
```

**With clickable rows (link to detail):**
```xml
<Control xsi:type="DataGridControl"
         Ident="History"
         TitleResourceKey="History_Form">
  <DataSource FormIdent="AuditLog" DetailUrl="~/Form/Index/AuditLog">
    <Columns>
      <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" />
      <Column Ident="Action" TitleResourceKey="Action" Width="30" />
      <Column Ident="UserName" TitleResourceKey="User" Width="30" />
      <Column Ident="Timestamp" TitleResourceKey="Time" Width="40" />
    </Columns>
    <SQL>
      SELECT al.ID, al.Action, a.FullName as UserName, al.CreateDate as Timestamp
      FROM dbo.AuditLog al
      INNER JOIN dbo.Account a ON al.AccountID = a.ID
      WHERE al.FormIdent = @FormIdent AND al.TableID = @ID
      ORDER BY al.CreateDate DESC
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
      <dsp:Parameter xsi:type="dsp:ValueParameter" Ident="FormIdent" DataType="String" Value="MyForm" />
    </Parameters>
  </DataSource>
</Control>
```

---

## FormDialogControl

Opens another form in a modal dialog.

**Inherits from:** Control

### Examples

```xml
<Control xsi:type="FormDialogControl"
         Ident="QuickAddCustomer"
         FormIdent="Customer"
         TitleResourceKey="AddCustomer_Form" />
```

---

## TimeLineControl

Displays history/timeline of record changes.

**Inherits from:** Control

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `SortType` | enum | ASC | Sort order (ASC = oldest first, DESC = newest first) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `HistoryTypes` | List&lt;string&gt; | History types to display (Create, Update, ChangeState, etc.) |
| `StepStates` | List&lt;string&gt; | Specific workflow states to show |

### Standard HistoryTypes

| Type | Description |
|------|-------------|
| `Create` | Record created |
| `Update` | Record updated |
| `ChangeState` | Workflow state changed |
| `Delete` | Record deleted |
| `Comment` | Comment added |
| `File` | File uploaded/deleted |

### Examples

**Basic timeline:**
```xml
<Control xsi:type="TimeLineControl"
         Ident="Timeline"
         TitleResourceKey="History_Form"
         SortType="DESC">
  <HistoryTypes>
    <string>Create</string>
    <string>ChangeState</string>
    <string>Update</string>
  </HistoryTypes>
</Control>
```

**With specific states:**
```xml
<Control xsi:type="TimeLineControl"
         Ident="ApprovalHistory"
         TitleResourceKey="ApprovalHistory_Form"
         SortType="DESC">
  <HistoryTypes>
    <string>ChangeState</string>
  </HistoryTypes>
  <StepStates>
    <string>10</string>  <!-- Submitted -->
    <string>20</string>  <!-- Under Review -->
    <string>30</string>  <!-- Approved -->
    <string>40</string>  <!-- Rejected -->
  </StepStates>
</Control>
```

---

## CommunicationControl

Comments/discussion thread on a record.

**Inherits from:** RichTextBoxControl

### Examples

```xml
<Control xsi:type="CommunicationControl"
         Ident="Comments"
         TitleResourceKey="Comments_Form" />
```

---

## CommunicationListControl

List of communications across records.

**Inherits from:** Control

### Examples

```xml
<Control xsi:type="CommunicationListControl"
         Ident="AllComments"
         TitleResourceKey="AllComments_Form" />
```
