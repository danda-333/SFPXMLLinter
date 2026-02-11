# Configuration Documentation

## Overview

Configuration je centrální XML definice pro systémovou konfiguraci celé aplikace SmartFormPlatform. Obsahuje nastavení segmentů (modulů), uživatelů, emailů, oprávnění, externího přihlášení a dalších systémových komponent.

## Root Element

```xml
<?xml version="1.0" encoding="utf-8"?>
<Configuration xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
               Ident="Configuration">
  <Sections>
    <!-- Configuration sections -->
  </Sections>
</Configuration>
```

---

## Configuration Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `Ident` | string | **Yes** | - | Unique identifier (typically "Configuration") |

---

## Configuration Sections Overview

| Section Type | Description |
|--------------|-------------|
| `SegmentSection` | Application modules/segments (menu structure) |
| `SettingSection` | General system settings (users, groups, global, alerts) |
| `PermissionSection` | Computed permissions configuration |
| `EmailSenderSection` | Email sending (SMTP) configuration |
| `EmailReciverSection` | Email receiving (IMAP/Exchange) configuration |
| `EmailSection` | General email settings |
| `AccountSyncSection` | LDAP/AD synchronization |
| `WebSection` | Web/CMS settings |
| `DLLSection` | External DLL/plugin registration |
| `APISection` | API configuration |
| `LoginPageSection` | Login page customization |
| `HeaderSection` | Page header customization |
| `PWASection` | Progressive Web App settings |
| `KioskSection` | Kiosk mode settings |
| `DataSyncSection` | Data synchronization |
| `ISDSSection` | Czech data box (ISDS) integration |
| `AutomaticOperationSection` | Automatic operations settings |
| `XMLDefinitionSection` | XML definition settings |
| `ComponentSection` | Component registration |
| `ExternalSettingSection` | External settings |
| `ImmediatelyRunAppSection` | Immediate app execution |
| `PySection` | Python integration |
| `SLAWatchdogSection` | SLA monitoring |
| `ShortLinkSection` | Short URL configuration |

---

## SegmentSection

