// character-slice.ts — bump 通知分片（T10）
import type { StateCreator } from "zustand";
import type { AppStore, WorldviewGroup } from "./types";
import { getJSONSync, setJSONSync } from "@/lib/storage";

const CHARACTER_ZONE_KEY = "ui-character-zone-enabled";
const DEFAULT_CHARACTER_ZONE_ENABLED = { locked: false, display: true };

export type CharGroup = { id: string; name: string; locked: boolean };

export interface CharacterSlice {
  worldTermBump: number; groupBump: number; characterBump: number;
  pendingAiCharsBump: number; focusGroupBump: number;
  worldviewGroups: WorldviewGroup[];
  /** 人物关系编组列表（同步到左侧大纲栏） */
  characterGroups: CharGroup[];
  /** 人物关系二分区域勾选状态 */
  characterZoneEnabled: Record<string, boolean>;
  bumpWorldTerms: () => void; bumpGroups: () => void;
  bumpCharacters: () => void; bumpPendingAiChars: () => void;
  setWorldviewGroups: (g: WorldviewGroup[] | ((prev: WorldviewGroup[]) => WorldviewGroup[])) => void;
  setCharacterGroups: (g: CharGroup[]) => void;
  setCharacterZoneEnabled: (z: Record<string, boolean>) => void;
  focusGroup: (id: string) => void;
}

export const createCharacterSlice: StateCreator<AppStore, [], [], CharacterSlice> = (set) => ({
  worldTermBump: 0, groupBump: 0, characterBump: 0,
  pendingAiCharsBump: 0, focusGroupBump: 0,
  worldviewGroups: [],
  characterGroups: [],
  characterZoneEnabled: { ...DEFAULT_CHARACTER_ZONE_ENABLED, ...getJSONSync(CHARACTER_ZONE_KEY, {}) },
  bumpWorldTerms: () => set((s) => ({ worldTermBump: s.worldTermBump + 1 })),
  bumpGroups: () => set((s) => ({ groupBump: s.groupBump + 1 })),
  bumpCharacters: () => set((s) => ({ characterBump: s.characterBump + 1 })),
  bumpPendingAiChars: () => set((s) => ({ pendingAiCharsBump: s.pendingAiCharsBump + 1 })),
  setWorldviewGroups: (g) => set((s) => ({
    worldviewGroups: typeof g === "function" ? (g as (prev: WorldviewGroup[]) => WorldviewGroup[])(s.worldviewGroups) : g,
  })),
  setCharacterGroups: (characterGroups) => set({ characterGroups }),
  setCharacterZoneEnabled: (characterZoneEnabled) => {
    setJSONSync(CHARACTER_ZONE_KEY, characterZoneEnabled);
    set({ characterZoneEnabled });
  },
  focusGroup: (id) => set((s) => ({ focusGroupBump: s.focusGroupBump + 1, activeExtraId: id })),
});
