// ChapterEditor.tsx — 章节编辑器组件（T6：从 WritingModule.tsx 提取）
import { useRef, useEffect } from "react";
import { Undo2, Redo2, Sparkles, AlignLeft } from "lucide-react";

interface ChapterEditorProps {
    selectedChapter: { id: string; number: number; title: string } | null | undefined;
    selectedVolume: { title: string } | null | undefined;
    editingContent: string;
    isDirty: boolean;
    aiWriting: boolean;
    humanizing: boolean;
    polishing: boolean;
    aiError: string;
    fontSize: number;
    staleInfo: { count: number; chapters: string; fromChapter: number } | null;
    rebaseRunning: boolean;
    rebaseProgress: { current: number; total: number } | null;
    onContentChange: (text: string) => void;
    onSave: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onAiWrite: () => void;
    onHumanize: () => void;
    onPolish: () => void;
    onRebase: () => void;
}

export function ChapterEditor({
    selectedChapter, selectedVolume, editingContent, isDirty,
    aiWriting, humanizing, polishing, aiError, fontSize,
    staleInfo, rebaseRunning, rebaseProgress,
    onContentChange, onSave, onUndo, onRedo,
    onAiWrite, onHumanize, onPolish, onRebase,
}: ChapterEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null);

    if (!selectedChapter) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
                <AlignLeft className="h-8 w-8 mb-2" />
                <p className="text-sm">请在左侧选择章节开始写作</p>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col min-w-0">
            {/* 修订感知横幅 */}
            {staleInfo && !rebaseRunning && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <span>⚠️ 检测到 {staleInfo.count} 条过时记录（{staleInfo.chapters}）</span>
                    <button onClick={onRebase}
                        className="ml-auto rounded-md bg-amber-500 px-2.5 py-1 text-xs text-white hover:bg-amber-600">
                        重跑记忆
                    </button>
                </div>
            )}
            {/* 重跑进度条 */}
            {rebaseProgress && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <span>⏳ 重跑记忆：第{rebaseProgress.current}/{rebaseProgress.total}章</span>
                    <div className="h-2 flex-1 rounded-full bg-amber-200">
                        <div className="h-2 rounded-full bg-amber-500 transition-all"
                            style={{ width: `${(rebaseProgress.current / rebaseProgress.total) * 100}%` }} />
                    </div>
                </div>
            )}
            {/* 工具栏 */}
            <div className="flex items-center justify-between border-b bg-white px-4 py-2">
                <div>
                    <h1 className="text-lg font-bold">
                        <span className="text-slate-400">第{selectedChapter.number}章</span> {selectedChapter.title}
                    </h1>
                    <p className="text-xs text-slate-400">{selectedVolume?.title || ""}</p>
                </div>
                <div className="flex items-center gap-2">
                    {aiError && <span className="text-xs text-red-500">{aiError}</span>}
                    <button onClick={onAiWrite}
                        className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
                        disabled={aiWriting}>
                        <Sparkles className="h-3.5 w-3.5" />{aiWriting ? "AI 写作中..." : "AI写文"}
                    </button>
                    <button onClick={onHumanize}
                        disabled={!editingContent.trim() || humanizing}
                        className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">
                        <Sparkles className="h-3.5 w-3.5" />{humanizing ? "处理中..." : "AI去味"}
                    </button>
                    <button onClick={onPolish}
                        disabled={!editingContent.trim() || polishing}
                        className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50">
                        <Sparkles className="h-3.5 w-3.5" />{polishing ? "精修中..." : "AI精修"}
                    </button>
                    <button onClick={onUndo}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                        title="撤回 (Ctrl+Z)">
                        <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={onRedo}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                        title="重做 (Ctrl+Y)">
                        <Redo2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={onSave}
                        className={`rounded-lg px-3 py-1.5 text-xs text-white ${isDirty ? "bg-amber-500 hover:bg-amber-600" : "bg-slate-300 cursor-default"}`}>
                        保存
                    </button>
                </div>
            </div>
            {/* 编辑器 */}
            <div className="relative flex-1 min-h-0">
                <div
                    ref={editorRef}
                    className="absolute inset-0 overflow-y-auto bg-stone-50 p-6 font-serif font-medium leading-relaxed text-stone-800 outline-none cursor-text"
                    style={{ fontSize }}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={e => {
                        const text = (e.currentTarget as HTMLElement).innerText || "";
                        onContentChange(text);
                    }}
                />
            </div>
        </div>
    );
}
