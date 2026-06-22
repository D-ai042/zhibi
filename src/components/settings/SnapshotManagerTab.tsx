/**
 * T9 拆分 — 快照管理 Tab
 */
import { useEffect, useState, useCallback } from "react";
import { History, RotateCcw, AlertTriangle, Trash2 } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { listSnapshots, restoreSnapshot, createSnapshot, deleteSnapshot } from "@/lib/memory-updater";

export function SnapshotManagerTab() {
    const { currentProject } = useAppStore();
    const [snaps, setSnaps] = useState<{ id: string; label: string; timestamp: string }[]>([]);
    const [restoreMsg, setRestoreMsg] = useState("");
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    useEffect(() => {
        if (currentProject) {
            setSnaps(listSnapshots(currentProject.id));
        }
    }, [currentProject]);

    const handleCreate = useCallback(async () => {
        if (!currentProject) return;
        const label = `手动快照 ${new Date().toLocaleString("zh-CN")}`;
        await createSnapshot(currentProject.id, label);
        setSnaps(listSnapshots(currentProject.id));
        setRestoreMsg("✅ 快照已创建");
        setTimeout(() => setRestoreMsg(""), 2000);
    }, [currentProject]);

    const handleRestore = useCallback((snapId: string) => {
        if (!currentProject) return;
        setConfirmId(snapId);
    }, [currentProject]);

    const handleDelete = useCallback((snapId: string) => {
        setDeleteConfirmId(snapId);
    }, []);

    const confirmDelete = useCallback(() => {
        if (!currentProject || !deleteConfirmId) return;
        const ok = deleteSnapshot(currentProject.id, deleteConfirmId);
        if (ok) {
            setSnaps(listSnapshots(currentProject.id));
            setRestoreMsg("✅ 快照已删除");
        } else {
            setRestoreMsg("❌ 删除失败");
        }
        setDeleteConfirmId(null);
        setTimeout(() => setRestoreMsg(""), 3000);
    }, [currentProject, deleteConfirmId]);

    const confirmRestore = useCallback(() => {
        if (!currentProject || !confirmId) return;
        const ok = restoreSnapshot(currentProject.id, confirmId);
        if (ok) {
            setRestoreMsg("✅ 已回退到该快照");
            setConfirmId(null);
        } else {
            setRestoreMsg("❌ 回退失败");
        }
        setTimeout(() => setRestoreMsg(""), 3000);
    }, [currentProject, confirmId]);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">快照记录了某个时间点所有章节摘要、角色状态和故事线进度。回退后可撤销。</p>
                <button type="button" onClick={handleCreate}
                    className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700">
                    <RotateCcw size={13} />
                    创建快照
                </button>
            </div>

            {snaps.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">暂无快照。定稿章节时会自动创建快照，也可手动创建。</p>
            ) : (
                <div className="space-y-1">
                    {[...snaps].reverse().map(snap => (
                        <div key={snap.id} className="flex items-center justify-between rounded-lg border bg-white px-3 py-2.5">
                            <div>
                                <p className="text-sm font-medium text-slate-700">{snap.label}</p>
                                <p className="text-xs text-slate-400">{new Date(snap.timestamp).toLocaleString("zh-CN")}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {deleteConfirmId === snap.id ? (
                                    <>
                                        <span className="text-xs text-red-600">确认删除？</span>
                                        <button type="button" onClick={confirmDelete}
                                            className="rounded-md bg-red-500 px-2 py-0.5 text-xs text-white hover:bg-red-600">确认</button>
                                        <button type="button" onClick={() => setDeleteConfirmId(null)}
                                            className="rounded-md border px-2 py-0.5 text-xs hover:bg-slate-50">取消</button>
                                    </>
                                ) : confirmId === snap.id ? (
                                    <>
                                        <button type="button" onClick={confirmRestore}
                                            className="rounded-md bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600">确认回退</button>
                                        <button type="button" onClick={() => setConfirmId(null)}
                                            className="rounded-md border px-3 py-1 text-xs hover:bg-slate-50">取消</button>
                                    </>
                                ) : (
                                    <>
                                        <button type="button" onClick={() => handleRestore(snap.id)}
                                            className="flex items-center gap-1 rounded-md border px-3 py-1 text-xs text-slate-600 hover:bg-amber-50 hover:border-amber-200">
                                            <History size={12} />回退
                                        </button>
                                        <button type="button" onClick={() => handleDelete(snap.id)}
                                            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:border-red-200">
                                            <Trash2 size={12} />
                                        </button>
                                    </>)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {restoreMsg && (
                <div className={`rounded-lg px-3 py-2 text-xs ${restoreMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    <div className="flex items-center gap-1.5">
                        {restoreMsg.startsWith("❌") && <AlertTriangle size={13} />}
                        {restoreMsg}
                    </div>
                </div>
            )}
        </div>
    );
}