Defines application modules (segments) displayed in the main navigation menu.

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Segments` | List&lt;Segment&gt; | List of segments/modules |
| `FolderGroups` | List&lt;FolderGroupSegment&gt; | Folder group definitions |
| `SegmentDataSource` | DataSource | Dynamic segment configuration |

### Segment Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `SegmentType` | string | - | Unique segment identifier |
| `Title` | string | "" | Display title |
| `TitleResourceKey` | string | "" | Title from translations |
| `IconCssClass` | string | - | Icon CSS class (e.g., "ph-gear") |
| `IconColor` | string | "" | Icon hex color |
| `Url` | string | "" | Navigation URL |
| `Priority` | int | 0 | Sort order (lower = higher) |
| `IsMenuVisible` | bool | true | Show in navigation menu |
| `IsOpenNewWindow` | bool | false | Open in new window |
| `ToolTip` | string | "" | Tooltip text |
| `ToolTipResourceKey` | string | "" | Tooltip from translations |
| `AriaLabel` | string | "" | Accessibility label |
| `AriaLabelResourceKey` | string | "" | Aria label from translations |

| Child Element | Type | Description |
|---------------|------|-------------|
| `DefaultMenus` | List&lt;MenuSegment&gt; | Default menu items |
| `Filter` | FilterSegment | Global filter for segment |

### HeaderSegment (extends Segment)

Groups segments under a header in the menu.

| Child Element | Type | Description |
|---------------|------|-------------|
| `SegmentTypes` | List&lt;string&gt; | Segment types to include under this header |

### MenuSegment

Defines menu items within a segment.

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | - | Menu item identifier |
| `Title` | string | "" | Display title |
| `TitleResourceKey` | string | "" | Title from translations |
| `Url` | string | "" | Navigation URL |
| `IconCssClass` | string | "" | Icon CSS class |
| `IconColor` | string | "" | Icon hex color |
| `Priority` | int | 0 | Sort order |
| `GroupTitle` | string | "" | Group header title |
| `GroupTitleResourceKey` | string | "" | Group title from translations |
| `CountColorCssClass` | string | "" | Badge color CSS class |
| `IsOpenNewWindow` | bool | false | Open in new window |
| `IsCount` | bool | false | Show count badge |

| Child Element | Type | Description |
|---------------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Required permissions |
| `DenyPermissions` | List&lt;string&gt; | Denied permissions |

### FolderGroupSegment

Defines folder groups for organizing forms.

| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | Folder group identifier |
| `MainFormIdent` | string | Main form identifier |
| `DefaultFormIdent` | string | Default form identifier |

| Child Element | Type | Description |
|---------------|------|-------------|
| `AccessPermissions` | List&lt;string&gt; | Required permissions |

### Example

```xml
<Section xsi:type="SegmentSection">
  <Segments>
    <!-- Header grouping -->
    <Segment xsi:type="HeaderSegment" TitleResourceKey="MainSection_General">
      <SegmentTypes>
        <string>Dashboard</string>
        <string>HR</string>
      </SegmentTypes>
    </Segment>

    <!-- Dashboard segment -->
    <Segment SegmentType="Dashboard"
             IconCssClass="ph-squares-four"
             TitleResourceKey="Dashboard_Title"
             Url="~/Dashboard"
             Priority="1" />

    <!-- HR segment with default menus -->
    <Segment SegmentType="HR"
             IconCssClass="ph-users"
             TitleResourceKey="HR_Title"
             Url="~/Segment/Index/HR"
             Priority="100">
      <DefaultMenus>
        <MenuSegment Ident="EmployeeMenu"
                     TitleResourceKey="Employees_Menu"
                     Url="~/DataView/Index/EmployeeAllView"
                     Priority="10"
                     GroupTitleResourceKey="People_Group">
          <AccessPermissions>
            <string>HRView</string>
          </AccessPermissions>
        </MenuSegment>
      </DefaultMenus>
    </Segment>

    <!-- Admin header -->
    <Segment xsi:type="HeaderSegment" TitleResourceKey="AdminSection_General">
      <SegmentTypes>
        <string>Admin</string>
      </SegmentTypes>
    </Segment>

    <!-- Admin segment -->
    <Segment SegmentType="Admin"
             IconCssClass="ph-gear"
             TitleResourceKey="Admin_Title"
             Url="~/Segment/Index/Admin"
             Priority="999" />
  </Segments>

  <FolderGroups>
    <FolderGroupSegment Ident="Common"
                        MainFormIdent="Company"
                        DefaultFormIdent="Category">
      <AccessPermissions>
        <string>SuperAdmin</string>
      </AccessPermissions>
    </FolderGroupSegment>
  </FolderGroups>
