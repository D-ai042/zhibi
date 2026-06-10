import { lazy, Suspense, useCallback, type ReactNode } from "react";
import { AppShell } from "@/layouts/AppShell";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { useProjectBootstrap } from "@/hooks/use-project-data";
import { useAppStore } from "@/stores/app-store";
import type { Project } from "@/types";

const OverviewModule = lazy(() => import("@/modules/overview/OverviewModule").then(m => ({ default: m.OverviewModule })));
const OutlineModule = lazy(() => import("@/modules/outline/OutlineModule").then(m => ({ default: m.OutlineModule })));
const WritingModule = lazy(() => import("@/modules/writing/WritingModule").then(m => ({ default: m.WritingModule })));
const ManuscriptModule = lazy(() => import("@/modules/manuscript/ManuscriptModule").then(m => ({ default: m.ManuscriptModule })));
const MaterialModule = lazy(() => import("@/modules/material/MaterialModule").then(m => ({ default: m.MaterialModule })));
const StoryBibleModule = lazy(() => import("@/modules/story-bible/StoryBibleModule").then(m => ({ default: m.StoryBibleModule })));
const CustomModuleRenderer = lazy(() => import("@/components/custom-module/CustomModuleRenderer").then(m => ({ default: m.CustomModuleRenderer })));
const DynamicPageRenderer = lazy(() => import("@/components/dynamic-page/DynamicPageRenderer").then(m => ({ default: m.DynamicPageRenderer })));

function ModuleRouter() {
  const { activeModule, activeExtraId, customModules } = useAppStore();

  let content: ReactNode;

  // 内置模块
  if (activeModule === "overview") content = <OverviewModule />;
  else if (activeModule === "outline") content = <OutlineModule />;
  else if (activeModule === "beats" || activeModule === "writing") content = <WritingModule />;
  // "beats" 保留路由兼容，统一走写作台（用户不需要独立的分章节拍模块）
  else if (activeModule === "story-bible") content = <StoryBibleModule />;
  else if (activeModule === "manuscript") content = <ManuscriptModule />;
  else if (activeModule === "material") content = <MaterialModule />;

  // 自定义模块
  else if (activeModule === "custom") {
    const mod = customModules.find((m) => m.id === activeExtraId);
    if (mod) content = <CustomModuleRenderer mod={mod} />;
  }

  // AI 动态页面
  else if (activeModule === "dynamic" && activeExtraId) {
    content = <DynamicPageRenderer pageId={activeExtraId} />;
  }

  // 回退
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

  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
      </div>
    }>
      {content}
    </Suspense>
  );
}

export default function App() {
  const { currentProject, setCurrentProject } = useAppStore();
  const { refresh } = useProjectBootstrap();

  const handleOpen = useCallback(
    (p: Project) => {
      setCurrentProject(p);
      useAppStore.getState().loadChat(p.id);
      refresh();
    },
    [setCurrentProject, refresh]
  );

  if (!currentProject) {
    return (
      <>
        <WelcomeScreen onOpenProject={handleOpen} />
        <SettingsModal />
      </>
    );
  }

  return (
    <>
      <AppShell>
        <ModuleRouter />
      </AppShell>
      <SettingsModal />
    </>
  );
}
