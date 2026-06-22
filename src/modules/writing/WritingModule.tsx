// WritingModule.tsx — 写作台主组件（T6 瘦身壳）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, AlignLeft } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { assembleContext } from "@/lib/context-engine";
import type { ContextPanelData } from "@/types";
import { createSnapshot } from "@/lib/memory-updater";
import { AiWritingDialog } from "@/components/editor/AiWritingDialog";
import { AiWriteChapterDialog } from "@/components/editor/AiWriteChapterDialog";
import { ContextPanel } from "./ContextPanel";
import { ChapterTree } from "./ChapterTree";
import { ChapterEditor } from "./ChapterEditor";
import { useAiWriting } from "./useAiWriting";
import { finalizeChapter, type FinalizeResult } from "./finalizeChapter";
import { renderMarkdown } from "@/lib/markdown";
import { getJSONSync, setJSONSync, loadJSON } from "@/lib/storage";
import { loadAllChapters, saveChapter, type Chapter } from "@/lib/chapter-store";
import { uuid } from "@/lib/uuid";

type PlotChapter = Chapter;

function loadSegments(pid: string) { return getJSONSync("plot-segments-" + pid, []); }
function bumpSavedChapterVersion(pid: string, n: number) { try { const s = getJSONSync("novel-workbench-log-" + pid, {} as any); if (!s) return; s.chapterVersions = s.chapterVersions || {}; s.chapterVersions[String(n)] = (s.chapterVersions[String(n)] || 0) + 1; setJSONSync("novel-workbench-log-" + pid, s); } catch { /* ignore */ } }