</Section>
```

---

## SettingSection

General system settings organized into subsections.

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `User` | User | User-related settings |
| `Group` | Group | Group-related settings |
| `Global` | Global | Global application settings |
| `SLA` | SLA | SLA settings |
| `File` | File | File handling settings |
| `Alert` | Alert | Notification/alert settings |
| `Messanger` | Messanger | Messenger settings |
| `ACL` | ACL | Access control settings |
| `HTTP` | HTTP | HTTP header settings |
| `Device` | Device | Device pairing settings |
| `ReceivedEmail` | ReceivedEmail | Received email settings |
| `ExternalSignIn` | ExternalSignIn | External authentication providers |
| `ShareSettings` | List&lt;Setting&gt; | Shared settings |

### User Settings

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `DefaultFolderGroupSegmentIdent` | string | "" | Default folder group |
| `IsDeputy` | bool | false | Enable deputy/delegation feature |
| `IsDefaultRedirect` | bool | true | Allow default redirect setting |
| `IsDefaultRequiredChangePassword` | bool | false | Require password change |
| `IsPublic` | bool | false | Allow public user flag |
| `IsProfileAvatar` | bool | true | Allow avatar editing |
| `IsTwoFactorAuth` | bool | false | Enable 2FA tab |
| `IsProfileTwoFactorAuth` | bool | false | Show 2FA in profile |
| `IsDefaultTwoFactorAuth` | bool | false | Default 2FA enabled |
| `TwoFactorAuthSendMethodType` | enum | Email | 2FA method (Email, Phone, TOTP) |
| `ThemeType` | enum | None | Available themes (None, Dark, White) |

| Child Element | Type | Description |
|---------------|------|-------------|
| `Actions` | List&lt;Action&gt; | Actions on user save |
| `RequiredPageDataSource` | DataSource | Mandatory page redirect |
| `SettingDataSource` | DataSource | User settings SQL |

### Global Settings

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `MainLogoPath` | string | "" | Logo path after login |
| `LoginLogoPath` | string | "" | Logo path on login page |
| `IsHidePasswordRecover` | bool | false | Hide password recovery |
| `IsHideLanguage` | bool | false | Hide language selector |
| `IsAutoRecognizeLanguage` | bool | false | Auto-detect language |
| `IsSignalREnabled` | bool | false | Enable SignalR |
| `GoogleAPIKey` | string | "" | Google Maps API key |
| `FullTextLanguage` | string | "" | Full-text search language |
| `IsShareOrder` | bool | false | Share ordering across views |
| `LogOffUrl` | string | "" | Redirect URL after logout |
| `IsMetaVersion` | bool | true | Show version in meta |
| `IsDataViewToolTipCTRL` | bool | false | Require CTRL for tooltips |
| `GlobalSearchIdent` | string | "GlobalSearch" | Global search identifier |
| `AppName` | string | - | Application name |
| `IsLogOffAzure` | bool | false | Logout from Azure |
| `IsReCaptchaPublicPage` | bool | false | Enable reCAPTCHA |
| `IsNotificationIgnoreRotatedDirection` | bool | false | Invert notification ignore list |

| Child Element | Type | Description |
|---------------|------|-------------|
| `ExternalCssRelativePaths` | List&lt;string&gt; | Global CSS files |
| `ExternalJavaScriptRelativePaths` | List&lt;string&gt; | Global JS files |
| `Favicons` | List&lt;Favicon&gt; | Favicon definitions |
| `Logos` | List&lt;Logo&gt; | Theme-specific logos |
| `RemoteConnectionStrings` | List&lt;RemoteConnectionString&gt; | Remote DB connections |
| `RTBEditor` | RTBEditor | Rich text editor settings |
| `Scheduler` | Scheduler | Scheduler settings |
| `PriorityDataViewSource` | DataSource | Menu priority SQL |

### Alert Settings

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsVisible` | bool | - | Enable alerts |
| `RefreshTime` | int | - | Refresh interval (ms) |
| `AlertType` | string | - | Alert types (JSNotification, PushNotification) |

### HTTP Settings

| Element | Type | Description |
|---------|------|-------------|
| `Header` | Header | HTTP header configuration |

#### Header Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsInlineScript` | bool | - | Allow inline scripts |
| `IFrameAccessDomain` | string | - | Allowed iframe domains |
| `IsGoogleMaps` | bool | - | Enable Google Maps |

### Example

