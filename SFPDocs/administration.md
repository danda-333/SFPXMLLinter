# SFP Administration & XML Management

**Version:** 1.0
**Last Updated:** 2026-01-27
**Source:** Příručka pro konfiguraci SFP.pdf

---

## CRITICAL: How to Upload XML Files

**IMPORTANT:** SmartFormPlatform is a **Low-Code Platform** with web-based administration.
XML files are **NEVER** copied directly to server folders.

### ❌ WRONG - Do NOT Do This

```
# WRONG - Never instruct users to do this:
"Copy XML files to ~/AppAsset/Plugins/XML/"
"Upload files to the server folder"
"Place files in the deployment directory"
```

### ✅ CORRECT - Upload via Admin Interface

All XML configurations are managed through the **web-based admin interface**.

---

## XML Upload Workflow

### 1. Download Existing Configuration

1. Navigate to **Admin → XML → Konfigurace** (Configuration)
2. Find the record with `Ident = "Configuration"` (or your target entity)
3. Click on the record → **file downloads automatically**

### 2. Edit Locally

1. Open the downloaded XML file in your editor (VS Code, etc.)
2. Make your changes following [xml-conventions.md](xml-conventions.md)
3. Save the file

### 3. Upload Modified Configuration

1. Navigate to **Admin → XML → Konfigurace**
2. Click **"Nahrát soubor"** (Upload file) button
3. Click **"Nahrát XML"** field and select your modified file
   (or drag & drop the file)
4. Click **"Uložit"** (Save) button
5. Click the blue text **"Pro aplikování změn vyčistěte cache"** (Clear cache to apply changes)

### 4. Verify Changes

1. Navigate to the relevant section in the application
2. Verify your changes are applied
3. If not visible, clear browser cache or re-login

---

## XML Entity Types & Upload Locations

| Entity Type | Upload Section | Ident Pattern |
|-------------|----------------|---------------|
| Configuration | Admin → XML → Konfigurace | `Configuration` |
| Form | Admin → XML → Formuláře | `FormIdent` |
| WorkFlow | Admin → XML → WorkFlow | `FormIdent` |
| DataView | Admin → XML → DataView | `DataViewIdent` |
| Filter | Admin → XML → Filtry | `FilterIdent` |
| Dashboard | Admin → XML → Nástěnka | `DashboardIdent` |
| Component | Admin → XML → Komponenty | `ComponentIdent` |

---

## Translation (Překlady) Management

Translations are managed through the admin interface, **not in XML files**.

### Upload Workflow

1. **Admin → Obecné → Překlady** (or **Admin → Systémové nástroje → Překlady**)
2. Search for existing translation key or create new
3. Edit the **"Hodnota"** (Value) field with user-facing text
4. Save

### Creating Translation Keys

Translation keys are defined in XML:

```xml
<Control xsi:type="TextBoxControl"
         Ident="Name"
         LabelResourceKey="ToyEvidence_Toy_Name" />
```

Then create the translation in admin interface:

- **Klíč** (Key): `ToyEvidence_Toy_Name`
- **Hodnota** (Value): `"Název hračky"` (Czech), `"Toy Name"` (English)

---

## Permission Management

Permissions are managed through **Admin → Správa oprávnění** (Permission Management).

### Creating Permissions

#### 1. Create Permission in Database

1. Navigate to **Admin → Systémové nástroje → Oprávnění**
2. Click **"Přidat"** (Add) button
3. Enter **"Nový identifikátor"** (New identifier): e.g., `RoleToyEvidence`
4. Click **"Vytvořit"** (Create)

#### 2. Use Permission in XML

```xml
<Segment SegmentType="ToyEvidence"
         RoleName="RoleToyEvidence" />
```

#### 3. Assign to Users/Groups

1. Navigate to **Admin → Správa oprávnění → Uživatelé** (Users)
2. Select user
3. Add permission `RoleToyEvidence` in **"Oprávnění na segment"** section
4. Save

### Permission Groups

Groups allow bulk permission assignment:

1. **Admin → Správa oprávnění → Skupiny** (Groups)
2. Create group (e.g., `Zaměstnanci`)
3. Add users to group
4. Assign permissions to group
5. All group members inherit permissions

---

## Segment Management

Segments (modules) require both database and XML configuration.

### 1. Create in Database

1. Navigate to **Admin → Systémové nástroje → Segmenty**
2. Click **"Přidat"** (Add)
3. Enter **"Nový identifikátor"**: e.g., `ToyEvidence`
4. Select **"ASPNETRoleID"**: permission created earlier
5. Click **"Vytvořit"** (Create)

### 2. Configure in XML

1. Download `Configuration.xml` (Admin → XML → Konfigurace)
2. Add segment definition:

```xml
<Segment SegmentType="ToyEvidence"
         IconCssClass="icon-chopper"
         TitleResourceKey="ToyEvidence_ToyEvidence"
         Url="~/Segment/Index/ToyEvidence"
         RoleName="RoleToyEvidence" />
```

3. Upload modified `Configuration.xml`
4. Clear cache

### 3. Verify in Navigation

- Segment appears in navigation menu
- Only users with `RoleToyEvidence` permission can see it

---

## Common Admin Sections

### Admin → XML
- **Konfigurace** - Configuration.xml
- **Formuláře** - Form definitions
- **WorkFlow** - Workflow definitions
- **DataView** - Data view definitions
- **Filtry** - Filter definitions
- **Nástěnka** - Dashboard definitions
- **Komponenty** - Component definitions

### Admin → Obecné
- **Překlady** - Translation management

### Admin → Správa oprávnění
- **Skupiny** - User groups
- **Uživatelé** - User management

### Admin → Systémové nástroje
- **Oprávnění** - Permission creation
- **Segmenty** - Segment creation
- **Překlady** - Translation management (alternative path)

---

## Best Practices for Documentation

When creating plugin/component documentation for users:

### ✅ DO Write This

```markdown
## Installation

1. **Upload XML Files:**
   - Navigate to Admin → XML → Komponenty
   - Click "Nahrát soubor" and upload `Component.xml`
   - Clear cache after upload

2. **Create Permissions:**
   - Navigate to Admin → Systémové nástroje → Oprávnění
   - Create permission `RoleComponentName`

3. **Assign Permissions:**
   - Navigate to Admin → Správa oprávnění → Uživatelé
   - Add `RoleComponentName` to required users
```

### ❌ DON'T Write This

```markdown
## Installation

1. Copy XML files to `~/AppAsset/Plugins/XML/`
2. Restart the application
3. Run SQL scripts manually
```

---

## Why Web-Based Upload?

SFP is a **Low-Code Platform** designed for:

- Non-developers to configure applications
- Version control through admin interface
- Change tracking and audit logs
- Validation before applying changes
- No direct server access required
- Multi-tenant environments

Direct file system access would bypass these benefits.

---

## See Also

- [xml-conventions.md](xml-conventions.md) - XML formatting rules
- [entities/configuration.md](entities/configuration.md) - Configuration.xml structure
- [plugin-development.md](plugin-development.md) - Plugin development guide
