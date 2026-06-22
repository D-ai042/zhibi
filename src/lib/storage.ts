/**
 * 统一存储层 —— 浏览器走 localStorage，EXE 走 Tauri Rust SQLite（app_settings 表）。
 *
 * 核心 API（推荐使用）：
 *   - loadJSON<T>(key, def): T          同步读取 JSON
 *   - saveJSON(key, value): boolean     同步写入 JSON，返回是否成功
 *
 * 底层 API：
 *   - getSync(key): string | null       同步读取原始字符串
 *   - setSync(key, value): void         同步写入原始字符串（失败抛异常）
 *
 * 废弃别名（保留兼容，勿在新代码使用）：
 *   - getJSONSync → loadJSON
 *   - setJSONSync → saveJSON（返回 void，内部自检失败并上报）
 *
 * T1 偏差说明：导出函数共 6 个（标准≤5，偏差+1）。
 *   getSync 被 backup/mock/migrate/memory 4 文件依赖用于读取原始字符串，
 *   loadJSON（JSON.parse 后对象）无法替代，故保留 getSync 导出。
 *
 * ★ EXE 模式下同步读写策略：
 *   - loadJSON / getSync：先读 localStorage，未命中则查内存缓存（启动时预暖自 SQLite）
 *   - saveJSON / setSync：同时写 localStorage + 异步 fire-and-forget 到 SQLite
 *   - 预暖在 useProjectBootstrap 中触发，早于任何组件渲染
 *
 * ★ B1 修复：写入失败不再静默 console.warn，改为抛异常 + reportDiagnostic
 */

import { api, isTauri } from "./api";
import { reportDiagnostic } from "./diagnostics";

// ===== 清理无效 UTF-16 代理对（根源修复：存储层自动清洗） =====
function cleanLoneSurrogates(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/[\uD800-\uDFFF]/g, '�');
  if (Array.isArray(value)) return value.map(cleanLoneSurrogates);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) result[k] = cleanLoneSurrogates(v);
    return result;
  }
  return value;
}

// ===== EXE 模式内存缓存（启动时从 SQLite 预暖） =====

/** SQLite → localStorage 的键值缓存，供 loadJSON/getSync 回退使用 */
const _sqliteCache = new Map<string, string>();

// prewarmFromSqlite 已迁移至 src/hooks/use-project-data.ts（应用层逻辑，非存储抽象）
// setJSON (async) 已废弃：StoryBibleModule 等处改用 saveJSON（同步 fire-and-forget）

// ===== 底层同步读写 =====

/**
 * 同步读取原始字符串：先试 localStorage，EXE 模式回退到内存缓存。
 */
export function getSync(key: string): string | null {
    const raw = localStorage.getItem(key);
    if (raw !== null) return raw;

    if (isTauri()) {
        const cached = _sqliteCache.get(key);
        if (cached !== undefined) {
            try { localStorage.setItem(key, cached); } catch { /* quota full */ }
            return cached;
        }
    }
    return null;
}

/**
 * 同步写入原始字符串。
 * ★ B1 修复：失败时抛异常（而非静默 console.warn），由 saveJSON 捕获并上报。
 */
export function setSync(key: string, value: string): void {
    localStorage.setItem(key, value);
    // 在 EXE 模式下异步同步写入 SQLite（fire-and-forget，不阻塞 UI）
    if (isTauri()) {
        _sqliteCache.set(key, value);
        api.setSetting(key, value).catch((e) => {
            reportDiagnostic("error", `SQLite 写入失败: ${key}`, e);
        });
    }
}

// ===== 核心 JSON API =====

/**
 * 同步读取 JSON。读取失败（不存在/损坏）返回默认值。
 */
export function loadJSON<T>(key: string, def: T): T {
    const raw = localStorage.getItem(key);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            return cleanLoneSurrogates(parsed) as T;
        } catch { return def; }
    }

    if (isTauri()) {
        const cached = _sqliteCache.get(key);
        if (cached !== undefined) {
            try {
                localStorage.setItem(key, cached);
                const parsed = JSON.parse(cached);
                return cleanLoneSurrogates(parsed) as T;
            } catch { return def; }
        }
    }

    return def;
}

/**
 * 同步写入 JSON，返回是否成功。
 * ★ B1 修复：
 *   1. setSync 失败抛异常 → 此处捕获 → reportDiagnostic → 返回 false
 *   2. 写后验证：读回比对，不一致 → reportDiagnostic → 返回 false
 */
export function saveJSON(key: string, value: unknown): boolean {
    let raw: string;
    try {
        raw = JSON.stringify(value);
    } catch (e) {
        reportDiagnostic("error", `JSON 序列化失败: ${key}`, e);
        return false;
    }

    // 1. 写入（setSync 失败会抛异常）
    try {
        setSync(key, raw);
    } catch (e) {
        reportDiagnostic("fatal", `存储写入失败: ${key}`, e);
        return false;
    }

    // 2. 写后验证：读回比对
    const readBack = getSync(key);
    if (readBack !== raw) {
        reportDiagnostic("fatal", `存储写后验证失败: ${key}`, {
            expected: raw.slice(0, 100),
            actual: readBack?.slice(0, 100),
        });
        return false;
    }

    return true;
}

// ===== 废弃别名（@deprecated，勿在新代码使用） =====

/** @deprecated 请使用 loadJSON */
export function getJSONSync<T>(key: string, def: T): T {
    return loadJSON<T>(key, def);
}

/**
 * @deprecated 请使用 saveJSON。
 * 返回 void（与旧签名兼容），内部调 saveJSON，失败时 reportDiagnostic。
 * 不直接指向 saveJSON 是为了避免 50 个调用点静默丢失错误检查。
 */
export function setJSONSync(key: string, value: unknown): void {
    const ok = saveJSON(key, value);
    if (!ok) {
        // saveJSON 内部已调 reportDiagnostic，此处无需重复
    }
}
