# WorkFlow Documentation

WorkFlow defines the business logic, state machine, permissions, and actions for a Form. Every Form has an associated WorkFlow that controls what users can do at each state.

---

## State Best Practices

**CRITICAL: State 1 Must Be Reserved for New Records Only**

The most common mistake in WorkFlow design is using `State="1"` for both:
- Records that are **being created** (form is open but not yet saved)
- Records that **already exist** (form was saved and reopened)

This creates ambiguity and logic errors. **Always separate these two scenarios into different states.**

### Mandatory State Structure

Every WorkFlow MUST have at least these states:

| State | Purpose | ColorCssClass | When Used |
|-------|---------|---------------|-----------|
| **0** | Deleted | `danger` | DeleteState - record is deleted |
| **1** | New/Creating | `warning` | StartState - record is being created (not yet in DB) |
| **2/10** | Saved/Draft | `primary` | Record exists in DB, can be edited |

### State Numbering Conventions

| Range | Purpose | Examples | ColorCssClass |
|-------|---------|----------|---------------|
| **0** | Deleted | `Deleted`, `Removed` | `danger` |
| **1** | Initial creation | `New`, `Creating` | `warning` |
| **2-9** | First save | `Saved`, `Draft` | `primary` |
| **10-29** | Work in progress | `InProgress`, `Concept`, `Developed` | `primary` |
| **30-49** | Waiting for action | `WaitingForApproval`, `Submitted` | `info` |
| **50-69** | Rejected/Paused | `Rejected`, `Paused`, `CriteriaNotFilled` | `danger` |
| **70-99** | Approved/Active | `Approved`, `Active`, `Published` | `success` |
| **100+** | Closed | `Completed`, `Archived`, `Closed` | `dark` |

### Correct Implementation Pattern

```xml
<WorkFlow Ident="MyFormWorkFlow" FormIdent="MyForm" StartState="1" DeleteState="0">
  <Definition>
    <States>
      <!-- MANDATORY: Deleted state -->
      <State Value="0" TitleResourceKey="Deleted_MyForm" ColorCssClass="danger"/>

      <!-- MANDATORY: New/Creating state - ONLY for records being created -->
      <State Value="1" TitleResourceKey="New_MyForm" ColorCssClass="warning"/>

      <!-- MANDATORY: Saved/Draft state - for records that exist in DB -->
      <State Value="10" TitleResourceKey="Draft_MyForm" ColorCssClass="primary"/>

      <!-- OPTIONAL: Additional workflow states -->
      <State Value="20" TitleResourceKey="Submitted_MyForm" ColorCssClass="info"/>
      <State Value="30" TitleResourceKey="Approved_MyForm" ColorCssClass="success"/>
    </States>
  </Definition>

  <Steps>
    <!-- State 1: User is CREATING a new record -->
    <Step State="1">
      <Groups>
        <Group>
          <Permissions>
            <string>User</string>
          </Permissions>
          <Buttons>
            <!-- IMPORTANT: Save button MUST change state to 10 -->
            <Button Ident="SaveButton" IsVisible="true">
              <Actions>
                <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
              </Actions>
            </Button>
          </Buttons>
          <Controls>
            <FormControl Ident="Name" IsReadOnly="false" />
          </Controls>
        </Group>
      </Groups>
    </Step>

    <!-- State 10: Record EXISTS in DB and can be edited -->
    <Step State="10">
      <Groups>
        <Group>
          <Permissions>
            <string>User</string>
          </Permissions>
          <Buttons>
            <!-- Save button keeps the same state (10) -->
            <Button Ident="SaveButton" IsVisible="true" />

            <!-- Submit button moves to next state -->
            <Button Ident="SubmitButton" IsVisible="true">
              <Actions>
                <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
              </Actions>
            </Button>
          </Buttons>
          <Controls>
            <FormControl Ident="Name" IsReadOnly="false" />
          </Controls>
        </Group>
      </Groups>
    </Step>
  </Steps>
</WorkFlow>
```

### Real-World Examples from Codebase

**Example 1: VolunteerWorkFlow.xml** (Correct - 3 states)
```xml
<States>
  <State Value="0" TitleResourceKey="Deleted_Volunteer" ColorCssClass="danger"/>
  <State Value="1" TitleResourceKey="New_Volunteer" ColorCssClass="warning"/>
  <State Value="2" TitleResourceKey="Saved_Volunteer" ColorCssClass="primary"/>
</States>
```
✅ State 1 = New (creating), State 2 = Saved (exists in DB)

