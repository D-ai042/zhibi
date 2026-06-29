// ContextPanel.tsx — 上下文预览面板（T6 拆分，JSX 原样提取）
import { memo } from "react";
import type { ChapterSummary, BeatCard } from "@/types";

const colLabel: Record<string, string> = {
    goal: "目标", conflict: "冲突", turn: "转折", hook: "钩子", reveal: "揭示",
};

export interface ContextPanelProps {
    collapsed: boolean;
    onToggle: (collapsed: boolean) => void;
    summaries: ChapterSummary[];
    beatCards: BeatCard[];
    characters: { name: string; status?: string }[];
    prevContent: { number: number; title: string; content: string } | null;
    worldRules: string[];
    styleRedlines: string;
    styleNarrative: string;
    styleTone: string;
}

export const ContextPanel = memo(function ContextPanel({
    collapsed, onToggle,
    summaries, beatCards, characters,
    prevContent, worldRules,
    styleRedlines, styleNarrative, styleTone,
}: ContextPanelProps) {
    if (collapsed) {
        return (
            <button
                onClick={() => onToggle(false)}
                className="flex w-6 shrink-0 items-center justify-center border-r bg-white text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                title="展开上下文面板"
            >
                <span className="[writing-mode:vertical-lr] tracking-widest">��上下文</span>
            </button>
        );
    }

    const hasData = summaries.length > 0 || beatCards.length > 0 || characters.length > 0
        || prevContent || worldRules.length > 0
        || styleRedlines || styleNarrative || styleTone;

    return (
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r bg-white p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">�� 上下文引擎</h3>
                <button
                    onClick={() => onToggle(true)}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="折叠上下文面板"
                >
                    <span className="text-xs">✕</span>
                </button>
            </div>

            {prevContent && (
                <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">P4 · 前一章正文</p>
                    <div className="rounded border border-emerald-200 bg-emerald-50/40 px-2 py-1.5 max-h-52 overflow-y-auto">
                        <p className="mb-1 text-[10px] font-semibold text-emerald-700">第{prevContent.number}章 {prevContent.title}</p>
                        <p className="text-[10px] leading-relaxed text-slate-600 whitespace-pre-wrap">{prevContent.content.slice(0, 2000)}</p>
                        {prevContent.content.length > 2000 && (
                            <p className="mt-1 text-[9px] text-slate-400 italic">...后段 {prevContent.content.length} 字，预览前 2000 字</p>
                        )}
                    </div>
                </div>
            )}

            {worldRules.length > 0 && (
                <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-600">P0 · 世界铁则</p>
                    <div className="rounded border border-rose-100 bg-rose-50/30 px-2 py-1.5">
                        {worldRules.map((r, i) => (
                            <p key={i} className="text-[10px] leading-relaxed text-rose-700">{r}</p>
                        ))}
                    </div>
                </div>
            )}

            {characters.length > 0 && (
                <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">P3 · 活跃角色</p>
                    <div className="flex flex-wrap gap-1">
                        {characters.slice(0, 12).map(c => (
                            <span key={c.name} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                                {c.name}{c.status ? `·${c.status}` : ""}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {(styleRedlines || styleNarrative || styleTone) && (
                <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">P2 · 风格指南</p>
                    <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 space-y-1">
                        {styleRedlines && <p className="text-[10px] text-slate-600"><span className="font-semibold text-red-500">红线</span> {styleRedlines.slice(0, 80)}</p>}
                        {styleNarrative && <p className="text-[10px] text-slate-500"><span className="font-semibold">叙述</span> {styleNarrative.slice(0, 80)}</p>}
                        {styleTone && <p className="text-[10px] text-slate-400"><span className="font-semibold">基调</span> {styleTone.slice(0, 80)}</p>}
                    </div>
                </div>
            )}

            {beatCards.length > 0 && (
                <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-violet-600">P1 · 细纲节拍</p>
                    <div className="space-y-1">
                        {beatCards.map(b => (
                            <div key={b.id} className="rounded border border-violet-100 bg-violet-50/50 px-2 py-1 text-[10px] text-slate-600">
                                <span className="font-medium text-violet-700">[{colLabel[b.column_type] || b.column_type}]</span> {b.content}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {summaries.length > 0 && (
                <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600">P1 · 前情摘要</p>
                    <div className="space-y-1.5">
                        {summaries.map(s => (
                            <div key={s.chapter_number} className="rounded border border-amber-100 bg-amber-50/30 px-2 py-1.5">
                                <p className="mb-0.5 text-[10px] font-semibold text-amber-800">第{s.chapter_number}章 {s.chapter_title}</p>
                                <p className="text-[10px] leading-relaxed text-slate-500">{s.summary?.slice(0, 80)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!hasData && (
                <p className="text-[10px] text-slate-400">暂无上下文数据，开始写作后自动生成</p>
            )}
        </aside>
    );
});
