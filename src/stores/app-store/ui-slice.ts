// ui-slice.ts — UI 状态 + 自定义模块 + AI 导航分片（T10）
import type { StateCreator } from "zustand";
import type { NavTarget, OutlineSection, OverviewSection, ManuscriptSection, CustomModule, NavItem } from "@/types";
import type { AppStore } from "./types";

export interface UiSlice {
  activeModule: NavTarget; activeExtraId: string | null;
  outlineSection: OutlineSection; overviewSection: OverviewSection;
  manuscriptSection: ManuscriptSection;
  drawerOpen: boolean; drawerWidth: number; navCollapsed: boolean; settingsOpen: boolean;
  navigateTo: (t: NavTarget, extraId?: string) => void;
  setOutlineSection: (s: OutlineSection) => void;
  setOverviewSection: (s: OverviewSection) => void;
  setManuscriptSection: (s: ManuscriptSection) => void;
  setDrawerOpen: (v: boolean) => void; setDrawerWidth: (w: number) => void;
  setNavCollapsed: (v: boolean) => void; setSettingsOpen: (v: boolean) => void;
  customModules: CustomModule[]; navItems: NavItem[]; dynamicPages: Record<string, string>;
  addCustomModule: (mod: CustomModule) => void;
  removeCustomModule: (id: string) => void;
  updateCustomModule: (id: string, u: Partial<CustomModule>) => void;
  setNavItems: (items: NavItem[]) => void; addNavItem: (item: NavItem) => void;
  removeNavItem: (id: string) => void; updateNavItem: (id: string, u: Partial<NavItem>) => void;
  setDynamicPage: (pageId: string, content: string) => void;
  removeDynamicPage: (pageId: string) => void;
}

export const createUiSlice: StateCreator<AppStore, [], [], UiSlice> = (set, get) => ({
  activeModule: "overview", activeExtraId: null,
  outlineSection: "worldview",
  overviewSection: "stats",
  manuscriptSection: "inspirations",
  drawerOpen: true, drawerWidth: 420, navCollapsed: false, settingsOpen: false,
  navigateTo: (target, extraId) => set({ activeModule: target, activeExtraId: extraId ?? null }),
  setOutlineSection: (outlineSection) => set({ outlineSection }),
  setOverviewSection: (overviewSection) => set({ overviewSection }),
  setManuscriptSection: (manuscriptSection) => set({ manuscriptSection }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setDrawerWidth: (drawerWidth) => set({ drawerWidth }),
  setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  customModules: [], navItems: [], dynamicPages: {},
  addCustomModule: (mod) => set((s) => ({ customModules: [...s.customModules, mod] })),
  removeCustomModule: (id) => set((s) => {
    const filtered = s.customModules.filter((m) => m.id !== id);
    const redirect = s.activeModule === "custom" && s.activeExtraId === id
      ? { activeModule: "overview" as NavTarget, activeExtraId: null } : {};
    return { customModules: filtered, ...redirect };
  }),
  updateCustomModule: (id, updates) => set((s) => ({
    customModules: s.customModules.map((m) => m.id === id ? { ...m, ...updates } : m),
  })),
  setNavItems: (navItems) => set({ navItems }),
  addNavItem: (item) => set((s) => ({ navItems: [...s.navItems, item] })),
  removeNavItem: (id) => set((s) => {
    const filtered = s.navItems.filter((n) => n.id !== id);
    const activeIsRemoved = !(s.activeModule === "dynamic" && s.activeExtraId === id);
    return { navItems: filtered, ...(activeIsRemoved ? {} : { activeModule: "overview" as NavTarget, activeExtraId: null }) };
  }),
  updateNavItem: (id, updates) => set((s) => ({
    navItems: s.navItems.map((n) => (n.id === id ? { ...n, ...updates } : n)),
  })),
  setDynamicPage: (pageId, content) => set((s) => ({ dynamicPages: { ...s.dynamicPages, [pageId]: content } })),
  removeDynamicPage: (pageId) => set((s) => {
    const { [pageId]: _, ...rest } = s.dynamicPages;
    return { dynamicPages: rest };
  }),
});
