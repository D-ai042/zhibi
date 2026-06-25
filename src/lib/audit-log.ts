/**
 * 操作审计追踪层 —— 记录每次数据变更的 before/after，用于调试"操作冲突"类 Bug。
 *
 * 设计原则：
 * - 在 storage.setSync 中自动拦截（无需修改业务代码）
 * - 环形缓冲，最多 500 条
 * - 防抖写入，避免导入等高频场景卡顿
 * - 导出时自动脱敏（长文本截断）
 */

import { getJSONSync, setJSONSync } from "./storage";

const AUDIT_KEY = "zhibi-audit-log";
const MAX_ENTRIES = 500;
const DEBOUNCE_MS = 500;

export interface AuditEntry {
    timestamp: string;
    action: string;           // 操作名（如 "api.save_world_term" / "storage.set"）
    entityType?: string;      // 数据类型（world_term / character / chapter）
    entityId?: string;        // 实体 ID
    summary?: string;         // 一句话描述
    ok: boolean;              // 成功/失败
    triggeredBy: "user" | "system" | "import";  // 触发来源
    detail?: unknown;         // 可选详情（before/after/error）
}

let auditBuffer: AuditEntry[] = [];
let auditFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushAudit() {
    if (auditBuffer.length === 0) return;
    const key = AUDIT_KEY;
    let logs: AuditEntry[] = getJSONSync(key, [] as AuditEntry[]);
    logs.push(...auditBuffer);
    if (logs.length > MAX_ENTRIES) logs = logs.slice(-MAX_ENTRIES);
    setJSONSync(key, logs);
    auditBuffer = [];
    auditFlushTimer = null;
}

/**
 * 记录一条操作审计。
 * @param action    操作名
 * @param detail    可选详情
 * @param triggeredBy 触发来源，默认 "user"
 */
export function auditRecord(
    action: string,
    detail?: { entityType?: string; entityId?: string; summary?: string; ok?: boolean; detail?: unknown },
    triggeredBy?: "user" | "system" | "import",
): void {
    const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        action,
        entityType: detail?.entityType,
        entityId: detail?.entityId,
        summary: detail?.summary || actionLabel(action),
        ok: detail?.ok !== false,
        triggeredBy: triggeredBy || (action.startsWith("api.") ? "system" : "user"),
        detail: detail?.detail,
    };
    auditBuffer.push(entry);
    if (!auditFlushTimer) {
        auditFlushTimer = setTimeout(flushAudit, DEBOUNCE_MS);
    }
}

/** 将内部操作名翻译为直白中文 */
function actionLabel(action: string): string {
    const LABELS: Record<string, string> = {
        "api.create_project": "新建作品",
        "api.open_project": "打开作品",
        "api.delete_project": "删除作品",
        "api.rename_project": "重命名作品",
        "api.get_projects": "加载作品列表",
        "api.list_characters": "加载角色列表",
        "api.save_character": "保存角色",
        "api.delete_character": "删除角色",
        "api.list_world_terms": "加载世界观词条",
        "api.save_world_term": "保存世界观词条",
        "api.delete_world_term": "删除世界观词条",
        "api.save_node_layout": "保存节点位置",
        "api.list_relationship_edges": "加载关系网",
        "api.save_relationship_edge": "保存关系边",
        "api.delete_relationship_edge": "删除关系边",
        "api.list_chapters": "加载章节列表",
        "api.get_chapter_content": "读取章节正文",
        "api.save_chapter_content": "保存章节正文",
        "api.get_chapter_summaries": "加载章节摘要",
        "api.get_style_guide": "加载风格指南",
        "api.save_style_guide": "保存风格指南",
        "api.get_story_bible": "加载故事铁则",
        "api.save_story_bible": "保存故事铁则",
        "api.ai_complete": "调用 AI",
        "api.ai_complete_stream": "流式 AI 调用",
        "api.get_api_config": "读取 API 配置",
        "api.set_setting": "写入应用设置",
        "api.list_beat_cards": "加载节拍卡片",
        "api.save_beat_card": "保存节拍卡片",
        "api.delete_beat_card": "删除节拍卡片",
        "api.list_locked_fields": "加载锁定字段",
        "storage.set": "数据写入存储",
    };
    return LABELS[action] || action;
}

/** 立即刷新缓冲区（页面关闭前调用） */
export function flushAuditNow(): void {
    if (auditFlushTimer) { clearTimeout(auditFlushTimer); auditFlushTimer = null; }
    flushAudit();
}

/** 获取全部审计日志 */
export function getAuditLog(): AuditEntry[] {
    return getJSONSync(AUDIT_KEY, [] as AuditEntry[]);
}

/** 按实体 ID 过滤审计日志 */
export function getAuditLogByEntity(entityId: string): AuditEntry[] {
    return getAuditLog().filter(e => e.entityId === entityId);
}

/** 清除审计日志 */
export function clearAuditLog(): void {
    auditBuffer = [];
    setJSONSync(AUDIT_KEY, []);
}

/** 导出审计日志为 JSON（自动脱敏） */
export function exportAuditLog(): string {
    const logs = getAuditLog();
    const sanitized = logs.map(e => {
        const entry = { ...e };
        // 脱敏：截断长 detail
        if (entry.detail && typeof entry.detail === "object") {
            try {
                const s = JSON.stringify(entry.detail);
                if (s.length > 200) {
                    entry.detail = `${s.slice(0, 200)}...(截断)`;
                }
            } catch { entry.detail = "(不可序列化)"; }
        }
        return entry;
    });
    return JSON.stringify(sanitized, null, 2);
}
