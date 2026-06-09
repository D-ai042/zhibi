import { create } from "zustand";
import type {
  ApiConfig,
  ChatMessage,
  CustomModule,
  FrameworkProgress,
  ManuscriptSection,
  ModuleId,
  NavItem,
  NavTarget,
  OutlineSection,
  OverviewSection,
  Project,
} from "@/types";
import { getJSONSync, setJSONSync } from "@/lib/storage";

interface AppState {
  projects: Project[];
  currentProject: Project | null;
  /** 当前导航到的模块 */
  activeModule: NavTarget;
  /** 如果 activeModule 需要额外 ID（custom/dynamic） */
  activeExtraId: string | null;
  /** 大纲当前分组 */
  outlineSection: OutlineSection;
  /** 总览当前分组 */
  overviewSection: OverviewSection;
  /** 灵感当前分组 */
  manuscriptSection: ManuscriptSection;
  drawerOpen: boolean;
  drawerWidth: number;
  navCollapsed: boolean;
  settingsOpen: boolean;
  apiConfig: ApiConfig | null;
  frameworkProgress: FrameworkProgress | null;
  autosaveStatus: string;
  deepseekStatus: "ok" | "offline" | "error" | "unknown";
  selectedEntity: { type: string; id: string; name: string } | null;
  chatMessages: ChatMessage[];
  /** AI 自定义模块 */
  customModules: CustomModule[];
  /** 动态导航项 — 控制整个左侧栏（含内置） */
  navItems: NavItem[];
  /** AI 创建的动态页面内容（id → markdown） */
  dynamicPages: Record<string, string>;
  // ===== Phase 2: 聊天持久化 =====
  /** 将当前聊天记录写入 localStorage */
  persistChat: () => void;
  /** 从 localStorage 加载指定项目的聊天记录 */
  loadChat: (projectId: string) => void;

  // ===== 写作台状态 =====
  /** 当前正在写作的章节 ID */
  writingChapterId: string | null;
  /** AI 生成的本章草稿 */
  writingDraft: string;
  setWritingChapterId: (id: string | null) => void;
  setWritingDraft: (text: string) => void;

  /** 临时章节上下文（选取模式读取的章节正文，发送给 AI 后清空，不记入记忆） */
  ephemeralChapterContext: string;
  setEphemeralChapterContext: (text: string) => void;
  /** 写作台章节选取模式（跨组件同步） */
  chapterSelectMode: boolean;
  setChapterSelectMode: (v: boolean) => void;
  selectedChapterIds: string[];
  setSelectedChapterIds: (ids: string[]) => void;

  /** 递增以通知 WorldviewPanel 重新加载词条 */
  worldTermBump: number;

  // ===== 基础 =====
  setProjects: (p: Project[]) => void;
  setCurrentProject: (p: Project | null) => void;
  /** 导航到指定项 */
  navigateTo: (target: NavTarget, extraId?: string) => void;
  setOutlineSection: (s: OutlineSection) => void;
  setOverviewSection: (s: OverviewSection) => void;
  setManuscriptSection: (s: ManuscriptSection) => void;
  setDrawerOpen: (v: boolean) => void;
  setDrawerWidth: (w: number) => void;
  setNavCollapsed: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setApiConfig: (c: ApiConfig) => void;
  setFrameworkProgress: (p: FrameworkProgress) => void;
  setAutosaveStatus: (s: string) => void;
  setDeepseekStatus: (s: AppState["deepseekStatus"]) => void;
  setSelectedEntity: (e: AppState["selectedEntity"]) => void;
  /** 通知 WorldviewPanel 有新的世界词条创建 */
  bumpWorldTerms: () => void;
  /** 通知 WorldviewPanel 编组信息变更（重命名/解散） */
  bumpGroups: () => void;
  groupBump: number;
  /** 通知 CharactersModule 有新的角色创建 */
  bumpCharacters: () => void;
  characterBump: number;
  /** 插入文本到写作台编辑器 */
  pendingInsertContent: string;
  insertTextBump: number;
  setPendingInsertContent: (text: string) => void;

