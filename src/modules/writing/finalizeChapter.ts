// finalizeChapter.ts — 定稿流程（T6 拆分，从 WritingModule 内联提取）
// 返回多步结果对象，而非静默成功/失败二分

import { api } from "@/lib/api";
import { uuid } from "@/lib/uuid";
import { getJSONSync } from "@/lib/storage";
import { loadAllChapters } from "@/lib/chapter-store";
import { updateMemory, activateNextChapterTerms, activateNextChapterCharacters, createSnapshot } from "@/lib/memory-updater";
import { createBackup } from "@/lib/backup";
import { runQualityCheck } from "@/lib/quality-checker";
import { useAppStore } from "@/stores/app-store";

export interface FinalizeStep {
    name: string;
    ok: boolean;
    error?: string;
}

export interface FinalizeResult {
    ok: boolean;
    steps: FinalizeStep[];
}

async function aiExtractNewCharacters(projectId: string, chapterNumber: number, chapterContent: string) {
    try {
        let knownNames = ""; let existingEdgesStr = ""; try { const [allChars, allEdges] = await Promise.all([api.listCharacters(projectId), api.listRelationshipEdges(projectId).catch(() => [] as any[])]); knownNames = allChars.map(c => c.name).join("、"); if (allEdges.length > 0) { const charMap = new Map(allChars.map(c => [c.id, c.name])); existingEdgesStr = "\n已有关系（不要重复创建）：\n"; for (const e of allEdges) { const src = charMap.get(e.source_id) || "未知"; const tgt = charMap.get(e.target_id) || "未知"; existingEdgesStr += `· ${src} → ${tgt} [${e.relation_type}]\n`; } } } catch { }
        const charRes = await api.aiComplete({ action: "chat", entity_type: "chapter", entity_id: projectId, extra: { system_hint: `你是一个小说角色识别助手。分析章节内容，识别本章新出场的角色。\n\n已知角色列表（不要重复）：${knownNames || "（暂无）"}${existingEdgesStr || ""}\n\n格式：---CHARACTERS---\n[{action:"create_character",character:{name, faction, gender, personality, background}}, ...]\n---END_CHARACTERS---\n只识别新角色，不要重复已有角色。`, user_message: `请分析第${chapterNumber}章内容：\n\n${chapterContent.slice(0, 15000)}`, history: [] } });
        if (charRes.content && !charRes.error) { const m = charRes.content.match(/---CHARACTERS---\s*([\s\S]*?)\s*---END_CHARACTERS---/); if (!m) return; let arr: any[]; try { arr = JSON.parse(m[1]); } catch { return; } if (!Array.isArray(arr) || arr.length === 0) return; const chars = arr.filter((a: any) => a.action === "create_character" && a.character).map((a: any) => ({ name: (a.character.name || "").slice(0, 20), faction: a.character.faction || "", gender: a.character.gender, age: a.character.age, race: a.character.race, appearance: a.character.appearance, personality: a.character.personality, background: a.character.background, ability: a.character.ability, style: a.character.style, interests: a.character.interests })); const edges = arr.filter((a: any) => a.action === "create_relationship" && a.edge).map((a: any) => ({ sourceName: a.edge.sourceName, targetName: a.edge.targetName, relation_type: a.edge.relation_type || "关联", strength: a.edge.strength || 5 })); if (chars.length > 0 || edges.length > 0) { setJSONSync(`ai-pending-chars-${projectId}`, { chars, edges, timestamp: new Date().toISOString() }); useAppStore.getState().bumpPendingAiChars(); const names = chars.map((c: any) => c.name).join("、"); const edgeInfo = edges.length > 0 ? ` 和 ${edges.length} 条关系` : ""; useAppStore.getState().addChatMessage({ id: uuid(), role: "system", content: `�� AI 识别到 ${chars.length} 个新角色${edgeInfo}：${names || "（无角色名）"}。请在右侧 AI 聊天面板点击「应用到星图」确认创建。`, created_at: new Date().toISOString() }); } }
    } catch (e) { /* 角色识别失败不影响定稿 */ }
}

