import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { Globe2, Search } from "lucide-react";
import type { WorldTerm } from "@/types";

const TYPE_LABEL: Record<string, string> = {
    rule: "规则", faction: "势力", place: "地点",
    item: "物品", system: "体系", other: "其他",
};
const TYPE_COLOR: Record<string, string> = {
    rule: "bg-blue-100 text-blue-700", faction: "bg-red-100 text-red-700",
    place: "bg-emerald-100 text-emerald-700", item: "bg-amber-100 text-amber-700",
    system: "bg-violet-100 text-violet-700", other: "bg-slate-100 text-slate-700",
};

export function WorldviewGlossaryPanel() {
    const { currentProject, worldTermBump } = useAppStore();
    const [terms, setTerms] = useState<WorldTerm[]>([]);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<WorldTerm | null>(null);
    const [filterType, setFilterType] = useState<string>("");

    useEffect(() => {
        if (!currentProject) return;
        api.listWorldTerms(currentProject.id).then(setTerms);
    }, [currentProject, worldTermBump]);

    if (!currentProject) return null;

    const filtered = terms.filter(t => {
        if (filterType && t.term_type !== filterType) return false;
        if (search) {
            const q = search.toLowerCase();
            return t.title.toLowerCase().includes(q) || t.one_liner.toLowerCase().includes(q);
        }
        return true;
    });

    return (
        <div className="flex h-full">
            {/* 左侧词条列表 */}
            <div className="flex w-80 shrink-0 flex-col border-r bg-white">
                <div className="border-b p-3">
                    <h2 className="mb-2 text-sm font-semibold">世界观词库</h2>
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                            className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-sm outline-none focus:border-amber-400"
                            placeholder="搜索词条…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        {["", ...Object.keys(TYPE_LABEL)].map(t => (
                            <button
                                key={t}
                                onClick={() => setFilterType(t)}
                                className={`rounded px-2 py-0.5 text-xs ${filterType === t ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                            >
                                {t ? TYPE_LABEL[t] : "全部"}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {filtered.length === 0 ? (
                        <p className="py-8 text-center text-xs text-slate-400">
                            {search ? "未找到匹配词条" : "暂无词条，请在大纲·世界观中添加"}
                        </p>
                    ) : (
                        filtered.map(term => (
                            <button
                                key={term.id}
                                onClick={() => setSelected(term)}
                                className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${selected?.id === term.id ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${TYPE_COLOR[term.term_type]}`}>
                                        {TYPE_LABEL[term.term_type] || term.term_type}
                                    </span>
                                    <span className="text-sm font-medium">{term.title}</span>
                                </div>
                                {term.one_liner && (
                                    <p className="mt-0.5 truncate pl-1 text-xs text-slate-400">{term.one_liner}</p>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* 右侧详情 */}
            <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
                {selected ? (
                    <div className="rounded-xl border bg-white p-6">
                        <div className="mb-4 flex items-center gap-2">
                            <span className={`rounded px-2 py-0.5 text-xs ${TYPE_COLOR[selected.term_type]}`}>
                                {TYPE_LABEL[selected.term_type] || selected.term_type}
                            </span>
                            <h2 className="text-lg font-bold">{selected.title}</h2>
                        </div>
                        {selected.one_liner && (
                            <p className="mb-4 text-sm text-slate-600 italic">「{selected.one_liner}」</p>
                        )}
                        {selected.detail && (
                            <div className="mb-4">
                                <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">详细描述</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.detail}</p>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="text-xs text-slate-400">信息圈层</span>
                                <p className="font-medium">{'★'.repeat(selected.ring_level) || '—'}</p>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400">锁定状态</span>
                                <p className="font-medium">{selected.is_locked ? '🔒 已锁定' : '🔓 未锁定'}</p>
                            </div>
                        </div>
                        {selected.forbidden?.length > 0 && (
                            <div className="mt-4">
                                <h3 className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">禁忌/限制</h3>
                                <ul className="list-disc pl-5 text-sm text-slate-600">
                                    {selected.forbidden.map((f, i) => <li key={i}>{f}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                        <div className="text-center">
                            <Globe2 size={40} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm">从左侧选择一个词条查看详情</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