export function WritingModule() {
  const { currentProject, chapterSelectMode: selectMode, selectedChapterIds: storeSelIds, setChapterSelectMode, setSelectedChapterIds } = useAppStore();
  const pid = currentProject?.id;
  const [chapters, setChapters] = useState<PlotChapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(loadJSON("writing-sidebar-width", 320));
  const [ctxCollapsed, setCtxCollapsed] = useState(false);
  const [fontSize, setFontSize] = useState<number>(getJSONSync("editor-font-size", 16));
  const [isDirty, setIsDirty] = useState(false);
  const savedContentRef = useRef(""); const editingContentRef = useRef(""); editingContentRef.current = editingContent;
  const editorRef = useRef<HTMLDivElement>(null);
  const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timeoutIdsRef.current.forEach(clearTimeout); timeoutIdsRef.current = []; }, []);
  // undo/redo
  const undoStackRef = useRef<string[]>([]); const redoStackRef = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false); const [canRedo, setCanRedo] = useState(false);
  const pushUndo = useCallback(() => { const c = editingContentRef.current; if (undoStackRef.current[undoStackRef.current.length-1] === c) return; undoStackRef.current.push(c); if (undoStackRef.current.length > 50) undoStackRef.current.shift(); redoStackRef.current = []; setCanUndo(true); setCanRedo(false); }, []);
  const handleUndo = useCallback(() => { if (undoStackRef.current.length === 0) return; const prev = undoStackRef.current.pop()!; redoStackRef.current.push(editingContentRef.current); setEditingContent(prev); const tid = setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = renderMarkdown(prev); }, 0); timeoutIdsRef.current.push(tid); setCanUndo(undoStackRef.current.length > 0); setCanRedo(true); }, []);
  const handleRedo = useCallback(() => { if (redoStackRef.current.length === 0) return; const next = redoStackRef.current.pop()!; undoStackRef.current.push(editingContentRef.current); setEditingContent(next); const tid = setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = renderMarkdown(next); }, 0); timeoutIdsRef.current.push(tid); setCanRedo(redoStackRef.current.length > 0); setCanUndo(true); }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey||e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); } if ((e.ctrlKey||e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); handleRedo(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [handleUndo, handleRedo]);
  // resize sidebar
  const resizeRef = useRef(false);
  const handleResizeStart = useCallback((e: React.MouseEvent) => { e.preventDefault(); resizeRef.current = true; const onMove = (ev: MouseEvent) => { if (!resizeRef.current) return; const w = Math.max(200, Math.min(500, ev.clientX)); setSidebarWidth(w); }; const onUp = () => { resizeRef.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); saveJSON("writing-sidebar-width", sidebarWidth); }; document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp); }, []);

  // load chapters
  useEffect(() => { if (!pid) return; const chs = loadAllChapters(pid); setChapters(chs); if (!selectedChapterId && chs.length > 0) setSelectedChapterId(chs[0].id); }, [pid]);
  const selectedChapter = useMemo(() => chapters.find(c => c.id === selectedChapterId), [chapters, selectedChapterId]);
  const volumes = useMemo(() => { const segs = loadSegments(pid || ""); const volMap = new Map<string, { id: string; title: string }>(); for (const s of segs) { if (s.type === "bright") volMap.set(s.id, { id: s.id, title: s.title }); } return [...volMap.values()]; }, [pid]);
  const volMap = useMemo(() => { const m = new Map<string, string>(); for (const v of volumes) m.set(v.id, v.title); return m; }, [volumes]);
  const selectedVolume = useMemo(() => selectedChapter ? { title: volMap.get(selectedChapter.volumeSegmentId) || "" } : null, [selectedChapter, volMap]);

  // load chapter content
  useEffect(() => { if (!selectedChapter) return; setEditingContent(selectedChapter.content || ""); savedContentRef.current = selectedChapter.content || ""; setIsDirty(false); const tid = setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = renderMarkdown(selectedChapter.content || ""); }, 0); timeoutIdsRef.current.push(tid); }, [selectedChapter?.id]);

  // save
  const saveContent = useCallback(() => { if (!pid || !selectedChapterId || !selectedChapter) return; pushUndo(); const c = { ...selectedChapter, content: editingContent }; const r = saveChapter(pid, c); if (!r.ok) { useAppStore.getState().setAutosaveStatus("⚠ 保存失败"); return; } setChapters(prev => prev.map(x => x.id === selectedChapterId ? c : x)); savedContentRef.current = editingContent; setIsDirty(false); bumpSavedChapterVersion(pid, selectedChapter.number); const tid = setTimeout(() => useAppStore.getState().setAutosaveStatus("已就绪"), 2000); timeoutIdsRef.current.push(tid); }, [pid, selectedChapterId, selectedChapter, editingContent, pushUndo]);
  // autosave
  useEffect(() => { if (!isDirty || !pid) return; const tid = setTimeout(saveContent, 30000); timeoutIdsRef.current.push(tid); return () => clearTimeout(tid); }, [isDirty, saveContent, pid]);
  useEffect(() => { useAppStore.getState().setTriggerAutosave(saveContent); }, [saveContent]);

  // AI writing hook
  const { aiWriting, humanizing, polishing, aiError, rebaseRunning, rebaseProgress, staleInfo, writeDlg, setWriteDlg, handleAiWriteChapter, handleHumanize, handlePolish, handleRebase, handleReadToAI, setStaleInfo } = useAiWriting(pid, selectedChapter, editingContent, chapters, setEditingContent, setChapters, saveContent, pushUndo, (c) => { const tid = setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = renderMarkdown(c); }, 0); timeoutIdsRef.current.push(tid); });
  // finalize
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);
  const handleFinalize = useCallback(async () => { if (!pid || !selectedChapter) return; await saveContent(); const res = await finalizeChapter(pid, selectedChapter); setFinalizeResult(res); }, [pid, selectedChapter, saveContent]);

  // context panel
  const [ctxData, setCtxData] = useState<ContextPanelData | null>(null);
  useEffect(() => { if (!pid || !selectedChapterId) return; assembleContext(pid, selectedChapterId, "panel").then(d => setCtxData(d as ContextPanelData)); }, [pid, selectedChapterId]);

  // chapter operations
  const handleAddChapter = useCallback((volId: string, title: string) => { if (!pid) return; const num = chapters.filter(c => c.volumeSegmentId === volId).length + 1; const ch: PlotChapter = { id: uuid(), volumeSegmentId: volId, number: num, title, content: "" }; saveChapter(pid, ch); setChapters(prev => [...prev, ch]); }, [pid, chapters]);
  const handleDeleteChapter = useCallback((id: string) => { if (!pid) return; setChapters(prev => prev.filter(c => c.id !== id)); if (selectedChapterId === id) setSelectedChapterId(null); try { localStorage.removeItem("chapter-" + pid + "-" + id); } catch { /* ignore */ } }, [pid, selectedChapterId]);

  // autosave trigger register
  useEffect(() => { useAppStore.getState().setTriggerAutosave(saveContent); }, [saveContent]);

  if (!currentProject) return <div className="flex h-full items-center justify-center text-slate-400 text-sm">请先选择或创建项目</div>;

  return (
    <div className="flex h-full">
      <ChapterTree pid={pid!} volumes={volumes} chapters={chapters} selectedChapterId={selectedChapterId}
        selectMode={selectMode} storeSelIds={storeSelIds} sidebarWidth={sidebarWidth}
        onChapterSelect={setSelectedChapterId} onAddChapter={handleAddChapter} onDeleteChapter={handleDeleteChapter}
        onRenameChapter={(id, t) => setChapters(prev => prev.map(c => c.id === id ? { ...c, title: t } : c))}
        onSelectToggle={id => setSelectedChapterIds(storeSelIds.includes(id) ? storeSelIds.filter(x => x !== id) : [...storeSelIds, id])}
        onSelectAllInVolume={vid => { const ids = chapters.filter(c => c.volumeSegmentId === vid).map(c => c.id); setSelectedChapterIds(ids); }}
        onCancelSelect={() => { setChapterSelectMode(false); setSelectedChapterIds([]); }}
        onReadToAI={handleReadToAI} onResizeStart={handleResizeStart} />

      {selectedChapter && ctxData && (
        <ContextPanel collapsed={ctxCollapsed} onToggle={setCtxCollapsed}
          summaries={ctxData.summaries || []} beatCards={ctxData.beatCards || []} characters={ctxData.characters || []}
          prevContent={ctxData.prevContent || ""} worldRules={ctxData.worldRules || ""}
          styleRedlines={ctxData.styleRedlines || ""} styleNarrative={ctxData.styleNarrative || ""}
          styleTone={ctxData.styleTone || ""} />
      )}

      <ChapterEditor selectedChapter={selectedChapter} selectedVolume={selectedVolume}
        editingContent={editingContent} isDirty={isDirty} aiWriting={aiWriting} humanizing={humanizing}
        polishing={polishing} aiError={aiError} fontSize={fontSize}
        staleInfo={staleInfo} rebaseRunning={rebaseRunning} rebaseProgress={rebaseProgress}
        onContentChange={setEditingContent} onSave={saveContent} onUndo={handleUndo} onRedo={handleRedo}
        onAiWrite={() => setWriteDlg({ wordCount: 2000, plotDirection: "" })}
        onHumanize={handleHumanize} onPolish={handlePolish} onRebase={handleRebase} />

      {writeDlg && <AiWriteChapterDialog wordCount={writeDlg.wordCount} plotDirection={writeDlg.plotDirection}
        onConfirm={(wc, pd, refs) => { setWriteDlg(null); handleAiWriteChapter(wc, pd, refs); }}
        onClose={() => setWriteDlg(null)} />}

      {finalizeResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setFinalizeResult(null)}>
          <div className="rounded-xl bg-white p-6 shadow-xl max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">{finalizeResult.ok ? "✅ 定稿完成" : "❌ 定稿失败"}</h3>
            <div className="space-y-2 text-sm">
              {finalizeResult.steps.map((s, i) => <div key={i} className="flex items-center gap-2">{s.ok ? "✅" : "❌"} {s.name}{s.error && <span className="text-xs text-red-500">: {s.error}</span>}</div>)}
            </div>
            <button onClick={() => setFinalizeResult(null)} className="mt-4 w-full rounded-lg bg-violet-600 py-2 text-sm text-white hover:bg-violet-700">关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
