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

    const loadedRef = useRef(false);

    const loadPending = useCallback(() => {
        if (!currentProjectId || loadedRef.current) return;
        try {
            const raw = getJSONSync(`ai-pending-chars-${currentProjectId}`, null) as string | null;
            if (!raw) return;
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
            loadedRef.current = true;
        } catch { /* ignore */ }
    }, [currentProjectId]);

    // 挂载时检查
    useEffect(() => { loadPending(); }, [loadPending]);

    // bump 触发刷新
    useEffect(() => {
        if (!currentProjectId || pendingAiCharsBump <= 0) return;
        loadedRef.current = false;
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
