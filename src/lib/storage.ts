/**
 * 统一存储层 —— 浏览器走 localStorage，EXE 走 Tauri Rust SQLite（app_settings 表）。
 *
 * 所有前端代码中直接读写 localStorage 的地方，都应替换为 store.get/set 或 store.projectKey。
 * 这样浏览器预览和 EXE 生产包共用同一套数据访问代码，底层存储自动切换。
 *
 * ★ EXE 模式下同步读写策略：
 *   - getJSONSync / getSync：先读 localStorage，未命中则查内存缓存（启动时预暖自 SQLite）
 *   - setJSONSync / setSync：同时写 localStorage + 异步 fire-and-forget 到 SQLite
 *   - 预暖在 useProjectBootstrap 中触发，早于任何组件渲染
 */

import { api, isTauri } from "./api";

// ===== 项目级 key 工具 =====

/** 生成带项目 ID 的存储键：prefix-{pid} */
export function projectKey(prefix: string, projectId: string): string {
    return `${prefix}-${projectId}`;
}

// ===== EXE 模式内存缓存（启动时从 SQLite 预暖） =====

/** SQLite → localStorage 的键值缓存，供 getJSONSync/getSync 回退使用 */
const _sqliteCache = new Map<string, string>();

/**
 * EXE 启动时调用：将 SQLite 中所有 app_settings 读入内存缓存 + 写回 localStorage。
 * 确保后续 getJSONSync 即使 localStorage 为空也能命中缓存。
 */
export async function prewarmFromSqlite(): Promise<void> {
    if (!isTauri()) return;
    try {
        const all = await api.listAppSettings();
        let count = 0;
        for (const { key, value } of all) {
            _sqliteCache.set(key, value);
            // 只写入 localStorage 中不存在的 key，避免覆盖更新的本地数据
            if (localStorage.getItem(key) === null) {
                localStorage.setItem(key, value);
            }
            count++;
        }
        console.log(`[storage] 预暖完成: ${count} 条从 SQLite 载入`);
    } catch (e) {
        console.warn("[storage] 预暖失败（首次启动无数据属于正常）:", e);
    }
}

// ===== 底层读写 =====

/**
 * 读取值：EXE 模式走 Tauri invoke → SQLite，浏览器模式走 localStorage
 */
export async function get(key: string): Promise<string | null> {
    if (isTauri()) {
        return api.getSetting(key);
    }
    return localStorage.getItem(key);
}

/**
 * 写入值：EXE 模式走 Tauri invoke → SQLite，浏览器模式走 localStorage
 */
export async function set(key: string, value: string): Promise<void> {
    if (isTauri()) {
        return api.setSetting(key, value);
    }
    localStorage.setItem(key, value);
    return;
}

/**
 * 删除值
 */
export async function remove(key: string): Promise<void> {
    if (isTauri()) {
        return api.setSetting(key, "");
    }
    localStorage.removeItem(key);
    return;
}

// ===== JSON 便捷读写 =====

export async function getJSON<T>(key: string, def: T): Promise<T> {
    const raw = await get(key);
    if (!raw) return def;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return def;
    }
}

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
            // 写回 localStorage 加速下次访问（配额满时静默跳过，SQLite 兜底）
            try { localStorage.setItem(key, cached); } catch { /* quota full */ }
            return cached;
        }
    }
    return null;
}

export function setSync(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch (e) {
        console.warn(`[storage] localStorage 写入失败: ${key}`, e);
    }
    // 在 EXE 模式下异步同步写入 SQLite（fire-and-forget，不阻塞 UI）
    if (isTauri()) {
        _sqliteCache.set(key, value);
        api.setSetting(key, value).catch((e) => {
            console.warn(`[storage] SQLite 写入失败: ${key}`, e);
        });
    }
}

export function removeSync(key: string): void {
    localStorage.removeItem(key);
    _sqliteCache.delete(key);
    if (isTauri()) {
        api.setSetting(key, "").catch(() => { });
    }
}

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
                // 写回 localStorage 加速下次访问
                localStorage.setItem(key, cached);
                return JSON.parse(cached) as T;
            } catch { return def; }
        }
    }

    return def;
}

export function setJSONSync(key: string, value: unknown): void {
    try {
        setSync(key, JSON.stringify(value));
    } catch {
        // JSON.stringify 失败（循环引用等极端情况），静默跳过
    }
}
