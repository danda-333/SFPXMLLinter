# Database Conventions

Tento dokument popisuje standardní databázové konvence a vazby na systémové tabulky používané v SmartFormPlatform.

---

## Systémové tabulky

### dbo.Account - Uživatelé systému

Tabulka `dbo.Account` obsahuje informace o uživatelích systému.

**Použití:**
- Sloupec `AccountID` v jakékoliv tabulce je vazba na `dbo.Account.ID`
- Slouží pro identifikaci uživatele (vytvořil, upravil, přiřazený uživatel, atd.)
- Standardní název pro foreign key: `AccountID`, `CreateAccountID`, `ModifyAccountID`, `AssignedAccountID`, atd.

**Dostupné sloupce:**

| Sloupec | Typ | Popis |
|---------|-----|-------|
| `ID` | int | Primární klíč uživatele |
| `FullName` | nvarchar | Celé jméno uživatele |
| `Email` | nvarchar | Email uživatele |
| `UserName` | nvarchar | Přihlašovací jméno |

---

## Příklady použití

### 1. DataView - JOIN na dbo.Account

Pokud DataView obsahuje sloupec `AccountID`, můžete jej propojit s tabulkou `dbo.Account` pro získání jména uživatele:

```xml
<DataSource FormIdent="Task">
  <Columns>
    <Column Ident="ID" IsPrimaryKey="true" IsVisible="false" DataType="Number" />
    <Column Ident="Name" TitleResourceKey="Name" Width="40" IsDefaultSort="true" />
    <Column Ident="AssignedToName" TitleResourceKey="AssignedTo" Width="25">
      <SQL><![CDATA[acc.FullName AS AssignedToName]]></SQL>
    </Column>
    <Column Ident="CreatedByName" TitleResourceKey="CreatedBy" Width="20">
      <SQL><![CDATA[creator.FullName AS CreatedByName]]></SQL>
    </Column>
    <Column xsi:type="WorkFlowStateColumn" Ident="State" FormIdent="Task"
            TitleResourceKey="Status" Width="15" IsColor="true" />
  </Columns>
  <SQL><![CDATA[
    SELECT
      t.ID,
      t.Name,
      t.AssignedAccountID,
      acc.FullName AS AssignedToName,
      t.CreateAccountID,
      creator.FullName AS CreatedByName,
      t.State
    FROM usr.Task t
    LEFT JOIN dbo.Account acc ON acc.ID = t.AssignedAccountID
    LEFT JOIN dbo.Account creator ON creator.ID = t.CreateAccountID
    WHERE t.State != 0
      AND #PERMISSION[Task(t)]#
      #FILTER#
    ORDER BY t.CreateDate DESC
  ]]></SQL>
</DataSource>
```

**Poznámka:** Používejte `LEFT JOIN`, protože AccountID může být NULL.

---

### 2. Controls - DropDownList pro výběr uživatele

Použití `dbo.Account` v dropdown kontrole pro výběr uživatele:

```xml
<Control xsi:type="DropDownListControl"
         Ident="AssignedAccountID"
         DataType="Number"
         TitleResourceKey="AssignedTo">
  <DataBind DefaultTitleResourceKey="SelectUser">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL><![CDATA[
      SELECT
        acc.ID,
        acc.FullName
      FROM dbo.Account acc
      WHERE acc.IsActive = 1
      ORDER BY acc.FullName
    ]]></SQL>
  </DataBind>
</Control>
```

---

### 3. Controls - AutoComplete pro vyhledávání uživatele

AutoComplete s vyhledáváním podle jména:

```xml
<Control xsi:type="AutoCompleteControl"
         Ident="AssignedAccountID"
         DataType="Number"
         TitleResourceKey="AssignedTo"
         MinStartSearch="2">
  <DataBind DefaultTitleResourceKey="SelectUser">
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
      <Column Ident="Email" DataBindType="ToolTip" />
    </Columns>
    <SQL><![CDATA[
      SELECT
        acc.ID,
        acc.FullName,
        acc.Email
      FROM dbo.Account acc
      WHERE acc.FullName LIKE @AssignedAccountID
        AND acc.IsActive = 1
      ORDER BY acc.FullName
    ]]></SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="AssignedAccountID"
                     DataType="String"
                     LikeType="Both" />
    </Parameters>
  </DataBind>
  <SelectedDataBind>
    <Columns>
      <Column Ident="ID" DataBindType="Value" />
      <Column Ident="FullName" DataBindType="Title" />
    </Columns>
    <SQL><![CDATA[
      SELECT ID, FullName
      FROM dbo.Account
      WHERE ID = @AssignedAccountID
    ]]></SQL>
    <Parameters>
      <dsp:Parameter xsi:type="dsp:VariableParameter"
                     Ident="AssignedAccountID"
                     DataType="Number" />
    </Parameters>
  </SelectedDataBind>
</Control>
```

---

### 4. HTMLTemplate - Zobrazení jména aktuálního uživatele

V HTMLTemplate můžete zobrazit informace o aktuálně přihlášeném uživateli:

