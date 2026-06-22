// finalizeChapter.ts — 多步定稿流程（T6：R6 G6.5）
import { saveChapter, type Chapter } from "@/lib/chapter-store";
import { updateMemory } from "@/lib/memory-updater";
import { createBackup } from "@/lib/backup";
import { createSnapshot } from "@/lib/memory-updater";

export interface FinalizeStep {
    name: string;
    ok: boolean;
    error?: string;
}

export interface FinalizeResult {
    ok: boolean;
    steps: FinalizeStep[];
}

export async function finalizeChapter(
    pid: string,
    chapter: Chapter,
    options?: { skipBackup?: boolean; skipSnapshot?: boolean }
): Promise<FinalizeResult> {
    const steps: FinalizeStep[] = [];

    // 步骤 1：保存章节
    const saveResult = saveChapter(pid, chapter);
    steps.push({ name: "保存章节", ...saveResult });
    if (!saveResult.ok) return { ok: false, steps };

    // 步骤 2：生成摘要/记忆
    try {
        await updateMemory(pid, chapter);
        steps.push({ name: "更新记忆", ok: true });
    } catch (e) {
        steps.push({ name: "更新记忆", ok: false, error: String(e) });
    }

    // 步骤 3：创建备份
    if (!options?.skipBackup) {
        try {
            await createBackup(pid);
            steps.push({ name: "创建备份", ok: true });
        } catch (e) {
            steps.push({ name: "创建备份", ok: false, error: String(e) });
        }
    }

    // 步骤 4：创建快照
    if (!options?.skipSnapshot) {
        try {
            await createSnapshot(pid, chapter.number);
            steps.push({ name: "创建快照", ok: true });
        } catch (e) {
            steps.push({ name: "创建快照", ok: false, error: String(e) });
        }
    }

    const allOk = steps.every(s => s.ok);
    return { ok: allOk, steps };
}
