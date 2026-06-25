/**
 * 诊断上报层 —— 存储写入失败等关键错误的统一出口。
 *
 * 设计原则：
 * - reportDiagnostic：即时反馈（控制台 + UI Toast），不写 localStorage
 * - recordError：持久化到 localStorage（环形缓冲，最多 200 条），供诊断面板查看
 * - runIntegrityCheck：纯本地数据完整性扫描
 */

import { getJSONSync, setJSONSync, getSync, removeSync } from "./storage";

export type DiagnosticLevel = "warn" | "error" | "fatal";

const ERROR_LOG_KEY = "zhibi-error-log";
const MAX_ERRORS = 200;

export interface DiagnosticEvent {
    level: DiagnosticLevel;
    message: string;
    details?: unknown;
    timestamp: string;
    source?: string;  // api / storage / runtime / promise
}

/**
 * 上报一条诊断信息。
 * - 始终 console.error/warn 输出到控制台
 * - 通过 window.dispatchEvent 通知 UI（CustomEvent）
 * - 不写入 localStorage（配额满时写入本身会失败）
 */
export function reportDiagnostic(
    level: DiagnosticLevel,
    message: string,
    details?: unknown,
): void {
    const event: DiagnosticEvent = {
        level,
        message,
        details,
        timestamp: new Date().toISOString(),
    };

    // 1. 控制台输出（永久可见）
    const tag = `[zhibi:${level}]`;
    if (level === "error" || level === "fatal") {
        console.error(tag, message, details ?? "");
    } else {
        console.warn(tag, message, details ?? "");
    }

    // 2. 通知 UI 层（CustomEvent，不依赖 localStorage）
    if (typeof window !== "undefined" && window.dispatchEvent) {
        try {
            window.dispatchEvent(
                new CustomEvent<DiagnosticEvent>("zhibi-diagnostic", { detail: event }),
            );
        } catch {
            // dispatchEvent 极端情况下可能失败（如 jsdom 测试环境），不影响主流程
        }
    }
}

/**
 * 持久化一条错误日志（用于诊断面板查看）。
 * 与 reportDiagnostic 的区别：这个写 localStorage，reportDiagnostic 只做即时通知。
 */
export function recordError(
    level: DiagnosticLevel,
    source: string,
    message: string,
    details?: unknown,
): void {
    // 同时做即时反馈
    reportDiagnostic(level, message, details);

    // 持久化（如果 localStorage 满了这里会失败，但至少控制台已输出）
    try {
        const entry: DiagnosticEvent = {
            level,
            source,
            message,
            details: typeof details === "string" ? details.slice(0, 500) : details,
            timestamp: new Date().toISOString(),
        };
        let logs = getJSONSync(ERROR_LOG_KEY, [] as DiagnosticEvent[]);
        logs.push(entry);
        if (logs.length > MAX_ERRORS) logs = logs.slice(-MAX_ERRORS);
        setJSONSync(ERROR_LOG_KEY, logs);
    } catch { /* 配额满时静默，控制台已记录 */ }
}

/** 获取全部持久化错误日志 */
export function getErrorLog(): DiagnosticEvent[] {
    return getJSONSync(ERROR_LOG_KEY, [] as DiagnosticEvent[]);
}

