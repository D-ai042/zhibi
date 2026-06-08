import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, FileText, Sparkles, AlignLeft, Undo2, Redo2, CheckCircle } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { buildProjectContext } from "@/lib/context-engine";
import { updateMemory } from "@/lib/memory-updater";
import { createSnapshot, rebaseMemory } from "@/lib/memory-updater";
import { runQualityCheck } from "@/lib/quality-checker";
import type { QualityCheckItem } from "@/lib/quality-checker";
import { AiWritingDialog } from "@/components/editor/AiWritingDialog";
import { AiWriteChapterDialog } from "@/components/editor/AiWriteChapterDialog";
import { renderMarkdown } from "@/lib/markdown";
import type { ChapterSummary, BeatCard } from "@/types";
import { uuid } from "@/lib/uuid";

// ===== 章节 =====
interface PlotChapter {
    id: string;
    volumeSegmentId: string;
    number: number;
    title: string;
    content: string;
}

// ===== localStorage =====
function ck(pid: string) { return "plot-chapters-" + pid; }
function sk(pid: string) { return "plot-segments-" + pid; }
function ek(pid: string) { return "plot-edges-" + pid; }

interface PlotSegment {
    id: string; project_id: string; type: "bright" | "dark";
    title: string; characters: string; location: string; time: string; event: string;
}

function loadChapters(pid: string): PlotChapter[] {
    try { return JSON.parse(localStorage.getItem(ck(pid)) || "[]"); } catch { return []; }
}
function saveChapters(pid: string, chs: PlotChapter[]) {
    localStorage.setItem(ck(pid), JSON.stringify(chs));
}
function loadSegments(pid: string): PlotSegment[] {
    try { return JSON.parse(localStorage.getItem(sk(pid)) || "[]"); } catch { return []; }
}
function loadEdges(pid: string): { source: string; target: string; sourceHandle?: string; targetHandle?: string }[] {
    try { return JSON.parse(localStorage.getItem(ek(pid)) || "[]"); } catch { return []; }
}

/** 保存时更新章节版本（用于修订感知的脏链检测） */
function bumpSavedChapterVersion(projectId: string, chapterNumber: number) {
    try {
        const key = `novel-workbench-log-${projectId}`;
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const store = JSON.parse(raw);
        store.chapterVersions = store.chapterVersions || {};
        store.chapterVersions[String(chapterNumber)] = (store.chapterVersions[String(chapterNumber)] || 0) + 1;
        localStorage.setItem(key, JSON.stringify(store));
    } catch { /* ignore */ }
}

/** 节拍卡片列类型标签 */
const colLabel: Record<string, string> = {
    goal: "目标", conflict: "冲突", turn: "转折", hook: "钩子", reveal: "揭示",
};

/** 检测有哪些后续章节的摘要基于旧版本 */
function detectStaleAhead(projectId: string, currentChapterNumber: number): { count: number; chapters: string; fromChapter: number } {
    try {
        const raw = localStorage.getItem(`novel-workbench-log-${projectId}`);
        if (!raw) return { count: 0, chapters: "", fromChapter: 0 };
        const store = JSON.parse(raw);
        const deps = store.dependencies || [];
        // 找所有依赖了当前章节及之前章节的 stale 记录
        const stale = deps.filter((d: any) => {
            const depCh = parseInt(d.dependsOnChapter);
            return depCh <= currentChapterNumber && d.status === "stale";
        });
        if (stale.length === 0) return { count: 0, chapters: "", fromChapter: 0 };
        // 提取受影响的章节范围
        const depsChs: number[] = [];
        const seen = new Set<number>();
        for (const d of stale) {
            const n = parseInt(d.dependsOnChapter);
            if (!seen.has(n)) { seen.add(n); depsChs.push(n); }
        }
        depsChs.sort((a, b) => a - b);
        if (depsChs.length === 0) return { count: 0, chapters: "", fromChapter: 0 };
        const first = depsChs[0];
        const last = depsChs[depsChs.length - 1];
        return { count: stale.length, chapters: first === last ? `第${first}章` : `第${first}-${last}章`, fromChapter: first };
    } catch { return { count: 0, chapters: "", fromChapter: 0 }; }
}

/**
 * 用 AI 识别本章新出场角色（异步、不阻塞主流程）。
 * 识别结果写入 localStorage，通知 AiChatPanel 展示「应用到星图」确认按钮。
 */
async function aiExtractNewCharacters(projectId: string, chapterNumber: number, chapterContent: string) {
    try {
        // 获取已知角色列表和已有关系边（告诉 AI 哪些不是新的，避免重复创建）
        let knownNames = "";
        let existingEdgesStr = "";
        try {
            const [allChars, allEdges] = await Promise.all([
                api.listCharacters(projectId),
                api.listRelationshipEdges(projectId).catch(() => [] as any[]),
            ]);
            knownNames = allChars.map(c => c.name).join("、");
            if (allEdges.length > 0) {
                const charMap = new Map(allChars.map(c => [c.id, c.name]));
                existingEdgesStr = "\n已有关系（不要重复创建）：\n";
                for (const e of allEdges) {
                    const src = charMap.get(e.source_id) || "未知";
                    const tgt = charMap.get(e.target_id) || "未知";
                    existingEdgesStr += `· ${src} → ${tgt} [${e.relation_type}]\n`;
                }
            }
        } catch { /* ignore */ }

        const charRes = await api.aiComplete({
            action: "chat",
            entity_type: "chapter",
            entity_id: projectId,
            extra: {
                system_hint: `你是一个小说角色识别助手。分析章节内容，识别本章新出场的角色。

已知角色列表（不要重复）：${knownNames || "（暂无）"}${existingEdgesStr || ""}

请严格按以下 JSON 格式返回（放在 ---CHARACTERS--- 块中）：
---CHARACTERS---
[
  {"action":"create_character","character":{"name":"角色名","faction":"所属势力或组织","gender":"性别","personality":"性格特征","appearance":"外貌描述","background":"背景简介"}},
  {"action":"create_relationship","edge":{"sourceName":"角色A","targetName":"角色B","relation_type":"关系类型（师徒/敌对/爱慕/朋友/亲属/同盟）","strength":8}}
]
---END_CHARACTERS---

注意：
- 只识别本章新出场的、不在已知角色列表中的角色
- 角色名必须是完整的人名（2-4个汉字），绝对不要包含"的"、"了"、"是"等虚词
- 如果本章没有新角色出场，返回空数组 []
- 如果新角色与已有角色有明确关系，同时创建关系边
- **不要为已有角色之间创建重复的关系边**，检查"已有关系"列表避免重复`,
                user_message: `请分析第${chapterNumber}章内容，识别新出场角色：\n\n${chapterContent.slice(0, 15000)}`,
                history: [],
            },
        });

        if (charRes.content && !charRes.error) {
            // 解析 ---CHARACTERS--- 块（与 AiChatPanel 的 parseCharacterBatch 逻辑一致）
            const m = charRes.content.match(/---CHARACTERS---\s*([\s\S]*?)\s*---END_CHARACTERS---/);
            if (!m) return;
            const arr = JSON.parse(m[1]);
            if (!Array.isArray(arr) || arr.length === 0) return;

            const chars = arr
                .filter((a: any) => a.action === "create_character" && a.character)
                .map((a: any) => ({
                    name: (a.character.name || "").slice(0, 20),
                    faction: a.character.faction || "",
                    gender: a.character.gender,
                    age: a.character.age,
                    race: a.character.race,
                    appearance: a.character.appearance,
                    personality: a.character.personality,
                    background: a.character.background,
                    ability: a.character.ability,
                    style: a.character.style,
                    interests: a.character.interests,
                }));
            const edges = arr
                .filter((a: any) => a.action === "create_relationship" && a.edge)
                .map((a: any) => ({
                    sourceName: a.edge.sourceName,
                    targetName: a.edge.targetName,
                    relation_type: a.edge.relation_type || "关联",
                    strength: a.edge.strength || 5,
                }));

            if (chars.length > 0 || edges.length > 0) {
                localStorage.setItem(`ai-pending-chars-${projectId}`, JSON.stringify({
                    chars,
                    edges,
                    timestamp: new Date().toISOString(),
                }));
                useAppStore.getState().bumpPendingAiChars();

                const names = chars.map((c: any) => c.name).join("、");
                const edgeInfo = edges.length > 0 ? ` 和 ${edges.length} 条关系` : "";
                useAppStore.getState().addChatMessage({
                    id: uuid(),
                    role: "system",
                    content: `🔍 AI 识别到 ${chars.length} 个新角色${edgeInfo}：${names || "（无角色名）"}。请在右侧 AI 聊天面板点击「应用到星图」确认创建。`,
                    created_at: new Date().toISOString(),
                });
                console.log(`[aiExtractNewCharacters] 识别到 ${chars.length} 个新角色, ${edges.length} 条关系`);
            }
        }
    } catch (e) {
        console.error("[aiExtractNewCharacters] 角色识别失败:", e);
    }
}

