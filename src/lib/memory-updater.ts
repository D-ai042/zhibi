/**
 * 记忆更新器 —— 章节定稿后自动更新日志库
 *
 * 职责：
 * 1. AI 生成章节摘要（结构化提炼）
 * 2. AI 分析角色状态（位置/情绪/状态）
 * 3. AI 判断故事线推进
 * 4. AI 识别新伏笔
 * 5. 保留原文快照
 *
 * 所有文本分析均由 AI 完成，无任何正则/关键词兜底。
 * AI 调用失败直接报错，不降级。
 */

import { uuid } from "@/lib/uuid";
import { api } from "./api";
import { getJSONSync, setJSONSync, setSync, saveJSON, getSync } from "./storage";
import { loadAllChapters } from "./chapter-store";
import { getAllProjectKeys } from "./backup";
import { reportDiagnostic } from "./diagnostics";
import { useAppStore } from "@/stores/app-store";
import type {
    ChapterSummary, ChapterSnapshot,
    CharacterState, ForeshadowEntry, StorylineProgress,
    LogStoreData, PlotSegmentData,
} from "@/types";

// ===== 接口 =====

/** 解析章节范围字符串如 "1-3" 或 "4,7-9" 为数字数组 */
function parseChapterRange(range: string): number[] {
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

export interface MemoryUpdateInput {
    projectId: string;
    chapterNumber: number;
    chapterTitle: string;
    chapterContent: string;
    characters: string[];
}

export interface MemoryUpdateResult {
    summary: string;
    characterChanges: { name: string; newStatus: string }[];
    storylineProgress: { name: string; delta: string }[];
    foreshadowUpdates: { resolved: string[]; new: string[] };
    snapshotCount: number;
}

// ===== AI 章节分析 =====

interface AiChapterAnalysis {
    summary: string;
    key_characters: string[];
    key_locations: string[];
    advanced_storylines: string[];
    planted_foreshadow: string[];
    character_states: { name: string; current_status: string; current_location: string }[];
    storyline_progress: { name: string; delta: string; progress_percent: number }[];
    /** 角色字段级变化——如果有角色在外貌/性格/能力等发生明显变化，输出快照 */
    character_snapshots?: {
        name: string;            // 角色名
        age: string;             // 推测的当前年龄
        personality?: string;    // 性格变化（如果有）
        ability?: string;        // 能力变化（如果有）
        appearance?: string;     // 外貌变化（如果有）
        background?: string;    // 背景变化（如果有）
        style?: string;
        interests?: string;
        desire?: string;
        fear?: string;
        flaw?: string;
        arc?: string;
        voice_style?: string;
        faction?: string;
        race?: string;
        gender?: string;
    }[];
}

function buildChapterAnalysisPrompt(
    chapterNumber: number, chapterTitle: string, chapterContent: string,
    knownCharacters: string, knownStorylines: string, prevSummary: string
): string {
    return `你是一个资深文学编辑，请分析以下章节内容，输出结构化 JSON。

【本章信息】
第${chapterNumber}章「${chapterTitle}」

【已知角色列表】
${knownCharacters || "（暂无）"}

【已有故事线列表】
${knownStorylines || "（暂无）"}

【前情摘要】
${prevSummary || "（首章，无前情）"}

【本章正文（前6000字）】
${chapterContent.slice(0, 3000)}\n...\n${chapterContent.slice(-3000)}

请严格按以下 JSON 格式输出（放在 ---CHAPTER_ANALYSIS--- 块中），不要有任何额外文字：

---CHAPTER_ANALYSIS---
{
  "summary": "本章核心剧情摘要（200-400字，包含关键出场人物、事件经过、场景地点）",
  "key_characters": ["本章出场角色名"],
  "key_locations": ["本章发生的地名"],
  "advanced_storylines": ["本章推进了哪些故事线"],
  "planted_foreshadow": ["本章埋下的新伏笔（无则空数组）"],
  "character_states": [
    {"name": "角色名", "current_status": "情绪或状态", "current_location": "所在位置"}
  ],
  "storyline_progress": [
    {"name": "故事线名", "delta": "本章推进了什么", "progress_percent": 0}
  ],
  "character_snapshots": [
    重要说明：仅在角色发生不可逆的重大变化时才创建快照。以下情况必须跳过：
    - 角色只是出场但没有任何发展变化
    - 角色只是说了几句话或参与了战斗，但性格/能力/外貌等没有改变
    - 情绪波动（开心/生气）不算性格变化
    以下情况才需要快照（同一角色最多1条，只填实际变化的字段，无变化的字段不要写）：
    - 角色经历了人生观、价值观的根本转变
    - 角色获得了新的能力/技能/知识（如觉醒、修炼突破、学会新技艺）
    - 角色外貌发生了永久改变（如毁容、变身、留疤）
    - 角色身份/地位发生了根本变化（如登基、被废、入魔）
    - 角色经历了重大创伤导致行为模式改变
    格式（只填变化的字段，无变化的不填）：
    {"name": "角色名", "age": "当前年龄数字字符串", "personality": "新性格描述（变化才填）"}
  ]
}
---END_CHAPTER_ANALYSIS---`;
}

async function analyzeChapterViaAI(
    projectId: string, chapterNumber: number, chapterTitle: string, chapterContent: string
): Promise<AiChapterAnalysis> {
    // 收集上下文
    let knownCharacters = "";
    let knownStorylines = "";
    let prevSummary = "";

    try {
        const chars = await api.listCharacters(projectId);
        knownCharacters = chars.map(c => `${c.name}（${c.personality || ""}，${c.faction || ""}）`).join("、");
    } catch { /* ignore */ }

    try {
        const segs = getJSONSync(`plot-segments-${projectId}`, [] as PlotSegmentData[]);
        knownStorylines = segs.filter((s) => s.title).map((s) => s.title).join("、");
    } catch { /* ignore */ }

    try {
        const summaries = await api.getChapterSummaries(projectId);
        const prev = summaries
            .filter((s: ChapterSummary) => s.chapter_number < chapterNumber)
            .sort((a, b) => a.chapter_number - b.chapter_number)
            .slice(-3);
        prevSummary = prev.map(s => `第${s.chapter_number}章：${s.summary}`).join("\n");
    } catch { /* ignore */ }

    const prompt = buildChapterAnalysisPrompt(
        chapterNumber, chapterTitle, chapterContent,
        knownCharacters, knownStorylines, prevSummary
    );

    const res = await api.aiComplete({
        action: "chat", entity_type: "chapter", entity_id: projectId,
        extra: {
            system_hint: "你是一个严谨的文学分析助手。只输出指定 JSON 格式，不要额外文字。",
            user_message: prompt, history: [], context: "",
        },
    });

    if (!res.content || res.error) {
        throw new Error(res.error || "AI 分析返回为空，请检查 API 配置后重试");
    }

    const m = res.content.match(/---CHAPTER_ANALYSIS---\s*([\s\S]*?)\s*---END_CHAPTER_ANALYSIS---/);
    if (!m) {
        throw new Error("AI 未按指定格式输出分析结果，请重试");
    }

    try {
        const a: AiChapterAnalysis = JSON.parse(m[1]);
        return {
            summary: a.summary || "",
            key_characters: a.key_characters || [],
            key_locations: a.key_locations || [],
            advanced_storylines: a.advanced_storylines || [],
            planted_foreshadow: a.planted_foreshadow || [],
            character_states: a.character_states || [],
            storyline_progress: a.storyline_progress || [],
            character_snapshots: a.character_snapshots || [],
        };
    } catch (e) {
        throw new Error("AI 分析结果 JSON 解析失败: " + (e instanceof Error ? e.message : String(e)));
    }
}

// ===== 主函数 =====

export async function updateMemory(
    input: MemoryUpdateInput
): Promise<MemoryUpdateResult> {
    const { projectId, chapterNumber, chapterTitle, chapterContent } = input;

    // 内容哈希检测 — 上次分析后内容没变则跳过
    const contentHash = simpleHash(chapterContent);
    const lastHashKey = `chapter-hash-${projectId}-${chapterNumber}`;
    const lastHash = getJSONSync(lastHashKey, "");
    if (lastHash === contentHash) {
        return {
            summary: "（内容未变更，跳过分析）",
            characterChanges: [], storylineProgress: [],
            foreshadowUpdates: { resolved: [], new: [] }, snapshotCount: 0,
        };
    }

    // AI 分析本章
    const analysis = await analyzeChapterViaAI(projectId, chapterNumber, chapterTitle, chapterContent);

    // 保存 contentHash
    setJSONSync(lastHashKey, contentHash);

    // 1. 保存摘要
    const summaryEntry: ChapterSummary = {
        project_id: projectId, chapter_number: chapterNumber,
        chapter_title: chapterTitle,
        summary: analysis.summary,
        key_characters: analysis.key_characters,
        key_locations: analysis.key_locations,
        advanced_storylines: analysis.advanced_storylines,
        planted_foreshadow: analysis.planted_foreshadow,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    saveSummary(projectId, summaryEntry);

    // 2. 角色状态
    const characterChanges: { name: string; newStatus: string }[] = [];
    const store = getLogStore(projectId);
    const states: CharacterState[] = store.characterStates || [];

    for (const cs of analysis.character_states) {
        const existing = states.find(s => s.character_name === cs.name);
        if (existing) {
            existing.current_status = cs.current_status;
            existing.current_location = cs.current_location;
            existing.last_active_chapter = chapterNumber;
            existing.recent_changes.push(`第${chapterNumber}章: ${cs.current_status}`);
            if (existing.recent_changes.length > 10) existing.recent_changes = existing.recent_changes.slice(-10);
        } else {
            states.push({
                project_id: projectId, character_name: cs.name,
                current_location: cs.current_location,
                current_status: cs.current_status,
                last_active_chapter: chapterNumber,
                recent_changes: [`第${chapterNumber}章: ${cs.current_status}`],
            });
        }
        characterChanges.push({ name: cs.name, newStatus: cs.current_status });
    }
    store.characterStates = states;

    // ★ 3.5 角色快照：AI 检测到字段级变化时自动创建/更新快照
    if (analysis.character_snapshots?.length) {
        try {
            const allChars = await api.listCharacters(projectId);
            for (const snap of analysis.character_snapshots) {
                const targetChar = allChars.find(c => c.name === snap.name);
                if (!targetChar || !snap.age) continue;

                // ★ 收集 AI 报告的变化字段
                const changes: Record<string, string> = {};
                const snapKeys = ["personality", "ability", "appearance", "background", "style", "interests", "desire", "fear", "flaw", "arc", "voice_style", "faction", "race", "gender"] as const;
                const snapData = snap as Record<string, string>;
                for (const key of snapKeys) {
                    const val = snapData[key];
                    if (val && typeof val === "string" && val.trim().length > 3) {
                        changes[key] = val.trim();
                    }
                }

                // ★ 校验：至少要有实际变化才建快照
                if (Object.keys(changes).length === 0) continue;

                // ★ 校验：与角色当前值对比，完全相同则跳过（AI 可能照抄原文）
                let hasActualDiff = false;
                for (const key of Object.keys(changes)) {
                    const currentVal = (targetChar[key] || "").trim();
                    if (currentVal !== changes[key]) { hasActualDiff = true; break; }
                }
                if (!hasActualDiff) continue;

                const existingSnaps = (targetChar.snapshots || []) as { age: string; changes: Record<string, string> }[];
                const snapAge = parseInt(snap.age) || 0;
                if (!snapAge) continue; // 无效年龄，跳过
                const idx = existingSnaps.findIndex(s => (parseInt(s.age) || 0) === snapAge);

                if (idx >= 0) {
                    // 合并而非覆盖：保留已有变化，新增/更新 AI 报告的变化
                    existingSnaps[idx] = { age: snap.age, changes: { ...existingSnaps[idx].changes, ...changes } };
                } else {
                    existingSnaps.push({ age: snap.age, changes });
                }
                existingSnaps.sort((a, b) => (parseInt(a.age) || 0) - (parseInt(b.age) || 0));

                // ★ 通过 api.saveCharacter 保存，确保走完整的序列化路径
                const updatedChar = { ...targetChar, snapshots: existingSnaps };
                await api.saveCharacter(updatedChar);
            }
            // 通知 UI 刷新角色列表
            useAppStore.getState().bumpCharacters();
        } catch { /* 快照保存失败不阻塞定稿 */ }
    }

    // 3. 故事线进度
    const storylineProgress: { name: string; delta: string }[] = [];
    const storylines: StorylineProgress[] = store.storylines || [];
    for (const sp of analysis.storyline_progress) {
        const existing = storylines.find(s => s.storyline_name === sp.name);
        if (existing) {
            existing.progress_percent = sp.progress_percent;
            existing.last_active_chapter = chapterNumber;
            existing.status = "active";
            existing.next_milestone = sp.delta;
        } else {
            storylines.push({
                project_id: projectId, storyline_name: sp.name,
                storyline_type: "main", progress_percent: sp.progress_percent,
                last_active_chapter: chapterNumber, status: "active",
                next_milestone: sp.delta,
            });
        }
        storylineProgress.push({ name: sp.name, delta: sp.delta });
    }
    store.storylines = storylines;

    // 4. 伏笔
    const foreshadows: ForeshadowEntry[] = store.foreshadows || [];
    const newForeshadows: string[] = [];
    for (const desc of analysis.planted_foreshadow) {
        if (!foreshadows.some(f => f.description === desc)) {
            foreshadows.push({
                id: uuid(), project_id: projectId, description: desc,
                planted_chapter: chapterNumber, expected_resolve_chapter: chapterNumber + 10,
                resolved_chapter: null, status: "pending", priority: "minor",
            });
            newForeshadows.push(desc);
        }
    }
    store.foreshadows = foreshadows;
    saveLogStore(projectId, store);

    // 5. 快照
    const snapshotCount = saveSnapshots(projectId, chapterNumber, chapterContent);

    return {
        summary: analysis.summary,
        characterChanges, storylineProgress,
        foreshadowUpdates: { resolved: [], new: newForeshadows },
        snapshotCount,
    };
}

// ===== 简单哈希 =====

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}

// ===== 日志存储 =====

interface LogStore {
    summaries?: ChapterSummary[];
    characterStates?: CharacterState[];
    storylines?: StorylineProgress[];
    foreshadows?: ForeshadowEntry[];
    snapshots?: ChapterSnapshot[];
    termActivity?: TermActivityEntry[];
}

// ===== 词条激活状态 =====

interface TermActivityEntry {
    termId: string;
    termTitle: string;
    activeForChapter: number;
    status: "active" | "dormant";
    reason: string;
    evaluatedAt: string;
}

/**
 * 定稿后 AI 判断下一章需要激活哪些世界观词条。
 * 输入：所有词条 + 前5章摘要 + 下一章 beat 规划
 * 输出：每个词条的 active/dormant 标记，写入 termActivity
 */
export async function activateNextChapterTerms(
    projectId: string,
    chapterNumber: number,
    allWorldTerms: { id: string; title: string; one_liner: string; term_type: string }[],
    plotSegments: any[],
    plotChapters: any[],
    recentSummaries: ChapterSummary[],
): Promise<TermActivityEntry[]> {
    // 找到下一章（第 N+1 章）对应的 beat
    const nextChapterNumber = chapterNumber + 1;
    const nextChap = plotChapters.find((c: any) => c.number === nextChapterNumber);
    let nextBeatInfo = "";
    let nextVolInfo = "";

    if (nextChap) {
        const vol = plotSegments.find((s: any) => s.id === nextChap.volumeSegmentId && s.type === "bright");
        if (vol) {
            nextVolInfo = `所属卷：${vol.title}\n卷概要：角色：${vol.characters || ""}  地点：${vol.location || ""}  时间：${vol.time || ""}  事件：${vol.event || ""}`;
            const beats = vol.beats || [];
            // 用 beat.chapters 精确匹配（修复旧版 idxInVol + 1 的映射错误）
            const nextChapterNum = nextChapterNumber;
            const beat = beats.find((b: any) => {
                const range = parseChapterRange(b.chapters || "");
                return range.includes(nextChapterNum);
            });
            if (beat) {
                nextBeatInfo = `细纲 #${beat.number}「${beat.title}」\n角色：${beat.characters || ""}\n地点：${beat.location || ""}\n时间：${beat.time || ""}\n事件：${beat.event || ""}\n章节范围：${beat.chapters || ""}`;
            }
        }
    }

    const summariesText = recentSummaries
        .map(s => `第${s.chapter_number}章：${s.summary}\n出场角色：${(s.key_characters || []).join("、")}\n地点：${(s.key_locations || []).join("、")}`)
        .join("\n\n");

    const termsText = allWorldTerms
        .map(t => `[${t.term_type}] ${t.id}: ${t.title} — ${t.one_liner || ""}`)
        .join("\n");

    const prompt = `你是资深小说设定编辑。

给定：
1. 所有世界观词条列表（id、title、one_liner、term_type）
2. 前 5 章摘要（key_characters、key_locations、summary）
3. 下一章（第 ${nextChapterNumber} 章）的剧情规划（所属卷概要 + 当前细纲 beat 的完整信息）

对每个词条判断第 ${nextChapterNumber} 章是否需要：

- rule 类型：本章剧情是否涉及该规则约束的场景？
- place 类型：本章是否发生在该地点或直接关联地点？
- faction 类型：本章是否会出现该势力？
- item/system 类型：本章是否会涉及该道具或制度？
- other 类型：默认不需要

严格规则：
- 只有第 ${nextChapterNumber} 章明确相关才标 active，其他标 dormant
- 不要因为"以后可能会用到"而提前激活
- 输出纯 JSON，放在 ---TERM_ACTIVATION--- 块中：
---TERM_ACTIVATION---
{
  "terms": [
    {"id": "词条id", "status": "active", "reason": "一句话原因，必须具体"}
  ]
}
---END_TERM_ACTIVATION---

【全部词条列表】
${termsText}

【前情摘要】
${summariesText || "（首章，无前情摘要）"}

【下一章（第${nextChapterNumber}章）剧情规划】
${nextVolInfo}

${nextBeatInfo}`;

    const res = await api.aiComplete({
        action: "chat", entity_type: "chapter", entity_id: projectId,
        extra: {
            system_hint: "你是一个严谨的设定编辑助手。只输出指定 JSON 格式，不要额外文字。",
            user_message: prompt, history: [], context: "",
        },
    });

    if (!res.content || res.error) {
        throw new Error(res.error || "AI 词条激活分析返回为空");
    }

    const m = res.content.match(/---TERM_ACTIVATION---\s*([\s\S]*?)\s*---END_TERM_ACTIVATION---/);
    if (!m) {
        throw new Error("AI 未按指定格式输出词条激活结果，请重试");
    }

    try {
        const result: { terms: { id: string; status: string; reason: string }[] } = JSON.parse(m[1]);
        const entries: TermActivityEntry[] = result.terms.map(t => ({
            termId: t.id,
            termTitle: allWorldTerms.find(wt => wt.id === t.id)?.title || "",
            activeForChapter: nextChapterNumber,
            status: t.status === "active" ? "active" : "dormant",
            reason: t.reason || "",
            evaluatedAt: new Date().toISOString(),
        }));

        // 写入 log store
        const store = getLogStore(projectId);
        // 移除旧的对同一章的评估
        store.termActivity = (store.termActivity || []).filter(
            e => e.activeForChapter !== nextChapterNumber
        );
        store.termActivity.push(...entries);
        saveLogStore(projectId, store);

        return entries;
    } catch (e) {
        throw new Error("AI 词条激活结果 JSON 解析失败: " + (e instanceof Error ? e.message : String(e)));
    }
}

function getLogStore(projectId: string): LogStore {
    return getJSONSync(`novel-workbench-log-${projectId}`, {});
}

function saveLogStore(projectId: string, store: LogStore) {
    const key = `novel-workbench-log-${projectId}`;
    setJSONSync(key, store);
}

function saveSummary(projectId: string, entry: ChapterSummary) {
    const store = getLogStore(projectId);
    const summaries = store.summaries || [];
    const idx = summaries.findIndex(s => s.chapter_number === entry.chapter_number);
    if (idx >= 0) summaries[idx] = entry;
    else summaries.push(entry);
    store.summaries = summaries;
    saveLogStore(projectId, store);
}

function saveSnapshots(projectId: string, chapterNumber: number, content: string): number {
    try {
        const store = getLogStore(projectId);
        const snapshots: ChapterSnapshot[] = store.snapshots || [];
        const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 30 && p.trim().length < 500).slice(0, 5);
        const excerpts = paragraphs.map(text => ({ text: text.trim().slice(0, 200), purpose: "情节发展" as string }));
        const idx = snapshots.findIndex(s => s.chapter_number === chapterNumber);
        const entry: ChapterSnapshot = { project_id: projectId, chapter_number: chapterNumber, excerpts };
        if (idx >= 0) snapshots[idx] = entry; else snapshots.push(entry);
        store.snapshots = snapshots;
        saveLogStore(projectId, store);
        return excerpts.length;
    } catch { return 0; }
}

