import { memo, useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog } from "@/lib/confirm";
import {
    BaseEdge,
    EdgeLabelRenderer,
    getStraightPath,
    type EdgeProps,
} from "@xyflow/react";

export type CustomEdgeData = {
    label?: string;
    color?: string;
    rels?: { id: string }[];
    onDelete?: (rels: { id: string }[]) => void;
    onUpdate?: (rels: { id: string }[], newType: string) => void;
};

function CustomEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
    style,
    markerEnd,
}: EdgeProps) {
    const d = data as unknown as CustomEdgeData;
    const [edgePath, labelX, labelY] = getStraightPath({
        sourceX,
        // 角色圆形节点 72x72，Handle 在 Position.Top → 偏移 +36 到达节点中心
        sourceY: sourceY + 9,
        targetX,
        targetY: targetY + 9,
    });

    const color = d?.color || (style?.stroke as string) || "#94a3b8";

    // 计算线段方向
    const rawAngle = Math.atan2(targetY - sourceY, targetX - sourceX) * (180 / Math.PI);

    // 标签旋转角度：保证文字从左往右
    let displayAngle = rawAngle;
    if (displayAngle > 90 || displayAngle < -90) displayAngle += 180;

    const offset = 14;

    // 按"从左到右"的视觉方向决定标签偏移
    const isSourceLeft = sourceX < targetX;
    const ltrDx = isSourceLeft ? targetX - sourceX : sourceX - targetX;
    const ltrDy = isSourceLeft ? targetY - sourceY : sourceY - targetY;

    // 垂直方向 (ltrDy, -ltrDx)
    const len = Math.sqrt(ltrDx * ltrDx + ltrDy * ltrDy) || 1;
    let perpX: number, perpY: number;
    if (ltrDx === 0) {
        // 垂直线 → 固定右侧
        perpX = labelX + offset;
        perpY = labelY;
    } else {
        perpX = labelX + (ltrDy / len) * offset;
        perpY = labelY - (ltrDx / len) * offset;
    }

    // 编辑状态
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(d?.label || "");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraft(d?.label || "");
    }, [d?.label]);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    // 双击线段 → 删除
    const handlePathDblClick = useCallback(
        async (e: React.MouseEvent) => {
            e.stopPropagation();
            if (d?.onDelete && d?.rels && d.rels.length > 0) {
                if (await confirmDialog(`确定删除关系「${d.label}」？`)) {
                    d.onDelete(d.rels);
                }
            }
        },
        [d]
    );

    // 双击标签 → 编辑
    const handleLabelDblClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (d?.rels && d.rels.length > 0) {
                setEditing(true);
            }
        },
        [d]
    );

    const commitEdit = useCallback(() => {
        setEditing(false);
        const t = draft.trim();
        if (t && t !== d?.label && d?.onUpdate && d?.rels) {
            d.onUpdate(d.rels, t);
        } else {
            setDraft(d?.label || "");
        }
    }, [draft, d]);

    return (
        <>
            {/* 大点击区域，方便双击线段删除 */}
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                onDoubleClick={handlePathDblClick}
                style={{ cursor: "pointer" }}
            />
            <BaseEdge id={id} path={edgePath} style={style as React.CSSProperties} markerEnd={markerEnd} />
            {d?.label && !editing && (
                <EdgeLabelRenderer>
                    <div
                        className="nodrag nopan"
                        style={{
                            position: "absolute",
                            transform: `translate(-50%,-50%) translate(${perpX}px,${perpY}px) rotate(${displayAngle}deg)`,
                            fontSize: 11,
                            fontWeight: 600,
                            color,
                            background: "transparent",
                            padding: "1px 6px",
                            borderRadius: 4,
                            whiteSpace: "nowrap",
                            pointerEvents: "all",
                            lineHeight: 1.4,
                            letterSpacing: 0.5,
                            cursor: "pointer",
                        }}
                        onDoubleClick={handleLabelDblClick}
                        title="双击修改关系名"
                    >
                        {d.label}
                    </div>
                </EdgeLabelRenderer>
            )}
            {/* 编辑模式：输入框 */}
            {d?.label && editing && (
                <EdgeLabelRenderer>
                    <div
                        className="nodrag nopan"
                        style={{
                            position: "absolute",
                            transform: `translate(-50%,-50%) translate(${perpX}px,${perpY}px)`,
                        }}
                    >
                        <input
                            ref={inputRef}
                            className="rounded border border-amber-400 bg-white px-2 py-1 text-center text-xs font-semibold outline-none shadow-md"
                            style={{ color, minWidth: 60 }}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && draft.trim()) commitEdit();
                                if (e.key === "Escape") {
                                    setDraft(d?.label || "");
                                    setEditing(false);
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}

export default memo(CustomEdge);