**Example 2: EventFormWorkFlow.xml** (Correct - multiple states)
```xml
<States>
  <State Value="0" TitleResourceKey="Deleted_Event" ColorCssClass="danger"/>
  <State Value="1" TitleResourceKey="New_Event" ColorCssClass="warning"/>
  <State Value="20" TitleResourceKey="Developed_Event" ColorCssClass="primary"/>
  <State Value="30" TitleResourceKey="WaitForApprove_Event" ColorCssClass="info"/>
  <State Value="40" TitleResourceKey="Approved_Event" ColorCssClass="success"/>
  <State Value="50" TitleResourceKey="Rejected_Event" ColorCssClass="danger"/>
</States>
```
✅ State 1 = New, immediately transitions to State 20 after first save

### Common Mistakes to Avoid

#### ❌ WRONG: Using State 1 for both creating and editing

```xml
<Step State="1">
  <Groups>
    <Group>
      <Buttons>
        <!-- WRONG: Save button doesn't change state -->
        <Button Ident="SaveButton" IsVisible="true" />

        <!-- User can save multiple times in State 1 -->
        <Button Ident="SubmitButton" IsVisible="true">
          <Actions>
            <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
          </Actions>
        </Button>
      </Buttons>
    </Group>
  </Groups>
</Step>

<!-- WRONG: No Step State="10" for saved drafts -->
```

**Problems with this approach:**
- Cannot distinguish between "record being created" vs "record already exists"
- Validations and permissions cannot differentiate between create and edit modes
- Business logic cannot determine if this is first save or subsequent edit
- DataViews cannot filter for "saved drafts" vs "new records"

#### ✅ CORRECT: Separate states for creating and editing

```xml
<Step State="1">
  <Groups>
    <Group>
      <Buttons>
        <!-- Save button ALWAYS moves to State 10 on first save -->
        <Button Ident="SaveButton" IsVisible="true">
          <Actions>
            <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
          </Actions>
        </Button>
      </Buttons>
    </Group>
  </Groups>
</Step>

<Step State="10">
  <Groups>
    <Group>
      <Buttons>
        <!-- Save button keeps State 10 for subsequent saves -->
        <Button Ident="SaveButton" IsVisible="true" />

        <!-- Submit button moves to next workflow state -->
        <Button Ident="SubmitButton" IsVisible="true">
          <Actions>
            <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
          </Actions>
        </Button>
      </Buttons>
    </Group>
  </Groups>
</Step>
```

### AI Generation Rules

When generating WorkFlow XML, **ALWAYS**:

1. ✅ Define State 0 as `Deleted` (ColorCssClass="danger")
2. ✅ Define State 1 as `New` or `Creating` (ColorCssClass="warning")
3. ✅ Define State 2/10 as `Saved`, `Draft`, or `Concept` (ColorCssClass="primary")
4. ✅ In Step State="1", the Save button MUST include `<Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />`
5. ✅ In Step State="10", the Save button can omit ChangeState action (keeps same state)
6. ✅ Use states 20+ for subsequent workflow phases (Submitted, Approved, etc.)

**NEVER**:
- ❌ Use State 1 for both "creating" and "saved" records
- ❌ Allow Save button in State 1 without changing state
- ❌ Skip State 10 and jump directly from State 1 to State 20+
- ❌ Use inconsistent numbering (e.g., 1, 2, 5, 8, 15)

---

## Root Element

```xml
<WorkFlow xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
          Ident="MyFormWorkFlow"
          FormIdent="MyForm"
          StartState="1"
          DeleteState="0">
  <!-- Content -->
</WorkFlow>
```

## Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Unique workflow identifier |
| `FormIdent` | string | - | **Required.** Form this workflow applies to |
| `StartState` | int | 1 | Initial state for new records |
| `DeleteState` | int | 0 | State representing deleted records |

## Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Definition` | Definition | State definitions with names and colors |
| `Steps` | List&lt;Step&gt; | State-specific configurations |
| `GlobalActions` | List&lt;Action&gt; | Actions executed on every save |
| `GlobalJavaScripts` | List&lt;JavaScript&gt; | Client-side scripts for all states |
| `ActionShareCodes` | List&lt;ActionShareCode&gt; | Reusable action groups |
| `ButtonShareCodes` | List&lt;ButtonShareCode&gt; | Reusable button configurations |
| `ControlShareCodes` | List&lt;ControlShareCode&gt; | Reusable control configurations |
| `JavaScriptShareCodes` | List&lt;JavaScriptShareCode&gt; | Reusable JavaScript configurations |
| `PackageIdents` | List&lt;string&gt; | Referenced package identifiers |
| `ControlDataSource` | DataSource | Dynamic control settings |

