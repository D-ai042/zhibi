// SettingsModal.tsx — 设置弹窗壳（T9 拆分，组合4个Tab子组件）
import { useEffect, useState } from "react";
import { X, Settings2, Mic, History, Download } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { getCurrentVersion, checkForUpdate, markDismissed, type VersionInfo } from "@/lib/version-check";
import { ApiConfigTab } from "./ApiConfigTab";
import { SttConfigTab } from "./SttConfigTab";
import { SnapshotManagerTab } from "./SnapshotManagerTab";
import { DataMigrateTab } from "./DataMigrateTab";

type TabName = "api" | "stt" | "snapshots" | "migrate" | "about";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useAppStore();
  const [tab, setTab] = useState<TabName>("api");

  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "error" | "up-to-date" | "available">("idle");

  useEffect(() => {
    if (!settingsOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[520px] max-h-[85vh] rounded-lg bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <h2 className="font-semibold">设置</h2>
          <button type="button" onClick={() => setSettingsOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-200 text-sm shrink-0">
          <button type="button" onClick={() => setTab("api")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "api" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <Settings2 size={15} /> API 配置
          </button>
          <button type="button" onClick={() => setTab("stt")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "stt" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <Mic size={15} /> 语音配置
          </button>
          <button type="button" onClick={() => setTab("snapshots")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "snapshots" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <History size={15} /> 快照管理
          </button>
          <button type="button" onClick={() => setTab("migrate")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "migrate" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <Download size={15} /> 数据迁移
          </button>
          <button type="button" onClick={() => setTab("about")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "about" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <History size={15} /> 关于
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {tab === "api" && <ApiConfigTab />}
          {tab === "stt" && <SttConfigTab />}
          {tab === "snapshots" && <SnapshotManagerTab />}
          {tab === "migrate" && <DataMigrateTab />}
          {tab === "about" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">执笔 · 先定章法，再落笔墨</p>
              <p className="text-xs text-slate-500">版本：{getCurrentVersion?.() || "v0.3.6"}</p>
              <p className="text-xs text-slate-400">一款专为长篇小说创作者打造的智能写作工具</p>
              <div className="pt-3 space-y-1 text-xs text-slate-500">
                <p>支持 10+ AI 厂商（DeepSeek / OpenAI / Anthropic / 阿里云 / 智谱 / 月之暗面 等）</p>
                <p>自定义厂商（任意 API 服务商 + 自定义模型列表）</p>
                <p>多厂商 API Key / STT Key 独立管理</p>
                <p>语音输入（OpenAI Whisper / 硅基流动 / 百度语音）</p>
                <p>项目快照与回退</p>
                <p>数据导入导出（跨设备迁移）</p>
                <p>自动保存 + 自动备份</p>
              </div>
              <div className="pt-4 flex gap-2">
                <button onClick={async () => {
                  setCheckingUpdate(true); setUpdateStatus("idle");
                  try {
                    const info = await checkForUpdate();
                    if (info) { setUpdateInfo(info); setUpdateStatus("available"); }
                    else { setUpdateStatus("up-to-date"); }
                  } catch { setUpdateStatus("error"); }
                  setCheckingUpdate(false);
                }} disabled={checkingUpdate}
                  className="rounded-lg border px-4 py-2 text-xs hover:bg-slate-50 disabled:opacity-50">
                  {checkingUpdate ? "检查中..." : "检查更新"}
                </button>
                {updateStatus === "available" && updateInfo && (
                  <button onClick={() => {
                    if (updateInfo.releaseUrl) window.open(updateInfo.releaseUrl, "_blank");
                    markDismissed(updateInfo);
                    setUpdateStatus("up-to-date");
                  }} className="rounded-lg bg-violet-600 px-4 py-2 text-xs text-white hover:bg-violet-700">
                    下载 v{updateInfo.latestVersion}
                  </button>
                )}
                {updateStatus === "available" && updateInfo && (
                  <button onClick={() => { markDismissed(updateInfo); setUpdateStatus("up-to-date"); }}
                    className="rounded-lg border px-4 py-2 text-xs hover:bg-slate-50">暂不更新</button>
                )}
                {updateStatus === "up-to-date" && <span className="text-xs text-green-600 py-2">已是最新版本</span>}
                {updateStatus === "error" && <span className="text-xs text-red-500 py-2">检查失败</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
