// WritingContext.tsx — 写作模块共享 Context（T6：解决 useAiWriting 参数爆炸）
import { createContext, useContext } from "react";
import type { Chapter } from "@/lib/chapter-store";

export interface WritingContextValue {
    chapters: Chapter[];
    currentChapter: Chapter | null;
    editingContent: string;
    isDirty: boolean;
    autosaveStatus: string;
    pid: string;
    saveChapters: (chs: Chapter[]) => void;
    setEditingContent: (v: string) => void;
    setIsDirty: (v: boolean) => void;
    pushUndo: () => void;
}

export const WritingContext = createContext<WritingContextValue>(null!);
export const useWriting = () => useContext(WritingContext);