```xml
<HTMLTemplate><![CDATA[
  <div class="user-info">
    <p>Přihlášený uživatel: <strong>[%ACCOUNT.FullName%]</strong></p>
    <p>Email: [%ACCOUNT.Email%]</p>
    <p>User ID: [%ACCOUNT.ID%]</p>
  </div>
]]></HTMLTemplate>
```

**Dostupné systémové proměnné:**
- `[%ACCOUNT.ID%]` - ID aktuálního uživatele
- `[%ACCOUNT.FullName%]` - Celé jméno aktuálního uživatele
- `[%ACCOUNT.Email%]` - Email aktuálního uživatele
- `[%ACCOUNT.UserName%]` - Přihlašovací jméno

---

### 5. Parameters - Získání ID aktuálního uživatele

Pro automatické získání ID přihlášeného uživatele použijte `ConstantType="UserID"`:

```xml
<SQL><![CDATA[
  SELECT
    t.ID,
    t.Name,
    t.Description
  FROM usr.Task t
  WHERE t.AssignedAccountID = @CurrentUserID
    AND t.State != 0
  ORDER BY t.Priority DESC
]]></SQL>
<Parameters>
  <dsp:Parameter xsi:type="dsp:VariableParameter"
                 Ident="CurrentUserID"
                 DataType="Number"
                 ConstantType="UserID" />
</Parameters>
```

---

### 6. Filter - Filtrování podle uživatele

Filtr s výběrem uživatele:

```xml
<Filter Ident="TaskFilter">
  <Controls>
    <Control xsi:type="AutoCompleteControl"
             Ident="AssignedAccountID"
             DataType="Number"
             TitleResourceKey="AssignedTo">
      <DataBind DefaultTitleResourceKey="AllUsers">
        <Columns>
          <Column Ident="ID" DataBindType="Value" />
          <Column Ident="FullName" DataBindType="Title" />
        </Columns>
        <SQL><![CDATA[
          SELECT ID, FullName
          FROM dbo.Account
          WHERE FullName LIKE @AssignedAccountID
            AND IsActive = 1
          ORDER BY FullName
        ]]></SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:VariableParameter"
                         Ident="AssignedAccountID"
                         DataType="String"
                         LikeType="Both" />
        </Parameters>
      </DataBind>
    </Control>
  </Controls>
</Filter>
```

---

## Best Practices

### ✅ DO

1. **Používejte LEFT JOIN** při propojování s dbo.Account, protože AccountID může být NULL:
   ```sql
   LEFT JOIN dbo.Account acc ON acc.ID = t.AssignedAccountID
   ```

2. **Pojmenujte aliasy srozumitelně** podle účelu:
   ```sql
   LEFT JOIN dbo.Account creator ON creator.ID = t.CreateAccountID
   LEFT JOIN dbo.Account modifier ON modifier.ID = t.ModifyAccountID
   LEFT JOIN dbo.Account assigned ON assigned.ID = t.AssignedAccountID
   ```

3. **Filtrujte aktivní uživatele** v dropdown/autocomplete:
   ```sql
   WHERE acc.IsActive = 1
   ```

4. **Používejte ConstantType="UserID"** pro získání ID aktuálního uživatele:
   ```xml
   <dsp:Parameter xsi:type="dsp:VariableParameter"
                  Ident="UserID"
                  DataType="Number"
                  ConstantType="UserID" />
   ```

### ❌ DON'T

1. ❌ **Nepoužívejte INNER JOIN** bez důvodu (může vyfiltrovat záznamy bez přiřazeného uživatele):
   ```sql
   -- ŠPATNĚ - ztratíte záznamy bez AccountID
   INNER JOIN dbo.Account acc ON acc.ID = t.AssignedAccountID
   ```

2. ❌ **Nekopírujte jména uživatelů do vlastních tabulek** - vždy používejte JOIN:
   ```sql
   -- ŠPATNĚ - duplikace dat
   ALTER TABLE usr.Task ADD AssignedUserName NVARCHAR(256)

   -- SPRÁVNĚ - použijte JOIN
   LEFT JOIN dbo.Account acc ON acc.ID = t.AssignedAccountID
   ```

3. ❌ **Nezapomeňte na filtraci neaktivních uživatelů** v DataBind pro výběr:
   ```sql
   -- ŠPATNĚ - zobrazí i neaktivní účty
   SELECT ID, FullName FROM dbo.Account

   -- SPRÁVNĚ
   SELECT ID, FullName FROM dbo.Account WHERE IsActive = 1
   ```

---

## Další systémové tabulky

Tento dokument bude průběžně rozšiřován o další standardní databázové konvence a systémové tabulky.

**Plánované sekce:**
- `dbo.Language` - Jazyky systému
- `dbo.Resource` - Překlady
- `dbo.Permission` / `AspNetRoles` - Oprávnění
- `dbo.SegmentType` - Segmenty
- `dbo.WorkFlowState` - Workflow stavy

---

## Viz také

- [permissions.md](permissions.md) - Správa oprávnění
- [datasource.md](datasource.md) - DataSource a Parameters
- [dataview.md](../entities/dataview.md) - DataView dokumentace
- [control-base.md](../controls/control-base.md) - Základní atributy kontrolů
