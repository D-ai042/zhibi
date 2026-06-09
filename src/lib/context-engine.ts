/**
 * 上下文引擎 —— 上下文组装器
 *
 * 每次 AI 写作请求前，从知识库和日志库中取出相关内容，
 * 按优先级 P0-P4 分层组装：
 *
 * P0（世界观背景）：世界设定 + 铁则，不可违反
 * P1（剧情走向）：明暗线 + 已锁定事件，故事大方向
 * P2（风格指南+角色语言）：写作腔调
 * P3（进度+前5章摘要）：第 N 章位置 + 前面发生了什么
 * P4（已出场角色池）：已有角色，AI 可复用也可创造新角色
 *
 * v2.0 新增模块感知上下文 buildModuleContext()：
 *   根据用户当前所处的模块，按需组装最相关的数据，
 *   而非无差别全量 dump。
 */

import { api } from "./api";
import { getJSONSync } from "./storage";
import type {
    Chapter,
    ChapterSummary,
    Character,
    ContextEngineOutput,
    RelationshipEdge,
    StoryBible,
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

/** 从 novel-workbench-mock 中读取项目世界观词条 */
function loadWorldTerms(projectId: string): any[] {
    try {
        const mock = getJSONSync('novel-workbench-mock', {});
        return (mock.worldTerms || []).filter((t: any) => t.project_id === projectId);
    } catch { return []; }
}

function estimateTokens(text: string): number {
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
        api.listRelationshipEdges(projectId).catch(() => [] as any[]),
        loadStyleGuide(projectId),
        loadStoryBible(projectId),
    ]);

    const parts: string[] = ["===== 📖 项目数据上下文 ====="];

    // P0 所有模块都带（铁则不可省略）
    const p0 = assembleP0(projectId, styleGuide, storyBible, allWorldTerms);
    parts.push(p0);

    // ===== 按模块分派 =====
    if (mod === "worldview") {
        // 世界观：强调词条，弱化角色
        if (allWorldTerms.length > 0) {
            parts.push("\n===== 🌍 全部世界观词条 =====");
            const typeLabel: Record<string, string> = { rule: "规则", faction: "势力", place: "地点", item: "道具", system: "制度", other: "其他" };
            for (const t of allWorldTerms) {
                parts.push(`· [${typeLabel[t.term_type] || t.term_type}] ${t.title}：${t.one_liner || ""}`);
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
        // 人物关系：强调角色卡 + 关系网
        if (allCharacters.length > 0) {
            parts.push("\n===== 👤 全部角色档案 =====");
            for (const c of allCharacters) {
                const fields: string[] = [c.name];
                if (c.faction) fields.push(`【${c.faction}】`);
                if (c.personality) fields.push(`性格：${c.personality}`);
                if (c.appearance) fields.push(`外貌：${c.appearance.slice(0, 60)}`);
                if (c.ability) fields.push(`能力：${c.ability.slice(0, 60)}`);
                if (c.background) fields.push(`背景：${c.background.slice(0, 80)}`);
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

    } else if (mod === "plot-direction") {
        // 剧情走向：明暗线 + 连线 + 时间轴
        try {
            const segs = getJSONSync(`plot-segments-${projectId}`, [] as any[]);
            const savedEdges = getJSONSync(`plot-edges-${projectId}`, [] as any[]);
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

        const p1 = assembleP1(projectId, recentSummaries, currentChapter?.number);
        const p2 = assembleP2(styleGuide, projectId);
        const p3 = assembleP3(currentChapter, volumeName);
        const p4 = assembleP4(allCharacters, currentChapter?.number || 1, allEdges);
        parts.push(p1, p2, p3, p4);

        // P5: 本章正文
        if (currentChapter) {
            try {
                const allPlotChapters = getJSONSync(`plot-chapters-${projectId}`, [] as any[]);
                const thisCh = allPlotChapters.find((c: any) => c.id === chapterId);
                if (thisCh?.content) {
                    const body = thisCh.content.slice(0, 3000);
                    parts.push(`\n━━━━ P5 · 当前章节正文（前3000字）━━━━\n${body}`);
                }
            } catch { /* ignore */ }
            // 节拍卡片
            try {
                const beatCards = await api.listBeatCards(chapterId);
                if (beatCards.length > 0) {
                    parts.push("\n━━━━ 本章节拍卡片 ━━━━");
                    const colLabel: Record<string, string> = { goal: "目标", conflict: "冲突", turn: "转折", hook: "钩子", reveal: "揭示" };
                    for (const b of beatCards) {
                        parts.push(`· [${colLabel[b.column_type] || b.column_type}] ${b.content}`);
                    }
                }
            } catch { /* ignore */ }
        }

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
        try {
            const voices = getJSONSync(`novel-workbench-voices-${projectId}`, null as any[] | null);
            if (voices) {
                if (Array.isArray(voices) && voices.length > 0) {
                    parts.push("\n===== 🎭 角色语言 =====");
                    for (const v of voices) parts.push(`· ${v.char}：${v.voice}`);
                }
            }
        } catch { /* ignore */ }

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
            const typeLabel: Record<string, string> = { rule: "规则", faction: "势力", place: "地点", item: "道具", system: "制度", other: "其他" };
            for (const t of allWorldTerms.slice(0, 30)) {
                parts.push(`· [${typeLabel[t.term_type] || t.term_type}] ${t.title}：${t.one_liner || "（待补充）"}`);
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

    // ====== 唯一数据源: plot-chapters-{pid}（写作台卷章树）=======
    let plotChapters: any[] = [];
    try {
        plotChapters = getJSONSync(`plot-chapters-${projectId}`, [] as any[]);
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
        const chapters = getJSONSync(`plot-chapters-${projectId}`, null as any[] | null);
        if (!chapters) return null;
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

export async function buildProjectContext(input: ContextEngineInput): Promise<ContextEngineOutput> {
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

    // P0: 世界观背景
    const p0 = assembleP0(projectId, styleGuide, storyBible, allWorldTerms);
    // P1: 剧情走向 + 前情摘要
    const p1 = assembleP1(projectId, recentSummaries, currentChapter?.number);
    // P2: 风格指南 + 角色语言
    const p2 = assembleP2(styleGuide, projectId);
    // P3: 全书结构
    const p3 = assembleP3_BookStructure(projectId, currentChapter, volumeName, allCharacters);
    // P4: 已出场角色池
    const p4 = assembleP4(allCharacters, currentChapter?.number || 1, allEdges);
    // P5: 本章已有正文（如果已经写了内容）
    let p5 = "";
    if (currentChapter) {
        try {
            // 从 plot-chapters 读本章已写的内容
            const allPlotChapters = getJSONSync(`plot-chapters-${projectId}`, [] as any[]);
            const thisCh = allPlotChapters.find((c: any) => c.id === chapterId);
            if (thisCh?.content?.trim()) {
                p5 = `━━━━ P5 · 本章已有正文（${thisCh.content.replace(/\s/g, "").length}字） ━━━━\n${thisCh.content}`;
            }
        } catch { /* ignore */ }
        // 节拍卡片
        try {
            const beatCards = await api.listBeatCards(chapterId);
            if (beatCards.length > 0) {
                const colLabel: Record<string, string> = { goal: "目标", conflict: "冲突", turn: "转折", hook: "钩子", reveal: "揭示" };
                const beatStr = beatCards.map(b => `· [${colLabel[b.column_type] || b.column_type}] ${b.content}`).join("\n");
                p5 += `\n━━━━ 本章节拍卡片 ━━━━\n${beatStr}`;
            }
        } catch { /* ignore */ }
    }

    const layers: Record<string, string> = { p0, p1, p2, p3, p4, p5: p5 || "" };
    const { text: clippedText, omitted } = enforceTokenBudget({ ...layers }, EFFECTIVE_MAX_TOKENS);

    // 提取关键词用于过滤
    const keywords = extractKeywords([], currentChapter);
    const activeTerms = filterWorldTerms(allWorldTerms, keywords);

    return {
        systemHint: clippedText,
        layers: { p0, p1, p2, p3, p4, p5 },
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
        const all = await api.getChapterSummaries(projectId);
        const before = all.filter(s => s.chapter_number < currentChapter.number).sort((a, b) => b.chapter_number - a.chapter_number).slice(0, 5);
        return before.reverse();
    } catch { return []; }
}

// ===== P0：世界观背景 =====

function assembleP0(projectId: string, _styleGuide: StyleGuide | null, storyBible: StoryBible | null, worldTerms: WorldTerm[]): string {
    const parts: string[] = ["━━━━ P0 · 世界观背景（不可违反） ━━━━"];

    // 世界观词条（优先使用已传入的参数，兼容 localStorage 回退）
    const terms = worldTerms.length > 0 ? worldTerms : loadWorldTerms(projectId);
    if (terms.length > 0) {
        parts.push("【世界设定】");
        const typeLabel: Record<string, string> = { rule: "规则", faction: "势力", place: "地点", item: "道具", system: "制度", other: "其他" };
        for (const t of terms.slice(0, 20)) {
            parts.push(`· [${typeLabel[t.term_type] || t.term_type}] ${t.title}：${t.one_liner || ""}`);
        }
        if (terms.length > 20) parts.push(`...共 ${terms.length} 个词条`);
        parts.push("");
    }

    // 故事铁则
    if (storyBible) {
        if (storyBible.worldview_rules?.length) {
            parts.push("【世界观铁律】");
            for (const r of storyBible.worldview_rules) parts.push(`· ${r}`);
            parts.push("");
        }
        if (storyBible.inviolable_rules?.length) {
            parts.push("【角色铁则】");
            for (const r of storyBible.inviolable_rules) parts.push(`· ${r}`);
            parts.push("");
        }
        if (storyBible.main_stages?.length) {
            parts.push("【故事主要阶段】");
            for (const s of storyBible.main_stages) parts.push(`· 第${s.chapter_range[0]}-${s.chapter_range[1]}章「${s.name}」：${s.description || ""}`);
            parts.push("");
        }
    }

    if (parts.length === 1) parts.push("（世界观设定未填写，请到大纲模块补充）");
    return parts.join("\n");
}

// ===== P1：剧情走向 + 前情摘要 =====

function assembleP1(projectId: string, recentSummaries: ChapterSummary[], currentChapterNumber?: number): string {
    const parts: string[] = ["━━━━ P1 · 剧情走向与前情摘要 ━━━━"];
    try {
        const segs = getJSONSync(`plot-segments-${projectId}`, [] as any[]);
        const chaps = getJSONSync(`plot-chapters-${projectId}`, [] as any[]);
        if (segs.length > 0) {
            // 如果知道当前章节号，找到它所属的卷（bright segment）
            let currentVolId = "";
            if (currentChapterNumber) {
                const currentChap = chaps.find((c: any) => c.number === currentChapterNumber);
                if (currentChap) currentVolId = currentChap.volumeSegmentId;
            }

            const bright = segs.filter((s: any) => s.type === "bright");
            const dark = segs.filter((s: any) => s.type === "dark");

            // 当前卷：完整信息（含细纲）
            if (currentVolId) {
                const vol = bright.find((s: any) => s.id === currentVolId);
                if (vol) {
                    parts.push(`【当前卷 — ${vol.title}】`);
                    const beats = vol.beats || [];
                    if (beats.length > 0) {
                        for (const b of beats) {
                            const pieces = [`· #${b.number} ${b.title}`];
                            if (b.characters) pieces.push(`[${b.characters}]`);
                            if (b.event) pieces.push(`：${b.event}`);
                            parts.push(pieces.join(""));
                        }
                    } else {
                        parts.push(`· ${vol.event || "（暂无细纲）"}`);
                    }
                    parts.push("");
                }
            }

            // 其他卷：只列标题（不加载细纲）
            const otherBright = currentVolId ? bright.filter((s: any) => s.id !== currentVolId) : bright;
            if (otherBright.length > 0) {
                if (currentVolId) parts.push("【其他卷】");
                else parts.push("【明线】");
                for (const s of otherBright) {
                    parts.push(`· 「${s.title}」${s.chapters ? `（章节范围：${s.chapters}）` : ""}`);
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
        const bible = getJSONSync(`novel-workbench-bible-${projectId}`, null as any);
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

function assembleP2(styleGuide: StyleGuide | null, projectId: string): string {
    const parts: string[] = ["━━━━ P2 · 风格指南（写作腔调） ━━━━"];
    if (styleGuide) {
        if (styleGuide.narrative_style) parts.push(`叙述风格：${styleGuide.narrative_style}`);
        if (styleGuide.writing_tone) parts.push(`文笔基调：${styleGuide.writing_tone}`);
        if (styleGuide.writing_rules) parts.push(`写作红线：${styleGuide.writing_rules}`);
    }
    try {
        const voices = getJSONSync(`novel-workbench-voices-${projectId}`, null as any[] | null);
        if (voices) {
            if (Array.isArray(voices) && voices.length > 0) {
                parts.push("【角色语言】");
                for (const v of voices) parts.push(`· ${v.char}：${v.voice}`);
            }
        }
    } catch { /* ignore */ }
    if (parts.length === 1) parts.push("（风格指南未填写，请到故事圣经模块设定）");
    parts.push("");
    return parts.join("\n");
}

// ===== P3：全书结构（v2.0 增强） =====

import type { CharacterState, StorylineProgress, ForeshadowEntry } from "@/types";

interface LogStoreV2 {
    summaries?: ChapterSummary[];
    characterStates?: CharacterState[];
    storylines?: StorylineProgress[];
    foreshadows?: ForeshadowEntry[];
}

function getLogStoreV2(projectId: string): LogStoreV2 {
    try {
        const parsed = getJSONSync(`novel-workbench-log-${projectId}`, null);
        if (!parsed) return {};
        if (Array.isArray(parsed)) return { summaries: parsed };
        return parsed as LogStoreV2;
    } catch { return {}; }
}

function assembleP3_BookStructure(
    projectId: string,
    currentChapter: Chapter | undefined,
    volumeName: string,
    _allCharacters: Character[],
): string {
    const currentNum = currentChapter?.number ?? 0;
    const parts: string[] = ["━━━━ P3 · 全书结构 ━━━━"];

    // 1. 卷章树
    try {
        const allPlotChapters = getJSONSync(`plot-chapters-${projectId}`, [] as any[]);
        const segs = getJSONSync(`plot-segments-${projectId}`, [] as any[]);
        const bright = segs.filter((s: any) => s.type === "bright");
        if (bright.length > 0 && allPlotChapters.length > 0) {
            parts.push("【卷章结构】");
            const volumeOrder = new Map<string, number>();
            bright.forEach((b: any, i: number) => volumeOrder.set(b.id, i));
            const sorted = [...allPlotChapters].sort((a: any, b: any) => {
                const oa = volumeOrder.get(a.volumeSegmentId) ?? 999;
                const ob = volumeOrder.get(b.volumeSegmentId) ?? 999;
                if (oa !== ob) return oa - ob;
                return a.number - b.number;
            });
            for (const ch of sorted) {
                const vol = bright.find((b: any) => b.id === ch.volumeSegmentId);
                const volPrefix = vol ? `【${vol.title}】` : "";
                const marker = ch.id === currentChapter?.id ? "← 当前章" : (ch.content ? "✓" : "☐");
                parts.push(`  ${volPrefix}第${ch.number}章「${ch.title || "未命名"}」${marker}`);
            }
            parts.push("");
        }
    } catch { /* ignore */ }

    // 2. 写作进度 + 卷信息
    if (volumeName) {
        parts.push(`当前：${volumeName} · 第${currentNum}章「${currentChapter?.title || ""}」`);
    } else if (currentChapter) {
        parts.push(`当前：第${currentNum}章「${currentChapter.title}」`);
    }
    parts.push("");

    // 3. 活跃角色状态
    const logStore = getLogStoreV2(projectId);
    if (logStore.characterStates && logStore.characterStates.length > 0) {
        const active = logStore.characterStates.filter(c => c.last_active_chapter >= currentNum - 10);
        if (active.length > 0) {
            parts.push("【活跃角色状态】");
            for (const c of active) {
                parts.push(`· ${c.character_name}：${c.current_status}（${c.current_location || "未知"}）`);
            }
            parts.push("");
        }
    }

    // 4. 故事线进度
    if (logStore.storylines && logStore.storylines.length > 0) {
        const activeLines = logStore.storylines.filter(s => s.status === "active");
        if (activeLines.length > 0) {
            parts.push("【故事线进度】");
            for (const s of activeLines) {
                parts.push(`· ${s.storyline_name}：${s.progress_percent}%（${s.next_milestone || "推进中"}）`);
            }
            parts.push("");
        }
    }

    // 5. 待收伏笔提醒
    if (logStore.foreshadows && logStore.foreshadows.length > 0) {
        const pending = logStore.foreshadows.filter(f => f.status === "pending" && f.expected_resolve_chapter >= currentNum - 3);
        if (pending.length > 0) {
            parts.push("【伏笔提醒】");
            for (const f of pending) {
                const overdue = f.expected_resolve_chapter < currentNum ? " ⚠ 已逾期" : "";
                parts.push(`· ${f.description}（预期第${f.expected_resolve_chapter}章回收）${overdue}`);
            }
            parts.push("");
        }
    }

    parts.push("请根据以上全书结构和当前状态，推动剧情发展。注意维护角色状态和故事线的一致性。");
    return parts.join("\n");
}

/** 保留旧 P3 用于兼容 */
function assembleP3(
    currentChapter: Chapter | undefined,
    volumeName: string,
): string { return assembleP3_BookStructure("", currentChapter, volumeName, []); }

// ===== P4：已出场角色池 =====

function assembleP4(allCharacters: Character[], currentChapterNumber: number, allEdges: RelationshipEdge[] = []): string {
    const parts: string[] = ["━━━━ P4 · 已出场角色池 ━━━━"];
    const appeared = allCharacters.filter(c => {
        if (!c.first_appearance_chapter) return true;
        return c.first_appearance_chapter <= currentChapterNumber;
    });
    if (appeared.length > 0) {
        for (const c of appeared) {
            const info = [c.name];
            if (c.faction) info.push(`（${c.faction}）`);
            if (c.personality) info.push(`性格：${c.personality}`);
            if (c.one_liner) info.push(`简介：${c.one_liner}`);
            if (c.appearance) info.push(`外貌：${c.appearance.slice(0, 60)}`);
            if (c.ability) info.push(`能力：${c.ability.slice(0, 60)}`);
            if (c.background) info.push(`背景：${c.background.slice(0, 80)}`);
            if (c.desire) info.push(`渴望：${c.desire.slice(0, 40)}`);
            if (c.fear) info.push(`恐惧：${c.fear.slice(0, 40)}`);
            if (c.flaw) info.push(`缺陷：${c.flaw.slice(0, 40)}`);
            parts.push(`· ${info.join(" ")}`);
        }
        // 人物关系网
        if (allEdges.length > 0) {
            parts.push("");
            parts.push("【人物关系】");
            const charMap = new Map(allCharacters.map(c => [c.id, c.name]));
            for (const e of allEdges) {
                const srcName = charMap.get(e.source_id) || "未知";
                const tgtName = charMap.get(e.target_id) || "未知";
                parts.push(`· ${srcName} → ${tgtName} [${e.relation_type}] 亲密度: ${e.strength}/10${e.is_secret ? " (秘密关系)" : ""}`);
            }
        }
        parts.push("");
        parts.push("AI 可以复用以上已出场角色及其关系，也可以创造新的配角。重要新角色需用户确认。");
    } else {
        parts.push("（暂无已出场角色）");
        parts.push("AI 可以自由创造本章出场角色。");
    }
    return parts.join("\n");
}

// ===== token 裁剪（v2.0 按层级优先级） =====

/** 各层 Token 预算 */
const LAYER_BUDGET: Record<string, { max: number; fixed: boolean }> = {
    p0: { max: 1_500, fixed: true },   // 铁则，不可裁
    p1: { max: 8_000, fixed: true },   // 前情，不可裁
    p3: { max: 1_500, fixed: true },   // 全书结构，不可裁
    p2: { max: 1_000, fixed: false },  // 风格，可压缩
    p4: { max: 8_000, fixed: false },  // 角色池，可裁数量
    p5: { max: 3_000, fixed: false },  // 当前章正文，可压缩
};

/** 裁剪顺序（优先级从低到高，先裁后面的） */
const LAYER_CULL_ORDER = ["p5", "p4", "p2"];

/**
 * 按层级优先级裁剪，确保 P0/P1/P3 不被裁剪。
 * P6 → P5 → P4 → P2 依次压缩，P0/P1/P3 固定保留。
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
        return { text: Object.values(layers).join("\n\n"), omitted };
    }

    // 从最低优先级层开始裁
    for (const key of LAYER_CULL_ORDER) {
        if (!layers[key]) continue;
        const budget = LAYER_BUDGET[key];
        const currentTokens = tokenMap[key];
        if (currentTokens <= budget.max) continue; // 预算内不裁

        // 超出预算：按段落从后往前砍到 budget.max
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
        text: Object.values(layers).filter(Boolean).join("\n\n"),
        omitted,
    };
}
