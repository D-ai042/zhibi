import { Globe2, GitBranch, Users, Layers, Lock } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useState } from "react";
import type { OutlineSection } from "@/types";
import { OUTLINE_SECTION_LABEL } from "@/types";
import { WorldviewPanel } from "./WorldviewPanel";
import { CharactersPanel } from "./CharactersPanel";
import { PlotDirectionPanel } from "./PlotDirectionPanel";

const SECTIONS: { id: OutlineSection; icon: typeof Globe2; desc: string }[] = [
  { id: "worldview", icon: Globe2, desc: "规则、势力、地点等硬设定" },
  { id: "characters", icon: Users, desc: "角色、关系与人物弧光" },
  { id: "plot-direction", icon: GitBranch, desc: "主线时间轴与明暗线走向" },
];

function updateGroupName(gid: string, newName: string) {
  const pid = useAppStore.getState().currentProject?.id;
  if (!pid) return;
  const key = "worldview-groups-" + pid;
  const saved = JSON.parse(localStorage.getItem(key) || "[]");
  const idx = saved.findIndex((g: any) => g.id === gid);
  if (idx >= 0) { saved[idx].name = newName; localStorage.setItem(key, JSON.stringify(saved)); }
}

function removeGroup(gid: string) {
  const pid = useAppStore.getState().currentProject?.id;
  if (!pid) return;
  const key = "worldview-groups-" + pid;
  const saved = JSON.parse(localStorage.getItem(key) || "[]");
  localStorage.setItem(key, JSON.stringify(saved.filter((g: any) => g.id !== gid)));
}

export function OutlineModule() {
  const { outlineSection, setOutlineSection, worldviewGroups, setWorldviewGroups, focusGroup, bumpGroups } = useAppStore();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; gid: string; name: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const doRename = (gid: string, name: string) => {
    updateGroupName(gid, name);
    setWorldviewGroups(worldviewGroups.map(g => g.id === gid ? { ...g, name } : g));
    bumpGroups(); // sync canvas
    setEditId(null);
  };

  const doRemove = (gid: string) => {
    removeGroup(gid);
    setWorldviewGroups(worldviewGroups.filter(g => g.id !== gid));
    bumpGroups(); // sync canvas
  };

  return (
    <div className="flex h-full" onClick={() => setCtxMenu(null)}>
      <aside className="w-52 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="border-b px-4 py-3">
          <h1 className="text-lg font-bold">大纲</h1>
          <p className="mt-0.5 text-xs text-slate-500">先定框架，再填血肉</p>
        </div>
        <nav className="p-2">
          {SECTIONS.map(({ id, icon: Icon, desc }) => (
            <button key={id} type="button" onClick={() => setOutlineSection(id)}
              className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left ${outlineSection === id ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50"}`}>
              <div className="flex items-center gap-2 font-medium text-sm">
                <Icon className="h-4 w-4 text-amber-700" />
                {OUTLINE_SECTION_LABEL[id]}
              </div>
              <p className="mt-0.5 pl-6 text-[10px] text-slate-400">{desc}</p>
            </button>
          ))}
          {outlineSection === "worldview" && worldviewGroups.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-1 px-3 py-1 mb-1">
                <Layers className="h-3 w-3 text-violet-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-violet-600">编组</span>
              </div>
              {worldviewGroups.map(g => (
                <div key={g.id}
                  className="mb-0.5 w-full rounded px-3 py-1.5 text-left text-xs hover:bg-slate-50 flex items-center gap-2 cursor-pointer group"
                  onClick={() => { setOutlineSection("worldview"); focusGroup(g.id); }}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, gid: g.id, name: g.name }); }}
                  onDoubleClick={() => { setEditId(g.id); setEditVal(g.name); }}>
                  {g.locked ? <Lock className="w-3 h-3 text-amber-500 shrink-0" /> : <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                  {editId === g.id ? (
                    <input className="flex-1 text-xs border-b border-amber-400 outline-none px-1 bg-transparent" value={editVal} autoFocus
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => doRename(g.id, editVal)}
                      onKeyDown={e => { if (e.key === "Enter") doRename(g.id, editVal); if (e.key === "Escape") setEditId(null); }}
                      onClick={e => e.stopPropagation()} />
                  ) : (
                    <span className="truncate">{g.name}</span>
                  )}
                  <button className="ml-auto opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-[10px]"
                    onClick={e => { e.stopPropagation(); doRemove(g.id); }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </nav>
      </aside>
      {ctxMenu && (
        <div className="fixed z-50 rounded-lg border bg-white shadow-xl py-1 text-sm" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button className="block w-full text-left px-3 py-1.5 hover:bg-slate-50" onClick={() => { setEditId(ctxMenu.gid); setEditVal(ctxMenu.name); setCtxMenu(null); }}>✏️ 重命名</button>
          <button className="block w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600" onClick={() => { doRemove(ctxMenu.gid); setCtxMenu(null); }}>解散</button>
        </div>
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        {outlineSection === "worldview" && <WorldviewPanel />}
        {outlineSection === "characters" && <CharactersPanel />}
        {outlineSection === "plot-direction" && <PlotDirectionPanel />}
      </div>
    </div>
  );
}
