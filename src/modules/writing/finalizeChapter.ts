// finalizeChapter.ts — 定稿流程（T6 拆分，从 WritingModule 内联提取）
// 返回多步结果对象，而非静默成功/失败二分
//
// 设计原则：
// - 质检与定稿解耦：质检不在定稿流程内，由 ChapterEditor 独立触发
// - 步骤原子化：每个步骤是独立函数，可单独重试
// - 前置校验：定稿前检查存在 fresh 质检结果且无未忽略 error
// - 失败不阻塞：单步失败不影响后续步骤，由调用方决定是否重试

import { api } from "@/lib/api";
import { uuid } from "@/lib/uuid";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { loadAllChapters } from "@/lib/chapter-store";
import { updateMemory, activateNextChapterTerms, activateNextChapterCharacters, createSnapshot } from "@/lib/memory-updater";
import { createBackup } from "@/lib/backup";
import { getStoredQualityCheck, checkItemKey, simpleHash } from "@/lib/quality-checker";
import { classifyAiError, type FinalizeStepKey, type AiErrorType } from "@/lib/ai-error-classifier";
import { useAppStore } from "@/stores/app-store";

export interface FinalizeStep {
    name: string;
    ok: boolean;
    error?: string;
    /** 步骤 key，用于精确重试 */
    key: FinalizeStepKey;
    /** 错误分类，决定修复策略 */
    errorType?: AiErrorType;
    /** 失败时的 AI 原始返回，便于诊断 */
    rawResponse?: string;
    /** 步骤耗时(ms) */
    durationMs?: number;
}

export interface FinalizeResult {
    ok: boolean;
    steps: FinalizeStep[];
}

/** 定稿上下文（步骤函数共享） */
export interface FinalizeContext {
    pid: string;
    chapterId: string;
    chapterNumber: number;
    chapterTitle: string;
    chapterContent: string;
}

async function aiExtractNewCharacters(projectId: string, chapterNumber: number, chapterContent: string) {
    try {
        let knownNames = ""; let existingEdgesStr = ""; try { const [allChars, allEdges] = await Promise.all([api.listCharacters(projectId), api.listRelationshipEdges(projectId).catch(() => [] as any[])]); knownNames = allChars.map(c => c.name).join("、"); if (allEdges.length > 0) { const charMap = new Map(allChars.map(c => [c.id, c.name])); existingEdgesStr = "\n已有关系（不要重复创建）：\n"; for (const e of allEdges) { const src = charMap.get(e.source_id) || "未知"; const tgt = charMap.get(e.target_id) || "未知"; existingEdgesStr += `· ${src} → ${tgt} [${e.relation_type}]\n`; } } } catch { }
        const charRes = await api.aiComplete({ action: "chat", entity_type: "chapter", entity_id: projectId, extra: { system_hint: `你是一个小说角色识别助手。分析章节内容，识别本章新出场的角色。\n\n已知角色列表（不要重复）：${knownNames || "（暂无）"}${existingEdgesStr || ""}\n\n格式：---CHARACTERS---\n[{action:"create_character",character:{name, faction, gender, personality, background}}, ...]\n---END_CHARACTERS---\n只识别新角色，不要重复已有角色。`, user_message: `请分析第${chapterNumber}章内容：\n\n${chapterContent.slice(0, 15000)}`, history: [] } });
        if (charRes.content && !charRes.error) { const m = charRes.content.match(/---CHARACTERS---\s*([\s\S]*?)\s*---END_CHARACTERS---/); if (!m) return; let arr: any[]; try { arr = JSON.parse(m[1]); } catch { return; } if (!Array.isArray(arr) || arr.length === 0) return; const chars = arr.filter((a: any) => a.action === "create_character" && a.character).map((a: any) => ({ name: (a.character.name || "").slice(0, 20), faction: a.character.faction || "", gender: a.character.gender, age: a.character.age, race: a.character.race, appearance: a.character.appearance, personality: a.character.personality, background: a.character.background, ability: a.character.ability, style: a.character.style, interests: a.character.interests })); const edges = arr.filter((a: any) => a.action === "create_relationship" && a.edge).map((a: any) => ({ sourceName: a.edge.sourceName, targetName: a.edge.targetName, relation_type: a.edge.relation_type || "关联", strength: a.edge.strength || 5 })); if (chars.length > 0 || edges.length > 0) { setJSONSync(`ai-pending-chars-${projectId}`, { chars, edges, timestamp: new Date().toISOString() }); useAppStore.getState().bumpPendingAiChars(); const names = chars.map((c: any) => c.name).join("、"); const edgeInfo = edges.length > 0 ? ` 和 ${edges.length} 条关系` : ""; useAppStore.getState().addChatMessage({ id: uuid(), role: "system", content: `🎨 AI 识别到 ${chars.length} 个新角色${edgeInfo}：${names || "（无角色名）"}。请在右侧 AI 聊天面板点击「应用到星图」确认创建。`, created_at: new Date().toISOString() }); } }
    } catch (e) { /* 角色识别失败不影响定稿 */ }
}

