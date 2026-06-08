import { memo } from "react";

export interface CharGroupData {
    label: string;
}

/** 人物关系星图编组标题标签 - 仅浮动的名称标签 */
function CharGroupNode({ data }: { data: CharGroupData }) {
    const color = "#8b5cf6";
    return (
        <div style={{ position: "relative", width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
            <div style={{
                position: "absolute", top: -8, left: "50%", transform: "translateX(-50%) translateY(-100%)",
                background: "white", border: "1px dashed " + color, borderRadius: 8,
                padding: "1px 8px", fontSize: 12, fontWeight: 600, color, whiteSpace: "nowrap",
                zIndex: 10, pointerEvents: "none",
            }}>
                {data.label || ""}
            </div>
        </div>
    );
}

export default memo(CharGroupNode);