  // ===== 聊天 =====
  addChatMessage: (m: ChatMessage) => void;
  appendChatMessages: (msgs: ChatMessage[]) => void;
  clearChat: () => void;

  // ===== 自定义模块 =====
  addCustomModule: (mod: CustomModule) => void;
  removeCustomModule: (id: string) => void;
  updateCustomModule: (id: string, updates: Partial<CustomModule>) => void;

  // ===== AI UI 操控（VS Code 风格） =====
  /** 替换整个导航列表（含内置） */
  setNavItems: (items: NavItem[]) => void;
  /** 添加一个导航项（AI 动态添加） */
  addNavItem: (item: NavItem) => void;
  /** 移除导航项 */
  removeNavItem: (id: string) => void;
  /** 更新导航项 */
  updateNavItem: (id: string, updates: Partial<NavItem>) => void;
  /** 写入/更新动态页面内容 */
  setDynamicPage: (pageId: string, content: string) => void;
  /** 删除动态页面 */
  removeDynamicPage: (pageId: string) => void;
  /** 世界观编组列表（名称 → 位置） */
  worldviewGroups: { id: string; name: string; x: number; y: number; locked: boolean }[];
  setWorldviewGroups: (g: AppState["worldviewGroups"] | ((prev: AppState["worldviewGroups"]) => AppState["worldviewGroups"])) => void;
  focusGroupBump: number;
  focusGroup: (id: string) => void;

  // ===== AI 识别新角色（跨组件通知） =====
  /** 递增以通知 AiChatPanel 有新的待确认角色 */
  pendingAiCharsBump: number;
  bumpPendingAiChars: () => void;

  // ===== 记忆系统 =====
  /** 递增以通知 UI 记忆更新 */
  memoryBump: number;
  bumpMemory: () => void;

  // ===== 剧情走向刷新 =====
  /** 递增以通知 PlotDirectionPanel 重新加载 */
  plotBump: number;
  bumpPlot: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  currentProject: null,
  activeModule: "overview",
  activeExtraId: null,
  outlineSection: "worldview",
  overviewSection: "stats",
  manuscriptSection: "inspirations" as ManuscriptSection,
  drawerOpen: true,
  drawerWidth: 420,
  navCollapsed: false,
  settingsOpen: false,
  apiConfig: null,
  frameworkProgress: null,
  autosaveStatus: "已就绪",
  deepseekStatus: "unknown",
  selectedEntity: null,
  chatMessages: [],
  // 写作台
  writingChapterId: null,
  writingDraft: "",
  ephemeralChapterContext: "",
  chapterSelectMode: false,
  selectedChapterIds: [],
  customModules: [],
  navItems: [],
  dynamicPages: {},
  worldTermBump: 0,
  pendingAiCharsBump: 0,
  memoryBump: 0,
  plotBump: 0,