/** 收集全书关键数据并计算哈希，与上次快照对比，判断是否需要新建快照 */
function shouldCreateSnapshot(projectId: string): boolean {
    try {
        const parts: string[] = [];
        const prefixes = [
            `novel-workbench-log-${projectId}`,
            `plot-segments-${projectId}`, `plot-edges-${projectId}`,
            `worldview-edges-${projectId}`, `worldview-groups-${projectId}`,
            `chapter-index-${projectId}`, `chapter-${projectId}-`,
            `char-groups-${projectId}`,
        ];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (key === "novel-workbench-mock" || prefixes.some(p => key.startsWith(p))) {
                const val = localStorage.getItem(key);
                if (val !== null) parts.push(key + ":" + val);
            }
        }
        const currentHash = simpleHash(parts.join("|"));
        const lastHashKey = `last-snapshot-hash-${projectId}`;
        const lastHash = getJSONSync(lastHashKey, "");
        if (currentHash === lastHash && lastHash !== "") return false;
        setJSONSync(lastHashKey, currentHash);
        return true;
    } catch { return true; }
}

// ===== 原子化步骤函数 =====

/** 步骤0：质检前置校验 */
async function runPreflightStep(ctx: FinalizeContext): Promise<FinalizeStep> {
    const start = Date.now();
    try {
        const q = getStoredQualityCheck(ctx.pid, ctx.chapterNumber);
        if (!q) {
            return {
                key: "preflight", name: "质检前置校验", ok: false,
                error: "未执行质检，请先点击「质检」按钮",
                errorType: "empty",
                durationMs: Date.now() - start,
            };
        }
        const currentHash = simpleHash(ctx.chapterContent);
        // 兼容旧数据：缺 contentHash 时视为 stale
        if (q.contentHash !== currentHash) {
            return {
                key: "preflight", name: "质检前置校验", ok: false,
                error: "正文已修改，请重新质检后再定稿",
                errorType: "format",
                durationMs: Date.now() - start,
            };
        }
        const effectiveErrors = countEffectiveErrors(ctx.pid, ctx.chapterNumber);
        if (effectiveErrors > 0) {
            return {
                key: "preflight", name: "质检前置校验", ok: false,
                error: `仍有 ${effectiveErrors} 个未忽略错误，请修复或忽略后再定稿`,
                errorType: "unknown",
                durationMs: Date.now() - start,
            };
        }
        return { key: "preflight", name: "质检前置校验", ok: true, durationMs: Date.now() - start };
    } catch (e) {
        return {
            key: "preflight", name: "质检前置校验", ok: false,
            error: String(e), errorType: "unknown",
            durationMs: Date.now() - start,
        };
    }
}

/** 步骤1：生成摘要 */
async function runSummaryStep(ctx: FinalizeContext): Promise<FinalizeStep> {
    const start = Date.now();
    try {
        useAppStore.getState().setAutosaveStatus("正在生成摘要...");
        await updateMemory({
            projectId: ctx.pid, chapterNumber: ctx.chapterNumber,
            chapterTitle: ctx.chapterTitle, chapterContent: ctx.chapterContent, characters: [],
        });
        useAppStore.getState().setAutosaveStatus("✅ 摘要已生成");
        return { key: "summary", name: "摘要生成", ok: true, durationMs: Date.now() - start };
    } catch (e: any) {
        useAppStore.getState().setAutosaveStatus("⚠ 摘要生成失败");
        return {
            key: "summary", name: "摘要生成", ok: false,
            error: e?.message || String(e),
            errorType: classifyAiError(e, e?.rawResponse),
            rawResponse: e?.rawResponse,
            durationMs: Date.now() - start,
        };
    }
}