```xml
<Section xsi:type="SettingSection">
  <User DefaultFolderGroupSegmentIdent="Common"
        IsDeputy="false"
        IsPublic="true"
        IsTwoFactorAuth="true"
        TwoFactorAuthSendMethodType="Email">
    <Actions>
      <Action xsi:type="ActionTrigger" Ident="SyncUser" ActionStart="AfterSave">
        <DataSource>
          <SQL>
            UPDATE usr.Employee SET Email = acc.Email
            FROM dbo.Account acc
            WHERE usr.Employee.AccountID = acc.ID
              AND acc.ID IN (SELECT ID FROM @ID)
          </SQL>
          <Parameters>
            <dsp:Parameter xsi:type="dsp:VariableParameter"
                           Ident="ID"
                           ConstantType="ID"
                           DataType="NumberList" />
          </Parameters>
        </DataSource>
      </Action>
    </Actions>
  </User>

  <Group />

  <Global LoginLogoPath="~/AppAsset/Images/Logo_login.png"
          IsAutoRecognizeLanguage="true"
          GoogleAPIKey="your-api-key"
          IsSignalREnabled="true">
    <ExternalCssRelativePaths>
      <string>~/AppAsset/Styles/global.css</string>
    </ExternalCssRelativePaths>
    <Logos>
      <Logo MainLogoPath="~/AppAsset/Images/Logo_dark.png" ThemeType="Dark" />
      <Logo MainLogoPath="~/AppAsset/Images/Logo_white.png" ThemeType="White" />
    </Logos>
    <RTBEditor StorageType="FileSystem" License="" />
  </Global>

  <SLA />

  <File IsOpenInApp="false" />

  <Alert IsVisible="true" RefreshTime="30000" AlertType="JSNotification PushNotification">
    <PushNotification IsRequireInteraction="true" />
  </Alert>

  <HTTP>
    <Header IsInlineScript="true"
            IFrameAccessDomain="https://www.google.com"
            IsGoogleMaps="true" />
  </HTTP>

  <ExternalSignIn>
    <Google ClientId="your-client-id" ClientSecret="your-secret" />
    <Microsoft TenantId="your-tenant" ClientId="your-client-id" ClientSecret="your-secret" />
  </ExternalSignIn>
</Section>
```

---

## PermissionSection

Defines **computed (dynamic) permissions** calculated from SQL queries.

**IMPORTANT:** PermissionSection is **ONLY** for computed permissions. Static permissions (roles like Admin, Editor) are created via SQL scripts and managed in admin UI. See [`common/permissions.md`](../common/permissions.md) for details.

### Static vs Computed Permissions

| Type | Definition Method | Usage |
|------|-------------------|-------|
| **Static** | SQL scripts + admin UI | Role-based access (Admin, Editor, Viewer) |
| **Computed** | Configuration.xml PermissionSection | Data-based access (assigned user, department manager) |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Computes` | List&lt;ComputedPermission&gt; | Computed permission definitions |

### ComputedPermission Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Permission` | string | - | Permission identifier |
| `IsProcessAccountSave` | bool | false | Recompute on account save |

| Child Element | Type | Description |
|---------------|------|-------------|
| `DataSource` | DataSource | SQL returning TableID and AccountID |
| `RefreshDataSources` | List&lt;DataSource&gt; | Tables that trigger refresh |

### SQL Requirements

The DataSource SQL must return:
- `TableID` - ID of the record
- `AccountID` - ID of the user who has permission

Use `#TABLE[alias.ID]#` placeholder for filtering specific records.

### Example

```xml
<Section xsi:type="PermissionSection">
  <Computes>
    <!-- Permission for assigned users -->
    <ComputedPermission Permission="TaskAssignedComputed">
      <DataSource>
        <SQL>
          SELECT
            t.ID AS TableID,
            t.AssignedUserID AS AccountID
          FROM usr.Task t
          WHERE t.[State] != @DeletedState
            #TABLE[t.ID]#
        </SQL>
        <Parameters>
          <dsp:Parameter xsi:type="dsp:ValueParameter"
                         Ident="DeletedState"
                         Value="0"
                         DataType="Number" />
        </Parameters>
      </DataSource>
    </ComputedPermission>

    <!-- Permission for department managers -->
    <ComputedPermission Permission="EmployeeDepartmentManagerComputed"
                        IsProcessAccountSave="true">
      <DataSource>
        <SQL>
          SELECT
            e.ID AS TableID,
            d.ManagerAccountID AS AccountID
          FROM usr.Employee e
          INNER JOIN usr.Department d ON e.DepartmentID = d.ID
          WHERE e.[State] != 0
            AND d.ManagerAccountID IS NOT NULL
            #TABLE[e.ID]#
        </SQL>
      </DataSource>
      <RefreshDataSources>
        <DataSource>
          <SQL>usr.Employee</SQL>
        </DataSource>
        <DataSource>
          <SQL>usr.Department</SQL>
        </DataSource>
      </RefreshDataSources>
    </ComputedPermission>
  </Computes>
</Section>
```

