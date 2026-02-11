# Permissions Management Documentation

## Overview

SmartFormPlatform uses two types of permissions:

1. **Static Permissions** - Created via SQL and managed in admin UI
2. **Computed Permissions** - Dynamic permissions based on SQL queries (defined in Configuration.xml)

---

## Static Permissions

Static permissions (roles) are **NOT defined in XML**. They are created using SQL scripts and assigned to users through the admin interface.

### Permission Hierarchy

SmartFormPlatform supports two-level permission hierarchy:

1. **Level 1 (Segment Access)** - Controls access to entire segment
2. **Level 2 (Sub-Permissions)** - Additional permissions within the segment

---

## Creating Static Permissions

### 1. Create Main Segment Permission

```sql
DECLARE @Name nvarchar(256) = 'CMS' -- Permission name
DECLARE @ParentRoleName nvarchar(256) = null -- Parent permission (null for top-level)
DECLARE @Weight smallint = 4 -- Permission weight

DECLARE @Id nvarchar(450) = NEWID()
DECLARE @ParentID nvarchar(450) = null
DECLARE @RoleName nvarchar(256)
DECLARE @VisibleType tinyint = 3
SET @RoleName = 'Role'+@Name

-- Insert into AspNetRoles
INSERT INTO AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp)
VALUES(@Id, @RoleName, UPPER(@RoleName), NEWID())

-- Insert into Permission table
INSERT INTO dbo.Permission(ID, [Weight], ResourceKey)
VALUES (@Name, @Weight, 'Permission'+@Name)

-- Set parent if specified
IF @ParentRoleName is not null BEGIN
    SET @ParentID = (SELECT Id FROM AspNetRoles WHERE Name = @ParentRoleName)
END

-- Insert into Role table
INSERT INTO [Role](ASPNETRoleID, ParentASPNETRoleID, ResourceKey, PermissionID, VisibleType, DefaultValue)
VALUES (@Id, @ParentID, @RoleName, @Name, @VisibleType, 0)
GO
```

### 2. Assign Segment to Permission

After creating the permission, assign it to a segment:

```sql
INSERT INTO [dbo].[SegmentType](ID, ASPNETRoleID)
SELECT 'CMSSegment', Id FROM AspNetRoles WHERE Name = 'RoleCMS'
```

**Important:**
- `ID` = Segment Ident from Configuration.xml
- `ASPNETRoleID` = Role ID from AspNetRoles table

### 3. Create Sub-Permissions

Create additional permissions within the segment:

```sql
DECLARE @Name nvarchar(256) = 'CMSEditor' -- Sub-permission name
DECLARE @ParentRoleName nvarchar(256) = 'RoleCMS' -- Parent permission
DECLARE @Weight smallint = 4

DECLARE @Id nvarchar(450) = NEWID()
DECLARE @ParentID nvarchar(450) = null
DECLARE @RoleName nvarchar(256)
DECLARE @VisibleType tinyint = 3
SET @RoleName = 'Role'+@Name

INSERT INTO AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp)
VALUES(@Id, @RoleName, UPPER(@RoleName), NEWID())

INSERT INTO dbo.Permission(ID, [Weight], ResourceKey)
VALUES (@Name, @Weight, 'Permission'+@Name)

IF @ParentRoleName is not null BEGIN
    SET @ParentID = (SELECT Id FROM AspNetRoles WHERE Name = @ParentRoleName)
END

INSERT INTO [Role](ASPNETRoleID, ParentASPNETRoleID, ResourceKey, PermissionID, VisibleType, DefaultValue)
VALUES (@Id, @ParentID, @RoleName, @Name, @VisibleType, 0)
GO
```

---

## Database Tables

**⚠️ KRITICKÉ:** Používej POUZE tyto existující tabulky. AI často vymýšlí neexistující tabulky!

### ✅ Existující Tabulky (Používej TYTO)

| Tabulka | Účel |
|---------|------|
| `AspNetRoles` | ASP.NET Identity roles |
| `dbo.Permission` | Permission definitions (SINGULAR!) |
| `dbo.Role` | Role hierarchy and mappings (SINGULAR!) |
| `dbo.SegmentType` | Segment to role mappings |

### ❌ Neexistující Tabulky (NIKDY NEPOUŽÍVEJ)

| ❌ Neexistuje | Proč je chyba | ✅ Použij místo toho |
|--------------|---------------|---------------------|
| `dbo.ACL` | Tabulka neexistuje | `AspNetRoles` + `dbo.Permission` + `dbo.Role` |
| `dbo.Segment` | Tabulka neexistuje | `dbo.SegmentType` |
| `dbo.MenuSegment` | Tabulka neexistuje | `dbo.SegmentType` |
| `dbo.Permissions` | PLURAL - neexistuje | `dbo.Permission` (SINGULAR) |
| `dbo.Roles` | PLURAL - neexistuje | `dbo.Role` (SINGULAR) + `AspNetRoles` |

