// usePendingCharacters.ts — 待确认角色/关系/词条/剧情/章节状态管理（T7 拆分）
import { useEffect, useRef, useState, useCallback } from "react";
import { getJSONSync } from "@/lib/storage";
import type { WorldTerm } from "@/types";

export interface PendingState {
    pendingTerms: WorldTerm[];
    setPendingTerms: React.Dispatch<React.SetStateAction<WorldTerm[]>>;
    pendingEdges: { sourceTitle: string; targetTitle: string }[];
    setPendingEdges: React.Dispatch<React.SetStateAction<{ sourceTitle: string; targetTitle: string }[]>>;
    pendingChars: { name: string; faction: string; gender?: string; age?: string; race?: string; appearance?: string; personality?: string; background?: string; ability?: string; style?: string; interests?: string }[];
    setPendingChars: React.Dispatch<React.SetStateAction<{ name: string; faction: string; gender?: string; age?: string; race?: string; appearance?: string; personality?: string; background?: string; ability?: string; style?: string; interests?: string }[]>>;
    pendingCharEdges: { sourceName: string; targetName: string; relation_type: string; strength: number }[];
    setPendingCharEdges: React.Dispatch<React.SetStateAction<{ sourceName: string; targetName: string; relation_type: string; strength: number }[]>>;
    pendingRemoveEdges: { sourceName: string; targetName: string }[];
    setPendingRemoveEdges: React.Dispatch<React.SetStateAction<{ sourceName: string; targetName: string }[]>>;
    pendingSnapshots: { name: string; changes: Record<string, string> }[];
    setPendingSnapshots: React.Dispatch<React.SetStateAction<{ name: string; changes: Record<string, string> }[]>>;
    pendingPlotSegments: { type: "bright" | "dark"; title: string; characters: string; location: string; time: string; chapters: string; event: string }[];
    setPendingPlotSegments: React.Dispatch<React.SetStateAction<{ type: "bright" | "dark"; title: string; characters: string; location: string; time: string; chapters: string; event: string }[]>>;
    pendingPlotEdges: { sourceTitle: string; targetTitle: string }[];
    setPendingPlotEdges: React.Dispatch<React.SetStateAction<{ sourceTitle: string; targetTitle: string }[]>>;
    pendingPlotBeats: { segmentTitle: string; beat: { title: string; characters: string; location: string; time: string; event: string; chapters: string } }[];
    setPendingPlotBeats: React.Dispatch<React.SetStateAction<{ segmentTitle: string; beat: { title: string; characters: string; location: string; time: string; event: string; chapters: string } }[]>>;
    pendingChapters: { volumeTitle: string; number: number; title: string }[];
    setPendingChapters: React.Dispatch<React.SetStateAction<{ volumeTitle: string; number: number; title: string }[]>>;
    loadedRef: React.MutableRefObject<boolean>;
}

