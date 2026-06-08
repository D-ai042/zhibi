import { useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";

export function useProjectBootstrap() {
  const {
    currentProject,
    setProjects,
    setApiConfig,
    setFrameworkProgress,
    setDeepseekStatus,
  } = useAppStore();

  const refresh = useCallback(async () => {
    const projects = await api.getProjects();
    setProjects(projects);
    const config = await api.getApiConfig();
    setApiConfig(config);
    setDeepseekStatus(config.has_api_key ? "ok" : "offline");

    if (currentProject) {
      const progress = await api.getFrameworkProgress(currentProject.id);
      setFrameworkProgress(progress);
    }
  }, [currentProject, setProjects, setApiConfig, setFrameworkProgress, setDeepseekStatus]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      useAppStore.getState().setAutosaveStatus("自动保存 " + new Date().toLocaleTimeString());
    }, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  return { refresh };
}
