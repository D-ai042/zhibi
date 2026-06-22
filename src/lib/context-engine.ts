/**
 * 上下文引擎 —— 上下文组装器
 *
 * 每次 AI 写作请求前，从知识库和日志库中取出相关内容，
 * 按优先级 P0-P3 分层组装：
 *
 * P0（世界观背景）：世界设定 + 铁则，不可违反
 * P1（剧情走向）：当前卷细纲（±3）+ 前情摘要 + 明暗线
 * P2（风格指南）：叙述风格 / 文笔基调 / 写作红线
 * P3（角色池）：三层调度（活跃完整卡 + 关系 + 全量名册）
 *
 * v2.0 新增模块感知上下文 buildModuleContext()：
 *   根据用户当前所处的模块，按需组装最相关的数据，
 *   而非无差别全量 dump。
 */

import { api } from "./api";
import { getJSONSync } from "./storage";
import { loadAllChapters } from "./chapter-store";
import { reportDiagnostic } from "./diagnostics";
import type {
    BeatCard,
    Chapter,
    ChapterSummary,
    Character,
    CharacterState,
    ContextEngineOutput,
    ContextPanelData,
    ForeshadowEntry,
    PlotSegmentData,
    RelationshipEdge,
    StoryBible,
    StorylineProgress,
    StyleGuide,
    WorldTerm,
} from "@/types";

// ===== 接口定义 =====

export interface ContextEngineInput {
    projectId: string;
    chapterId: string;
    userIntent?: never;
}

/** 聊天上下文参数 — 模块感知 */
export interface ChatContextInput {
    projectId: string;
    module: "worldview" | "characters" | "plot-direction" | "writing" | "story-bible" | "chat";
    section?: string;
    chapterId?: string;
    entityId?: string;
}

// ===== 常量 =====

const MAX_TOKENS = 40_000;
/** 安全缓冲：实际使用上限设为 MAX_TOKENS - 2K，防止溢出 */
const EFFECTIVE_MAX_TOKENS = MAX_TOKENS - 2_000;

/** 世界观词条类型标签（T5 去重：原 3 处内联定义合并） */
const TYPE_LABEL: Record<string, string> = { rule: "规则", faction: "势力", place: "地点", item: "道具", system: "制度", other: "其他" };

/** 从 novel-workbench-mock 中读取项目世界观词条 */
function loadWorldTerms(projectId: string): any[] {
    try {
        const mock = getJSONSync('novel-workbench-mock', {} as Record<string, any>);
        return (mock.worldTerms || []).filter((t: any) => t.project_id === projectId);
    } catch { return []; }
}

export function estimateTokens(text: string): number {
    let t = 0;
    for (const ch of text) {
        if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
            t += 2;
        } else {
            t += 0.5;
        }
    }
    return Math.ceil(t);
}

// ===== 聊天上下文（模块感知 v2.0） =====

/**
 * 按模块组装上下文 —— AI 根据用户当前所在模块收到最相关的数据。
 *
 * worldview     → 全部词条 + 编组 + 连线
 * characters    → 全部角色 + 关系网
 * plot-direction → 全部明暗线 + 连线 + 时间轴
 * writing       → P0-P4 + 本章正文 + 节拍卡片（完整写作上下文）
 * story-bible   → 风格指南 + 铁则 + 版本记录
 * chat(默认)    → 全量概要（保留当前行为）
 */
