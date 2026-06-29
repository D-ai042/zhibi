/**
 * 质量检查器 —— 独立质检入口，确保不偏移
 *
 * 全部由 AI 完成分析，不做正则/关键词匹配。
 * 返回结构化结果，包含具体原文引用和位置。
 *
 * 设计原则：
 * - 质检与定稿解耦：质检可独立触发，定稿不再调用质检
 * - 定稿前由 finalizeChapter 做前置校验（要求存在 fresh 质检结果）
 * - 持久化到 LogStore.qualityChecks[chapterNumber]，含 contentHash 用于 staleness 判断
 */

import { api } from "./api";
import { getJSONSync, setJSONSync } from "./storage";
import type { Character, ForeshadowEntry, StoryBible, StyleGuide, TimelineNode } from "@/types";

// ===== 接口 =====

export type QualityCheckType = "bible" | "character" | "foreshadow" | "plot_logic" | "timeline";

export interface QualityCheckInput {
    projectId: string; chapterId: string; chapterNumber: number; chapterContent: string;
    /** 可选：调用方预加载的 timelineNodes，避免重复 IPC */
    timelineNodes?: TimelineNode[];
}

export interface QualityCheckResult {
    passed: boolean; checks: QualityCheckItem[];
}

export interface QualityCheckItem {
    type: QualityCheckType;
    severity: "pass" | "warning" | "error";
    message: string;
    detail: string;
    /** 原文引用（AI 定位到具体段落/句子） */
    quote?: string;
    /** 位置描述（如 "第3段"、"中部"） */
    location?: string;
}

/** LogStore 中按章节号存储的质检结果（向后兼容：contentHash/status 可缺省） */
export interface StoredQualityCheck {
    checkedAt: string;
    passed: boolean;
    checks: QualityCheckItem[];
    /** 质检时基于的正文内容哈希，用于判断正文是否已修改 */
    contentHash?: string;
    /** 质检状态：fresh(刚检) | stale(正文已改) | superseded(被新质检取代) */
    status?: "fresh" | "stale" | "superseded";
}

const MAX_CHARS_PER_CHUNK = 6000;
/** 时间线节点注入 prompt 的最大数量（避免 token 超限） */
const MAX_TIMELINE_NODES_IN_PROMPT = 10;
/** prevSummaries 默认窗口（章） */
const PREV_SUMMARIES_WINDOW = 10;
/** prevSummaries 兜底窗口上限（章，避免 token 爆炸） */
const PREV_SUMMARIES_HARD_CAP = 30;

/** 简单字符串哈希（与 finalizeChapter.simpleHash 实现保持一致，便于跨模块比对） */
export function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}

// ===== 主函数 =====

