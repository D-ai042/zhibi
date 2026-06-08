import { BarChart3, Globe2, Users } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import type { OverviewSection } from "@/types";
import { OVERVIEW_SECTION_LABEL } from "@/types";
import { WritingStatsPanel } from "./WritingStatsPanel";
import { WorldviewGlossaryPanel } from "./WorldviewGlossaryPanel";
import { CharacterArchivePanel } from "./CharacterArchivePanel";

const SECTIONS: { id: OverviewSection; icon: typeof BarChart3; desc: string }[] = [
  { id: "stats", icon: BarChart3, desc: "字数、章节、完成度等数据" },
  { id: "worldview", icon: Globe2, desc: "规则、势力、地点等硬设定" },
  { id: "characters", icon: Users, desc: "角色档案与人物弧光" },
];

export function OverviewModule() {
  const { overviewSection, setOverviewSection } = useAppStore();

  return (
    <div className="flex h-full">
      <aside className="w-52 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="border-b px-4 py-3">
          <h1 className="text-lg font-bold">总览</h1>
          <p className="mt-0.5 text-xs text-slate-500">全局视角，掌控全局</p>
        </div>
        <nav className="p-2">
          {SECTIONS.map(({ id, icon: Icon, desc }) => (
            <button key={id} type="button" onClick={() => setOverviewSection(id)}
              className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left ${overviewSection === id ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50"}`}>
              <div className="flex items-center gap-2 font-medium text-sm">
                <Icon className="h-4 w-4 text-amber-700" />
                {OVERVIEW_SECTION_LABEL[id]}
              </div>
              <p className="mt-0.5 pl-6 text-[10px] text-slate-400">{desc}</p>
            </button>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-hidden">
        {overviewSection === "stats" && <WritingStatsPanel />}
        {overviewSection === "worldview" && <WorldviewGlossaryPanel />}
        {overviewSection === "characters" && <CharacterArchivePanel />}
      </div>
    </div>
  );
}