// ===== 下一章角色调度 =====

/**
 * 每一章定稿后，AI 根据前情摘要 + 下章细纲 + 角色名册
 * 预测下一章应该出场的角色，写入日志库。
 */
export async function activateNextChapterCharacters(
    projectId: string,
    currentChapterNumber: number,
): Promise<void> {
    const nextChapter = currentChapterNumber + 1;

    let allCharacters: any[] = [];
    let summaries: any[] = [];
    let segs: any[] = [];
    let chaps: any[] = [];
    try {
        allCharacters = await api.listCharacters(projectId);
        summaries = await api.getChapterSummaries(projectId);
        segs = getJSONSync(`plot-segments-${projectId}`, [] as PlotSegmentData[]);
        chaps = loadAllChapters(projectId);
    } catch { return; }

    // 找到下一章所属的 beat
    const nextChap = chaps.find((c: any) => c.number === nextChapter);
    const nextVol = nextChap ? segs.find((s: any) => s.id === nextChap.volumeSegmentId) : null;
    const nextBeat = nextVol?.beats?.find((b: any) => {
        const range = parseChapterRange(b.chapters || "");
        return range.includes(nextChapter);
    });

    const prompt = `你是小说角色调度助手。根据以下信息，判断第${nextChapter}章应该出场哪些角色。

【角色名册】（共 ${allCharacters.length} 人）
${allCharacters.map((c: any) => `- ${c.name}（${c.faction || "无"}）${c.summary || c.personality || ""}`).join("\n")}

【前情摘要】
${summaries.filter((s: any) => s.chapter_number <= currentChapterNumber).slice(-5).map((s: any) => `第${s.chapter_number}章：${s.summary}`).join("\n")}

【下一章细纲】
${nextBeat ? `#${nextBeat.number}「${nextBeat.title}」角色：${nextBeat.characters}  事件：${nextBeat.event}` : "（未找到对应细纲）"}

请输出 JSON，列出第${nextChapter}章预计出场的角色名（从角色名册中选取，可新增名册外角色）：
---NEXT_CHARS---
["角色名1", "角色名2", ...]
---END---`;

    try {
        const res = await api.aiComplete({
            action: "chat", entity_type: "project", entity_id: projectId,
            extra: { system_hint: "你是一个小说角色调度助手。只输出 JSON 数组。", user_message: prompt, history: [], context: "" },
        });
        if (!res.content || res.error) return;
        const m = res.content.match(/---NEXT_CHARS---\s*([\s\S]*?)\s*---END---/);
        if (!m) return;
        const chars: string[] = JSON.parse(m[1]);

        // 写入日志库
        const logKey = `novel-workbench-log-${projectId}`;
        const logStore: LogStoreData = getJSONSync(logKey, {} as LogStoreData) || {};
        logStore.nextChapterCharacters = {
            forChapter: nextChapter,
            characterNames: chars,
            updatedAt: new Date().toISOString(),
        };
        setJSONSync(logKey, logStore);
    } catch { /* 角色预测失败不阻塞定稿 */ }
}

// ===== 快照管理 =====

interface ProjectSnapshot { id: string; label: string; timestamp: string; data?: Record<string, string>; }
const SNAPSHOT_KEY = (pid: string) => `novel-snapshots-${pid}`;

// T4：分片存储 key 模式
const SNAPSHOT_INDEX_KEY = (pid: string) => `snapshot-${pid}-index`;
const SNAPSHOT_SHARD_KEY = (pid: string, snapId: string, shard: string) => `snapshot-${pid}-${snapId}-${shard}`;
interface SnapshotMeta { id: string; label: string; timestamp: string; shards: string[] }

/** 将 key 分类到分片 */
const CHAR_KEY_PREFIXES = [
    "characters-", "character-", "world-terms-", "relationship-",
    "char-groups-", "ai-pending-chars-", "ai-pending-world-terms-",
];

function classifyKey(key: string, projectId: string): string {
    if (key.startsWith(`chapter-${projectId}-`) || key.startsWith("chapter-index-") ||
        key.startsWith("plot-chapters-") || key.startsWith("plot-segments-") || key.startsWith("plot-edges-")) {
        // T3 兼容：plot-chapters- 为旧 key，仅快照兼容时使用
        return "chapters";
    }
    if (CHAR_KEY_PREFIXES.some(p => key.startsWith(p))) {
        return "characters";
    }
    return "misc";
}

export function listSnapshots(projectId: string): { id: string; label: string; timestamp: string }[] {
    try {
        // T4：优先从新索引读取
        const newIndex = getJSONSync(SNAPSHOT_INDEX_KEY(projectId), [] as SnapshotMeta[]);
        if (newIndex.length > 0) {
            return newIndex.map(s => ({ id: s.id, label: s.label, timestamp: s.timestamp }));
        }
        // 兼容旧格式：从 novel-snapshots-{pid} 读取
        const old = getJSONSync(SNAPSHOT_KEY(projectId), [] as ProjectSnapshot[]);
        return old.map(s => ({ id: s.id, label: s.label, timestamp: s.timestamp }));
    } catch { return []; }
}

export async function createSnapshot(projectId: string, label: string): Promise<void> {
    try {
        const snapId = uuid();
        const keys = await getAllProjectKeys(projectId);

        // 按分片分类数据
        const shardData: Record<string, Record<string, string>> = { chapters: {}, characters: {}, misc: {} };
        for (const key of keys) {
            const val = getSync(key);
            if (val !== null) {
                shardData[classifyKey(key, projectId)][key] = val;
            }
        }

        // 写时复制事务：1. 写新分片 key
        const activeShards: string[] = [];
        for (const [shardName, data] of Object.entries(shardData)) {
            if (Object.keys(data).length > 0) {
                const ok = saveJSON(SNAPSHOT_SHARD_KEY(projectId, snapId, shardName), data);
                if (!ok) {
                    // 写入失败，回滚已写入的分片
                    for (const s of activeShards) {
                        try { setJSONSync(SNAPSHOT_SHARD_KEY(projectId, snapId, s), null); } catch { /* ignore */ }
                    }
                    reportDiagnostic("error", `快照分片 ${shardName} 写入失败，已回滚`);
                    return;
                }
                activeShards.push(shardName);
            }
        }

        // 2. 更新索引（所有分片写入成功后才更新索引）
        const index = getJSONSync(SNAPSHOT_INDEX_KEY(projectId), [] as SnapshotMeta[]);
        index.push({ id: snapId, label, timestamp: new Date().toISOString(), shards: activeShards });
        if (!saveJSON(SNAPSHOT_INDEX_KEY(projectId), index)) {
            // 索引写入失败，回滚分片
            for (const s of activeShards) {
                try { setJSONSync(SNAPSHOT_SHARD_KEY(projectId, snapId, s), null); } catch { /* ignore */ }
            }
            reportDiagnostic("error", "快照索引写入失败，已回滚");
        }
    } catch { /* silent */ }
}

export function restoreSnapshot(projectId: string, snapId: string): boolean {
    try {
        // T4：优先从分片恢复
        const index = getJSONSync(SNAPSHOT_INDEX_KEY(projectId), [] as SnapshotMeta[]);
        const meta = index.find(s => s.id === snapId);
        if (meta) {
            for (const shardName of meta.shards) {
                const data = getJSONSync(SNAPSHOT_SHARD_KEY(projectId, snapId, shardName), null as Record<string, string> | null);
                if (data) {
                    for (const [key, value] of Object.entries(data)) {
                        setSync(key, value);
                    }
                }
            }
            const idx = index.findIndex(s => s.id === snapId);
            setJSONSync(SNAPSHOT_INDEX_KEY(projectId), index.slice(0, idx + 1));
            return true;
        }
        // 兼容旧格式：从 novel-snapshots-{pid} 恢复
        const snaps = getJSONSync(SNAPSHOT_KEY(projectId), [] as ProjectSnapshot[]);
        const idx = snaps.findIndex(s => s.id === snapId);
        if (idx === -1) return false;
        const snap = snaps[idx];
        if (snap.data) {
            for (const [key, value] of Object.entries(snap.data)) {
                setSync(key, value);
            }
        }
        setJSONSync(SNAPSHOT_KEY(projectId), snaps.slice(0, idx + 1));
        return true;
    } catch { return false; }
}

export async function rebaseMemory(
    projectId: string, fromChapter: number,
    onProgress?: (current: number, total: number) => void
): Promise<void> {
    const plotChapters = loadAllChapters(projectId);
    const chapters = plotChapters
        .filter((ch: any) => ch.number >= fromChapter)
        .sort((a: any, b: any) => a.number - b.number);
    const total = chapters.length;
    for (let i = 0; i < total; i++) {
        const ch = chapters[i];
        if (ch.content) {
            await updateMemory({ projectId, chapterNumber: ch.number, chapterTitle: ch.title || "", chapterContent: ch.content, characters: [] });
        }
        onProgress?.(i + 1, total);
    }
}