export async function runQualityCheck(input: QualityCheckInput): Promise<QualityCheckResult> {
    const { projectId, chapterNumber, chapterContent, timelineNodes, chapterId } = input;
    const checks: QualityCheckItem[] = [];

    // 加载上下文（时间线节点支持外部预加载，避免重复 IPC）
    const [bible, styleGuide, prevSummaries, timeline, characters, foreshadows] = await Promise.all([
        loadStoryBible(projectId),
        loadStyleGuide(projectId),
        loadPrevSummaries(projectId, chapterNumber),
        timelineNodes ? Promise.resolve(timelineNodes) : loadTimelineNodes(projectId),
        loadCharacters(projectId),
        loadForeshadows(projectId, chapterNumber),
    ]);

    // ★ AI 全文检查（分段发送避免超 token）
    // 并行检查所有分段：原串行 for-await 多段时延迟翻倍，改为 Promise.all 并行执行。
    // 顺序由 map 索引保持，结果按段顺序合并。通常 2-3 段，并行不会触发 API 限流。
    const chunks = splitContent(chapterContent, MAX_CHARS_PER_CHUNK);
    const aiResults = await Promise.all(
        chunks.map((chunk, i) => {
            const chunkLabel = chunks.length > 1 ? `（第${i + 1}/${chunks.length}段）` : "";
            return aiQualityCheck(chapterNumber, chunk, chunkLabel, bible, styleGuide, prevSummaries, timeline, characters, foreshadows, chapterId);
        })
    );

    // 合并 AI 结果（保持分段顺序）+ 按 (type, message, quote) 去重（跨段同一问题只算一次）
    const seen = new Set<string>();
    for (const item of aiResults.flat()) {
        const key = `${item.type}|${item.message}|${item.quote || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checks.push(item);
    }

    const errors = checks.filter((c) => c.severity === "error");
    // passed 仅当无 error 时为 true；warning 不阻断定稿（UI 单独展示 warning 数）
    return { passed: errors.length === 0, checks };
}

/**
 * 独立质检入口：执行质检并持久化到 LogStore，返回结果。
 * - 将旧质检结果标记为 superseded
 * - 写入 contentHash 供定稿前置校验判断 staleness
 * - 失败时不抛出，由调用方根据返回结果自行处理
 */
export async function runQualityCheckForChapter(input: QualityCheckInput): Promise<QualityCheckResult> {
    const result = await runQualityCheck(input);
    try {
        const logKey = `novel-workbench-log-${input.projectId}`;
        const logStore = getJSONSync<any>(logKey, {} as any);
        logStore.qualityChecks = logStore.qualityChecks || {};
        // 将本章之前的旧质检结果（无论 fresh/stale/superseded）统一标记为 superseded
        const cur = logStore.qualityChecks[String(input.chapterNumber)];
        if (cur) cur.status = "superseded";
        logStore.qualityChecks[String(input.chapterNumber)] = {
            checkedAt: new Date().toISOString(),
            passed: result.passed,
            checks: result.checks,
            contentHash: simpleHash(input.chapterContent),
            status: "fresh",
        } as StoredQualityCheck;
        setJSONSync(logKey, logStore);
    } catch { /* 持久化失败不阻塞质检结果返回 */ }
    return result;
}

/** 读取已存储的质检结果（供 UI 显示与定稿前置校验使用） */
export function getStoredQualityCheck(projectId: string, chapterNumber: number): StoredQualityCheck | null {
    try {
        const logKey = `novel-workbench-log-${projectId}`;
        const logStore = getJSONSync<any>(logKey, {} as any);
        return logStore?.qualityChecks?.[String(chapterNumber)] || null;
    } catch { return null; }
}

/** 生成质检项的唯一标识（与 ChapterEditor 保持一致，用于忽略/恢复） */
export function checkItemKey(c: QualityCheckItem): string {
    return `${c.type}|${c.message}|${c.quote || ""}`;
}


/** 将正文按 MAX_CHARS 分割，尽量在段落边界断开 */
function splitContent(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let current = "";
    for (const p of paragraphs) {
        if (current.length + p.length > maxChars && current.length > 0) {
            chunks.push(current);
            current = p;
        } else {
            current = current ? current + "\n\n" + p : p;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

// ===== AI 质量检查 =====

async function aiQualityCheck(
    chapterNumber: number, chapterContent: string, chunkLabel: string,
    bible: StoryBible | null, styleGuide: StyleGuide | null,
    prevSummaries: string, timeline: TimelineNode[],
    characters: Character[], foreshadows: ForeshadowEntry[], chapterId: string
): Promise<QualityCheckItem[]> {
    const bibleText = bible
        ? `不可违背的铁则：\n${(bible.inviolable_rules || []).map(r => `- ${r}`).join("\n")}\n\n世界观铁律：\n${(bible.worldview_rules || []).map(r => `- ${r}`).join("\n")}`
        : "暂无圣经铁则";

    // 主阶段：标注本章号所属阶段，便于检查阶段越界
    const stagesText = bible?.main_stages?.length
        ? bible.main_stages.map(s => {
            const [lo, hi] = s.chapter_range || [0, 0];
            const belongs = chapterNumber >= lo && chapterNumber <= hi ? "（本章所在阶段）" : "";
            return `- ${s.name} [第${lo}-${hi}章] status=${s.status || "?"}${belongs}`;
        }).join("\n")
        : "暂无主阶段";

    // 锁定事件：本章 ±2 范围内的事件必须遵守
    const lockedText = bible?.locked_events?.length
        ? bible.locked_events
            .filter(e => Math.abs((e.chapter || 0) - chapterNumber) <= 2)
            .map(e => `- 第${e.chapter}章「${e.title}」：${e.description}`)
            .join("\n") || "本章附近无锁定事件"
        : "暂无锁定事件";

    const styleText = styleGuide
        ? `叙述风格：${styleGuide.narrative_style || ""}\n文笔基调：${styleGuide.writing_tone || ""}\n写作红线：${styleGuide.writing_rules || ""}`
        : "暂无风格指南";

    // 角色档案：仅展示区角色（与上下文引擎口径一致），每角色 1 行
    // 同时建立 id→name 映射，供 timelineText 解析 character_ids
    const charNameMap = new Map<string, string>();
    const displayChars = characters.filter(c => c.zone !== "locked");
    for (const c of displayChars) charNameMap.set(c.id, c.name);
    const charactersText = displayChars.length > 0
        ? displayChars.map(c => {
            const parts: string[] = [`· ${c.name}`];
            if (c.personality) parts.push(`性格：${c.personality}`);
            if (c.voice_style) parts.push(`语气：${c.voice_style}`);
            if (c.ability) parts.push(`能力：${c.ability}`);
            if (c.arc) parts.push(`成长线：${c.arc}`);
            if (c.flaw) parts.push(`缺陷：${c.flaw}`);
            return parts.join(" / ");
        }).join("\n")
        : "暂无角色档案";

    // 待回收伏笔：仅 pending 且窗口内（expected <= chapterNumber+2）
    const foreshadowsText = foreshadows.length > 0
        ? foreshadows.map(f => `· [${f.priority}] ${f.description}（第${f.planted_chapter}章埋，计划第${f.expected_resolve_chapter}章回收）`).join("\n")
        : "暂无待回收伏笔";

    const timelineText = buildTimelineText(timeline, chapterId, charNameMap);

    const prompt = `你是一个严格的文学质量检查官。对照以下标准，检查本章内容是否存在问题。

【故事圣经铁则（不可违反）】
${bibleText}

【主阶段（检查阶段越界）】
${stagesText}

【锁定事件（本章 ±2 章范围内必须遵守）】
${lockedText}

【风格指南】
${styleText}

【角色档案（character 维度的判断基准）】
${charactersText}

【待回收伏笔（foreshadow 维度的判断基准）】
${foreshadowsText}

【前情摘要】
${prevSummaryText(prevSummaries)}

【时间线节点（必须遵守）】
${timelineText}

【本章内容（第${chapterNumber}章${chunkLabel}）】
${chapterContent}

请严格按以下 JSON 格式输出（放在 ---QUALITY_CHECK--- 块中），不要有任何额外文字：

---QUALITY_CHECK---
[
  {
    "type": "bible|character|foreshadow|plot_logic|timeline",
    "severity": "pass|warning|error",
    "message": "检查项描述（简短标题）",
    "detail": "详细说明，必须包含具体引用的原文内容",
    "quote": "引起问题的原文片段（原文原句，不可省略）",
    "location": "问题出现在文中的位置（如「第3段」「开头」「中部」「结尾」等）"
  }
]
---END_QUALITY_CHECK---

检查要点：
- bible: 是否违反铁则（角色泄密/灵力耗尽/越阶修炼等）；是否违反锁定事件；本章号是否落在某个主阶段范围内
- character: 对照【角色档案】，角色性格/语气/能力是否漂移（突然变冷淡/温柔/冲动）
- foreshadow: 对照【待回收伏笔】清单，本章应回收的伏笔是否真的回收
- plot_logic: 是否与前面章节存在逻辑矛盾（死者复活/道具消失/能力突变等）
- timeline:
  · 本章是否应推进到某个时间线节点（linked_chapter_id 命中本章）但未推进
  · must_achieve 列表中标记为本章必须达成的剧情是否真的达成
  · 时间顺序是否错乱（本章提前使用了后续节点的事件，或回退到已发生节点之前的状态）
  · 角色是否出现在了未到场的节点（出场角色不在节点 character_ids 名单内）
- 如果该项无问题，severity 填 "pass"
- **必须引用原文**：quote 字段填原文原句，detail 解释为什么这是问题
- **必须标注位置**：location 描述问题在文中哪里`;

    try {
        const res = await api.aiComplete({
            action: "chat", entity_type: "chapter", entity_id: "",
            extra: {
                system_hint: "你是一个严格的文学质量检查官。只输出 JSON，不要额外文字。每个问题必须带 quote（原文引用）和 location（位置）。",
                user_message: prompt, history: [], context: "",
            },
        });

        if (!res.content || res.error) {
            return [{ type: "plot_logic", severity: "error", message: "[系统] 质量检查失败", detail: res.error || "AI 无响应" }];
        }

        const m = res.content.match(/---QUALITY_CHECK---\s*([\s\S]*?)\s*---END_QUALITY_CHECK---/);
        if (!m) {
            return [{ type: "plot_logic", severity: "error", message: "[系统] 质量检查格式错误", detail: "AI 未按指定格式输出" }];
        }

        const items = JSON.parse(m[1]) as QualityCheckItem[];
        return items;
    } catch (e) {
        return [{ type: "plot_logic", severity: "error", message: "[系统] 质量检查失败", detail: e instanceof Error ? e.message : String(e) }];
    }
}

/** 构造时间线节点上下文文本（按 sort_order 排序，限制数量避免 token 超限）
 *  - chapterId 命中 linked_chapter_id 时，取该节点 ±5 范围
 *  - 未命中时，取前 MAX_TIMELINE_NODES_IN_PROMPT 个
 *  - character_ids 解析为角色名（用 charNameMap），便于 AI 与正文对照
 */
function buildTimelineText(timeline: TimelineNode[], chapterId: string, charNameMap: Map<string, string>): string {
    if (!timeline || timeline.length === 0) return "暂无时间线节点";
    const sorted = timeline.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    // 找到 linked_chapter_id 命中本章的节点索引
    const currentIdx = chapterId
        ? sorted.findIndex(n => n.linked_chapter_id === chapterId)
        : -1;
    let picked: TimelineNode[];
    if (currentIdx >= 0) {
        const start = Math.max(0, currentIdx - 5);
        const end = Math.min(sorted.length, currentIdx + 6);
        picked = sorted.slice(start, end);
    } else {
        picked = sorted.slice(0, MAX_TIMELINE_NODES_IN_PROMPT);
    }
    return picked.map(n => {
        const linked = n.linked_chapter_id ? `（绑定章节ID: ${n.linked_chapter_id}）` : "";
        const charNames = (n.character_ids || [])
            .map(id => charNameMap.get(id) || id)
            .filter(Boolean);
        const chars = charNames.length > 0 ? `\n  出场角色: ${charNames.join("、")}` : "";
        const must = n.must_achieve && n.must_achieve.length > 0 ? `\n  必须达成: ${n.must_achieve.join("；")}` : "";
        return `· [${n.type}] ${n.title}${linked} — ${n.summary || ""}${chars}${must}`;
    }).join("\n");
}

// ===== 辅助加载 =====

async function loadStoryBible(projectId: string): Promise<StoryBible | null> {
    try { return await api.getStoryBible(projectId); } catch { return null; }
}

async function loadStyleGuide(projectId: string): Promise<StyleGuide | null> {
    try { return await api.getStyleGuide(projectId); } catch { return null; }
}

/** 加载展示区角色档案（与上下文引擎口径一致，过滤 locked 区） */
async function loadCharacters(projectId: string): Promise<Character[]> {
    try {
        const all = await api.listCharacters(projectId);
        return (all || []).filter(c => c.zone !== "locked");
    } catch { return []; }
}

/** 加载本章应回收的伏笔：status=pending 且 expected_resolve_chapter <= chapterNumber+2
 *  返回结果按 expected_resolve_chapter 升序，供 prompt 直读 */
function loadForeshadows(projectId: string, chapterNumber: number): ForeshadowEntry[] {
    try {
        const logKey = `novel-workbench-log-${projectId}`;
        const logStore = getJSONSync<any>(logKey, {} as any);
        const all: ForeshadowEntry[] = logStore?.foreshadows || [];
        return all
            .filter(f => f.status === "pending" && (f.expected_resolve_chapter || 0) <= chapterNumber + 2)
            .sort((a, b) => (a.expected_resolve_chapter || 0) - (b.expected_resolve_chapter || 0));
    } catch { return []; }
}

/** 加载前情摘要：默认 PREV_SUMMARIES_WINDOW 章；若存在早于窗口且本章附近待回收的 critical/important 伏笔，
 *  则扩展窗口到该伏笔的 planted_chapter（上限 PREV_SUMMARIES_HARD_CAP 章），保证跨长跨度伏笔回收有依据。
 *  字段全量拼接（key_characters/advanced_storylines/planted_foreshadow），供 plot_logic 与 foreshadow 维度对照。
 */
async function loadPrevSummaries(projectId: string, chapterNumber: number): Promise<string> {
    try {
        const summaries = await api.getChapterSummaries(projectId);
        const prev = summaries
            .filter(s => s.chapter_number < chapterNumber)
            .sort((a, b) => a.chapter_number - b.chapter_number);
        if (prev.length === 0) return "";

        // 计算窗口下界（默认 PREV_SUMMARIES_WINDOW）
        let windowStart = Math.max(0, prev.length - PREV_SUMMARIES_WINDOW);

        // 检查 LogStore 中是否存在早于窗口下界、且本章附近待回收的 critical/important 伏笔
        try {
            const logKey = `novel-workbench-log-${projectId}`;
            const logStore = getJSONSync<any>(logKey, {} as any);
            const foreshadows: ForeshadowEntry[] = logStore?.foreshadows || [];
            const earliestNeeded = foreshadows
                .filter(f =>
                    f.status === "pending"
                    && (f.priority === "critical" || f.priority === "important")
                    && (f.expected_resolve_chapter || 0) >= chapterNumber - 2
                    && (f.expected_resolve_chapter || 0) <= chapterNumber + 2
                    && (f.planted_chapter || 0) < prev[windowStart]?.chapter_number
                )
                .reduce((min, f) => Math.min(min, f.planted_chapter || 0), Number.MAX_SAFE_INTEGER);
            if (earliestNeeded !== Number.MAX_SAFE_INTEGER) {
                // 找到 planted_chapter 对应的 prev 索引，扩展窗口
                const idx = prev.findIndex(s => s.chapter_number >= earliestNeeded);
                if (idx >= 0 && idx < windowStart) {
                    // 兜底：扩展后的窗口不超过 PREV_SUMMARIES_HARD_CAP 章
                    const hardStart = Math.max(0, prev.length - PREV_SUMMARIES_HARD_CAP);
                    windowStart = Math.max(idx, hardStart);
                }
            }
        } catch { /* foreshadows 读取失败不影响 summaries */ }

        return prev.slice(windowStart)
            .map(s => {
                const parts = [`第${s.chapter_number}章：${s.summary || ""}`];
                if (s.key_characters?.length) parts.push(`  角色：${s.key_characters.join("、")}`);
                if (s.advanced_storylines?.length) parts.push(`  推进：${s.advanced_storylines.join("；")}`);
                if (s.planted_foreshadow?.length) parts.push(`  埋伏笔：${s.planted_foreshadow.join("；")}`);
                return parts.join("\n");
            })
            .join("\n");
    } catch { return ""; }
}

async function loadTimelineNodes(projectId: string): Promise<TimelineNode[]> {
    try { return await api.listTimelineNodes(projectId); } catch { return []; }
}

function prevSummaryText(summaries: string): string {
    return summaries || "（首章，无前情）";
}
