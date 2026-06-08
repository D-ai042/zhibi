import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";

export interface PlotSegment {
    id: string;
    project_id: string;
    type: "bright" | "dark";
    title: string;
    characters: string;
    location: string;
    time: string;
    event: string;
    chapters: string;
}

export interface PlotStoryNodeData {
    segment: PlotSegment;
    onUpdate: (s: PlotSegment) => void;
    onDelete: (id: string) => void;
    /** 可选的已有角色名列表（用于下拉选择） */
    characterOptions?: string[];
    /** 可选的世界观地点词条列表（用于下拉选择） */
    placeOptions?: string[];
    /** 所有世界观词条列表（用于词条字段下拉） */
    termOptions?: string[];
}

const BRIGHT = { bg: "#f0f9ff", border: "#7dd3fc", text: "#0c4a6e", label: "#0369a1", tag: "☀ 明线", tagBg: "#e0f2fe", tagColor: "#0369a1" };
const DARK = { bg: "#f5f3ff", border: "#c4b5fd", text: "#1e1b4b", label: "#6d28d9", tag: "🌑 暗线", tagBg: "#ede9fe", tagColor: "#6d28d9" };

function PlotStoryNode({ data, selected }: NodeProps<PlotStoryNodeData>) {
    const { segment, onUpdate } = data;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(segment.title);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [fieldDraft, setFieldDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const ST = segment.type === "bright" ? BRIGHT : DARK;
    const selBorder = selected ? "#f59e0b" : ST.border;

    useEffect(() => { setDraft(segment.title); }, [segment.title]);
    useEffect(() => {
        if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
    }, [editing]);

    const commit = useCallback(() => {
        setEditing(false);
        const t = draft.trim();
        if (t && t !== segment.title) onUpdate({ ...segment, title: t });
        else setDraft(segment.title);
    }, [draft, segment, onUpdate]);

    const startEdit = (field: string, value: string) => {
        setEditingField(field);
        setFieldDraft(value || "");
    };

    // 根据当前编辑字段获取可选列表
    const getOptions = (): string[] => {
        if (editingField === "characters") return data.characterOptions || [];
        if (editingField === "location") return data.placeOptions || [];
        return [];
    };
    const options = getOptions();
    const [showOptions, setShowOptions] = useState(false);
    const [optionFilter, setOptionFilter] = useState("");
    const filteredOptions = options.filter(o =>
        o.toLowerCase().includes((optionFilter || fieldDraft || "").toLowerCase())
    ).slice(0, 20);
    const commitField = (field: string) => {
        if (editingField) onUpdate({ ...segment, [field]: fieldDraft });
        setEditingField(null);
    };

    const fields = [
        { label: "人物", key: "characters" },
        { label: "章节", key: "chapters" },
        { label: "时间", key: "time" },
    ];

    return (
        <div
            className="rounded-xl transition-all duration-200 cursor-pointer select-none"
            style={{
                width: 240,
                background: "#fff",
                border: `2px solid ${selBorder}`,
                boxShadow: selected
                    ? `0 0 0 4px rgba(245,158,11,0.15), 0 8px 24px rgba(0,0,0,0.08)`
                    : "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
                overflow: "hidden",
            }}
        >
            {/* 顶部色条 */}
            <div style={{ height: 5, background: ST.label }} />

            {/* 头部：标题 + 标签 */}
            <div style={{ padding: "10px 12px 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                {editing ? (
                    <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
                        onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(segment.title); setEditing(false); } }}
                        className="nodrag w-full text-sm font-bold outline-none border-b border-amber-400 bg-transparent"
                        style={{ color: ST.text }}
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <div
                        style={{ fontSize: 14, fontWeight: 700, color: ST.text, cursor: "pointer", flex: 1 }}
                        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
                    >
                        {segment.title}
                    </div>
                )}
                <span style={{
                    fontSize: 10, fontWeight: 600,
                    background: ST.tagBg, color: ST.tagColor,
                    borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap",
                    marginLeft: 6,
                }}>
                    {ST.tag}
                </span>
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); data.onDelete(segment.id); }}
                    style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: 2, marginLeft: 4, color: "#94a3b8", flexShrink: 0,
                    }}
                    title="删除此段落"
                    className="hover:text-red-500"
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            </div>

            {/* 分隔线 */}
            <div style={{ height: 1, background: "#f1f5f9", margin: "4px 12px" }} />

            {/* 字段 */}
            <div style={{ padding: "6px 12px 8px", fontSize: 11.5, lineHeight: 1.7 }}>
                {fields.map(f => (
                    <div key={f.key} style={{ display: "flex", marginBottom: 2 }}>
                        <span style={{ color: ST.label, fontWeight: 600, width: 36, flexShrink: 0 }}>{f.label}</span>
                        {editingField === f.key ? (
                            <div style={{ position: "relative", flex: 1 }}>
                                <input value={fieldDraft} onChange={e => {
                                    setFieldDraft(e.target.value);
                                    setOptionFilter(e.target.value);
                                    setShowOptions(true);
                                }}
                                    onFocus={() => { setShowOptions(true); setOptionFilter(fieldDraft); }}
                                    onBlur={() => setTimeout(() => setShowOptions(false), 200)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") { commitField(f.key); setShowOptions(false); }
                                        if (e.key === "Escape") { setEditingField(null); setShowOptions(false); }
                                    }}
                                    className="nodrag"
                                    style={{ border: "1px solid " + ST.label, borderRadius: 4, padding: "0 4px", fontSize: 11, width: "100%", outline: "none" }}
                                    autoFocus
                                    onClick={e => e.stopPropagation()}
                                />
                                {showOptions && filteredOptions.length > 0 && (
                                    <div style={{
                                        position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
                                        background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6,
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxHeight: 150, overflowY: "auto",
                                    }}>
                                        {filteredOptions.map(opt => (
                                            <div key={opt}
                                                onMouseDown={e => { e.preventDefault(); setFieldDraft(opt); commitField(f.key); setShowOptions(false); }}
                                                style={{ padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#1e293b" }}
                                                onMouseEnter={e => (e.currentTarget.style.background = "#f1f5f9")}
                                                onMouseLeave={e => (e.currentTarget.style.background = "")}
                                            >{opt}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <span style={{ color: "#475569", cursor: "pointer", flex: 1 }} onClick={() => startEdit(f.key, (segment as any)[f.key])}>
                                {(segment as any)[f.key] || "—"}
                            </span>
                        )}
                    </div>
                ))}

                {/* 事件 - 单独一行 */}
                <div style={{ marginTop: 4 }}>
                    <span style={{ color: ST.label, fontWeight: 600, fontSize: 11 }}>事件</span>
                    {editingField === "event" ? (
                        <textarea value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
                            onBlur={() => commitField("event")}
                            onKeyDown={e => { if (e.key === "Escape") setEditingField(null); }}
                            className="nodrag"
                            style={{ border: "1px solid " + ST.label, borderRadius: 4, padding: 2, fontSize: 11, width: "100%", minHeight: 40, outline: "none", resize: "none", marginTop: 2 }}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                        />
                    ) : (
                        <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.5, marginTop: 2, cursor: "pointer" }} onClick={() => startEdit("event", segment.event)}>
                            {segment.event || "—"}
                        </div>
                    )}
                </div>
            </div>

            {/* 连接点：左/右 → 同线前后相连；底(明线)/顶(暗线) → 明暗相连 */}
            <Handle type="source" position={Position.Right} id="right"
                style={{ width: 8, height: 8, background: ST.label, border: "2px solid #fff", borderRadius: "50%" }} />
            <Handle type="target" position={Position.Left} id="left"
                style={{ width: 8, height: 8, background: ST.label, border: "2px solid #fff", borderRadius: "50%" }} />
            {segment.type === "bright" && (
                <Handle type="source" position={Position.Bottom} id="bottom"
                    style={{ width: 8, height: 8, background: "#f59e0b", border: "2px solid #fff", borderRadius: "50%" }} />
            )}
            {segment.type === "dark" && (
                <Handle type="target" position={Position.Top} id="top"
                    style={{ width: 8, height: 8, background: "#f59e0b", border: "2px solid #fff", borderRadius: "50%" }} />
            )}
        </div>
    );
}

export default memo(PlotStoryNode);
