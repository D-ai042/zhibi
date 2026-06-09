/**
 * 统一存储层 —— 浏览器走 localStorage，EXE 走 Tauri Rust SQLite（app_settings 表）。
 *
 * 所有前端代码中直接读写 localStorage 的地方，都应替换为 store.get/set 或 store.projectKey。
 * 这样浏览器预览和 EXE 生产包共用同一套数据访问代码，底层存储自动切换。
 */

import { api, isTauri } from "./api";

// ===== 项目级 key 工具 =====

/** 生成带项目 ID 的存储键：prefix-{pid} */
export function projectKey(prefix: string, projectId: string): string {
    return `${prefix}-${projectId}`;
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

// ===== 同步版（仅浏览器模式可用，EXE 模式会报错） =====

export function getSync(key: string): string | null {
    if (isTauri()) {
        console.warn("[storage] 同步读仅在浏览器模式下可用，EXE 模式请用 await get()");
        return localStorage.getItem(key);
    }
    return localStorage.getItem(key);
}

export function setSync(key: string, value: string): void {
    localStorage.setItem(key, value);
    // 在 EXE 模式下异步同步写入 SQLite（fire-and-forget，不阻塞 UI）
    if (isTauri()) {
        api.setSetting(key, value).catch(() => {});
    }
}

export function removeSync(key: string): void {
    localStorage.removeItem(key);
    if (isTauri()) {
        api.setSetting(key, "").catch(() => {});
    }
}

export function getJSONSync<T>(key: string, def: T): T {
    const raw = localStorage.getItem(key);
    if (!raw) return def;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return def;
    }
}

export function setJSONSync(key: string, value: unknown): void {
    setSync(key, JSON.stringify(value));
}
