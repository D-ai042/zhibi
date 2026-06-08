import { useCallback, useEffect, useRef, useState } from "react";

export function useUndoRedo(
    projectId: string | undefined,
    onRestore: (snapshot: { chars: any[]; rawEdges: any[]; groups: any[] }) => void
) {
    const undoStackRef = useRef<string[]>([]);
    const redoStackRef = useRef<string[]>([]);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // 重置
    useEffect(() => {
        undoStackRef.current = [];
        redoStackRef.current = [];
        setCanUndo(false);
        setCanRedo(false);
    }, [projectId]);

    const readCurrentState = useCallback(() => {
        let chars: any[] = [], rawEdges: any[] = [], groups: any[] = [];
        try {
            const raw = localStorage.getItem("novel-workbench-mock");
            if (raw) { const d = JSON.parse(raw); chars = d.characters || []; rawEdges = d.edges || []; }
        } catch { }
        try {
            if (projectId) { const g = localStorage.getItem("char-groups-" + projectId); if (g) groups = JSON.parse(g); }
        } catch { }
        return JSON.stringify({ chars, rawEdges, groups });
    }, [projectId]);

    const pushSnapshot = useCallback(() => {
        const current = readCurrentState();
        undoStackRef.current.push(current);
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
    }, [readCurrentState]);

    const undo = useCallback(() => {
        const stack = undoStackRef.current;
        if (stack.length === 0 || !projectId) return;
        // 把当前状态推到重做栈
        redoStackRef.current.push(readCurrentState());
        // 恢复快照
        const snapshot = JSON.parse(stack.pop()!);
        onRestore(snapshot);
        setCanUndo(stack.length > 0);
        setCanRedo(true);
    }, [projectId, readCurrentState, onRestore]);

    const redo = useCallback(() => {
        const stack = redoStackRef.current;
        if (stack.length === 0 || !projectId) return;
        // 把当前状态推到撤回栈
        undoStackRef.current.push(readCurrentState());
        // 恢复快照
        const snapshot = JSON.parse(stack.pop()!);
        onRestore(snapshot);
        setCanUndo(true);
        setCanRedo(stack.length > 0);
    }, [projectId, readCurrentState, onRestore]);

    // 键盘快捷键
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                undo();
            }
            if (
                (e.ctrlKey || e.metaKey) &&
                (e.key === "y" || (e.key === "z" && e.shiftKey))
            ) {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [undo, redo]);

    return { pushSnapshot, canUndo, canRedo, undo, redo };
}
