import { useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { migrateLocalStorageToSqlite } from "@/lib/migrate-data";

export function useProjectBootstrap() {
  const {
    currentProject,
    setProjects,
    setApiConfig,
    setFrameworkProgress,
    setDeepseekStatus,
  } = useAppStore();

  const refresh = useCallback(async () => {
    const [projects, config] = await Promise.all([
      api.getProjects(),
      api.getApiConfig(),
    ]);
    setProjects(projects);
    setApiConfig(config);
    setDeepseekStatus(config.has_api_key ? "ok" : "offline");

    if (currentProject) {
      const progress = await api.getFrameworkProgress(currentProject.id);
      setFrameworkProgress(progress);
    }
  }, [currentProject, setProjects, setApiConfig, setFrameworkProgress, setDeepseekStatus]);

  useEffect(() => {
    // EXE 首次启动时迁移 localStorage 数据到 SQLite
    migrateLocalStorageToSqlite().then(() => {
      // 迁移完成后刷新数据
      refresh();
    });

    const t = setInterval(() => {
      useAppStore.getState().setAutosaveStatus("自动保存 " + new Date().toLocaleTimeString());
    }, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  return { refresh };
}
