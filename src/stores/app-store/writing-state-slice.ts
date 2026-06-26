// writing-state-slice.ts — 聊天 + API 配置分片（T10）
import type { StateCreator } from "zustand";
import type { ChatMessage, ApiConfig } from "@/types";
import type { AppStore } from "./types";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { reportDiagnostic } from "@/lib/diagnostics";

export interface WritingStateSlice {
  chatMessages: ChatMessage[];
  deepseekStatus: "ok" | "offline" | "error" | "unknown";
  apiConfig: ApiConfig | null;
  persistChat: () => void; loadChat: (projectId: string) => void;
  addChatMessage: (m: ChatMessage) => void;
  appendChatMessages: (msgs: ChatMessage[]) => void;
  clearChat: () => void;
  setDeepseekStatus: (s: "ok" | "offline" | "error" | "unknown") => void;
  setApiConfig: (c: ApiConfig) => void;
}

export const createWritingStateSlice: StateCreator<AppStore, [], [], WritingStateSlice> = (set, get) => ({
  chatMessages: [],
  deepseekStatus: "unknown",
  apiConfig: null,
  setDeepseekStatus: (deepseekStatus) => set({ deepseekStatus }),
  setApiConfig: (apiConfig) => set({ apiConfig }),
  persistChat: () => {
    const { currentProject, chatMessages: msgs } = get();
    if (!currentProject) return;
    try {
      const payload = { _projectId: currentProject.id, _projectName: currentProject.name, messages: msgs };
      setJSONSync("novel-workbench-chat-" + currentProject.id, payload);
      setJSONSync("novel-workbench-chat-name:" + currentProject.name, payload);
    } catch (e) { reportDiagnostic("error", "聊天记录保存失败", { error: String(e) }); }
  },
  loadChat: (projectId: string) => {
    try {
      const { projects } = get();
      const project = projects.find(p => p.id === projectId);
      let bestData: ChatMessage[] | null = null;
      const extract = (raw: string): ChatMessage[] | null => {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed as ChatMessage[];
          if (parsed.messages && Array.isArray(parsed.messages)) return parsed.messages as ChatMessage[];
          return null;
        } catch { return null; }
      };
      const idPayload = getJSONSync("novel-workbench-chat-" + projectId, null);
      if (idPayload) { const msgs2 = extract(JSON.stringify(idPayload)); if (msgs2 && msgs2.length > 0) bestData = msgs2; }
      if (project) {
        const namePayload = getJSONSync("novel-workbench-chat-name:" + project.name, null);
        if (namePayload) {
          const msgs2 = extract(JSON.stringify(namePayload));
          let projectIdMatches = false;
          try { projectIdMatches = (namePayload as any)._projectId === projectId; } catch { /* ignore */ }
          if (msgs2 && projectIdMatches && (!bestData || msgs2.length > bestData.length)) bestData = msgs2;
        }
        const knownIds = new Set(projects.map(p => p.id));
        // T8 例外：遍历 localStorage 枚举 key（加载聊天冷备份）
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith("novel-workbench-chat-") || key.startsWith("novel-workbench-chat-name:")) continue;
          const orphanId = key.replace("novel-workbench-chat-", "");
          if (knownIds.has(orphanId)) continue;
          try {
            const orphanPayload = getJSONSync(key, null);
            if (!orphanPayload) continue;
            let orphanMsgs: ChatMessage[] | null = null;
            const raw = JSON.stringify(orphanPayload);
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) orphanMsgs = parsed as ChatMessage[];
            else if (parsed.messages && Array.isArray(parsed.messages)) orphanMsgs = parsed.messages as ChatMessage[];
            const orphanProjectId = (orphanPayload as any)._projectId;
            const orphanProjectName = (orphanPayload as any)._projectName;
            if (orphanMsgs && orphanMsgs.length > 0) {
              if (orphanProjectId === projectId) { if (!bestData || orphanMsgs.length > bestData.length) bestData = orphanMsgs; }
              else if (!orphanProjectId && !orphanProjectName && (!bestData || orphanMsgs.length > bestData.length)) bestData = orphanMsgs;
            }
          } catch { /* skip */ }
        }
      }
      if (bestData) {
        set({ chatMessages: bestData });
        setJSONSync("novel-workbench-chat-" + projectId, { _projectId: projectId, _projectName: (project ? project.name : ""), messages: bestData });
        return;
      }
      set({ chatMessages: [] });
    } catch { set({ chatMessages: [] }); }
  },
  addChatMessage: (m) => { set((s) => ({ chatMessages: [...s.chatMessages, m] })); setTimeout(() => get().persistChat(), 0); },
  appendChatMessages: (msgs2) => { set((s) => ({ chatMessages: [...s.chatMessages, ...msgs2] })); setTimeout(() => get().persistChat(), 0); },
  clearChat: () => { set({ chatMessages: [] }); setTimeout(() => get().persistChat(), 0); },
});