---

## Definition

Defines all possible states for the workflow.

### State Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `Value` | int | **Required.** State numeric value |
| `Title` | string | State name |
| `TitleResourceKey` | string | State name from translations |
| `ColorCssClass` | string | CSS class for state badge color |
| `IsOutOfSLA` | bool | Exclude from SLA calculations |

### ColorCssClass Values

| Value | Color | Usage |
|-------|-------|-------|
| `danger` | Red | Deleted, Rejected |
| `warning` | Yellow/Orange | New, Draft |
| `primary` | Blue | In Progress |
| `info` | Light Blue | Waiting |
| `success` | Green | Approved, Completed |
| `dark` | Dark | Archived |

### Example

```xml
<Definition>
  <States>
    <State Value="0" TitleResourceKey="Deleted" ColorCssClass="danger" />
    <State Value="1" TitleResourceKey="New" ColorCssClass="warning" />
    <State Value="10" TitleResourceKey="Draft" ColorCssClass="primary" />
    <State Value="20" TitleResourceKey="WaitingForApproval" ColorCssClass="info" />
    <State Value="30" TitleResourceKey="Approved" ColorCssClass="success" />
    <State Value="40" TitleResourceKey="Rejected" ColorCssClass="danger" />
    <State Value="100" TitleResourceKey="Completed" ColorCssClass="dark" IsOutOfSLA="true" />
  </States>
</Definition>
```

---

## Steps

Steps define behavior for each state - what buttons are visible, what controls are editable, and what actions execute.

### Step Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `State` | int | **Required.** State value this step applies to |
| `IsDefault` | bool | Default step if no matching state found |

### Step Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Groups` | List&lt;Group&gt; | Permission-based groups |

### Example

```xml
<Steps>
  <Step State="1">
    <Groups>
      <Group>
        <Permissions>
          <string>Admin</string>
          <string>Editor</string>
        </Permissions>
        <Buttons>
          <Button Ident="SaveButton" IsVisible="true">
            <Actions>
              <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
            </Actions>
          </Button>
        </Buttons>
        <Controls>
          <FormControl Ident="Name" IsReadOnly="false" />
          <FormControl Ident="Description" IsReadOnly="false" />
        </Controls>
      </Group>
    </Groups>
  </Step>
</Steps>
```

---

## Group

Groups define permission-based behavior within a state.

### Group Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsDefault` | bool | false | Default group if no permission match |
| `IsOverwriteCheck` | string | "" | Check for concurrent modifications |

### Group Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Permissions` | List&lt;string&gt; | Permission names that this group applies to |
| `Buttons` | List&lt;Button&gt; | Button configurations |
| `Controls` | List&lt;FormControl&gt; | Control configurations |
| `Sections` | List&lt;Section&gt; | Section visibility |
| `JavaScripts` | List&lt;JavaScript&gt; | Client-side scripts |
| `BeforeOpenActions` | List&lt;Action&gt; | Actions when form opens |
| `Wizard` | Wizard | Wizard configuration |

### Example

```xml
<Group>
  <Permissions>
    <string>Admin</string>
  </Permissions>
  <Buttons>
    <Button Ident="ApproveButton" IsVisible="true">
      <Actions>
        <Action xsi:type="ChangeState" State="30" ActionStart="AfterSave" />
      </Actions>
    </Button>
    <Button Ident="RejectButton" IsVisible="true">
      <Actions>
        <Action xsi:type="ChangeState" State="40" ActionStart="AfterSave" />
      </Actions>
    </Button>
  </Buttons>
  <Controls>
    <FormControl Ident="ApprovalComment" IsVisible="true" IsReadOnly="false" />
  </Controls>
  <Sections>
    <Section Ident="ApprovalSection" IsVisible="true" />
  </Sections>
</Group>
```

---

## WorkFlow Button

Configures button behavior within workflow.

### Button Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | **Required.** Button identifier (from Form) |
| `IsVisible` | string | "" | Visibility (true/false/null) |
| `Title` | string | "" | Override button title |
| `TitleResourceKey` | string | "" | Override title from translations |
| `IconCssClass` | string | "" | Override icon |
| `IsStopRedirect` | string | "" | Stay on form after action |
| `IsVisibleCondition` | bool | false | Use VisibleCondition DataSource |

### Button Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Actions` | List&lt;Action&gt; | Actions to execute when clicked |
| `VisibleCondition` | DataSource | SQL condition for visibility |

