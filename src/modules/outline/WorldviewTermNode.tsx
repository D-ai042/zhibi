import { memo, useCallback, useState, useRef, useEffect } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Lock, Trash2, Unlock } from "lucide-react";
import type { WorldTerm } from "@/types";

const TYPE_COLORS: Record<WorldTerm["term_type"], { bg: string; border: string; text: string }> = {
    rule: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
    faction: { bg: "#fce7f3", border: "#ec4899", text: "#9d174d" },
    place: { bg: "#d1fae5", border: "#10b981", text: "#065f46" },
    item: { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b6" },
    system: { bg: "#fed7aa", border: "#f97316", text: "#9a3412" },
    other: { bg: "#f3f4f6", border: "#9ca3af", text: "#374151" },
};

const TYPE_LABEL: Record<WorldTerm["term_type"], string> = {
    rule: "规则",
    faction: "势力",
    place: "地点",
    item: "道具",
    system: "制度",
    other: "其他",
};

export interface WorldviewTermData {
    [key: string]: unknown;
    term: WorldTerm;
    onUpdate: (term: WorldTerm) => void;
    onSelect: (term: WorldTerm) => void;
    /** ★ 传入 title 避免 WorldviewPanel 侧 terms 闭包过期导致显示 id */
    onDelete: (id: string, title: string) => void;
    editing?: boolean;
}

function WorldviewTermNode({ data }: NodeProps<Node<WorldviewTermData>>) {
    const { term, onUpdate, onSelect, onDelete, editing } = data;
    const callbacks = useRef({ onUpdate, onSelect, onDelete });
    useEffect(() => { callbacks.current = { onUpdate, onSelect, onDelete }; }, [onUpdate, onSelect, onDelete]);

    const safeUpdate = (u: WorldTerm) => { if (typeof callbacks.current.onUpdate === "function") callbacks.current.onUpdate(u); };
    const safeSelect = () => { if (typeof callbacks.current.onSelect === "function") callbacks.current.onSelect(term); };
    const safeDelete = () => { if (typeof callbacks.current.onDelete === "function") callbacks.current.onDelete(term.id, term.title); };
    const colors = TYPE_COLORS[term.term_type] ?? TYPE_COLORS.other;
    const typeLabel = TYPE_LABEL[term.term_type] ?? "其他";
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(term.title);
    const titleRef = useRef<HTMLInputElement>(null);

    // ReactFlow onNodeDoubleClick → enter title edit mode
    useEffect(() => {
        if (editing && !term.is_locked) setEditingTitle(true);
    }, [editing, term.is_locked]);

    useEffect(() => {
        setTitleDraft(term.title);
    }, [term.title]);

    useEffect(() => {
        if (editingTitle && titleRef.current) {
            titleRef.current.focus();
            titleRef.current.select();
        }
    }, [editingTitle]);

    const commitTitle = useCallback(() => {
        setEditingTitle(false);
        const trimmed = titleDraft.trim();
        if (trimmed && trimmed !== term.title) {
            safeUpdate({ ...term, title: trimmed });
        } else {
            setTitleDraft(term.title);
        }
    }, [titleDraft, term]);

    // 下方文本框：one_liner + detail（不含标题）
    const bodyText = [term.one_liner, term.detail].filter(Boolean).join("\n");

    const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const lines = e.target.value.split("\n");
        const one_liner = lines[0] || "";
        const detail = lines.slice(1).join("\n");
        safeUpdate({ ...term, one_liner, detail });
    };

    return (
        <div
            className="rounded-xl bg-white shadow-lg transition-shadow hover:shadow-xl"
            style={{
                border: `2px solid ${colors.border}`,
                minWidth: 200,
                maxWidth: 360,
                width: "auto",
            }}
        >
            {/* 顶部：类型标签 + 标题 + 操作按钮 */}
            <div
                className="flex items-center justify-between rounded-t-lg px-3 py-1.5"
                style={{ backgroundColor: colors.bg }}
            >
                {/* 左侧：类型标签 + 分区标签 */}
                <div className="flex items-center gap-1">
                    <span
                        className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold leading-none"
                        style={{ backgroundColor: colors.border, color: "#fff" }}
                    >
                        {typeLabel}
                    </span>
                    {term.zone && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-medium leading-none"
                            style={{
                                backgroundColor: term.zone === "core" ? "#dc2626" : term.zone === "locked" ? "#4b5563" : term.zone === "active" ? "#16a34a" : "#ea580c",
                                color: "#fff", opacity: 0.7
                            }}>
                            {term.zone === "core" ? "核心" : term.zone === "locked" ? "锁定" : term.zone === "active" ? "创作" : "其他"}
                        </span>
                    )}
                </div>

                {/* 中间：标题 - 居中 */}
                {editingTitle ? (
                    <input
                        ref={titleRef}
                        className="mx-1 min-w-0 flex-1 rounded border border-amber-300 px-1 py-0.5 text-center text-sm font-semibold outline-none"
                        value={titleDraft}
                        style={{ color: colors.text }}
                        onBlur={commitTitle}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitTitle();
                            if (e.key === "Escape") {
                                setTitleDraft(term.title);
                                setEditingTitle(false);
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setTitleDraft(e.target.value)}
                    />
                ) : (
                    <span
                        className="mx-1 min-w-0 flex-1 cursor-text truncate text-center text-sm font-semibold"
                        style={{ color: colors.text }}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!term.is_locked) setEditingTitle(true);
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            safeSelect();
                        }}
                        title={term.is_locked ? "已锁定" : "双击修改标题"}
                    >
                        {term.title}
                    </span>
                )}

                {/* 右侧：操作按钮 */}
                <div className="flex shrink-0 items-center gap-0.5">
                    <button
                        type="button"
                        className="nodrag rounded p-0.5 hover:bg-black/10"
                        onClick={(e) => {
                            e.stopPropagation();
                            safeUpdate({ ...term, is_locked: !term.is_locked });
                        }}
                        title={term.is_locked ? "解锁" : "锁定"}
                    >
                        {term.is_locked ? (
                            <Lock className="h-3 w-3" style={{ color: colors.text }} />
                        ) : (
                            <Unlock className="h-3 w-3 opacity-50" style={{ color: colors.text }} />
                        )}
                    </button>
                    <button
                        type="button"
                        className="nodrag rounded p-0.5 hover:bg-red-200/60"
                        onClick={(e) => {
                            e.stopPropagation();
                            safeDelete();
                        }}
                        title="删除词条"
                    >
                        <Trash2 className="h-3 w-3" style={{ color: colors.text }} />
                    </button>
                </div>
            </div>

            {/* 正文文本框 */}
            <div className="px-2 pb-2">
                <textarea
                    className="nodrag nopan nowheel w-full rounded-lg border border-slate-100 bg-slate-50/50 p-2 text-xs text-slate-600 outline-none transition-colors placeholder:text-slate-300 hover:border-slate-200 focus:border-amber-300 focus:bg-white focus:ring-1 focus:ring-amber-200"
                    value={bodyText}
                    placeholder="一句话定义"
                    rows={3}
                    readOnly={term.is_locked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={handleBodyChange}
                    style={{ resize: "vertical", minHeight: 60, maxHeight: 300 }}
                />
            </div>

            {/* 连接点 — 四个方向，支持星图多连线 */}
            <Handle
                type="target"
                position={Position.Top}
                id="top"
                className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 hover:!bg-amber-500 transition-colors"
                style={{ top: -6 }}
            />
            <Handle
                type="source"
                position={Position.Bottom}
                id="bottom"
                className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 hover:!bg-amber-500 transition-colors"
                style={{ bottom: -6 }}
            />
            <Handle
                type="source"
                position={Position.Right}
                id="right"
                className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 hover:!bg-amber-500 transition-colors"
                style={{ right: -6 }}
            />
            <Handle
                type="target"
                position={Position.Left}
                id="left"
                className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 hover:!bg-amber-500 transition-colors"
                style={{ left: -6 }}
            />
        </div>
    );
}

export default memo(WorldviewTermNode);
