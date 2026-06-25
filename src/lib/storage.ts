/**
 * 统一存储层 —— 浏览器走 localStorage，EXE 走 Tauri Rust SQLite（app_settings 表）。
 *
 *  * 所有前端代码中直接读写 localStorage 的地方，都应替换为 store.get/set 或 store.projectKey。
 * 这样浏览器预览和 EXE 生产包共用同一套数据访问代码，底层存储自动切换。
 *
 * ★ EXE 模式下同步读写策略：
 *   - getJSONSync / getSync：先读 localStorage，未命中则查内存缓存（启动时预暖自 SQLite）
 *   - setJSONSync / setSync：EXE 写 SQLite + 内存缓存；小型设置才镜像 localStorage
 *   - 预暖在 useProjectBootstrap 中触发，早于任何组件渲染
 */

import { api, isTauri } from "./api";
import { reportDiagnostic } from "./diagnostics";
import { auditRecord } from "./audit-log";

// ===== EXE 模式内存缓存（启动时从 SQLite 预暖） =====

/** SQLite → localStorage 的键值缓存，供 getJSONSync/getSync 回退使用 */
const _sqliteCache = new Map<string, string>();

function shouldMirrorSqliteKeyToLocalStorage(key: string): boolean {
    if (key.startsWith("chapter-index-")) return false;
    if (key.startsWith("chapter-")) return false;
    if (key.startsWith("plot-chapters-")) return false;
    if (key.startsWith("novel-workbench-backup-")) return false;
    if (key === "zhibi-audit-log") return false;
    if (key === "zhibi-error-log") return false;
    return true;
}

