// ChatPanelLayout.tsx — AI 对话面板完整 UI 布局（T7 拆分，从 AiChatPanel 完整提取）
import { useEffect } from "react";
import { Sparkles, FileText, Trash2, Square, Mic, MicOff, Paperclip, Send, X } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import { confirmDialog } from "@/lib/confirm";
import type { ChatMessage, MemoryEntry, WorldTerm } from "@/types";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { CharacterApplyButton } from "./CharacterApplyButton";
import type { PendingState } from "./usePendingCharacters";

interface UploadedFile { id: string; name: string; size: number; content: string; }

function formatSize(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

const TEXT_EXTENSIONS = [".txt", ".md", ".json", ".csv", ".yaml", ".yml", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h", ".rs", ".go", ".rb", ".sh", ".bat", ".ps1", ".env", ".cfg", ".ini", ".toml", ".tex", ".rtf", ".log", ".docx"];

interface ChatPanelLayoutProps {
    messages: ChatMessage[];
    input: string; setInput: (v: string) => void;
    loading: boolean;
    uploadedFiles: UploadedFile[]; setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
    hasAttachments: boolean;
    memoryTab: boolean; setMemoryTab: (v: boolean) => void;
    memoryEntries: MemoryEntry[];
    streamingContent: string; streamingThinking: string;
    streamingPhase: "idle" | "thinking" | "content" | "done"; thinkingDuration: number;
    editingMsgId: string | null; setEditingMsgId: (v: string | null) => void;
    editingContent: string; setEditingContent: (v: string) => void;
    chapterSelectMode: boolean; activeModule: string;
    pendingTerms: WorldTerm[]; pendingEdges: { sourceTitle: string; targetTitle: string }[];
    pendingChars: PendingState['pendingChars']; pendingCharEdges: PendingState['pendingCharEdges']; pendingRemoveEdges: PendingState['pendingRemoveEdges'];
    pendingSnapshots: PendingState['pendingSnapshots']; pendingPlotSegments: PendingState['pendingPlotSegments']; pendingPlotBeats: PendingState['pendingPlotBeats'];
    pendingChapters: PendingState['pendingChapters'];
    setPendingTerms: PendingState['setPendingTerms']; setPendingEdges: PendingState['setPendingEdges'];
    setPendingChars: PendingState['setPendingChars']; setPendingCharEdges: PendingState['setPendingCharEdges'];
    setPendingRemoveEdges: PendingState['setPendingRemoveEdges']; setPendingSnapshots: PendingState['setPendingSnapshots'];
    chatContainerRef: React.RefObject<HTMLDivElement | null>;
    bottomRef: React.RefObject<HTMLDivElement | null>;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    stt: any; sttLoading: boolean;
    contextHint: string;
    onClearChat: () => void;
    onToggleMemory: (v: boolean) => void;
    onStartEdit: (id: string, content: string) => void;
    onCommitEdit: (id: string) => void;
    onCancelEdit: () => void;
    onEditingChange: (v: string) => void;
    onCopy: (c: string) => void;
    onDelete: (id: string) => void;
    onRegenerate: () => void;
    lastAssistantMessage: () => ChatMessage | null;
    onSend: () => void;
    onStop: () => void;
    onSttToggle: () => void;
    onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRemoveFile: (id: string) => void;
    onInsertTerms: () => void;
    onInsertCharacters: () => void;
    onInsertPlot: () => void;
    onInsertChapters: () => void;
    onInsertText: () => void;
    onToggleChapterSelect: () => void;
    onRemoveLast: () => void;
    onSave: () => void;
}

export function ChatPanelLayout(props: ChatPanelLayoutProps) {
    const { messages, input, setInput, loading, uploadedFiles, hasAttachments, memoryTab, memoryEntries,
        streamingContent, streamingThinking, streamingPhase, thinkingDuration,
        editingMsgId, editingContent,
        chapterSelectMode, activeModule,
        pendingTerms, pendingEdges, pendingChars, pendingCharEdges, pendingSnapshots,
        pendingPlotSegments, pendingPlotBeats, pendingChapters,
        setPendingTerms, setPendingEdges, setPendingChars, setPendingCharEdges, setPendingRemoveEdges, setPendingSnapshots,
        chatContainerRef, bottomRef, fileInputRef, stt, sttLoading, contextHint,
        onClearChat, onToggleMemory, onStartEdit, onCommitEdit, onCancelEdit, onEditingChange,
        onCopy, onDelete, onRegenerate,
        onSend, onStop, onSttToggle, onFileSelect, onRemoveFile,
        onInsertTerms, onInsertCharacters, onInsertPlot, onInsertChapters, onInsertText,
        onToggleChapterSelect, onRemoveLast, onSave,
    } = props;

    useEffect(() => { const el = chatContainerRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, loading, streamingContent, streamingThinking]);

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" /><span className="text-sm font-semibold">AI 创作助手</span></div>
                <div className="flex items-center gap-1">
                    <button type="button" title="记忆" onClick={() => onToggleMemory(!memoryTab)} className={`rounded p-1 hover:bg-slate-100 ${memoryTab ? "text-amber-600 bg-amber-50" : "text-slate-400"}`}><FileText className="h-4 w-4" />{memoryEntries.length > 0 && <span className="ml-0.5 text-[9px] font-medium">{memoryEntries.length}</span>}</button>
                    <button type="button" title="清空对话" onClick={() => { confirmDialog('确定清空全部对话记录？此操作不可撤销。').then(ok => { if (ok) onClearChat(); }); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Trash2 className="h-4 w-4" /></button>
                </div>
            </div>
            <p className="border-b bg-slate-50/80 px-3 py-1 text-[10px] text-slate-400">{contextHint}</p>
            <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" ref={chatContainerRef as React.Ref<HTMLDivElement>}>
                {messages.filter(Boolean).map((m) => (
                    <ChatMessageBubble key={m.id} msg={m} isSystem={m.role === 'system'} editingMsgId={editingMsgId} editingContent={editingContent}
                        onStartEdit={(id, content) => { onStartEdit(id, content); }}
                        onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit}
                        onEditingChange={onEditingChange} onCopy={onCopy} onDelete={onDelete} onRegenerate={onRegenerate} />
                ))}
                {loading && (
                    <div className="flex justify-start"><div className="max-w-[92%]">
                        <details className="group mb-1.5" open>
                            <summary className="flex cursor-pointer items-center gap-1.5 select-none list-none [&::-webkit-details-marker]:hidden">
                                {streamingPhase === "thinking" ? (<div className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} /><span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} /><span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} /></div>) : (<div className="flex items-center"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" /></div>)}
                                <span className="text-xs font-medium text-slate-500">{streamingPhase === "thinking" ? "思考过程" : `已思考 · ${thinkingDuration}s`}</span>
                                {streamingPhase === "content" && <span className="ml-auto text-[10px] text-slate-400 group-open:rotate-180 transition-transform">▾</span>}
                            </summary>
                            <div className="mt-1.5 rounded-lg border border-slate-200/80 bg-[#f7f7f8] px-3 py-2.5 text-xs leading-relaxed text-slate-600 prose prose-slate max-w-none">
                                {streamingThinking ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingThinking) }} /> : <span className="text-slate-400 italic">正在分析你的请求...</span>}
                                {streamingPhase === "thinking" && <span className="inline-block w-0.5 h-4 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />}
                            </div>
                        </details>
                        {streamingPhase === "content" && <div><div className="rounded-2xl px-4 py-3 text-sm border border-slate-100 bg-white text-slate-800 shadow-sm prose prose-slate max-w-none"><div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }} /><span className="inline-block w-0.5 h-4 bg-slate-700 animate-pulse ml-0.5 align-text-bottom" /></div></div>}
                        <div className="flex justify-end mt-1.5"><button type="button" onClick={onStop} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 shadow-sm transition-colors"><Square size={12} fill="currentColor" /> 终止</button></div>
                    </div></div>
                )}
                {(pendingChars.length > 0 || pendingCharEdges.length > 0 || pendingSnapshots.length > 0) && (
                    <div className="space-y-2 px-1">
                        <div className="flex items-center justify-between"><p className="text-[10px] font-medium text-blue-700">📦 待插入星图（{pendingChars.length} 个角色{pendingCharEdges.length > 0 ? ` · ${pendingCharEdges.length} 条关系` : ""}{pendingSnapshots.length > 0 ? ` · ${pendingSnapshots.length} 个快照` : ""}）</p><button className="text-[10px] text-slate-400 hover:text-red-500" onClick={() => { setPendingChars([]); setPendingCharEdges([]); setPendingRemoveEdges([]); setPendingSnapshots([]); }}>清空全部</button></div>
                        <div className="flex flex-wrap gap-2">
                            {pendingChars.map((c: any, i: number) => (<div key={c.name} className="relative group rounded-lg border bg-white p-2 shadow-sm min-w-[120px]" style={{ borderColor: "#3b82f6", borderLeftWidth: 3 }}><button className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs leading-none" onClick={() => setPendingChars((prev: any[]) => prev.filter((_: any, j: number) => j !== i))}>✕</button><p className="text-xs font-semibold text-slate-800 pr-4">{c.name}</p>{c.faction && <p className="text-[10px] text-slate-400">{c.faction}</p>}</div>))}
                            {pendingSnapshots.map((s: any, i: number) => (<div key={'snap-' + i} className="relative group rounded-lg border bg-white p-2 shadow-sm min-w-[100px]" style={{ borderColor: "#8b5cf6", borderLeftWidth: 3 }}><button className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs leading-none" onClick={() => setPendingSnapshots((prev: any[]) => prev.filter((_: any, j: number) => j !== i))}>✕</button><p className="text-xs font-semibold text-slate-800 pr-4">{s.name}</p><p className="text-[10px] text-violet-500">{s.changes.age || '?'}岁快照</p></div>))}
                        </div>
                    </div>
                )}
                {pendingTerms.length > 0 && (
                    <div className="space-y-2 px-1">
                        <div className="flex items-center justify-between"><p className="text-[10px] font-medium text-amber-700">📦 待插入画布（{pendingTerms.length} 个词条{pendingEdges.length > 0 ? ` · ${pendingEdges.length} 条连线` : ""}）</p><button className="text-[10px] text-slate-400 hover:text-red-500 whitespace-nowrap ml-2" onClick={() => { setPendingTerms([]); setPendingEdges([]); }}>清空全部</button></div>
                        <div className="flex flex-wrap gap-2">
                            {pendingTerms.map((t) => { const tc: Record<string, string> = { rule: "#3b82f6", faction: "#ec4899", place: "#10b981", item: "#8b5cf6", system: "#f97316", other: "#9ca3af" }; const tl: Record<string, string> = { rule: "规则", faction: "势力", place: "地点", item: "道具", system: "制度", other: "其他" }; const bc = tc[t.term_type] ?? "#9ca3af"; return (<div key={t.id} className="rounded-lg border bg-white p-2.5 shadow-sm min-w-[160px] max-w-[240px] relative group" style={{ borderColor: bc, borderLeftWidth: 3 }}><button className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs leading-none" onClick={(e) => { e.stopPropagation(); setPendingTerms((prev: any[]) => prev.filter((x: any) => x.id !== t.id)); }}>✕</button><span className="rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: bc }}>{tl[t.term_type] ?? "其他"}</span><p className="mt-1 text-xs font-semibold text-slate-800 truncate pr-4">{t.title}</p><p className="text-[10px] text-slate-500 line-clamp-2">{t.one_liner}</p></div>); })}
                        </div>
                    </div>
                )}
                <div ref={bottomRef as React.Ref<HTMLDivElement>} />
            </div>
            {memoryTab && (
                <div className="max-h-60 overflow-y-auto border-t border-slate-100 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-slate-600">🧠 短期记忆</h4><span className="text-[10px] text-slate-400">{memoryEntries.length} 条</span></div>
                    {memoryEntries.length === 0 ? (<p className="text-xs text-slate-400">暂无记忆，对话积累后会生成摘要</p>) : (memoryEntries.map(e => (<div key={e.id} className="mb-2 rounded border border-slate-100 bg-slate-50 p-2"><div className="mb-0.5 flex items-center gap-1.5"><span className="text-xs font-medium text-slate-700">{e.topic}</span>{e.tags.slice(0, 4).map(t => (<span key={t} className="rounded bg-violet-100 px-1 py-0.5 text-[9px] text-violet-600">{t}</span>))}</div><p className="text-[10px] leading-relaxed text-slate-500">{e.summary}</p></div>)))}
                </div>
            )}
            <CharacterApplyButton loading={loading} chatMessagesLength={messages.length} chapterSelectMode={chapterSelectMode} activeModule={activeModule}
                pendingTermsCount={pendingTerms.length} pendingCharsCount={pendingChars.length} pendingCharEdgesCount={pendingCharEdges.length}
                pendingSnapshotsCount={pendingSnapshots.length} pendingPlotCount={pendingPlotSegments.length + pendingPlotBeats.length} pendingChaptersCount={pendingChapters.length}
                onInsertTerms={onInsertTerms} onInsertCharacters={onInsertCharacters} onInsertPlot={onInsertPlot}
                onInsertChapters={onInsertChapters} onInsertText={onInsertText}
                onToggleChapterSelect={onToggleChapterSelect} onRemoveLast={onRemoveLast} onSave={onSave} />
            <div className="border-t bg-white p-3">
                {hasAttachments && (<div className="mb-2 flex flex-wrap gap-1.5">{uploadedFiles.map((f) => (<span key={f.id} className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-700"><FileText className="h-3 w-3 shrink-0" /><span className="max-w-[120px] truncate" title={f.name}>{f.name}</span><span className="text-violet-400">({formatSize(f.size)})</span><button type="button" onClick={() => onRemoveFile(f.id)} className="ml-0.5 rounded p-0.5 text-violet-400 hover:bg-violet-200 hover:text-violet-700"><X className="h-3 w-3" /></button></span>))}</div>)}
                <div className="flex gap-2">
                    <textarea className="min-h-[48px] max-h-[300px] flex-1 resize rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400" placeholder={hasAttachments ? "输入对上传资料的描述或要求…（留空则直接发送文件内容）" : "描述你想完善的设定，或让 AI 创建新模块…"} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
                    {stt.state === "recording" && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">🎤 录音中… 点击 ⏹ 停止并识别</div>}
                    {sttLoading && <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700">⏳ 正在识别语音…</div>}
                    {stt.state === "error" && stt.errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">❌ {stt.errorMsg}<button type="button" className="ml-2 underline" onClick={() => stt.cancel()}>关闭</button></div>}
                    <div className="flex shrink-0 flex-col gap-1.5">
                        <button type="button" title={stt.state === "recording" ? "点击停止并识别" : "语音输入"} onClick={onSttToggle} disabled={sttLoading} className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${stt.state === "recording" ? "border-red-300 bg-red-50 text-red-600 animate-pulse" : sttLoading ? "border-slate-200 text-slate-300 cursor-wait" : "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-violet-600"}`}>{stt.state === "recording" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button>
                        <button type="button" title="上传文本资料" onClick={() => fileInputRef.current?.click()} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-violet-600"><Paperclip className="h-4 w-4" /></button>
                        {loading ? (<button type="button" onClick={onStop} title="终止生成" className="flex h-9 w-9 items-center justify-center self-end rounded-lg bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"><Square className="h-4 w-4" fill="currentColor" /></button>) : (<button type="button" data-send-btn disabled={(!input.trim() && !hasAttachments)} onClick={onSend} className="flex h-9 w-9 items-center justify-center self-end rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-300 disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-slate-400 disabled:hover:border-slate-200 transition-colors"><Send className="h-4 w-4" /></button>)}
                    </div>
                    <input ref={fileInputRef as any} type="file" multiple accept={TEXT_EXTENSIONS.join(",")} onChange={onFileSelect} className="hidden" />
                </div>
                <p className="mt-1 text-[10px] text-slate-400">Enter 发送 · Shift+Enter 换行 · 📎支持 .txt .md .docx 等文本文件</p>
            </div>
        </div>
    );
}
