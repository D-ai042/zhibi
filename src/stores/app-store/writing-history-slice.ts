// writing-history-slice.ts — 预留 stub（T10）
import type { StateCreator } from "zustand";
import type { AppStore } from "./types";

export interface WritingHistorySlice { /* reserved for future undo/redo migration */ }

export const createWritingHistorySlice: StateCreator<AppStore, [], [], WritingHistorySlice> = () => ({});