### DO NOT - Static Permission Definition

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

**Why Wrong:** The elements `<Permissions>`, `<Permission>`, and `<PermissionItem>` do NOT exist. Static permissions are managed via SQL and admin UI.

### CORRECT - Computed Permission Only

```xml
<!-- ✅ CORRECT: PermissionSection ONLY for computed permissions -->
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

**For static permissions:** See [`common/permissions.md`](../common/permissions.md) for SQL scripts and database management.

---

## EmailSenderSection

Email sending configuration.

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `EmailSender` | EmailSender | Email sender settings |

### EmailSender Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsDebug` | bool | false | Debug mode (restrict recipients) |

| Child Element | Type | Description |
|---------------|------|-------------|
| `AcceptEmails` | List&lt;string&gt; | Allowed emails in debug mode |

### Example

```xml
<Section xsi:type="EmailSenderSection">
  <EmailSender IsDebug="true">
    <AcceptEmails>
      <string>developer@company.com</string>
      <string>tester@company.com</string>
    </AcceptEmails>
  </EmailSender>
</Section>
```

---

## EmailReciverSection

Email receiving configuration (IMAP/Exchange).

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Proxy` | Proxy | Proxy settings |
| `Connections` | List&lt;EmailConnection&gt; | Email connections |
| `Rules` | List&lt;Rule&gt; | Processing rules |

### EmailConnection Types

- `IMAPEmailConnection` - IMAP server connection
- `ExchangeEmailConnection` - Exchange server connection

### Example

```xml
<Section xsi:type="EmailReciverSection">
  <Connections>
    <Connection xsi:type="IMAPEmailConnection"
                Host="imap.company.com"
                Port="993"
                Username="inbox@company.com"
                Password="encrypted-password"
                UseSSL="true" />
  </Connections>
  <Rules>
    <Rule Ident="ProcessIncoming" FormIdent="IncomingEmail">
      <!-- Rule configuration -->
    </Rule>
  </Rules>
</Section>
```

---

## AccountSyncSection

LDAP/Active Directory synchronization configuration.

### AccountSync Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `MainPath` | string | "" | Main LDAP path |
| `DeleteType` | DeleteTypes | - | Delete behavior (None, All, ADUser, AllUser, AllGroup, ADGroup) |
| `IsUserOnlyDeactive` | bool | false | Deactivate instead of delete users |
| `IsGroupOnlyDeactive` | bool | false | Deactivate instead of delete groups |
| `FirstImportType` | enum | ADToSFP | Import direction (ADToSFP, SFPToAD) |
| `IsSubGroupUserToParent` | bool | false | Add subgroup users to parent |
| `IsLoadSubGroup` | bool | false | Load subgroups |
| `IsUserNameWithoutDomain` | bool | false | Remove domain from username |

#### AD Field Mappings

| Attribute | Default | Description |
|-----------|---------|-------------|
| `ADUserNameIdent` | "userprincipalname" | Username field |
| `ADEmailIdent` | "mail" | Email field |
| `ADFirstNameIdent` | "givenname" | First name field |
| `ADLastNameIdent` | "sn" | Last name field |
| `ADDisplayNameIdent` | "displayname" | Display name field |
| `ADPhoneIdent` | "telephonenumber" | Phone field |
| `ADSIDIdent` | "objectsid" | SID field |
| `ADPathIdent` | "distinguishedName" | Path field |
| `ADPathManagerIdent` | "manager" | Manager path field |
| `ADUserAccountControlIdent` | "userAccountControl" | Account status field |
| `ADEmployeeNumberIdent` | "employeeNumber" | Employee number field |
| `ADGroupNameIdent` | "cn" | Group name field |
| `ADGroupSIDIdent` | "objectsid" | Group SID field |
| `ADGroupMemberIdent` | "member" | Group members field |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Users` | List&lt;UserAccountSync&gt; | User sync configurations |
| `Groups` | List&lt;GroupAccountSync&gt; | Group sync configurations |
| `Rules` | List&lt;Rule&gt; | Sync rules (FormRule, LDAPRule, UserExtensionRule, GroupExtensionRule) |
| `DefaultGroupAccount` | DataSource | Default group assignment |
| `RunApps` | List&lt;RunAppAccountSync&gt; | Applications to run after sync |
| `AcceptAccountDataSource` | DataSource | Account acceptance condition |
| `PairAccount` | PairAccount | Account pairing settings |
| `Settings` | List&lt;Setting&gt; | Additional settings (AzureSetting) |

