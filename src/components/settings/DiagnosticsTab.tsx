// DiagnosticsTab.tsx — 诊断日志面板（错误日志 + 操作审计 + 完整性检查）
import { useState, useCallback } from "react";
import { AlertTriangle, Activity, ShieldCheck, Download, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { getErrorLog, clearErrorLog, exportErrorLog, runDeepIntegrityCheck, runIntegrityCheck, autoFix } from "@/lib/diagnostics";
import { getAuditLog, clearAuditLog, exportAuditLog } from "@/lib/audit-log";
import type { IntegrityIssue, FixResult } from "@/lib/diagnostics";

type SubTab = "errors" | "audit" | "integrity";

export function DiagnosticsTab() {
    const [subTab, setSubTab] = useState<SubTab>("errors");
    const [integrityIssues, setIntegrityIssues] = useState<IntegrityIssue[] | null>(null);
    const [fixResults, setFixResults] = useState<FixResult[] | null>(null);
    const [checkRunning, setCheckRunning] = useState(false);
    const [fixRunning, setFixRunning] = useState(false);
    const [fixSucceeded, setFixSucceeded] = useState(false);
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

    const errors = getErrorLog();
    const audits = getAuditLog().reverse(); // 最新在前

    const handleClearErrors = () => { clearErrorLog(); window.location.reload(); };
    const handleClearAudit = () => { clearAuditLog(); window.location.reload(); };
    const handleExportErrors = async () => {
        const json = exportErrorLog();
        const blob = new Blob([json], { type: "application/json" });
        try {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const { invoke } = await import("@tauri-apps/api/core");
            const filePath = await save({
                defaultPath: `错误日志_${new Date().toISOString().slice(0, 10)}.json`,
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (!filePath) return;
            const buf = await blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            await invoke("save_export_file", { projectId: "", filename: "", dataBase64: btoa(binary), filePath });
            return;
        } catch { /* 降级到浏览器下载 */ }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `错误日志_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };
    const handleExportAudit = async () => {
        const json = exportAuditLog();
        const blob = new Blob([json], { type: "application/json" });
        try {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const { invoke } = await import("@tauri-apps/api/core");
            const filePath = await save({
                defaultPath: `操作日志_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`,
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (!filePath) return;
            const buf = await blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            await invoke("save_export_file", { projectId: "", filename: "", dataBase64: btoa(binary), filePath });
            return;
        } catch { /* 降级到浏览器下载 */ }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `操作日志_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleIntegrityCheck = useCallback(() => {
        setCheckRunning(true);
        setFixSucceeded(false);
        // 用 setTimeout 让 UI 有机会更新
        setTimeout(() => {
            runDeepIntegrityCheck()
                .then((issues) => setIntegrityIssues(issues))
                .catch((e) => setIntegrityIssues([{
                    type: "check-failed",
                    severity: "error",
                    message: `完整性检查失败: ${e instanceof Error ? e.message : String(e)}`,
                }]))
                .finally(() => setCheckRunning(false));
        }, 100);
    }, []);

    const severityDot = (s: string) => s === "error" ? "bg-red-500" : "bg-amber-400";

    const totalBytes = (() => {
        let b = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) b += (localStorage.getItem(k) || "").length * 2;
        }
        return (b / (1024 * 1024)).toFixed(2);
    })();

    const auditStats = (() => {
        const logs = getAuditLog();
        const failed = logs.filter(e => !e.ok).length;
        return { total: logs.length, failed };
    })();

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">诊断日志</h3>

            {/* 统计摘要 */}
            <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>{errors.length} 个错误</span>
                <span>{auditStats.total} 条操作记录 · {auditStats.failed} 失败</span>
                <span>存储 {totalBytes}MB</span>
            </div>

            {/* 子标签 */}
            <div className="flex border-b border-slate-200">
                {([
                    { id: "errors" as SubTab, icon: AlertTriangle, label: `错误日志 (${errors.length})` },
                    { id: "audit" as SubTab, icon: Activity, label: `操作日志 (${auditStats.total})` },
                    { id: "integrity" as SubTab, icon: ShieldCheck, label: "完整性检查" },
                ]).map(t => (
                    <button key={t.id} onClick={() => setSubTab(t.id)}
                        className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-medium transition-colors ${subTab === t.id ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:border-slate-300"}`}>
                        <t.icon className="h-3.5 w-3.5" />{t.label}
                    </button>
                ))}
            </div>

            {/* 错误日志 */}
            {subTab === "errors" && (
                <div>
                    {errors.length > 0 && (
                        <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 border-b border-slate-100 bg-white/95 py-2 backdrop-blur">
                            <button onClick={handleExportErrors}
                                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs text-violet-600 hover:bg-violet-50">
                                <Download className="h-3 w-3" />导出错误日志
                            </button>
                            <button onClick={handleClearErrors}
                                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">
                                <Trash2 className="h-3 w-3" />清除错误日志
                            </button>
                        </div>
                    )}
                    {errors.length === 0 && <p className="text-xs text-slate-400 py-4">暂无错误记录</p>}
                    {errors.slice().reverse().map((e, i) => (
                        <div key={i} className="mb-1.5 rounded border border-slate-100 bg-white p-2.5">
                            <div className="flex items-center gap-2">
                                <span className={`h-1.5 w-1.5 rounded-full ${e.level === "error" ? "bg-red-500" : "bg-amber-400"}`} />
                                <span className="text-[10px] text-slate-400">{e.timestamp?.slice(11, 19) || ""}</span>
                                <span className="text-[10px] font-medium text-slate-500">[{e.source}]</span>
                                <span className="text-xs text-slate-700 truncate flex-1">{e.message}</span>
                                <button onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                                    className="text-slate-400 hover:text-slate-600">
                                    {expandedIdx === i ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                </button>
                            </div>
                            {expandedIdx === i && !!e.details && (
                                <pre className="mt-1.5 text-[10px] text-slate-500 bg-slate-50 rounded p-1.5 overflow-x-auto max-h-24">
                                    {typeof e.details === "string" ? e.details : JSON.stringify(e.details, null, 2)}
                                </pre>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 操作日志 */}
            {subTab === "audit" && (
                <div>
                    {audits.length > 0 && (
                        <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 border-b border-slate-100 bg-white/95 py-2 backdrop-blur">
                            <button onClick={handleExportAudit}
                                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs text-violet-600 hover:bg-violet-50">
                                <Download className="h-3 w-3" />导出操作日志
                            </button>
                            <button onClick={handleClearAudit}
                                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">
                                <Trash2 className="h-3 w-3" />清除
                            </button>
                        </div>
                    )}
                    {audits.length === 0 && <p className="text-xs text-slate-400 py-4">暂无操作记录</p>}
                    {audits.map((e, i) => {
                        const triggeredLabel = e.triggeredBy === "user" ? "用户操作" : e.triggeredBy === "import" ? "导入" : "系统";
                        return (
                            <div key={i} className={`mb-1 rounded border px-2.5 py-1.5 text-xs flex items-center gap-2 ${e.ok ? "border-slate-100 bg-white" : "border-orange-100 bg-orange-50"}`}>
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${e.ok ? "bg-emerald-400" : "bg-orange-400"}`} />
                                <span className="text-[10px] text-slate-400 w-14 shrink-0">{e.timestamp?.slice(11, 19) || ""}</span>
                                <span className="font-medium text-slate-600 shrink-0 max-w-32 truncate">{e.summary || e.action}</span>
                                <span className="text-slate-500 truncate flex-1">{e.summary ? e.action : ""}</span>
                                <span className="text-[10px] text-slate-400 shrink-0">{triggeredLabel}</span>
                                {!e.ok && <span className="text-[10px] text-orange-500 shrink-0" title="查看错误详情">⚠ 失败</span>}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 完整性检查 */}
            {subTab === "integrity" && (
                <div>
                    <p className="text-xs text-slate-400 mb-3">扫描本地缓存、SQLite 主数据引用、分组引用和细纲序号，不消耗 AI 额度</p>
                    <div className="flex items-center gap-2">
                        <button onClick={handleIntegrityCheck} disabled={checkRunning}
                            className="flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-xs text-white hover:bg-violet-700 disabled:opacity-50">
                            <ShieldCheck className="h-3.5 w-3.5" />{checkRunning ? "检查中..." : "运行完整性检查"}
                        </button>
                        <button onClick={() => {
                            const issues = integrityIssues || [];
                            const fixable = issues.filter(i => i.fixContext);
                            setFixRunning(true);
                            setTimeout(async () => {
                                const results = await autoFix(fixable);
                                setFixResults(results);
                                setFixRunning(false);
                                if (results.every(r => r.ok)) setFixSucceeded(true);
                                else setFixSucceeded(false);
                                setTimeout(() => setIntegrityIssues(runIntegrityCheck()), 100);
                            }, 100);
                        }} disabled={fixRunning || integrityIssues === null || integrityIssues.length === 0 || fixSucceeded}
                            className={`flex items-center gap-2 rounded-md px-4 py-2 text-xs text-white transition-colors disabled:opacity-60 ${fixSucceeded ? "bg-emerald-600"
                                : integrityIssues !== null && integrityIssues.length > 0 ? "bg-red-600 hover:bg-red-700"
                                    : "bg-slate-400 cursor-not-allowed"
                                }`}
                            title="自动修复可修复的数据问题（如孤儿索引、悬空边等）">
                            <ShieldCheck className="h-3.5 w-3.5" />{fixRunning ? "修复中..." : "一键修复"}
                        </button>
                    </div>

                    {fixResults && (
                        <div className="mt-3">
                            <p className="text-xs font-medium text-slate-600 mb-1">修复结果</p>
                            {fixResults.map((r, i) => (
                                <div key={i} className={`mb-1 rounded border px-2.5 py-1.5 text-xs ${r.ok ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-red-100 bg-red-50 text-red-700"}`}>
                                    {r.ok ? "✅" : "❌"} {r.message}
                                </div>
                            ))}
                        </div>
                    )}

                    {integrityIssues !== null && (
                        <div className="mt-3">
                            {integrityIssues.length === 0 ? (
                                <p className="text-xs text-emerald-600 py-2">✅ 数据完整性检查通过，未发现问题</p>
                            ) : (
                                <>
                                    <p className="text-xs text-slate-600 mb-2">
                                        发现 {integrityIssues.filter(i => i.severity === "error").length} 个错误，
                                        {integrityIssues.filter(i => i.severity === "warning").length} 个警告
                                    </p>
                                    {integrityIssues.map((issue, i) => (
                                        <div key={i} className={`mb-1 rounded border px-2.5 py-1.5 text-xs flex items-start gap-2 ${issue.severity === "error" ? "border-red-100 bg-red-50" : "border-amber-100 bg-amber-50"}`}>
                                            <span className={`h-1.5 w-1.5 rounded-full mt-1 shrink-0 ${severityDot(issue.severity)}`} />
                                            <div>
                                                <span className={`font-medium ${issue.severity === "error" ? "text-red-700" : "text-amber-700"}`}>[{issue.type}]</span>
                                                <span className="text-slate-600 ml-1">{issue.message}</span>
                                                {issue.key && <span className="block text-[10px] text-slate-400 mt-0.5">key: {issue.key}</span>}
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
