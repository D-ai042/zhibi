/**
 * 版本检查 —— 从远程服务器检查是否有新版本
 *
 * 更新清单地址：http://175.178.18.102:8000/api/v1/version.json
 *
 * 服务器 version.json 格式：
 * {
 *   "version": "0.3.0",
 *   "download_url": "http://175.178.18.102:8000/downloads/zhibi-writer_0.3.0_x64-setup.exe",
 *   "release_notes": "更新说明",
 *   "release_date": "2026-06-11"
 * }
 */

import { getJSONSync, setJSONSync } from "./storage";

const VERSION_CHECK_URL = "http://175.178.18.102:8000/api/v1/version.json";

/** 检查结果缓存 key（存 localStorage，避免每次启动都弹） */
const DISMISSED_KEY = "version-update-dismissed";

export interface VersionInfo {
    version: string;
    download_url: string;
    release_notes?: string;
    release_date?: string;
}

/** 获取当前应用版本号 */
export function getCurrentVersion(): string {
    try {
        return __APP_VERSION__ || "0.3.4";
    } catch {
        return "0.3.4";
    }
}

/**
 * 从远程服务器获取最新版本信息
 */
export async function fetchLatestVersion(): Promise<VersionInfo | null> {
    try {
        const res = await fetch(VERSION_CHECK_URL, {
            signal: AbortSignal.timeout(5000), // 5 秒超时
        });
        if (!res.ok) return null;
        return await res.json() as VersionInfo;
    } catch {
        return null; // 网络错误/服务器未配置时静默失败
    }
}

/**
 * 比较两个版本号（semver 风格）
 * 返回 true 如果 latest > current
 */
export function isNewerVersion(latest: string, current: string): boolean {
    const l = latest.split(".").map(Number);
    const c = current.split(".").map(Number);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
        const lv = l[i] || 0;
        const cv = c[i] || 0;
        if (lv > cv) return true;
        if (lv < cv) return false;
    }
    return false;
}

/**
 * 检查用户是否已忽略此版本
 */
export function isDismissed(version: string): boolean {
    try {
        return getJSONSync(DISMISSED_KEY, null) === version;
    } catch {
        return false;
    }
}

/**
 * 标记用户已忽略此版本（不再提示）
 */
export function markDismissed(version: string): void {
    try {
        setJSONSync(DISMISSED_KEY, version);
    } catch { /* ignore */ }
}

/**
 * 清除忽略标记（下次启动重新提示）
 */
export function clearDismissed(): void {
    try {
        try { localStorage.removeItem(DISMISSED_KEY); } catch { }
    } catch { /* ignore */ }
}

/**
 * 一键检查更新：从远程获取 → 比较版本 → 返回结果
 * 已忽略或非新版本返回 null
 */
export async function checkForUpdate(): Promise<VersionInfo | null> {
    const latest = await fetchLatestVersion();
    if (!latest) return null;

    const current = getCurrentVersion();
    if (!isNewerVersion(latest.version, current)) return null;
    if (isDismissed(latest.version)) return null;

    return latest;
}