  // ===== 基础 =====
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  navigateTo: (target, extraId) =>
    set({ activeModule: target, activeExtraId: extraId ?? null }),
  setOutlineSection: (outlineSection) => set({ outlineSection }),
  setOverviewSection: (overviewSection) => set({ overviewSection }),
  setManuscriptSection: (manuscriptSection) => set({ manuscriptSection }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setDrawerWidth: (drawerWidth) => set({ drawerWidth }),
  setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setApiConfig: (apiConfig) => set({ apiConfig }),
  setFrameworkProgress: (frameworkProgress) => set({ frameworkProgress }),
  setAutosaveStatus: (autosaveStatus) => set({ autosaveStatus }),
  setDeepseekStatus: (deepseekStatus) => set({ deepseekStatus }),
  setSelectedEntity: (selectedEntity) => set({ selectedEntity }),
  bumpWorldTerms: () => set((s) => ({ worldTermBump: s.worldTermBump + 1 })),
  bumpGroups: () => set((s) => ({ groupBump: s.groupBump + 1 })),
  groupBump: 0,
  bumpCharacters: () => set((s) => ({ characterBump: s.characterBump + 1 })),
  bumpPendingAiChars: () => set((s) => ({ pendingAiCharsBump: s.pendingAiCharsBump + 1 })),
  bumpMemory: () => set((s) => ({ memoryBump: s.memoryBump + 1 })),
  bumpPlot: () => set((s) => ({ plotBump: s.plotBump + 1 })),
  characterBump: 0,
  pendingInsertContent: "",
  insertTextBump: 0,
  setPendingInsertContent: (text) => set((s) => ({ pendingInsertContent: text, insertTextBump: s.insertTextBump + 1 })),

  // ===== 聊天持久化 =====
  persistChat: () => {
    const { currentProject, chatMessages } = get();
    if (!currentProject) return;
    try {
      const payload = {
        _projectId: currentProject.id,
        _projectName: currentProject.name,
        messages: chatMessages,
      };
      setJSONSync(`novel-workbench-chat-${currentProject.id}`, payload);
      // 同时按名称保存，防止项目 ID 变更后丢失
      setJSONSync(`novel-workbench-chat-name:${currentProject.name}`, payload);
    } catch { /* 存储满时静默失败 */ }
  },
  loadChat: (projectId: string) => {
    try {
      const projects = get().projects;
      const project = projects.find(p => p.id === projectId);
      let bestData: ChatMessage[] | null = null;

      // 辅助：从保存的 payload 提取消息（兼容新旧格式）
      const extract = (raw: string): ChatMessage[] | null => {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed as ChatMessage[];
          if (parsed.messages && Array.isArray(parsed.messages)) return parsed.messages as ChatMessage[];
          return null;
        } catch { return null; }
      };

      // 1) 按项目 ID 加载
      const idPayload = getJSONSync(`novel-workbench-chat-${projectId}`, null);
      if (idPayload) {
        const msgs = extract(JSON.stringify(idPayload));
        if (msgs && msgs.length > 0) bestData = msgs;
      }

      // 2) 按项目名称加载（可能更完整）
      if (project) {
        const namePayload = getJSONSync(`novel-workbench-chat-name:${project.name}`, null);
        if (namePayload) {
          const msgs = extract(JSON.stringify(namePayload));
          // 只有存储的项目 ID 与当前 ID 一致才加载（避免删除后新建同名项目加载旧聊天）
          let projectIdMatches = false;
          try {
            projectIdMatches = (namePayload as any)._projectId === projectId;
          } catch { /* 旧格式无 _projectId，忽略 */ }
          if (msgs && projectIdMatches && (!bestData || msgs.length > bestData.length)) {
            bestData = msgs;
          }
        }

        // 3) 扫描孤立键（ID 不属于任何已知项目的旧数据）
        const knownIds = new Set(projects.map(p => p.id));
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith('novel-workbench-chat-') || key.startsWith('novel-workbench-chat-name:')) continue;
          const orphanId = key.replace('novel-workbench-chat-', '');
          if (knownIds.has(orphanId)) continue; // 不是孤立数据

          try {
            const orphanPayload = getJSONSync(key, null);
            if (!orphanPayload) continue;

            let orphanMsgs: ChatMessage[] | null = null;
            const raw = JSON.stringify(orphanPayload);
            const parsed = JSON.parse(raw);

            if (Array.isArray(parsed)) {
              orphanMsgs = parsed as ChatMessage[];
            } else if (parsed.messages && Array.isArray(parsed.messages)) {
              orphanMsgs = parsed.messages as ChatMessage[];
            }

            // 孤立数据的项目 ID 必须与当前项目 ID 一致才加载
            const orphanProjectId = (orphanPayload as any)._projectId;
            const orphanProjectName = (orphanPayload as any)._projectName;
            if (orphanMsgs && orphanMsgs.length > 0) {
              if (orphanProjectId === projectId) {
                if (!bestData || orphanMsgs.length > bestData.length) {
                  bestData = orphanMsgs;
                }
              } else if (!orphanProjectId && !orphanProjectName && (!bestData || orphanMsgs.length > bestData.length)) {
                bestData = orphanMsgs;
              }
            }
          } catch { /* 跳过格式错误的数据 */ }
        }
      }

