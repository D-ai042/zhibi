// SettingsModal.tsx — 设置弹窗壳（T9 瘦身：逻辑移交各 Tab 子组件）
import { useState, useEffect } from "react";
import { X, Settings2, Mic, History, Download, Info } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { ApiConfigTab } from "./ApiConfigTab";
import { SttConfigTab } from "./SttConfigTab";
import { SnapshotManagerTab } from "./SnapshotManagerTab";
import { DataMigrateTab } from "./DataMigrateTab";

type TabName = "api" | "stt" | "snapshots" | "migrate" | "about";

const TABS: { id: TabName; label: string; icon: typeof Settings2 }[] = [
  { id: "api", label: "API 配置", icon: Settings2 },
  { id: "stt", label: "语音配置", icon: Mic },
  { id: "snapshots", label: "快照管理", icon: History },
  { id: "migrate", label: "数据迁移", icon: Download },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useAppStore();
  const [tab, setTab] = useState<TabName>("api");

  useEffect(() => {
    if (!settingsOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSettingsOpen(false)}>
      <div className="relative w-[720px] max-h-[85vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-semibold text-slate-800">设置</h2>
          <button onClick={() => setSettingsOpen(false)} className="rounded-lg p-1.5 hover:bg-slate-100"><X size={18} /></button>
        </div>
        {/* tabs */}
        <div className="flex border-b px-6 gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${tab === t.id ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              <t.icon size={14} />{t.label}
            </button>
          ))}
        </div>
        {/* content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === "api" && <ApiConfigTab />}
          {tab === "stt" && <SttConfigTab />}
          {tab === "snapshots" && <SnapshotManagerTab />}
          {tab === "migrate" && <DataMigrateTab />}
          {tab === "about" && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">关于</h3>
              <p className="text-xs text-slate-500">执笔 (ZhiBi) — AI 辅助长篇小说写作工具</p>
              <p className="text-xs text-slate-400">版本 v0.3.6 | 基于 Tauri + React + TypeScript</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
