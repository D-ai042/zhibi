/**
 * 数据迁移 —— 浏览器 localStorage → EXE SQLite
 *
 * 首次在 EXE 模式下启动时，将 localStorage 已有数据复制到 SQLite。
 * 之后不再重复迁移（标记完成）。
 *
 * 重要：这不是全部数据的迁移，而是补充性的。
 * 走 api.ts 的核心数据（项目/角色/词条等）在 EXE 模式下自动走 SQLite。
 * 这里处理的是前端直接读写 localStorage 的辅助数据。
 */

import { api, isTauri } from "./api";

/** 迁移标记 key */
const MIGRATION_FLAG_KEY = "migration_done_v1";

/** 需要迁移的 localStorage key 前缀列表 */
const MIGRATABLE_PREFIXES = [
    "novel-workbench-style-",
    "novel-workbench-bible-",
    "novel-workbench-voices-",
    "novel-workbench-log-",
    "novel-workbench-chat-",
    "novel-workbench-memory-short-",
    "novel-workbench-memory-long-",
    "novel-workbench-compressed-idx-",
    "novel-workbench-mock",
    "novel-workbench-snapshots-",
    "plot-chapters-",
    "chapter-index-",
    "chapter-",
    "plot-segments-",
    "plot-edges-",
    "worldview-edges-",
    "worldview-groups-",
    "material-",
    "ai-pending-chars-",
    "ai-pending-world-terms-",
    "inspiration-cards-",
    "char-groups-",
    "chapter-hash-",
];

/**
 * 执行迁移：将 localStorage 中匹配前缀的数据复制到 SQLite（app_settings 表）。
 * 仅在 EXE 模式且尚未迁移时执行。
 */
export async function migrateLocalStorageToSqlite(): Promise<void> {
    if (!isTauri()) return; // 浏览器模式不用迁移

    // 检查是否已迁移过
    try {
        const done = await api.getSetting(MIGRATION_FLAG_KEY);
        if (done) return; // 已迁移过
    } catch {
        // 首次启动，继续迁移
    }

    console.log("[migrate] 开始从 localStorage 迁移数据到 SQLite...");
    let count = 0;

    // 遍历所有 localStorage key
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        // 检查是否匹配需要迁移的前缀
        const shouldMigrate = MIGRATABLE_PREFIXES.some((prefix) =>
            key.startsWith(prefix)
        );

        if (!shouldMigrate) continue;

        const value = localStorage.getItem(key);
        if (!value || value === "[]" || value === "{}") continue;

        try {
            await api.setSetting(key, value);
            count++;
        } catch (e) {
            console.warn(`[migrate] 迁移失败: ${key}`, e);
        }
    }

    // 标记迁移完成（只有至少成功迁移了 1 条才标记，防止全失败后遗漏）
    if (count > 0) {
        try {
            await api.setSetting(MIGRATION_FLAG_KEY, "1");
        } catch (e) {
            console.warn("[migrate] 无法写入迁移标记", e);
        }
    } else {
        console.warn("[migrate] 没有数据需要迁移，跳过标记");
    }

    console.log(`[migrate] 迁移完成: 共 ${count} 条数据`);
}