/** 步骤2：激活下一章词条 */
async function runTermsStep(ctx: FinalizeContext): Promise<FinalizeStep> {
    const start = Date.now();
    try {
        const allWorldTerms = await api.listWorldTerms(ctx.pid);
        const nonLockedTerms = allWorldTerms.filter(t => t.zone !== "locked");
        const segs = getJSONSync(`plot-segments-${ctx.pid}`, []);
        const chaps = loadAllChapters(ctx.pid);
        const logStore = getJSONSync(`novel-workbench-log-${ctx.pid}`, {});
        const recentSummaries = (logStore as any).summaries || [];
        await activateNextChapterTerms(
            ctx.pid, ctx.chapterNumber,
            nonLockedTerms.map(t => ({ id: t.id, title: t.title, one_liner: t.one_liner, term_type: t.term_type })),
            segs, chaps,
            recentSummaries.sort((a: any, b: any) => b.chapter_number - a.chapter_number).slice(0, 5)
        );
        return { key: "terms", name: "词条激活", ok: true, durationMs: Date.now() - start };
    } catch (e: any) {
        return {
            key: "terms", name: "词条激活", ok: false,
            error: e?.message || String(e),
            errorType: classifyAiError(e, e?.rawResponse),
            rawResponse: e?.rawResponse,
            durationMs: Date.now() - start,
        };
    }
}

/** 步骤3：激活下一章角色 */
async function runCharactersStep(ctx: FinalizeContext): Promise<FinalizeStep> {
    const start = Date.now();
    try {
        await activateNextChapterCharacters(ctx.pid, ctx.chapterNumber);
        return { key: "characters", name: "角色激活", ok: true, durationMs: Date.now() - start };
    } catch (e: any) {
        return {
            key: "characters", name: "角色激活", ok: false,
            error: e?.message || String(e),
            errorType: classifyAiError(e, e?.rawResponse),
            rawResponse: e?.rawResponse,
            durationMs: Date.now() - start,
        };
    }
}

/** 步骤4：创建备份 */
async function runBackupStep(ctx: FinalizeContext): Promise<FinalizeStep> {
    const start = Date.now();
    try {
        createBackup(ctx.pid);
        return { key: "backup", name: "创建备份", ok: true, durationMs: Date.now() - start };
    } catch (e: any) {
        return {
            key: "backup", name: "创建备份", ok: false,
            error: e?.message || String(e),
            errorType: "unknown",
            durationMs: Date.now() - start,
        };
    }
}

/** 步骤5：创建快照（仅数据变化时） */
async function runSnapshotStep(ctx: FinalizeContext): Promise<FinalizeStep> {
    const start = Date.now();
    try {
        const needsSnapshot = shouldCreateSnapshot(ctx.pid);
        if (needsSnapshot) {
            createSnapshot(ctx.pid, `第${ctx.chapterNumber}章「${ctx.chapterTitle}」定稿`);
            return { key: "snapshot", name: "创建快照", ok: true, durationMs: Date.now() - start };
        }
        return { key: "snapshot", name: "创建快照", ok: true, error: "数据未变化，跳过", durationMs: Date.now() - start };
    } catch (e: any) {
        return {
            key: "snapshot", name: "创建快照", ok: false,
            error: e?.message || String(e),
            errorType: "unknown",
            durationMs: Date.now() - start,
        };
    }
}

/** 步骤6：更新项目阶段 */
async function runStageStep(ctx: FinalizeContext): Promise<FinalizeStep> {
    const start = Date.now();
    try {
        const proj = useAppStore.getState().currentProject;
        if (proj) {
            let ns = proj.stage;
            if (proj.stage === "framework_locked" || proj.stage === "framework_review") ns = "writing";
            if (ns === "writing") {
                const ids: string[] = getJSONSync(`chapter-index-${ctx.pid}`, []);
                const allChs = ids.map(id => getJSONSync(`chapter-${ctx.pid}-${id}`, null)).filter(Boolean);
                if (allChs.length > 0 && allChs.every((c: any) => c.content?.trim())) ns = "completed";
            }
            if (ns !== proj.stage) useAppStore.getState().setCurrentProject({ ...proj, stage: ns });
        }
        return { key: "stage", name: "阶段更新", ok: true, durationMs: Date.now() - start };
    } catch (e: any) {
        return {
            key: "stage", name: "阶段更新", ok: false,
            error: e?.message || String(e),
            errorType: "unknown",
            durationMs: Date.now() - start,
        };
    }
}

