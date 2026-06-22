// app-store.ts — Zustand 组合入口（T10 re-export）
// 保持 import 路径不变：23+ 引用方 import { useAppStore } from "@/stores/app-store"
import { create } from "zustand";
import type { AppStore } from "./app-store/types";
import { createProjectSlice } from "./app-store/project-slice";
import { createChapterSlice } from "./app-store/chapter-slice";
import { createCharacterSlice } from "./app-store/character-slice";
import { createUiSlice } from "./app-store/ui-slice";
import { createWritingHistorySlice } from "./app-store/writing-history-slice";
import { createWritingStateSlice } from "./app-store/writing-state-slice";

export type { AppStore } from "./app-store/types";
export type { ProjectSlice } from "./app-store/project-slice";
export type { ChapterSlice } from "./app-store/chapter-slice";
export type { CharacterSlice } from "./app-store/character-slice";
export type { UiSlice } from "./app-store/ui-slice";
export type { WritingHistorySlice } from "./app-store/writing-history-slice";
export type { WritingStateSlice } from "./app-store/writing-state-slice";

export const useAppStore = create<AppStore>()((...a) => ({
  ...createProjectSlice(...a),
  ...createChapterSlice(...a),
  ...createCharacterSlice(...a),
  ...createUiSlice(...a),
  ...createWritingHistorySlice(...a),
  ...createWritingStateSlice(...a),
  // misc state kept inline (minimal)
  selectedEntity: null,
  setSelectedEntity: (selectedEntity) => a[0]({ selectedEntity }),
  memoryBump: 0, plotBump: 0, saveAllBump: 0,
  bumpMemory: () => a[0]((s: any) => ({ memoryBump: s.memoryBump + 1 })),
  bumpPlot: () => a[0]((s: any) => ({ plotBump: s.plotBump + 1 })),
  bumpSaveAll: () => a[0]((s: any) => ({ saveAllBump: s.saveAllBump + 1 })),
  setTriggerAutosave: (fn) => a[0]({ triggerAutosave: fn }),
}));