/** 导出错误日志为 JSON，包含基础环境与存储摘要 */
export function exportErrorLog(): string {
    const logs = getErrorLog();
    return JSON.stringify({
        exportedAt: new Date().toISOString(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        storage: getLocalStorageUsage(),
        logs,
    }, null, 2);
}

/** 清除错误日志 */
export function clearErrorLog(): void {
    setJSONSync(ERROR_LOG_KEY, []);
}

// ===== 数据完整性检查 =====

export interface IntegrityIssue {
    type: string;
    severity: "error" | "warning";
    message: string;
    key?: string;
    /** 可修复时携带修复所需的上下文 */
    fixContext?: { orphanId?: string; edgeId?: string; edgeIndex?: number };
}

/**
 * 运行数据完整性检查（纯本地，不调 AI）。
 * 返回发现的问题列表。
 */
export function runIntegrityCheck(): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];

    try {
        const storageUsage = getLocalStorageUsage();

        // 1. mock-backend 可解析
        const raw = localStorage.getItem("novel-workbench-mock");
        if (raw) {
            try {
                const data = JSON.parse(raw);
                if (typeof data !== "object" || data === null) {
                    issues.push({ type: "data-format", severity: "error", message: "novel-workbench-mock 格式异常（非对象）" });
                } else {
                    // 检查关键字段
                    if (!Array.isArray(data.projects)) issues.push({ type: "data-schema", severity: "error", message: "projects 字段缺失或非数组" });
                    if (!Array.isArray(data.characters)) issues.push({ type: "data-schema", severity: "warning", message: "characters 字段缺失" });
                    if (!Array.isArray(data.worldTerms)) issues.push({ type: "data-schema", severity: "warning", message: "worldTerms 字段缺失" });
                    if (!data.apiConfig) issues.push({ type: "data-schema", severity: "warning", message: "apiConfig 字段缺失" });
                }
            } catch {
                issues.push({ type: "data-parse", severity: "error", message: "novel-workbench-mock JSON 解析失败" });
            }
        }

        // 2. chapter-index 与章节分片一致性
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith("chapter-index-")) continue;
            const pid = key.replace("chapter-index-", "");
            try {
                const ids: string[] = getJSONSync(key, []);
                for (const id of ids) {
                    const chKey = `chapter-${pid}-${id}`;
                    const val = getSync(chKey);
                    if (!val) {
                        issues.push({ type: "orphan-index", severity: "error", message: `章节索引指向不存在的章节 ${id}`, key, fixContext: { orphanId: id } });
                    } else {
                        try { JSON.parse(val); } catch {
                            issues.push({ type: "data-parse", severity: "error", message: `章节数据 JSON 损坏: ${id}`, key: chKey });
                        }
                    }
                }
            } catch { /* skip */ }
        }

        // 2.5 旧章节聚合 key 残留。EXE 下这类 key 应迁移到 chapter-index/chapter-*，并从 localStorage 清理。
        for (const item of storageUsage.items) {
            if (item.key.startsWith("plot-chapters-")) {
                issues.push({
                    type: "legacy-chapter-storage",
                    severity: "warning",
                    message: `检测到旧章节聚合缓存 ${item.key}（${item.mb}MB），可能继续占用 localStorage`,
                    key: item.key,
                });
            }
        }

        // 3. plot-segments edges 悬空检测
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith("plot-segments-")) continue;
            const pid = key.replace("plot-segments-", "");
            const segs = getJSONSync(key, [] as any[]);
            const segIds = new Set(segs.map((s: any) => s.id));
            const edgeKey = `plot-edges-${pid}`;
            const edges = getJSONSync(edgeKey, [] as any[]);
            for (const e of edges) {
                if (e.source && !segIds.has(e.source)) {
                    issues.push({ type: "dangling-edge", severity: "warning", message: `剧情连线 source "${e.source}" 指向不存在的段落`, key: edgeKey, fixContext: { edgeId: e.id } });
                }
                if (e.target && !segIds.has(e.target)) {
                    issues.push({ type: "dangling-edge", severity: "warning", message: `剧情连线 target "${e.target}" 指向不存在的段落`, key: edgeKey, fixContext: { edgeId: e.id } });
                }
            }
        }

        // 4. worldview-edges 悬空检测
        const mockRaw = localStorage.getItem("novel-workbench-mock");
        if (mockRaw) {
            try {
                const mock = JSON.parse(mockRaw);
                const termIds = new Set((mock.worldTerms || []).map((t: any) => t.id));
                for (const pid of new Set((mock.worldTerms || []).map((t: any) => t.project_id))) {
                    const weKey = `worldview-edges-${pid}`;
                    const weEdges = getJSONSync(weKey, [] as any[]);
                    for (const e of weEdges) {
                        if (e.source && !termIds.has(e.source)) {
                            issues.push({ type: "dangling-edge", severity: "warning", message: `世界观连线 source 指向不存在词条: ${e.source}`, key: weKey, fixContext: { edgeId: e.id } });
                        }
                        if (e.target && !termIds.has(e.target)) {
                            issues.push({ type: "dangling-edge", severity: "warning", message: `世界观连线 target 指向不存在词条: ${e.target}`, key: weKey, fixContext: { edgeId: e.id } });
                        }
                    }
                }
            } catch { /* skip */ }
        }

        // 5. localStorage 用量预警 + 大 key 排名
        if (storageUsage.totalBytes > 4 * 1024 * 1024) {
            issues.push({ type: "storage-capacity", severity: "error", message: `localStorage 用量 ${storageUsage.totalMB}MB，接近 5MB 上限，可能导致保存失败` });
        } else if (storageUsage.totalBytes > 3 * 1024 * 1024) {
            issues.push({ type: "storage-capacity", severity: "warning", message: `localStorage 用量 ${storageUsage.totalMB}MB，建议导出备份` });
        }
        for (const item of storageUsage.items.slice(0, 8)) {
            if (item.bytes > 256 * 1024) {
                issues.push({
                    type: "storage-large-key",
                    severity: "warning",
                    message: `localStorage 大 key: ${item.key} 占用 ${item.mb}MB`,
                    key: item.key,
                });
            }
        }

    } catch (e) {
        issues.push({ type: "check-failed", severity: "error", message: `完整性检查内部错误: ${e}` });
    }

    return issues;
}

