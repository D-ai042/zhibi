/**
 * 质量检查器 —— 定稿后自动检查，确保不偏移
 *
 * 全部由 AI 完成分析，不做正则/关键词匹配。
 * AI 调用失败直接报错。
 */

import { api } from "./api";
import { getJSONSync } from "./storage";
import type { ForeshadowEntry, StoryBible, StyleGuide } from "@/types";

// ===== 接口 =====

export interface QualityCheckInput {
    projectId: string; chapterId: string; chapterNumber: number; chapterContent: string;
}

export interface QualityCheckResult {
    passed: boolean; checks: QualityCheckItem[];
}

export interface QualityCheckItem {
    type: "bible" | "character" | "foreshadow" | "version" | "plot_logic";
    severity: "pass" | "warning" | "error";
    message: string; detail: string;
}

// ===== 主函数 =====

export async function runQualityCheck(input: QualityCheckInput): Promise<QualityCheckResult> {
    const { projectId, chapterNumber, chapterContent } = input;
    const checks: QualityCheckItem[] = [];

    // 加载上下文
    const [bible, styleGuide, prevSummaries] = await Promise.all([
        loadStoryBible(projectId),
        loadStyleGuide(projectId),
        loadPrevSummaries(projectId, chapterNumber),
    ]);

    // AI 一体化质量检查
    const aiResults = await aiQualityCheck(
        chapterNumber, chapterContent, bible, styleGuide, prevSummaries
    );

    // 版本检查（不依赖 AI）
    const versionCheck = checkChapterVersion(projectId, chapterNumber);
    checks.push(...versionCheck);

    // 合并 AI 结果
    checks.push(...aiResults);

    const errors = checks.filter((c) => c.severity === "error");
    return { passed: errors.length === 0, checks };
}

// ===== AI 质量检查 =====

async function aiQualityCheck(
    chapterNumber: number, chapterContent: string,
    bible: StoryBible | null, styleGuide: StyleGuide | null,
    prevSummaries: string
): Promise<QualityCheckItem[]> {
    const bibleText = bible
        ? `不可违背的铁则：\n${(bible.inviolable_rules || []).map(r => `- ${r}`).join("\n")}\n\n世界观铁律：\n${(bible.worldview_rules || []).map(r => `- ${r}`).join("\n")}`
        : "暂无圣经铁则";

    const styleText = styleGuide
        ? `叙述风格：${styleGuide.narrative_style || ""}\n文笔基调：${styleGuide.writing_tone || ""}\n写作红线：${styleGuide.writing_rules || ""}`
        : "暂无风格指南";

    const prompt = `你是一个严格的文学质量检查官。对照以下标准，检查本章内容是否存在问题。

【故事圣经铁则（不可违反）】
${bibleText}

【风格指南】
${styleText}

【前情摘要】
${prevSummaryText(prevSummaries)}

【本章内容（第${chapterNumber}章，前4000字）】
${chapterContent.slice(0, 4000)}

请严格按以下 JSON 格式输出（放在 ---QUALITY_CHECK--- 块中），不要有任何额外文字：
---QUALITY_CHECK---
[
  {"type":"bible|character|foreshadow|plot_logic","severity":"pass|warning|error","message":"检查项描述","detail":"详细说明"}
]
---END_QUALITY_CHECK---

检查要点：
- bible: 是否违反铁则（角色泄密/灵力耗尽/越阶修炼等）
- character: 角色性格是否漂移（突然变冷淡/温柔/冲动）
- foreshadow: 该收的伏笔是否在本章回收
- plot_logic: 是否与前面章节存在逻辑矛盾（死者复活/道具消失/能力突变等）
- 如果该项无问题，severity 填 "pass"`;

    try {
        const res = await api.aiComplete({
            action: "chat", entity_type: "chapter", entity_id: "",
            extra: {
                system_hint: "你是一个严格的文学质量检查官。只输出 JSON，不要额外文字。",
                user_message: prompt, history: [], context: "",
            },
        });

        if (!res.content || res.error) {
            return [{ type: "bible", severity: "error", message: "质量检查失败", detail: res.error || "AI 无响应" }];
        }

        const m = res.content.match(/---QUALITY_CHECK---\s*([\s\S]*?)\s*---END_QUALITY_CHECK---/);
        if (!m) {
            return [{ type: "bible", severity: "error", message: "质量检查格式错误", detail: "AI 未按指定格式输出" }];
        }

        const items = JSON.parse(m[1]) as QualityCheckItem[];
        return items;
    } catch (e) {
        return [{ type: "bible", severity: "error", message: "质量检查失败", detail: e instanceof Error ? e.message : String(e) }];
    }
}

// ===== 版本检查（不依赖 AI） =====

function checkChapterVersion(projectId: string, chapterNumber: number): QualityCheckItem[] {
    const store = getJSONSync(`novel-workbench-log-${projectId}`, {} as any);
    const deps = store.dependencies || [];
    const staleForThis = deps.filter((d: any) => {
        const depCh = parseInt(d.dependsOnChapter);
        return depCh <= chapterNumber && d.status === "stale";
    });
    if (staleForThis.length > 0) {
        return [{ type: "version", severity: "error", message: `⚠️ ${staleForThis.length} 条数据基于旧版本`, detail: "前章已修改，请重新生成摘要。" }];
    }
    return [{ type: "version", severity: "pass", message: "✅ 版本检查通过", detail: "" }];
}

// ===== 辅助加载 =====

function loadStoryBible(projectId: string): Promise<StoryBible | null> {
    try { return api.getStoryBible(projectId); } catch { return Promise.resolve(null); }
}

function loadStyleGuide(projectId: string): Promise<StyleGuide | null> {
    try { return api.getStyleGuide(projectId); } catch { return Promise.resolve(null); }
}

async function loadPrevSummaries(projectId: string, chapterNumber: number): Promise<string> {
    try {
        const summaries = await api.getChapterSummaries(projectId);
        return summaries
            .filter(s => s.chapter_number < chapterNumber)
            .sort((a, b) => a.chapter_number - b.chapter_number)
            .slice(-5)
            .map(s => `第${s.chapter_number}章：${s.summary}`)
            .join("\n");
    } catch { return ""; }
}

function prevSummaryText(summaries: string): string {
    return summaries || "（首章，无前情）";
}