function removeLocalCacheOnly(key: string): void {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * EXE 启动时调用：将 SQLite 中所有 app_settings 读入内存缓存 + 写回 localStorage。
 * 确保后续 getJSONSync 即使 localStorage 为空也能命中缓存。
 */
export async function prewarmFromSqlite(): Promise<void> {
    if (!isTauri()) return;
    try {
        const all = await api.listAppSettings();
        let count = 0;
        let chapterIndexCount = 0;
        let chapterShardCount = 0;
        let localCacheRemoved = 0;
        const legacyChapterKeys: string[] = [];
        for (const { key, value } of all) {
            _sqliteCache.set(key, value);
            if (shouldMirrorSqliteKeyToLocalStorage(key)) {
                // 只写入 localStorage 中不存在的 key，避免覆盖更新的本地数据
                if (localStorage.getItem(key) === null) {
                    localStorage.setItem(key, value);
                }
            } else if (localStorage.getItem(key) !== null) {
                removeLocalCacheOnly(key);
                localCacheRemoved++;
            }
            if (key.startsWith("chapter-index-")) chapterIndexCount++;
            if (key.startsWith("chapter-") && !key.startsWith("chapter-index-")) chapterShardCount++;
            if (key.startsWith("plot-chapters-")) legacyChapterKeys.push(key);
            count++;
        }
        console.log(`[storage] 预暖完成: ${count} 条从 SQLite 载入`);
        if (localCacheRemoved > 0) {
            reportDiagnostic("warn", "已清理 EXE localStorage 章节缓存，数据仍保留在 SQLite", {
                localCacheRemoved,
                chapterIndexCount,
                chapterShardCount,
            });
        }
        if (legacyChapterKeys.length > 0) {
            reportDiagnostic("warn", "检测到旧章节聚合数据，将在章节加载时迁移", {
                legacyChapterKeys,
                chapterIndexCount,
                chapterShardCount,
            });
        }
    } catch (e) {
        reportDiagnostic("warn", "SQLite 预暖失败（首次启动无数据属于正常）", { error: String(e) });
    }
}

// ===== 底层读写 =====


/**
 * 写入值：EXE 模式走 Tauri invoke → SQLite，浏览器模式走 localStorage
 */
async function set(key: string, value: string): Promise<void> {
    if (isTauri()) {
        return api.setSetting(key, value);
    }
    localStorage.setItem(key, value);
    return;
}


// ===== JSON 便捷读写 =====


export async function setJSON(key: string, value: unknown): Promise<void> {
    return set(key, JSON.stringify(value));
}

// ===== 同步版（双读回退） =====

export function getSync(key: string): string | null {
    // 1. 先试 localStorage（最快）
    const raw = localStorage.getItem(key);
    if (raw !== null) return raw;

    // 2. EXE 模式：回退到内存缓存（预暖自 SQLite）
    if (isTauri()) {
        const cached = _sqliteCache.get(key);
        if (cached !== undefined) {
            if (shouldMirrorSqliteKeyToLocalStorage(key)) {
                // 只对小型设置写回 localStorage 加速；大数据留在 SQLite + 内存缓存
                try { localStorage.setItem(key, cached); } catch { /* quota full */ }
            } else {
                removeLocalCacheOnly(key);
            }
            return cached;
        }
    }
    return null;
}

export function setSync(key: string, value: string): void {
    // 审计：记录存储写入（静默，不影响性能）
    auditRecord("storage.set", { entityType: key.split("-")[0] || "unknown", summary: key, ok: true });
    // 在 EXE 模式下异步同步写入 SQLite（fire-and-forget，不阻塞 UI）
    if (isTauri()) {
        _sqliteCache.set(key, value);
        if (shouldMirrorSqliteKeyToLocalStorage(key)) {
            try { localStorage.setItem(key, value); } catch (e) {
                reportDiagnostic("warn", "localStorage 缓存写入失败，已保存在 SQLite", { key, error: String(e) });
            }
        } else {
            removeLocalCacheOnly(key);
        }
        api.setSetting(key, value).catch((e) => {
            reportDiagnostic("warn", `SQLite 写入失败: ${key}`, { key, error: String(e) });
        });
        return;
    }
    try { localStorage.setItem(key, value); } catch (e) {
        // T1.5: 写入失败时抛异常，让上层 saveJSON 捕获后调用 reportDiagnostic
        throw e;
    }
}

export function removeSync(key: string): void {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    _sqliteCache.delete(key);
    if (isTauri()) {
        api.deleteSetting(key).catch((e) => {
            reportDiagnostic("warn", `SQLite 删除失败: ${key}`, { key, error: String(e) });
        });
    }
}

/**
 * @deprecated 使用 loadJSON 代替。
 */
export function getJSONSync<T>(key: string, def: T): T {
    // 1. 先试 localStorage
    const raw = localStorage.getItem(key);
    if (raw) {
        try { return JSON.parse(raw) as T; } catch { return def; }
    }

    // 2. EXE 模式：回退到内存缓存（预暖自 SQLite）
    if (isTauri()) {
        const cached = _sqliteCache.get(key);
        if (cached !== undefined) {
            try {
                if (shouldMirrorSqliteKeyToLocalStorage(key)) {
                    // 只对小型设置写回 localStorage 加速；大数据留在 SQLite + 内存缓存
                    localStorage.setItem(key, cached);
                } else {
                    removeLocalCacheOnly(key);
                }
                return JSON.parse(cached) as T;
            } catch { return def; }
        }
    }

    return def;
}

// ===== T1 核心 API（loadJSON / saveJSON） =====

/**
 * 从 localStorage 读取 JSON 值。
 * 等价于 getJSONSync，推荐新代码使用此名。
 */
export const loadJSON = getJSONSync;

/**
 * 写入 JSON 到 localStorage，含写后验证。
 * 成功返回 true；失败调用 reportDiagnostic 并返回 false。
 */
export function saveJSON(key: string, value: unknown): boolean {
    try {
        const raw = JSON.stringify(value);
        setSync(key, raw);
        // T1.4: 写后验证 —— 读回比对，不一致则报告失败
        const readBack = getSync(key);
        if (readBack !== raw) {
            reportDiagnostic("error", `存储写入验证失败: ${key}`, { key });
            return false;
        }
        return true;
    } catch (e) {
        reportDiagnostic("error", `存储写入失败: ${key}`, { key, error: String(e) });
        return false;
    }
}

// ===== 废弃别名（保持向后兼容） =====

/**
 * @deprecated 使用 saveJSON 代替。内部调 saveJSON，失败时上报诊断。
 */
export function setJSONSync(key: string, value: unknown): void {
    if (!saveJSON(key, value)) {
        reportDiagnostic("error", `setJSONSync 写入失败: ${key}`);
    }
}