      if (bestData) {
        set({ chatMessages: bestData });
        // 保存到当前 ID 键以便下次快速加载
        setJSONSync(`novel-workbench-chat-${projectId}`, {
          _projectId: projectId, _projectName: project?.name ?? '', messages: bestData
        });
        return;
      }

      set({ chatMessages: [] });
    } catch {
      set({ chatMessages: [] });
    }
  },

  // ===== 聊天（自动持久化） =====
  addChatMessage: (m) => {
    set((s) => ({ chatMessages: [...s.chatMessages, m] }));
    // 异步持久化
    setTimeout(() => get().persistChat(), 0);
  },
  appendChatMessages: (msgs) => {
    set((s) => ({ chatMessages: [...s.chatMessages, ...msgs] }));
    setTimeout(() => get().persistChat(), 0);
  },
  clearChat: () => {
    set({ chatMessages: [] });
    setTimeout(() => get().persistChat(), 0);
  },

  // ===== 写作台 =====
  setWritingChapterId: (writingChapterId) => set({ writingChapterId }),
  setWritingDraft: (writingDraft) => set({ writingDraft }),
  setEphemeralChapterContext: (ephemeralChapterContext) => set({ ephemeralChapterContext }),
  setChapterSelectMode: (chapterSelectMode) => set({ chapterSelectMode }),
  setSelectedChapterIds: (selectedChapterIds) => set({ selectedChapterIds }),

  // ===== 上下文缓存 =====


  // ===== 自定义模块 =====
  addCustomModule: (mod) =>
    set((s) => ({ customModules: [...s.customModules, mod] })),
  removeCustomModule: (id) =>
    set((s) => {
      const filtered = s.customModules.filter((m) => m.id !== id);
      const redirect =
        s.activeModule === "custom" && s.activeExtraId === id
          ? { activeModule: "overview" as NavTarget, activeExtraId: null }
          : {};
      return { customModules: filtered, ...redirect };
    }),
  updateCustomModule: (id, updates) =>
    set((s) => ({
      customModules: s.customModules.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    })),

  // ===== AI UI 操控 =====
  setNavItems: (navItems) => set({ navItems }),
  addNavItem: (item) =>
    set((s) => ({ navItems: [...s.navItems, item] })),
  removeNavItem: (id) =>
    set((s) => {
      const filtered = s.navItems.filter((n) => n.id !== id);
      const activeIsRemoved =
        !(s.activeModule === "dynamic" && s.activeExtraId === id);
      return {
        navItems: filtered,
        ...(activeIsRemoved
          ? {}
          : { activeModule: "overview" as NavTarget, activeExtraId: null }),
      };
    }),
  updateNavItem: (id, updates) =>
    set((s) => ({
      navItems: s.navItems.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),
  setDynamicPage: (pageId, content) =>
    set((s) => ({ dynamicPages: { ...s.dynamicPages, [pageId]: content } })),
  removeDynamicPage: (pageId) =>
    set((s) => {
      const { [pageId]: _, ...rest } = s.dynamicPages;
      return { dynamicPages: rest };
    }),
  worldviewGroups: [],
  setWorldviewGroups: (g) => set((s) => ({ worldviewGroups: typeof g === "function" ? (g as (prev: AppState["worldviewGroups"]) => AppState["worldviewGroups"])(s.worldviewGroups) : g })),
  focusGroupBump: 0,
  focusGroup: (id) => set((s) => ({ focusGroupBump: s.focusGroupBump + 1, activeExtraId: id })),
}));
