// ChatMessageBubble.tsx — 聊天消息气泡组件（T7：从 AiChatPanel 提取）
import { Copy, RotateCcw } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import type { ChatMessage } from "@/types";

interface Props {
  msg: ChatMessage;
  isSystem: boolean;
  editingMsgId: string | null;
  editingContent: string;
  onStartEdit: (msg: ChatMessage) => void;
  onCancelEdit: () => void;
  onEditingChange: (v: string) => void;
  onCommitEdit: (msg: ChatMessage) => void;
  onCopy: (content: string) => void;
  onRetry: (msg: ChatMessage) => void;
}

export function ChatMessageBubble({ msg, isSystem, editingMsgId, editingContent, onStartEdit, onCancelEdit, onEditingChange, onCommitEdit, onCopy, onRetry }: Props) {
  const isEditing = editingMsgId === msg.id;
  const html = renderMarkdown(msg.content || "");

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500 max-w-[85%]"
          dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} px-4 py-2`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === "user" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-800"}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium opacity-60">
            {msg.role === "user" ? "你" : "AI 助手"}
          </span>
          <div className="flex items-center gap-1">
            {msg.role === "assistant" && (
              <>
                <button onClick={() => onCopy(msg.content)} className="p-0.5 opacity-50 hover:opacity-100" title="复制"><Copy size={12} /></button>
                <button onClick={() => onRetry(msg)} className="p-0.5 opacity-50 hover:opacity-100" title="重试"><RotateCcw size={12} /></button>
              </>
            )}
            {msg.role === "user" && (
              <button onClick={() => onStartEdit(msg)} className="p-0.5 opacity-50 hover:opacity-100" title="编辑">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            )}
          </div>
        </div>
        {isEditing ? (
          <div className="flex flex-col gap-2">
            <textarea value={editingContent} onChange={e => onEditingChange(e.target.value)}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none" rows={4} autoFocus
              onKeyDown={e => { if (e.key === "Escape") onCancelEdit(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onCommitEdit(msg); }} />
            <div className="flex justify-end gap-2">
              <button onClick={onCancelEdit} className="rounded px-3 py-1 text-xs border hover:bg-slate-50">取消</button>
              <button onClick={() => onCommitEdit(msg)} className="rounded px-3 py-1 text-xs bg-violet-600 text-white hover:bg-violet-700">发送</button>
            </div>
          </div>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: html }} className="prose prose-sm max-w-none [&_pre]:bg-slate-800 [&_pre]:text-slate-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs [&_table]:text-xs [&_th]:border [&_th]:px-2 [&_td]:border [&_td]:px-2" />
        )}
      </div>
    </div>
  );
}
