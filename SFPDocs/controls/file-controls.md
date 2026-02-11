# File Controls

## FileControl

File upload control. Files are stored in `dbo.File` table.

**Inherits from:** Control (not FormControl - no DB column)

### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsSingleFile` | bool | false | Allow only one file |
| `IsShowDeleteButton` | bool | false | Show delete button for files |
| `IsShowEditButton` | bool | false | Show edit button for file metadata |
| `IsFileEdit` | bool | false | Allow editing file content |
| `IsEnableSelect` | bool | false | Enable file selection |
| `RenderType` | enum | Basic | Upload mode (Basic, FormExtension, FormExtensionPermission) |
| `DownloadAllType` | flags | None | Download all options (None, PerFile, ZIP) |
| `ShowDownloadAllType` | flags | None | Show download all button |
| `DeleteType` | enum | All | Who can delete (All, Creator, Admin) |
| `EditType` | enum | All | Who can edit metadata |
| `FileEditType` | enum | All | Who can edit file content |
| `ModeType` | enum | Normal | Save mode (Normal, Session, DeleteUntilClose) |
| `FormExtensionIdent` | string | "" | Form extension for file metadata |
| `IsRequired` | bool | false | At least one file required |
| `IsShowRequired` | string | "" | Show required asterisk |
| `IsVersion` | bool | false | Enable file versioning |
| `IsShowFileList` | bool | true | Show list of uploaded files |
| `IsWebDav` | bool | false | Enable WebDAV access |
| `SettingType` | enum | Basic | Permission type (Basic, PerItem) |
| `IsFileTimestamp` | bool | false | Verify file timestamp |

### RenderTypes Enum

| Value | Description |
|-------|-------------|
| `Basic` | Simple auto-upload without form |
| `FormExtension` | Upload with dialog and additional info |
| `FormExtensionPermission` | Upload with permissions management |

### DownloadAllTypes Flags

| Value | Description |
|-------|-------------|
| `None` | No download all button |
| `PerFile` | Download files individually |
| `ZIP` | Download as ZIP archive |

### ModeTypes Enum

| Value | Description |
|-------|-------------|
| `Normal` | Standard behavior via WorkFlow |
| `Session` | Store in session until form save |
| `DeleteUntilClose` | Allow delete until form is closed |

### ChangeTypes Enum

| Value | Description |
|-------|-------------|
| `All` | Everyone can perform action |
| `Creator` | Only file creator |
| `Admin` | Only administrators |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Settings` | List&lt;Setting&gt; | Settings (PlacementPermission, Resize, Watermark, AcceptFile) |
| `SettingPermissions` | List&lt;SettingPermissionCommon&gt; | Permission settings |
| `OtherSource` | DataSource | Additional files source |
| `Rename` | DataSource | SQL for file rename |
| `Buttons` | List&lt;Button&gt; | Custom action buttons |
| `FileSettingDataSource` | DataSource | File permission settings |
| `SortDataSource` | DataSource | File sorting query |

### Examples

**Basic file upload:**
```xml
<Control xsi:type="FileControl"
         Ident="Attachment"
         TitleResourceKey="Attachment_Form"
         IsSingleFile="false"
         IsShowDeleteButton="true" />
```

**Single file with delete:**
```xml
<Control xsi:type="FileControl"
         Ident="Document"
         TitleResourceKey="Document_Form"
         IsSingleFile="true"
         IsShowDeleteButton="true"
         IsRequired="true" />
```

**With file extension form:**
```xml
<Control xsi:type="FileControl"
         Ident="Files"
         TitleResourceKey="Files_Form"
         RenderType="FormExtension"
         FormExtensionIdent="FileExtension"
         IsShowDeleteButton="true"
         IsShowEditButton="true" />
```

**With versioning and ZIP download:**
```xml
<Control xsi:type="FileControl"
         Ident="Documents"
         TitleResourceKey="Documents_Form"
         IsVersion="true"
         DownloadAllType="ZIP"
         ShowDownloadAllType="ZIP"
         IsShowDeleteButton="true" />
```

**Session mode (save with form):**
```xml
<Control xsi:type="FileControl"
         Ident="UploadedFiles"
         TitleResourceKey="Files_Form"
         ModeType="Session"
         IsSingleFile="false" />
```

---

## FileGalleryControl

Image gallery with thumbnails.

**Inherits from:** FileControl

### Examples

```xml
<Control xsi:type="FileGalleryControl"
         Ident="Photos"
         TitleResourceKey="Photos_Form"
         IsShowDeleteButton="true" />
```

---

## FileManagerControl

Advanced file manager with folders.

**Inherits from:** FileControl

### Examples

```xml
<Control xsi:type="FileManagerControl"
         Ident="FileManager"
         TitleResourceKey="Files_Form" />
```

---

## FillByFileControl

Fill form fields from uploaded file (e.g., CSV, Excel).

**Inherits from:** Control

### Examples

```xml
<Control xsi:type="FillByFileControl"
         Ident="ImportFile"
         TitleResourceKey="ImportFile_Form">
  <!-- Configuration for mapping file columns to form fields -->
</Control>
```
