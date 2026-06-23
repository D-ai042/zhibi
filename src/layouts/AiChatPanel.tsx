// AiChatPanel.tsx — AI 对话面板壳（T7 拆分，按业务拆分）
import { useRef, useEffect, useState, useCallback } from "react";
import { Sparkles, FileText, Trash2, Square, Mic, MicOff, Paperclip, Send, X, ClipboardPlus, Eraser, Download, Edit3, Copy, RotateCcw } from "lucide-react";
import { useSttRecorder } from "@/lib/use-stt";
import { api } from "@/lib/api";
import { useAiChatStream, type AiChatStreamCallbacks } from "./useAiChatStream";
import { useAppStore } from "@/stores/app-store";
import { MemoryEngine } from "@/lib/memory-engine";
import type { ChatMessage, MemoryEntry, WorldTerm } from "@/types";
import { MODULE_LABEL, OUTLINE_SECTION_LABEL } from "@/types";
import { uuid } from "@/lib/uuid";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { loadAllChapters, saveChapter } from "@/lib/chapter-store";
import { usePendingCharacters } from "./usePendingCharacters";
import { ChatPanelLayout } from "./ChatPanelLayout";

interface UploadedFile { id: string; name: string; size: number; content: string; }
const TEXT_EXTENSIONS = [".txt", ".md", ".json", ".csv", ".yaml", ".yml", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h", ".rs", ".go", ".rb", ".sh", ".bat", ".ps1", ".env", ".cfg", ".ini", ".toml", ".tex", ".rtf", ".log", ".docx"];
function formatSize(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

const WELCOME: ChatMessage = { id: "welcome", role: "assistant", content: "我是你的小说创作助手。\n\n⚠️ 使用前请在「API 设置」中配置对应厂商的 API Key，未配置时 AI 功能不可用。\n\n建议流程：\n1. 在大纲里完善【世界观】【人物关系】【剧情走向】\n2. 在【写作台】中按卷章写作，可随时框选文字进行扩写/润色/续写\n3. 告诉我你想创建什么新模块，我会为你生成并添加到左侧导航\n\n试试说：\n• 「创建一个情节检查面板」\n• 「帮我做一个角色分析模块」\n• 「创建一个伏笔追踪面板」", created_at: new Date().toISOString() };

function contextHint(): string { const { activeModule, outlineSection, selectedEntity, currentProject } = useAppStore.getState(); const parts = [`作品：${currentProject?.name ?? "未命名"}`]; if (activeModule === "custom") parts.push("自定义模块"); else { parts.push(`模块：${MODULE_LABEL[activeModule]}`); if (activeModule === "outline") parts.push(`大纲分组：${OUTLINE_SECTION_LABEL[outlineSection]}`); } if (selectedEntity) parts.push(`选中：${selectedEntity.type} / ${selectedEntity.name}`); return parts.join(" · "); }

export function AiChatPanel() {
  const { chatMessages, addChatMessage, appendChatMessages, clearChat, activeModule, outlineSection, currentProject, memoryBump, pendingAiCharsBump, chapterSelectMode } = useAppStore();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [memoryTab, setMemoryTab] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [sttLoading, setSttLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingPhase, setStreamingPhase] = useState<"idle" | "thinking" | "content" | "done">("idle");
  const [thinkingDuration, setThinkingDuration] = useState(0);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const editingContentRef = useRef(""); editingContentRef.current = editingContent;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const memoryEngineRef = useRef<MemoryEngine | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const stt = useSttRecorder();

  // STT toggle
  const handleSttToggle = useCallback(async () => { if (stt.stateRef.current === "recording") { setSttLoading(true); const text = await stt.stopAndTranscribe(); setSttLoading(false); if (text) setInput(prev => prev + text); } else { stt.startRecording(); } }, [stt]);

  const messages = (chatMessages.length > 0 ? chatMessages.filter(Boolean) : [WELCOME]);
  useEffect(() => { const el = chatContainerRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, loading, streamingContent, streamingThinking]);

  // Memory
  useEffect(() => { if (currentProject?.id) { memoryEngineRef.current = new MemoryEngine(currentProject.id); setMemoryEntries(memoryEngineRef.current.getShortTerm()); } else { memoryEngineRef.current = null; setMemoryEntries([]); } }, [currentProject?.id]);
  useEffect(() => { if (memoryEngineRef.current) setMemoryEntries(memoryEngineRef.current.getShortTerm()); }, [memoryBump]);

  // Pending state
  const { pendingTerms, setPendingTerms, pendingEdges, setPendingEdges, pendingChars, setPendingChars, pendingCharEdges, setPendingCharEdges, pendingRemoveEdges, setPendingRemoveEdges, pendingSnapshots, setPendingSnapshots, pendingPlotSegments, setPendingPlotSegments, pendingPlotEdges, setPendingPlotEdges, pendingPlotBeats, setPendingPlotBeats, pendingChapters, setPendingChapters, loadedRef } = usePendingCharacters(currentProject?.id, pendingAiCharsBump);

  // AI 流式调用 Hook
  const { send, stopStream: _stopStream } = useAiChatStream(
    memoryEngineRef,
    {
      setStreamingContent, setStreamingThinking, setStreamingPhase, setThinkingDuration, setLoading,
      setMemoryEntries,
      setPendingTerms, setPendingEdges, setPendingChars, setPendingCharEdges,
      setPendingRemoveEdges, setPendingSnapshots,
      setPendingPlotSegments, setPendingPlotEdges, setPendingPlotBeats,
      setPendingChapters,
    } satisfies AiChatStreamCallbacks
  );

  // Business: handleInsert — with zone selection dialog
  const [insertZoneDlg, setInsertZoneDlg] = useState<"core" | "locked" | "active" | "other" | null>(null);
  const handleInsert = useCallback(async () => {
    if (pendingTerms.length === 0) { appendChatMessages([{ id: uuid(), role: "system", content: "⚠️ 没有待插入的词条", created_at: new Date().toISOString() }]); return; }
    setInsertZoneDlg("active");
  }, [pendingTerms, appendChatMessages]);
  const confirmInsert = useCallback(async (zone: "core" | "locked" | "active" | "other") => {
    setInsertZoneDlg(null); const s = useAppStore.getState(); const cur = s.currentProject; if (!cur) return;
    const CX = 600, CY = 400;
    const ORIGINS: Record<string, { x: number; y: number }> = { core: { x: 60, y: 60 }, locked: { x: CX + 60, y: 60 }, active: { x: 60, y: CY + 60 }, other: { x: CX + 60, y: CY + 60 } };
    const origin = ORIGINS[zone];
    const allT = await api.listWorldTerms(cur.id);
    const zoneT = allT.filter(t => (t.zone ?? "other") === zone);
    const SX = 290, SY = 210, MPR = 5;
    const occ = new Set<string>();
    for (const t of zoneT) {
      if ((t.layout_x || 0) === 0 && (t.layout_y || 0) === 0) continue;
      const gx = Math.round(((t.layout_x || 0) - origin.x) / SX);
      const gy = Math.round(((t.layout_y || 0) - origin.y) / SY);
      if (gx >= 0 && gx < MPR && gy >= 0) occ.add(gx + "," + gy);
    }
    const idMap = new Map<string, string>(); const titles: string[] = [];
    let col = 0, row = 0;
    for (const term of pendingTerms) {
      const id = uuid(); idMap.set(term.title, id);
      while (occ.has(col + "," + row)) { col++; if (col >= MPR) { col = 0; row++; } }
      const px = origin.x + col * SX, py = origin.y + row * SY;
      occ.add(col + "," + row); col++; if (col >= MPR) { col = 0; row++; }
      await api.saveWorldTerm({ ...term, id, project_id: cur.id, zone, layout_x: px, layout_y: py });
      titles.push(term.title);
    }
    if (pendingEdges.length > 0) { const ek = "worldview-edges-" + cur.id; const ex = getJSONSync(ek, []); for (const ea of pendingEdges) { const si = idMap.get(ea.sourceTitle), ti = idMap.get(ea.targetTitle); if (si && ti) ex.push({ id: uuid(), source: si, target: ti, type: "straight", style: { stroke: "#94a3b8", strokeWidth: 2 } }); } try { setJSONSync(ek, ex); } catch { } }
    s.bumpWorldTerms(); setPendingTerms([]); setPendingEdges([]); s.navigateTo("outline"); s.setOutlineSection("worldview");
    const zl = zone === "core" ? "核心规则" : zone === "locked" ? "词条锁定" : zone === "active" ? "当前创作" : "其他";
    appendChatMessages([{ id: uuid(), role: "system", content: "✅ 已插入" + titles.length + "个词条到" + zl + "：" + titles.join("、"), created_at: new Date().toISOString() }]);
  }, [pendingTerms, pendingEdges, appendChatMessages, setPendingTerms, setPendingEdges]);
  const handlePlotInsert = useCallback(async () => { if (!currentProject) return; const pid = currentProject.id; const ex = getJSONSync("plot-segments-" + pid, []); const nm = new Map<string, string>(); for (const s of ex) nm.set(s.title, s.id); for (const seg of pendingPlotSegments) { const id = uuid(); nm.set(seg.title, id); ex.push({ id, project_id: pid, ...seg, beats: [] }); } if (pendingPlotBeats.length > 0) { for (const pb of pendingPlotBeats) { const si = nm.get(pb.segmentTitle); if (si) { const seg = ex.find((s: any) => s.id === si); if (seg) { if (!seg.beats) seg.beats = []; const mn = seg.beats.reduce((m: number, b: any) => Math.max(m, b.number || 0), 0); seg.beats.push({ id: uuid(), number: mn + 1, ...pb.beat }); } } } } try { setJSONSync("plot-segments-" + pid, ex); } catch { } const ee = getJSONSync("plot-edges-" + pid, []); for (const ea of pendingPlotEdges) { const si = nm.get(ea.sourceTitle); const ti = nm.get(ea.targetTitle); if (si && ti) ee.push({ id: uuid(), source: si, target: ti, sourceHandle: "right", targetHandle: "left", type: "straight", style: { stroke: "#94a3b8", strokeWidth: 2 } }); } try { setJSONSync("plot-edges-" + pid, ee); } catch { } useAppStore.getState().bumpPlot(); setPendingPlotSegments([]); setPendingPlotEdges([]); setPendingPlotBeats([]); appendChatMessages([{ id: uuid(), role: "system", content: "✅ 已创建剧情段落/细纲，刷新画布查看。", created_at: new Date().toISOString() }]); }, [currentProject, pendingPlotSegments, pendingPlotEdges, pendingPlotBeats, appendChatMessages, setPendingPlotSegments, setPendingPlotEdges, setPendingPlotBeats]);
  const handleChapterInsert = useCallback(async () => { if (!currentProject || pendingChapters.length === 0) return; const pid = currentProject.id; const segs = getJSONSync("plot-segments-" + pid, []); const ex = loadAllChapters(pid); let created = 0; for (const pc of pendingChapters) { const seg = segs.find((s: any) => s.title === pc.volumeTitle && s.type === "bright"); if (!seg) continue; if (ex.some((c: any) => c.volumeSegmentId === seg.id && c.number === pc.number)) continue; const newChapter = { id: uuid(), volumeSegmentId: seg.id, number: pc.number, title: pc.title, content: "" }; ex.push(newChapter); saveChapter(pid, newChapter); created++; } setPendingChapters([]); useAppStore.getState().bumpPlot(); if (created > 0) appendChatMessages([{ id: uuid(), role: "system", content: `✅ 已创建 ${created} 个章节，前往写作台查看。`, created_at: new Date().toISOString() }]); }, [currentProject, pendingChapters, appendChatMessages, setPendingChapters]);

  // Character insert (inline — too complex to extract, kept here)
  const handleCharacterInsert = useCallback(async () => { if (pendingChars.length === 0 && pendingCharEdges.length === 0 && pendingSnapshots.length === 0) return; const store = useAppStore.getState(); const cur = store.currentProject; if (!cur) return; const ec = await api.listCharacters(cur.id); const nm = new Map<string, string>(); for (const c of ec) nm.set(c.name, c.id); const sn = new Set<string>(ec.map(c => c.name)); for (const ch of pendingChars) { if (sn.has(ch.name)) continue; sn.add(ch.name); const id = uuid(); nm.set(ch.name, id); await api.saveCharacter({ id, project_id: cur.id, name: ch.name, faction: ch.faction, weight: 5, desire: "", fear: "", flaw: "", arc: "", voice_style: "", ending_node_id: null, avatar_path: null, layout_x: Math.random() * 400, layout_y: Math.random() * 400, is_locked: false, gender: ch.gender ?? "", age: ch.age ?? "", race: ch.race ?? "", appearance: ch.appearance ?? "", personality: ch.personality ?? "", background: ch.background ?? "", ability: ch.ability ?? "", style: ch.style ?? "", interests: ch.interests ?? "" }); } let es = await api.listRelationshipEdges(cur.id); for (const re of pendingRemoveEdges) { const s = nm.get(re.sourceName), t = nm.get(re.targetName); if (s && t) { for (const e of es.filter(e => e.source_id === s && e.target_id === t)) await api.deleteRelationshipEdge(e.id); } } es = await api.listRelationshipEdges(cur.id); for (const ea of pendingCharEdges) { const s = nm.get(ea.sourceName), t = nm.get(ea.targetName); if (s && t) { const dup = es.find(e => (e.source_id === s && e.target_id === t) || (e.source_id === t && e.target_id === s)); if (dup) await api.saveRelationshipEdge({ ...dup, relation_type: ea.relation_type }); else await api.saveRelationshipEdge({ id: uuid(), project_id: cur.id, source_id: s, target_id: t, relation_type: ea.relation_type, strength: ea.strength, is_secret: false }); } } for (const snap of pendingSnapshots) { const tc = ec.find(c => c.name === snap.name); if (!tc) continue; const sns = tc.snapshots || []; const en = parseInt(snap.changes.age || "0"); const ix = sns.findIndex(s => parseInt(s.age) === en); if (ix >= 0) sns[ix] = { age: snap.changes.age || "未知", changes: snap.changes }; else sns.push({ age: snap.changes.age || "未知", changes: snap.changes }); sns.sort((a, b) => parseInt(a.age) - parseInt(b.age)); await api.saveCharacter({ ...tc, snapshots: sns }); } store.bumpCharacters(); setPendingChars([]); setPendingCharEdges([]); setPendingRemoveEdges([]); setPendingSnapshots([]); if (cur.id) localStorage.removeItem(`ai-pending-chars-${cur.id}`); loadedRef.current = false; store.navigateTo("outline"); store.setOutlineSection("characters"); appendChatMessages([{ id: uuid(), role: "system", content: "✅ 已更新人物星图", created_at: new Date().toISOString() }]); }, [pendingChars, pendingCharEdges, pendingRemoveEdges, pendingSnapshots, currentProject, loadedRef, appendChatMessages, setPendingChars, setPendingCharEdges, setPendingRemoveEdges, setPendingSnapshots]);

  // File handling
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => { const files = e.target.files; if (!files || files.length === 0) return; const nf: UploadedFile[] = []; for (const file of Array.from(files)) { const ext = "." + file.name.split(".").pop()?.toLowerCase(); if (!TEXT_EXTENSIONS.includes(ext)) { appendChatMessages([{ id: uuid(), role: "system", content: `⚠️ 不支持的文件类型「${ext}」`, created_at: new Date().toISOString() }]); continue; } const isDocx = ext === ".docx"; const maxSize = isDocx ? 10 * 1024 * 1024 : 1024 * 1024; if (file.size > maxSize) { appendChatMessages([{ id: uuid(), role: "system", content: `⚠️ 文件「${file.name}」超过大小限制`, created_at: new Date().toISOString() }]); continue; } try { let content: string; if (isDocx) { const ab = await file.arrayBuffer(); const mammoth = await import("mammoth"); const r = await mammoth.extractRawText({ arrayBuffer: ab }); content = r.value; } else { content = await file.text(); } nf.push({ id: uuid(), name: file.name, size: file.size, content }); } catch { appendChatMessages([{ id: uuid(), role: "system", content: `⚠️ 读取文件「${file.name}」失败`, created_at: new Date().toISOString() }]); } } setUploadedFiles(prev => [...prev, ...nf]); if (fileInputRef.current) fileInputRef.current.value = ""; }, [appendChatMessages]);
  const removeFile = useCallback((fid: string) => { setUploadedFiles(prev => prev.filter(f => f.id !== fid)); }, []);
  const hasAttachments = uploadedFiles.length > 0;

  const lastAssistantMessage = useCallback(() => { const r = [...chatMessages].reverse(); return r.find(m => m.role === "assistant") ?? null; }, [chatMessages]);

  // Chat helpers
  const handleTextInsert = useCallback(() => { const store = useAppStore.getState(); if (store.activeModule === "writing" && store.writingChapterId) { const src = lastAssistantMessage() ?? (chatMessages.length === 0 ? WELCOME : null); if (!src?.content) return; store.setPendingInsertContent(src.content.replace(/<[^>]+>/g, "").trim()); store.bumpSaveAll?.(); } }, [chatMessages, lastAssistantMessage]);
  const handleRemoveLast = useCallback(() => { const last = lastAssistantMessage(); if (!last) return; const msgs = useAppStore.getState().chatMessages; const idx = [...msgs].reverse().findIndex(m => m.role === "assistant"); if (idx < 0) return; useAppStore.setState({ chatMessages: msgs.filter((_, i) => i !== msgs.length - 1 - idx) }); }, [lastAssistantMessage]);
  const handleSave = useCallback(() => { const last = lastAssistantMessage(); if (!last) return; const b = new Blob([last.content], { type: "text/markdown;charset=utf-8" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `AI回复_${new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")}.md`; a.click(); URL.revokeObjectURL(u); }, [lastAssistantMessage]);
  const handleStop = useCallback(() => { _stopStream(); }, [_stopStream]);
  const handleEditUserMessage = useCallback((msgId: string, content: string) => { setEditingMsgId(msgId); setEditingContent(content); }, []);
  const handleConfirmEdit = useCallback((msgId: string) => { const s = useAppStore.getState(); const i = s.chatMessages.findIndex(m => m.id === msgId); if (i < 0) return; useAppStore.setState({ chatMessages: s.chatMessages.slice(0, i) }); const t = (editingContentRef.current || "").trim(); if (t) { setInput(t); setTimeout(() => { const b = document.querySelector<HTMLButtonElement>('[data-send-btn]'); b?.click(); }, 50); } setEditingMsgId(null); setEditingContent(""); }, [setInput]);
  const handleDeleteMessage = useCallback((msgId: string) => { const s = useAppStore.getState(); const ms = s.chatMessages; const i = ms.findIndex(m => m.id === msgId); if (i < 0) return; const r = new Set([i]); if (i + 1 < ms.length && ms[i + 1].role === "assistant") r.add(i + 1); useAppStore.setState({ chatMessages: ms.filter((_, ii) => !r.has(ii)) }); }, []);
  const handleCopyMessage = useCallback(async (c: string) => { try { await navigator.clipboard.writeText(c); } catch { const ta = document.createElement("textarea"); ta.value = c; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); } }, []);
  const handleRegenerate = useCallback(() => { const s = useAppStore.getState(); const a = s.chatMessages; const ri = [...a].reverse().findIndex(m => m.role === "assistant"); if (ri < 0) return; const rii = a.length - 1 - ri; let ui = -1; for (let i = rii - 1; i >= 0; i--) { if (a[i].role === "user") { ui = i; break; } } const um = ui >= 0 ? a[ui] : null; const r = new Set<number>([rii]); if (um) r.add(ui); useAppStore.setState({ chatMessages: a.filter((_, ii) => !r.has(ii)) }); if (um) { setInput(um.content); setTimeout(() => { const b = document.querySelector<HTMLButtonElement>('[data-send-btn]'); b?.click(); }, 50); } }, [setInput]);

  // send() — 委托给 useAiChatStream Hook，在点击发送瞬间读取当前模块
  const handleSend = useCallback(() => {
    const { activeModule, outlineSection } = useAppStore.getState();
    send(input, uploadedFiles, { activeModule, outlineSection });
    setInput("");
    setUploadedFiles([]);
  }, [input, uploadedFiles, send, setInput, setUploadedFiles]);

  return (
    <>
      {/* 插入词条区域选择弹窗 */}
      {insertZoneDlg && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20" onClick={() => setInsertZoneDlg(null)}>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()} style={{ minWidth: 340 }}>
            <h3 className="mb-3 text-sm font-semibold">选择插入区域</h3>
            <p className="mb-3 text-xs text-slate-400">将 {pendingTerms.length} 个词条插入到：</p>
            <div className="flex flex-col gap-2">
              {[
                { key: "core", label: "核心规则", color: "#dc2626" },
                { key: "locked", label: "词条锁定", color: "#4b5563" },
                { key: "active", label: "当前创作", color: "#16a34a" },
                { key: "other", label: "其他", color: "#ea580c" },
              ].map(z => (
                <button key={z.key} onClick={() => confirmInsert(z.key)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-80"
                  style={{ backgroundColor: z.color }}>
                  ☐ {z.label}
                </button>
              ))}
            </div>
            <button className="mt-3 w-full rounded-lg border px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50" onClick={() => setInsertZoneDlg(null)}>取消</button>
          </div>
        </div>
      )}
      <ChatPanelLayout
        messages={messages} input={input} setInput={setInput} loading={loading}
        uploadedFiles={uploadedFiles} setUploadedFiles={setUploadedFiles} hasAttachments={hasAttachments}
        memoryTab={memoryTab} setMemoryTab={setMemoryTab} memoryEntries={memoryEntries}
        streamingContent={streamingContent} streamingThinking={streamingThinking}
        streamingPhase={streamingPhase} thinkingDuration={thinkingDuration}
        editingMsgId={editingMsgId} setEditingMsgId={setEditingMsgId} editingContent={editingContent} setEditingContent={setEditingContent}
        chapterSelectMode={chapterSelectMode as boolean} activeModule={activeModule}
        pendingTerms={pendingTerms} pendingEdges={pendingEdges}
        pendingChars={pendingChars} pendingCharEdges={pendingCharEdges} pendingRemoveEdges={pendingRemoveEdges}
        pendingSnapshots={pendingSnapshots} pendingPlotSegments={pendingPlotSegments} pendingPlotBeats={pendingPlotBeats}
        pendingChapters={pendingChapters}
        setPendingTerms={setPendingTerms} setPendingEdges={setPendingEdges}
        setPendingChars={setPendingChars} setPendingCharEdges={setPendingCharEdges}
        setPendingRemoveEdges={setPendingRemoveEdges} setPendingSnapshots={setPendingSnapshots}
        chatContainerRef={chatContainerRef} bottomRef={bottomRef} fileInputRef={fileInputRef}
        stt={stt} sttLoading={sttLoading} contextHint={contextHint()}
        onClearChat={() => { if (window.confirm('确定清空全部对话记录？此操作不可撤销。')) clearChat(); }}
        onToggleMemory={setMemoryTab}
        onStartEdit={(id: string, content: string) => { setEditingMsgId(id); setEditingContent(content); }}
        onCommitEdit={handleConfirmEdit} onCancelEdit={() => { setEditingMsgId(null); setEditingContent(''); }}
        onEditingChange={setEditingContent}
        onCopy={handleCopyMessage} onDelete={handleDeleteMessage} onRegenerate={handleRegenerate}
        lastAssistantMessage={lastAssistantMessage}
        onSend={handleSend} onStop={handleStop} onSttToggle={handleSttToggle}
        onFileSelect={handleFileSelect} onRemoveFile={removeFile}
        onInsertTerms={handleInsert} onInsertCharacters={handleCharacterInsert} onInsertPlot={handlePlotInsert}
        onInsertChapters={handleChapterInsert} onInsertText={handleTextInsert}
        onToggleChapterSelect={() => { const s = useAppStore.getState(); s.setChapterSelectMode(!(chapterSelectMode as boolean)); if (chapterSelectMode) s.setSelectedChapterIds([]); }}
        onRemoveLast={handleRemoveLast} onSave={handleSave}
      />
    </>
  );
}


