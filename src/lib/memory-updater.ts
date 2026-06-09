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
import { getJSONSync, setJSONSync, setJSON } from "./storage";
import type {
    ChapterSummary, ChapterSnapshot,
    CharacterState, ForeshadowEntry, StorylineProgress,
} from "@/types";

// ===== 接口 =====

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
${chapterContent.slice(0, 6000)}

请严格按以下 JSON 格式输出（放在 ---CHAPTER_ANALYSIS--- 块中），不要有任何额外文字：

---CHAPTER_ANALYSIS---
{
  "summary": "本章核心剧情摘要（200字以内）",
  "key_characters": ["本章出场角色名"],
  "key_locations": ["本章发生的地名"],
  "advanced_storylines": ["本章推进了哪些故事线"],
  "planted_foreshadow": ["本章埋下的新伏笔（无则空数组）"],
  "character_states": [
    {"name": "角色名", "current_status": "情绪或状态", "current_location": "所在位置"}
  ],
  "storyline_progress": [
    {"name": "故事线名", "delta": "本章推进了什么", "progress_percent": 0}
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
        const segs = getJSONSync(`plot-segments-${projectId}`, [] as any[]);
        knownStorylines = segs.filter((s: any) => s.title).map((s: any) => s.title).join("、");
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
    setJSON(lastHashKey, contentHash);

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
}

function getLogStore(projectId: string): LogStore {
    return getJSONSync(`novel-workbench-log-${projectId}`, {});
}

function saveLogStore(projectId: string, store: LogStore) {
    const key = `novel-workbench-log-${projectId}`;
    setJSONSync(key, store);
    setJSON(key, store);
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

// ===== 快照管理 =====

interface ProjectSnapshot { id: string; label: string; timestamp: string; }
const SNAPSHOT_KEY = (pid: string) => `novel-snapshots-${pid}`;

export function listSnapshots(projectId: string): { id: string; label: string; timestamp: string }[] {
    try { return getJSONSync(SNAPSHOT_KEY(projectId), [] as ProjectSnapshot[]); } catch { return []; }
}

export function createSnapshot(projectId: string, label: string): void {
    try {
        const snaps = listSnapshots(projectId);
        snaps.push({ id: uuid(), label, timestamp: new Date().toISOString() });
        setJSONSync(SNAPSHOT_KEY(projectId), snaps);
    } catch { /* silent */ }
}

export function restoreSnapshot(projectId: string, snapId: string): boolean {
    try {
        const snaps = listSnapshots(projectId);
        const idx = snaps.findIndex(s => s.id === snapId);
        if (idx === -1) return false;
        setJSONSync(SNAPSHOT_KEY(projectId), snaps.slice(0, idx + 1));
        return true;
    } catch { return false; }
}

export async function rebaseMemory(
    projectId: string, fromChapter: number,
    onProgress?: (current: number, total: number) => void
): Promise<void> {
    const plotChapters = getJSONSync(`plot-chapters-${projectId}`, [] as any[]);
    const chapters = plotChapters
        .filter((ch: any) => ch.number >= fromChapter)
        .sort((a: any, b: any) => a.number - b.number);
    const total = chapters.length;
    for (let i = 0; i < total; i++) {
        const ch = chapters[i] as any;
        if (ch.content) {
            await updateMemory({ projectId, chapterNumber: ch.number, chapterTitle: ch.title || "", chapterContent: ch.content, characters: [] });
        }
        onProgress?.(i + 1, total);
    }
}