### Example

```xml
<Button Ident="SubmitButton" IsVisible="true" IsVisibleCondition="true">
  <VisibleCondition>
    <SQL>
      SELECT IIF(@State = 10 AND @IsComplete = 1, 1, 0) AS IsVisible
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="State" DataType="Number" />
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="IsComplete" DataType="Bool" />
    </Parameters>
  </VisibleCondition>
  <Actions>
    <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
    <Action xsi:type="Email" SubjectResourceKey="SubmitSubject"
            BodyResourceKey="SubmitBody" ActionStart="AfterSave">
      <!-- Email configuration -->
    </Action>
  </Actions>
</Button>
```

---

## WorkFlow FormControl

Configures control behavior within workflow state.

### FormControl Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | **Required.** Control identifier (from Form) |
| `IsVisible` | string | Visibility (true/false/null) |
| `IsReadOnly` | string | Read-only mode |
| `IsFakeReadOnly` | string | Appears read-only but saves |
| `IsRequired` | string | Required validation |
| `IsShowRequired` | string | Show required asterisk |
| `Title` | string | Override title |
| `TitleResourceKey` | string | Override title from translations |
| `IsUseValidation` | bool | Apply validations list |
| `ShowIsNotEmpty` | bool | Show only if has value |

### FormControl Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Validations` | List&lt;Validation&gt; | Additional validations |

### Example

```xml
<Controls>
  <FormControl Ident="Name" IsReadOnly="false" IsRequired="true" />
  <FormControl Ident="Description" IsReadOnly="false" />
  <FormControl Ident="ApprovedBy" IsVisible="false" />
  <FormControl Ident="Amount" IsReadOnly="true" />
</Controls>
```

---

## WorkFlow Section

Configures section visibility within workflow state.

### Section Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | **Required.** Section identifier (from Form) |
| `IsVisible` | string | Visibility (true/false) |
| `IsVisibleCondition` | bool | Use VisibleCondition |

### Section Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `VisibleCondition` | DataSource | SQL condition for visibility |

### Example

```xml
<Sections>
  <Section Ident="ApprovalSection" IsVisible="true" />
  <Section Ident="AdminSection" IsVisible="false" />
  <Section Ident="HistorySection" IsVisibleCondition="true">
    <VisibleCondition>
      <SQL>SELECT IIF(@ID IS NOT NULL, 1, 0)</SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
      </Parameters>
    </VisibleCondition>
  </Section>
</Sections>
```

---

## Actions

Actions define server-side logic executed on form events.

### Action Base Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | "" | Action identifier |
| `ActionStart` | enum | BeforeValidation | When to execute |
| `RunPriority` | int | 1 | Execution priority (lower = first) |

### ActionStartTypes Enum

| Value | Description |
|-------|-------------|
| `BeforeValidation` | Before form validation |
| `AfterValidation` | After validation, before save |
| `AfterSave` | After form data is saved |
| `AfterPermission` | After permissions are saved |

---

## Action Types

### ChangeState

Changes the workflow state.

```xml
<Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
```

With dynamic state:
```xml
<Action xsi:type="ChangeState" ActionStart="AfterSave">
  <StateDataSource>
    <SQL>SELECT CASE WHEN @Amount > 1000 THEN 30 ELSE 20 END AS State</SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="Amount" DataType="Double" />
    </Parameters>
  </StateDataSource>
</Action>
```

---

### SetValue

Sets a control value.

| Attribute | Type | Description |
|-----------|------|-------------|
| `ControlIdent` | string | Target control (or use Ident) |
| `Value` | string | Static value |
| `ConstantType` | enum | System constant (UserID, DateTimeNow, etc.) |

```xml
<!-- Static value -->
<Action xsi:type="SetValue" Ident="Status" Value="Approved" ActionStart="AfterValidation" />

<!-- Current user ID -->
<Action xsi:type="SetValue" Ident="ApprovedByID" ConstantType="UserID" ActionStart="AfterValidation" />

<!-- Current date -->
<Action xsi:type="SetValue" Ident="ApprovedDate" ConstantType="DateTimeNow" ActionStart="AfterValidation" />
```

---

### Required

Makes controls required dynamically.

```xml
<Action xsi:type="Required" ActionStart="BeforeValidation">
  <Idents>
    <string>Name</string>
    <string>Email</string>
    <string>Phone</string>
  </Idents>
</Action>
```

---

### IF / IFExpression

Conditional action execution.

