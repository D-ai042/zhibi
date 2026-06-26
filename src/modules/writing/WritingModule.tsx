// WritingModule.tsx — 写作台主组件（T6 拆分薄壳，逻辑全保留）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { rebaseMemory } from "@/lib/memory-updater";
import { AiWritingDialog } from "@/components/editor/AiWritingDialog";
import { AiWriteChapterDialog } from "@/components/editor/AiWriteChapterDialog";
import { renderMarkdown } from "@/lib/markdown";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { confirmDialog } from "@/lib/confirm";
import { loadAllChapters, saveChapter, saveAllChapters, deleteChapter as deleteStoredChapter, type Chapter as PlotChapter } from "@/lib/chapter-store";
import type { ChapterSummary, BeatCard } from "@/types";
import { uuid } from "@/lib/uuid";
import { ChapterTree } from "./ChapterTree";
import { ChapterEditor } from "./ChapterEditor";
import { ContextPanel } from "./ContextPanel";
import { useAiWriting } from "./useAiWriting";
import { finalizeChapter } from "./finalizeChapter";

interface PlotSegment { id: string; project_id: string; type: "bright" | "dark"; title: string; characters: string; location: string; time: string; event: string; }

function loadSegments(pid: string): PlotSegment[] { return getJSONSync(`plot-segments-${pid}`, []); }
function loadEdges(pid: string): { source: string; target: string; sourceHandle?: string; targetHandle?: string }[] { return getJSONSync(`plot-edges-${pid}`, []); }
function bumpSavedChapterVersion(projectId: string, chapterNumber: number) { try { const key = `novel-workbench-log-${projectId}`; const store = getJSONSync(key, {} as any); if (!store) return; store.chapterVersions = store.chapterVersions || {}; store.chapterVersions[String(chapterNumber)] = (store.chapterVersions[String(chapterNumber)] || 0) + 1; setJSONSync(key, store); } catch { } }

function detectStaleAhead(projectId: string, currentChapterNumber: number): { count: number; chapters: string; fromChapter: number } {
    try { const store = getJSONSync(`novel-workbench-log-${projectId}`, {} as any); const deps = store.dependencies || []; const stale = deps.filter((d: any) => { const dc = parseInt(d.dependsOnChapter); return dc <= currentChapterNumber && d.status === "stale"; }); if (stale.length === 0) return { count: 0, chapters: "", fromChapter: 0 }; const depsChs: number[] = []; const seen = new Set<number>(); for (const d of stale) { const n = parseInt(d.dependsOnChapter); if (!seen.has(n)) { seen.add(n); depsChs.push(n); } } depsChs.sort((a, b) => a - b); const first = depsChs[0]; const last = depsChs[depsChs.length - 1]; return { count: stale.length, chapters: first === last ? `第${first}章` : `第${first}-${last}章`, fromChapter: first }; } catch { return { count: 0, chapters: "", fromChapter: 0 }; }
}

const CN_NUMS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
function migrateTitle(ch: PlotChapter): string { const ap = `第${ch.number}章`; if (ch.title.startsWith(ap)) return ch.title.slice(ap.length).replace(/^\s*/, ''); const cp = `第${CN_NUMS[ch.number] ?? ch.number}章`; if (ch.title.startsWith(cp)) return ch.title.slice(cp.length).replace(/^\s*/, ''); return ch.title; }

