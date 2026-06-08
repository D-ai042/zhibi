import { useCallback } from "react";
import { AppShell } from "@/layouts/AppShell";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { CustomModuleRenderer } from "@/components/custom-module/CustomModuleRenderer";
import { DynamicPageRenderer } from "@/components/dynamic-page/DynamicPageRenderer";
import { useProjectBootstrap } from "@/hooks/use-project-data";
import { useAppStore } from "@/stores/app-store";
import type { Project } from "@/types";
import { OverviewModule } from "@/modules/overview/OverviewModule";
import { OutlineModule } from "@/modules/outline/OutlineModule";
import { WritingModule } from "@/modules/writing/WritingModule";
import { ManuscriptModule } from "@/modules/manuscript/ManuscriptModule";
import { MaterialModule } from "@/modules/material/MaterialModule";

import { StoryBibleModule } from "@/modules/story-bible/StoryBibleModule";

function ModuleRouter() {
  const { activeModule, activeExtraId, customModules } = useAppStore();

  // 内置模块
  if (activeModule === "overview") return <OverviewModule />;
  if (activeModule === "outline") return <OutlineModule />;
  if (activeModule === "beats" || activeModule === "writing") return <WritingModule />;
  // "beats" 保留路由兼容，统一走写作台（用户不需要独立的分章节拍模块）
  if (activeModule === "story-bible") return <StoryBibleModule />;
  if (activeModule === "manuscript") return <ManuscriptModule />;
  if (activeModule === "material") return <MaterialModule />;

  // 自定义模块
  if (activeModule === "custom") {
    const mod = customModules.find((m) => m.id === activeExtraId);
    if (mod) return <CustomModuleRenderer mod={mod} />;
  }

  // AI 动态页面
  if (activeModule === "dynamic" && activeExtraId) {
    return <DynamicPageRenderer pageId={activeExtraId} />;
  }

  // 回退
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      <div className="text-center">
        <p className="text-sm">未找到该页面</p>
        <p className="mt-1 text-xs">请在右侧 AI 对话中让 AI 创建一个新页面</p>
      </div>
    </div>
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
