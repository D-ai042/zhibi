/**
 * 备份机制 —— 为项目数据创建 localStorage 快照，防止数据损坏不可恢复。
 *
 * createBackup() 在定稿时自动调用，保留最近 MAX_BACKUPS 个备份。
 * 用户也可手动触发备份。
 */

const BACKUP_PREFIX = "novel-backup-";
const MAX_BACKUPS = 5;

/** 收集项目相关的所有 localStorage key
 *
 * 注意：EXE（Tauri）模式下依赖 prewarmFromSqlite 在启动时将 SQLite 数据同步到 localStorage。
 * 若 prewarm 未完成，本函数可能遗漏 SQLite 独有的 key。启动时自动执行 prewarm，正常情况不受影响。
 */
export function getAllProjectKeys(projectId: string): string[] {
  const keys: string[] = [];
  const prefixes = [
    `novel-workbench-`, `plot-segments-`,
    `plot-edges-`, `worldview-edges-`, `worldview-groups-`,
    `chapter-index-`, `chapter-${projectId}-`,
    `draft-${projectId}-`, `novel-snapshots-`,
    `snapshot-index-`, `snapshot-${projectId}-`,
    `char-groups-`, `ai-pending-chars-`, `ai-pending-world-terms-`,
    `inspiration-cards-`, `material-`, `chapter-hash-`,
  ];
  // 全局 key（不含 projectId，但包含所有项目数据）
  const globalExactKeys = [
    "novel-workbench-mock",
  ];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (globalExactKeys.includes(key)) {
      keys.push(key);
      continue;
    }
    if (prefixes.some(p => key === p || key.startsWith(p)) && key.includes(projectId)) {
      keys.push(key);
    }
  }
  return [...new Set(keys)];
}

/** 清理旧备份，只保留 MAX_BACKUPS 个 */
function cleanOldBackups(projectId: string): void {
  const backupPrefix = `${BACKUP_PREFIX}${projectId}-`;
  const backupKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(backupPrefix)) backupKeys.push(key);
  }
  backupKeys.sort();
  while (backupKeys.length > MAX_BACKUPS) {
    const old = backupKeys.shift();
    if (old) localStorage.removeItem(old);
  }
}

/** 创建当前项目数据的完整备份 */
export function createBackup(projectId: string): void {
  const keys = getAllProjectKeys(projectId);
  const snapshot: Record<string, string> = {};
  for (const key of keys) {
    try {
      const val = localStorage.getItem(key);
      if (val !== null) snapshot[key] = val;
    } catch { /* skip unreadable keys */ }
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupKey = `${BACKUP_PREFIX}${projectId}-${timestamp}`;
  try {
    localStorage.setItem(backupKey, JSON.stringify(snapshot));
  } catch {
    console.warn("[backup] 创建备份失败（存储空间不足）");
    return;
  }
  cleanOldBackups(projectId);
}

/** 列出所有可用备份 */
export function listBackups(projectId: string): { key: string; timestamp: string; size: number }[] {
  const prefix = `${BACKUP_PREFIX}${projectId}-`;
  const result: { key: string; timestamp: string; size: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      const raw = localStorage.getItem(key);
      result.push({
        key,
        timestamp: key.replace(prefix, "").replace(/-/g, ":").replace(/T|Z/g, " ").trim(),
        size: raw ? raw.length : 0,
      });
    }
  }
  return result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** 从指定备份恢复所有数据 */
export function restoreBackup(backupKey: string): boolean {
  try {
    const raw = localStorage.getItem(backupKey);
    if (!raw) return false;
    const snapshot = JSON.parse(raw) as Record<string, string>;
    for (const [key, value] of Object.entries(snapshot)) {
      localStorage.setItem(key, value);
    }
    return true;
  } catch {
    console.warn("[backup] 恢复备份失败:", backupKey);
    return false;
  }
}