```xml
<Action xsi:type="IF" ActionStart="BeforeValidation">
  <Condition>
    <SQL>SELECT IIF(@Amount > 1000, 1, 0)</SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="Amount" DataType="Double" />
    </Parameters>
  </Condition>
  <TrueActions>
    <Action xsi:type="Required" ActionStart="BeforeValidation">
      <Idents>
        <string>ManagerApproval</string>
      </Idents>
    </Action>
  </TrueActions>
  <FalseActions>
    <Action xsi:type="ChangeState" State="30" ActionStart="AfterSave" />
  </FalseActions>
</Action>
```

---

### Email

Sends email notification.

| Attribute | Type | Description |
|-----------|------|-------------|
| `From` | string | Sender email |
| `FromName` | string | Sender name |
| `SubjectResourceKey` | string | Subject from translations |
| `BodyResourceKey` | string | Body from translations |
| `EmailIdent` | string | Unique ID to prevent duplicates |
| `Priority` | enum | Normal, High, Low |

```xml
<Action xsi:type="Email"
        SubjectResourceKey="ApprovalSubject_Email"
        BodyResourceKey="ApprovalBody_Email"
        EmailIdent="ApprovalEmail"
        ActionStart="AfterSave">
  <Recipients>
    <Recipient RecipientType="To" SourceType="SQL">
      <DataSource>
        <SQL>
          SELECT a.Email, a.LanguageID
          FROM dbo.Account a
          INNER JOIN usr.MyForm f ON f.ManagerID = a.ID
          WHERE f.ID = @ID
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
        </Parameters>
      </DataSource>
    </Recipient>
  </Recipients>
  <Attachments>
    <Attachment xsi:type="GenerateDocumentAttachment" SectionIdent="PDFSection" FileName="Document.pdf" />
  </Attachments>
</Action>
```

---

### SMS

Sends SMS notification.

```xml
<Action xsi:type="SMS" MessageResourceKey="NotificationSMS" ActionStart="AfterSave">
  <Recipients>
    <Recipient SourceType="SQL">
      <DataSource>
        <SQL>SELECT Phone, LanguageID FROM usr.Contact WHERE FormID = @ID</SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
        </Parameters>
      </DataSource>
    </Recipient>
  </Recipients>
</Action>
```

---

### Alert

Shows in-app notification.

```xml
<Action xsi:type="Alert" ActionStart="AfterSave">
  <Recipients>
    <Recipient SourceType="SQL">
      <DataSource>
        <SQL>SELECT AccountID FROM usr.Assignee WHERE FormID = @ID</SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
        </Parameters>
      </DataSource>
    </Recipient>
  </Recipients>
</Action>
```

---

### GlobalValidation

Custom validation with error message.

```xml
<Action xsi:type="GlobalValidation"
        ActionStart="BeforeValidation"
        ErrorMessageResourceKey="DateFromMustBeBeforeDateTo">
  <Condition>
    <SQL>SELECT IIF(@DateFrom <= @DateTo, 1, 0)</SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="DateFrom" DataType="Date" />
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="DateTo" DataType="Date" />
    </Parameters>
  </Condition>
  <ControlIdents>
    <string>DateFrom</string>
  </ControlIdents>
</Action>
```

---

### ActionTrigger

Executes SQL command.

```xml
<Action xsi:type="ActionTrigger" Ident="UpdateRelated" ActionStart="AfterSave">
  <DataSource>
    <SQL>
      UPDATE usr.RelatedTable
      SET Status = 'Updated', ModifiedDate = GETDATE()
      WHERE ParentID = @ID
    </SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Action>
```

---

### CreateFor (Loop)

Creates multiple records.

```xml
<Action xsi:type="CreateFor" ActionStart="AfterSave">
  <DataSource>
    <SQL>SELECT UserID FROM usr.TeamMember WHERE TeamID = @TeamID</SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="TeamID" DataType="Number" />
    </Parameters>
  </DataSource>
  <Actions>
    <Action xsi:type="ActionTrigger" ActionStart="AfterSave">
      <DataSource>
        <SQL>INSERT INTO usr.Task (AssigneeID, FormID) VALUES (@UserID, @ID)</SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="UserID" DataType="Number" />
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
        </Parameters>
      </DataSource>
    </Action>
  </Actions>
</Action>
```

---

### SwitchCase

Multiple condition branches.

```xml
<Action xsi:type="SwitchCase" ActionStart="AfterSave">
  <Cases>
    <Case Value="1">
      <Actions>
        <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
      </Actions>
    </Case>
    <Case Value="2">
      <Actions>
        <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
      </Actions>
    </Case>
    <Default>
      <Actions>
        <Action xsi:type="ChangeState" State="30" ActionStart="AfterSave" />
      </Actions>
    </Default>
  </Cases>
</Action>
```

