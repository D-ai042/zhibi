// CharacterApplyButton.tsx — 底部操作工具栏（T7 拆分，从 AiChatPanel 提取）
// 包含：词条插入/角色插入/剧情段落/章节插入/选取/插入正文/移除/保存按钮
import { ClipboardPlus, Eraser, Download, FileText } from "lucide-react";

interface ActionToolbarProps {
    loading: boolean;
    chatMessagesLength: number;
    chapterSelectMode: boolean;
    activeModule: string;
    pendingTermsCount: number;
    pendingCharsCount: number;
    pendingCharEdgesCount: number;
    pendingSnapshotsCount: number;
    pendingPlotCount: number;
    pendingChaptersCount: number;
    onInsertTerms: () => void;
    onInsertCharacters: () => void;
    onInsertPlot: () => void;
    onInsertChapters: () => void;
    onInsertText: () => void;
    onToggleChapterSelect: () => void;
    onRemoveLast: () => void;
    onSave: () => void;
}

export function CharacterApplyButton({
    loading, chatMessagesLength, chapterSelectMode, activeModule,
    pendingTermsCount, pendingCharsCount, pendingCharEdgesCount,
    pendingSnapshotsCount, pendingPlotCount, pendingChaptersCount,
    onInsertTerms, onInsertCharacters, onInsertPlot, onInsertChapters,
    onInsertText, onToggleChapterSelect, onRemoveLast, onSave,
}: ActionToolbarProps) {
    return (
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-3 py-1.5">
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <span>
                    {pendingTermsCount > 0 ? "待插入词条："
                        : pendingCharsCount > 0 || pendingCharEdgesCount > 0 || pendingSnapshotsCount > 0 ? "待插入角色："
                            : pendingPlotCount > 0 ? "待插入剧情段落/细纲："
                                : pendingChaptersCount > 0 ? "待创建章节："
                                    : "对最后一条 AI 回复操作："}
                </span>
            </div>
            <div className="flex items-center gap-1">
                {pendingTermsCount > 0 && (
                    <button type="button" title="插入到画布" onClick={onInsertTerms} disabled={loading}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100">
                        <ClipboardPlus className="h-3 w-3" />插入 {pendingTermsCount} 个词条
                    </button>
                )}
                {(pendingCharsCount > 0 || pendingCharEdgesCount > 0 || pendingSnapshotsCount > 0) && (
                    <button type="button" title="应用到星图" onClick={onInsertCharacters} disabled={loading}
                        className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100">
                        <ClipboardPlus className="h-3 w-3" />
                        {pendingCharsCount > 0
                            ? `插入 ${pendingCharsCount} 个角色${pendingSnapshotsCount > 0 ? ` · ${pendingSnapshotsCount} 个快照` : ''}`
                            : pendingSnapshotsCount > 0 ? `应用 ${pendingSnapshotsCount} 个快照`
                                : `应用 ${pendingCharEdgesCount} 条关系`}
                    </button>
                )}
                {pendingPlotCount > 0 && (
                    <button type="button" title="插入到剧情走向画布" onClick={onInsertPlot} disabled={loading}
                        className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-100">
                        <ClipboardPlus className="h-3 w-3" />插入 {pendingPlotCount} 项
                    </button>
                )}
                {pendingChaptersCount > 0 && (
                    <button type="button" title="创建到写作台" onClick={onInsertChapters} disabled={loading}
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-100">
                        <ClipboardPlus className="h-3 w-3" />创建 {pendingChaptersCount} 个章节
                    </button>
                )}
                {activeModule === "writing" && (
                    <button type="button" title="在卷章树中选取章节，内容随本次发送给 AI（不进记忆）"
                        onClick={onToggleChapterSelect}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-violet-100 ${chapterSelectMode ? "border-violet-500 bg-violet-100 text-violet-700" : "border-slate-200 bg-white text-slate-600"}`}>
                        <FileText className="h-3 w-3" />选取
                    </button>
                )}
                {pendingTermsCount === 0 && pendingCharsCount === 0 && pendingPlotCount === 0 && (
                    <button type="button" title="将 AI 回复插入到当前章节" onClick={onInsertText} disabled={loading}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100">
                        <ClipboardPlus className="h-3 w-3" />插入
                    </button>
                )}
                <button type="button" title="移除 — 删除最后一条 AI 回复"
                    onClick={onRemoveLast} disabled={loading || chatMessagesLength === 0}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-40">
                    <Eraser className="h-3 w-3" />移除
                </button>
                <button type="button" title="保存 — 将 AI 回复下载为 .md 文件"
                    onClick={onSave} disabled={loading || chatMessagesLength === 0}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-40">
                    <Download className="h-3 w-3" />保存
                </button>
            </div>
        </div>
    );
}
