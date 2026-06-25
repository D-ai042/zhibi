// chapter-slice.ts — 写作台章节状态分片（T10）
import type { StateCreator } from "zustand";
import type { AppStore } from "./types";

export interface ChapterSlice {
  writingChapterId: string | null;
  writingDraft: string;
  ephemeralChapterContext: string;
  chapterSelectMode: boolean;
  selectedChapterIds: string[];
  autosaveStatus: string;
  pendingInsertContent: string;
  insertTextBump: number;
  setWritingChapterId: (id: string | null) => void;
  setWritingDraft: (t: string) => void;
  setEphemeralChapterContext: (t: string) => void;
  setChapterSelectMode: (v: boolean) => void;
  setSelectedChapterIds: (ids: string[]) => void;
  setAutosaveStatus: (s: string) => void;
  setPendingInsertContent: (t: string) => void;
}

export const createChapterSlice: StateCreator<AppStore, [], [], ChapterSlice> = (set) => ({
  writingChapterId: null,
  writingDraft: "",
  ephemeralChapterContext: "",
  chapterSelectMode: false,
  selectedChapterIds: [],
  autosaveStatus: "已就绪",
  pendingInsertContent: "",
  insertTextBump: 0,
  setWritingChapterId: (writingChapterId) => set({ writingChapterId }),
  setWritingDraft: (writingDraft) => set({ writingDraft }),
  setEphemeralChapterContext: (ephemeralChapterContext) => set({ ephemeralChapterContext }),
  setChapterSelectMode: (chapterSelectMode) => set({ chapterSelectMode }),
  setSelectedChapterIds: (selectedChapterIds) => set({ selectedChapterIds }),
  setAutosaveStatus: (autosaveStatus) => set({ autosaveStatus }),
  setPendingInsertContent: (text) => set((s) => ({ pendingInsertContent: text, insertTextBump: s.insertTextBump + 1 })),
});