/** 深度完整性检查：在本地扫描之外，读取项目 API 主数据并检查业务引用关系。 */
export async function runDeepIntegrityCheck(): Promise<IntegrityIssue[]> {
    const issues = runIntegrityCheck();

    try {
        const { api } = await import("./api");
        const projects = await api.getProjects();
        for (const project of projects) {
            const [characters, relationships, terms] = await Promise.all([
                api.listCharacters(project.id).catch(() => []),
                api.listRelationshipEdges(project.id).catch(() => []),
                api.listWorldTerms(project.id).catch(() => []),
            ]);

            const charIds = new Set(characters.map(c => c.id));
            const termIds = new Set(terms.map(t => t.id));

            for (const edge of relationships) {
                if (!charIds.has(edge.source_id) || !charIds.has(edge.target_id)) {
                    issues.push({
                        type: "character-dangling-edge",
                        severity: "error",
                        message: `作品「${project.name}」存在指向已删除人物的关系边: ${edge.relation_type || edge.id}`,
                        key: "novel-workbench-mock",
                        fixContext: { edgeId: edge.id },
                    });
                }
            }

            checkGroups(issues, `char-groups-${project.id}`, charIds, "人物关系", project.name);
            checkGroups(issues, `worldview-groups-${project.id}`, termIds, "世界观", project.name);
            checkPlotSegments(issues, `plot-segments-${project.id}`, project.name);
        }
    } catch (e) {
        issues.push({
            type: "deep-check-failed",
            severity: "warning",
            message: `深度完整性检查未完成: ${e instanceof Error ? e.message : String(e)}`,
        });
    }

    return issues;
}

function getLocalStorageUsage() {
    let totalBytes = 0;
    const items: { key: string; bytes: number; mb: string }[] = [];
    if (typeof localStorage === "undefined") return { totalBytes: 0, totalMB: "0.00", items };
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const bytes = (localStorage.getItem(key) || "").length * 2;
        totalBytes += bytes;
        items.push({ key, bytes, mb: (bytes / (1024 * 1024)).toFixed(2) });
    }
    items.sort((a, b) => b.bytes - a.bytes);
    return { totalBytes, totalMB: (totalBytes / (1024 * 1024)).toFixed(2), items };
}

function checkGroups(
    issues: IntegrityIssue[],
    key: string,
    validIds: Set<string>,
    label: string,
    projectName: string,
) {
    const groups = getJSONSync(key, [] as any[]);
    if (!Array.isArray(groups) || groups.length === 0) return;
    const seenChildIds = new Set<string>();
    for (const group of groups) {
        const childIds = Array.isArray(group.childIds) ? group.childIds : [];
        if (typeof group.x !== "number" || typeof group.y !== "number") {
            issues.push({
                type: "group-position-invalid",
                severity: "warning",
                message: `作品「${projectName}」的${label}编组「${group.name || group.id}」缺少有效位置，可能导致刷新后位置错乱`,
                key,
            });
        }
        for (const childId of childIds) {
            if (!validIds.has(childId)) {
                issues.push({
                    type: "group-dangling-child",
                    severity: "warning",
                    message: `作品「${projectName}」的${label}编组「${group.name || group.id}」引用了不存在的节点 ${childId}`,
                    key,
                    fixContext: { edgeId: childId, orphanId: group.id },
                });
            }
            if (seenChildIds.has(childId)) {
                issues.push({
                    type: "group-duplicate-child",
                    severity: "warning",
                    message: `作品「${projectName}」的${label}节点 ${childId} 同时出现在多个编组中，可能导致位置被重算打乱`,
                    key,
                });
            }
            seenChildIds.add(childId);
        }
    }
}

function checkPlotSegments(issues: IntegrityIssue[], key: string, projectName: string) {
    const segments = getJSONSync(key, [] as any[]);
    if (!Array.isArray(segments)) return;
    for (const segment of segments) {
        const beats = Array.isArray(segment.beats) ? segment.beats : [];
        if (beats.length === 0) continue;
        const numbers = beats.map((beat: any) => Number(beat.number));
        const hasInvalid = numbers.some((n: number) => !Number.isFinite(n));
        const expected = numbers.every((n: number, index: number) => n === index + 1);
        const ids = beats.map((beat: any) => beat.id).filter(Boolean);
        if (hasInvalid || !expected || new Set(ids).size !== ids.length) {
            issues.push({
                type: "plot-beat-order",
                severity: "warning",
                message: `作品「${projectName}」的剧情段「${segment.title || segment.id}」细纲序号不连续或 ID 重复，拖动排序后可能无法稳定保存`,
                key,
            });
        }
    }
}

