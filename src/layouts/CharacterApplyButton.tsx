// CharacterApplyButton.tsx — 「应用到星图」按钮（T7：从 AiChatPanel.tsx 提取）
import { usePendingCharacters } from "./usePendingCharacters";

export function CharacterApplyButton({ pid }: { pid: string }) {
    const { pendingChars, pendingEdges, pendingSnapshots, applyAll, clearPending } = usePendingCharacters(pid);

    const total = pendingChars.length + pendingEdges.length + pendingSnapshots.length;
    if (total === 0) return null;

    return (
        <div className="character-apply-bar flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs">
            <span className="text-amber-700">AI 建议：</span>
            {pendingChars.length > 0 && <span className="text-amber-600">{pendingChars.length} 个角色</span>}
            {pendingEdges.length > 0 && <span className="text-amber-600">{pendingEdges.length} 条关系</span>}
            {pendingSnapshots.length > 0 && <span className="text-amber-600">{pendingSnapshots.length} 个快照</span>}
            <button onClick={async () => {
                if (confirm(`确定将 ${total} 项应用到星图？`)) {
                    await applyAll();
                }
            }}
                className="ml-auto rounded-md bg-amber-500 px-3 py-1 text-white hover:bg-amber-600">
                应用到星图
            </button>
            <button onClick={clearPending}
                className="rounded-md border px-2 py-1 text-slate-500 hover:bg-slate-50">
                忽略
            </button>
        </div>
    );
}