**Viz také:** [validation-workflow.md](../validation-workflow.md#step-14-permission-sql-validation) - Permission SQL Validation

---

### dbo.Permission

| Column | Type | Description |
|--------|------|-------------|
| `ID` | varchar(100) | Permission identifier |
| `Weight` | smallint | Permission weight (priority) |
| `ResourceKey` | varchar(100) | Translation key from dbo.ResourceKey |
| `IsComputed` | bit | Whether permission is computed (default: 0) |

```sql
CREATE TABLE [dbo].[Permission](
    [ID] [varchar](100) NOT NULL,
    [Weight] [smallint] NOT NULL,
    [ResourceKey] [varchar](100) NOT NULL,
    [IsComputed] [bit] NOT NULL DEFAULT ((0)),
    CONSTRAINT [PK_Permission] PRIMARY KEY CLUSTERED ([ID] ASC)
)
```

### dbo.SegmentType

Maps segments to permissions.

| Column | Type | Description |
|--------|------|-------------|
| `ID` | varchar(100) | Segment Ident (from Configuration.xml) |
| `ASPNETRoleID` | nvarchar(450) | Role ID from AspNetRoles |

```sql
CREATE TABLE [dbo].[SegmentType](
    [ID] [varchar](100) NOT NULL,
    [ASPNETRoleID] [nvarchar](450) NOT NULL,
    CONSTRAINT [PK_SegmentType] PRIMARY KEY CLUSTERED ([ID] ASC)
)
```

### AspNetRoles

ASP.NET Identity roles table.

### dbo.Role

Role hierarchy and metadata.

---

## Computed Permissions

Computed permissions are **defined in Configuration.xml** using `PermissionSection` with `ComputedPermission` elements.

### When to Use Computed Permissions

Use computed permissions when access depends on data relationships:

- User can edit only their own records
- Manager sees only their department's records
- Dynamic permissions based on database state

### Example: Author Permission

```xml
<Section xsi:type="PermissionSection">
  <Computes>
    <ComputedPermission Permission="MovieAuthorComputed">
      <DataSource>
        <SQL><![CDATA[
          SELECT
            m.ID AS TableID,
            m.CreatedBy AS AccountID
          FROM usr.Movie m
          WHERE m.[State] != 0
            #TABLE[m.ID]#
        ]]></SQL>
      </DataSource>
    </ComputedPermission>
  </Computes>
</Section>
```

**Required SQL Columns:**
- `TableID` - Record ID
- `AccountID` - User ID who has permission

---

## Permission Usage in XML

### Form Permissions

```xml
<Form Ident="Movie" SegmentType="MovieSegment">
  <!-- Who can view the form -->
  <AccessPermissions>
    <string>Admin</string>
    <string>MovieEditor</string>
    <string>MovieViewer</string>
  </AccessPermissions>

  <!-- Who can edit/create data -->
  <DataPermissions>
    <string>Admin</string>
    <string>MovieEditor</string>
  </DataPermissions>

  <!-- Who can create new records -->
  <CreatePermissions>
    <string>Admin</string>
    <string>MovieEditor</string>
  </CreatePermissions>
</Form>
```

### WorkFlow Permissions (Per State)

```xml
<Step State="10">
  <Groups>
    <Group>
      <Permissions>
        <string>Admin</string>
        <string>MovieEditor</string>
      </Permissions>
      <Buttons>...</Buttons>
      <Controls>...</Controls>
    </Group>
  </Groups>
</Step>
```

### DataView Permissions

```xml
<DataView Ident="MovieAllView" SegmentType="MovieSegment">
  <AccessPermissions>
    <string>Admin</string>
    <string>MovieEditor</string>
    <string>MovieViewer</string>
  </AccessPermissions>
</DataView>
```

---

## Permission Naming Convention

| Type | Format | Example |
|------|--------|---------|
| Main segment permission | `[SegmentName]` | `CMS` |
| Role name | `Role[PermissionName]` | `RoleCMS` |
| Sub-permission | `[SegmentName][Action]` | `CMSEditor` |
| Sub-permission role | `Role[PermissionName]` | `RoleCMSEditor` |
| Resource key | `Permission[PermissionName]` | `PermissionCMS` |
| Computed permission | `[Entity][Type]Computed` | `MovieAuthorComputed` |

---

## Complete Example: Movie Module Permissions

### 1. Create Movie Segment Permission

```sql
-- Main permission
DECLARE @Name nvarchar(256) = 'Movie'
DECLARE @Weight smallint = 10

DECLARE @Id nvarchar(450) = NEWID()
DECLARE @RoleName nvarchar(256) = 'RoleMovie'

INSERT INTO AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp)
VALUES(@Id, @RoleName, UPPER(@RoleName), NEWID())

INSERT INTO dbo.Permission(ID, [Weight], ResourceKey)
VALUES (@Name, @Weight, 'PermissionMovie')

INSERT INTO [Role](ASPNETRoleID, ParentASPNETRoleID, ResourceKey, PermissionID, VisibleType, DefaultValue)
VALUES (@Id, null, @RoleName, @Name, 3, 0)
GO

-- Assign segment
INSERT INTO [dbo].[SegmentType](ID, ASPNETRoleID)
SELECT 'MovieSegment', Id FROM AspNetRoles WHERE Name = 'RoleMovie'
```

### 2. Create Sub-Permissions

```sql
-- MovieEditor
DECLARE @Name nvarchar(256) = 'MovieEditor'
DECLARE @ParentRoleName nvarchar(256) = 'RoleMovie'
DECLARE @Weight smallint = 10

DECLARE @Id nvarchar(450) = NEWID()
DECLARE @ParentID nvarchar(450) = (SELECT Id FROM AspNetRoles WHERE Name = @ParentRoleName)
DECLARE @RoleName nvarchar(256) = 'RoleMovieEditor'

INSERT INTO AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp)
VALUES(@Id, @RoleName, UPPER(@RoleName), NEWID())

INSERT INTO dbo.Permission(ID, [Weight], ResourceKey)
VALUES (@Name, @Weight, 'PermissionMovieEditor')

INSERT INTO [Role](ASPNETRoleID, ParentASPNETRoleID, ResourceKey, PermissionID, VisibleType, DefaultValue)
VALUES (@Id, @ParentID, @RoleName, @Name, 3, 0)
GO

-- MovieViewer
DECLARE @Name nvarchar(256) = 'MovieViewer'
DECLARE @ParentRoleName nvarchar(256) = 'RoleMovie'
DECLARE @Weight smallint = 5

DECLARE @Id nvarchar(450) = NEWID()
DECLARE @ParentID nvarchar(450) = (SELECT Id FROM AspNetRoles WHERE Name = @ParentRoleName)
DECLARE @RoleName nvarchar(256) = 'RoleMovieViewer'

INSERT INTO AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp)
VALUES(@Id, @RoleName, UPPER(@RoleName), NEWID())

INSERT INTO dbo.Permission(ID, [Weight], ResourceKey)
VALUES (@Name, @Weight, 'PermissionMovieViewer')

INSERT INTO [Role](ASPNETRoleID, ParentASPNETRoleID, ResourceKey, PermissionID, VisibleType, DefaultValue)
VALUES (@Id, @ParentID, @RoleName, @Name, 3, 0)
GO
```

### 3. Add Translations

```sql
-- Resource keys for permissions
INSERT INTO dbo.ResourceKey (ID, CultureID, [Value])
VALUES
    ('PermissionMovie', 1, N'Movies'),
    ('PermissionMovie', 2, N'Filmy'),
    ('PermissionMovieEditor', 1, N'Movie Editor'),
    ('PermissionMovieEditor', 2, N'Editor filmů'),
    ('PermissionMovieViewer', 1, N'Movie Viewer'),
    ('PermissionMovieViewer', 2, N'Prohlížeč filmů')
```

---

## DO NOT - Common Mistakes

### WRONG: Defining Static Permissions in XML

```xml
<!-- ❌ WRONG: Do NOT define static permissions in Configuration.xml -->
<Section xsi:type="PermissionSection" Ident="PermissionSection">
  <Permissions>
    <Permission Ident="Admin" TitleResourceKey="Admin_Permission">
      <Items>
        <PermissionItem Type="Segment" Value="MovieSegment" />
        <PermissionItem Type="Form" Value="Movie" />
      </Items>
    </Permission>
  </Permissions>
</Section>
```

**Why Wrong:** Static permissions are managed via SQL and admin UI, NOT in XML.

### CORRECT: PermissionSection Only for Computed Permissions

```xml
<!-- ✅ CORRECT: PermissionSection ONLY for computed (SQL-based) permissions -->
<Section xsi:type="PermissionSection">
  <Computes>
    <ComputedPermission Permission="MovieAuthorComputed">
      <DataSource>
        <SQL>
          SELECT m.ID AS TableID, m.CreatedBy AS AccountID
          FROM usr.Movie m
          WHERE m.[State] != 0
            #TABLE[m.ID]#
        </SQL>
      </DataSource>
    </ComputedPermission>
  </Computes>
</Section>
```

---

## Summary

| Task | Method |
|------|--------|
| Create segment permission | SQL script + SegmentType table |
| Create sub-permissions | SQL script with parent role |
| Define computed permissions | Configuration.xml PermissionSection |
| Assign permissions to users | Admin UI |
| Use in Form/WorkFlow/DataView | Reference by name in `<Permissions>` |

**Key Principle:** Static permissions are data, not configuration. They belong in the database, not XML.
