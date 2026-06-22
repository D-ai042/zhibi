// app-store/types.ts — 组合 store 类型（供各 slice 的 StateCreator 引用）
import type {
    ApiConfig, ChatMessage, CustomModule, FrameworkProgress,
    ManuscriptSection, NavItem, NavTarget, OutlineSection, OverviewSection, Project,
} from "@/types";

export type WorldviewGroup = { id: string; name: string; x: number; y: number; locked: boolean };
export type SelectedEntity = { type: string; id: string; name: string } | null;

export interface AppStore {
    // ---- project slice ----
    projects: Project[];
    currentProject: Project | null;
    frameworkProgress: FrameworkProgress | null;
    setProjects: (p: Project[]) => void;
    setCurrentProject: (p: Project | null) => void;
    setFrameworkProgress: (p: FrameworkProgress) => void;
    // ---- chapter/writing slice ----
    writingChapterId: string | null; writingDraft: string;
    ephemeralChapterContext: string; chapterSelectMode: boolean;
    selectedChapterIds: string[]; autosaveStatus: string;
    pendingInsertContent: string; insertTextBump: number;
    setWritingChapterId: (id: string | null) => void;
    setWritingDraft: (t: string) => void;
    setEphemeralChapterContext: (t: string) => void;
    setChapterSelectMode: (v: boolean) => void;
    setSelectedChapterIds: (ids: string[]) => void;
    setAutosaveStatus: (s: string) => void;
    setPendingInsertContent: (t: string) => void;
    // ---- character bumps slice ----
    worldTermBump: number; groupBump: number; characterBump: number;
    pendingAiCharsBump: number; focusGroupBump: number;
    worldviewGroups: WorldviewGroup[];
    bumpWorldTerms: () => void; bumpGroups: () => void;
    bumpCharacters: () => void; bumpPendingAiChars: () => void;
    setWorldviewGroups: (g: WorldviewGroup[] | ((prev: WorldviewGroup[]) => WorldviewGroup[])) => void;
    focusGroup: (id: string) => void;
    // ---- ui slice ----
    activeModule: NavTarget; activeExtraId: string | null;
    outlineSection: OutlineSection; overviewSection: OverviewSection;
    manuscriptSection: ManuscriptSection;
    drawerOpen: boolean; drawerWidth: number; navCollapsed: boolean; settingsOpen: boolean;
    navigateTo: (t: NavTarget, extraId?: string) => void;
    setOutlineSection: (s: OutlineSection) => void; setOverviewSection: (s: OverviewSection) => void;
    setManuscriptSection: (s: ManuscriptSection) => void;
    setDrawerOpen: (v: boolean) => void; setDrawerWidth: (w: number) => void;
    setNavCollapsed: (v: boolean) => void; setSettingsOpen: (v: boolean) => void;
    customModules: CustomModule[]; navItems: NavItem[]; dynamicPages: Record<string, string>;
    addCustomModule: (mod: CustomModule) => void; removeCustomModule: (id: string) => void;
    updateCustomModule: (id: string, u: Partial<CustomModule>) => void;
    setNavItems: (items: NavItem[]) => void; addNavItem: (item: NavItem) => void;
    removeNavItem: (id: string) => void; updateNavItem: (id: string, u: Partial<NavItem>) => void;
    setDynamicPage: (pageId: string, content: string) => void;
    removeDynamicPage: (pageId: string) => void;
    // ---- writing-history slice (stub) ----
    // ---- writing-state (chat) slice ----
    chatMessages: ChatMessage[]; deepseekStatus: "ok" | "offline" | "error" | "unknown";
    apiConfig: ApiConfig | null;
    persistChat: () => void; loadChat: (projectId: string) => void;
    addChatMessage: (m: ChatMessage) => void; appendChatMessages: (msgs: ChatMessage[]) => void;
    clearChat: () => void;
    setDeepseekStatus: (s: "ok" | "offline" | "error" | "unknown") => void;
    setApiConfig: (c: ApiConfig) => void;
    // ---- misc (kept in app-store.ts) ----
    selectedEntity: SelectedEntity; setSelectedEntity: (e: SelectedEntity) => void;
    memoryBump: number; plotBump: number; saveAllBump: number;
    bumpMemory: () => void; bumpPlot: () => void; bumpSaveAll: () => void;
    triggerAutosave?: () => void; setTriggerAutosave: (fn: () => void) => void;
}
