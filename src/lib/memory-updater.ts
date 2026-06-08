/**
 * 记忆更新器 —— 章节定稿后自动更新日志库
 *
 * 职责：
 * 1. 生成章节摘要（~200字，AI提炼+你可手动修改）
 * 2. 更新角色状态（位置、状态、情绪）
 * 3. 更新故事线进度
 * 4. 管理伏笔（标记已收/新增未收）
 * 5. 保留原文快照（3-5段关键引用）
 */
import { uuid } from "@/lib/uuid";

import { api } from "./api";
import type {
    Chapter,
    ChapterSummary,
    ChapterSnapshot,
    Character,
    CharacterState,
    ForeshadowEntry,
    StorylineProgress,
} from "@/types";

// ===== 接口 =====

export interface MemoryUpdateInput {
    projectId: string;
    chapterNumber: number;
    chapterTitle: string;
    chapterContent: string;
    characters: string[];         // 本章出场角色名
}

export interface MemoryUpdateResult {
    summary: string;
    characterChanges: { name: string; newStatus: string }[];
    storylineProgress: { name: string; delta: string }[];
    foreshadowUpdates: {
        resolved: string[];
        new: string[];
    };
    snapshotCount: number;
}

// ===== 辅助：从内容中提取角色名 =====

const KNOWN_CHARACTERS = ["陈拾一", "祝楹", "曲凌霜", "离玄", "神霄真人", "陈念", "许长老"];

function extractCharacterNamesFromContent(content: string): string[] {
    return KNOWN_CHARACTERS.filter((name) => content.includes(name));
}

// ===== 主函数 =====

