// ChapterEditor.tsx — 正文编辑器组件（T6 拆分，JSX 原样从 WritingModule 提取）
import { Plus, Minus, Sparkles, AlignLeft, Undo2, Redo2, CheckCircle } from "lucide-react";

interface ChapterEditorProps {
    selectedChapter: { number: number; title: string } | null | undefined;
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
    canUndo: boolean;
    canRedo: boolean;
    selectionRange: { start: number; end: number } | null;
    lastWriteParams: { wordCount: number; plotDirection: string } | null;
    editorRef: React.RefObject<HTMLDivElement | null>;
    onAiWrite: () => void;
    onHumanize: () => void;
    onPolish: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onSave: () => void;
    onFinalize: () => void;
    onRebase: () => void;
    onRetryWrite: () => void;
    onAutoFormat: () => void;
    onFontSizeChange: (size: number) => void;
    onEditorInput: (e: React.FormEvent<HTMLDivElement>) => void;
    onEditorMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
    onEditorKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function ChapterEditor(props: ChapterEditorProps) {
    const {
        selectedChapter, selectedVolume, editingContent, isDirty,
        aiWriting, humanizing, polishing, aiError, fontSize,
        staleInfo, rebaseRunning, rebaseProgress,
        canUndo, canRedo, selectionRange, lastWriteParams, editorRef,
        onAiWrite, onHumanize, onPolish, onUndo, onRedo, onSave,
        onFinalize, onRebase, onRetryWrite, onAutoFormat, onFontSizeChange,
        onEditorInput, onEditorMouseUp, onEditorKeyDown,
    } = props;

    if (!selectedChapter) {
        return (
            <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
                从左侧选择一个章节开始写作
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col min-w-0">
            {staleInfo && !rebaseRunning && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <span>⚠️ 检测到 {staleInfo.count} 条过时记录（{staleInfo.chapters} 的摘要/角色状态已基于旧版本）</span>
                    <button onClick={onRebase} className="ml-auto rounded-md bg-amber-500 px-2.5 py-1 text-xs text-white hover:bg-amber-600">重跑记忆</button>
                </div>
            )}
            {rebaseProgress && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <span>⏳ 正在重跑记忆：第{rebaseProgress.current}/{rebaseProgress.total}章</span>
                    <div className="h-2 flex-1 rounded-full bg-amber-200"><div className="h-2 rounded-full bg-amber-500 transition-all" style={{ width: `${(rebaseProgress.current / rebaseProgress.total) * 100}%` }} /></div>
                </div>
            )}
            <div className="flex items-center justify-between border-b bg-white px-4 py-2">
                <div>
                    <h1 className="text-lg font-bold"><span className="text-slate-400">第{selectedChapter.number}章</span> {selectedChapter.title}</h1>
                    <p className="text-xs text-slate-400">{selectedVolume?.title || ""}</p>
                </div>
                <div className="flex items-center gap-2 relative">
                    {aiError && <span className="text-xs text-red-500">{aiError}</span>}
                    <button type="button" className="relative flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
                        onClick={onAiWrite} disabled={!selectedChapter || aiWriting}>
                        <Sparkles className="h-3.5 w-3.5" />{aiWriting ? "AI 写作中..." : "AI写文"}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] text-gray-500 whitespace-nowrap">大纲生成初稿</span>
                    </button>
                    <button type="button" onClick={onHumanize}
                        disabled={!selectedChapter || !String(editingContent ?? '').trim() || humanizing}
                        className="relative flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">
                        <Sparkles className="h-3.5 w-3.5" />{humanizing ? "处理中..." : "AI去味"}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] text-gray-500 whitespace-nowrap">语气自然化</span>
                    </button>
                    <button type="button" onClick={onPolish}
                        disabled={!selectedChapter || !String(editingContent ?? '').trim() || polishing}
                        className="relative flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50">
                        <Sparkles className="h-3.5 w-3.5" />{polishing ? "精修中..." : "AI精修"}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] text-gray-500 whitespace-nowrap">精简+段落优化</span>
                    </button>
                    <button type="button" onClick={onUndo} disabled={!canUndo}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="撤回 (Ctrl+Z)">
                        <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={onRedo} disabled={!canRedo}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="重做 (Ctrl+Y)">
                        <Redo2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={onSave} className={`rounded-lg px-3 py-1.5 text-xs text-white ${isDirty ? "bg-amber-500 hover:bg-amber-600" : "bg-slate-300 cursor-default"}`}>保存</button>
                    <button type="button" onClick={onFinalize} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700">
                        <CheckCircle className="h-3.5 w-3.5" />定稿
                    </button>
                    {lastWriteParams && (
                        <button type="button" onClick={onRetryWrite} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" title="用相同参数让 AI 重新生成">退回重写</button>
                    )}
                    <button type="button" onClick={onAutoFormat} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title="自动排版段落缩进">
                        <AlignLeft className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex items-stretch rounded-lg border border-slate-200 overflow-hidden" title={`正文字体 ${fontSize}px`}>
                        <button type="button" onClick={() => onFontSizeChange(Math.max(fontSize - 1, 12))}
                            className="flex items-center justify-center px-1 py-1.5 text-xs text-slate-600 hover:bg-slate-100"><Minus className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => onFontSizeChange(Math.min(fontSize + 1, 100))}
                            className="flex items-center justify-center px-1 py-1.5 text-xs text-slate-600 hover:bg-slate-100"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                </div>
            </div>
            <div className="relative flex-1 min-h-0">
                <div ref={editorRef as any}
                    className="absolute inset-0 overflow-y-auto bg-stone-50 p-6 font-serif font-medium leading-relaxed text-stone-800 outline-none cursor-text"
                    style={{ fontSize }} contentEditable suppressContentEditableWarning
                    onInput={onEditorInput} onMouseUp={onEditorMouseUp} onKeyDown={onEditorKeyDown}
                />
            </div>
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
        </div>
    );
}
