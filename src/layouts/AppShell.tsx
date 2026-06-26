import { ReactNode, useMemo, useState, useRef, useCallback, useEffect } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Menu,
  Settings,
  Puzzle,
  LogOut,
  Download,
  LayoutDashboard,
  ListTree,
  Layers,
  BookMarked,
  Lightbulb,
  Archive,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { getJSONSync } from "@/lib/storage";
import { alertDialog } from "@/lib/confirm";
import type { NavItem, NavTarget, ProjectStage } from "@/types";
import { MODULE_LABEL } from "@/types";

import { RightDrawer } from "./RightDrawer";
import { getCurrentVersion, checkForUpdate, type VersionInfo } from "@/lib/version-check";

const STAGE_LABEL: Record<ProjectStage, string> = {
  ideation: "构思中",
  framework_review: "框架评审中",
  framework_locked: "写作中",
  writing: "血肉写作中",
  completed: "全书完稿",
};

/** 可选的 AI 模型列表 */
interface ModelOption {
  value: string;
  label: string;
  provider: string;
  base: string;
}

const AI_MODELS: ModelOption[] = [
  // DeepSeek（最新 V4 系列，2026/07/24 旧名停用）
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "DeepSeek", base: "https://api.deepseek.com" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "DeepSeek", base: "https://api.deepseek.com" },
  // OpenAI（最新 GPT-5 系列）
  { value: "gpt-5.5", label: "GPT-5.5", provider: "OpenAI", base: "https://api.openai.com" },
  { value: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", base: "https://api.openai.com" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "OpenAI", base: "https://api.openai.com" },
  // Anthropic（最新 Claude 4 系列）
  { value: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "Anthropic", base: "https://api.anthropic.com" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "Anthropic", base: "https://api.anthropic.com" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic", base: "https://api.anthropic.com" },
  // 阿里云
  { value: "qwen-plus", label: "通义千问 Plus", provider: "阿里云", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { value: "qwen-max", label: "通义千问 Max", provider: "阿里云", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  // 智谱
  { value: "glm-4-plus", label: "GLM-4-Plus", provider: "智谱", base: "https://open.bigmodel.cn/api/paas/v4" },
  { value: "glm-4-flash", label: "GLM-4-Flash", provider: "智谱", base: "https://open.bigmodel.cn/api/paas/v4" },
  // 月之暗面
  { value: "moonshot-v1-8k", label: "Moonshot v1 (8k)", provider: "月之暗面", base: "https://api.moonshot.cn/v1" },
  { value: "moonshot-v1-32k", label: "Moonshot v1 (32k)", provider: "月之暗面", base: "https://api.moonshot.cn/v1" },
  // 百川
  { value: "baichuan2-53b", label: "Baichuan2", provider: "百川智能", base: "https://api.baichuan-ai.com/v1" },
  // 零一万物
  { value: "yi-34b-chat", label: "Yi", provider: "零一万物", base: "https://api.lingyiwanwu.com/v1" },
  // 硅基流动
  { value: "Pro/Qwen2.5-7B-Instruct", label: "Qwen2.5", provider: "硅基流动", base: "https://api.siliconflow.cn/v1" },
  { value: "Pro/deepseek-ai/DeepSeek-V3", label: "DeepSeek V3", provider: "硅基流动", base: "https://api.siliconflow.cn/v1" },
  // 小米
  { value: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", provider: "小米", base: "https://api.xiaomimimo.com" },
  { value: "mimo-v2.5", label: "MiMo V2.5", provider: "小米", base: "https://api.xiaomimimo.com" },
  { value: "mimo-v2-flash", label: "MiMo V2 Flash", provider: "小米", base: "https://api.xiaomimimo.com" },
];

/** 按 provider 分组 + 合并自定义厂商模型 + 读取用户配置覆盖内置模型 */
function groupModels(
  providerModels?: Record<string, string[]>,
  providerBaseUrls?: Record<string, string>
): [string, ModelOption[]][] {
  const map = new Map<string, ModelOption[]>();

  // 1. 内置厂商：如果用户配了 provider_models 就用用户的，否则用硬编码默认
  if (providerModels) {
    // 有 provider_models 定义的内置厂商 → 用用户配置的模型列表
    for (const [provider, models] of Object.entries(providerModels)) {
      const builtin = AI_MODELS.filter(m => m.provider === provider);
      if (builtin.length === 0) continue; // 不是内置厂商，跳过（自定义厂商在后面处理）
      const baseUrl = providerBaseUrls?.[provider] || builtin[0].base;
      const list: ModelOption[] = [];
      for (const modelName of models) {
        // 如果有匹配的内置 ModelOption，保留其 label；否则用模型名作为 label
        const match = builtin.find(b => b.value === modelName);
        list.push(match || { value: modelName, label: modelName, provider, base: baseUrl });
      }
      if (list.length > 0) map.set(provider, list);
    }
    // 没有在 provider_models 中配置的内置厂商 → 用硬编码默认
    const configuredProviders = new Set(Object.keys(providerModels));
    for (const m of AI_MODELS) {
      if (configuredProviders.has(m.provider)) continue; // 已由用户配置覆盖
      const list = map.get(m.provider) || [];
      list.push(m);
      map.set(m.provider, list);
    }
  } else {
    // 没有 provider_models → 全部用硬编码默认
    for (const m of AI_MODELS) {
      const list = map.get(m.provider) || [];
      list.push(m);
      map.set(m.provider, list);
    }
  }

  // 2. 自定义厂商模型（不在 AI_MODELS 中的）
  if (providerModels) {
    const builtinProviders = new Set(AI_MODELS.map(m => m.provider));
    for (const [provider, models] of Object.entries(providerModels)) {
      if (builtinProviders.has(provider)) continue;
      const baseUrl = providerBaseUrls?.[provider] || "";
      const list = map.get(provider) || [];
      for (const m of models) {
        if (!list.some(x => x.value === m)) {
          list.push({ value: m, label: m, provider, base: baseUrl });
        }
      }
      if (list.length > 0) map.set(provider, list);
    }
  }

  return Array.from(map.entries());
}

const ICON_MAP: Record<string, typeof Puzzle> = {
  LayoutDashboard, ListTree, Layers, BookMarked, Lightbulb, Archive, Settings, BookOpen, Puzzle,
};

/** 获取 lucide 图标组件 */
function getIcon(name: string) {
  return ICON_MAP[name] ?? Puzzle;
}

/** 是否是分隔节点头 */
function isSectionHeader(item: NavItem): boolean {
  return item.id.startsWith("__section__");
}

/**
 * 构建导航列表：内置固定项 + 自定义模块项 + AI 动态项。
 */
function useNavItems(): NavItem[] {
  const { customModules, navItems } = useAppStore();

  return useMemo(() => {
    const result: NavItem[] = [];

    // 1. 内置模块（始终在最前）
    result.push(
      { id: "overview", label: "总览", icon: "LayoutDashboard", kind: "builtin", pinned: true },
      { id: "outline", label: "大纲", icon: "ListTree", kind: "builtin", pinned: true },
      { id: "writing", label: "写作台", icon: "Layers", kind: "builtin", pinned: true },
      { id: "story-bible", label: "故事圣经", icon: "BookMarked", kind: "builtin", pinned: true },
      { id: "manuscript", label: "灵感", icon: "Lightbulb", kind: "builtin", pinned: true },
      { id: "material", label: "素材库", icon: "Archive", kind: "builtin", pinned: true },
      { id: "__settings__", label: "设置", icon: "Settings", kind: "builtin", pinned: true },
      { id: "tutorial", label: "教程", icon: "BookOpen", kind: "builtin", pinned: true },
    );

    // 2. 自定义模块
    if (customModules.length > 0) {
      result.push({
        id: "__section_custom__",
        label: "自定义",
        icon: "Puzzle",
        kind: "builtin",
      });
      for (const mod of customModules) {
        result.push({
          id: mod.id,
          label: mod.name,
          icon: mod.icon,
          kind: "custom",
          customModuleId: mod.id,
        });
      }
    }

    // 3. AI 动态导航项
    for (const item of navItems) {
      if (result.some((r) => r.id === item.id)) continue;
      result.push(item);
    }

    return result;
  }, [customModules, navItems]);
}

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const {
    currentProject,
    activeModule,
    activeExtraId,
    navigateTo,
    drawerOpen,
    drawerWidth,
    setDrawerOpen,
    setDrawerWidth,
    navCollapsed,
    setNavCollapsed,
    setSettingsOpen,
    setCurrentProject,
    autosaveStatus,
    deepseekStatus,
    frameworkProgress,
    customModules,
    apiConfig,
    setApiConfig,
  } = useAppStore();

  const [modelOpen, setModelOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 首次加载时同步 __active_provider__
  useEffect(() => {
    if (!apiConfig?.api_model || apiConfig?.provider_base_urls?.["__active_provider__"]) return;
    // 根据当前 api_model 查找所属 provider
    const found = AI_MODELS.find(m => m.value === apiConfig.api_model);
    if (found) {
      setApiConfig({
        ...apiConfig,
        provider_base_urls: { ...apiConfig.provider_base_urls, "__active_provider__": found.provider },
      });
    }
  }, [apiConfig]);

  // 启动时自动检查新版本
  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then(info => {
      if (!cancelled && info) setUpdateInfo(info);
    });
    return () => { cancelled = true; };
  }, []);

  const navWidth = navCollapsed ? "w-[72px]" : "w-[220px]";
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(420);
  const navItems = useNavItems();

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartW.current = drawerWidth;
  }, [drawerWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = dragStartX.current - e.clientX;
      const newW = Math.max(320, Math.min(800, dragStartW.current + dx));
      setDrawerWidth(newW);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const currentLabel = useMemo(() => {
    if (activeModule === "custom") {
      const mod = customModules.find((m) => m.id === activeExtraId);
      return mod?.name ?? "自定义模块";
    }
    if (activeModule === "dynamic") {
      const item = navItems.find((n) => n.id === activeExtraId);
      return item?.label ?? "动态页面";
    }
    return MODULE_LABEL[activeModule as keyof typeof MODULE_LABEL] ?? "未知";
  }, [activeModule, activeExtraId, customModules, navItems]);

  /** 合并 SQLite chapterContents + localStorage chapterShards，localStorage 优先（最新数据） */
  function mergeChapterContents(
    dbContents: Record<string, unknown>[],
    shards: Record<string, unknown> | undefined
  ): Record<string, unknown>[] {
    const map = new Map<string, Record<string, unknown>>();
    for (const cc of (dbContents || [])) {
      const chId = cc.chapter_id as string;
      if (chId) map.set(chId, cc);
    }
    if (shards) {
      for (const [chId, chData] of Object.entries(shards)) {
        const ch = chData as Record<string, unknown>;
        const content = (ch.content as string) || "";
        if (content) {
          map.set(chId, {
            chapter_id: chId,
            body_html: content,
            body_text: content.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " "),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
    return Array.from(map.values());
  }

  /**
   * 从 chapterShards 构建卷章树（写作台数据在 localStorage，不在 mock-store/SQLite）
   * 返回 { volumes, chapters } 供 Word 导出使用。
   */
  function buildVolumeChapterTree(projectId: string, shards: Record<string, unknown> | undefined): {
    volumes: Record<string, unknown>[];
    chapters: Record<string, unknown>[];
  } {
    if (!shards) return { volumes: [], chapters: [] };
    const items = Object.entries(shards)
      .map(([id, ch]): Record<string, unknown> => ({ id, ...(ch as Record<string, unknown>) }))
      .sort((a, b) => ((a.number as number) || 0) - ((b.number as number) || 0));
    if (items.length === 0) return { volumes: [], chapters: [] };

    // 按 volumeSegmentId 分组为卷
    const volMap = new Map<string, { ids: string[]; title: string }>();
    for (const ch of items) {
      const segId = (ch.volumeSegmentId as string) || "__default__";
      if (!volMap.has(segId)) volMap.set(segId, { ids: [], title: "" });
      volMap.get(segId)!.ids.push(ch.id as string);
    }
    // 尝试从 plot-segments 读取实际名称
    if (projectId && typeof localStorage !== "undefined") {
      try {
        const segs = getJSONSync(`plot-segments-${projectId}`, [] as any[]);
        for (const seg of segs) {
          const entry = volMap.get(seg.id);
          if (entry) entry.title = seg.title || "";
        }
      } catch { /* ignore */ }
    }

    const volumes: Record<string, unknown>[] = [];
    const chapters: Record<string, unknown>[] = [];
    let volIdx = 0;
    for (const [, info] of volMap) {
      const vid = `exp-vol-${volIdx++}`;
      volumes.push({ id: vid, title: info.title || `第 ${volIdx} 卷` });
      for (const chId of info.ids) {
        const ch = items.find(c => c.id === chId);
        if (ch) {
          chapters.push({
            id: ch.id,
            volume_id: vid,
            number: ch.number as number ?? 0,
            title: (ch.title as string) || `第${ch.number}章`,
            status: "draft",
            word_count: ((ch.content as string) || "").length,
          });
        }
      }
    }
    return { volumes, chapters };
  }

  const handleExport = async (type: "setup" | "chapters") => {
    if (!currentProject) return;
    setExporting(true);
    try {
      const { exportSetupDoc, exportChaptersDoc } = await import("@/lib/export-doc");
      const raw = await api.exportProject(currentProject.id);
      const base = {
        projectName: raw.project.name as string,
        exportTime: new Date().toISOString(),
      };
      if (type === "setup") {
        await exportSetupDoc({
          ...base,
          worldTerms: raw.worldTerms,
          characters: raw.characters,
          relationships: raw.relationships,
          plotEvents: raw.plotEvents,
          timelineNodes: raw.timelineNodes,
        }, currentProject.id);
      } else {
        // 合并 chapterShards（localStorage 分片存储）到 chapterContents
        const shards = (raw as any).chapterShards;
        const mergedContents = mergeChapterContents(raw.chapterContents as any[], shards);
        // 写作台的卷章树在 localStorage 不在 mock-store/SQLite；shard 数据优先
        const hasShards = shards && Object.keys(shards).length > 0;
        const { volumes, chapters } = hasShards
          ? buildVolumeChapterTree(currentProject.id, shards)
          : { volumes: raw.volumes, chapters: raw.chapters };
        await exportChaptersDoc({
          ...base,
          volumes,
          chapters,
          beatCards: raw.beatCards,
          chapterContents: mergedContents,
        }, currentProject.id);
      }
    } catch (e) {
      alertDialog(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportAll = async () => {
    if (!currentProject) return;
    setExporting(true);
    try {
      const { exportFullDoc } = await import("@/lib/export-doc");
      const raw = await api.exportProject(currentProject.id);
      const shards = (raw as any).chapterShards;
      const mergedContents = mergeChapterContents(raw.chapterContents as any[], shards);
      // 写作台的卷章树在 localStorage 不在 mock-store/SQLite；shard 数据优先
      const hasShards = shards && Object.keys(shards).length > 0;
      const { volumes, chapters } = hasShards
        ? buildVolumeChapterTree(currentProject.id, shards)
        : { volumes: raw.volumes, chapters: raw.chapters };
      await exportFullDoc({
        projectName: raw.project.name as string,
        exportTime: new Date().toISOString(),
        worldTerms: raw.worldTerms,
        characters: raw.characters,
        relationships: raw.relationships,
        plotEvents: raw.plotEvents,
        timelineNodes: raw.timelineNodes,
        volumes,
        chapters,
        beatCards: raw.beatCards,
        chapterContents: mergedContents,
      }, currentProject.id);
    } catch (e) {
      alertDialog(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 text-sm">
        <BookOpen className="h-5 w-5 text-amber-600" />
        <span className="font-semibold">{currentProject?.name ?? "Novel Workbench"}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {currentProject ? STAGE_LABEL[currentProject.stage] : "未打开作品"}
        </span>
        <button
          type="button"
          onClick={() => setCurrentProject(null)}
          className="ml-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          title="返回作品列表"
        >
          <LogOut className="h-3.5 w-3.5" />
          返回
        </button>

        {/* 导出按钮 */}
        {currentProject && (
          <div className="relative">
            <button
              type="button"
              disabled={exporting}
              onClick={() => setExportOpen(!exportOpen)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
              title="导出数据"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "导出中…" : "导出"}
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50"
                    onClick={() => { setExportOpen(false); handleExport("setup"); }}
                  >
                    导出设定（词条+人物+剧情）
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50"
                    onClick={() => { setExportOpen(false); handleExport("chapters"); }}
                  >
                    导出章节
                  </button>
                  <div className="border-t border-slate-100" />
                  <button
                    type="button"
                    className="flex w-full items-center px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50"
                    onClick={() => { setExportOpen(false); handleExportAll(); }}
                  >
                    导出全部
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 刷新按钮 */}
        {currentProject && (
          <button
            type="button"
            onClick={async () => {
              try {
                const { clearMockStoreCache } = await import("@/lib/mock-backend");
                clearMockStoreCache();
                const projects = await api.getProjects();
                const store = useAppStore.getState();
                store.setProjects(projects);
                const proj = projects.find(p => p.id === currentProject.id);
                if (proj) store.setCurrentProject(proj);
                setToast("✅ 刷新成功");
              } catch {
                setToast("❌ 刷新失败");
              }
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="刷新数据"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </button>
        )}

        <div className="flex-1" />

        {/* 刷新 Toast */}
        {toast && (
          <span className="text-xs text-slate-500 animate-pulse">{toast}</span>
        )}

        {/* 模型切换 */}
        {currentProject && (
          <div className="relative mr-2">
            <button
              type="button"
              onClick={() => setModelOpen(!modelOpen)}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              title="切换 AI 模型"
            >
              <span className="max-w-[120px] truncate">
                {(() => {
                  const model = apiConfig?.api_model;
                  if (!model) return "deepseek-chat";
                  // 先查是否是自定义 provider 的模型
                  if (apiConfig?.provider_models) {
                    for (const [, models] of Object.entries(apiConfig.provider_models)) {
                      if (models.includes(model)) return model;
                    }
                  }
                  // 再查内置模型列表
                  return AI_MODELS.find(m => m.value === model)?.label || model;
                })()}
              </span>
              <ChevronDown size={12} />
            </button>
            {modelOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setModelOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg max-h-[70vh] overflow-y-auto">
                  {groupModels(apiConfig?.provider_models, apiConfig?.provider_base_urls).map(([provider, models]) => {
                    const hasProviderKey = !!apiConfig?.provider_keys?.[provider];
                    return (
                      <div key={provider}>
                        <div className="flex items-center gap-1.5 px-3 py-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${hasProviderKey ? "bg-green-500" : "bg-slate-300"}`} />
                          <span className="text-[9px] font-medium uppercase tracking-wider text-slate-400">{provider}</span>
                        </div>
                        {models.map(m => {
                          const activeProvider = apiConfig?.provider_base_urls?.["__active_provider__"];
                          const isActive = apiConfig?.api_model === m.value && m.provider === activeProvider;
                          return (
                            <button
                              key={`${m.provider}::${m.value}`}
                              type="button"
                              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${isActive ? "bg-amber-50 text-amber-700 font-medium" : "text-slate-600"}`}
                              onClick={async () => {
                                setModelOpen(false);
                                const effectiveBase = m.base || apiConfig?.provider_base_urls?.[m.provider] || m.base;
                                await api.setApiConfig(effectiveBase, m.value, undefined, m.provider);
                                const c = await api.getApiConfig();
                                setApiConfig(c);
                              }}
                            >
                              <span className="truncate">{m.label}</span>
                              {isActive && <span className="ml-auto text-amber-600">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    className="flex w-full items-center px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
                    onClick={() => { setModelOpen(false); setSettingsOpen(true); }}
                  >
                    <Settings size={12} className="mr-1.5" />
                    API 设置
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className={`${navWidth} flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all`}>
          <button
            className="flex items-center justify-center border-b py-2 hover:bg-slate-50"
            type="button"
            onClick={() => setNavCollapsed(!navCollapsed)}
            title={navCollapsed ? "展开导航" : "折叠导航"}
          >
            <Menu className="h-4 w-4" />
          </button>

          <div className="flex-1 overflow-y-auto py-2 text-sm">
            <ul>
              {navItems.map((item) => {
                if (isSectionHeader(item)) {
                  const count = navItems.filter((n) => n.kind === "custom").length;
                  return (
                    <li key={item.id}>
                      <div className="my-2 border-t border-slate-100" />
                      {!navCollapsed && (
                        <div className="mb-1 flex items-center gap-1 px-3 py-1">
                          <Puzzle className="h-3 w-3 text-violet-500" />
                          <span className="text-[10px] font-medium uppercase tracking-wider text-violet-600">{item.label}</span>
                          <span className="ml-auto rounded bg-violet-100 px-1.5 text-[10px] text-violet-600">{count}</span>
                        </div>
                      )}
                    </li>
                  );
                }

                const Icon = getIcon(item.icon);
                let isActive = false;
                if (item.kind === "builtin" && activeModule === item.id) isActive = true;
                else if (item.kind === "custom" && activeModule === "custom" && activeExtraId === item.id) isActive = true;
                else if (item.kind === "dynamic" && activeModule === "dynamic" && activeExtraId === item.id) isActive = true;

                const activeStyle =
                  item.kind === "builtin" ? "bg-amber-50 text-amber-900"
                    : item.kind === "custom" ? "bg-violet-50 text-violet-900"
                      : "bg-emerald-50 text-emerald-900";
                const iconColor = isActive && item.kind === "custom" ? "text-violet-600"
                  : isActive && item.kind === "dynamic" ? "text-emerald-600"
                    : undefined;

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (item.id === "__settings__") { setSettingsOpen(true); return; }
                        if (item.kind === "builtin") navigateTo(item.id as NavTarget);
                        else if (item.kind === "custom") navigateTo("custom", item.customModuleId);
                        else if (item.kind === "dynamic") navigateTo("dynamic", item.id);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left ${isActive ? activeStyle : "hover:bg-slate-50"}`}
                      title={item.label}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${iconColor ?? ""}`} />
                      {!navCollapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>

          </div>
        </nav>

        <main className="relative min-w-0 flex-1 overflow-hidden">{children}</main>

        <aside
          className={`relative shrink-0 bg-white transition-all duration-200 ${drawerOpen ? "border-l border-slate-200" : ""}`}
          style={{ width: drawerOpen ? drawerWidth : 0, overflow: "hidden" }}
        >
          <div style={{ width: drawerWidth, height: "100%" }}>
            {drawerOpen && (
              <div
                className={`absolute left-0 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-amber-200/50 transition-colors ${isDragging ? "bg-amber-300/60" : ""}`}
                style={{ marginLeft: -4 }}
                onMouseDown={handleDragStart}
              />
            )}
            <RightDrawer />
          </div>
        </aside>
        <button
          type="button"
          className="absolute top-1/2 z-10 -translate-y-1/2 rounded-l bg-white px-1 py-4 shadow border border-r-0"
          style={{ right: drawerOpen ? drawerWidth : 0 }}
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          {drawerOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-slate-200 bg-white px-4 text-xs text-slate-500">
        <span>{currentLabel}</span>
        <span>{autosaveStatus}</span>
        <span>AI: {deepseekStatus === "ok" ? "已连接" : deepseekStatus === "offline" ? "未配置" : deepseekStatus}</span>
        <span className="text-violet-500">{customModules.length} 个自定义</span>
        {frameworkProgress && (
          <span>大纲完成度: {Math.round((frameworkProgress.worldview + frameworkProgress.characters + frameworkProgress.plot_direction) / 3)}%</span>
        )}
        <span className="ml-auto">v{getCurrentVersion()}</span>
        {updateInfo && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 hover:bg-amber-200"
            title={`新版本 v${updateInfo.version} 可用`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>新版本</span>
          </button>
        )}
      </footer>
    </div>
  );
}