export async function buildModuleContext(input: ChatContextInput): Promise<string> {
    const { projectId, module: mod, chapterId } = input;

    // 所有模块都需要的基础数据
    const [allCharacters, allWorldTerms, allEdges, styleGuide, storyBible] = await Promise.all([
        api.listCharacters(projectId),
        api.listWorldTerms(projectId),
        api.listRelationshipEdges(projectId).catch(() => [] as RelationshipEdge[]),
        loadStyleGuide(projectId),
        loadStoryBible(projectId),
    ]);

    const parts: string[] = ["===== 📖 项目数据上下文 ====="];

    // P0 所有模块都带（铁则不可省略）
    const p0 = assembleP0(projectId, styleGuide, storyBible, allWorldTerms, undefined);
    parts.push(p0);

    // ===== 按模块分派 =====
    if (mod === "worldview") {
        // 世界观：强调词条，弱化角色
        if (allWorldTerms.length > 0) {
            parts.push("\n===== 🌍 全部世界观词条 =====");
            for (const t of allWorldTerms) {
                parts.push(`· [${TYPE_LABEL[t.term_type] || t.term_type}] ${t.title}：${t.one_liner || ""}`);
                if (t.detail) parts.push(`  ${t.detail.slice(0, 120)}`);
            }
        }
        // 词条关系连线
        try {
            const edgeKey = "worldview-edges-" + projectId;
            const edges = getJSONSync(edgeKey, [] as any[]);
            if (edges.length > 0) {
                parts.push("\n===== 🔗 词条关系连线 =====");
                const termMap = new Map(allWorldTerms.map(t => [t.id, t.title]));
                for (const e of edges.slice(0, 40)) {
                    const src = termMap.get(e.source) || e.source;
                    const tgt = termMap.get(e.target) || e.target;
                    parts.push(`· ${src} → ${tgt}`);
                }
            }
        } catch { /* ignore */ }

    } else if (mod === "characters") {
        // 人物关系：强调角色卡 + 关系网 + 快照系统说明
        if (allCharacters.length > 0) {
            parts.push("\n===== 👤 全部角色档案 =====");
            for (const c of allCharacters) {
                const fields: string[] = [c.name];
                if (c.faction) fields.push(`【${c.faction}】`);
                if (c.age) fields.push(`${c.age}岁`);
                if (c.personality) fields.push(`性格：${c.personality}`);
                if (c.appearance) fields.push(`外貌：${c.appearance.slice(0, 60)}`);
                if (c.ability) fields.push(`能力：${c.ability.slice(0, 60)}`);
                if (c.background) fields.push(`背景：${c.background.slice(0, 80)}`);
                // 展示已有快照
                if (c.snapshots?.length) {
                    const snapAges = c.snapshots.map(s => `${s.age}岁`).join("、");
                    fields.push(`[已有快照: ${snapAges}]`);
                }
                parts.push(`· ${fields.join(" ")}`);
            }
        }
        // 关系网
        if (allEdges.length > 0) {
            parts.push("\n===== 🔗 人物关系网 =====");
            const charMap = new Map(allCharacters.map(c => [c.id, c.name]));
            for (const e of allEdges) {
                const srcName = charMap.get(e.source_id) || "未知";
                const tgtName = charMap.get(e.target_id) || "未知";
                parts.push(`· ${srcName} → ${tgtName} [${e.relation_type}] 亲密度: ${e.strength}/10${e.is_secret ? " (秘密)" : ""}`);
            }
        }
        // 快照系统使用说明
        parts.push("\n===== 📸 角色快照系统 =====");
        parts.push("角色卡支持「年龄快照」——同一个角色在不同年龄有不同的性格/能力/外貌。");
        parts.push("用户要求「创建 XX 岁的角色卡」时，**不要**覆盖原角色，而是输出 update_snapshot 指令。");
        parts.push("");
        parts.push("格式（放在 ---CHARACTERS--- 块中）：");
        parts.push(`{"action":"update_snapshot","name":"角色名","changes":{"age":"30","personality":"新性格","ability":"新能力","appearance":"新外貌"}}`);
        parts.push("");
        parts.push("规则：");
        parts.push("· 只在 changes 中写**变化的字段**，未变的字段不要写");
        parts.push("· age 字段**必须**写在 changes 里（表示快照对应的年龄）");
        parts.push("· 如果角色已有同年龄快照，会更新而非重复创建");
        parts.push("· 如果要求创建**新角色**（不是已有角色），才用 create_character");

    } else if (mod === "plot-direction") {
        // 剧情走向：明暗线 + 连线 + 时间轴
        try {
            const segs = getJSONSync(`plot-segments-${projectId}`, [] as PlotSegmentData[]);
            const savedEdges = getJSONSync(`plot-edges-${projectId}`, [] as PlotSegmentData[]);
            const bright = segs.filter((s: any) => s.type === "bright");
            const dark = segs.filter((s: any) => s.type === "dark");

            if (bright.length > 0) {
                parts.push("\n===== ☀️ 明线段落 =====");
                for (const s of bright) parts.push(`· 「${s.title}」${s.event ? `：${s.event}` : ""}${s.characters ? `\n  角色：${s.characters}` : ""}${s.location ? ` 地点：${s.location}` : ""}`);
            }
            if (dark.length > 0) {
                parts.push("\n===== 🌑 暗线段落 =====");
                for (const s of dark) parts.push(`· 「${s.title}」${s.event ? `：${s.event}` : ""}${s.characters ? `\n  角色：${s.characters}` : ""}${s.location ? ` 地点：${s.location}` : ""}`);
            }
            if (savedEdges.length > 0) {
                const segMap = new Map(segs.map((s: any) => [s.id, s.title]));
                parts.push("\n===== 🔗 段落关系 =====");
                for (const e of savedEdges.slice(0, 30)) {
                    const src = segMap.get(e.source) || "?";
                    const tgt = segMap.get(e.target) || "?";
                    parts.push(`· ${src} → ${tgt}`);
                }
            }
        } catch { parts.push("\n（剧情走向读取失败）"); }

    } else if (mod === "writing" && chapterId) {
        // 写作台：完整 P0-P4 + 本章正文
        const plotChapter = findChapterFromPlotChapters(projectId, chapterId);
        const [chapters] = await Promise.all([
            api.listChapters(projectId),
        ]);
        const currentChapter = plotChapter
            ? { id: plotChapter.id, number: plotChapter.number, title: plotChapter.title, volume_id: "" } as Chapter
            : chapters.find((c) => c.id === chapterId);
        const volumeName = plotChapter?.volumeName || "";
        const recentSummaries = await loadRecentSummaries(projectId, currentChapter);
        const logStore = getLogStoreV2(projectId);

        const p1 = assembleP1(projectId, recentSummaries, currentChapter?.number);
        const p2 = assembleP2(styleGuide, projectId);
        const p3 = assembleP3(allCharacters, currentChapter?.number || 1, allEdges, logStore);
        parts.push(p1, p2, p3);

    } else if (mod === "story-bible") {
        // 故事圣经：风格指南 + 铁则 + 版本
        if (styleGuide) {
            parts.push("\n===== 📝 风格指南 =====");
            if (styleGuide.narrative_style) parts.push(`叙述风格：${styleGuide.narrative_style}`);
            if (styleGuide.writing_tone) parts.push(`文笔基调：${styleGuide.writing_tone}`);
            if (styleGuide.writing_rules) parts.push(`写作红线：${styleGuide.writing_rules}`);
        }
        if (storyBible) {
            if (storyBible.inviolable_rules?.length) {
                parts.push("\n===== 🛡️ 不可违背铁则 =====");
                for (const r of storyBible.inviolable_rules) parts.push(`· ${r}`);
            }
            if (storyBible.main_stages?.length) {
                parts.push("\n===== 📊 故事主要阶段 =====");
                for (const s of storyBible.main_stages) parts.push(`· 第${s.chapter_range[0]}-${s.chapter_range[1]}章「${s.name}」：${s.description || ""}`);
            }
            if (storyBible.locked_events?.length) {
                parts.push("\n===== 🔒 已锁定事件 =====");
                for (const e of storyBible.locked_events) parts.push(`· 第${e.chapter}章「${e.title}」：${e.description}`);
            }
        }
        // voice_style 随 P3 角色池完整卡按需发送，此处不再全量加载

    } else {
        // chat(默认)：全量概要（保留当前行为）
        if (allCharacters.length > 0) {
            parts.push("\n===== 项目角色一览 =====");
            for (const c of allCharacters.slice(0, 30)) {
                parts.push(`· ${c.name}${c.faction ? `（${c.faction}）` : ""}${c.personality ? `：${c.personality}` : ""}`);
            }
            if (allCharacters.length > 30) parts.push(`...还有 ${allCharacters.length - 30} 个角色`);
        }
        if (allEdges.length > 0) {
            parts.push("\n===== 人物关系一览 =====");
            const charMap = new Map(allCharacters.map(c => [c.id, c.name]));
            for (const e of allEdges.slice(0, 30)) {
                const srcName = charMap.get(e.source_id) || "未知";
                const tgtName = charMap.get(e.target_id) || "未知";
                parts.push(`· ${srcName} → ${tgtName} [${e.relation_type}] 亲密度: ${e.strength}/10${e.is_secret ? " (秘密)" : ""}`);
            }
            if (allEdges.length > 30) parts.push(`...还有 ${allEdges.length - 30} 条关系`);
        }
        if (allWorldTerms.length > 0) {
            parts.push("\n===== 世界观设定一览 =====");
            for (const t of allWorldTerms.slice(0, 30)) {
                parts.push(`· [${TYPE_LABEL[t.term_type] || t.term_type}] ${t.title}：${t.one_liner || "（待补充）"}`);
            }
            if (allWorldTerms.length > 30) parts.push(`...还有 ${allWorldTerms.length - 30} 个词条`);
        }
    }

    return parts.join("\n");
}

