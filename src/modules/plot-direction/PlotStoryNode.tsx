import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Trash2, ChevronUp, Plus, X } from "lucide-react";
import { uuid } from "@/lib/uuid";

export interface PlotBeat {
    id: string;
    number: number;
    title: string;
    characters: string;
    location: string;
    time: string;
    event: string;
    chapters: string;
}

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
    beats: PlotBeat[];
}

export interface PlotStoryNodeData {
    [key: string]: unknown;
    segment: PlotSegment;
    onUpdate: (s: PlotSegment) => void;
    onDelete: (id: string) => void;
    characterOptions?: string[];
    placeOptions?: string[];
    termOptions?: string[];
}

const BRIGHT = { bg: "#f0f9ff", border: "#7dd3fc", text: "#0c4a6e", label: "#0369a1", tag: "☀ 明线", tagBg: "#e0f2fe", tagColor: "#0369a1" };
const DARK = { bg: "#f5f3ff", border: "#c4b5fd", text: "#1e1b4b", label: "#6d28d9", tag: "🌑 暗线", tagBg: "#ede9fe", tagColor: "#6d28d9" };

/** 单个细纲卡片 — 样式同段落卡片，去掉明线标签 */
function BeatCard({ beat, onUpdate, onDelete, onPointerDown, selected, onToggleSelect, beatIdForDom }: {
    beat: PlotBeat;
    onUpdate: (b: PlotBeat) => void;
    onDelete: (id: string) => void;
    onPointerDown?: (e: React.PointerEvent) => void;
    selected?: boolean;
    onToggleSelect?: () => void;
    beatIdForDom: string;
}) {
    const [editingBeat, setEditingBeat] = useState(false);
    const [beatDraft, setBeatDraft] = useState(beat.title);
    const beatInputRef = useRef<HTMLInputElement>(null);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [fieldDraft, setFieldDraft] = useState("");

    useEffect(() => { setBeatDraft(beat.title); }, [beat.title]);
    useEffect(() => {
        if (editingBeat && beatInputRef.current) { beatInputRef.current.focus(); beatInputRef.current.select(); }
    }, [editingBeat]);

    const commitBeat = () => {
        setEditingBeat(false);
        const t = beatDraft.trim();
        if (t && t !== beat.title) onUpdate({ ...beat, title: t });
        else setBeatDraft(beat.title);
    };

    const startEdit = (field: string, value: string) => {
        setEditingField(field);
        setFieldDraft(value || "");
    };

    const commitField = (field: string) => {
        if (editingField) onUpdate({ ...beat, [field]: fieldDraft });
        setEditingField(null);
    };

    const beatFields = [
        { label: "人物", key: "characters" },
        { label: "章节", key: "chapters" },
        { label: "时间", key: "time" },
    ];

    return (
        <div
            className="nodrag rounded-xl transition-all duration-200 select-none"
            data-beat-id={beatIdForDom}
            onPointerDown={onPointerDown}
            style={{
                width: 200,
                background: "#fff",
                border: "2px solid #e2e8f0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
                opacity: 0.95,
                overflow: "hidden",
                cursor: "grab",
            }}
        >
            {/* 顶部色条 */}
            <div style={{ height: 4, background: "#94a3b8" }} />

            {/* 头部：选框 · 序号 · 标题 · 关闭 */}
            <div style={{ padding: "6px 8px 2px", display: "flex", alignItems: "center", gap: 2 }}>
                <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0, width: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <input type="checkbox" checked={!!selected} onChange={onToggleSelect}
                        className="nodrag"
                        style={{ width: 12, height: 12, cursor: "pointer", accentColor: "#ef4444" }}
                        onClick={e => e.stopPropagation()}
                    />
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", flexShrink: 0, width: 16, textAlign: "left" }}>{beat.number}</span>
                {editingBeat ? (
                    <input ref={beatInputRef} value={beatDraft} onChange={e => setBeatDraft(e.target.value)}
                        onBlur={commitBeat} onKeyDown={e => { if (e.key === "Enter") commitBeat(); if (e.key === "Escape") { setBeatDraft(beat.title); setEditingBeat(false); } }}
                        className="nodrag text-xs font-bold outline-none border-b border-amber-400 bg-transparent text-center"
                        style={{ color: "#334155", minWidth: 40, maxWidth: 120, flex: 1 }}
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <div
                        style={{ fontSize: 12, fontWeight: 700, color: "#334155", cursor: "pointer", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingBeat(true); }}
                    >
                        {beat.title}
                    </div>
                )}
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onDelete(beat.id); }}
                    className="nodrag text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, marginLeft: 4, lineHeight: 1 }}
                >
                    <X className="h-3 w-3" />
                </button>
            </div>

            {/* 分隔线 */}
            <div style={{ height: 1, background: "#f1f5f9", margin: "2px 8px" }} />

            {/* 字段 */}
            <div style={{ padding: "2px 8px 6px", fontSize: 10, lineHeight: 1.6 }}>
                {beatFields.map(f => (
                    <div key={f.key} style={{ display: "flex", marginBottom: 1 }}>
                        <span style={{ color: "#64748b", fontWeight: 600, width: 28, flexShrink: 0 }}>{f.label}</span>
                        {editingField === f.key ? (
                            <input value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
                                onBlur={() => commitField(f.key)}
                                onKeyDown={e => { if (e.key === "Enter") { commitField(f.key); } if (e.key === "Escape") setEditingField(null); }}
                                className="nodrag"
                                style={{ border: "1px solid #94a3b8", borderRadius: 4, padding: "0 4px", fontSize: 10, width: "100%", outline: "none" }}
                                autoFocus
                                onClick={e => e.stopPropagation()}
                            />
                        ) : (
                            <span style={{ color: "#475569", cursor: "pointer", flex: 1 }} onClick={e => { e.stopPropagation(); startEdit(f.key, (beat as any)[f.key] || ""); }}>
                                {(beat as any)[f.key] || "—"}
                            </span>
                        )}
                    </div>
                ))}
                {/* 事件 */}
                <div style={{ marginTop: 2 }}>
                    <span style={{ color: "#64748b", fontWeight: 600, fontSize: 10 }}>事件</span>
                    {editingField === "event" ? (
                        <textarea value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
                            onBlur={() => commitField("event")}
                            onKeyDown={e => { if (e.key === "Escape") setEditingField(null); }}
                            className="nodrag"
                            style={{ border: "1px solid #94a3b8", borderRadius: 4, padding: 2, fontSize: 10, width: "100%", minHeight: 28, outline: "none", resize: "none", marginTop: 1 }}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                        />
                    ) : (
                        <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.4, marginTop: 1, cursor: "pointer" }} onClick={e => { e.stopPropagation(); startEdit("event", beat.event); }}>
                            {beat.event || "—"}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PlotStoryNode({ data, selected }: NodeProps<Node<PlotStoryNodeData>>) {
    const { segment, onUpdate } = data;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(segment.title);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [fieldDraft, setFieldDraft] = useState("");
    const [expanded, setExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const ST = segment.type === "bright" ? BRIGHT : DARK;
    const selBorder = selected ? "#f59e0b" : ST.border;
    const beats = segment.beats || [];

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

    const addBeat = () => {
        const nextNum = beats.reduce((max, b) => Math.max(max, b.number || 0), 0) + 1;
        const newBeat: PlotBeat = { id: uuid(), number: nextNum, title: "新细纲", characters: "", location: "", time: "", event: "", chapters: "" };
        onUpdate({ ...segment, beats: [...beats, newBeat] });
        if (!expanded) setExpanded(true);
    };

    const updateBeat = (b: PlotBeat) => {
        onUpdate({ ...segment, beats: beats.map(x => x.id === b.id ? b : x) });
    };

    const deleteBeat = (id: string) => {
        onUpdate({ ...segment, beats: beats.filter(x => x.id !== id) });
    };

    // ★ 拖拽重排细纲（替身跟随鼠标，零 React re-render）
    const dragRef = useRef<{
        beatId: string;
        startX: number; startY: number;
        cardRect: DOMRect;  // 卡片初始屏幕位置
        phantom: HTMLElement;  // document.body 上的替身
        origEl: HTMLElement;   // 原始卡片（变透明占位）
        totalDx: number; totalDy: number;
        gridEl: HTMLElement | null;
    } | null>(null);
    const lastHighlightEl = useRef<HTMLElement | null>(null);
    const beatsRef = useRef(beats);
    const segmentRef = useRef(segment);
    const onUpdateRef = useRef(onUpdate);
    beatsRef.current = beats;
    segmentRef.current = segment;
    onUpdateRef.current = onUpdate;

    // ★ 批量删除
    const [selectedBeatIds, setSelectedBeatIds] = useState<Set<string>>(new Set());
    const toggleBeatSelect = (id: string) => {
        setSelectedBeatIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const allSelected = beats.length > 0 && selectedBeatIds.size === beats.length;
    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedBeatIds(new Set());
        } else {
            setSelectedBeatIds(new Set(beats.map(b => b.id)));
        }
    };
    const batchDeleteBeats = () => {
        if (selectedBeatIds.size === 0) return;
        if (!window.confirm(`确定删除选中的 ${selectedBeatIds.size} 个细纲？此操作不可撤销。`)) return;
        const remaining = beats.filter(b => !selectedBeatIds.has(b.id));
        const renumbered = remaining.map((b, i) => ({ ...b, number: i + 1 }));
        onUpdate({ ...segment, beats: renumbered });
        setSelectedBeatIds(new Set());
    };

    // 找到替身中心点最近的目标卡片
    function findClosestBeat(phantom: HTMLElement, gridEl: HTMLElement): string | null {
        const pr = phantom.getBoundingClientRect();
        const pcx = pr.left + pr.width / 2;
        const pcy = pr.top + pr.height / 2;
        let bestId: string | null = null;
        let bestDist = Infinity;
        const cards = gridEl.querySelectorAll<HTMLElement>('[data-beat-id]');
        for (const card of cards) {
            const cr = card.getBoundingClientRect();
            const ccx = cr.left + cr.width / 2;
            const ccy = cr.top + cr.height / 2;
            const dist = Math.hypot(pcx - ccx, pcy - ccy);
            if (dist < bestDist) {
                bestDist = dist;
                bestId = card.dataset.beatId ?? null;
            }
        }
        return bestId;
    }

    const handlePointerDown = (beatId: string) => (e: React.PointerEvent) => {
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        const gridEl = el.closest('[data-beat-grid]') as HTMLElement;
        const cardRect = el.getBoundingClientRect();

        // 创建替身 — position:fixed 贴屏幕，不受 React Flow 画布影响
        const phantom = el.cloneNode(true) as HTMLElement;
        phantom.style.position = "fixed";
        phantom.style.left = cardRect.left + "px";
        phantom.style.top = cardRect.top + "px";
        phantom.style.width = cardRect.width + "px";
        phantom.style.height = cardRect.height + "px";
        phantom.style.zIndex = "99999";
        phantom.style.pointerEvents = "none";
        phantom.style.opacity = "0.9";
        phantom.style.margin = "0";
        phantom.style.transition = "none";
        document.body.appendChild(phantom);

        // 原卡片变淡占位
        el.style.opacity = "0.25";

        dragRef.current = {
            beatId, startX: e.clientX, startY: e.clientY,
            cardRect, phantom, origEl: el,
            totalDx: 0, totalDy: 0, gridEl,
        };

        const onMove = (ev: PointerEvent) => {
            const d = dragRef.current;
            if (!d) return;
            d.totalDx = ev.clientX - d.startX;
            d.totalDy = ev.clientY - d.startY;
            d.phantom.style.left = (d.cardRect.left + d.totalDx) + "px";
            d.phantom.style.top = (d.cardRect.top + d.totalDy) + "px";

            // 找最近卡片并高亮
            const closestId = d.gridEl ? findClosestBeat(d.phantom, d.gridEl) : null;
            const prev = lastHighlightEl.current;
            // 跳过自己
            const effectiveId = (closestId && closestId !== d.beatId) ? closestId : null;

            if (prev && prev.dataset.beatId !== effectiveId) {
                prev.style.border = "2px solid #e2e8f0";
                prev.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)";
                lastHighlightEl.current = null;
            }
            if (effectiveId) {
                const target = d.gridEl?.querySelector<HTMLElement>(`[data-beat-id="${effectiveId}"]`);
                if (target && target !== prev) {
                    target.style.border = "2px solid #f59e0b";
                    target.style.boxShadow = "0 0 0 4px rgba(245,158,11,0.15)";
                    lastHighlightEl.current = target;
                }
            } else if (!effectiveId && prev) {
                prev.style.border = "2px solid #e2e8f0";
                prev.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)";
                lastHighlightEl.current = null;
            }
        };
        const onUp = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            const d = dragRef.current;
            dragRef.current = null;

            // 清理高亮
            const prev = lastHighlightEl.current;
            if (prev) {
                prev.style.border = "2px solid #e2e8f0";
                prev.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)";
                lastHighlightEl.current = null;
            }

            if (d) {
                // 删除替身
                if (d.phantom.parentNode) d.phantom.parentNode.removeChild(d.phantom);
                // 还原原卡片
                d.origEl.style.opacity = "";
            }

            // 移动距离不足 20px，不交换
            if (!d || Math.hypot(d.totalDx, d.totalDy) < 20) return;

            const targetId = prev?.dataset?.beatId;
            if (!targetId || targetId === d.beatId) return;
            const bts = beatsRef.current;
            const srcIdx = bts.findIndex(b => b.id === d.beatId);
            const tgtIdx = bts.findIndex(b => b.id === targetId);
            if (srcIdx < 0 || tgtIdx < 0) return;
            const reordered = [...bts];
            const [moved] = reordered.splice(srcIdx, 1);
            reordered.splice(tgtIdx, 0, moved);
            onUpdateRef.current({ ...segmentRef.current, beats: reordered.map((b, i) => ({ ...b, number: i + 1 })) });
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    };

    return (
        <div className="relative">
            {/* 展开的细纲卡片行 */}
            {expanded && (
                <div
                    className="absolute" style={{ bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 10, display: "flex", flexDirection: "column", alignItems: "center" }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "0 2px", width: "100%" }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>细纲 ({beats.length})</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#64748b", cursor: "pointer" }}
                            onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={allSelected}
                                onChange={toggleSelectAll}
                                className="nodrag"
                                style={{ width: 12, height: 12, cursor: "pointer", accentColor: "#ef4444" }}
                                onClick={e => e.stopPropagation()}
                            />
                            全选
                        </label>
                        {selectedBeatIds.size > 0 && (
                            <button type="button"
                                onClick={e => { e.stopPropagation(); batchDeleteBeats(); }}
                                className="nodrag"
                                style={{ fontSize: 10, fontWeight: 600, color: "#ef4444", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
                            >批量删除 ({selectedBeatIds.size})</button>
                        )}
                    </div>
                    <div data-beat-grid style={{ display: "grid", gridTemplateColumns: "repeat(4, 200px)", gap: 6, padding: "0 2px" }}>
                        {beats.map((beat) => (
                            <BeatCard key={beat.id} beat={beat} onUpdate={updateBeat} onDelete={deleteBeat}
                                onPointerDown={handlePointerDown(beat.id)}
                                selected={selectedBeatIds.has(beat.id)}
                                onToggleSelect={() => toggleBeatSelect(beat.id)}
                                beatIdForDom={beat.id}
                            />
                        ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); addBeat(); }}
                            className="nodrag rounded-lg border border-dashed border-slate-300 bg-white/60 flex items-center justify-center hover:bg-slate-100 transition-colors shadow-sm"
                            style={{ width: 36, height: 28, cursor: "pointer", color: "#94a3b8" }}
                            title="添加细纲"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* 主卡片 */}
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

                {/* 居中箭头（在色条下方，卡片上方外部） */}
                <div style={{ display: "flex", justifyContent: "center", marginTop: -9, marginBottom: 0 }}>
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
                        className="nodrag hover:bg-slate-100 rounded-full transition-colors flex items-center justify-center"
                        style={{
                            background: "white",
                            border: `1.5px solid ${ST.border}`,
                            cursor: "pointer",
                            width: 22,
                            height: 22,
                            color: ST.label,
                            zIndex: 1,
                        }}
                        title={expanded ? "收起细纲" : "展开细纲"}
                    >
                        <ChevronUp className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                </div>

                {/* 头部：标题 + 标签 */}
                <div style={{ padding: "2px 12px 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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
                                <span style={{ color: "#475569", cursor: "pointer", flex: 1 }} onClick={e => { e.stopPropagation(); startEdit(f.key, (segment as any)[f.key] || ""); }}>
                                    {(segment as any)[f.key] || "—"}
                                </span>
                            )}
                        </div>
                    ))}

                    {/* 事件 */}
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
                            <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.5, marginTop: 2, cursor: "pointer" }} onClick={e => { e.stopPropagation(); startEdit("event", segment.event); }}>
                                {segment.event || "—"}
                            </div>
                        )}
                    </div>
                </div>

                {/* 连接点 */}
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
        </div>
    );
}

export default memo(PlotStoryNode);
