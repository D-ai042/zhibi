import { memo, useCallback, useState, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Character } from "@/types";

export interface CharacterNodeData {
    character: Character;
    onUpdate: (c: Character) => void;
    onSelect: (c: Character) => void;
    onDelete: (id: string) => void;
}

function CharacterNode({ data, selected }: NodeProps<CharacterNodeData>) {
    const { character, onUpdate } = data;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(character.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setDraft(character.name); }, [character.name]);
    useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

    const commit = useCallback(() => {
        setEditing(false);
        const t = draft.trim();
        if (t && t !== character.name) onUpdate({ ...character, name: t });
        else setDraft(character.name);
    }, [draft, character, onUpdate]);

    const size = 72;
    const fontSize = Math.max(11, Math.min(14, 14 - (character.name.length - 2) * 1.5));
    const zoneBadge = character.zone === "locked" ? ({ label: "🔒", color: "#4b5563" }) : character.zone === "display" ? ({ label: "✦", color: "#6366f1" }) : null;

    return (
        <div
            className="flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer select-none"
            style={{
                width: size,
                height: size,
                minWidth: size,
                minHeight: size,
                background: "rgba(255,255,255,0.55)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: selected
                    ? "2px solid #f59e0b"
                    : "1px solid rgba(148,163,184,0.4)",
                boxShadow: selected
                    ? "0 0 0 4px rgba(245,158,11,0.2), 0 4px 16px rgba(0,0,0,0.06)"
                    : "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
            }}
            onClick={(e) => { }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                if (!character.is_locked) setEditing(true);
            }}
        >
            {zoneBadge && (
                <span style={{
                    position: "absolute", top: 5, left: "50%", transform: "translateX(-50%)",
                    background: zoneBadge.color, color: "#fff",
                    borderRadius: 999, fontSize: 8, fontWeight: 700,
                    padding: "0 4px", lineHeight: "14px", zIndex: 5,
                }}>{zoneBadge.label}</span>
            )}
            {editing ? (
                <input
                    ref={inputRef}
                    className="w-16 text-center text-sm font-semibold outline-none border-b border-amber-400 bg-transparent"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(character.name); setEditing(false); } }}
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize }}
                />
            ) : (
                <span
                    className="text-center font-semibold px-1 leading-tight"
                    style={{
                        fontSize,
                        color: character.is_locked ? "#94a3b8" : "#334155",
                    }}
                    title={character.is_locked ? "已锁定" : "双击修改名称"}
                >
                    {character.name}
                </span>
            )}

            <Handle type="source" position={Position.Top} id="top" style={{
                top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                width: 18, height: 18,
                background: "transparent", border: "none", borderRadius: "50%",
            }} />
            <Handle type="target" position={Position.Top} id="target" style={{
                top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                width: 18, height: 18,
                background: "transparent", border: "none", borderRadius: "50%",
            }} />
        </div>
    );
}

export default memo(CharacterNode);
