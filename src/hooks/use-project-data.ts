import { useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { migrateLocalStorageToSqlite } from "@/lib/migrate-data";
import { prewarmFromSqlite, getJSONSync } from "@/lib/storage";
import { loadAllChapters } from "@/lib/chapter-store";
import { reportDiagnostic } from "@/lib/diagnostics";

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
      const pid = currentProject.id;
      // Rust 端 project.db 与前端 writingModule 的 plot-chapters 是不同数据源
      // 优先从 localStorage 计算完成度（浏览器/EXE 均可用）
      const terms = getJSONSync("novel-workbench-mock", {} as any).worldTerms?.filter((t: any) => t.project_id === pid)?.length || 0;
      const chars = getJSONSync("novel-workbench-mock", {} as any).characters?.filter((c: any) => c.project_id === pid)?.length || 0;
      const segs = getJSONSync(`plot-segments-${pid}`, [] as any[]);
      const chaps = loadAllChapters(pid);
      const beatCards = getJSONSync("novel-workbench-mock", {} as any).beatCards;
      const chapIds = new Set(chaps.map((c: any) => c.id));
      const beats = (beatCards || []).filter((b: any) => chapIds.has(b.chapter_id)).length;
      const progress = {
        worldview: Math.min(100, terms * 20),
        characters: Math.min(100, chars * 15),
        plot_direction: Math.min(100, segs.length * 15),
        beats: chaps.length ? Math.min(100, Math.round((beats / (chaps.length * 3)) * 100)) : 0,
      };
      setFrameworkProgress(progress);
    }
  }, [currentProject, setProjects, setApiConfig, setFrameworkProgress, setDeepseekStatus]);

  useEffect(() => {
    // EXE 模式：先预暖 localStorage（从 SQLite 读回），再迁移（localStorage → SQLite）
    prewarmFromSqlite().then(() => {
      return migrateLocalStorageToSqlite();
    }).then(() => {
      return prewarmFromSqlite();
    }).then(() => {
      // 迁移完成后刷新数据
      refresh();
      // prewarm 完成后重新读取 UI 偏好（store 初始化早于 prewarm，EXE 模式下此时才能读到 SQLite 数据）
      const store = useAppStore.getState();
      store.setCharacterZoneEnabled?.({ ...store.characterZoneEnabled, ...getJSONSync("ui-character-zone-enabled", {}) });
      store.setWorldviewZoneEnabled?.({ ...store.worldviewZoneEnabled, ...getJSONSync("ui-worldview-zone-enabled", {}) });
    }).catch((e) => {
      reportDiagnostic("error", "项目启动数据预热/迁移失败", { error: String(e) });
      refresh();
    });

    const t = setInterval(() => {
      const state = useAppStore.getState();
      if (state.currentProject) {
        state.setAutosaveStatus("⏳ 自动保存中...");
        state.triggerAutosave?.();
      } else {
        state.setAutosaveStatus("已就绪");
      }
    }, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  return { refresh };
}
