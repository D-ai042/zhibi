// project-slice.ts — 项目管理领域分片（T10）
import type { StateCreator } from "zustand";
import type { Project, FrameworkProgress } from "@/types";
import type { AppStore } from "./types";

export interface ProjectSlice {
  projects: Project[];
  currentProject: Project | null;
  frameworkProgress: FrameworkProgress | null;
  setProjects: (p: Project[]) => void;
  setCurrentProject: (p: Project | null) => void;
  setFrameworkProgress: (p: FrameworkProgress) => void;
}

export const createProjectSlice: StateCreator<AppStore, [], [], ProjectSlice> = (set) => ({
  projects: [],
  currentProject: null,
  frameworkProgress: null,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setFrameworkProgress: (frameworkProgress) => set({ frameworkProgress }),
});