/** 获取指定章节的详细内容（直接从 mock 数据读取，保证在开发模式可用） */
export async function buildChapterContext(projectId: string, chapterRange: string): Promise<string> {
    const parts: string[] = [];

    // 解析范围
    let startCh = 1, endCh = 1;
    const rm = chapterRange.match(/(\d+)\s*-\s*(\d+)/);
    const sm = chapterRange.match(/^(\d+)$/);
    if (rm) { startCh = parseInt(rm[1]); endCh = parseInt(rm[2]); }
    else if (sm) { startCh = endCh = parseInt(sm[1]); }

    // ====== 唯一数据源: chapter-store（写作台卷章树，逐章存储）=======
    let plotChapters: any[] = [];
    try {
        plotChapters = loadAllChapters(projectId);
    } catch { /* ignore */ }

    // 按范围过滤
    const matched = plotChapters
        .filter((ch: any) => ch.number >= startCh && ch.number <= endCh)
        .sort((a: any, b: any) => a.number - b.number);

    if (matched.length === 0) {
        return `📖 请求查看第 ${startCh}-${endCh} 章，但写作台中无此章节数据。写作台中共有 ${plotChapters.length} 章。`;
    }

    parts.push(`📖 第 ${startCh}-${endCh} 章详情（来自写作台，共 ${matched.length} 章）`);
    for (const ch of matched) {
        parts.push(`\n【第 ${ch.number} 章「${ch.title}」】`);
        const body = (ch.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
        if (body) {
            parts.push(`正文（前500字）：${body.slice(0, 500)}...`);
        } else {
            parts.push('（暂无正文内容）');
        }
    }

    return parts.join('\n');
}

/** 保留旧接口兼容（调用模块感知上下文，默认 chat 模式） */
export async function buildChatContext(projectId: string): Promise<string> {
    return buildModuleContext({ projectId, module: "chat" });
}

// ===== 章节上下文（P0-P4 新结构） =====

/** 从 plot-chapters（写作台卷章树）读取章节，这是章节数据的唯一真实来源 */
function findChapterFromPlotChapters(projectId: string, chapterId: string): { id: string; number: number; title: string; volumeName: string } | null {
    try {
        const chapters = loadAllChapters(projectId);
        if (!chapters || chapters.length === 0) return null;
        const ch = chapters.find((c: any) => c.id === chapterId);
        if (!ch) return null;
        // 从剧情走向中找卷名
        let volumeName = "";
        try {
            const segs = getJSONSync(`plot-segments-${projectId}`, [] as any[]);
            const seg = segs.find((s: any) => s.id === ch.volumeSegmentId);
            if (seg) volumeName = seg.title;
        } catch { /* ignore */ }
        return { id: ch.id, number: ch.number, title: ch.title, volumeName };
    } catch {
        return null;
    }
}

/** T5 统一上下文组装入口 —— 替代 buildProjectContext + loadContextPanelData */
export async function assembleContext(
    projectId: string,
    chapterId: string,
    mode: "panel" | "ai",
): Promise<ContextEngineOutput | ContextPanelData> {
    const plotChapter = findChapterFromPlotChapters(projectId, chapterId);
    const chapterNumber = plotChapter?.number || 1;

    if (mode === "panel") {
        const [summaries, beatCards, styleGuide] = await Promise.all([
            api.getChapterSummaries(projectId).catch(() => [] as ChapterSummary[]),
            api.listBeatCards(chapterId).catch(() => [] as BeatCard[]),
            api.getStyleGuide(projectId).catch(() => null as StyleGuide | null),
        ]);

        const panelData: ContextPanelData = {
            summaries: summaries.filter(s => s.chapter_number < chapterNumber && s.chapter_number >= chapterNumber - 5)
                .sort((a, b) => a.chapter_number - b.chapter_number),
            beatCards,
            characters: [],
            prevContent: null,
            worldRules: [],
            styleRedlines: styleGuide?.writing_rules || "",
            styleNarrative: styleGuide?.narrative_style || "",
            styleTone: styleGuide?.writing_tone || "",
        };

        // 加载活跃角色状态
        try {
            const logStore = getLogStoreV2(projectId);
            const states = logStore.characterStates || [];
            const active = states.filter(s => s.last_active_chapter >= chapterNumber - 10);
            panelData.characters = active.map(s => ({ name: s.character_name, status: s.current_status }));
        } catch { /* ignore */ }

        // 加载世界观规则词条
        try {
            const allTerms = await api.listWorldTerms(projectId);
            const rules = allTerms.filter(t => t.term_type === "rule").map(t => `· ${t.title}：${t.one_liner || ""}`);
            panelData.worldRules = rules.slice(0, 8);
        } catch { /* ignore */ }

        // 加载前一章内容后 3000 字
        try {
            const allChapters = loadAllChapters(projectId);
            const prev = allChapters.find((ch: any) => ch.number === chapterNumber - 1);
            if (prev?.content) {
                const clean = prev.content.replace(/<[^>]+>/g, "").trim();
                if (clean) {
                    panelData.prevContent = { number: prev.number, title: prev.title || "", content: clean.slice(-3000) };
                }
            }
        } catch { /* ignore */ }

        return panelData;
    }

    // mode === "ai" → 调用原有 buildProjectContext
    return buildProjectContext({ projectId, chapterId });
}

async function buildProjectContext(input: ContextEngineInput): Promise<ContextEngineOutput> {
    const { projectId, chapterId } = input;

    // 直接从 plot-chapters（写作台卷章树）找当前章节，确保能找到
    const plotChapter = findChapterFromPlotChapters(projectId, chapterId);
    // 同时从 api 加载完整的章节列表（用于统计总章数等）
    const [chapters, allCharacters, allWorldTerms, styleGuide, storyBible, allEdges] = await Promise.all([
        api.listChapters(projectId),
        api.listCharacters(projectId),
        api.listWorldTerms(projectId),
        loadStyleGuide(projectId),
        loadStoryBible(projectId),
        api.listRelationshipEdges(projectId).catch(() => [] as RelationshipEdge[]),
    ]);

    // 以 plot-chapters 为准构建 currentChapter
    const currentChapter = plotChapter ? { id: plotChapter.id, number: plotChapter.number, title: plotChapter.title, volume_id: "" } as Chapter : chapters.find((c) => c.id === chapterId);
    const volumeName = plotChapter?.volumeName || "";
    const recentSummaries = await loadRecentSummaries(projectId, currentChapter);
    const logStore = getLogStoreV2(projectId);

    // P0: 世界观背景（上限 20 条 600 字，规则优先）
    const p0 = assembleP0(projectId, styleGuide, storyBible, allWorldTerms, currentChapter?.number);
    // P1: 剧情走向 + 前情摘要（±3 细纲，beat.chapters 精确映射）
    const p1 = assembleP1(projectId, recentSummaries, currentChapter?.number);
    // P2: 风格指南（voice_style 随 P3 按需发送）
    const p2 = assembleP2(styleGuide, projectId);
    // P3: 角色池（三层调度：活跃完整卡 + 关系 + 全量名册）
    const p3 = assembleP3(allCharacters, currentChapter?.number || 1, allEdges, logStore);

    // P4: 前一章正文（后段优先，token 预算弹性分配）
    const p4 = assembleP4(projectId, currentChapter?.number || 1);

    // FUNC-9: 伏笔回收提醒
    const foreshadowReminder = assembleForeshadowReminders(projectId, currentChapter?.number || 1);

    const layers: Record<string, string> = { p0, p1, p2, p3, p4 };
    const { text: clippedText, omitted } = enforceTokenBudget({ ...layers }, EFFECTIVE_MAX_TOKENS);

    // 将伏笔提醒追加到 P1 之后（不受裁剪影响，因为它是简短提醒）
    const finalHint = clippedText + foreshadowReminder;

    // 提取关键词用于过滤
    const keywords = extractKeywords([], currentChapter);
    const activeTerms = filterWorldTerms(allWorldTerms, keywords);

    return {
        systemHint: finalHint,
        layers: { p0, p1, p2, p3, p4 },
        totalTokens: estimateTokens(clippedText),
        omitted,
        characters: allCharacters.map((c) => c.name),
        worldTerms: activeTerms.slice(0, 5).map((t) => t.title),
        summaries: recentSummaries.map((s) => s.summary),
    };
}

// ===== 工具函数 =====

function extractKeywords(_beatCards: any[], currentChapter?: Chapter): string[] {
    const keywords: string[] = [];
    if (currentChapter?.title) {
        keywords.push(currentChapter.title);
    }
    return keywords;
}

function filterWorldTerms(allTerms: WorldTerm[], keywords: string[]): WorldTerm[] {
    if (keywords.length === 0 || !keywords[0]) return allTerms.slice(0, 10);
    const kw = keywords[0];
    const matched = allTerms.filter(t => t.title.includes(kw) || t.one_liner?.includes(kw));
    return matched.length > 0 ? matched.slice(0, 5) : allTerms.slice(0, 5);
}

async function loadStyleGuide(projectId: string): Promise<StyleGuide | null> {
    try { return await api.getStyleGuide(projectId); } catch { return null; }
}

async function loadStoryBible(projectId: string): Promise<StoryBible | null> {
    try { return await api.getStoryBible(projectId); } catch { return null; }
}

async function loadRecentSummaries(projectId: string, currentChapter?: Chapter): Promise<ChapterSummary[]> {
    if (!currentChapter) return [];
    try {
        let all = await api.getChapterSummaries(projectId);
        // 防御：EXE 模式可能返回整个 log store 对象，提取 summaries 字段
        if (!Array.isArray(all)) {
            all = Array.isArray(all) ? all : (all as Record<string, unknown>)?.summaries as ChapterSummary[] || [];
        }
        const before = all.filter((s: any) => s.chapter_number < currentChapter.number).sort((a: any, b: any) => b.chapter_number - a.chapter_number).slice(0, 5);
        return before.reverse();
    } catch { return []; }
}

// ===== P0：世界观背景 =====

function assembleP0(projectId: string, _styleGuide: StyleGuide | null, storyBible: StoryBible | null, worldTerms: WorldTerm[], currentChapterNumber?: number): string {
    const parts: string[] = ["━━━━ P0 · 世界观背景（不可违反） ━━━━"];

    // 世界观词条（优先使用已传入的参数，兼容 localStorage 回退）
    const terms = worldTerms.length > 0 ? worldTerms : loadWorldTerms(projectId);
    if (terms.length > 0) {
        // 筛选逻辑：rule 类型全部保留 + termActivity 中 active 的
        const activeTermIds = new Set<string>();
        const logStore = getLogStoreV2(projectId);
        const termActivity = logStore.termActivity || [];

        // 所有 rule 类型无条件加载
        for (const t of terms) {
            if (t.term_type === "rule") activeTermIds.add(t.id);
        }

        // 第一章保底：按当前 beat 的 characters / location 匹配词条 title
        if (currentChapterNumber) {
            const termActivityForChapter = termActivity.filter(e => e.activeForChapter === currentChapterNumber);
            if (termActivityForChapter.length > 0) {
                for (const a of termActivityForChapter) {
                    if (a.status === "active") activeTermIds.add(a.termId);
                }
            } else {
                // 无 termActivity（第一章或尚未评估）：用 beat 直接引用的词条兜底
                try {
                    const chaps = loadAllChapters(projectId);
                    const segs = getJSONSync(`plot-segments-${projectId}`, [] as PlotSegmentData[]);
                    const currentChap = chaps.find((c: any) => c.number === currentChapterNumber);
                    if (currentChap) {
                        const vol = segs.find((s) => s.id === currentChap.volumeSegmentId && s.type === "bright");
                        if (vol) {
                            const volChaps = chaps.filter((c: any) => c.volumeSegmentId === vol.id).sort((a: any, b: any) => a.number - b.number);
                            const idxInVol = volChaps.findIndex((c: any) => c.id === currentChap.id);
                            const beats = vol.beats || [];
                            const beat = beats.find((b: any) => b.number === idxInVol + 1);
                            if (beat) {
                                for (const t of terms) {
                                    if (beat.characters?.includes(t.title) || beat.location?.includes(t.title)) {
                                        activeTermIds.add(t.id);
                                    }
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }
            }
        }

        const filtered = terms.filter(t => activeTermIds.has(t.id));
        const MAX_TERMS = 20;
        const MAX_CHARS = 600;

        if (filtered.length > 0) {
            // 优先级：rule 无条件最高优，其余按原筛选
            const prioritized = [
                ...filtered.filter(t => t.term_type === "rule"),
                ...filtered.filter(t => t.term_type !== "rule"),
            ].slice(0, MAX_TERMS);

            parts.push("【世界设定】");
            let charCount = 0;
            let shown = 0;
            for (const t of prioritized) {
                const line = `· [${TYPE_LABEL[t.term_type] || t.term_type}] ${t.title}：${(t.one_liner || "").slice(0, 30)}`;
                if (charCount + line.length > MAX_CHARS) {
                    parts.push(`...（还有 ${prioritized.length - shown} 条，已省略）`);
                    break;
                }
                parts.push(line);
                charCount += line.length;
                shown++;
            }
            if (terms.length > shown) parts.push(`...共 ${terms.length} 个词条，本处展示 ${shown} 条`);
        } else {
            // 筛选后为空，兜底展示前 MAX_TERMS 条（规则优先）
            const prioritized = [
                ...terms.filter(t => t.term_type === "rule"),
                ...terms.filter(t => t.term_type !== "rule"),
            ].slice(0, MAX_TERMS);
            parts.push("【世界设定】");
            let charCount = 0;
            let shown = 0;
            for (const t of prioritized) {
                const line = `· [${TYPE_LABEL[t.term_type] || t.term_type}] ${t.title}：${(t.one_liner || "").slice(0, 30)}`;
                if (charCount + line.length > MAX_CHARS) {
                    parts.push(`...（还有 ${prioritized.length - shown} 条，已省略）`);
                    break;
                }
                parts.push(line);
                charCount += line.length;
                shown++;
            }
            parts.push(`（共 ${terms.length} 个词条，尚未评估相关性，展示 ${shown} 条）`);
        }
        parts.push("");
    }

    // 故事铁则
    if (storyBible) {
        if (storyBible.worldview_rules?.length) {
            parts.push("【世界观铁律】");
            for (const r of storyBible.worldview_rules) parts.push(`· ${r}`);
            parts.push("");
        }
    }

    if (parts.length === 1) parts.push("（世界观设定未填写，请到大纲模块补充）");
    return parts.join("\n");
}

// ===== P1：剧情走向 + 前情摘要 =====

/** 解析章节范围字符串如 "1-3" 或 "4,7-9" 为数字数组 */
export function parseChapterRange(range: string): number[] {
    const nums: number[] = [];
    if (!range) return nums;
    const parts = range.split(/[,，]/);
    for (const p of parts) {
        const m = p.match(/(\d+)\s*[-−–—]\s*(\d+)/);
        if (m) {
            for (let i = parseInt(m[1]); i <= parseInt(m[2]); i++) nums.push(i);
        } else {
            const n = parseInt(p);
            if (!isNaN(n)) nums.push(n);
        }
    }
    return nums;
}

function assembleP1(projectId: string, recentSummaries: ChapterSummary[], currentChapterNumber?: number): string {
    const parts: string[] = ["━━━━ P1 · 剧情走向与前情摘要 ━━━━"];
    try {
        const segs = getJSONSync(`plot-segments-${projectId}`, [] as PlotSegmentData[]);
        const chaps = loadAllChapters(projectId);
        if (segs.length > 0) {
            // 如果知道当前章节号，找到它所属的卷（bright segment）
            let currentVolId = "";
            if (currentChapterNumber) {
                const currentChap = chaps.find((c: any) => c.number === currentChapterNumber);
                if (currentChap) currentVolId = currentChap.volumeSegmentId;
            }

            const bright = segs.filter((s: any) => s.type === "bright");
            const dark = segs.filter((s: any) => s.type === "dark");

            // 当前卷：展示卷概要 + 全部细纲 + 标记当前章
            if (currentVolId) {
                const vol = bright.find((s: any) => s.id === currentVolId);
                if (vol) {
                    parts.push(`【当前卷 — ${vol.title}】`);
                    parts.push(`卷概要：${vol.characters ? `角色：${vol.characters}  ` : ""}${vol.location ? `地点：${vol.location}  ` : ""}${vol.time ? `时间：${vol.time}  ` : ""}${vol.chapters ? `章节范围：${vol.chapters}  ` : ""}${vol.event ? `事件：${vol.event}` : ""}`);
                    const beats = vol.beats || [];
                    if (beats.length > 0) {
                        // 卷内章节排序
                        const volChapsSorted = chaps
                            .filter((c: any) => c.volumeSegmentId === currentVolId)
                            .sort((a: any, b2: any) => a.number - b2.number);
                        // 找到当前章节对应的 beat（用 beat.chapters 精确匹配）
                        const currentChapInVol = currentChapterNumber
                            ? volChapsSorted.find(c => c.number === currentChapterNumber)
                            : null;
                        const currentBeatIdx = beats.findIndex(b => {
                            const bc = parseChapterRange(b.chapters || "");
                            return currentChapInVol ? bc.includes(currentChapInVol.number) : false;
                        });
                        const currentBeatNumber = currentBeatIdx >= 0 ? beats[currentBeatIdx].number : 0;

                        const RANGE = 3;
                        const startBeat = Math.max(1, currentBeatNumber - RANGE);
                        const endBeat = Math.min(beats.length > 0 ? beats[beats.length - 1].number : 1, currentBeatNumber + RANGE);

                        parts.push(`══════ 细纲（#${startBeat}-#${endBeat}，共 ${beats.length} 条）══════`);
                        if (startBeat > 1) parts.push(`...（#1-#${startBeat - 1} 已省略）`);

                        for (const b of beats) {
                            if (b.number < startBeat || b.number > endBeat) continue;
                            // 用 beat.chapters 精确匹配章节
                            const beatChapters = parseChapterRange(b.chapters || "");
                            const beatRelatedChaps = volChapsSorted.filter(c => beatChapters.includes(c.number));
                            const isWritten = beatRelatedChaps.length > 0 && beatRelatedChaps.every(c => c.content?.trim());
                            const isCurrent = beatRelatedChaps.some(c => c.number === currentChapterNumber);
                            let marker = "";
                            if (isCurrent) marker = "  ← 🔥 当前正在写的章";
                            else if (isWritten) marker = "  ✓";

                            const pieces = [`  #${b.number}「${b.title}」`];
                            if (b.characters) pieces.push(`\n    角色：${b.characters}`);
                            if (b.location) pieces.push(`\n    地点：${b.location}`);
                            if (b.time) pieces.push(`\n    时间：${b.time}`);
                            if (b.event) pieces.push(`\n    事件：${b.event}`);
                            if (b.chapters) pieces.push(`\n    章节：${b.chapters}`);
                            pieces.push(marker);
                            parts.push(pieces.join(""));
                        }

                        if (endBeat < (beats.length > 0 ? beats[beats.length - 1].number : 1))
                            parts.push(`...（#${endBeat + 1}-#${beats[beats.length - 1].number} 已省略）`);
                    } else {
                        parts.push(`· ${vol.event || "（暂无细纲）"}`);
                    }
                    parts.push("");
                }
            }

            // 其他卷：只展示卷概要（不展开细纲）
            const otherBright = currentVolId ? bright.filter((s: any) => s.id !== currentVolId) : bright;
            if (otherBright.length > 0) {
                if (currentVolId) parts.push("【其他卷】");
                else parts.push("【明线】");
                for (const s of otherBright) {
                    const segParts = [`· 「${s.title}」`];
                    if (s.characters) segParts.push(`  角色：${s.characters}`);
                    if (s.location) segParts.push(`  地点：${s.location}`);
                    if (s.time) segParts.push(`  时间：${s.time}`);
                    if (s.chapters) segParts.push(`  章节范围：${s.chapters}`);
                    if (s.event) segParts.push(`  事件：${s.event}`);
                    parts.push(segParts.join("\n"));
                }
            }
            if (dark.length > 0) {
                parts.push("【暗线】");
                for (const s of dark) parts.push(`· 「${s.title}」${s.event ? `：${s.event}` : ""}${s.chapters ? `\n   章节范围：${s.chapters}` : ""}`);
            }
        } else {
            parts.push("（剧情走向未设置，请到大纲·剧情走向中创建）");
        }
    } catch { parts.push("（剧情走向读取失败）"); }
    parts.push("");

    try {
        const bible = getJSONSync(`novel-workbench-bible-${projectId}`, null as StoryBible | null);
        if (bible) {
            if (bible.locked_events?.length > 0) {
                parts.push("【已锁定事件（不可提前/跳过）】");
                for (const e of bible.locked_events) parts.push(`· 第${e.chapter}章「${e.title}」：${e.description}`);
                parts.push("");
            }
        }
    } catch { /* ignore */ }

    // 前情摘要
    if (recentSummaries.length > 0) {
        parts.push(`【前 ${recentSummaries.length} 章剧情摘要】`);
        for (const s of recentSummaries) {
            const info = [`第 ${s.chapter_number} 章`];
            if (s.chapter_title) info.push(`「${s.chapter_title}」`);
            const detail = s.summary || "（摘要未生成）";
            info.push(`：${detail}`);
            if (s.key_characters?.length) info.push(`\n   出场角色：${s.key_characters.join("、")}`);
            if (s.key_locations?.length) info.push(`\n   地点：${s.key_locations.join("、")}`);
            parts.push(`· ${info.join("")}`);
        }
        parts.push("");
    }

    return parts.join("\n");
}

// ===== P2：风格指南 =====

function assembleP2(styleGuide: StyleGuide | null, _projectId: string): string {
    const parts: string[] = ["━━━━ P2 · 风格指南（写作腔调） ━━━━"];
    if (styleGuide) {
        // 段落顺序决定裁剪优先级：先写的后裁
        // 写作红线(最硬) → 叙述风格 → 文笔基调(最软，最先裁)
        if (styleGuide.writing_rules) parts.push(`写作红线：${styleGuide.writing_rules}`);
        if (styleGuide.narrative_style) parts.push(`叙述风格：${styleGuide.narrative_style}`);
        if (styleGuide.writing_tone) parts.push(`文笔基调：${styleGuide.writing_tone}`);
    }
    if (parts.length === 1) parts.push("（风格指南未填写，请到故事圣经模块设定）");
    parts.push("");
    return parts.join("\n");
}

// ===== 日志库（供 P3 角色池使用）=====

interface LogStoreV2 {
    summaries?: ChapterSummary[];
    characterStates?: CharacterState[];
    storylines?: StorylineProgress[];
    foreshadows?: ForeshadowEntry[];
    termActivity?: { termId: string; status: string; activeForChapter: number; reason: string }[];
    /** AI 预测下一章出场角色 */
    nextChapterCharacters?: { forChapter: number; characterNames: string[]; updatedAt: string };
}

function getLogStoreV2(projectId: string): LogStoreV2 {
    try {
        const parsed = getJSONSync(`novel-workbench-log-${projectId}`, null);
        if (!parsed) return {};
        if (Array.isArray(parsed)) return { summaries: parsed };
        return parsed as LogStoreV2;
    } catch { return {}; }
}

// ===== P3：角色池（三层调度） =====

function assembleP3(allCharacters: Character[], currentChapterNumber: number, allEdges: RelationshipEdge[] = [], logStore: LogStoreV2 = {}): string {
    const parts: string[] = ["━━━━ P3 · 角色池 ━━━━"];
    const charMap = new Map(allCharacters.map(c => [c.id, c.name]));

    // === 活跃角色来源 ===
    const activeCharNames = new Set<string>();
    const charLastChapter = new Map<string, number>();

    // 来源1: characterStates 中近 10 章活跃的
    for (const s of logStore.characterStates || []) {
        charLastChapter.set(s.character_name, s.last_active_chapter);
        if (s.last_active_chapter >= currentChapterNumber - 10) {
            activeCharNames.add(s.character_name);
        }
    }

    // 来源2: beat.characters 中引用的（从当前卷细纲匹配）
    try {
        const segs = getJSONSync(`plot-segments-${allCharacters[0]?.project_id || ""}`, [] as PlotSegmentData[]);
        const chaps = loadAllChapters(allCharacters[0]?.project_id || "");
        const currentChap = chaps.find((c: any) => c.number === currentChapterNumber);
        if (currentChap) {
            const vol = segs.find((s) => s.id === currentChap.volumeSegmentId && s.type === "bright");
            if (vol) {
                const volChapsSorted = chaps.filter((c: any) => c.volumeSegmentId === vol.id).sort((a: any, b2: any) => a.number - b2.number);
                const beat = vol.beats?.find((b: any) => {
                    const bc = parseChapterRange(b.chapters || "");
                    return bc.includes(currentChapterNumber);
                });
                if (beat?.characters) {
                    for (const name of beat.characters.split(/[,，、]/)) {
                        const trimmed = name.trim();
                        if (trimmed) activeCharNames.add(trimmed);
                    }
                }
            }
        }
    } catch { /* ignore */ }

    // 来源3: AI 预测的下一章角色
    if (logStore.nextChapterCharacters?.forChapter === currentChapterNumber) {
        for (const name of logStore.nextChapterCharacters.characterNames) {
            if (name?.trim()) activeCharNames.add(name.trim());
        }
    }

    // 首章兜底：characterStates 为空 → 取 weight 最高的前 5 人
    if (activeCharNames.size === 0 && allCharacters.length > 0) {
        const top5 = [...allCharacters].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 5);
        for (const c of top5) activeCharNames.add(c.name);
    }

    // === 第一层：活跃角色完整卡 ===
    const activeChars = allCharacters.filter(c => activeCharNames.has(c.name));
    if (activeChars.length > 0) {
        parts.push("【本章活跃角色】（完整卡）");
        for (const c of activeChars) {
            // ★ T5.3 D2修复：按章节时间线匹配快照（非盲取最大 age）
            const merged = { ...c };
            if (merged.snapshots?.length) {
                const baseAge = parseInt(c.age) || 0;
                const sortedByAge = [...merged.snapshots].sort((a, b) => (parseInt(a.age) || 0) - (parseInt(b.age) || 0));
                let bestSnap = sortedByAge[sortedByAge.length - 1]; // 默认最大 age
                let matchedByTimeline = false;

                if (baseAge > 0 && currentChapterNumber > 0) {
                    // 尝试按时间线匹配：找 age 最接近 baseAge + chapter 偏移的快照
                    const estimatedAge = baseAge + Math.floor((currentChapterNumber - 1) / 10);
                    let bestDist = Infinity;
                    for (const s of sortedByAge) {
                        const dist = Math.abs((parseInt(s.age) || 0) - estimatedAge);
                        if (dist < bestDist) { bestDist = dist; bestSnap = s; }
                    }
                    matchedByTimeline = bestDist < 20; // 差距过大则认为无法判断
                }

                if (!matchedByTimeline) {
                    reportDiagnostic("warn", `角色「${c.name}」快照匹配：无法判断时间线，使用最大年龄 ${bestSnap.age} 岁快照`);
                }
                if (bestSnap.changes.personality) merged.personality = bestSnap.changes.personality;
                if (bestSnap.changes.ability) merged.ability = bestSnap.changes.ability;
                if (bestSnap.changes.appearance) merged.appearance = bestSnap.changes.appearance;
                if (bestSnap.changes.background) merged.background = bestSnap.changes.background;
                if (bestSnap.changes.style) merged.style = bestSnap.changes.style;
                if (bestSnap.changes.interests) merged.interests = bestSnap.changes.interests;
                if (bestSnap.changes.desire) merged.desire = bestSnap.changes.desire;
                if (bestSnap.changes.fear) merged.fear = bestSnap.changes.fear;
                if (bestSnap.changes.flaw) merged.flaw = bestSnap.changes.flaw;
                if (bestSnap.changes.arc) merged.arc = bestSnap.changes.arc;
                if (bestSnap.changes.voice_style) merged.voice_style = bestSnap.changes.voice_style;
                if (bestSnap.changes.faction) merged.faction = bestSnap.changes.faction;
                if (bestSnap.changes.race) merged.race = bestSnap.changes.race;
                if (bestSnap.age) merged.age = bestSnap.age;
            }
            const fields: string[] = [merged.name];
            if (merged.gender) fields.push(merged.gender);
            if (merged.age) fields.push(`${merged.age}岁`);
            if (merged.race) fields.push(merged.race);
            if (merged.faction) fields.push(`【${merged.faction}】`);
            // 来自 characterStates 的状态
            const state = (logStore.characterStates || []).find(s => s.character_name === merged.name);
            if (state) fields.push(`状态：${state.current_status} · ${state.current_location || "未知"}`);
            if (merged.personality) fields.push(`性格：${merged.personality}`);
            if (merged.appearance) fields.push(`外貌：${merged.appearance.slice(0, 60)}`);
            if (merged.ability) fields.push(`能力：${merged.ability.slice(0, 60)}`);
            if (merged.background) fields.push(`背景：${merged.background.slice(0, 80)}`);
            if (merged.style) fields.push(`着装：${merged.style.slice(0, 40)}`);
            if (merged.interests) fields.push(`爱好：${merged.interests.slice(0, 40)}`);
            if (merged.desire) fields.push(`渴望：${merged.desire.slice(0, 40)}`);
            if (merged.fear) fields.push(`恐惧：${merged.fear.slice(0, 40)}`);
            if (merged.flaw) fields.push(`缺陷：${merged.flaw.slice(0, 40)}`);
            if (merged.voice_style) fields.push(`口吻：${merged.voice_style.slice(0, 40)}`);
            if (merged.arc) fields.push(`弧线：${merged.arc.slice(0, 50)}`);
            parts.push(`· ${fields.join(" ")}`);
        }
        parts.push("");
    }

    // === 第二层：角色关系（任一端活跃即发送 — FUNC-4 修复） ===
    if (allEdges.length > 0 && activeChars.length > 1) {
        const activeIds = new Set(activeChars.map(c => c.id));
        const appearedEdges = allEdges
            .filter(e => activeIds.has(e.source_id) || activeIds.has(e.target_id))
            .sort((a, b) => b.strength - a.strength)
            .slice(0, 20);
        if (appearedEdges.length > 0) {
            parts.push("【角色关系】");
            for (const e of appearedEdges) {
                const srcName = charMap.get(e.source_id) || "未知";
                const tgtName = charMap.get(e.target_id) || "未知";
                parts.push(`· ${srcName} → ${tgtName} [${e.relation_type}] 亲密度: ${e.strength}/10${e.is_secret ? " (秘密)" : ""}`);
            }
            parts.push("");
        }
    }

    // === 第三层：角色名册（全量，仅 summary） ===
    if (allCharacters.length > 0) {
        parts.push(`【角色名册】（共 ${allCharacters.length} 人，AI 可按需调用）`);
        for (const c of allCharacters) {
            const summary = c.summary || `性别：${c.gender || "?"} | ${c.personality || c.faction || ""}`;
            let lastInfo = "";
            if (charLastChapter.has(c.name)) {
                lastInfo = ` | 上次：第${charLastChapter.get(c.name)}章`;
            } else if (!activeCharNames.has(c.name)) {
                lastInfo = " | 尚未出场";
            }
            parts.push(`· ${c.name}（${c.faction || "无"}）${lastInfo} | ${summary}${c.voice_style ? ` | 口吻：${c.voice_style.slice(0, 30)}` : ""}`);
        }
        parts.push("");
    }

    return parts.join("\n");
}

// ===== P4：前一章正文（后段优先） =====

function assembleP4(projectId: string, currentChapterNumber: number): string {
    if (currentChapterNumber <= 1) return ""; // 第一章没有前一章

    try {
        const plotChapters = loadAllChapters(projectId);
        const prevChapter = plotChapters.find((ch: any) => ch.number === currentChapterNumber - 1);
        if (!prevChapter || !prevChapter.content) return "";

        const body = prevChapter.content.replace(/<[^>]+>/g, '').trim();
        if (!body) return "";

        const parts: string[] = ["━━━━ P4 · 前一章正文（第" + (currentChapterNumber - 1) + "章「" + (prevChapter.title || "") + "」）━━━━"];

        // 全文直接放入，token 预算层会按需从头部裁切（保留后段）
        parts.push(body);

        return parts.join("\n");
    } catch {
        return "";
    }
}

/** FUNC-9: 伏笔回收提醒 — 检查待回收伏笔并追加提醒 */
function assembleForeshadowReminders(projectId: string, currentChapterNumber: number): string {
    const logStore = getLogStoreV2(projectId);
    const pendingForeshadows = (logStore.foreshadows || [])
        .filter(f => f.status === "pending" && f.expected_resolve_chapter <= currentChapterNumber + 3);
    if (pendingForeshadows.length === 0) return "";
    const parts = ["\n===== 🔔 待回收伏笔提醒 ====="];
    for (const f of pendingForeshadows) {
        parts.push(`· 第${f.planted_chapter}章埋下，建议在第${f.expected_resolve_chapter}章回收：${f.description}`);
    }
    return parts.join("\n");
}

// ===== token 裁剪（v3.0 三明治布局） =====

/** 各层 Token 预算 */
const LAYER_BUDGET: Record<string, { max: number; fixed: boolean }> = {
    p0: { max: 1_000, fixed: false },   // 世界铁则，仅规则
    p1: { max: 12_000, fixed: false },   // 剧情走向
    p2: { max: 1_000, fixed: false },    // 风格指南，最先裁
    p3: { max: 8_000, fixed: false },    // 角色池
    p4: { max: 10_000, fixed: false },   // 前一章正文，最后裁
};

/** 裁剪顺序：P2(风格) → P3(角色) → P0(铁则) → P1(剧情)，P4 最后裁 */
const LAYER_CULL_ORDER = ["p4", "p2", "p3", "p0", "p1"];

/**
 * 三明治布局 + 按层裁剪。
 * 输出顺序：P4(开头) → P0 → P3 → P2 → P1(结尾)
 * 裁剪顺序：P2 → P3 → P0 → P1（P4 最后裁，从头部切保留后段）
 */
function enforceTokenBudget(layers: Record<string, string>, _maxTokens: number): { text: string; omitted: string[] } {
    const omitted: string[] = [];

    // 计算各层 token
    const tokenMap: Record<string, number> = {};
    for (const [key, val] of Object.entries(layers)) {
        tokenMap[key] = estimateTokens(val);
    }

    const totalTokens = Object.values(tokenMap).reduce((a, b) => a + b, 0);
    if (totalTokens <= _maxTokens) {
        return { text: sandwichJoin(layers), omitted };
    }

    // 从最低优先级层开始裁
    for (const key of LAYER_CULL_ORDER) {
        if (!layers[key]) continue;
        const budget = LAYER_BUDGET[key];
        const currentTokens = tokenMap[key];
        if (currentTokens <= budget.max) continue;

        // P4 特殊处理：从头部裁掉（保留后段 = 最近的写作内容）
        if (key === "p4") {
            const body = layers[key];
            const budgetRatio = budget.max / currentTokens;
            const keepChars = Math.floor(body.length * budgetRatio);
            const trimmed = body.slice(-keepChars);
            omitted.push(`[p4] 前一章正文从头部裁切 ${body.length - keepChars} 字`);
            layers[key] = trimmed;
            tokenMap[key] = estimateTokens(trimmed);
            continue;
        }

        // 其他层：从尾部砍到 budget.max
        const paragraphs = layers[key].split("\n\n");
        const kept: string[] = [];
        let keptTokens = 0;
        for (const para of paragraphs) {
            const t = estimateTokens(para);
            if (keptTokens + t > budget.max) {
                omitted.push(`[${key}] ` + para.slice(0, 40) + "...");
            } else {
                kept.push(para);
                keptTokens += t;
            }
        }
        layers[key] = kept.join("\n\n");
        tokenMap[key] = keptTokens;
    }

    // 如果裁完仍然超限，从最低层继续砍到只剩标题
    let finalTotal = Object.values(tokenMap).reduce((a, b) => a + b, 0);
    if (finalTotal > _maxTokens) {
        for (const key of LAYER_CULL_ORDER) {
            if (!layers[key]) continue;
            if (finalTotal <= _maxTokens) break;
            layers[key] = "";
            finalTotal -= tokenMap[key];
            omitted.push(`[${key}] 整层移除（${tokenMap[key]}t）`);
        }
    }

    return {
        text: sandwichJoin(layers),
        omitted,
    };
}

/** 三明治输出：P4(开头) → P0 → P3 → P2 → P1(结尾) */
function sandwichJoin(layers: Record<string, string>): string {
    const order = ["p4", "p0", "p3", "p2", "p1"];
    return order.map(k => layers[k]).filter(Boolean).join("\n\n");
}