export async function updateMemory(
    input: MemoryUpdateInput
): Promise<MemoryUpdateResult> {
    const { projectId, chapterNumber, chapterTitle, chapterContent, characters } = input;

    // 如果未传入角色名，尝试从内容中提取
    const activeChars = characters.length > 0
        ? characters
        : extractCharacterNamesFromContent(chapterContent);

    // 1. 生成摘要（先用本地提取，后续可改为AI提炼）
    const summary = extractSummary(chapterContent, chapterTitle);

    // 2. 保存章节摘要
    const summaryEntry: ChapterSummary = {
        project_id: projectId,
        chapter_number: chapterNumber,
        chapter_title: chapterTitle,
        summary,
        key_characters: characters,
        key_locations: extractLocations(chapterContent),
        advanced_storylines: extractStorylines(chapterContent),
        planted_foreshadow: extractNewForeshadow(chapterContent),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    saveSummary(projectId, summaryEntry);

    // 3. 更新角色状态
    const characterChanges = updateCharacterStates(projectId, chapterNumber, chapterContent, characters);

    // 4. 更新故事线进度
    const storylineProgress = updateStorylineProgress(projectId, chapterNumber, chapterContent);

    // 5. 管理伏笔
    const foreshadowUpdates = manageForeshadow(projectId, chapterNumber, chapterContent);

    // 6. 保留原文快照
    const snapshotCount = saveSnapshots(projectId, chapterNumber, chapterContent);

    return {
        summary,
        characterChanges,
        storylineProgress,
        foreshadowUpdates,
        snapshotCount,
    };
}

// ===== 摘要提取 =====

function extractSummary(content: string, title: string): string {
    // 取前 300 字作为摘要基础
    const cleaned = content
        .replace(/#{1,6}\s+/g, "")
        .replace(/\*\*/g, "")
        .replace(/\n{3,}/g, "\n")
        .trim();

    // 取前 3 段
    const paragraphs = cleaned.split(/\n\n/).filter(Boolean);
    const firstParas = paragraphs.slice(0, Math.min(3, paragraphs.length));
    const raw = firstParas.join("。").slice(0, 500);

    // 压缩到 ~200 字
    if (raw.length <= 200) return raw;
    return raw.slice(0, 197) + "...";
}

// ===== 地点提取 =====

function extractLocations(content: string): string[] {
    const knownLocations = [
        "演武场", "擂台", "神霄峰", "青霄峰", "碧霄峰", "丹霄峰",
        "景霄峰", "玉霄峰", "振霄峰", "紫霄峰", "长霄峰",
        "灵田", "藏经阁", "食堂", "剑坪", "青崖村",
        "中州", "东苍灵洲", "南炎火洲", "西金荒洲", "北寒冰洲",
    ];

    const found: string[] = [];
    for (const loc of knownLocations) {
        if (content.includes(loc)) found.push(loc);
    }
    return found;
}

// ===== 故事线提取 =====

function extractStorylines(content: string): string[] {
    const knownStorylines = [
        "宗门大比", "寻找师父", "修炼突破", "身份秘密",
        "星辰圣体", "朱雀血脉", "青崖村建设", "空间裂缝",
    ];

    const found: string[] = [];
    for (const s of knownStorylines) {
        if (content.includes(s)) found.push(s);
    }
    return found;
}

// ===== 伏笔提取 =====

function extractNewForeshadow(content: string): string[] {
    // 检测常见的伏笔模式
    const patterns = [
        /(?:似乎|好像|隐约|仿佛|感觉|觉得).{3,30}(?:不对|异常|奇怪|特别|可疑)/g,
        /(?:还没|尚未|暂时不|以后再|留着|留着以后).{2,30}/g,
        /(?:记住|记住这句话|这话|这个细节).{2,20}/g,
    ];

    const found: string[] = [];
    for (const pattern of patterns) {
        const matches = content.matchAll(pattern);
        for (const m of matches) {
            found.push(m[0].slice(0, 30));
        }
    }
    return found.slice(0, 3);
}

// ===== 统一日志存储读写 =====

interface LogStore {
    summaries?: ChapterSummary[];
    characterStates?: CharacterState[];
    storylines?: StorylineProgress[];
    foreshadows?: ForeshadowEntry[];
    snapshots?: ChapterSnapshot[];
}

function getLogStore(projectId: string): LogStore {
    const key = `novel-workbench-log-${projectId}`;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        // 兼容旧格式：如果是一维数组，转义为新结构
        if (Array.isArray(parsed)) {
            return { summaries: parsed };
        }
        return parsed as LogStore;
    } catch {
        return {};
    }
}

function saveLogStore(projectId: string, store: LogStore) {
    const key = `novel-workbench-log-${projectId}`;
    try {
        localStorage.setItem(key, JSON.stringify(store));
    } catch {
        // 静默
    }
}

// ===== 摘要存储 =====

function saveSummary(projectId: string, entry: ChapterSummary) {
    const store = getLogStore(projectId);
    const summaries = store.summaries || [];
    const idx = summaries.findIndex((s) => s.chapter_number === entry.chapter_number);
    if (idx >= 0) {
        summaries[idx] = entry;
    } else {
        summaries.push(entry);
    }
    store.summaries = summaries;
    saveLogStore(projectId, store);
}

// ===== 角色状态更新 =====

function updateCharacterStates(
    projectId: string,
    chapterNumber: number,
    content: string,
    characterNames: string[]
): { name: string; newStatus: string }[] {
    try {
        const store = getLogStore(projectId);
        const states: CharacterState[] = store.characterStates || [];
        const changes: { name: string; newStatus: string }[] = [];

        for (const name of characterNames) {
            const existing = states.find((s) => s.character_name === name);
            const newStatus = inferCharacterStatus(content, name);

            if (existing) {
                existing.current_status = newStatus;
                existing.last_active_chapter = chapterNumber;
                existing.recent_changes.push(`第${chapterNumber}章: ${newStatus}`);
                if (existing.recent_changes.length > 10) {
                    existing.recent_changes = existing.recent_changes.slice(-10);
                }
            } else {
                states.push({
                    project_id: projectId,
                    character_name: name,
                    current_location: inferCharacterLocation(content, name),
                    current_status: newStatus,
                    last_active_chapter: chapterNumber,
                    recent_changes: [`第${chapterNumber}章: ${newStatus}`],
                });
            }
            changes.push({ name, newStatus });
        }

        store.characterStates = states;
        saveLogStore(projectId, store);
        return changes;
    } catch {
        return [];
    }
}

function inferCharacterStatus(content: string, name: string): string {
    if (!content.includes(name)) return "本章未出场";

    const lines = content.split("\n").filter(l => l.includes(name));
    const text = lines.join(" ");

    if (text.includes("受伤") || text.includes("昏迷") || text.includes("中毒")) return "受伤/不适";
    if (text.includes("突破") || text.includes("晋级") || text.includes("进阶")) return "修为突破";
    if (text.includes("高兴") || text.includes("开心") || text.includes("笑")) return "愉悦";
    if (text.includes("愤怒") || text.includes("生气") || text.includes("怒")) return "愤怒";
    if (text.includes("悲伤") || text.includes("哭") || text.includes("难过")) return "悲伤";
    if (text.includes("紧张") || text.includes("焦虑") || text.includes("急")) return "紧张/焦虑";
    if (text.includes("平静") || text.includes("淡然") || text.includes("不在意")) return "平静";
    if (text.includes("疑惑") || text.includes("好奇") || text.includes("不解")) return "疑惑/好奇";

    return "正常";
}

function inferCharacterLocation(content: string, name: string): string {
    const knownLocations = [
        "演武场", "擂台", "神霄峰", "青霄峰", "碧霄峰", "丹霄峰",
        "景霄峰", "玉霄峰", "振霄峰", "紫霄峰", "长霄峰",
        "灵田", "藏经阁", "食堂", "剑坪", "青崖村",
    ];

    const lines = content.split("\n").filter(l => l.includes(name));
    const text = lines.join(" ");

    for (const loc of knownLocations) {
        if (text.includes(loc)) return loc;
    }
    return "未知";
}

// ===== 故事线进度 =====

function updateStorylineProgress(
    projectId: string,
    chapterNumber: number,
    content: string
): { name: string; delta: string }[] {
    try {
        const store = getLogStore(projectId);
        const storylines: StorylineProgress[] = store.storylines || [];
        const results: { name: string; delta: string }[] = [];
        const knownLines = [
            { name: "宗门大比", keywords: ["大比", "比试", "擂台"] },
            { name: "身份秘密", keywords: ["圣品", "功法", "秘密", "保密"] },
            { name: "星辰圣体", keywords: ["星辰", "圣体", "封印", "力量"] },
            { name: "日常修炼", keywords: ["修炼", "练功", "突破", "灵力"] },
        ];

        for (const line of knownLines) {
            const mentioned = line.keywords.some(k => content.includes(k));
            const existing = storylines.find(s => s.storyline_name === line.name);

            if (mentioned) {
                if (existing) {
                    existing.last_active_chapter = chapterNumber;
                    existing.status = "active";
                    existing.progress_percent = Math.min(100, existing.progress_percent + 5);
                } else {
                    storylines.push({
                        project_id: projectId,
                        storyline_name: line.name,
                        storyline_type: "main",
                        progress_percent: 5,
                        last_active_chapter: chapterNumber,
                        status: "active",
                        next_milestone: "",
                    });
                    results.push({ name: line.name, delta: "新故事线开启" });
                }
            }
        }

        store.storylines = storylines;
        saveLogStore(projectId, store);
        return results;
    } catch {
        return [];
    }
}

// ===== 伏笔管理 =====

function manageForeshadow(
    projectId: string,
    chapterNumber: number,
    content: string
): { resolved: string[]; new: string[] } {
    try {
        const store = getLogStore(projectId);
        const foreshadows: ForeshadowEntry[] = store.foreshadows || [];

        const resolved: string[] = [];
        const newForeshadows: string[] = [];

        // 检测已收伏笔（内容中包含"原来""果然""早就知道"等揭示词）
        const revealPatterns = /(?:原来|果然|果真|早就知道|早就料到|真相|真正的原因|终于知道).{10,50}/g;
        const reveals = content.matchAll(revealPatterns);
        for (const r of reveals) {
            const desc = r[0].slice(0, 30);
            // 找是否有匹配的待收伏笔
            const pending = foreshadows.find(
                (f) =>
                    f.status === "pending" &&
                    f.expected_resolve_chapter >= chapterNumber - 5 &&
                    f.expected_resolve_chapter <= chapterNumber + 3
            );
            if (pending) {
                pending.status = "resolved";
                pending.resolved_chapter = chapterNumber;
                resolved.push(pending.description);
            }
        }

        // 检测新伏笔
        const newForeshadowDescs = extractNewForeshadow(content);
        for (const desc of newForeshadowDescs) {
            const exists = foreshadows.some((f) => f.description === desc);
            if (!exists) {
                foreshadows.push({
                    id: uuid(),
                    project_id: projectId,
                    description: desc,
                    planted_chapter: chapterNumber,
                    expected_resolve_chapter: chapterNumber + 10,
                    resolved_chapter: null,
                    status: "pending",
                    priority: "minor",
                });
                newForeshadows.push(desc);
            }
        }

        store.foreshadows = foreshadows;
        saveLogStore(projectId, store);
        return { resolved, new: newForeshadows };
    } catch {
        return { resolved: [], new: [] };
    }
}

// ===== 原文快照 =====

function saveSnapshots(
    projectId: string,
    chapterNumber: number,
    content: string
): number {
    try {
        const store = getLogStore(projectId);
        const snapshots: ChapterSnapshot[] = store.snapshots || [];

        // 提取 3-5 段关键原文
        const paragraphs = content
            .split(/\n\n+/)
            .filter(p => p.trim().length > 30 && p.trim().length < 500)
            .slice(0, 5);

        const excerpts = paragraphs.map((text) => ({
            text: text.trim().slice(0, 200),
            purpose: inferExcerptPurpose(text),
        }));

        const idx = snapshots.findIndex((s) => s.chapter_number === chapterNumber);

        const entry: ChapterSnapshot = {
            project_id: projectId,
            chapter_number: chapterNumber,
            excerpts,
        };

        if (idx >= 0) {
            snapshots[idx] = entry;
        } else {
            snapshots.push(entry);
        }

        store.snapshots = snapshots;
        saveLogStore(projectId, store);
        return excerpts.length;
    } catch {
        return 0;
    }
}

function inferExcerptPurpose(text: string): string {
    if (text.includes("对话") || text.includes("说") || text.includes("道") || text.includes("问") || text.includes("答")) {
        return "关键对话";
    }
    if (text.includes("原来") || text.includes("终于") || text.includes("发现") || text.includes("真相")) {
        return "重要揭示";
    }
    if (text.includes("突破") || text.includes("晋级") || text.includes("成功")) {
        return "角色突破";
    }
    if (text.includes("(") || text.includes("伏笔") || text.includes("似乎") || text.includes("隐约")) {
        return "伏笔/暗示";
    }
    return "情节发展";
}


// ===== 快照管理 =====
interface ProjectSnapshot {
    id: string;
    label: string;
    timestamp: string;
}

const SNAPSHOT_KEY = (pid: string) => `novel-snapshots-${pid}`;

export function listSnapshots(projectId: string): { id: string; label: string; timestamp: string }[] {
    try {
        const raw = localStorage.getItem(SNAPSHOT_KEY(projectId));
        if (!raw) return [];
        return JSON.parse(raw) as ProjectSnapshot[];
    } catch {
        return [];
    }
}

export function createSnapshot(projectId: string, label: string): void {
    try {
        const snaps = listSnapshots(projectId);
        snaps.push({
            id: uuid(),
            label,
            timestamp: new Date().toISOString(),
        });
        localStorage.setItem(SNAPSHOT_KEY(projectId), JSON.stringify(snaps));
    } catch {
        // silent
    }
}

export function restoreSnapshot(projectId: string, snapId: string): boolean {
    try {
        const snaps = listSnapshots(projectId);
        const idx = snaps.findIndex((s) => s.id === snapId);
        if (idx === -1) return false;
        const restored = snaps.slice(0, idx + 1);
        localStorage.setItem(SNAPSHOT_KEY(projectId), JSON.stringify(restored));
        return true;
    } catch {
        return false;
    }
}

export async function rebaseMemory(
    projectId: string,
    fromChapter: number,
    onProgress?: (current: number, total: number) => void
): Promise<void> {
    try {
        const raw = localStorage.getItem("novel-workbench-mock");
        if (!raw) return;
        const data = JSON.parse(raw);
        const volumes = data.volumes || [];
        const chapters: { number: number; title: string; content: string }[] = [];
        for (const vol of volumes) {
            const chs = vol.chapters || [];
            for (const ch of chs) {
                if (ch.number >= fromChapter) {
                    chapters.push(ch);
                }
            }
        }
        const total = chapters.length;
        for (let i = 0; i < total; i++) {
            const ch = chapters[i];
            if (ch.content) {
                await updateMemory({
                    projectId,
                    chapterNumber: ch.number,
                    chapterTitle: ch.title || "",
                    chapterContent: ch.content || "",
                    characters: [],
                });
            }
            onProgress?.(i + 1, total);
        }
    } catch (e) {
        console.error("rebaseMemory failed:", e);
        throw e;
    }
}