export function WritingModule() {
    const { currentProject, chapterSelectMode: selectMode, selectedChapterIds: storeSelIds, setChapterSelectMode, setSelectedChapterIds: storeSetSelIds, pendingInsertContent, insertTextBump } = useAppStore();
    const [chapters, setChapters] = useState<PlotChapter[]>([]);
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState("");
    const [showAddDlg, setShowAddDlg] = useState<string | null>(null);
    const [newChapterTitle, setNewChapterTitle] = useState("");
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameText, setRenameText] = useState("");
    const nextChapterNumber = useMemo(() => chapters.reduce((m, c) => Math.max(m, c.number), 0) + 1, [chapters]);
    const [aiDialog, setAiDialog] = useState<{ start: number; end: number; text: string; mouseX: number; mouseY: number } | null>(null);
    const [staleInfo, setStaleInfo] = useState<{ count: number; chapters: string; fromChapter: number } | null>(null);
    const [rebaseRunning, setRebaseRunning] = useState(false);
    const [rebaseProgress, setRebaseProgress] = useState<{ current: number; total: number } | null>(null);
    const selIdSet = new Set(storeSelIds);
    const [volCollapsed, setVolCollapsed] = useState<Record<string, boolean>>({});
    const editorRef = useRef<HTMLDivElement>(null);
    const [fontSize, setFontSize] = useState<number>(getJSONSync("editor-font-size", 16));
    const insertLockRef = useRef(false);
    const _ignoreNextInput = useRef(false);
    const editingContentRef = useRef(editingContent); editingContentRef.current = editingContent;
    const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    useEffect(() => () => { timeoutIdsRef.current.forEach(clearTimeout); timeoutIdsRef.current = []; }, []);

    function syncEditorHTML(content: string) { if (editorRef.current) editorRef.current.innerHTML = renderMarkdown(content); }
    const savedContentRef = useRef(""); const [isDirty, setIsDirty] = useState(false);
    const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
    const undoContentStackRef = useRef<string[]>([]); const redoContentStackRef = useRef<string[]>([]);
    const [canUndo, setCanUndo] = useState(false); const [canRedo, setCanRedo] = useState(false);

    function pushUndo() { const content = editingContentRef.current; const stack = undoContentStackRef.current; if (stack.length > 0 && stack[stack.length - 1] === content) return; stack.push(content); if (stack.length > 50) stack.shift(); redoContentStackRef.current = []; setCanUndo(true); setCanRedo(false); }
    const handleUndo = useCallback(function () { const stack = undoContentStackRef.current; if (stack.length === 0) return; const prev = stack.pop()!; redoContentStackRef.current.push(editingContentRef.current); setEditingContent(prev); const tid = setTimeout(() => syncEditorHTML(prev), 0); timeoutIdsRef.current.push(tid); setCanUndo(stack.length > 0); setCanRedo(true); }, []);
    const handleRedo = useCallback(function () { const stack = redoContentStackRef.current; if (stack.length === 0) return; const next = stack.pop()!; undoContentStackRef.current.push(editingContentRef.current); setEditingContent(next); const tid = setTimeout(() => syncEditorHTML(next), 0); timeoutIdsRef.current.push(tid); setCanRedo(stack.length > 0); setCanUndo(true); }, []);
    useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); } if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); handleRedo(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [handleUndo, handleRedo]);

    const [sidebarWidth, setSidebarWidth] = useState(() => { try { const projectId = currentProject?.id; if (projectId) { const saved = getJSONSync("writing-sidebar-width-" + projectId, null) as string | null; if (saved) return Math.max(200, Math.min(600, Number(saved))); } } catch { } return 320; });
    const sidebarWidthRef = useRef(sidebarWidth); sidebarWidthRef.current = sidebarWidth; const resizingRef = useRef(false); const resizeStartRef = useRef({ startX: 0, startW: 0 });
    const pid = currentProject?.id;

    const volumes = useMemo(() => {
        if (!pid) return []; const segs = loadSegments(pid); const edges = loadEdges(pid); const bright = segs.filter(s => s.type === "bright"); const dark = segs.filter(s => s.type === "dark"); const brightMap = new Map(bright.map(b => [b.id, b])); const idMap = new Map(segs.map(s => [s.id, s])); const sortedIds = getSortedBrightIds(pid);
        return sortedIds.map(id => { const b = brightMap.get(id)!; const connectedDarkIds = new Set<string>(); for (const e of edges) { const src = idMap.get(e.source); const tgt = idMap.get(e.target); if (src?.id === b.id && tgt?.type === "dark") connectedDarkIds.add(tgt.id); if (tgt?.id === b.id && src?.type === "dark") connectedDarkIds.add(src.id); } const darkSegs = dark.filter(d => connectedDarkIds.has(d.id)); const suffix = darkSegs.length > 0 ? "—" + darkSegs.map(d => d.title).join("、") : ""; return { id: b.id, title: b.title + suffix, brightTitle: b.title, darkTitles: darkSegs.map(d => d.title) }; });
    }, [pid]);

    function getSortedBrightIds(projectId: string): string[] {
        const segs = loadSegments(projectId); const edges = loadEdges(projectId); const bright = segs.filter(s => s.type === "bright"); if (!bright.length) return []; const bi = new Set(bright.map(b => b.id)); const idg = new Map<string, number>(); const adj = new Map<string, string[]>(); for (const b of bright) { idg.set(b.id, 0); adj.set(b.id, []); }
        for (const e of edges) { if (bi.has(e.source) && bi.has(e.target)) { adj.get(e.source)?.push(e.target); idg.set(e.target, (idg.get(e.target) || 0) + 1); } }
        const q: string[] = []; const sorted: string[] = []; for (const [id, deg] of idg) { if (deg === 0) q.push(id); }
        while (q.length > 0) { q.sort((a, b) => bright.findIndex(x => x.id === a) - bright.findIndex(x => x.id === b)); const id = q.shift()!; sorted.push(id); for (const n of adj.get(id) || []) { const nd = (idg.get(n) || 1) - 1; idg.set(n, nd); if (nd === 0) q.push(n); } }
        if (sorted.length < bright.length) { const ss = new Set(sorted); for (const b of bright) { if (!ss.has(b.id)) sorted.push(b.id); } }
        return sorted;
    }

    useEffect(() => {
        if (!pid) return; let loaded = loadAllChapters(pid); let changed = false;
        const migrated = loaded.map(ch => { const n = migrateTitle(ch); if (n !== ch.title) { changed = true; return { ...ch, title: n }; } return ch; });
        const segs = loadSegments(pid); const bright = segs.filter(s => s.type === "bright"); const vvi = new Set(bright.map(b => b.id));
        const filtered = migrated.filter(ch => vvi.has(ch.volumeSegmentId)); if (filtered.length < migrated.length) changed = true;
        const sortedBright = getSortedBrightIds(pid); const vo = new Map<string, number>(); sortedBright.forEach((id, i) => vo.set(id, i));
        const sorted = [...filtered].sort((a, b) => { const oa = vo.get(a.volumeSegmentId) ?? 999; const ob = vo.get(b.volumeSegmentId) ?? 999; if (oa !== ob) return oa - ob; return a.number - b.number; });
        const renumbered = sorted.map((ch, idx) => { const nn = idx + 1; if (ch.number !== nn) { changed = true; return { ...ch, number: nn }; } return ch; });
        if (changed) { const r = saveAllChapters(pid, renumbered); if (!r.ok) useAppStore.getState().setAutosaveStatus("⚠ 章节迁移保存失败"); } setChapters(renumbered);
    }, [pid]);

    const _skipNextChapterEffect = useRef(false);
    useEffect(() => {
        if (_skipNextChapterEffect.current) { _skipNextChapterEffect.current = false; return; }
        if (selectedChapterId && pid) { const ch = chapters.find(c => c.id === selectedChapterId); if (ch) { const indent = "\u3000\u3000"; const raw = ch.content ?? ""; const content = raw.length === 0 ? indent : raw.startsWith(indent) ? raw : indent + raw; setEditingContent(content); savedContentRef.current = content; setIsDirty(false); setSelectionRange(null); const stale = detectStaleAhead(pid, ch.number); setStaleInfo(stale.count > 0 ? stale : null); setTimeout(() => syncEditorHTML(content), 0); loadCtx(pid, ch.number, selectedChapterId); } }
    }, [selectedChapterId, chapters]);

    const [ctxSummaries, setCtxSummaries] = useState<ChapterSummary[]>([]);
    const [ctxBeatCards, setCtxBeatCards] = useState<BeatCard[]>([]);
    const [ctxCharacters, setCtxCharacters] = useState<{ name: string; status?: string }[]>([]);
    const [ctxPrevContent, setCtxPrevContent] = useState<{ number: number; title: string; content: string } | null>(null);
    const [ctxWorldRules, setCtxWorldRules] = useState<string[]>([]);
    const [ctxStyleRedlines, setCtxStyleRedlines] = useState("");
    const [ctxStyleNarrative, setCtxStyleNarrative] = useState("");
    const [ctxStyleTone, setCtxStyleTone] = useState("");
    const [ctxCollapsed, setCtxCollapsed] = useState(true);
    const loadGenRef = useRef(0);
    async function loadCtx(projectId: string, chapterNumber: number, chapterId: string) {
        const gen = ++loadGenRef.current;
        try {
            const [summaries, beatCards, styleGuide] = await Promise.all([api.getChapterSummaries(projectId).catch(() => [] as any[]), api.listBeatCards(chapterId).catch(() => [] as any[]), api.getStyleGuide(projectId).catch(() => null)]); if (gen !== loadGenRef.current) return; setCtxSummaries(summaries.filter((s: any) => s.chapter_number < chapterNumber && s.chapter_number >= chapterNumber - 5).sort((a: any, b: any) => a.chapter_number - b.chapter_number)); setCtxBeatCards(beatCards); if (styleGuide) { setCtxStyleRedlines((styleGuide as any).writing_rules || ""); setCtxStyleNarrative((styleGuide as any).narrative_style || ""); setCtxStyleTone((styleGuide as any).writing_tone || ""); } else { setCtxStyleRedlines(""); setCtxStyleNarrative(""); setCtxStyleTone(""); }
            try { const store = getJSONSync(`novel-workbench-log-${projectId}`, {} as any); const states = store?.characterStates || []; if (gen === loadGenRef.current) setCtxCharacters(states.filter((s: any) => s.last_active_chapter >= chapterNumber - 10).map((s: any) => ({ name: s.character_name, status: s.current_status }))); } catch { }
            try { if (gen === loadGenRef.current) { const allTerms = await api.listWorldTerms(projectId); const rules = allTerms.filter(t => t.term_type === "rule").map(t => `· ${t.title}：${t.one_liner || ""}`); setCtxWorldRules(rules.slice(0, 8)); } } catch { setCtxWorldRules([]); }
            try { if (gen === loadGenRef.current) { const allChapters = loadAllChapters(projectId); const prev = allChapters.find((ch: any) => ch.number === chapterNumber - 1); if (prev?.content) { const clean = prev.content.replace(/<[^>]+>/g, '').trim(); if (clean) setCtxPrevContent({ number: prev.number, title: prev.title || "", content: clean.slice(-3000) }); else setCtxPrevContent(null); } else setCtxPrevContent(null); } } catch { setCtxPrevContent(null); }
        } catch { }
    }

    const prevBumpRef = useRef(0);
    useEffect(() => { if (insertTextBump > prevBumpRef.current && pendingInsertContent && selectedChapterId) { const indent = "\u3000\u3000"; const lines = pendingInsertContent.split("\n").map((l: string) => l.trim() ? indent + l : l).join("\n"); setEditingContent(prev => { const inserted = prev ? prev + "\n\n" + lines : lines; setTimeout(() => syncEditorHTML(inserted), 0); return inserted; }); useAppStore.setState({ pendingInsertContent: "" }); } prevBumpRef.current = insertTextBump; }, [insertTextBump, selectedChapterId, pendingInsertContent]);
    useEffect(() => { setIsDirty(editingContent !== savedContentRef.current); }, [editingContent]);

    const selectedChapter = chapters.find(c => c.id === selectedChapterId);
    const selectedVolume = volumes.find(v => v.id === selectedChapter?.volumeSegmentId);

    const saveContent = useCallback(() => { if (!pid || !selectedChapterId || !selectedChapter) return; pushUndo(); const updatedChapter = { ...selectedChapter, content: editingContent }; const nextChapters = chapters.map(c => c.id === selectedChapterId ? updatedChapter : c); try { _skipNextChapterEffect.current = true; const saved = saveChapter(pid, updatedChapter); if (!saved.ok) throw new Error(saved.error || "保存失败"); setChapters(nextChapters); savedContentRef.current = editingContent; setIsDirty(false); bumpSavedChapterVersion(pid, selectedChapter.number); useAppStore.getState().setAutosaveStatus("✅ 已保存"); const tid = setTimeout(() => useAppStore.getState().setAutosaveStatus("已就绪"), 2000); timeoutIdsRef.current.push(tid); } catch (e) { useAppStore.getState().setAutosaveStatus("⚠ 保存失败，请重试"); } }, [pid, selectedChapterId, selectedChapter, editingContent, chapters]);
    const saveContentRef = useRef(saveContent); saveContentRef.current = saveContent;
    useEffect(() => { useAppStore.getState().setTriggerAutosave(() => saveContentRef.current()); return () => useAppStore.getState().setTriggerAutosave(() => { }); }, []);

    const DRAFT_KEY = (p: string, c: string) => `draft-${p}-${c}`;
    const [, setPendingDraft] = useState<{ content: string; savedAt: string } | null>(null);
    useEffect(() => { if (!editingContent || !selectedChapterId || !pid) return; const t = setTimeout(() => { setJSONSync(DRAFT_KEY(pid, selectedChapterId), { content: editingContent, savedAt: new Date().toISOString() }); }, 2000); return () => clearTimeout(t); }, [editingContent, selectedChapterId, pid]);
    useEffect(() => { if (selectedChapterId && pid) { const draft = getJSONSync(DRAFT_KEY(pid, selectedChapterId), null as { content: string; savedAt: string } | null); if (draft && draft.content !== savedContentRef.current) setPendingDraft(draft); else setPendingDraft(null); } }, [selectedChapterId, pid]);

    const addChapter = useCallback((volumeSegmentId: string) => { if (!pid) return; const gm = chapters.reduce((m, c) => Math.max(m, c.number), 0); const ch: PlotChapter = { id: uuid(), volumeSegmentId, number: gm + 1, title: newChapterTitle.trim(), content: "" }; const saved = saveChapter(pid, ch); if (!saved.ok) { useAppStore.getState().setAutosaveStatus("⚠ 保存失败，请重试"); return; } setChapters(prev => [...prev, ch]); setShowAddDlg(null); setNewChapterTitle(""); setSelectedChapterId(ch.id); }, [pid, chapters, newChapterTitle]);
    const deleteChapter = useCallback(async (chId: string) => { if (!pid) return; const ch = chapters.find(c => c.id === chId); if (!await confirmDialog(`确定删除「${ch?.title || chId}」？章节内容将永久丢失。`)) return; deleteStoredChapter(pid, chId); setChapters(prev => prev.filter(c => c.id !== chId)); if (selectedChapterId === chId) { setSelectedChapterId(null); setEditingContent(""); } }, [pid, selectedChapterId, chapters]);
    const renameChapter = useCallback((chId: string, newTitle: string) => { if (!pid) return; const renamed = chapters.find(c => c.id === chId); if (renamed) { const r = saveChapter(pid, { ...renamed, title: newTitle }); if (!r.ok) useAppStore.getState().setAutosaveStatus("⚠ 重命名保存失败"); } setChapters(prev => prev.map(c => c.id === chId ? { ...c, title: newTitle } : c)); }, [pid, chapters]);

    // AI writing hook — all handlers extracted to useAiWriting.ts
    const persistAiChapters = useCallback((projectId: string, chs: PlotChapter[]) => { const current = selectedChapterId ? chs.find(c => c.id === selectedChapterId) : undefined; const r = current ? saveChapter(projectId, current) : saveAllChapters(projectId, chs); if (!r.ok) useAppStore.getState().setAutosaveStatus("⚠ AI 内容保存失败"); }, [selectedChapterId]);
    const { aiWriting, aiError, humanizing, polishing, writeDlg, setWriteDlg, lastWriteParamsRef, handleAiWriteChapter, handleHumanize, handlePolish } = useAiWriting(pid, selectedChapter, editingContent, pushUndo, setEditingContent, (updater) => setChapters(prev => { const upd = updater(prev); persistAiChapters(pid!, upd); return upd; }), persistAiChapters, syncEditorHTML);

    const handleRebase = useCallback(async () => { if (!pid) return; setRebaseRunning(true); setRebaseProgress(null); try { await rebaseMemory(pid, staleInfo?.fromChapter || 1, (c, t) => setRebaseProgress({ current: c, total: t })); setStaleInfo(null); useAppStore.getState().setAutosaveStatus("✅ 级联重跑完成"); if (selectedChapterId) { const ch = chapters.find(c => c.id === selectedChapterId); if (ch) loadCtx(pid, ch.number, selectedChapterId); } } catch { useAppStore.getState().setAutosaveStatus("⚠ 级联重跑失败"); } finally { setRebaseRunning(false); setRebaseProgress(null); } }, [pid, selectedChapterId, chapters, staleInfo]);

    const handleReadToAI = useCallback(() => { if (!pid || storeSelIds.length === 0) return; const selSet = new Set(storeSelIds); const sel = chapters.filter(ch => selSet.has(ch.id)).sort((a, b) => a.number - b.number); const parts = sel.map(ch => { const body = (ch.content || '').replace(/<[^>]+>/g, '').trim(); return `【第${ch.number}章「${ch.title}」】\n${body ? body.slice(0, 3000) : "（暂无正文）"}`; }); useAppStore.getState().setEphemeralChapterContext(`===== 选取的章节正文 =====\n${parts.join("\n\n")}`); useAppStore.getState().setAutosaveStatus(`✅ 已读取 ${sel.length} 章到 AI 上下文`); }, [pid, chapters, storeSelIds]);

    useEffect(() => { const h = (e: MouseEvent) => { if (!resizingRef.current) return; const dx = e.clientX - resizeStartRef.current.startX; setSidebarWidth(Math.max(200, Math.min(600, resizeStartRef.current.startW + dx))); }; const u = () => { if (!resizingRef.current) return; resizingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; if (pid) try { setJSONSync("writing-sidebar-width-" + pid, sidebarWidthRef.current); } catch { } }; document.addEventListener('mousemove', h); document.addEventListener('mouseup', u); return () => { document.removeEventListener('mousemove', h); document.removeEventListener('mouseup', u); }; }, [pid]);

    if (!currentProject || !pid) return <div className="flex h-full items-center justify-center text-slate-400 text-sm">请先选择或创建项目</div>;

    const handleFinalize = useCallback(async () => { if (!pid || !selectedChapter || !selectedChapterId) return; saveContent(); const result = await finalizeChapter(pid, selectedChapterId, selectedChapter.number, selectedChapter.title, editingContent); if (!result.ok) { const failedSteps = result.steps.filter(s => !s.ok); const msg = failedSteps.map(s => `· ${s.name}：${s.error || "失败"}`).join("\n"); useAppStore.getState().addChatMessage({ id: uuid(), role: "system", content: `⚠️ 定稿部分步骤失败：\n${msg}`, created_at: new Date().toISOString() }); } }, [pid, selectedChapter, selectedChapterId, editingContent, saveContent]);

    return (
        <div className="flex h-full">
            <ChapterTree
                sidebarWidth={sidebarWidth} selectMode={selectMode} storeSelIds={storeSelIds} selIdSet={selIdSet}
                volumes={volumes} chapters={chapters} selectedChapterId={selectedChapterId}
                volCollapsed={volCollapsed} showAddDlg={showAddDlg} newChapterTitle={newChapterTitle}
                renameText={renameText} renamingId={renamingId} nextChapterNumber={nextChapterNumber}
                onResizeStart={e => { e.preventDefault(); resizeStartRef.current = { startX: e.clientX, startW: sidebarWidth }; resizingRef.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }}
                onReadToAI={handleReadToAI} onCancelSelect={() => { setChapterSelectMode(false); storeSetSelIds([]); }}
                onVolCollapseToggle={(colKey) => setVolCollapsed(p => ({ ...p, [colKey]: !(p[colKey]) }))}
                onShowAddDlg={(volId) => { setShowAddDlg(volId); if (volId) setNewChapterTitle(""); }}
                onNewChapterTitleChange={setNewChapterTitle} onChapterSelect={setSelectedChapterId}
                onSelectAllInVolume={(vid, allSel) => { const vc = chapters.filter(c => c.volumeSegmentId === vid); const cur = new Set(storeSelIds); if (allSel) vc.forEach(c => cur.delete(c.id)); else vc.forEach(c => cur.add(c.id)); storeSetSelIds(Array.from(cur)); }}
                onSelectToggle={(chId) => { const cur = new Set(storeSelIds); if (cur.has(chId)) cur.delete(chId); else cur.add(chId); storeSetSelIds(Array.from(cur)); }}
                onStartRename={(chId, title) => { setRenameText(title); setRenamingId(chId); }} onRenameTextChange={setRenameText}
                onCommitRename={(chId) => { renameChapter(chId, renameText); setRenamingId(null); }} onCancelRename={() => setRenamingId(null)}
                onDeleteChapter={deleteChapter} onAddChapter={addChapter}
            />
            {selectedChapter && (
                <ContextPanel collapsed={ctxCollapsed} onToggle={setCtxCollapsed}
                    summaries={ctxSummaries} beatCards={ctxBeatCards} characters={ctxCharacters}
                    prevContent={ctxPrevContent} worldRules={ctxWorldRules}
                    styleRedlines={ctxStyleRedlines} styleNarrative={ctxStyleNarrative} styleTone={ctxStyleTone}
                />
            )}
            <ChapterEditor
                selectedChapter={selectedChapter} selectedVolume={selectedVolume}
                editingContent={editingContent} isDirty={isDirty}
                aiWriting={aiWriting} humanizing={humanizing} polishing={polishing} aiError={aiError}
                fontSize={fontSize} staleInfo={staleInfo} rebaseRunning={rebaseRunning} rebaseProgress={rebaseProgress}
                canUndo={canUndo} canRedo={canRedo} selectionRange={selectionRange}
                lastWriteParams={lastWriteParamsRef.current} editorRef={editorRef}
                onAiWrite={() => setWriteDlg({ wordCount: 2000, plotDirection: "" })}
                onHumanize={handleHumanize} onPolish={handlePolish}
                onUndo={handleUndo} onRedo={handleRedo} onSave={saveContent}
                onFinalize={handleFinalize} onRebase={handleRebase}
                onRetryWrite={() => { const p = lastWriteParamsRef.current!; setWriteDlg({ wordCount: p.wordCount, plotDirection: p.plotDirection }); }}
                onAutoFormat={() => { const indent = "\u3000\u3000"; const lines = editingContent.split("\n"); const result: string[] = []; let prevBlank = false; for (const line of lines) { const t = line.trim(); if (!t) { if (!prevBlank) { result.push(""); prevBlank = true; } continue; } if (result.length > 0 && !prevBlank) result.push(""); prevBlank = false; if (/^[「『"“]/.test(t) || line.startsWith(indent)) result.push(line); else result.push(indent + t); } const formatted = result.join("\n"); setEditingContent(formatted); setTimeout(() => syncEditorHTML(formatted), 0); }}
                onFontSizeChange={(n) => { setFontSize(n); setJSONSync("editor-font-size", n); }}
                onEditorInput={e => { const text = (e.currentTarget as HTMLElement).innerText || ""; if (text !== editingContent) { if (!_ignoreNextInput.current) pushUndo(); _ignoreNextInput.current = false; setEditingContent(text); } }}
                onEditorMouseUp={e => { if (insertLockRef.current) return; const sel = window.getSelection(); if (!sel || !sel.rangeCount) return; const st = sel.toString(); if (st) { const idx = editingContent.indexOf(st); if (idx >= 0) setAiDialog({ start: idx, end: idx + st.length, text: st, mouseX: e.clientX, mouseY: e.clientY }); } }}
                onEditorKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); } if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); handleRedo(); } }}
            />
            {writeDlg && selectedChapter && (
                <AiWriteChapterDialog chapterNumber={selectedChapter.number} chapterTitle={selectedChapter.title}
                    onConfirm={(wordCount, plotDirection, refIds) => { handleAiWriteChapter(wordCount, plotDirection, refIds); }}
                    onClose={() => setWriteDlg(null)} />
            )}
            {aiDialog && (
                <AiWritingDialog selectedText={aiDialog.text} fullText={editingContent}
                    selectionStart={aiDialog.start} selectionEnd={aiDialog.end}
                    onClose={() => setAiDialog(null)}
                    onReplace={(newText) => { undoContentStackRef.current.push(editingContent); setEditingContent(newText); setTimeout(() => syncEditorHTML(newText), 0); insertLockRef.current = true; setTimeout(() => { insertLockRef.current = false; }, 500); }} />
            )}
        </div>
    );
}