---

### Other Action Types

| Type | Description |
|------|-------------|
| `DuplicationAction` | Duplicate record |
| `GenerateFileAction` | Generate file from template |
| `GenerateFormAction` | Generate linked form |
| `GenerateSubFormAction` | Generate sub-form records |
| `PushNotificationAction` | Send push notification |
| `CommunicationAction` | Add communication entry |
| `HistoryAction` | Record history entry |
| `RunTaskSchedulerAction` | Trigger scheduled task |
| `DLLExecuteAction` | Execute .NET DLL method |
| `PyExecuteAction` | Execute Python script |
| `ClearCacheAction` | Clear application cache |
| `ReloadAction` | Reload form data |
| `ShareCodeAction` | Execute shared action code |

---

## JavaScripts

Client-side behavior definitions.

### ShowHide

Show/hide elements based on control value.

```xml
<JavaScript xsi:type="ShowHide" Ident="ShowDetails" ControlIdent="ShowDetailsCheckbox">
  <Selectors>
    <string>.details-section</string>
    <string>#DetailsPanel</string>
  </Selectors>
  <ShowValues>
    <string>1</string>
    <string>true</string>
  </ShowValues>
</JavaScript>
```

### ReadOnly

Make controls read-only based on value.

```xml
<JavaScript xsi:type="ReadOnly" Ident="LockAmount" ControlIdent="IsLocked">
  <ControlIdents>
    <string>Amount</string>
    <string>Currency</string>
  </ControlIdents>
  <Values>
    <string>1</string>
  </Values>
</JavaScript>
```

---

## ShareCodes

Reusable configurations to avoid duplication.

### ActionShareCode

```xml
<ActionShareCodes>
  <ActionShareCode Ident="RequiredFieldsShare">
    <Actions>
      <Action xsi:type="Required" ActionStart="BeforeValidation">
        <Idents>
          <string>Name</string>
          <string>Email</string>
        </Idents>
      </Action>
    </Actions>
  </ActionShareCode>
</ActionShareCodes>

<!-- Usage in Button -->
<Button Ident="SubmitButton">
  <Actions>
    <Action xsi:type="ShareCode" Ident="RequiredFieldsShare" />
    <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
  </Actions>
</Button>
```

### ButtonShareCode

```xml
<ButtonShareCodes>
  <ButtonShareCode Ident="SaveButtonShare">
    <Buttons>
      <Button Ident="SaveButton" IsVisible="true">
        <Actions>
          <!-- Actions -->
        </Actions>
      </Button>
    </Buttons>
  </ButtonShareCode>
</ButtonShareCodes>

<!-- Usage in Group -->
<Buttons>
  <Button xsi:type="ShareCodeButton" Ident="SaveButtonShare" />
</Buttons>
```

### ControlShareCode

```xml
<ControlShareCodes>
  <ControlShareCode Ident="EditableFieldsShare">
    <Controls>
      <FormControl Ident="Name" IsReadOnly="false" />
      <FormControl Ident="Description" IsReadOnly="false" />
      <FormControl Ident="Amount" IsReadOnly="false" />
    </Controls>
  </ControlShareCode>
</ControlShareCodes>

<!-- Usage in Group -->
<Controls>
  <FormControl xsi:type="ShareCodeControl" Ident="EditableFieldsShare" />
</Controls>
```

---

