import { useState } from "react";
import { BookOpen, FolderOpen, Plus, Settings, Trash2, Edit3, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { saveJSON } from "@/lib/storage";
import type { Project } from "@/types";

interface Props {
  onOpenProject: (p: Project) => void;
}

export function WelcomeScreen({ onOpenProject }: Props) {
  const { projects, setProjects, setSettingsOpen } = useAppStore();
  const [name, setName] = useState("我的长篇小说");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    try {
      const p = await api.createProject(name);
      await api.openProject(p.id);
      const list = await api.getProjects();
      setProjects(list);
      onOpenProject(p);
    } finally {
      setCreating(false);
    }
  };

  const open = async (p: Project) => {
    await api.openProject(p.id);
    onOpenProject(p);
  };

  const startRename = (p: Project) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
  };

  const confirmRename = async () => {
    if (!renamingId || !renameValue.trim()) return;
    await api.renameProject(renamingId, renameValue.trim());
    const list = await api.getProjects();
    setProjects(list);
    // 如果当前打开的项目被改名，同步更新
    const store = useAppStore.getState();
    if (store.currentProject?.id === renamingId) {
      store.setCurrentProject({ ...store.currentProject, name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
  };

  const confirmDelete = async (pid: string) => {
    const store = useAppStore.getState();
    const projName = store.projects.find(p => p.id === pid)?.name;
    await api.deleteProject(pid);
    // 清理聊天记录（走存储层）
    // T8 例外：遍历 localStorage 枚举 key 清理项目数据
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(`novel-workbench-chat-${pid}`)) {
        saveJSON(key, null);
      }
    }
    if (projName) {
      saveJSON(`novel-workbench-chat-name:${projName}`, null);
    }
    const list = await api.getProjects();
    setProjects(list);
    // 如果删除的是当前打开的项目，回到欢迎页
    if (store.currentProject?.id === pid) {
      store.setCurrentProject(null);
    }
    setDeletingId(null);
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-slate-100">
      <BookOpen className="mb-4 h-16 w-16 text-amber-600" />
      <h1 className="text-3xl font-bold">执笔</h1>
      <p className="mt-2 text-slate-600">先定章法，再落笔墨</p>

      <div className="mt-8 flex gap-4">
        <div className="w-80 rounded-xl border bg-white p-6 shadow">
          <h2 className="flex items-center gap-2 font-semibold">
            <Plus className="h-5 w-5" /> 新建作品
          </h2>
          <input
            className="mt-3 w-full rounded border px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            disabled={creating}
            onClick={create}
            className="mt-3 w-full rounded-lg bg-amber-500 py-2 text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {creating ? "创建中…" : "创建"}
          </button>
        </div>

        <div className="w-80 rounded-xl border bg-white p-6 shadow">
          <h2 className="flex items-center gap-2 font-semibold">
            <FolderOpen className="h-5 w-5" /> 打开作品
          </h2>
          <ul className="mt-3 max-h-60 overflow-y-auto text-sm">
            {projects.length === 0 && (
              <li className="text-slate-400">暂无作品，请先新建</li>
            )}
            {projects.map((p) => (
              <li key={p.id} className="group flex items-center gap-1">
                {renamingId === p.id ? (
                  <div className="flex w-full items-center gap-1 px-1 py-1.5">
                    <input
                      className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && confirmRename()}
                      autoFocus
                    />
                    <button type="button" onClick={confirmRename} className="rounded p-1 text-green-600 hover:bg-green-50">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={cancelRename} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : deletingId === p.id ? (
                  <div className="flex w-full items-center gap-1 px-1 py-1.5 text-xs text-red-600">
                    <span>确认删除「{p.name}」？</span>
                    <button type="button" onClick={() => confirmDelete(p.id)} className="rounded bg-red-500 px-2 py-0.5 text-white hover:bg-red-600">确认</button>
                    <button type="button" onClick={() => setDeletingId(null)} className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100">取消</button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => open(p)}
                      className="min-w-0 flex-1 rounded px-2 py-2 text-left hover:bg-amber-50"
                    >
                      {p.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(p)}
                      className="hidden rounded p-1 text-slate-400 hover:text-amber-600 group-hover:inline"
                      title="重命名"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(p.id)}
                      className="hidden rounded p-1 text-slate-400 hover:text-red-500 group-hover:inline"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className="mt-6 flex items-center gap-2 text-sm text-slate-600 hover:text-amber-700"
      >
        <Settings className="h-4 w-4" /> API 设置（DeepSeek）
      </button>
    </div>
  );
}