export async function finalizeChapter(
    pid: string,
    chapterId: string,
    chapterNumber: number,
    chapterTitle: string,
    chapterContent: string,
): Promise<FinalizeResult> {
    const steps: FinalizeStep[] = [];

    // 步骤1：生成摘要
    try {
        useAppStore.getState().setAutosaveStatus("正在生成摘要...");
        await updateMemory({ projectId: pid, chapterNumber, chapterTitle, chapterContent, characters: [] });
        useAppStore.getState().setAutosaveStatus("✅ 摘要已生成");
        steps.push({ name: "摘要生成", ok: true });
    } catch (e) {
        useAppStore.getState().setAutosaveStatus("⚠ 摘要生成失败");
        steps.push({ name: "摘要生成", ok: false, error: String(e) });
    }

    // 步骤2：激活下一章词条
    try {
        const allWorldTerms = await api.listWorldTerms(pid);
        const segs = getJSONSync(`plot-segments-${pid}`, []);
        const chaps = loadAllChapters(pid);
        const logStore = getJSONSync(`novel-workbench-log-${pid}`, {});
        const recentSummaries = (logStore as any).summaries || [];
        await activateNextChapterTerms(pid, chapterNumber, allWorldTerms.map(t => ({ id: t.id, title: t.title, one_liner: t.one_liner, term_type: t.term_type })), segs, chaps, recentSummaries.sort((a: any, b: any) => b.chapter_number - a.chapter_number).slice(0, 5));
        steps.push({ name: "词条激活", ok: true });
    } catch (e) {
        steps.push({ name: "词条激活", ok: false, error: String(e) });
    }

    // 步骤3：激活下一章角色
    try {
        await activateNextChapterCharacters(pid, chapterNumber);
        steps.push({ name: "角色激活", ok: true });
    } catch (e) {
        steps.push({ name: "角色激活", ok: false, error: String(e) });
    }

    // 步骤4：质量检查
    try {
        const qcResult = await runQualityCheck({ projectId: pid, chapterId, chapterNumber, chapterContent });
        if (!qcResult.passed) {
            const errors = qcResult.checks.filter(c => c.severity === "error");
            if (errors.length > 0) useAppStore.getState().addChatMessage({ id: uuid(), role: "system", content: `⚠️ 质量检查发现 ${errors.length} 个问题：\n${errors.map(e => `· ${e.message}`).join("\n")}`, created_at: new Date().toISOString() });
        }
        steps.push({ name: "质量检查", ok: true });
    } catch (e) {
        steps.push({ name: "质量检查", ok: false, error: String(e) });
    }

    // 步骤5：创建备份
    try {
        createBackup(pid);
        steps.push({ name: "创建备份", ok: true });
    } catch (e) {
        steps.push({ name: "创建备份", ok: false, error: String(e) });
    }

    // 步骤6：创建快照
    try {
        createSnapshot(pid, `第${chapterNumber}章「${chapterTitle}」定稿`);
        steps.push({ name: "创建快照", ok: true });
    } catch (e) {
        steps.push({ name: "创建快照", ok: false, error: String(e) });
    }

    // 步骤7：AI 角色识别（fire-and-forget，不影响定稿结果）
    try {
        aiExtractNewCharacters(pid, chapterNumber, chapterContent);
        steps.push({ name: "角色识别", ok: true });
    } catch (e) {
        steps.push({ name: "角色识别", ok: false, error: String(e) });
    }

    // 步骤8：更新项目阶段
    try {
        const proj = useAppStore.getState().currentProject;
        if (proj) {
            let ns = proj.stage;
            if (proj.stage === "framework_locked" || proj.stage === "framework_review") ns = "writing";
            if (ns === "writing") {
                const ids: string[] = getJSONSync(`chapter-index-${pid}`, []);
                const allChs = ids.map(id => getJSONSync(`chapter-${pid}-${id}`, null)).filter(Boolean);
                if (allChs.length > 0 && allChs.every((c: any) => c.content?.trim())) ns = "completed";
            }
            if (ns !== proj.stage) useAppStore.getState().setCurrentProject({ ...proj, stage: ns });
        }
        steps.push({ name: "阶段更新", ok: true });
    } catch (e) {
        steps.push({ name: "阶段更新", ok: false, error: String(e) });
    }

    useAppStore.getState().setAutosaveStatus("✅ 已定稿");
    const allOk = steps.every(s => s.ok);
    return { ok: allOk, steps };
}
