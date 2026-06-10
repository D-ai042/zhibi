import { startTransition, useCallback, type ReactNode } from "react";
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
  let content: ReactNode;

  if (activeModule === "overview") content = <OverviewModule />;
  else if (activeModule === "outline") content = <OutlineModule />;
  else if (activeModule === "beats" || activeModule === "writing") content = <WritingModule />;
  else if (activeModule === "story-bible") content = <StoryBibleModule />;
  else if (activeModule === "manuscript") content = <ManuscriptModule />;
  else if (activeModule === "material") content = <MaterialModule />;
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
  const { currentProject, setCurrentProject } = useAppStore();
  const { refresh } = useProjectBootstrap();
  const handleOpen = useCallback(
    (p: Project) => {
      startTransition(() => { setCurrentProject(p); });
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
