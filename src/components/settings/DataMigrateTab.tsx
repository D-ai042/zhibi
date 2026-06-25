// DataMigrateTab.tsx — 数据导入导出标签页（T9）
import { useState, useCallback } from "react";
import { Download, Upload, FileDown, AlertTriangle } from "lucide-react";
import { getSync, getJSONSync } from "@/lib/storage";
import { useAppStore } from "@/stores/app-store";
import { runIntegrityCheck } from "@/lib/diagnostics";
import { migrateImport } from "@/lib/data-migrate";
import { clearMockStoreCache } from "@/lib/mock-backend";

interface ImportResult {
    ok: boolean;
    skipped: string[];
    errors: string[];
    warnings: string[];
    /** 迁移统计 */
    projectsFound: number;
    chaptersMigrated: number;
    charactersMigrated: number;
    worldTermsMigrated: number;
    edgesMigrated: number;
    volumesMigrated: number;
    keysWritten: number;
}

export function DataMigrateTab() {
    const { currentProject } = useAppStore();
    const pid = currentProject?.id;
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [msg, setMsg] = useState("");
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [importCheckIssues, setImportCheckIssues] = useState<number>(0);


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

    /** 导出当前项目（只含当前 projectId 的 key + 从 mock 中提取的项目数据） */
    const handleExportProject = useCallback(() => {
        if (!pid) { setMsg("⚠️ 请先打开一个项目"); setTimeout(() => setMsg(""), 2000); return; }
        setExporting(true); setMsg("");
        try {
            const collected: { key: string; value: string }[] = [];
            // 1. 收集所有属于当前项目的分片 key
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || key === "novel-workbench-mock") continue; // 全局 key 单独处理
                if (!key.includes(pid)) continue;
                const value = getSync(key);
                if (value !== null) collected.push({ key, value });
            }
            // 2. 从 novel-workbench-mock 中提取当前项目的数据
            const mock = getJSONSync("novel-workbench-mock", {} as any);
            if (mock && typeof mock === "object") {
                const projSlice: any = {
                    projects: (mock.projects || []).filter((p: any) => p.id === pid),
                    worldTerms: (mock.worldTerms || []).filter((t: any) => t.project_id === pid),
                    characters: (mock.characters || []).filter((c: any) => c.project_id === pid),
                    edges: (mock.edges || []).filter((e: any) => e.project_id === pid),
                    volumes: (mock.volumes || []).filter((v: any) => v.project_id === pid),
                };
                // 收集被引用到的章节
                const volIds = new Set((projSlice.volumes || []).map((v: any) => v.id));
                projSlice.chapters = (mock.chapters || []).filter((c: any) => volIds.has(c.volume_id));
                const chIds = new Set((projSlice.chapters || []).map((c: any) => c.id));
                projSlice.beatCards = (mock.beatCards || []).filter((b: any) => chIds.has(b.chapter_id));
                projSlice.chapterContents = (mock.chapterContents || []).filter((c: any) => chIds.has(c.chapter_id));
                projSlice.plotEvents = (mock.plotEvents || []).filter((e: any) => e.project_id === pid);
                projSlice.timelineNodes = (mock.timelineNodes || []).filter((n: any) => n.project_id === pid);
                projSlice.lockedFields = (mock.lockedFields || []);
                projSlice.currentProjectId = pid;
                collected.push({ key: "novel-workbench-mock", value: JSON.stringify(projSlice) });
            }
            const data = { version: "2.0", exportedAt: new Date().toISOString(), pid, keys: collected };
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `项目「${currentProject?.name || pid}」_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setMsg(`✅ 项目已导出（${collected.length} 条）`); setTimeout(() => setMsg(""), 2500);
        } catch (e) { setMsg(`❌ 导出失败：${e}`); }
        setExporting(false);
    }, [pid, currentProject]);

    const handleImport = useCallback(async (file: File) => {
        setImporting(true); setImportResult(null); setImportCheckIssues(0);
        const result: ImportResult = {
            ok: true, skipped: [], errors: [], warnings: [],
            projectsFound: 0, chaptersMigrated: 0, charactersMigrated: 0,
            worldTermsMigrated: 0, edgesMigrated: 0, volumesMigrated: 0, keysWritten: 0,
        };
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            let entries: { key: string; value: string }[] = data.keys || [];

            if (entries.length === 0) {
                result.errors.push("文件中没有可导入的数据");
                result.ok = false;
                setImportResult(result);
                setImporting(false);
                return;
            }

            // ★ 新版导出格式: 从 projectsData 中提取项目并注入到 mock store
            const projectsData = data.projectsData as any[] | undefined;
            if (projectsData && projectsData.length > 0) {
                let injectCount = 0;
                entries = entries.map(e => {
                    if (e.key !== "novel-workbench-mock") return e;
                    try {
                        const mock = JSON.parse(e.value);
                        if (!mock.projects) mock.projects = [];
                        for (const pd of projectsData) {
                            if (!pd.project) continue;
                            const proj = pd.project;
                            if (mock.projects.find((p: any) => p.id === proj.id)) continue;
                            mock.projects.push(proj);
                            injectCount++;
                            // 也注入各数组
                            if (pd.characters) { if (!mock.characters) mock.characters = []; for (const c of pd.characters) { if (!mock.characters.find((x: any) => x.id === c.id)) mock.characters.push(c); } }
                            if (pd.worldTerms) { if (!mock.worldTerms) mock.worldTerms = []; for (const t of pd.worldTerms) { if (!mock.worldTerms.find((x: any) => x.id === t.id)) mock.worldTerms.push(t); } }
                            if (pd.relationships) { if (!mock.edges) mock.edges = []; for (const r of pd.relationships) { if (!mock.edges.find((x: any) => x.id === r.id)) mock.edges.push(r); } }
                            if (pd.volumes) { if (!mock.volumes) mock.volumes = []; for (const v of pd.volumes) { if (!mock.volumes.find((x: any) => x.id === v.id)) mock.volumes.push(v); } }
                            if (pd.characterEdges || pd.plotEdges) {
                                const extraEdges = [...(pd.characterEdges || []), ...(pd.plotEdges || [])];
                                if (!mock.edges) mock.edges = [];
                                for (const e of extraEdges) { if (!mock.edges.find((x: any) => x.id === e.id)) mock.edges.push(e); }
                            }
                            if (pd.worldviewEdges) {
                                // worldview edges are stored separately in worldview-edges-{pid}
                                const weKey = `worldview-edges-${proj.id}`;
                                if (!entries.find(x => x.key === weKey)) {
                                    entries.push({ key: weKey, value: JSON.stringify(pd.worldviewEdges) });
                                }
                            }
                        }
                        if (injectCount > 0) result.warnings.push(`从 projectsData 注入了 ${injectCount} 个项目的完整数据`);
                        return { key: e.key, value: JSON.stringify(mock) };
                    } catch { return e; }
                });
                // 也注入 plotSegments / plotEdges 等
                for (const pd of projectsData) {
                    if (!pd.project) continue;
                    const pid = pd.project.id;
                    if (pd.plotSegments) {
                        const sk = `plot-segments-${pid}`;
                        if (!entries.find(e => e.key === sk)) entries.push({ key: sk, value: JSON.stringify(pd.plotSegments) });
                    }
                    if (pd.plotEdges) {
                        const ek = `plot-edges-${pid}`;
                        if (!entries.find(e => e.key === ek)) entries.push({ key: ek, value: JSON.stringify(pd.plotEdges) });
                    }
                    if (pd.worldviewGroups) {
                        const gk = `worldview-groups-${pid}`;
                        if (!entries.find(e => e.key === gk)) entries.push({ key: gk, value: JSON.stringify(pd.worldviewGroups) });
                    }
                    if (pd.charGroups) {
                        const ck = `char-groups-${pid}`;
                        if (!entries.find(e => e.key === ck)) entries.push({ key: ck, value: JSON.stringify(pd.charGroups) });
                    }
                    if (pd.chapterShards) {
                        for (const [chId, chData] of Object.entries(pd.chapterShards as Record<string, any>)) {
                            const chk = `chapter-${pid}-${chId}`;
                            if (!entries.find(e => e.key === chk)) entries.push({ key: chk, value: JSON.stringify(chData) });
                        }
                    }
                    if (pd.chapterIndex) {
                        const cik = `chapter-index-${pid}`;
                        if (!entries.find(e => e.key === cik)) entries.push({ key: cik, value: JSON.stringify(pd.chapterIndex) });
                    }
                }
            }

            // ★ 用迁移引擎处理
            const migResult = migrateImport(entries);
            result.projectsFound = migResult.projectsFound;
            result.chaptersMigrated = migResult.chaptersMigrated;
            result.charactersMigrated = migResult.charactersMigrated;
            result.worldTermsMigrated = migResult.worldTermsMigrated;
            result.edgesMigrated = migResult.edgesMigrated;
            result.volumesMigrated = migResult.volumesMigrated;
            result.keysWritten = migResult.keysWritten.length;
            result.errors.push(...migResult.errors);

            // ★ 导入后完整性检查
            if (result.keysWritten > 0 || result.chaptersMigrated > 0) {
                const issues = runIntegrityCheck();
                const errCount = issues.filter(i => i.severity === "error").length;
                setImportCheckIssues(errCount);
                if (errCount > 0) result.warnings.push(`导入后完整性检查发现 ${errCount} 个错误（请在诊断日志中查看详情）`);
            }

            // ★ 刷新
            if (result.keysWritten > 0 || result.chaptersMigrated > 0 || result.charactersMigrated > 0) {
                useAppStore.getState().bumpSaveAll();
                clearMockStoreCache();
                setTimeout(() => window.location.reload(), 1000);
            }
        } catch (e) {
            result.ok = false;
            result.errors.push(`文件解析失败: ${e}`);
        }
        setImportResult(result);
        setImporting(false);
    }, []);

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
                <p className="text-xs text-slate-400 mb-3">支持导入新版或旧版 JSON 备份文件，自动识别格式并迁移</p>
                <label className="flex items-center gap-2 rounded-md border-2 border-dashed border-slate-300 p-6 text-center cursor-pointer hover:border-violet-400">
                    <Upload className="h-5 w-5 text-slate-400" />
                    <span className="text-sm text-slate-500">{importing ? "导入中..." : "点击选择 JSON 文件"}</span>
                    <input type="file" accept=".json" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
                </label>
                {importResult && (
                    <div className="mt-3 space-y-1">
                        <div className={`rounded p-2 text-xs ${importResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                            {importResult.chaptersMigrated > 0 || importResult.charactersMigrated > 0 ? (
                                <>
                                    迁移完成：{importResult.projectsFound} 个项目
                                    {importResult.charactersMigrated > 0 && ` | ${importResult.charactersMigrated} 个角色`}
                                    {importResult.worldTermsMigrated > 0 && ` | ${importResult.worldTermsMigrated} 个词条`}
                                    {importResult.edgesMigrated > 0 && ` | ${importResult.edgesMigrated} 条关系`}
                                    {importResult.chaptersMigrated > 0 && ` | ${importResult.chaptersMigrated} 个章节`}
                                </>
                            ) : (
                                <>已写入 {importResult.keysWritten} 个数据项，跳过 {importResult.skipped.length} 项</>
                            )}
                            {importResult.errors.length > 0 && <span className="text-red-500 ml-1">，{importResult.errors.length} 个错误</span>}
                        </div>
                        {importResult.warnings.length > 0 && (
                            <div className="rounded p-2 text-xs bg-amber-50 text-amber-700">
                                {importResult.warnings.map((w, i) => (
                                    <div key={i} className="flex items-start gap-1">
                                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                        <span>{w}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {importCheckIssues > 0 && (
                            <div className="rounded p-2 text-xs bg-red-50 text-red-700">
                                ⚠️ 导入后完整性检查发现 {importCheckIssues} 个数据错误，请到「设置 → 诊断日志 → 完整性检查」查看详情
                            </div>
                        )}
                    </div>
                )}
            </div>

            {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
    );
}