### Example

```xml
<Section xsi:type="AccountSyncSection">
  <AccountSync MainPath="LDAP://dc.company.com/DC=company,DC=com"
               DeleteType="ADUser"
               IsUserOnlyDeactive="true"
               ADUserNameIdent="sAMAccountName"
               ADEmailIdent="mail">
    <Users>
      <UserAccountSync xmlns="http://www.gappex.com/sfp/Configuration/AccountSync"
                       Path="OU=Users,DC=company,DC=com"
                       Filter="(&amp;(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))" />
    </Users>
    <Groups>
      <GroupAccountSync xmlns="http://www.gappex.com/sfp/Configuration/AccountSync"
                        Path="OU=Groups,DC=company,DC=com"
                        Filter="(objectClass=group)" />
    </Groups>
    <DefaultGroupAccount>
      <SQL>SELECT ID FROM dbo.GroupAccount WHERE Name = 'DefaultGroup'</SQL>
    </DefaultGroupAccount>
  </AccountSync>
</Section>
```

---

## DLLSection

External DLL/plugin registration.

### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `AbsolutePath` | string | "" | Absolute path prefix |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DLLs` | List&lt;DLL&gt; | DLL definitions |

### DLL Element

| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | Unique identifier |
| `Path` | string | Path to DLL file |
| `ClassType` | string | Full class name (namespace.class) |

### Example

```xml
<Section xsi:type="DLLSection" AbsolutePath="C:\Plugins">
  <DLLs>
    <DLL Ident="CustomActions"
         Path="~/bin/CustomActions.dll"
         ClassType="CustomActions.ActionHandler" />
    <DLL Ident="ReportGenerator"
         Path="~/bin/ReportGenerator.dll"
         ClassType="ReportGenerator.Generator" />
  </DLLs>
</Section>
```

---

## APISection

API configuration.

### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsLogin` | bool | true | Allow API login |
| `IsLoginAs` | bool | false | Allow login-as feature |
| `LoginAsAcceptPermission` | string | "" | Permission required for login-as |

### Example

```xml
<Section xsi:type="APISection"
         IsLogin="true"
         IsLoginAs="true"
         LoginAsAcceptPermission="SuperAdmin" />
```

---

## LoginPageSection

Login page customization.

### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `UnderLoginButtonResourceKey` | string | "" | Text under login button |
| `IsRazorEngine` | bool | false | Enable Razor engine |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `BackgroupImageSource` | DataSource | SQL for background image |
| `Sources` | List&lt;DataSource&gt; | Data sources |
| `HTMLTemplate` | string | Custom HTML content |
| `Settings` | List&lt;Setting&gt; | Razor engine settings |
| `RoutingDataSource` | DataSource | Login routing logic |

