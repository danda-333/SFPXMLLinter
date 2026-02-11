# WorkFlow State Checklist (Quick Reference)

Use this checklist when generating or reviewing WorkFlow XML files.

## Mandatory Checklist

### ✅ State Definition

- [ ] State 0 exists: `<State Value="0" TitleResourceKey="Deleted_*" ColorCssClass="danger"/>`
- [ ] State 1 exists: `<State Value="1" TitleResourceKey="New_*" ColorCssClass="warning"/>`
- [ ] State 10 exists: `<State Value="10" TitleResourceKey="Draft_*" ColorCssClass="primary"/>`
- [ ] WorkFlow has `StartState="1"` and `DeleteState="0"` attributes

### ✅ Step State="1" Configuration

- [ ] Step State="1" exists
- [ ] Save button in State 1 has ChangeState action:
  ```xml
  <Button Ident="SaveButton" IsVisible="true">
    <Actions>
      <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
    </Actions>
  </Button>
  ```
- [ ] State 1 is ONLY used for creating new records (not for editing existing ones)

### ✅ Step State="10" Configuration

- [ ] Step State="10" exists
- [ ] Save button in State 10 exists (can be without ChangeState action)
- [ ] Submit/Next button in State 10 changes to next workflow state (20+)

## State Numbering Reference

| Range | Purpose | Example Names | ColorCssClass |
|-------|---------|---------------|---------------|
| 0 | Deleted | Deleted | danger |
| 1 | Creating | New, Creating | warning |
| 2-9 | First save | Saved, Draft | primary |
| 10-29 | In progress | InProgress, Concept, Developed | primary |
| 30-49 | Waiting | WaitingForApproval, Submitted | info |
| 50-69 | Rejected | Rejected, Paused, CriteriaNotFilled | danger |
| 70-99 | Approved | Approved, Active, Published | success |
| 100+ | Closed | Completed, Archived, Closed | dark |

## Quick Template

```xml
<WorkFlow Ident="MyFormWorkFlow" FormIdent="MyForm" StartState="1" DeleteState="0">
  <Definition>
    <States>
      <State Value="0" TitleResourceKey="Deleted_MyForm" ColorCssClass="danger"/>
      <State Value="1" TitleResourceKey="New_MyForm" ColorCssClass="warning"/>
      <State Value="10" TitleResourceKey="Draft_MyForm" ColorCssClass="primary"/>
      <!-- Add more states as needed -->
    </States>
  </Definition>

  <Steps>
    <Step State="1">
      <Groups>
        <Group>
          <Permissions><string>User</string></Permissions>
          <Buttons>
            <Button Ident="SaveButton" IsVisible="true">
              <Actions>
                <Action xsi:type="ChangeState" State="10" ActionStart="AfterSave" />
              </Actions>
            </Button>
          </Buttons>
          <Controls>
            <!-- Editable controls -->
          </Controls>
        </Group>
      </Groups>
    </Step>

    <Step State="10">
      <Groups>
        <Group>
          <Permissions><string>User</string></Permissions>
          <Buttons>
            <Button Ident="SaveButton" IsVisible="true" />
            <Button Ident="SubmitButton" IsVisible="true">
              <Actions>
                <Action xsi:type="ChangeState" State="20" ActionStart="AfterSave" />
              </Actions>
            </Button>
          </Buttons>
          <Controls>
            <!-- Editable controls -->
          </Controls>
        </Group>
      </Groups>
    </Step>
  </Steps>
</WorkFlow>
```

## Common Mistakes

### ❌ NEVER Do This:

```xml
<!-- WRONG: State 1 Save button without ChangeState -->
<Step State="1">
  <Groups>
    <Group>
      <Buttons>
        <Button Ident="SaveButton" IsVisible="true" />
      </Buttons>
    </Group>
  </Groups>
</Step>
```

### ❌ NEVER Do This:

```xml
<!-- WRONG: No Step State="10" defined -->
<Steps>
  <Step State="1">...</Step>
  <Step State="20">...</Step>  <!-- Jumped from 1 to 20 -->
</Steps>
```

### ❌ NEVER Do This:

```xml
<!-- WRONG: Inconsistent state numbering -->
<States>
  <State Value="0" ... />
  <State Value="1" ... />
  <State Value="2" ... />
  <State Value="5" ... />
  <State Value="8" ... />
  <State Value="15" ... />
</States>
```

## Validation Questions

Before generating WorkFlow, ask yourself:

1. **Does State 1 have a Save button that changes state to 10?** → YES = ✅
2. **Can a record stay in State 1 after being saved?** → NO = ✅
3. **Does Step State="10" exist?** → YES = ✅
4. **Are state numbers logical and follow conventions?** → YES = ✅
5. **Is there a clear separation between "creating" and "editing"?** → YES = ✅

If any answer is wrong, **fix the WorkFlow before proceeding**.
