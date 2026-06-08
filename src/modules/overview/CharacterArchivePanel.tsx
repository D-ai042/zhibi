import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { Users, Search } from "lucide-react";
import type { Character } from "@/types";

const GENDER_LABEL: Record<string, string> = { male: "男", female: "女", other: "其他", unknown: "未知" };
const GENDER_COLOR: Record<string, string> = { male: "bg-blue-100 text-blue-700", female: "bg-pink-100 text-pink-700", other: "bg-violet-100 text-violet-700", unknown: "bg-slate-100 text-slate-600" };
const ARC_LABEL: Record<string, string> = { growth: "成长", fall: "堕落", redemption: "救赎", static: "固定" };
const ARC_COLOR: Record<string, string> = { growth: "bg-emerald-100 text-emerald-700", fall: "bg-red-100 text-red-700", redemption: "bg-amber-100 text-amber-700", static: "bg-slate-100 text-slate-600" };

export function CharacterArchivePanel() {
    const { currentProject, characterBump } = useAppStore();
    const [chars, setChars] = useState<Character[]>([]);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<Character | null>(null);

    const load = useCallback(() => {
        if (!currentProject) return;
        api.listCharacters(currentProject.id).then(setChars);
    }, [currentProject]);

    useEffect(() => { load(); }, [load, characterBump]);

    if (!currentProject) return null;

    const filtered = chars.filter(c => {
        if (!search) return true;
        const q = search.toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.nickname || "").toLowerCase().includes(q);
    });

    return (
        <div className="flex h-full">
            {/* 左侧角色列表 */}
            <div className="flex w-80 shrink-0 flex-col border-r bg-white">
                <div className="border-b p-3">
                    <h2 className="mb-2 text-sm font-semibold">角色档案</h2>
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                            className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-sm outline-none focus:border-amber-400"
                            placeholder="搜索角色…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {filtered.length === 0 ? (
                        <p className="py-8 text-center text-xs text-slate-400">
                            {search ? "未找到匹配角色" : "暂无角色，请在大纲·人物关系中添加"}
                        </p>
                    ) : (
                        filtered.map(ch => (
                            <button
                                key={ch.id}
                                onClick={() => setSelected(ch)}
                                className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left ${selected?.id === ch.id ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
                                        {ch.name[0]}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm font-medium">{ch.name}</span>
                                            {ch.nickname && <span className="text-xs text-slate-400">「{ch.nickname}」</span>}
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-slate-400">
                                            <span className={`rounded px-1 text-[10px] ${GENDER_COLOR[ch.gender || "unknown"]}`}>
                                                {GENDER_LABEL[ch.gender || "unknown"]}
                                            </span>
                                            {ch.age && <span>{ch.age}岁</span>}
                                        </div>
                                    </div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* 右侧详情 */}
            <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
                {selected ? (
                    <div className="rounded-xl border bg-white p-6">
                        <div className="mb-6 flex items-center gap-4">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-2xl font-bold text-amber-700">
                                {selected.name[0]}
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">{selected.name}</h2>
                                {selected.nickname && <p className="text-sm text-slate-500">「{selected.nickname}」</p>}
                                <div className="mt-1 flex items-center gap-2 text-xs">
                                    <span className={`rounded px-1.5 py-0.5 ${GENDER_COLOR[selected.gender || "unknown"]}`}>
                                        {GENDER_LABEL[selected.gender || "unknown"]}
                                    </span>
                                    {selected.age && <span className="text-slate-500">{selected.age}岁</span>}
                                    {selected.arc && (
                                        <span className={`rounded px-1.5 py-0.5 ${ARC_COLOR[selected.arc] || "bg-slate-100"}`}>
                                            {ARC_LABEL[selected.arc] || selected.arc}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 基本信息 */}
                        <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-slate-400">性别：</span>{selected.gender ? GENDER_LABEL[selected.gender] || selected.gender : "—"}</div>
                            <div><span className="text-slate-400">年龄：</span>{selected.age ? `${selected.age}岁` : "—"}</div>
                            <div><span className="text-slate-400">种族：</span>{selected.race || "—"}</div>
                            <div><span className="text-slate-400">派系：</span>{selected.faction || "—"}</div>
                        </div>

                        {selected.personality && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">内在性格</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.personality}</p>
                            </div>
                        )}

                        {selected.appearance && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">外在形象</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.appearance}</p>
                            </div>
                        )}

                        {selected.background && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">背景经历</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.background}</p>
                            </div>
                        )}

                        {selected.ability && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">能力</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.ability}</p>
                            </div>
                        )}

                        {selected.style && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">行事风格</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.style}</p>
                            </div>
                        )}

                        {selected.interests && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">兴趣爱好</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.interests}</p>
                            </div>
                        )}

                        {selected.desire && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">渴望</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.desire}</p>
                            </div>
                        )}

                        {selected.fear && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">恐惧</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.fear}</p>
                            </div>
                        )}

                        {selected.flaw && (
                            <div className="mb-4">
                                <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">缺陷</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.flaw}</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                        <div className="text-center">
                            <Users size={40} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm">从左侧选择一个角色查看详情</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