/** 计算指定章节的有效 error 数（排除已忽略项）—— 本地实现避免与 quality-checker 循环依赖 */
function countEffectiveErrors(projectId: string, chapterNumber: number): number {
    const q = getStoredQualityCheck(projectId, chapterNumber);
    if (!q) return -1;
    try {
        const logStore = getJSONSync<any>(`novel-workbench-log-${projectId}`, {} as any);
        const dismissed = logStore?.dismissedChecks?.[String(chapterNumber)] || [];
        const dismissedSet = new Set(Array.isArray(dismissed) ? dismissed : []);
        return q.checks.filter(c => c.severity === "error" && !dismissedSet.has(checkItemKey(c))).length;
    } catch { return q.checks.filter(c => c.severity === "error").length; }
}

// ===== 主入口 =====

export async function finalizeChapter(
    pid: string,
    chapterId: string,
    chapterNumber: number,
    chapterTitle: string,
    chapterContent: string,
): Promise<FinalizeResult> {
    const ctx: FinalizeContext = { pid, chapterId, chapterNumber, chapterTitle, chapterContent };
    const steps: FinalizeStep[] = [];

    // 步骤0：质检前置校验（失败则直接返回，不执行后续步骤）
    const preflight = await runPreflightStep(ctx);
    steps.push(preflight);
    if (!preflight.ok) {
        return { ok: false, steps };
    }

    // 步骤1：生成摘要
    steps.push(await runSummaryStep(ctx));
    // 步骤2：激活下一章词条
    steps.push(await runTermsStep(ctx));
    // 步骤3：激活下一章角色
    steps.push(await runCharactersStep(ctx));
    // 步骤4：创建备份
    steps.push(await runBackupStep(ctx));
    // 步骤5：创建快照
    steps.push(await runSnapshotStep(ctx));
    // 步骤6：AI 角色识别（fire-and-forget，不影响定稿结果，不计入 steps）
    aiExtractNewCharacters(pid, chapterNumber, chapterContent).catch(() => { /* 角色识别失败不影响定稿 */ });
    // 步骤7：更新项目阶段
    steps.push(await runStageStep(ctx));

    useAppStore.getState().setAutosaveStatus("✅ 已定稿");
    const allOk = steps.every(s => s.ok);
    return { ok: allOk, steps };
}

/**
 * 重试单个定稿步骤（不重新执行整个定稿流程）
 * - preflight 失败不能重试（需要用户先质检或忽略 error）
 * - 其他步骤直接调用对应函数
 */
export async function retryFinalizeStep(
    pid: string,
    chapterId: string,
    chapterNumber: number,
    chapterTitle: string,
    chapterContent: string,
    stepKey: FinalizeStepKey,
): Promise<FinalizeStep> {
    const ctx: FinalizeContext = { pid, chapterId, chapterNumber, chapterTitle, chapterContent };
    switch (stepKey) {
        case "preflight":
            return runPreflightStep(ctx);
        case "summary":
            return runSummaryStep(ctx);
        case "terms":
            return runTermsStep(ctx);
        case "characters":
            return runCharactersStep(ctx);
        case "backup":
            return runBackupStep(ctx);
        case "snapshot":
            return runSnapshotStep(ctx);
        case "stage":
            return runStageStep(ctx);
        default:
            return { key: stepKey, name: String(stepKey), ok: false, error: "未知步骤" };
    }
}

/**
 * 重试多个失败步骤（串行执行，因步骤间有依赖：摘要 → 词条/角色激活）
 */
export async function retryFailedSteps(
    pid: string,
    chapterId: string,
    chapterNumber: number,
    chapterTitle: string,
    chapterContent: string,
    stepKeys: FinalizeStepKey[],
): Promise<FinalizeStep[]> {
    const results: FinalizeStep[] = [];
    for (const key of stepKeys) {
        // 跳过 preflight，重新整体定稿时由调用方决定是否需要前置校验
        if (key === "preflight") continue;
        results.push(await retryFinalizeStep(pid, chapterId, chapterNumber, chapterTitle, chapterContent, key));
    }
    return results;
}
