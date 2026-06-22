/**
 * 备份机制 —— 为项目数据创建快照，防止数据损坏不可恢复。
 *
 * createBackup() 在定稿时自动调用，保留最近 MAX_BACKUPS 个备份。
 * 用户也可手动触发备份。
 *
 * T4：getAllProjectKeys 改为从 SQLite app_settings 表读取（EXE 模式），
 * 浏览器模式回退到 localStorage。
 */

import { api, isTauri } from "./api";
import { getSync, setSync, getJSONSync, setJSONSync } from "./storage";

const BACKUP_PREFIX = "novel-backup-";
const MAX_BACKUPS = 5;

/** 收集项目相关的所有 key（T4：EXE 模式从 SQLite 读取，浏览器模式从 localStorage 读取） */
export async function getAllProjectKeys(projectId: string): Promise<string[]> {
  const keys: string[] = [];
  const prefixes = [
    `novel-workbench-`, `plot-segments-`,
    `plot-edges-`, `worldview-edges-`, `worldview-groups-`,
    `chapter-index-`, `chapter-${projectId}-`,
    `draft-${projectId}-`, `novel-snapshots-`,
    `char-groups-`, `ai-pending-chars-`, `ai-pending-world-terms-`,
    `inspiration-cards-`, `material-`, `chapter-hash-`,
  ];
  const globalExactKeys = ["novel-workbench-mock"];

  const matchKey = (key: string): boolean =>
    globalExactKeys.includes(key) ||
    (prefixes.some(p => key === p || key.startsWith(p)) && key.includes(projectId));

  if (isTauri()) {
    // EXE 模式：从 SQLite app_settings 表读取（B2 修复）
    try {
      const allSettings = await api.listAppSettings();
      for (const { key } of allSettings) {
        if (matchKey(key)) keys.push(key);
      }
    } catch (e) {
      console.warn("[backup] 从 SQLite 读取 key 失败，回退到 localStorage:", e);
      /* T4 降级回退：SQLite 不可用时遍历 localStorage */
      for (const key of Object.keys(localStorage)) {
        if (matchKey(key)) keys.push(key);
      }
    }
  } else {
    /* T4 浏览器模式：遍历 localStorage 收集 key */
    for (const key of Object.keys(localStorage)) {
      if (matchKey(key)) keys.push(key);
    }
  }
  return [...new Set(keys)];
}

/** 清理旧备份，只保留 MAX_BACKUPS 个 */
function cleanOldBackups(projectId: string): void {
  const backupPrefix = `${BACKUP_PREFIX}${projectId}-`;
  const backupKeys: string[] = [];
  /* T8: cleanup 需遍历 localStorage 枚举备份 key */
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(backupPrefix)) backupKeys.push(key);
  }
  backupKeys.sort();
  while (backupKeys.length > MAX_BACKUPS) {
    const old = backupKeys.shift();
    if (old) try { setJSONSync(old, null); } catch { /* ignore */ }
  }
}

/** 创建当前项目数据的完整备份 */
export async function createBackup(projectId: string): Promise<void> {
  const keys = await getAllProjectKeys(projectId);
  const snapshot: Record<string, string> = {};
  for (const key of keys) {
    try {
      const val = getSync(key);
      if (val !== null) snapshot[key] = val;
    } catch { /* skip unreadable keys */ }
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupKey = `${BACKUP_PREFIX}${projectId}-${timestamp}`;
  try {
    setJSONSync(backupKey, snapshot);
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
  /* T8: listBackups 需遍历 localStorage 枚举备份 key */
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(prefix)) {
      const raw = getSync(key);
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
    const raw = getSync(backupKey);
    if (!raw) return false;
    const snapshot = JSON.parse(raw) as Record<string, string>;
    for (const [key, value] of Object.entries(snapshot)) {
      setSync(key, value);
    }
    return true;
  } catch {
    console.warn("[backup] 恢复备份失败:", backupKey);
    return false;
  }
}
