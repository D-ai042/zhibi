// usePendingCharacters.ts — pending 角色状态管理（T7：从 AiChatPanel.tsx 提取）
import { useState, useCallback } from "react";
import { loadJSON, saveJSON } from "@/lib/storage";
import { loadAllChapters, saveChapter, type Chapter } from "@/lib/chapter-store";
import type { ParsedCharacter, ParsedEdge } from "@/lib/character-parser";

export function usePendingCharacters(pid: string) {
    const [pendingChars, setPendingChars] = useState<ParsedCharacter[]>([]);
    const [pendingEdges, setPendingEdges] = useState<ParsedEdge[]>([]);
    const [pendingSnapshots, setPendingSnapshots] = useState<unknown[]>([]);

    const loadPendingChars = useCallback(() => {
        const stored = loadJSON(`ai-pending-chars-${pid}`, [] as ParsedCharacter[]);
        setPendingChars(stored);
    }, [pid]);

    const applyAll = useCallback(async () => {
        // 将 pending 角色写入项目数据
        const storeKey = `novel-workbench-mock`;
        const storeData = loadJSON(storeKey, {} as any);
        const chars = storeData.characters || [];
        for (const ch of pendingChars) {
            const existingIdx = chars.findIndex((c: any) => c.name === ch.name && c.project_id === pid);
            if (existingIdx >= 0) {
                chars[existingIdx] = { ...chars[existingIdx], ...ch };
            } else {
                chars.push({ id: crypto.randomUUID?.() || `char-${Date.now()}`, project_id: pid, ...ch });
            }
        }
        storeData.characters = chars;
        saveJSON(storeKey, storeData);
        setPendingChars([]);
        setPendingEdges([]);
        setPendingSnapshots([]);
    }, [pid, pendingChars, pendingEdges, pendingSnapshots]);

    const clearPending = useCallback(() => {
        setPendingChars([]);
        setPendingEdges([]);
        setPendingSnapshots([]);
    }, []);

    return {
        pendingChars, pendingEdges, pendingSnapshots,
        loadPendingChars, applyAll, clearPending,
        setPendingChars, setPendingEdges, setPendingSnapshots,
    };
}
