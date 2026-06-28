import { startTransition, useCallback, lazy, Suspense, type ReactNode } from "react";
import { AppShell } from "@/layouts/AppShell";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { useProjectBootstrap } from "@/hooks/use-project-data";
import { useAppStore } from "@/stores/app-store";
import type { Project } from "@/types";

// 路由级代码分割：模块按需加载，首屏只加载当前模块代码
const OverviewModule = lazy(() => import("@/modules/overview/OverviewModule").then(m => ({ default: m.OverviewModule })));
const OutlineModule = lazy(() => import("@/modules/outline/OutlineModule").then(m => ({ default: m.OutlineModule })));
const WritingModule = lazy(() => import("@/modules/writing/WritingModule").then(m => ({ default: m.WritingModule })));
const ManuscriptModule = lazy(() => import("@/modules/manuscript/ManuscriptModule").then(m => ({ default: m.ManuscriptModule })));
const MaterialModule = lazy(() => import("@/modules/material/MaterialModule").then(m => ({ default: m.MaterialModule })));
const StoryBibleModule = lazy(() => import("@/modules/story-bible/StoryBibleModule").then(m => ({ default: m.StoryBibleModule })));
const TutorialModule = lazy(() => import("@/modules/tutorial/TutorialModule").then(m => ({ default: m.TutorialModule })));
// 自定义模块/动态页延迟加载：它们引用 icon-registry（含 ~100 个图标），延迟加载可把图标移出首屏
const CustomModuleRenderer = lazy(() => import("@/components/custom-module/CustomModuleRenderer").then(m => ({ default: m.CustomModuleRenderer })));
const DynamicPageRenderer = lazy(() => import("@/components/dynamic-page/DynamicPageRenderer").then(m => ({ default: m.DynamicPageRenderer })));

/** 渲染错误边界 — 捕获子组件渲染异常，防止整棵树白屏 */
import { Component } from "react";

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] 渲染崩溃:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center text-slate-500">
          <div className="max-w-md text-center">
            <p className="mb-2 text-lg font-bold text-red-500">页面渲染错误</p>
            <p className="mb-4 text-sm text-slate-400">{this.state.error?.message || "未知错误"}</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ModuleRouter() {
  const { activeModule, activeExtraId, customModules } = useAppStore();
  let content: ReactNode;

  if (activeModule === "overview") content = <OverviewModule />;
  else if (activeModule === "outline") content = <OutlineModule />;
  else if (activeModule === "beats" || activeModule === "writing") content = <WritingModule />;
  else if (activeModule === "story-bible") content = <StoryBibleModule />;
  else if (activeModule === "manuscript") content = <ManuscriptModule />;
  else if (activeModule === "material") content = <MaterialModule />;
  else if (activeModule === "tutorial") content = <TutorialModule />;
  else if (activeModule === "custom") {
    const mod = customModules.find((m) => m.id === activeExtraId);
    if (mod) content = <CustomModuleRenderer mod={mod} />;
  } else if (activeModule === "dynamic" && activeExtraId) {
    content = <DynamicPageRenderer pageId={activeExtraId} />;
  }

  if (!content) {
    content = (
      <div className="flex h-full items-center justify-center text-slate-400">
        <div className="text-center">
          <p className="text-sm">未找到该页面</p>
          <p className="mt-1 text-xs">请在右侧 AI 对话中让 AI 创建一个新页面</p>
        </div>
      </div>
    );
  }
  return content;
}

export default function App() {
  const { currentProject, setCurrentProject, eyeCareMode, theme } = useAppStore();
  const { refresh } = useProjectBootstrap();
  const handleOpen = useCallback(
    (p: Project) => {
      startTransition(() => { setCurrentProject(p); });
      useAppStore.getState().loadChat(p.id);
      refresh();
    },
    [setCurrentProject, refresh]
  );
  // 根 class：eye-care-mode(总开关) + theme-*(主题配色)；仅总开关开启时生效
  const rootClassName = eyeCareMode ? `eye-care-mode theme-${theme}` : "";
  if (!currentProject) {
    return (
      <div className={rootClassName}>
        <WelcomeScreen onOpenProject={handleOpen} />
        <SettingsModal />
      </div>
    );
  }
  return (
    <div className={rootClassName}>
      <AppShell>
        <ErrorBoundary>
          <Suspense fallback={<div className="flex h-full items-center justify-center text-slate-400 text-sm">加载中...</div>}>
            <ModuleRouter />
          </Suspense>
        </ErrorBoundary>
      </AppShell>
      <SettingsModal />
    </div>
  );
}