export function usePendingCharacters(currentProjectId: string | undefined, pendingAiCharsBump: number): PendingState {
    const [pendingTerms, setPendingTerms] = useState<WorldTerm[]>([]);
    const [pendingEdges, setPendingEdges] = useState<{ sourceTitle: string; targetTitle: string }[]>([]);
    const [pendingChars, setPendingChars] = useState<{ name: string; faction: string; gender?: string; age?: string; race?: string; appearance?: string; personality?: string; background?: string; ability?: string; style?: string; interests?: string }[]>([]);
    const [pendingCharEdges, setPendingCharEdges] = useState<{ sourceName: string; targetName: string; relation_type: string; strength: number }[]>([]);
    const [pendingRemoveEdges, setPendingRemoveEdges] = useState<{ sourceName: string; targetName: string }[]>([]);
    const [pendingSnapshots, setPendingSnapshots] = useState<{ name: string; changes: Record<string, string> }[]>([]);
    const [pendingPlotSegments, setPendingPlotSegments] = useState<{ type: "bright" | "dark"; title: string; characters: string; location: string; time: string; chapters: string; event: string }[]>([]);
    const [pendingPlotEdges, setPendingPlotEdges] = useState<{ sourceTitle: string; targetTitle: string }[]>([]);
    const [pendingPlotBeats, setPendingPlotBeats] = useState<{ segmentTitle: string; beat: { title: string; characters: string; location: string; time: string; event: string; chapters: string } }[]>([]);
    const [pendingChapters, setPendingChapters] = useState<{ volumeTitle: string; number: number; title: string }[]>([]);

    // loadedRef 保持 boolean 以兼容外部（handleCharacterInsert 设 false 表示强制下次重载）
    const loadedRef = useRef(false);
    // ★ 内部按项目跟踪：A 本加载过不代表 B 本也加载过（原 bug：loadedRef 是全局单例，
    //   A 本定稿后置 true，B 本 loadPending 直接 return，导致 B 本数据加载被拦截）
    const loadedProjRef = useRef<string | null>(null);
    // raw 字符串增量比对：bump 多次触发时避免重复 JSON.parse
    const lastRawRef = useRef<string>("");

    const loadPending = useCallback(() => {
        if (!currentProjectId) return;
        // 同项目已加载则跳过（loadedRef 由外部 bump 重置为 false 强制重载）
        if (loadedRef.current && loadedProjRef.current === currentProjectId) return;
        try {
            const raw = getJSONSync(`ai-pending-chars-${currentProjectId}`, null) as string | null;
            // 增量比对：raw 未变化则跳过
            if (raw === lastRawRef.current) {
                loadedProjRef.current = currentProjectId;
                loadedRef.current = true;
                return;
            }
            lastRawRef.current = raw || "";
            if (!raw) {
                loadedProjRef.current = currentProjectId;
                loadedRef.current = true;
                return;
            }
            const data = JSON.parse(raw);
            if (data.chars?.length > 0) {
                setPendingChars(prev => {
                    const existingNames = new Set(prev.map(c => c.name));
                    const newChars = (data.chars as any[]).filter((c: { name: string }) => !existingNames.has(c.name));
                    return [...prev, ...newChars];
                });
            }
            if (data.edges?.length > 0) {
                setPendingCharEdges(prev => {
                    const existingKeys = new Set(prev.map(e => `${e.sourceName}::${e.targetName}`));
                    const newEdges = (data.edges as any[]).filter((e: { sourceName: string; targetName: string }) => !existingKeys.has(`${e.sourceName}::${e.targetName}`));
                    return [...prev, ...newEdges];
                });
            }
            loadedProjRef.current = currentProjectId;
            loadedRef.current = true;
        } catch { /* ignore */ }
    }, [currentProjectId]);

    // ★ 项目切换时清空所有 pending 状态，避免跨项目数据污染（按钮失效根因）
    // AiChatPanel 常驻不卸载，React state 默认跨项目保留：B 本定稿 pending 后切到 A 本，
    // pendingChars 仍是 B 本数据，点击「应用到星图」会把 B 本角色插入 A 本 → 角色错位/按钮失效。
    useEffect(() => {
        setPendingTerms([]); setPendingEdges([]);
        setPendingChars([]); setPendingCharEdges([]); setPendingRemoveEdges([]); setPendingSnapshots([]);
        setPendingPlotSegments([]); setPendingPlotEdges([]); setPendingPlotBeats([]); setPendingChapters([]);
        loadedRef.current = false;
        loadedProjRef.current = null;
        lastRawRef.current = "";
    }, [currentProjectId]);

    // 挂载时检查
    useEffect(() => { loadPending(); }, [loadPending]);

    // bump 触发刷新（外部定稿后 bumpPendingAiChars）
    useEffect(() => {
        if (!currentProjectId || pendingAiCharsBump <= 0) return;
        loadedRef.current = false; // 强制重载
        loadPending();
    }, [pendingAiCharsBump, currentProjectId, loadPending]);

    return {
        pendingTerms, setPendingTerms,
        pendingEdges, setPendingEdges,
        pendingChars, setPendingChars,
        pendingCharEdges, setPendingCharEdges,
        pendingRemoveEdges, setPendingRemoveEdges,
        pendingSnapshots, setPendingSnapshots,
        pendingPlotSegments, setPendingPlotSegments,
        pendingPlotEdges, setPendingPlotEdges,
        pendingPlotBeats, setPendingPlotBeats,
        pendingChapters, setPendingChapters,
        loadedRef,
    };
}
