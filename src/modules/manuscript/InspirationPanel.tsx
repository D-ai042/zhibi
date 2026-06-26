import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Lightbulb } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { uuid } from "@/lib/uuid";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { confirmDialog } from "@/lib/confirm";

// ===== 灵感卡片 =====
interface InspirationCard {
    id: string;
    title: string;
    content: string;
    createdAt: string;
}

// ===== localStorage =====
function sk(pid: string) { return "inspiration-cards-" + pid; }
function loadCards(pid: string): InspirationCard[] {
    try { return getJSONSync(sk(pid), [] as any[]); } catch { return []; }
}
function saveCards(pid: string, cards: InspirationCard[]) {
    try { setJSONSync(sk(pid), cards); } catch { /* quota full */ }
}

export function InspirationPanel() {
    const { currentProject } = useAppStore();
    const [cards, setCards] = useState<InspirationCard[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editText, setEditText] = useState("");

    const pid = currentProject?.id;

    // ===== 加载 =====
    useEffect(() => {
        if (!pid) return;
        setCards(loadCards(pid));
    }, [pid]);

    // ===== 添加卡片 =====
    const addCard = useCallback(() => {
        if (!pid) return;
        const card: InspirationCard = {
            id: uuid(),
            title: "",
            content: "",
            createdAt: new Date().toLocaleString("zh-CN"),
        };
        const all = [...loadCards(pid), card];
        saveCards(pid, all);
        setCards(all);
        setEditingId(card.id);
        setEditTitle("");
        setEditText("");
        setTimeout(() => {
            const el = document.getElementById("inspire-title-" + card.id);
            el?.focus();
        }, 50);
    }, [pid]);

    // ===== 保存编辑 =====
    const saveEdit = useCallback((id: string) => {
        if (!pid) return;
        setCards(prev => {
            const upd = prev.map(c => c.id === id ? { ...c, title: editTitle, content: editText } : c);
            saveCards(pid, upd);
            return upd;
        });
        setEditingId(null);
    }, [pid, editTitle, editText]);

    // ===== 删除卡片 =====
    const deleteCard = useCallback((id: string) => {
        if (!pid) return;
        const all = loadCards(pid).filter(c => c.id !== id);
        saveCards(pid, all);
        setCards(all);
        if (editingId === id) setEditingId(null);
    }, [pid, editingId]);

    if (!currentProject || !pid) {
        return (
            <div className="flex h-full items-center justify-center text-slate-500">
                请先创建作品
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-gradient-to-br from-amber-50/40 to-orange-50/40">
            <div className="flex items-center justify-between border-b bg-white/80 px-6 py-4 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <Lightbulb size={22} className="text-amber-500" />
                    <h1 className="text-lg font-bold text-slate-800">灵感</h1>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-700">
                        {cards.length} 条
                    </span>
                </div>
                <button
                    onClick={addCard}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-amber-600 active:scale-95"
                >
                    <Plus size={16} />
                    添加灵感
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {cards.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                        <Lightbulb size={48} className="mb-3 text-amber-200" />
                        <p className="text-sm">还没有灵感卡片</p>
                        <p className="mt-1 text-xs">点击右上角「添加灵感」开始记录</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {cards.map((card, idx) => (
                            <div
                                key={card.id}
                                className="group relative flex flex-col rounded-xl border border-amber-200/60 bg-white shadow-sm transition-all hover:shadow-md"
                                style={{ minHeight: 220 }}
                                onBlur={e => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                        saveEdit(card.id);
                                    }
                                }}
                            >
                                <div className="flex items-center justify-between border-b border-amber-100/60 px-4 py-2.5">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">{idx + 1}</span>
                                        {editingId === card.id ? (
                                            <input
                                                id={"inspire-title-" + card.id}
                                                className="flex-1 rounded border border-amber-300 bg-amber-50/30 px-2 py-1 text-sm font-medium outline-none focus:border-amber-400 focus:bg-white"
                                                value={editTitle}
                                                onChange={e => setEditTitle(e.target.value)}
                                                placeholder="灵感标题"
                                                onClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span
                                                className="flex-1 cursor-text truncate text-sm font-medium text-slate-700"
                                                onClick={() => { setEditingId(card.id); setEditTitle(card.title ?? ""); setEditText(card.content ?? ""); }}
                                            >
                                                {card.title || <span className="italic text-slate-300">未命名</span>}
                                            </span>
                                        )}
                                        <span className="ml-2 whitespace-nowrap text-xs text-slate-400">{card.createdAt}</span>
                                        <button
                                            onClick={() => {
                                                confirmDialog("确定删除这条灵感？").then(ok => { if (ok) deleteCard(card.id); });
                                            }}
                                            className="ml-2 opacity-0 transition-opacity group-hover:opacity-100 text-red-400 hover:text-red-600"
                                            title="删除"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 p-4">
                                    {editingId === card.id ? (
                                        <textarea
                                            id={"inspire-" + card.id}
                                            className="h-full min-h-[160px] w-full resize-none rounded-lg border border-amber-300 bg-amber-50/30 p-4 text-sm leading-relaxed outline-none transition-colors focus:border-amber-400 focus:bg-white"
                                            value={editText}
                                            onChange={e => setEditText(e.target.value)}
                                            placeholder="记录你的灵感…"
                                            onKeyDown={e => {
                                                if (e.key === "Escape") saveEdit(card.id);
                                            }}
                                        />
                                    ) : (
                                        <div
                                            className="h-full min-h-[160px] cursor-text whitespace-pre-wrap break-words rounded-lg p-4 text-sm leading-relaxed text-slate-700 transition-colors hover:bg-amber-50/50"
                                            onClick={() => { setEditingId(card.id); setEditTitle(card.title ?? ""); setEditText(card.content ?? ""); }}
                                        >
                                            {card.content || (
                                                <span className="italic text-slate-300">点击输入灵感…</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