## Complete Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<WorkFlow xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
          Ident="OrderWorkFlow"
          FormIdent="Order"
          StartState="1"
          DeleteState="0">

  <Definition>
    <States>
      <State Value="0" TitleResourceKey="Deleted" ColorCssClass="danger" />
      <State Value="1" TitleResourceKey="New" ColorCssClass="warning" />
      <State Value="10" TitleResourceKey="Draft" ColorCssClass="primary" />
      <State Value="20" TitleResourceKey="Submitted" ColorCssClass="info" />
      <State Value="30" TitleResourceKey="Approved" ColorCssClass="success" />
      <State Value="40" TitleResourceKey="Rejected" ColorCssClass="danger" />
    </States>
  </Definition>

  <GlobalActions>
    <Action xsi:type="GlobalValidation"
            ActionStart="BeforeValidation"
            ErrorMessageResourceKey="TotalMustBePositive">
      <Condition>
        <SQL>SELECT IIF(@Total > 0, 1, 0)</SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="Total" DataType="Double" />
        </Parameters>
      </Condition>
      <ControlIdents>
        <string>Total</string>
      </ControlIdents>
    </Action>
  </GlobalActions>

  <ActionShareCodes>
    <ActionShareCode Ident="RequiredForSubmit">
      <Actions>
        <Action xsi:type="Required" ActionStart="BeforeValidation">
          <Idents>
            <string>CustomerID</string>
            <string>Total</string>
          </Idents>
        </Action>
      </Actions>
    </ActionShareCode>
  </ActionShareCodes>

  <ButtonShareCodes>
    <ButtonShareCode Ident="SaveButtonShare">
      <Buttons>
        <Button Ident="SaveButton" IsVisible="true" />
      </Buttons>
    </ButtonShareCode>

    <ButtonShareCode Ident="DeleteButtonShare">
      <Buttons>
        <Button Ident="DeleteButton" IsVisible="true">
          <Actions>
            <Action xsi:type="ChangeState" State="0" ActionStart="AfterSave" />
          </Actions>
        </Button>
      </Buttons>
    </ButtonShareCode>
  </ButtonShareCodes>

  <Steps>
    <!-- New State -->
    <Step State="1">
      <Groups>
        <Group>
          <Permissions>
            <string>SalesRep</string>
            <string>Admin</string>
          </Permissions>
          <Buttons>
            <Button xsi:type="ShareCodeButton" Ident="SaveButtonShare" />
            <Button Ident="SubmitButton" IsVisible="true">
              <Actions>
                <Action xsi:type="ShareCode" Ident="RequiredForSubmit" />
                <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
              </Actions>
            </Button>
          </Buttons>
          <Controls>
            <FormControl Ident="CustomerID" IsReadOnly="false" />
            <FormControl Ident="Items" IsReadOnly="false" />
            <FormControl Ident="Total" IsReadOnly="false" />
          </Controls>
        </Group>
      </Groups>
    </Step>

    <!-- Submitted State -->
    <Step State="20">
      <Groups>
        <Group>
          <Permissions>
            <string>Manager</string>
            <string>Admin</string>
          </Permissions>
          <Buttons>
            <Button Ident="ApproveButton" IsVisible="true">
              <Actions>
                <Action xsi:type="SetValue" Ident="ApprovedByID" ConstantType="UserID" ActionStart="AfterValidation" />
                <Action xsi:type="SetValue" Ident="ApprovedDate" ConstantType="DateTimeNow" ActionStart="AfterValidation" />
                <Action xsi:type="ChangeState" State="30" ActionStart="AfterSave" />
                <Action xsi:type="Email" SubjectResourceKey="OrderApproved_Subject"
                        BodyResourceKey="OrderApproved_Body" ActionStart="AfterSave">
                  <Recipients>
                    <Recipient RecipientType="To" SourceType="SQL">
                      <DataSource>
                        <SQL>
                          SELECT a.Email, a.LanguageID
                          FROM usr.[Order] o
                          INNER JOIN dbo.Account a ON a.ID = o.CreateAccountID
                          WHERE o.ID = @ID
                        </SQL>
                        <Parameters>
                          <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
                        </Parameters>
                      </DataSource>
                    </Recipient>
                  </Recipients>
                </Action>
              </Actions>
            </Button>
            <Button Ident="RejectButton" IsVisible="true">
              <Actions>
                <Action xsi:type="ChangeState" State="40" ActionStart="AfterSave" />
              </Actions>
            </Button>
          </Buttons>
          <Controls>
            <FormControl Ident="ApprovalComment" IsVisible="true" IsReadOnly="false" />
          </Controls>
        </Group>
        <Group>
          <Permissions>
            <string>SalesRep</string>
          </Permissions>
          <!-- Sales rep can only view in this state -->
        </Group>
      </Groups>
    </Step>

    <!-- Approved State -->
    <Step State="30">
      <Groups>
        <Group IsDefault="true">
          <!-- Read-only for everyone -->
        </Group>
      </Groups>
    </Step>
  </Steps>
</WorkFlow>
```

---

## XML Namespaces

Required namespaces for WorkFlow:

```xml
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema"
xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
xmlns:wfas="http://www.gappex.com/sfp/WorkFlow/Action/SMS"
```

---

## DO NOT - Common Mistakes

### Structure Errors

```xml
<!-- WRONG: Permissions directly in Step -->
<Step State="1">
  <Buttons>...</Buttons>
  <Permissions>
    <string>Admin</string>
  </Permissions>
</Step>

