// AiChatPanel.tsx — AI 对话面板（T7 瘦身：提取 useSttVoice/ChatMessageBubble/useAiChatStream）
import { useRef, useEffect, useState, useCallback } from "react";
import {
  FileText, Paperclip, Send, Sparkles, Trash2, X,
  ClipboardPlus, Download, Eraser, Mic, MicOff,
  Edit3, Square, Copy, RotateCcw, CheckCircle,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { MemoryEngine } from "@/lib/memory-engine";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { loadAllChapters, saveAllChapters, type Chapter } from "@/lib/chapter-store";
import { parseCharacterBatch, type ParsedCharacter, type ParsedEdge } from "@/lib/character-parser";
import { CharacterApplyButton } from "./CharacterApplyButton";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { useSttVoice } from "./useSttVoice";
import { useAiChatStream } from "./useAiChatStream";
import type { ChatMessage, MemoryEntry, WorldTerm } from "@/types";
import { uuid } from "@/lib/uuid";

// ===== 常量 & 工具 =====
const TEXT_EXTENSIONS = [".txt",".md",".json",".csv",".yaml",".yml",".xml",".html",".htm",".css",".js",".ts",".py",".java",".c",".cpp",".h",".rs",".go",".rb",".sh",".bat",".ps1",".env",".cfg",".ini",".toml",".tex",".rtf",".log",".docx"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

interface UploadedFile { id: string; name: string; size: number; content: string; }

const WELCOME: ChatMessage = {
  id: "welcome", role: "assistant",
  content: "我是你的小说创作助手。\n\n⚠️ **使用前请在「API 设置」中配置对应厂商的 API Key**，未配置时 AI 功能不可用。\n\n建议流程：\n1. 在大纲里完善【世界观】【人物关系】【剧情走向】\n2. 在【写作台】中按卷章写作\n3. **告诉我你想创建什么新模块**\n\n试试说：\n• 「创建一个情节检查面板」\n• 「帮我做一个角色分析模块」",
  created_at: new Date().toISOString(),
};

// ===== 组件 =====
export function AiChatPanel() {
  const { chatMessages, addChatMessage, appendChatMessages, clearChat, currentProject, memoryBump, pendingAiCharsBump } = useAppStore();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [pendingTerms, setPendingTerms] = useState<WorldTerm[]>([]);
  const [pendingEdges, setPendingEdges] = useState<{ sourceTitle: string; targetTitle: string }[]>([]);
  const [pendingChars, setPendingChars] = useState<{ name: string; faction: string }[]>([]);
  const [pendingCharEdges, setPendingCharEdges] = useState<{ sourceName: string; targetName: string; relation_type: string; strength: number }[]>([]);
  const [pendingRemoveEdges, setPendingRemoveEdges] = useState<{ sourceName: string; targetName: string }[]>([]);
  const [pendingSnapshots, setPendingSnapshots] = useState<{ name: string; changes: Record<string, string> }[]>([]);
  const [pendingPlotSegments, setPendingPlotSegments] = useState<any[]>([]);
  const [pendingPlotEdges, setPendingPlotEdges] = useState<any[]>([]);
  const [pendingPlotBeats, setPendingPlotBeats] = useState<any[]>([]);
  const [pendingChapters, setPendingChapters] = useState<{ volumeTitle: string; number: number; title: string }[]>([]);
  const [memoryTab, setMemoryTab] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingPhase, setStreamingPhase] = useState<"idle"|"thinking"|"content"|"done">("idle");
  const [thinkingDuration, setThinkingDuration] = useState(0);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const editingContentRef = useRef(""); editingContentRef.current = editingContent;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const memoryEngineRef = useRef<MemoryEngine | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef(false);
  const hasAttachments = uploadedFiles.length > 0;
  const messages = chatMessages.length > 0 ? chatMessages : [WELCOME];

  // ---- hooks ----
  const { sttLoading, sttRecording, handleSttToggle } = useSttVoice(setInput);
  const { send, stopStream } = useAiChatStream(
    setPendingTerms, setPendingEdges, setPendingChars, setPendingCharEdges,
    setPendingRemoveEdges, setPendingSnapshots, setPendingPlotSegments,
    setPendingPlotEdges, setPendingPlotBeats, setPendingChapters,
    setStreamingContent, setStreamingThinking, setStreamingPhase, setThinkingDuration,
  );

  // ---- 滚动 & 记忆 ----
  useEffect(() => { const el = chatContainerRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, loading, streamingContent, streamingThinking]);
  useEffect(() => {
    if (currentProject?.id) { memoryEngineRef.current = new MemoryEngine(currentProject.id); setMemoryEntries(memoryEngineRef.current.getShortTerm()); }
    else { memoryEngineRef.current = null; setMemoryEntries([]); }
  }, [currentProject?.id]);
  useEffect(() => { if (memoryEngineRef.current) setMemoryEntries(memoryEngineRef.current.getShortTerm()); }, [memoryBump]);

  // ---- pending 角色加载 ----
  const loadPending = useCallback(() => {
    if (!currentProject?.id || loadedRef.current) return;
    try {
      const raw = getJSONSync("ai-pending-chars-" + currentProject.id, null);
      if (!raw) return;
      const data = raw as { chars?: ParsedCharacter[]; edges?: ParsedEdge[] };
      if (data.chars?.length) setPendingChars(prev => { const names = new Set(prev.map(c => c.name)); return [...prev, ...data.chars.filter(c => !names.has(c.name))]; });
      if (data.edges?.length) setPendingCharEdges(prev => { const keys = new Set(prev.map(e => e.sourceName + "::" + e.targetName)); return [...prev, ...data.edges.filter(e => !keys.has(e.sourceName + "::" + e.targetName))]; });
      loadedRef.current = true;
    } catch { /* ignore */ }
  }, [currentProject?.id]);
  useEffect(() => { loadPending(); }, [loadPending]);
  useEffect(() => { if (currentProject?.id && pendingAiCharsBump > 0) { loadedRef.current = false; loadPending(); } }, [pendingAiCharsBump, currentProject?.id, loadPending]);

  // ---- 发送 ----
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && !hasAttachments) || loading) return;
    setLoading(true);
    await send(text, uploadedFiles);
    setInput(""); setUploadedFiles([]); setLoading(false);
  }, [input, hasAttachments, loading, send, uploadedFiles]);

  // ---- 文件上传 ----
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files || files.length === 0) return;
    const newFiles: UploadedFile[] = [];
    for (const file of files) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext)) { appendChatMessages([{ id: uuid(), role: "system", content: "⚠️ 不支持的文件类型「" + ext + "」", created_at: new Date().toISOString() }]); continue; }
      const maxSize = ext === ".docx" ? 10*1024*1024 : 1024*1024;
      if (file.size > maxSize) { appendChatMessages([{ id: uuid(), role: "system", content: "⚠️ 文件「" + file.name + "」超过大小限制", created_at: new Date().toISOString() }]); continue; }
      try {
        let content: string;
        if (ext === ".docx") { try { const ab = await file.arrayBuffer(); const mammoth = await import("mammoth"); content = (await mammoth.extractRawText({ arrayBuffer: ab })).value; } catch { appendChatMessages([{ id: uuid(), role: "system", content: "⚠️ 解析 Word 文档「" + file.name + "」失败", created_at: new Date().toISOString() }]); continue; } }
        else { content = await file.text(); }
        newFiles.push({ id: uuid(), name: file.name, size: file.size, content });
      } catch { appendChatMessages([{ id: uuid(), role: "system", content: "⚠️ 读取文件「" + file.name + "」失败", created_at: new Date().toISOString() }]); }
    }
    setUploadedFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [appendChatMessages]);

  // ---- 角色插入历史记录 ----
  const [insertHistory, setInsertHistory] = useState<{ name: string; faction: string; timestamp: number }[]>([]);

  const handleCharacterInsert = useCallback(async () => {
    if (pendingChars.length === 0 && pendingCharEdges.length === 0) return;
    const store = useAppStore.getState();
    const curProject = store.currentProject;
    if (!curProject) return;
    const existingChars = await api.listCharacters(curProject.id);
    const nameMap = new Map<string, string>(); for (const ec of existingChars) nameMap.set(ec.name, ec.id);
    const deduped: typeof pendingChars = [];
    const seenNames = new Set<string>(existingChars.map(c => c.name));
    for (const ch of pendingChars) if (!seenNames.has(ch.name)) { deduped.push(ch); seenNames.add(ch.name); }
    const history = [...insertHistory];
    for (const ch of deduped) {
      await api.saveCharacter({ id: uuid(), project_id: curProject.id, name: ch.name, faction: ch.faction || "", gender: (ch as any).gender||"", age: (ch as any).age||"", race: (ch as any).race||"", appearance: (ch as any).appearance||"", personality: (ch as any).personality||"", background: (ch as any).background||"", ability: (ch as any).ability||"", style: (ch as any).style||"", interests: (ch as any).interests||"", weight: 3, desire: "", fear: "", flaw: "", arc: "", voice_style: "", layout_x: 0, layout_y: 0, is_locked: false, snapshots_json: "[]" } as any);
      history.push({ name: ch.name, faction: ch.faction, timestamp: Date.now() });
    }
    setInsertHistory(history);
    for (const ea of pendingCharEdges) {
      const srcId = nameMap.get(ea.sourceName); const tgtId = nameMap.get(ea.targetName);
      if (srcId && tgtId) { await api.saveRelationshipEdge({ id: uuid(), project_id: curProject.id, source_id: srcId, target_id: tgtId, relation_type: ea.relation_type, strength: ea.strength, is_secret: false }); }
    }
    store.bumpCharacters(); setPendingChars([]); setPendingCharEdges([]);
    appendChatMessages([{ id: uuid(), role: "system", content: "✅ 已创建 " + deduped.length + " 个角色" + (pendingCharEdges.length > 0 ? " + " + pendingCharEdges.length + " 条关系" : ""), created_at: new Date().toISOString() }]);
  }, [pendingChars, pendingCharEdges, appendChatMessages, insertHistory]);

  // ---- 历史记录去重检查 ----
  const isDuplicate = useCallback((name: string) => insertHistory.some(h => h.name === name && Date.now() - h.timestamp < 60000), [insertHistory]);

  // ---- 其他操作 ----
  const handleCopyMessage = useCallback(async (content: string) => { try { await navigator.clipboard.writeText(content); } catch { const ta = document.createElement("textarea"); ta.value = content; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); } }, []);
  const handleRegenerate = useCallback(() => {
    const store = useAppStore.getState(); const all = store.chatMessages;
    const idx = [...all].reverse().findIndex(m => m.role === "assistant");
    if (idx < 0) return; const realIdx = all.length - 1 - idx;
    let userIdx = -1; for (let i = realIdx - 1; i >= 0; i--) { if (all[i].role === "user") { userIdx = i; break; } }
    const userMsg = userIdx >= 0 ? all[userIdx] : null; const toRemove = new Set([realIdx]);
    if (userMsg) toRemove.add(userIdx);
    useAppStore.setState({ chatMessages: all.filter((_, i) => !toRemove.has(i)) });
    if (userMsg) { setInput(userMsg.content); setTimeout(() => { const btn = document.querySelector<HTMLButtonElement>("[data-send-btn]"); btn?.click(); }, 50); }
  }, []);
  const handleEdit = useCallback((msgId: string, content: string) => { setEditingMsgId(msgId); setEditingContent(content); }, []);
  const handleConfirmEdit = useCallback((msgId: string) => {
    const store = useAppStore.getState(); const idx = store.chatMessages.findIndex(m => m.id === msgId);
    if (idx < 0) return; useAppStore.setState({ chatMessages: store.chatMessages.slice(0, idx) });
    const text = (editingContentRef.current || "").trim();
    if (text) { setInput(text); setTimeout(() => { const btn = document.querySelector<HTMLButtonElement>("[data-send-btn]"); btn?.click(); }, 50); }
    setEditingMsgId(null); setEditingContent("");
  }, []);

  // 总计 pending 数量
  const totalPending = pendingTerms.length + pendingChars.length + pendingCharEdges.length + pendingPlotSegments.length + pendingPlotBeats.length + pendingChapters.length;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-700">AI 对话</h2>
        <div className="flex items-center gap-1">
          {memoryEngineRef.current && <button onClick={() => setMemoryTab(!memoryTab)} className={"rounded px-2 py-1 text-xs " + (memoryTab ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-100")}>记忆</button>}
          <button onClick={clearChat} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600">清空</button>
        </div>
      </div>

      {/* Memory tab */}
      {memoryTab && (
        <div className="border-b bg-slate-50 px-4 py-2 text-xs text-slate-600 max-h-32 overflow-y-auto">
          {memoryEntries.length === 0 ? <span className="text-slate-400">暂无短期记忆</span> :
            memoryEntries.map((e, i) => <div key={i} className="py-0.5">• {e.summary || e.content?.slice(0, 80)}</div>)}
        </div>
      )}

      {/* Messages */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto py-2">
        {/* Streaming bubble */}
        {(streamingThinking || streamingContent) && (
          <div className="flex justify-start px-4 py-2">
            <div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
              {streamingPhase === "thinking" && <span className="text-xs text-slate-400">思考中 ({thinkingDuration}s)...</span>}
              {streamingThinking && <div className="text-xs text-slate-400 whitespace-pre-wrap mb-1">{streamingThinking}</div>}
              {streamingContent && <div className="whitespace-pre-wrap">{streamingContent}<span className="animate-pulse">▊</span></div>}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} msg={msg} isSystem={msg.role === "system"}
            editingMsgId={editingMsgId} editingContent={editingContent}
            onStartEdit={(m) => handleEdit(m.id, m.content)} onCancelEdit={() => { setEditingMsgId(null); setEditingContent(""); }}
            onEditingChange={setEditingContent} onCommitEdit={(m) => handleConfirmEdit(m.id)}
            onCopy={handleCopyMessage} onRetry={handleRegenerate} />
        ))}
      </div>

      {/* Pending bar */}
      {totalPending > 0 && (
        <div className="border-t bg-amber-50 px-4 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-amber-800">待确认：</span>
            {pendingChars.length > 0 && <span className="rounded bg-amber-200 px-2 py-0.5 text-xs">{pendingChars.length} 角色</span>}
            {pendingCharEdges.length > 0 && <span className="rounded bg-amber-200 px-2 py-0.5 text-xs">{pendingCharEdges.length} 关系</span>}
            {pendingTerms.length > 0 && <span className="rounded bg-amber-200 px-2 py-0.5 text-xs">{pendingTerms.length} 词条</span>}
            {pendingPlotSegments.length > 0 && <span className="rounded bg-amber-200 px-2 py-0.5 text-xs">{pendingPlotSegments.length} 剧情</span>}
            {pendingChapters.length > 0 && <span className="rounded bg-amber-200 px-2 py-0.5 text-xs">{pendingChapters.length} 章节</span>}
            <div className="flex gap-1 ml-auto">
              {(pendingChars.length > 0 || pendingCharEdges.length > 0) && (
                <CharacterApplyButton pendingChars={pendingChars} pendingEdges={pendingCharEdges}
                  onApply={handleCharacterInsert} isDuplicate={isDuplicate} />
              )}
              <button onClick={() => { setPendingTerms([]); setPendingEdges([]); setPendingChars([]); setPendingCharEdges([]); setPendingPlotSegments([]); setPendingPlotEdges([]); setPendingPlotBeats([]); setPendingChapters([]); }}
                className="rounded border px-2 py-0.5 text-xs hover:bg-slate-50">清空</button>
            </div>
          </div>
        </div>
      )}

      {/* File preview */}
      {hasAttachments && (
        <div className="border-t bg-slate-50 px-4 py-2 flex items-center gap-2 flex-wrap">
          {uploadedFiles.map(f => (
            <span key={f.id} className="flex items-center gap-1 rounded bg-white border px-2 py-0.5 text-xs">
              <FileText size={12} />{f.name} ({formatSize(f.size)})
              <button onClick={() => setUploadedFiles(prev => prev.filter(x => x.id !== f.id))} className="ml-1 text-slate-400 hover:text-red-500"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="border-t px-4 py-3 flex items-end gap-2">
        <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple accept={TEXT_EXTENSIONS.join(",")} />
        <button onClick={() => fileInputRef.current?.click()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-violet-600" title="上传文件"><Paperclip size={18} /></button>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="输入消息..." rows={2}
          className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-400" />
        <button onClick={handleSttToggle} disabled={sttLoading}
          className={"rounded-lg p-2 " + (sttRecording ? "text-red-500 bg-red-50" : "text-slate-400 hover:bg-slate-100 hover:text-violet-600")}
          title={sttRecording ? "停止录音" : "语音输入"}>
          {sttRecording ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {loading ? (
          <button onClick={stopStream} className="rounded-lg bg-red-500 p-2 text-white hover:bg-red-600" title="停止生成"><Square size={18} /></button>
        ) : (
          <button onClick={handleSend} disabled={!input.trim() && !hasAttachments}
            className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:opacity-50" data-send-btn title="发送"><Send size={18} /></button>
        )}
      </div>
    </div>
  );
}
