/**
 * app-store.ts — 全局状态管理器（T10 拆分后，仅作为组合入口 + re-export）
 *
 * 各领域切片:
 *   project-slice      项目管理
 *   chapter-slice      写作台章节状态
 *   character-slice    bump 通知 + 世界观编组
 *   ui-slice           UI 状态 + 自定义模块 + AI 导航
 *   writing-history-slice  撤销/重做（预留）
 *   writing-state-slice    聊天 + API 配置持久化
 */

import { create } from "zustand";
import type { AppStore } from "./app-store/types";
import { createProjectSlice } from "./app-store/project-slice";
import { createChapterSlice } from "./app-store/chapter-slice";
import { createCharacterSlice } from "./app-store/character-slice";
import { createUiSlice } from "./app-store/ui-slice";
import { createWritingHistorySlice } from "./app-store/writing-history-slice";
import { createWritingStateSlice } from "./app-store/writing-state-slice";

export const useAppStore = create<AppStore>()((...a) => ({
  ...createProjectSlice(...a),
  ...createChapterSlice(...a),
  ...createCharacterSlice(...a),
  ...createUiSlice(...a),
  ...createWritingHistorySlice(...a),
  ...createWritingStateSlice(...a),
  selectedEntity: null,
  setSelectedEntity: (selectedEntity) => a[0]({ selectedEntity }),
  memoryBump: 0,
  bumpMemory: () => a[0]((s) => ({ memoryBump: s.memoryBump + 1 })),
  plotBump: 0,
  bumpPlot: () => a[0]((s) => ({ plotBump: s.plotBump + 1 })),
  saveAllBump: 0,
  bumpSaveAll: () => a[0]((s) => ({ saveAllBump: s.saveAllBump + 1 })),
  setTriggerAutosave: (fn) => a[0]({ triggerAutosave: fn }),
}));

