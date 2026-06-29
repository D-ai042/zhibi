// ChatMessageBubble.tsx — 聊天消息气泡组件（T7：从 AiChatPanel 提取）
import { Copy, Edit3, RotateCcw, Trash2, X, RefreshCw } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import type { ChatMessage, ChatAction } from "@/types";

interface Props {
  msg: ChatMessage;
  isSystem: boolean;
  editingMsgId: string | null;
  editingContent: string;
  onStartEdit: (id: string, content: string) => void;
  onCancelEdit: () => void;
  onEditingChange: (v: string) => void;
  onCommitEdit: (msgId: string) => void;
  onCopy: (content: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: () => void;
  /** 点击消息中嵌入的动作按钮 */
  onAction?: (msgId: string, action: ChatAction) => void;
}

export function ChatMessageBubble({ msg, isSystem, editingMsgId, editingContent, onStartEdit, onCancelEdit, onEditingChange, onCommitEdit, onCopy, onDelete, onRegenerate, onAction }: Props) {
  const isEditing = editingMsgId === msg.id;
  const html = renderMarkdown(msg.content || "");
  const hasActions = msg.actions && msg.actions.length > 0;

  if (isSystem) {
    return (
      <div className="flex flex-col items-center py-1">
        <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500 max-w-[85%]"
          dangerouslySetInnerHTML={{ __html: html }} />
        {hasActions && (
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 max-w-[85%]">
            {msg.actions!.map(a => {
              const running = a.status === "running";
              const done = a.status === "done";
              const failed = a.status === "failed";
              return (
                <button key={a.id} type="button"
                  disabled={running || done}
                  onClick={() => onAction?.(msg.id, a)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    done ? "bg-emerald-100 text-emerald-700 cursor-default"
                    : failed ? "bg-red-100 text-red-700 hover:bg-red-200"
                    : running ? "bg-violet-100 text-violet-700 cursor-wait"
                    : "bg-violet-600 text-white hover:bg-violet-700"
                  }`}
                  title={a.label}
                >
                  {running ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : done ? "✓"
                    : <RefreshCw className="h-3 w-3" />}
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (msg.role === "user") {
    return (
      <div className="flex justify-end px-4 py-2">
        <div className="group relative max-w-[85%]">
          {isEditing ? (
            <div className="rounded-2xl px-3 py-2 bg-violet-600">
              <textarea
                className="w-full resize rounded-lg border border-violet-400 bg-violet-700 px-2 py-1 text-sm text-white placeholder-violet-300 outline-none"
                value={editingContent}
                onChange={e => onEditingChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onCommitEdit(msg.id); }
                  if (e.key === "Escape") onCancelEdit();
                }}
                rows={Math.min(editingContent.split('\n').length + 1, 10)}
                autoFocus
              />
              <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-violet-300">
                <button type="button" onClick={onCancelEdit}
                  className="rounded border border-violet-400/30 px-2 py-0.5 text-violet-300 hover:bg-violet-500 hover:text-white">取消</button>
                <button type="button" onClick={() => onCommitEdit(msg.id)}
                  className="rounded bg-violet-500 px-2 py-0.5 text-white hover:bg-violet-400">确认</button>
                <span className="text-violet-400/60">Enter 发送</span>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap bg-violet-600 text-white resize overflow-auto" style={{ minWidth: 120, minHeight: 36 }}>
              {msg.content}
            </div>
          )}
          {/* 操作按钮 */}
          {!isEditing && (
            <div className="mt-1 flex items-center gap-0.5 justify-end">
              <button type="button" onClick={() => onCopy(msg.content)}
                className="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="复制">
                <Copy size={14} />
              </button>
              <button type="button" onClick={() => onStartEdit(msg.id, msg.content)}
                className="rounded p-0.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50" title="编辑消息">
                <Edit3 size={14} />
              </button>
              <button type="button" onClick={() => onDelete(msg.id)}
                className="rounded p-0.5 text-slate-400 hover:text-red-500 hover:bg-red-50" title="删除消息">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // AI assistant message
  return (
    <div className="flex justify-start px-4 py-2">
      <div className="group relative max-w-[85%]">
        {msg.thinking && (
          <details className="mb-1.5">
            <summary className="flex cursor-pointer items-center gap-1.5 rounded-full bg-[#f0f0f0] hover:bg-[#e8e8e8] px-3 py-1 text-xs text-slate-500 select-none transition-colors [&::-webkit-details-marker]:hidden list-none">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>已思考</span>
              </span>
              <span className="ml-auto text-[10px] text-slate-400 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <div className="mt-1.5 rounded-lg border border-slate-200/80 bg-[#f7f7f8] px-3 py-2.5 text-xs leading-relaxed text-slate-600 prose prose-slate max-w-none">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.thinking) }} />
            </div>
          </details>
        )}
        <div
          className="rounded-2xl px-4 py-3 text-sm border border-slate-100 bg-white text-slate-800 shadow-sm prose prose-slate max-w-none"
          dangerouslySetInnerHTML={{
            __html: html,
          }}
        />
        {/* 操作按钮栏 */}
        <div className="mt-1 flex items-center gap-0.5">
          <button type="button" onClick={() => onCopy(msg.content)}
            className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="复制">
            <Copy size={13} />
          </button>
          <button type="button" onClick={() => onDelete(msg.id)}
            className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50" title="删除">
            <Trash2 size={13} />
          </button>
          <button type="button" onClick={onRegenerate}
            className="rounded p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50" title="重新生成">
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
