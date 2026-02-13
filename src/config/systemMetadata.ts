import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export interface SystemMetadata {
  systemTables: Set<string>;
  defaultFormColumns: Set<string>;
  preferredForeignKeySuffixes: string[];
  systemTableAllowedForeignKeys: Set<string>;
  externalTableColumns: Map<string, Set<string>>;
}

const SYSTEM_TABLES = [
  "FileToken",
  "Language",
  "SLAWorkFlowState",
  "File",
  "SLAFolderTree",
  "Alert",
  "AccountFilter",
  "SLACriteria",
  "GroupFolderTree",
  "Email",
  "Account",
  "Directory",
  "GroupFolderTreePermission",
  "DirectoryFile",
  "EmailFile",
  "AccountPermissionStaticComputed",
  "AccountFolderTree",
  "ResourceBuilder",
  "__EFMigrationsHistory",
  "PushNotification",
  "AccountFolderTreePermission",
  "AspNetRoles",
  "AspNetUsers",
  "AspNetRoleClaims",
  "SyncMigration",
  "AspNetUserClaims",
  "CommunicationOtherEmail",
  "GoogleToken",
  "AccountComputedPermissionComputed",
  "AspNetUserLogins",
  "ShareFile",
  "ReceivedEmail",
  "AppStatus",
  "AspNetUserRoles",
  "ShareFileFile",
  "AccountHierarchy",
  "AspNetUserTokens",
  "FormReceivedEmail",
  "MultiSelect",
  "SMS",
  "AccountClaim",
  "FormFolderTree",
  "Permission",
  "SLANotification",
  "SMSAttribute",
  "Role",
  "NotificationSettingGroup",
  "FileMark",
  "__DBUpMigrationsHistory",
  "NotificationSettingIdent",
  "Favorite",
  "FilePermission",
  "GroupNotificationSetting",
  "AuditLog",
  "SLANotificationWorkFlowState",
  "Folder",
  "AccountNotificationSetting",
  "CommunicationFile",
  "ResultList",
  "XMLDefinition",
  "EventLog",
  "SystemDataRefresh",
  "CourseState",
  "EmailAttribute",
  "AccountColumnSetting",
  "AccountExportColumnSetting",
  "SegmentType",
  "SLAProcess",
  "ResultListData",
  "FileTimestamp",
  "Connect",
  "AlertSetting",
  "Device",
  "Note",
  "FileWebDav",
  "Report",
  "FolderTree",
  "History",
  "SLANotificationSend",
  "ToDoList",
  "ReportColumn",
  "CommunicationType",
  "ReportFilter",
  "Icon",
  "HistoryData",
  "CommunicationPriority",
  "Communication",
  "Time",
  "CommunicationPermission",
  "Group",
  "HistoryType",
  "SLA",
  "CultureInfoType",
  "GroupAccount",
  "TaskScheduler",
  "SLADay",
  "GroupRole",
  "Resource"
];
const DEFAULT_FORM_COLUMNS = ["ID", "AccountID", "CreateDate", "LastUpdate", "LastUpdateAccountID", "State"];
const DEFAULT_PREFERRED_SUFFIXES = ["ID", "Ident", "Guid"];
const DEFAULT_SYSTEM_TABLE_ALLOWED_FKS = ["ID", "Ident"];

const STATIC_METADATA: SystemMetadata = {
  systemTables: new Set(SYSTEM_TABLES),
  defaultFormColumns: new Set(DEFAULT_FORM_COLUMNS),
  preferredForeignKeySuffixes: DEFAULT_PREFERRED_SUFFIXES,
  systemTableAllowedForeignKeys: new Set(DEFAULT_SYSTEM_TABLE_ALLOWED_FKS),
  externalTableColumns: new Map<string, Set<string>>()
};

let cachedWorkspaceStamp = "";
let cachedWorkspaceMetadata: SystemMetadata | undefined;

export function getSystemMetadata(): SystemMetadata {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return STATIC_METADATA;
  }

  const sources = collectSettingsSources(folders.map((f) => f.uri.fsPath));
  const stamp = sources
    .map((s) => `${s.filePath}|${s.stat.mtimeMs}|${s.stat.size}`)
    .sort((a, b) => a.localeCompare(b))
    .join(";");
  if (stamp === cachedWorkspaceStamp && cachedWorkspaceMetadata) {
    return cachedWorkspaceMetadata;
  }

  const mergedSystemTables = new Set<string>(STATIC_METADATA.systemTables);
  const externalTableColumns = new Map<string, Set<string>>();
  for (const source of sources) {
    const parsed = parseExternalTablesFile(source.filePath);
    for (const [table, columns] of parsed.entries()) {
      mergedSystemTables.add(table);
      if (!externalTableColumns.has(table)) {
        externalTableColumns.set(table, new Set<string>());
      }
      const target = externalTableColumns.get(table);
      if (!target) {
        continue;
      }
      for (const column of columns) {
        target.add(column);
      }
    }
  }

  cachedWorkspaceStamp = stamp;
  cachedWorkspaceMetadata = {
    systemTables: mergedSystemTables,
    defaultFormColumns: STATIC_METADATA.defaultFormColumns,
    preferredForeignKeySuffixes: STATIC_METADATA.preferredForeignKeySuffixes,
    systemTableAllowedForeignKeys: STATIC_METADATA.systemTableAllowedForeignKeys,
    externalTableColumns
  };

  return cachedWorkspaceMetadata;
}