// ===== 自动修复 =====

export interface FixResult {
    type: string;
    ok: boolean;
    message: string;
}

/**
 * 自动修复可修复的完整性检查问题。
 * 返回每条修复的结果。
 */
export async function autoFix(issues: IntegrityIssue[]): Promise<FixResult[]> {
    const results: FixResult[] = [];
    // 按 key 分组，避免重复读写同一个 key
    const grouped = new Map<string, IntegrityIssue[]>();
    for (const issue of issues) {
        if (!issue.key) continue;
        const list = grouped.get(issue.key) || [];
        list.push(issue);
        grouped.set(issue.key, list);
    }

    for (const [key, iss] of grouped) {
        try {
            if (iss[0].type === "orphan-index") {
                // ★ 不再自动删除章节索引中的悬空 ID。
                // 章节数据可能在 SQLite 中完好，localStorage 只是缓存未命中。
                // 由用户手动检查或通过"深度完整性检查"确认后再处理。
                results.push({ type: "orphan-index", ok: true, message: `章节索引 ${key} 发现 ${iss.length} 个悬空引用，已跳过自动修复（数据可能仍存在于 SQLite，建议运行深度检查确认）` });
            } else if (iss[0].type === "dangling-edge") {
                // 修复悬空边：删除引用了不存在实体的边
                const badEdgeIds = new Set(iss.map(i => i.fixContext?.edgeId).filter(Boolean));
                if (badEdgeIds.size === 0) continue;
                const edges = getJSONSync(key, [] as any[]);
                const fixed = edges.filter((e: any) => !badEdgeIds.has(e.id));
                if (fixed.length < edges.length) {
                    setJSONSync(key, fixed);
                    results.push({ type: "dangling-edge", ok: true, message: `${key} 移除了 ${edges.length - fixed.length} 条无效连线` });
                }
            } else if (iss[0].type === "legacy-chapter-storage") {
                // 修复旧章节聚合缓存：通过统一存储层删除（EXE 下同步删 SQLite）
                removeSync(key);
                results.push({ type: "legacy-chapter-storage", ok: true, message: `已清理旧章节聚合缓存 ${key}` });
            } else if (iss[0].type === "group-dangling-child") {
                // 修复编组悬空子节点：从编组中移除不存在的节点
                const badChildIds = new Set(iss.map(i => i.fixContext?.edgeId).filter(Boolean));
                const parentIds = new Set(iss.map(i => i.fixContext?.orphanId).filter(Boolean));
                if (badChildIds.size === 0) continue;
                const groups: any[] = getJSONSync(key, [] as any[]);
                let changed = false;
                for (const g of groups) {
                    if (parentIds.size > 0 && !parentIds.has(g.id)) continue;
                    const before = (g.childIds || []).length;
                    g.childIds = (g.childIds || []).filter((cid: string) => !badChildIds.has(cid));
                    if (g.childIds.length !== before) changed = true;
                }
                if (changed) {
                    setJSONSync(key, groups.filter((g: any) => (g.childIds || []).length > 0));
                    results.push({ type: "group-dangling-child", ok: true, message: `编组 ${key} 移除了 ${iss.length} 个悬空引用` });
                }
            } else if (iss[0].type === "character-dangling-edge") {
                // 修复指向已删除人物的关系边：通过 API 删除（EXE 下删除 SQLite relationship_edges 表记录）
                const badEdgeIds = new Set(iss.map(i => i.fixContext?.edgeId).filter(Boolean));
                if (badEdgeIds.size === 0) continue;
                let deletedCount = 0;
                try {
                    const { api } = await import("./api");
                    for (const id of badEdgeIds) {
                        try {
                            await api.deleteRelationshipEdge(id);
                            deletedCount++;
                        } catch { /* 单条失败不影响其他 */ }
                    }
                } catch { /* 导入失败 */ }
                if (deletedCount > 0) {
                    results.push({ type: "character-dangling-edge", ok: true, message: `通过 API 移除了 ${deletedCount} 条指向已删除人物的关系边` });
                }
            }
        } catch (e) {
            results.push({ type: iss[0].type, ok: false, message: `修复 ${key} 失败: ${e}` });
        }
    }

    return results;
}