<!-- CORRECT: Permissions must be in Groups > Group -->
<Step State="1">
  <Groups>
    <Group>
      <Permissions>
        <string>Admin</string>
      </Permissions>
      <Buttons>...</Buttons>
    </Group>
  </Groups>
</Step>
```

### Button Definition Errors

```xml
<!-- WRONG: Do NOT use xsi:type in WorkFlow buttons -->
<Button xsi:type="FormButton"
        Ident="Save"
        FormButtonType="Save"
        SetState="10" />

<!-- CORRECT: Buttons are defined in Form.xml, WorkFlow only references them -->
<Button Ident="Save" IsVisible="true">
  <Actions>
    <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
  </Actions>
</Button>
```

### Control Settings Errors

```xml
<!-- WRONG: ControlSettings element does NOT exist -->
<ControlSettings>
  <ControlSetting Ident="Name" IsReadOnly="false" />
</ControlSettings>

<!-- CORRECT: Use Controls with FormControl -->
<Controls>
  <FormControl Ident="Name" IsReadOnly="false" />
</Controls>
```

### Action Type Errors

```xml
<!-- WRONG: SQLAction does NOT exist -->
<Action xsi:type="SQLAction" ActionStart="AfterSave">
  <SQL>UPDATE usr.Table SET Field = 1 WHERE ID = @ID</SQL>
</Action>

<!-- CORRECT: Use ActionTrigger for SQL commands -->
<Action xsi:type="ActionTrigger" ActionStart="AfterSave">
  <DataSource>
    <SQL><![CDATA[
      UPDATE usr.Table SET Field = 1 WHERE ID = @ID
    ]]></SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
    </Parameters>
  </DataSource>
</Action>

<!-- CORRECT: Use SetValue for setting field values -->
<Action xsi:type="SetValue" Ident="Field" Value="1" ActionStart="AfterValidation" />
```

### Parameter Type Errors

```xml
<!-- WRONG: IDParameter does NOT exist -->
<Parameters>
  <dsp:Parameter xsi:type="dsp:IDParameter" Ident="ID" />
</Parameters>

<!-- CORRECT: Use VariableParameter -->
<Parameters>
  <dsp:Parameter xsi:type="dsp:VariableParameter" Ident="ID" DataType="Number" />
</Parameters>
```

---

## Correct Hierarchical Structure

```
WorkFlow
├── Definition
│   └── States
│       └── State (Value, TitleResourceKey, ColorCssClass)
├── GlobalActions (optional)
│   └── Action (xsi:type="...")
├── ActionShareCodes (optional)
│   └── ActionShareCode (Ident)
│       └── Actions
├── ButtonShareCodes (optional)
│   └── ButtonShareCode (Ident)
│       └── Buttons
├── ControlShareCodes (optional)
│   └── ControlShareCode (Ident)
│       └── Controls
├── GlobalJavaScripts (optional)
│   └── JavaScript (EventType)
└── Steps
    └── Step (State)
        └── Groups           <-- REQUIRED wrapper!
            └── Group (IsDefault)
                ├── Permissions
                │   └── <string>...</string>
                ├── Buttons
                │   └── Button (Ident, IsVisible)
                │       └── Actions (optional)
                ├── Controls
                │   └── FormControl (Ident, IsReadOnly, IsRequired)
                ├── Sections
                │   └── Section (Ident, IsVisible)
                └── JavaScripts (optional)
```

---

## Valid Action Types

| Type | Purpose | Required Elements |
|------|---------|-------------------|
| `ChangeState` | Change workflow state | `State` attribute or `StateDataSource` |
| `SetValue` | Set field value | `Ident`, `Value` or `ConstantType` |
| `ActionTrigger` | Execute SQL | `DataSource` with `SQL` and `Parameters` |
| `Required` | Make fields required | `Idents` list |
| `IF` | Conditional execution | `Condition`, `TrueActions`, `FalseActions` |
| `IFExpression` | Conditional (expression) | Similar to IF |
| `Email` | Send email | `Recipients`, `SubjectResourceKey`, `BodyResourceKey` |
| `SMS` | Send SMS | `Recipients`, `MessageResourceKey` |
| `Alert` | In-app notification | `Recipients` |
| `GlobalValidation` | Custom validation | `Condition`, `ErrorMessageResourceKey` |
| `SwitchCase` | Multiple conditions | `Cases` with `Case` elements |
| `CreateFor` | Loop/create multiple | `DataSource`, `Actions` |
| `ShareCode` | Reference shared code | `Ident` |

**NOT VALID:** `SQLAction`, `UpdateAction`, `InsertAction`