export function isKnownSystemTableForeignKey(metadata: SystemMetadata, tableName: string, foreignKey: string): boolean {
  if (metadata.defaultFormColumns.has(foreignKey)) {
    return true;
  }

  if (metadata.systemTableAllowedForeignKeys.has(foreignKey)) {
    return true;
  }

  const tableColumns = metadata.externalTableColumns.get(tableName);
  if (!tableColumns) {
    return false;
  }

  return tableColumns.has(foreignKey);
}

function collectSettingsSources(workspacePaths: readonly string[]): Array<{ filePath: string; stat: fs.Stats }> {
  const out: Array<{ filePath: string; stat: fs.Stats }> = [];
  const visited = new Set<string>();
  for (const root of workspacePaths) {
    const normalizedRoot = path.resolve(root);
    for (const fileName of [".sfpxmlsetting", ".sfpxmlsettings"]) {
      const fullPath = path.join(normalizedRoot, fileName);
      if (!fs.existsSync(fullPath)) {
        continue;
      }
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
          continue;
        }
        const key = fullPath.toLowerCase();
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        out.push({ filePath: fullPath, stat });
      } catch {
        // Ignore inaccessible setting file.
      }
    }

    const stack = [normalizedRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          const nameLower = entry.name.toLowerCase();
          if (
            nameLower === ".git" ||
            nameLower === ".vscode" ||
            nameLower === "node_modules" ||
            nameLower === "out" ||
            nameLower === "dist"
          ) {
            continue;
          }
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const nameLower = entry.name.toLowerCase();
        if (nameLower !== ".sfpxmlsetting" && nameLower !== ".sfpxmlsettings") {
          continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) {
            continue;
          }
          const key = fullPath.toLowerCase();
          if (visited.has(key)) {
            continue;
          }
          visited.add(key);
          out.push({ filePath: fullPath, stat });
        } catch {
          // Ignore inaccessible setting file.
        }
      }
    }
  }

  return out;
}

function parseExternalTablesFile(filePath: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return out;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return out;
  }

  if (!json || typeof json !== "object") {
    return out;
  }

  const root = json as Record<string, unknown>;
  const externalTablesNode = root.externalTables ?? root.tables;
  if (Array.isArray(externalTablesNode)) {
    for (const item of externalTablesNode) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const rawName = typeof row.name === "string" ? row.name : undefined;
      const tableName = normalizeExternalTableName(rawName);
      if (!tableName) {
        continue;
      }
      const columns = parseColumnsNode(row.columns);
      addTableEntry(out, tableName, columns);
    }
    return out;
  }

  if (!externalTablesNode || typeof externalTablesNode !== "object") {
    return out;
  }

  for (const [name, value] of Object.entries(externalTablesNode as Record<string, unknown>)) {
    const tableName = normalizeExternalTableName(name);
    if (!tableName) {
      continue;
    }

    if (Array.isArray(value)) {
      addTableEntry(out, tableName, parseColumnsNode(value));
      continue;
    }

    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      addTableEntry(out, tableName, parseColumnsNode(row.columns));
      continue;
    }

    addTableEntry(out, tableName, []);
  }

  return out;
}

function addTableEntry(target: Map<string, Set<string>>, tableName: string, columns: readonly string[]): void {
  if (!target.has(tableName)) {
    target.set(tableName, new Set<string>());
  }

  const set = target.get(tableName);
  if (!set) {
    return;
  }

  for (const column of columns) {
    set.add(column);
  }
}

function parseColumnsNode(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: string[] = [];
  for (const col of value) {
    if (typeof col !== "string") {
      continue;
    }
    const trimmed = col.trim();
    if (!trimmed) {
      continue;
    }
    out.push(trimmed);
  }

  return out;
}

function normalizeExternalTableName(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.toLowerCase().startsWith("dbo.")) {
    const raw = trimmed.slice(4).trim();
    return raw || undefined;
  }

  return trimmed;
}
