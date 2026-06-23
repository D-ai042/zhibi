// DataMigrateTab.tsx — 数据导入导出标签页（T9）
import { useState, useCallback } from "react";
import { Download, Upload, FileDown } from "lucide-react";
import { getSync, setSync } from "@/lib/storage";
import { useAppStore } from "@/stores/app-store";

interface ImportResult {
    ok: boolean;
    imported: string[];
    skipped: string[];
    errors: string[];
}

/** 判断一个 key 是否属于指定项目 */
function keyBelongsToProject(key: string, pid: string): boolean {
    if (key === "novel-workbench-mock") return true;
    return key.includes(pid);
}

export function DataMigrateTab() {
    const { currentProject } = useAppStore();
    const pid = currentProject?.id;
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [msg, setMsg] = useState("");
    const [importMode, setImportMode] = useState<"overwrite" | "skip" | "merge">("overwrite");
    const [importResult, setImportResult] = useState<ImportResult | null>(null);

    /** 核心导出逻辑：收集指定前缀的 keys → JSON → Blob → download */
    const doExport = useCallback((label: string, keyFilter: (k: string) => boolean) => {
        setExporting(true); setMsg("");
        try {
            const collected: { key: string; value: string }[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (!keyFilter(key)) continue;
                const value = getSync(key);
                if (value !== null) collected.push({ key, value });
            }
            const data = { version: "2.0", exportedAt: new Date().toISOString(), keys: collected };
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${label}_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setMsg(`✅ ${label}已导出（${collected.length} 条）`); setTimeout(() => setMsg(""), 2500);
        } catch (e) { setMsg(`❌ 导出失败：${e}`); }
        setExporting(false);
    }, []);

    /** 导出全部数据（所有 localStorage keys） */
    const handleExportAll = useCallback(() => doExport("全部数据备份", () => true), [doExport]);

    /** 导出当前项目（只含当前 projectId 的 key） */
    const handleExportProject = useCallback(() => {
        if (!pid) { setMsg("⚠️ 请先打开一个项目"); setTimeout(() => setMsg(""), 2000); return; }
        doExport(`项目「${currentProject?.name || pid}」`, k => keyBelongsToProject(k, pid));
    }, [pid, currentProject, doExport]);

    const handleImport = useCallback(async (file: File) => {
        setImporting(true); setImportResult(null);
        const result: ImportResult = { ok: true, imported: [], skipped: [], errors: [] };
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const entries: { key: string; value: string }[] = data.keys || [];
            for (const { key, value } of entries) {
                if (importMode === "skip") {
                    const existing = getSync(key);
                    if (existing) { result.skipped.push(key); continue; }
                }
                try {
                    // ★ value 已是 JSON 字符串，直接用 setSync 原样写入，避免 setJSONSync 的二次 stringify
                    setSync(key, value);
                    result.imported.push(key);
                } catch (e) {
                    result.errors.push(`${key}: ${e}`);
                }
            }
            // ★ 导入成功后刷新项目数据
            if (result.imported.length > 0) {
                useAppStore.getState().bumpSaveAll();
                // 延迟刷新页面，确保 setJSONSync 的异步 SQLite 同步完成
                setTimeout(() => window.location.reload(), 600);
            }
        } catch (e) {
            result.ok = false;
            result.errors.push(`文件解析失败: ${e}`);
        }
        setImportResult(result);
        setImporting(false);
    }, [importMode, pid]);

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">数据迁移</h3>

            {/* 导出 */}
            <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">导出数据</h4>
                <p className="text-xs text-slate-400 mb-3">导出为 JSON 文件，可在其他设备上导入</p>
                <div className="flex items-center gap-2">
                    <button onClick={handleExportProject} disabled={exporting || !pid}
                        className="flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                        title="仅导出当前项目的数据">
                        <FileDown className="h-4 w-4" />{exporting ? "导出中..." : "导出当前项目"}
                    </button>
                    <button onClick={handleExportAll} disabled={exporting}
                        className="flex items-center gap-2 rounded-md border border-violet-300 px-4 py-2 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        title="导出所有项目的数据">
                        <Download className="h-4 w-4" />{exporting ? "导出中..." : "导出全部数据"}
                    </button>
                </div>
            </div>

            {/* 导入 */}
            <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">导入数据</h4>
                <p className="text-xs text-slate-400 mb-3">导入之前导出的 JSON 备份文件，导入后会自动刷新数据</p>
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-slate-500">冲突处理：</span>
                    {(["overwrite", "skip", "merge"] as const).map(m => (
                        <button key={m} onClick={() => setImportMode(m)}
                            className={`rounded px-3 py-1 text-xs ${importMode === m ? "bg-violet-600 text-white" : "border text-slate-600 hover:bg-slate-50"}`}>
                            {{ overwrite: "覆盖", skip: "跳过", merge: "合并" }[m]}
                        </button>
                    ))}
                </div>
                <label className="flex items-center gap-2 rounded-md border-2 border-dashed border-slate-300 p-6 text-center cursor-pointer hover:border-violet-400">
                    <Upload className="h-5 w-5 text-slate-400" />
                    <span className="text-sm text-slate-500">{importing ? "导入中..." : "点击选择 JSON 文件"}</span>
                    <input type="file" accept=".json" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
                </label>
                {importResult && (
                    <div className={`mt-3 rounded p-2 text-xs ${importResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                        导入 {importResult.imported.length} 项，跳过 {importResult.skipped.length} 项
                        {importResult.errors.length > 0 && <span className="text-red-500">，{importResult.errors.length} 个错误</span>}
                    </div>
                )}
            </div>

            {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
    );
}