### Example

```xml
<Section xsi:type="LoginPageSection" IsRazorEngine="false">
  <BackgroupImageSource>
    <SQL>
      SELECT TOP 1 f.ID AS FileID, f.AccountID, f.TableID
      FROM dbo.[File] f
      WHERE f.FormIdent = 'LoginPhoto'
        AND f.ControlIdent = 'Photo'
        AND f.[State] = 1
      ORDER BY NEWID()
    </SQL>
  </BackgroupImageSource>
  <HTMLTemplate>
    <script src="~/AppAsset/Scripts/loginPage.js"></script>
  </HTMLTemplate>
</Section>
```

---

## HeaderSection

Page header customization.

### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsRazorEngine` | bool | false | Enable Razor engine |

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Sources` | List&lt;DataSource&gt; | Data sources |
| `HTMLTemplate` | string | Header HTML content |
| `Settings` | List&lt;Setting&gt; | Razor engine settings |

### Example

```xml
<Section xsi:type="HeaderSection" IsRazorEngine="true">
  <Sources>
    <DataSource Ident="Notifications">
      <SQL>
        SELECT COUNT(*) AS UnreadCount
        FROM usr.Notification
        WHERE UserID = @UserID AND IsRead = 0
      </SQL>
      <Parameters>
        <dsp:Parameter xsi:type="dsp:VariableParameter"
                       Ident="UserID"
                       ConstantType="UserID"
                       DataType="Number" />
      </Parameters>
    </DataSource>
  </Sources>
  <HTMLTemplate>
    @{
      var data = Model.SingleObject(Model.Data.Notifications);
    }
    <div class="notification-badge">@data.UnreadCount</div>
  </HTMLTemplate>
</Section>
```

---

## WebSection

Web/CMS configuration.

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Web` | Web | Web settings |

### Web Element

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `DefaultMenuFolderGroupSegmentIdent` | string | "" | Default menu folder group |
| `DefaultMenuFormIdent` | string | "" | Default menu form |

| Child Element | Type | Description |
|---------------|------|-------------|
| `HomePageSource` | DataSource | Homepage SQL |
| `MenuSource` | DataSource | Menu items SQL |
| `DocumentSource` | DataSource | Document SQL |
| `SitemapSource` | DataSource | Sitemap SQL |

---

## PWASection

Progressive Web App configuration.

### Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `IsEnabled` | bool | false | Enable PWA |
| `ManifestPath` | string | - | Path to manifest.json |

### Example

```xml
<Section xsi:type="PWASection"
         IsEnabled="true"
         ManifestPath="~/manifest.json" />
```

---

## ComponentSection

Component registration and overrides.

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `Components` | List&lt;Component&gt; | Component registrations |

### Component Element

| Attribute | Type | Description |
|-----------|------|-------------|
| `Ident` | string | Registration identifier |
| `ComponentIdent` | string | Component definition identifier |
| `MergeType` | enum | Merge behavior (Replace, Merge) |

### Example

```xml
<Section xsi:type="ComponentSection">
  <Components>
    <Component MergeType="Replace"
               Ident="GuideComponentGlobal"
               ComponentIdent="GuideComponent" />
  </Components>
</Section>
```

---

## AutomaticOperationSection

Automatic operations control.

### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `DataSource` | DataSource | Control DataSource |

---

## Complete Configuration Example

