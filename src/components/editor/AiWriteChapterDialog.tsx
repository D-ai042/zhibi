import { useState, useCallback, useEffect } from "react";
import { X, Sparkles } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { getJSONSync } from "@/lib/storage";

interface AiWriteChapterDialogProps {
    chapterNumber: number;
    chapterTitle: string;
    onConfirm: (wordCount: number, plotDirection: string, refIds: string[]) => void;
    onClose: () => void;
}

const WORD_OPTIONS = [
    { value: 1000, label: "~1,000 字（短章节）" },
    { value: 2000, label: "~2,000 字（标准章节）" },
    { value: 3000, label: "~3,000 字（详细章节）" },
    { value: 4000, label: "~4,000 字（大章节）" },
    { value: 5000, label: "~5,000 字（超大章节）" },
];

export function AiWriteChapterDialog({
    chapterNumber,
    chapterTitle,
    onConfirm,
    onClose,
}: AiWriteChapterDialogProps) {
    const [wordCount, setWordCount] = useState(2000);
    const [plotDirection, setPlotDirection] = useState("");
    const [customWordCount, setCustomWordCount] = useState("");
    const [useCustom, setUseCustom] = useState(false);

    // 参考相关 state
    const [showRefDropdown, setShowRefDropdown] = useState(false);
    const [refSet, setRefSet] = useState<Set<string>>(new Set());
    const [inspirationList, setInspirationList] = useState<any[]>([]);
    const [materialList, setMaterialList] = useState<any[]>([]);

    const toggleRef = (id: string) => {
        setRefSet(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // 点击外部关闭参考下拉
    const currentProject = useAppStore(s => s.currentProject);
    const pid = currentProject?.id;

    useEffect(() => {
        if (!showRefDropdown) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-ref-dropdown]')) setShowRefDropdown(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showRefDropdown]);

    // Escape 键关闭
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    const canConfirm = wordCount > 0 || (useCustom && parseInt(customWordCount) > 0);
    const handleConfirm = useCallback(() => {
        if (!canConfirm) return;
        const finalWordCount = useCustom ? (parseInt(customWordCount) || 2000) : wordCount;
        onConfirm(finalWordCount, plotDirection.trim(), Array.from(refSet));
    }, [wordCount, plotDirection, customWordCount, useCustom, onConfirm, refSet, canConfirm]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
            <div className="w-full max-w-lg rounded-xl border bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-violet-600" />
                        <h2 className="text-lg font-bold text-slate-800">AI 写本章</h2>
                    </div>
                    <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <p className="mb-4 text-sm text-slate-500">
                    第{chapterNumber}章「{chapterTitle}」
                </p>

                {/* 字数选择 */}
                <div className="mb-4">
                    <label className="mb-2 block text-xs font-semibold text-slate-700">字数参考</label>
                    <div className="space-y-1.5">
                        {WORD_OPTIONS.map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 has-[:checked]:border-violet-400 has-[:checked]:bg-violet-50">
                                <input
                                    type="radio"
                                    name="wordCount"
                                    checked={!useCustom && wordCount === opt.value}
                                    onChange={() => { setWordCount(opt.value); setUseCustom(false); }}
                                    className="text-violet-600"
                                />
                                {opt.label}
                            </label>
                        ))}
                        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 has-[:checked]:border-violet-400 has-[:checked]:bg-violet-50">
                            <input
                                type="radio"
                                name="wordCount"
                                checked={useCustom}
                                onChange={() => setUseCustom(true)}
                                className="text-violet-600"
                            />
                            <span>自定义：</span>
                            <input
                                type="number"
                                min={500}
                                max={10000}
                                step={500}
                                value={customWordCount}
                                onChange={e => setCustomWordCount(e.target.value)}
                                onClick={() => setUseCustom(true)}
                                className="w-24 rounded border px-2 py-0.5 text-sm outline-none focus:border-violet-400"
                                placeholder="字数"
                            />
                            <span className="text-slate-400">字</span>
                        </label>
                    </div>
                </div>

                {/* 参考下拉多选 */}
                <div className="mb-4" data-ref-dropdown>
                    <label className="mb-2 block text-xs font-semibold text-slate-700">参考素材 / 灵感</label>
                    <div className="relative">
                        <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none hover:border-violet-400 bg-white"
                            onClick={() => {
                                if (pid) {
                                    const cards = getJSONSync(`inspiration-cards-${pid}`, [] as any[]);
                                    const rawItems = getJSONSync(`material-items-${pid}`, [] as any[]);
                                    const textItems = rawItems.filter((i: any) => i.content);
                                    setInspirationList(cards);
                                    setMaterialList(textItems);
                                }
                                setShowRefDropdown(prev => !prev);
                            }}
                        >
                            <span className={refSet.size > 0 ? "text-violet-700 font-medium" : "text-slate-400"}>
                                {refSet.size > 0 ? `已选 ${refSet.size} 项` : "不参考"}
                            </span>
                            <span className="ml-1 text-slate-400">{showRefDropdown ? "▲" : "▼"}</span>
                        </button>
                        {showRefDropdown && (
                            <div className="absolute left-0 top-full z-50 mt-0.5 w-full rounded-md border border-slate-200 bg-white py-1 shadow-lg" style={{ maxHeight: 280, overflowY: "auto" }}>
                                {/* 灵感 */}
                                <p className="px-2.5 py-1 text-[10px] font-semibold text-amber-600 bg-amber-50/50">灵感</p>
                                {inspirationList.length === 0 && <p className="px-2.5 py-1 text-[10px] text-slate-400 italic">暂无灵感卡片</p>}
                                {inspirationList.map((card: any, i: number) => (
                                    <label key={card.id} className="flex cursor-pointer items-start gap-1.5 px-2.5 py-1 text-[11px] hover:bg-amber-50">
                                        <input type="checkbox" className="mt-0.5 h-3 w-3 shrink-0 accent-amber-500"
                                            checked={refSet.has("insp:" + card.id)}
                                            onChange={() => toggleRef("insp:" + card.id)} />
                                        <span className="shrink-0 font-bold text-amber-500 w-4">{i + 1}</span>
                                        <span className="text-slate-700 truncate">{card.title || "无标题"}</span>
                                    </label>
                                ))}
                                {/* 素材库 */}
                                <p className="mt-1 border-t border-slate-100 px-2.5 py-1 text-[10px] font-semibold text-blue-600 bg-blue-50/50">素材库</p>
                                {materialList.length === 0 && <p className="px-2.5 py-1 text-[10px] text-slate-400 italic">暂无文本素材</p>}
                                {materialList.map((item: any, i: number) => (
                                    <label key={item.id} className="flex cursor-pointer items-start gap-1.5 px-2.5 py-1 text-[11px] hover:bg-blue-50">
                                        <input type="checkbox" className="mt-0.5 h-3 w-3 shrink-0 accent-blue-500"
                                            checked={refSet.has("mat:" + item.id)}
                                            onChange={() => toggleRef("mat:" + item.id)} />
                                        <span className="shrink-0 font-bold text-blue-500 w-4">{i + 1}</span>
                                        <span className="text-slate-700 truncate">{item.name || "未命名"}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* 剧情方向 */}
                <div className="mb-4">
                    <label className="mb-2 block text-xs font-semibold text-slate-700">
                        剧情方向 / 补充要求 <span className="text-slate-400">（选填）</span>
                    </label>
                    <textarea
                        className="w-full rounded-lg border border-slate-200 p-3 text-sm leading-relaxed outline-none focus:border-violet-400 resize-y"
                        rows={4}
                        value={plotDirection}
                        onChange={e => setPlotDirection(e.target.value)}
                        placeholder={`例如：本章主角应和影七交手，发现禁地秘密，留下伏笔。\n情绪节奏：前段紧张压抑，中段战斗激烈，后段悬疑收尾。`}
                    />
                </div>

                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">
                        取消
                    </button>
                    <button onClick={handleConfirm} disabled={!canConfirm} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50">
                        <Sparkles className="h-4 w-4" />
                        开始写作
                    </button>
                </div>
            </div>
        </div>
    );
}
