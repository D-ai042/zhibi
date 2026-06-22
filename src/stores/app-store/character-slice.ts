// character-slice.ts — bump 通知分片（T10）
import type { StateCreator } from "zustand";
import type { AppStore, WorldviewGroup } from "./types";

export interface CharacterSlice {
  worldTermBump: number; groupBump: number; characterBump: number;
  pendingAiCharsBump: number; focusGroupBump: number;
  worldviewGroups: WorldviewGroup[];
  bumpWorldTerms: () => void; bumpGroups: () => void;
  bumpCharacters: () => void; bumpPendingAiChars: () => void;
  setWorldviewGroups: (g: WorldviewGroup[] | ((prev: WorldviewGroup[]) => WorldviewGroup[])) => void;
  focusGroup: (id: string) => void;
}

export const createCharacterSlice: StateCreator<AppStore, [], [], CharacterSlice> = (set) => ({
  worldTermBump: 0, groupBump: 0, characterBump: 0,
  pendingAiCharsBump: 0, focusGroupBump: 0,
  worldviewGroups: [],
  bumpWorldTerms: () => set((s) => ({ worldTermBump: s.worldTermBump + 1 })),
  bumpGroups: () => set((s) => ({ groupBump: s.groupBump + 1 })),
  bumpCharacters: () => set((s) => ({ characterBump: s.characterBump + 1 })),
  bumpPendingAiChars: () => set((s) => ({ pendingAiCharsBump: s.pendingAiCharsBump + 1 })),
  setWorldviewGroups: (g) => set((s) => ({
    worldviewGroups: typeof g === "function" ? (g as (prev: WorldviewGroup[]) => WorldviewGroup[])(s.worldviewGroups) : g,
  })),
  focusGroup: (id) => set((s) => ({ focusGroupBump: s.focusGroupBump + 1, activeExtraId: id })),
});