/**
 * 写作台 —— 按剧情走向分卷章的 AI 写作工作台
 *
 * 布局：
 * ┌──────────────────────────────────────────────────┐
 * │  编辑器                          │  卷章树(320px) │
 * │                                  │                │
 * │  AI 生成的本章正文                │  第一卷        │
 * │  框选文字 → AI 弹窗(扩写/润色等)  │  第1章 xxx     │
 * │                                  │  第2章 xxx     │
 * │                                  │  第二卷        │
 * │  [AI 写本章] [保存] [排版]       │  第3章 xxx     │
 * └──────────────────────────────────────────────────┘
 */
export function WritingModule() {
    const { currentProject } = useAppStore();
    const [chapters, setChapters] = useState<PlotChapter[]>([]);
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState("");
    const [showAddDlg, setShowAddDlg] = useState<string | null>(null);
    const [newChapterTitle, setNewChapterTitle] = useState("");
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameText, setRenameText] = useState("");
    // 下一个章节号
    const nextChapterNumber = useMemo(() =>
        chapters.reduce((m, c) => Math.max(m, c.number), 0) + 1,
        [chapters]);
    // 内容可编辑 div 引用，用于保存/恢复选区
    // AI 写作弹窗（框选文字后）
    const [aiDialog, setAiDialog] = useState<{ start: number; end: number; text: string; mouseX: number; mouseY: number } | null>(null);
    // AI 写本章弹窗（点击按钮后 — 字数/剧情方向）
    const [writeDlg, setWriteDlg] = useState<{ wordCount: number; plotDirection: string } | null>(null);
    const [polishing, setPolishing] = useState(false);
    // 最近一次 AI 写作的参数（用于退回重写）
    const lastWriteParamsRef = useRef<{ wordCount: number; plotDirection: string } | null>(null);
    // 修订感知：stale 检测
    const [staleInfo, setStaleInfo] = useState<{ count: number; chapters: string; fromChapter: number } | null>(null);
    const [rebaseRunning, setRebaseRunning] = useState(false);
    const [rebaseProgress, setRebaseProgress] = useState<{ current: number; total: number } | null>(null);
    // 选取模式（读取章节到 AI 上下文，从 store 同步）
    const { chapterSelectMode: selectMode, selectedChapterIds: storeSelIds, setChapterSelectMode, setSelectedChapterIds: storeSetSelIds } = useAppStore();
    const selIdSet = new Set(storeSelIds);
    const [volCollapsed, setVolCollapsed] = useState<Record<string, boolean>>({});
    // 质量检查结果面板
    const [qualityPanel, setQualityPanel] = useState<{ checks: QualityCheckItem[]; onProceed: () => void; onReject: () => void } | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const insertLockRef = useRef(false);
    const _ignoreNextInput = useRef(false);
    // ref 版 editingContent，供撤销/重做/键盘事件在闭包中安全使用
    const editingContentRef = useRef(editingContent);
    editingContentRef.current = editingContent;
    // 跟踪所有 setTimeout，组件卸载时清理
    const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    // 清理所有超时
    useEffect(() => () => { timeoutIdsRef.current.forEach(clearTimeout); timeoutIdsRef.current = []; }, []);
    // AI 写作并发守卫 ref
    const aiWritingRef = useRef(false);
    /**
     * 将 Markdown 内容渲染为 HTML 并同步到内容可编辑区。
     * 仅在外部内容变更时调用（加载章节、AI 写作、撤销、排版等），
     * 用户打字时不会调用，从而避免光标跳转。
     */
    function syncEditorHTML(content: string) {
        if (editorRef.current) {
            editorRef.current.innerHTML = renderMarkdown(content);
        }
    }
    // 保存按钮脏状态
    const savedContentRef = useRef("");
    const [isDirty, setIsDirty] = useState(false);
    // 选中文字范围
    const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
    // 撤销栈（编辑器内容，最大50步）
    const undoContentStackRef = useRef<string[]>([]);
    const redoContentStackRef = useRef<string[]>([]);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    /** 将当前内容推入撤销栈 */
    function pushUndo(content: string) {
        const stack = undoContentStackRef.current;
        // 避免重复推相同内容
        if (stack.length > 0 && stack[stack.length - 1] === content) return;
        stack.push(content);
        if (stack.length > 50) stack.shift();
        redoContentStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
    }

    /** 撤回 */
    const handleUndo = useCallback(function () {
        const stack = undoContentStackRef.current;
        if (stack.length === 0) return;
        const prev = stack.pop()!;
        redoContentStackRef.current.push(editingContentRef.current);
        setEditingContent(prev);
        const tid = setTimeout(() => syncEditorHTML(prev), 0);
        timeoutIdsRef.current.push(tid);
        setCanUndo(stack.length > 0);
        setCanRedo(true);
    }, []);

    /** 重做 */
    const handleRedo = useCallback(function () {
        const stack = redoContentStackRef.current;
        if (stack.length === 0) return;
        const next = stack.pop()!;
        undoContentStackRef.current.push(editingContentRef.current);
        setEditingContent(next);
        const tid = setTimeout(() => syncEditorHTML(next), 0);
        timeoutIdsRef.current.push(tid);
        setCanRedo(stack.length > 0);
        setCanUndo(true);
    }, []);

    // 键盘快捷键 Ctrl+Z / Ctrl+Y
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
                e.preventDefault();
                handleRedo();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [handleUndo, handleRedo]);

    const [sidebarWidth, setSidebarWidth] = useState(() => {
        try {
            const projectId = currentProject?.id;
            if (projectId) {
                const saved = localStorage.getItem("writing-sidebar-width-" + projectId);
                if (saved) return Math.max(200, Math.min(600, Number(saved)));
            }
        } catch { /* ignore */ }
        return 320;
    });
    const sidebarWidthRef = useRef(sidebarWidth);
    sidebarWidthRef.current = sidebarWidth;
    const resizingRef = useRef(false);
    const resizeStartRef = useRef({ startX: 0, startW: 0 });

    const pid = currentProject?.id;

    // ===== 从旧数据中剥离 "第X章 " 前缀 =====
    const CN_NUMS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
    function migrateTitle(ch: PlotChapter): string {
        const arabicPrefix = `第${ch.number}章`;
        if (ch.title.startsWith(arabicPrefix)) {
            return ch.title.slice(arabicPrefix.length).replace(/^\s*/, '');
        }
        const cnPrefix = `第${CN_NUMS[ch.number] ?? ch.number}章`;
        if (ch.title.startsWith(cnPrefix)) {
            return ch.title.slice(cnPrefix.length).replace(/^\s*/, '');
        }
        return ch.title;
    }

    // ===== 从剧情走向构建卷结构 =====
    const volumes = useMemo(() => {
        if (!pid) return [];
        const segs = loadSegments(pid);
        const edges = loadEdges(pid);
        const bright = segs.filter(s => s.type === "bright");
        const dark = segs.filter(s => s.type === "dark");

        return bright.map(b => {
            const connectedDarkIds = new Set<string>();
            for (const e of edges) {
                if (e.sourceHandle === "bottom" && e.targetHandle === "top") {
                    const src = segs.find(s => s.id === e.source);
                    const tgt = segs.find(s => s.id === e.target);
                    if (src?.id === b.id && tgt?.type === "dark") connectedDarkIds.add(tgt.id);
                    if (tgt?.id === b.id && src?.type === "dark") connectedDarkIds.add(src.id);
                } else if (!e.sourceHandle && !e.targetHandle) {
                    const src = segs.find(s => s.id === e.source);
                    const tgt = segs.find(s => s.id === e.target);
                    if (src?.id === b.id && tgt?.type === "dark") connectedDarkIds.add(tgt.id);
                    if (tgt?.id === b.id && src?.type === "dark") connectedDarkIds.add(src.id);
                }
            }
            const darkSegs = dark.filter(d => connectedDarkIds.has(d.id));
            const suffix = darkSegs.length > 0 ? "—" + darkSegs.map(d => d.title).join("、") : "";
            return {
                id: b.id,
                title: b.title + suffix,
                brightTitle: b.title,
                darkTitles: darkSegs.map(d => d.title),
            };
        });
    }, [pid]);

    // ===== 加载章节（含旧数据迁移） =====
    useEffect(() => {
        if (!pid) return;
        let loaded = loadChapters(pid);
        let changed = false;

        const migrated = loaded.map(ch => {
            const migratedName = migrateTitle(ch);
            if (migratedName !== ch.title) {
                changed = true;
                return { ...ch, title: migratedName };
            }
            return ch;
        });

        const segs = loadSegments(pid);
        const bright = segs.filter(s => s.type === "bright");
        const validVolumeIds = new Set(bright.map(b => b.id));
        // 只保留属于现有卷的章节，过滤已删除卷的残留数据
        const filtered = migrated.filter(ch => validVolumeIds.has(ch.volumeSegmentId));
        if (filtered.length < migrated.length) changed = true;

        const volumeOrder = new Map<string, number>();
        bright.forEach((b, i) => { volumeOrder.set(b.id, i); });

        const sorted = [...filtered].sort((a, b) => {
            const oa = volumeOrder.get(a.volumeSegmentId) ?? 999;
            const ob = volumeOrder.get(b.volumeSegmentId) ?? 999;
            if (oa !== ob) return oa - ob;
            return a.number - b.number;
        });

        const renumbered = sorted.map((ch, idx) => {
            const newNum = idx + 1;
            if (ch.number !== newNum) {
                changed = true;
                return { ...ch, number: newNum };
            }
            return ch;
        });

        if (changed) saveChapters(pid, renumbered);
        setChapters(renumbered);
    }, [pid]);

    // ===== 选中章节加载内容 + 修订感知检测 + 上下文面板数据 =====
    useEffect(() => {
        if (selectedChapterId && pid) {
            const ch = chapters.find(c => c.id === selectedChapterId);
            if (ch) {
                const indent = "\u3000\u3000";
                const raw = ch.content ?? "";
                const content = raw.length === 0 ? indent
                    : raw.startsWith(indent) ? raw
                        : indent + raw;
                setEditingContent(content);
                savedContentRef.current = content;
                setIsDirty(false);
                setSelectionRange(null);
                // 修订感知：检测当前章节前面是否有被修改过的章节
                const stale = detectStaleAhead(pid, ch.number);
                setStaleInfo(stale.count > 0 ? stale : null);
                // 章节切换后同步渲染 HTML 到编辑器
                setTimeout(() => syncEditorHTML(content), 0);
                // 加载上下文面板数据
                loadContextPanelData(pid, ch.number, selectedChapterId);
            }
        }
    }, [selectedChapterId, chapters]);

    // ===== 上下文面板数据加载 =====
    const [ctxSummaries, setCtxSummaries] = useState<ChapterSummary[]>([]);
    const [ctxBeatCards, setCtxBeatCards] = useState<BeatCard[]>([]);
    const [ctxCharacters, setCtxCharacters] = useState<{ name: string; status?: string }[]>([]);
    const [ctxCollapsed, setCtxCollapsed] = useState(true);

    async function loadContextPanelData(projectId: string, chapterNumber: number, chapterId: string) {
        try {
            const [summaries, beatCards] = await Promise.all([
                api.getChapterSummaries(projectId).catch(() => [] as ChapterSummary[]),
                api.listBeatCards(chapterId).catch(() => [] as BeatCard[]),
            ]);
            setCtxSummaries(summaries.filter(s => s.chapter_number < chapterNumber && s.chapter_number >= chapterNumber - 5).sort((a, b) => a.chapter_number - b.chapter_number));
            setCtxBeatCards(beatCards);
            try {
                const raw = localStorage.getItem(`novel-workbench-log-${projectId}`);
                if (raw) {
                    const store = JSON.parse(raw);
                    const states = store.characterStates || [];
                    const active = states.filter((s: any) => s.last_active_chapter >= chapterNumber - 10);
                    setCtxCharacters(active.map((s: any) => ({ name: s.character_name, status: s.current_status })));
                }
            } catch { /* ignore */ }
        } catch { /* ignore */ }
    }

    // ===== 从 AI 面板插入文本到编辑器 =====
    const { pendingInsertContent, insertTextBump } = useAppStore();
    const prevBumpRef = useRef(0);
    useEffect(() => {
        if (insertTextBump > prevBumpRef.current && pendingInsertContent && selectedChapterId) {
            const indent = "\u3000\u3000";
            const lines = pendingInsertContent.split("\n").map((l: string) =>
                l.trim() ? indent + l : l
            ).join("\n");
            setEditingContent(prev => {
                const inserted = prev ? prev + "\n\n" + lines : lines;
                // 同步渲染 HTML 到编辑器（在回调中拿到最新值）
                setTimeout(() => syncEditorHTML(inserted), 0);
                return inserted;
            });
            useAppStore.setState({ pendingInsertContent: "" });
        }
        prevBumpRef.current = insertTextBump;
    }, [insertTextBump, selectedChapterId, pendingInsertContent]);

    // 编辑内容变化时跟踪脏状态
    useEffect(() => {
        setIsDirty(editingContent !== savedContentRef.current);
    }, [editingContent]);

    const selectedChapter = chapters.find(c => c.id === selectedChapterId);
    const selectedVolume = volumes.find(v => v.id === selectedChapter?.volumeSegmentId);

    // ===== 保存内容（纯文本保存，不调用 AI 摘要） =====
    const saveContent = useCallback(() => {
        if (!pid || !selectedChapterId || !selectedChapter) return;
        // 保存前推入撤销栈
        pushUndo(editingContent);
        setChapters(prev => {
            const upd = prev.map(c => c.id === selectedChapterId ? { ...c, content: editingContent } : c);
            saveChapters(pid, upd);
            return upd;
        });
        savedContentRef.current = editingContent;
        setIsDirty(false);
        bumpSavedChapterVersion(pid, selectedChapter.number);
        useAppStore.getState().setAutosaveStatus("✅ 已保存");
        const tid = setTimeout(() => useAppStore.getState().setAutosaveStatus("已就绪"), 2000);
        timeoutIdsRef.current.push(tid);
    }, [pid, selectedChapterId, selectedChapter, editingContent]);

    // ===== 新建章节 =====
    const addChapter = useCallback((volumeSegmentId: string) => {
        if (!pid) return;
        setChapters(prev => {
            const globalMax = prev.reduce((m, c) => Math.max(m, c.number), 0);
            const ch: PlotChapter = {
                id: uuid(),
                volumeSegmentId,
                number: globalMax + 1,
                title: newChapterTitle.trim(),
                content: "",
            };
            const updated = [...prev, ch];
            saveChapters(pid, updated);
            setShowAddDlg(null);
            setNewChapterTitle("");
            setSelectedChapterId(ch.id);
            return updated;
        });
    }, [pid, newChapterTitle]);

    // ===== 删除章节 =====
    const deleteChapter = useCallback((chId: string) => {
        if (!pid) return;
        const all = loadChapters(pid).filter(c => c.id !== chId);
        saveChapters(pid, all);
        setChapters(all);
        if (selectedChapterId === chId) { setSelectedChapterId(null); setEditingContent(""); }
    }, [pid, selectedChapterId]);

    // ===== 重命名 =====
    const renameChapter = useCallback((chId: string, newTitle: string) => {
        if (!pid) return;
        setChapters(prev => {
            const upd = prev.map(c => c.id === chId ? { ...c, title: newTitle } : c);
            saveChapters(pid, upd);
            return upd;
        });
    }, [pid]);

    // ===== AI 写本章（先弹窗确认字数+剧情方向） =====
    const [aiWriting, setAiWriting] = useState(false);
    const [aiError, setAiError] = useState("");
    const [humanizing, setHumanizing] = useState(false);

    const HUMANIZER_RULES = `你是文字编辑，专门去除 AI 生成文本的痕迹，使文字听起来更自然、更有人味。

核心原则：
1. 删除填充短语 — 去除开场白和强调性拐杖词
2. 打破公式结构 — 避免二元对比、戏剧性分段、修辞性设置
3. 变化节奏 — 混合句子长度，两项优于三项，段落结尾要多样化
4. 信任读者 — 直接陈述事实，跳过软化、辩解和手把手引导
5. 删除金句 — 如果听起来像可引用的语句，重写它

必须修复的 AI 痕迹：
- 过度强调意义（标志着、见证了、至关重要的、奠定基础、不断演变的格局）
- 宣传语言（充满活力的、丰富的、深刻的、令人叹为观止的、坐落于）
- 模糊归因（行业报告显示、专家认为、一些批评者认为）
- AI 高频词汇（此外、至关重要、深入探讨、强调、持久的、复杂/复杂性、格局、展示）
- 避免使用"是"（用"作为/代表/标志着"替代"是"）
- 否定式排比（"不仅……而且……"、"这不仅仅是……而是……"）
- 三段式法则（强行将想法分成三组）
- 破折号过度使用
- 粗体过度使用
- 协作交流痕迹（希望这对您有帮助、当然！、请告诉我）
- 填充短语（"为了实现这一目标"、"由于……的事实"）
- 过度限定（"可以潜在地可能被认为"）
- 通用积极结论（"公司的未来看起来光明"→具体事实）

注入灵魂：
- 有观点 — 不要只报告事实，对它们做出反应
- 变化节奏 — 混合长短句
- 承认复杂性 — 真实的人有复杂的感受
- 允许一些混乱 — 完美的结构像算法
- 对感受要具体 — 用具体细节替代抽象概括

直接输出改写后的完整文本，不要带分析和说明。`;

    // ===== AI精修 =====
    const handlePolish = useCallback(async () => {
        if (!pid || !selectedChapter || !editingContent.trim()) return;
        setPolishing(true);
        useAppStore.getState().setAutosaveStatus("正在精修...");
        try {
            const res = await api.aiComplete({
                action: "chat",
                entity_type: "chapter",
                entity_id: selectedChapter.id,
                extra: {
                    system_hint: POLISH_RULES,
                    user_message: `请对以下文本做精修（去AI味 + 段落优化）：\n\n${editingContent}`,
                    history: [],
                },
            });
            if (res.content && !res.error) {
                pushUndo(editingContent);
                setEditingContent(res.content);
                const tid = setTimeout(() => syncEditorHTML(res.content), 0);
                timeoutIdsRef.current.push(tid);
                setChapters(prev => {
                    const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: res.content } : c);
                    saveChapters(pid, upd);
                    return upd;
                });
                useAppStore.getState().setAutosaveStatus("✅ 精修完成");
            } else {
                useAppStore.getState().setAutosaveStatus("⚠ 精修失败：" + (res.error || "未知错误"));
            }
        } catch (e: any) {
            useAppStore.getState().setAutosaveStatus("⚠ 请求失败");
            console.error("polish failed:", e);
        } finally {
            setPolishing(false);
        }
    }, [pid, selectedChapter, editingContent]);

    const handleHumanize = useCallback(async () => {
        if (!pid || !selectedChapter || !editingContent.trim()) return;
        setHumanizing(true);
        useAppStore.getState().setAutosaveStatus("正在去 AI 味...");
        try {
            const res = await api.aiComplete({
                action: "chat",
                entity_type: "chapter",
                entity_id: selectedChapter.id,
                extra: {
                    system_hint: HUMANIZER_RULES,
                    user_message: `请去除以下文本的 AI 写作痕迹，使其更自然、更有人味：\n\n${editingContent}`,
                    history: [],
                },
            });
            if (res.content && !res.error) {
                pushUndo(editingContent);
                setEditingContent(res.content);
                const tid = setTimeout(() => syncEditorHTML(res.content), 0);
                timeoutIdsRef.current.push(tid);
                setChapters(prev => {
                    const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: res.content } : c);
                    saveChapters(pid, upd);
                    return upd;
                });
                useAppStore.getState().setAutosaveStatus("✅ 去 AI 味完成");
            } else {
                useAppStore.getState().setAutosaveStatus("⚠ 处理失败：" + (res.error || "未知错误"));
            }
        } catch (e: any) {
            useAppStore.getState().setAutosaveStatus("⚠ 请求失败");
            console.error("humanize failed:", e);
        } finally {
            setHumanizing(false);
        }
    }, [pid, selectedChapter, editingContent]);

    const handleAiWriteChapter = useCallback(async (wordCount: number, plotDirection: string) => {
        if (!pid || !selectedChapter) return;
        // 防止并发调用：如果上一次 AI 写作还在进行中则忽略
        if (aiWritingRef.current) return;
        aiWritingRef.current = true;
        setAiWriting(true);
        setAiError("");
        setWriteDlg(null);
        lastWriteParamsRef.current = { wordCount, plotDirection };

        try {
            const output = await buildProjectContext({
                projectId: pid,
                chapterId: selectedChapter.id,
                userIntent: undefined,
            });

            // 构建参考上下文（勾选的灵感/素材）
            let contextStr = "";
            if (refIds && refIds.length > 0) {
                const inspIds = refIds.filter(r => r.startsWith("insp:")).map(r => r.slice(5));
                if (inspIds.length > 0) {
                    const allCards = JSON.parse(localStorage.getItem(`inspiration-cards-${pid}`) || "[]");
                    const selected = allCards.filter((c: any) => inspIds.includes(c.id));
                    if (selected.length > 0) {
                        contextStr += "\n【灵感参考】\n";
                        for (const c of selected) {
                            contextStr += `- ${c.title || "无标题"}：${(c.content || "").slice(0, 300)}\n`;
                        }
                        contextStr += "\n";
                    }
                }
                const matIds = refIds.filter(r => r.startsWith("mat:")).map(r => r.slice(4));
                if (matIds.length > 0) {
                    const allItems = JSON.parse(localStorage.getItem(`material-items-${pid}`) || "[]");
                    const selected = allItems.filter((i: any) => matIds.includes(i.id) && (i.type === "text" || i.content));
                    if (selected.length > 0) {
                        contextStr += "\n【素材库参考】\n";
                        for (const t of selected) {
                            contextStr += `\n──── ${t.name || "未命名"} ────\n`;
                            if (t.structureAnalysis) {
                                contextStr += `【结构分析】\n${t.structureAnalysis}\n\n`;
                            }
                            contextStr += `【原文】\n${t.content}\n`;
                        }
                        contextStr += "\n";
                    }
                }
            }

            // 组装带字数+剧情方向的 user_message
            let userMsg = `请写第${selectedChapter.number}章「${selectedChapter.title}」。`;
            userMsg += `\n\n字数要求：约 ${wordCount} 字。`;
            if (plotDirection) {
                userMsg += `\n\n剧情方向：\n${plotDirection}`;
            }
            if (contextStr) {
                userMsg += `\n\n参考素材：\n${contextStr}`;
            }
            userMsg += `\n\n根据以上上下文，写出本章正文。`;

            const res = await api.aiComplete({
                action: "write_chapter",
                entity_type: "chapter",
                entity_id: selectedChapter.id,
                extra: {
                    system_hint: output.systemHint,
                    user_message: userMsg,
                    history: [],
                },
            });

            if (res.error) {
                setAiError(res.error);
            } else {
                // AI 写本章前，先把编辑器当前内容推入撤销栈
                if (editingContent) {
                    pushUndo(editingContent);
                }
                setEditingContent(res.content);
                const tid = setTimeout(() => syncEditorHTML(res.content), 0);
                timeoutIdsRef.current.push(tid);
                setChapters(prev => {
                    const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: res.content } : c);
                    saveChapters(pid, upd);
                    return upd;
                });

                // ★ 质量检查：定稿前自动校验
                const qualityResult = await runQualityCheck({
                    projectId: pid,
                    chapterId: selectedChapter.id,
                    chapterNumber: selectedChapter.number,
                    chapterContent: res.content,
                });

                // 有 error 时弹出自定义面板
                const errors = qualityResult.checks.filter(c => c.severity === "error");
                let userProceed = true;
                if (errors.length > 0) {
                    userProceed = await new Promise<boolean>((resolve) => {
                        setQualityPanel({
                            checks: qualityResult.checks,
                            onProceed: () => {
                                setQualityPanel(null);
                                resolve(true);
                            },
                            onReject: () => {
                                setQualityPanel(null);
                                resolve(false);
                            },
                        });
                    });
                }

                if (!userProceed) {
                    setAiWriting(false);
                    return;
                }

                // AI 写完后自动生成摘要
                await updateMemory({
                    projectId: pid,
                    chapterNumber: selectedChapter.number,
                    chapterTitle: selectedChapter.title,
                    chapterContent: res.content,
                    characters: [],
                }).catch((e) => {
                    console.error("AI 写完后自动生成摘要失败:", e);
                });

                // 定稿后自动创建快照
                if (pid) {
                    createSnapshot(pid, `第${selectedChapter.number}章定稿`);
                }

                // ★ AI 识别本章新出场角色（异步，不阻塞）
                aiExtractNewCharacters(pid, selectedChapter.number, res.content);
            }
        } catch (e) {
            setAiError(String(e));
        } finally {
            setAiWriting(false);
            aiWritingRef.current = false;
        }
    }, [pid, selectedChapter]);

    // ===== 级联重跑记忆 =====
    const handleRebase = useCallback(async () => {
        if (!pid) return;
        setRebaseRunning(true);
        setRebaseProgress(null);
        try {
            await rebaseMemory(pid, staleInfo?.fromChapter || 1, (current, total) => {
                setRebaseProgress({ current, total });
            });
            setStaleInfo(null);
            useAppStore.getState().setAutosaveStatus("✅ 级联重跑完成");
            // 重新加载上下文面板
            if (selectedChapterId) {
                const ch = chapters.find(c => c.id === selectedChapterId);
                if (ch) loadContextPanelData(pid, ch.number, selectedChapterId);
            }
        } catch (e) {
            console.error("rebaseMemory failed:", e);
            useAppStore.getState().setAutosaveStatus("⚠ 级联重跑失败");
        } finally {
            setRebaseRunning(false);
            setRebaseProgress(null);
        }
    }, [pid, selectedChapterId, chapters]);

    /** 将选中的章节内容读取到 AI 上下文（临时，不进记忆） */
    const handleReadToAI = useCallback(() => {
        if (!pid || storeSelIds.length === 0) return;
        const selSet = new Set(storeSelIds);
        const selected = chapters
            .filter(ch => selSet.has(ch.id))
            .sort((a, b) => a.number - b.number);
        const parts = selected.map(ch => {
            const body = (ch.content || '').replace(/<[^>]+>/g, '').trim();
            return `【第${ch.number}章「${ch.title}」】\n${body ? body.slice(0, 3000) : "（暂无正文）"}`;
        });
        const contextText = `===== 📖 选取的章节正文 =====\n${parts.join("\n\n")}`;
        useAppStore.getState().setEphemeralChapterContext(contextText);
        useAppStore.getState().setAutosaveStatus(`✅ 已读取 ${selected.length} 章到 AI 上下文，在右侧聊天框发送后自动清空`);
    }, [pid, chapters, storeSelIds]);

    // ===== 拖拽调整侧栏宽度 =====
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (!resizingRef.current) return;
            const { startX, startW } = resizeStartRef.current;
            const dx = e.clientX - startX;
            setSidebarWidth(Math.max(200, Math.min(600, startW + dx)));
        };
        const up = () => {
            if (!resizingRef.current) return;
            resizingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (pid) localStorage.setItem("writing-sidebar-width-" + pid, String(sidebarWidthRef.current));
        };
        document.addEventListener('mousemove', handler);
        document.addEventListener('mouseup', up);
        return () => { document.removeEventListener('mousemove', handler); document.removeEventListener('mouseup', up); };
    }, [pid]);

    if (!currentProject || !pid) return null;

    return (
        <div className="flex h-full">
            {/* 左侧：卷章树（在导航和编辑器中间） */}
            <aside style={{ width: sidebarWidth }} className="relative shrink-0 overflow-y-auto border-r bg-white p-4">
                {/* 拖拽手柄 */}
                <div
                    className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-amber-400/50 active:bg-amber-500"
                    onMouseDown={e => { e.preventDefault(); resizeStartRef.current = { startX: e.clientX, startW: sidebarWidth }; resizingRef.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }}
                />
                <h2 className="mb-3 text-lg font-bold">
                    {selectMode ? "选取章节到 AI" : "卷章树"}
                    {selectMode && storeSelIds.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-violet-600">已选 {storeSelIds.length} 章</span>
                    )}
                </h2>
                {selectMode && (
                    <div className="mb-3 flex items-center gap-2">
                        <button onClick={handleReadToAI}
                            className="rounded-md bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
                            disabled={storeSelIds.length === 0}>
                            读取到AI ({storeSelIds.length})
                        </button>
                        <button onClick={() => { setChapterSelectMode(false); storeSetSelIds([]); }}
                            className="rounded-md border px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                            取消
                        </button>
                    </div>
                )}
                {volumes.length === 0 && (
                    <p className="text-xs text-slate-400">暂无剧情走向，请先在大纲·剧情走向中创建明暗线段落</p>
                )}
                {volumes.map(vol => {
                    const volChapters = chapters.filter(c => c.volumeSegmentId === vol.id).sort((a, b) => a.number - b.number);
                    const colKey = "v-" + vol.id;
                    const isCol = volCollapsed[colKey];
                    const allSel = volChapters.length > 0 && volChapters.every(c => selIdSet.has(c.id));
                    const someSel = volChapters.some(c => selIdSet.has(c.id));
                    return (
                        <div key={vol.id} className="mb-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                    {selectMode && (
                                        <input type="checkbox" checked={allSel}
                                            ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
                                            onChange={() => {
                                                const cur = new Set(storeSelIds);
                                                if (allSel) volChapters.forEach(c => cur.delete(c.id));
                                                else volChapters.forEach(c => cur.add(c.id));
                                                storeSetSelIds(Array.from(cur));
                                            }}
                                            className="shrink-0 accent-violet-600"
                                        />
                                    )}
                                    <button onClick={() => setVolCollapsed(p => ({ ...p, [colKey]: !isCol }))}
                                        className="text-xs text-slate-400 hover:text-slate-600 shrink-0 w-4">
                                        {isCol ? "▶" : "▼"}
                                    </button>
                                    <p className="text-base font-semibold text-slate-700 truncate">{vol.title}</p>
                                </div>
                                <button onClick={() => { setShowAddDlg(vol.id); setNewChapterTitle(""); }}
                                    className="text-amber-600 hover:text-amber-700 shrink-0 ml-1" title="添加章节">
                                    <Plus size={18} />
                                </button>
                            </div>
                            {!isCol && (
                                <>
                                    {volChapters.length === 0 && (
                                        <p className="ml-2 mt-1 text-xs text-slate-300">暂无章节，点击 + 添加</p>
                                    )}
                                    {volChapters.map(ch => (
                                        <div key={ch.id} className="group flex items-center">
                                            {selectMode && (
                                                <input type="checkbox" checked={selIdSet.has(ch.id)}
                                                    onChange={() => {
                                                        const cur = new Set(storeSelIds);
                                                        if (cur.has(ch.id)) cur.delete(ch.id); else cur.add(ch.id);
                                                        storeSetSelIds(Array.from(cur));
                                                    }}
                                                    className="shrink-0 ml-1 accent-violet-600"
                                                />
                                            )}
                                            <button
                                                onClick={() => { if (!selectMode) setSelectedChapterId(ch.id); }}
                                                className={`mt-1 flex-1 rounded px-2 py-1.5 text-left text-base flex items-center gap-1.5 ${selectedChapterId === ch.id && !selectMode ? "bg-amber-100" : "hover:bg-slate-50"
                                                    }`}
                                            >
                                                <FileText size={14} className="text-slate-400 shrink-0" />
                                                <span className="text-slate-400 shrink-0 w-[3.6rem]">第{ch.number}章</span>
                                                {renamingId === ch.id ? (
                                                    <input
                                                        className="ml-1 flex-1 min-w-0 rounded border border-amber-400 px-1 py-0 text-base outline-none"
                                                        value={renameText}
                                                        onChange={e => setRenameText(e.target.value)}
                                                        onBlur={() => { renameChapter(ch.id, renameText); setRenamingId(null); }}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') { renameChapter(ch.id, renameText); setRenamingId(null); }
                                                            if (e.key === 'Escape') setRenamingId(null);
                                                        }}
                                                        autoFocus
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <span
                                                        className="ml-1 flex-1 min-w-0 truncate rounded px-1 py-0.5 hover:bg-slate-100 cursor-text"
                                                        onClick={e => { e.stopPropagation(); if (!selectMode) { setSelectedChapterId(ch.id); setRenameText(ch.title); setRenamingId(ch.id); } }}
                                                        title="点击修改章节名"
                                                    >
                                                        {ch.title || '未命名'}
                                                    </span>
                                                )}
                                            </button>
                                            {!selectMode && (
                                                <button onClick={() => {
                                                    if (window.confirm(`确定删除「第${ch.number}章 ${ch.title}」？`)) deleteChapter(ch.id);
                                                }}
                                                    className="ml-1 hidden group-hover:block text-red-400 hover:text-red-600" title="删除章节">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    );
                })}

                {/* 加章弹窗 */}
                {showAddDlg && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
                        onClick={() => setShowAddDlg(null)}>
                        <div className="rounded-xl border bg-white p-4 shadow-xl" onClick={e => e.stopPropagation()} style={{ minWidth: 280 }}>
                            <h3 className="mb-3 text-sm font-semibold">新建章节</h3>
                            <div className="mb-2 text-xs text-slate-400">
                                将自动生成：第{nextChapterNumber}章
                            </div>
                            <input className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-amber-400"
                                value={newChapterTitle} onChange={e => setNewChapterTitle(e.target.value)}
                                placeholder="输入章节名称" autoFocus
                                onKeyDown={e => { if (e.key === "Enter" && showAddDlg) addChapter(showAddDlg); if (e.key === "Escape") setShowAddDlg(null); }} />
                            <div className="mt-3 flex justify-end gap-2">
                                <button className="rounded-lg border px-4 py-1.5 text-sm hover:bg-slate-50" onClick={() => setShowAddDlg(null)}>取消</button>
                                <button className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600" onClick={() => showAddDlg && addChapter(showAddDlg)}>创建</button>
                            </div>
                        </div>
                    </div>
                )}
            </aside>

            {/* 中间：上下文预览面板（可折叠，类似右侧抽屉） */}
            {selectedChapter && (
                <>
                    {/* 折叠状态的窄条 + 展开按钮 */}
                    {ctxCollapsed ? (
                        <button
                            onClick={() => setCtxCollapsed(false)}
                            className="flex w-6 shrink-0 items-center justify-center border-r bg-white text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                            title="展开上下文面板"
                        >
                            <span className="[writing-mode:vertical-lr] tracking-widest">📋上下文</span>
                        </button>
                    ) : (
                        <aside className="w-[280px] shrink-0 overflow-y-auto border-r bg-white p-3 text-xs">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-slate-700">📋 本章上下文</h3>
                                <button
                                    onClick={() => setCtxCollapsed(true)}
                                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                    title="折叠上下文面板"
                                >
                                    <span className="text-xs">✕</span>
                                </button>
                            </div>

                            {/* 节拍卡片 */}
                            {ctxBeatCards.length > 0 && (
                                <div className="mb-3">
                                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-violet-600">节拍</p>
                                    <div className="space-y-1">
                                        {ctxBeatCards.map(b => (
                                            <div key={b.id} className="rounded border border-violet-100 bg-violet-50/50 px-2 py-1 text-[10px] text-slate-600">
                                                <span className="font-medium text-violet-700">[{colLabel[b.column_type] || b.column_type}]</span> {b.content}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 前情摘要 */}
                            {ctxSummaries.length > 0 && (
                                <div className="mb-3">
                                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-amber-600">前情摘要</p>
                                    <div className="space-y-1.5">
                                        {ctxSummaries.map(s => (
                                            <div key={s.chapter_number} className="rounded border border-amber-100 bg-amber-50/30 px-2 py-1.5">
                                                <p className="mb-0.5 text-[10px] font-medium text-amber-800">第{s.chapter_number}章 {s.chapter_title}</p>
                                                <p className="text-[10px] leading-relaxed text-slate-500">{s.summary?.slice(0, 80)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 出场角色 */}
                            {ctxCharacters.length > 0 && (
                                <div className="mb-3">
                                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-blue-600">活跃角色</p>
                                    <div className="flex flex-wrap gap-1">
                                        {ctxCharacters.slice(0, 10).map(c => (
                                            <span key={c.name} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                                                {c.name}{c.status ? ` · ${c.status}` : ""}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {ctxBeatCards.length === 0 && ctxSummaries.length === 0 && ctxCharacters.length === 0 && (
                                <p className="text-[10px] text-slate-400">暂无上下文数据，开始写作后自动生成</p>
                            )}
                        </aside>
                    )}
                </>
            )}

            {/* 右侧：正文编辑器 */}
            <div className="flex flex-1 flex-col min-w-0">
                {selectedChapter ? (
                    <>
                        {/* 修订感知横幅 */}
                        {staleInfo && !rebaseRunning && (
                            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                                <span>⚠️ 检测到 {staleInfo.count} 条过时记录（{staleInfo.chapters} 的摘要/角色状态已基于旧版本）</span>
                                <button onClick={handleRebase}
                                    className="ml-auto rounded-md bg-amber-500 px-2.5 py-1 text-xs text-white hover:bg-amber-600">
                                    重跑记忆
                                </button>
                            </div>
                        )}
                        {/* 重跑进度条 */}
                        {rebaseProgress && (
                            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                                <span>⏳ 正在重跑记忆：第{rebaseProgress.current}/{rebaseProgress.total}章</span>
                                <div className="h-2 flex-1 rounded-full bg-amber-200">
                                    <div className="h-2 rounded-full bg-amber-500 transition-all"
                                        style={{ width: `${(rebaseProgress.current / rebaseProgress.total) * 100}%` }} />
                                </div>
                            </div>
                        )}
                        <div className="flex items-center justify-between border-b bg-white px-4 py-2">
                            <div>
                                <h1 className="text-lg font-bold">
                                    <span className="text-slate-400">第{selectedChapter.number}章</span> {selectedChapter.title}
                                </h1>
                                <p className="text-xs text-slate-400">{selectedVolume?.title || ""}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {aiError && (
                                    <span className="text-xs text-red-500">{aiError}</span>
                                )}
                                <button
                                    type="button"
                                    className="flex items-center justify-center gap-1.5 rounded-md bg-violet-600 w-[72px] py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
                                    onClick={() => setWriteDlg({ wordCount: 2000, plotDirection: "" })}
                                    disabled={!selectedChapter || aiWriting}
                                >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    {aiWriting ? "AI 写作中..." : "AI写文"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleHumanize}
                                    disabled={!selectedChapter || !editingContent.trim() || humanizing}
                                    className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 w-[72px] py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    {humanizing ? "处理中..." : "AI去味"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handlePolish}
                                    disabled={!selectedChapter || !editingContent.trim() || polishing}
                                    className="flex items-center justify-center gap-1.5 rounded-md bg-amber-600 w-[72px] py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                                >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    {polishing ? "精修中..." : "AI精修"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleUndo}
                                    disabled={!canUndo}
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                                    title="撤回 (Ctrl+Z)"
                                >
                                    <Undo2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRedo}
                                    disabled={!canRedo}
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                                    title="重做 (Ctrl+Y)"
                                >
                                    <Redo2 className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={saveContent}
                                    className={`rounded-lg px-4 py-1 text-sm text-white ${isDirty ? "bg-amber-500 hover:bg-amber-600" : "bg-slate-300 cursor-default"}`}>
                                    保存
                                </button>
                                {/* 定稿按钮（保存 + 更新记忆 + 快照） */}
                                <button type="button" onClick={async () => {
                                    if (!pid || !selectedChapter || !selectedChapterId) return;
                                    // 先保存
                                    saveContent();
                                    // 更新记忆（摘要 + 角色状态 + 故事线 + 伏笔）
                                    useAppStore.getState().setAutosaveStatus("正在生成摘要...");
                                    try {
                                        await updateMemory({
                                            projectId: pid,
                                            chapterNumber: selectedChapter.number,
                                            chapterTitle: selectedChapter.title,
                                            chapterContent: editingContent,
                                            characters: [],
                                        });
                                        useAppStore.getState().setAutosaveStatus("✅ 摘要已生成");
                                    } catch (e) {
                                        console.error("定稿 - 摘要生成失败:", e);
                                        useAppStore.getState().setAutosaveStatus("⚠ 摘要生成失败");
                                    }
                                    // 创建快照标记定稿
                                    createSnapshot(pid, `第${selectedChapter.number}章「${selectedChapter.title}」定稿`);
                                    // AI 识别新角色
                                    aiExtractNewCharacters(pid, selectedChapter.number, editingContent);
                                    useAppStore.getState().setAutosaveStatus("✅ 已定稿");
                                }} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700">
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    定稿
                                </button>
                                {/* 退回重写按钮 */}
                                {lastWriteParamsRef.current && (
                                    <button type="button" onClick={() => {
                                        const p = lastWriteParamsRef.current!;
                                        setWriteDlg({ wordCount: p.wordCount, plotDirection: p.plotDirection });
                                    }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" title="用相同参数让 AI 重新生成">
                                        退回重写
                                    </button>
                                )}
                                <button type="button" onClick={async () => {
                                    if (!pid || !selectedChapter) return;
                                    const store = useAppStore.getState();
                                    store.setAutosaveStatus("正在生成摘要...");
                                    try {
                                        await updateMemory({
                                            projectId: pid,
                                            chapterNumber: selectedChapter.number,
                                            chapterTitle: selectedChapter.title,
                                            chapterContent: editingContent,
                                            characters: [],
                                        });
                                        store.setAutosaveStatus("✅ 摘要已生成");
                                    } catch (e) {
                                        store.setAutosaveStatus("⚠ 摘要生成失败");
                                    }
                                    setTimeout(() => store.setAutosaveStatus("已就绪"), 2500);
                                }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title="生成本章摘要，供后续章节作为前情上下文">
                                    <FileText className="h-3.5 w-3.5 inline mr-1" />生成摘要
                                </button>

                                <button type="button" onClick={() => {
                                    const indent = "\u3000\u3000";
                                    const lines = editingContent.split("\n");
                                    const result: string[] = [];
                                    let prevBlank = false;
                                    for (let i = 0; i < lines.length; i++) {
                                        const trimmed = lines[i].trim();
                                        if (!trimmed) {
                                            if (!prevBlank) { result.push(""); prevBlank = true; }
                                            continue;
                                        }
                                        if (result.length > 0 && !prevBlank) result.push("");
                                        prevBlank = false;
                                        if (/^[「『"“]/.test(trimmed) || lines[i].startsWith(indent)) {
                                            result.push(lines[i]);
                                        } else {
                                            result.push(indent + trimmed);
                                        }
                                    }
                                    const formatted = result.join("\n");
                                    setEditingContent(formatted);
                                    setTimeout(() => syncEditorHTML(formatted), 0);
                                }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title="自动排版段落缩进">
                                    <AlignLeft className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                        <div className="relative flex-1 min-h-0">
                            <>
                                <div
                                    ref={editorRef as any}
                                    className="absolute inset-0 overflow-y-auto bg-stone-50 p-6 font-serif text-base font-medium leading-relaxed text-stone-800 outline-none cursor-text"
                                    contentEditable
                                    suppressContentEditableWarning
                                    onInput={e => {
                                        const text = (e.currentTarget as HTMLElement).innerText || "";
                                        // 用户输入时推入撤销栈（防抖：仅当内容变化时）
                                        if (text !== editingContent) {
                                            if (!_ignoreNextInput.current) {
                                                pushUndo(editingContent);
                                            }
                                            _ignoreNextInput.current = false;
                                            setEditingContent(text);
                                        }
                                    }}
                                    onMouseUp={e => {
                                        if (insertLockRef.current) return;
                                        const sel = window.getSelection();
                                        if (!sel || !sel.rangeCount) return;
                                        const selectedText = sel.toString();
                                        if (selectedText) {
                                            const idx = editingContent.indexOf(selectedText);
                                            if (idx >= 0) {
                                                setAiDialog({
                                                    start: idx,
                                                    end: idx + selectedText.length,
                                                    text: selectedText,
                                                    mouseX: e.clientX, mouseY: e.clientY,
                                                });
                                            }
                                        }
                                        // 不设置 setAiDialog(null)，对话框弹出后常驻，只通过 ✕ 关闭
                                    }}
                                    onKeyDown={e => {
                                        if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                                            e.preventDefault();
                                            handleUndo();
                                        }
                                        if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
                                            e.preventDefault();
                                            handleRedo();
                                        }
                                    }}
                                />
                            </>
                        </div>
                        {/* 字数统计栏 */}
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t bg-white px-4 py-1 text-xs text-slate-400">
                            {(() => {
                                const text = editingContent || "";
                                const totalChars = text.replace(/\s/g, "").length;
                                const paragraphs = text.split("\n").filter(l => l.trim()).length;
                                const selText = selectionRange ? text.slice(selectionRange.start, selectionRange.end) : "";
                                const selChars = selText.replace(/\s/g, "").length;
                                return (
                                    <>
                                        {selChars > 0 && <span>{selChars}/{totalChars}</span>}
                                        <span>{totalChars} 字 · {paragraphs} 段</span>
                                    </>
                                );
                            })()}
                        </div>
                    </>
                ) : (
                    <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
                        从左侧选择一个章节开始写作
                    </div>
                )}
            </div>

            {/* AI 写本章弹窗（字数+剧情方向） */}
            {writeDlg && selectedChapter && (
                <AiWriteChapterDialog
                    chapterNumber={selectedChapter.number}
                    chapterTitle={selectedChapter.title}
                    onConfirm={(wordCount, plotDirection, refIds) => {
                        handleAiWriteChapter(wordCount, plotDirection, refIds);
                    }}
                    onClose={() => setWriteDlg(null)}
                />
            )}

            {/* AI 写作弹窗 */}
            {aiDialog && (
                <AiWritingDialog
                    selectedText={aiDialog.text}
                    fullText={editingContent}
                    selectionStart={aiDialog.start}
                    selectionEnd={aiDialog.end}
                    onClose={() => setAiDialog(null)}
                    onReplace={(newText) => {
                        undoContentStackRef.current.push(editingContent);
                        setEditingContent(newText);
                        setTimeout(() => syncEditorHTML(newText), 0);
                        insertLockRef.current = true;
                        setTimeout(() => { insertLockRef.current = false; }, 500);
                    }}
                />
            )}

            {/* 质量检查结果面板 */}
            {qualityPanel && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setQualityPanel(null)}>
                    <div className="w-full max-w-lg rounded-xl border bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h3 className="mb-3 text-lg font-bold text-slate-800">📋 质量检查结果</h3>
                        <div className="max-h-80 space-y-2 overflow-y-auto">
                            {qualityPanel.checks.map((c, i) => (
                                <div key={i} className={`rounded-lg border px-3 py-2.5 text-sm ${c.severity === "error" ? "border-red-200 bg-red-50" :
                                    c.severity === "warning" ? "border-amber-200 bg-amber-50" :
                                        "border-green-200 bg-green-50"
                                    }`}>
                                    <div className="flex items-center gap-1.5 font-medium">
                                        <span>{c.severity === "error" ? "❌" : c.severity === "warning" ? "⚠️" : "✅"}</span>
                                        <span>{c.message}</span>
                                    </div>
                                    <p className="mt-0.5 text-xs text-slate-500">{c.detail}</p>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            {qualityPanel.checks.some(c => c.severity === "error") && (
                                <button onClick={qualityPanel.onReject}
                                    className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                                    退回重写
                                </button>
                            )}
                            <button onClick={qualityPanel.onProceed}
                                className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700">
                                {qualityPanel.checks.some(c => c.severity === "error") ? "忽略问题，继续定稿" : "确认通过"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