```xml
<?xml version="1.0" encoding="utf-8"?>
<Configuration xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters"
               Ident="Configuration">
  <Sections>
    <!-- Segments -->
    <Section xsi:type="SegmentSection">
      <Segments>
        <Segment xsi:type="HeaderSegment" TitleResourceKey="MainSection">
          <SegmentTypes>
            <string>Dashboard</string>
            <string>HR</string>
          </SegmentTypes>
        </Segment>
        <Segment SegmentType="Dashboard"
                 IconCssClass="ph-squares-four"
                 TitleResourceKey="Dashboard_Title"
                 Url="~/Dashboard"
                 Priority="1" />
        <Segment SegmentType="HR"
                 IconCssClass="ph-users"
                 TitleResourceKey="HR_Title"
                 Url="~/Segment/Index/HR"
                 Priority="100" />
        <Segment xsi:type="HeaderSegment" TitleResourceKey="AdminSection">
          <SegmentTypes>
            <string>Admin</string>
          </SegmentTypes>
        </Segment>
        <Segment SegmentType="Admin"
                 IconCssClass="ph-gear"
                 TitleResourceKey="Admin_Title"
                 Url="~/Segment/Index/Admin"
                 Priority="999" />
      </Segments>
    </Section>

    <!-- Settings -->
    <Section xsi:type="SettingSection">
      <User DefaultFolderGroupSegmentIdent="Common" IsDeputy="false" IsPublic="true" />
      <Group />
      <Global LoginLogoPath="~/AppAsset/Images/Logo.png"
              IsAutoRecognizeLanguage="true">
        <ExternalCssRelativePaths>
          <string>~/AppAsset/Styles/global.css</string>
        </ExternalCssRelativePaths>
      </Global>
      <Alert IsVisible="true" RefreshTime="30000" AlertType="JSNotification" />
    </Section>

    <!-- Permissions -->
    <Section xsi:type="PermissionSection">
      <Computes>
        <ComputedPermission Permission="EmployeeManagerComputed">
          <DataSource>
            <SQL>
              SELECT e.ID AS TableID, e.ManagerAccountID AS AccountID
              FROM usr.Employee e
              WHERE e.[State] != 0 AND e.ManagerAccountID IS NOT NULL
                #TABLE[e.ID]#
            </SQL>
          </DataSource>
        </ComputedPermission>
      </Computes>
    </Section>

    <!-- DLL -->
    <Section xsi:type="DLLSection">
      <DLLs>
        <DLL Ident="CustomActions"
             Path="~/bin/CustomActions.dll"
             ClassType="CustomActions.Handler" />
      </DLLs>
    </Section>

    <!-- API -->
    <Section xsi:type="APISection" IsLogin="true" />

    <!-- PWA -->
    <Section xsi:type="PWASection" IsEnabled="false" />
  </Sections>
</Configuration>
```

---

## Configuration Section Hierarchy

```
Configuration
└── Sections
    ├── SegmentSection
    │   ├── Segments
    │   │   ├── Segment
    │   │   │   ├── DefaultMenus (MenuSegment[])
    │   │   │   └── Filter (FilterSegment)
    │   │   └── HeaderSegment
    │   │       └── SegmentTypes (string[])
    │   ├── FolderGroups (FolderGroupSegment[])
    │   └── SegmentDataSource
    ├── SettingSection
    │   ├── User (Actions, RequiredPageDataSource)
    │   ├── Group
    │   ├── Global (Logos, Favicons, RTBEditor, etc.)
    │   ├── SLA
    │   ├── File
    │   ├── Alert
    │   ├── HTTP (Header)
    │   ├── ExternalSignIn (Google, Microsoft)
    │   └── ShareSettings
    ├── PermissionSection
    │   └── Computes (ComputedPermission[])
    ├── EmailSenderSection
    │   └── EmailSender (AcceptEmails)
    ├── EmailReciverSection
    │   ├── Proxy
    │   ├── Connections
    │   └── Rules
    ├── AccountSyncSection
    │   └── AccountSync (Users, Groups, Rules)
    ├── DLLSection
    │   └── DLLs (DLL[])
    ├── APISection
    ├── LoginPageSection
    ├── HeaderSection
    ├── WebSection
    │   └── Web (HomePageSource, MenuSource)
    ├── PWASection
    ├── ComponentSection
    │   └── Components
    └── ... (other sections)
```
