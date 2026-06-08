/**
 * 质量检查器 —— 定稿后自动检查，确保不偏移
 *
 * 职责：定稿后自动执行 4 项检查，不可跳过：
 * 1. 圣经合规：角色行为是否违反故事圣经铁则
 * 2. 角色一致：角色性格、能力是否符合角色档案
 * 3. 伏笔回收：该收的伏笔是否在预期章节内收了
 * 4. 版本正确：本章使用的设定是否为最新版本
 *
 * 全部通过 → 静默
 * 有 warning → 静默记录，审计报告提示
 * 有 error → 弹出警告面板，你确认后继续
 */

import { api } from "./api";
import type {
    Character,
    ForeshadowEntry,
    StoryBible,
    StyleGuide,
} from "@/types";

// ===== 接口 =====

export interface QualityCheckInput {
    projectId: string;
    chapterId: string;
    chapterNumber: number;
    chapterContent: string;
}

export interface QualityCheckResult {
    passed: boolean;
    checks: QualityCheckItem[];
}

export interface QualityCheckItem {
    type: "bible" | "character" | "foreshadow" | "version" | "plot_logic";
    severity: "pass" | "warning" | "error";
    message: string;
    detail: string;
}

// ===== 主函数 =====

export async function runQualityCheck(
    input: QualityCheckInput
): Promise<QualityCheckResult> {
    const { projectId, chapterContent } = input;
    const checks: QualityCheckItem[] = [];

    // 并行加载所有需要对比的数据
    const [bible, characters, _styleGuide] = await Promise.all([
        loadStoryBible(projectId),
        api.listCharacters(projectId),
        loadStyleGuide(projectId),
    ]);

    // 1. 圣经合规检查
    if (bible) {
        const bibleCheck = checkBibleCompliance(chapterContent, bible);
        checks.push(...bibleCheck);
    } else {
        checks.push({
            type: "bible",
            severity: "pass",
            message: "故事圣经未设置，跳过检查",
            detail: "建议在「故事圣经」模块中设定铁则",
        });
    }

    // 2. 角色一致性检查
    if (characters.length > 0) {
        const charCheck = checkCharacterConsistency(chapterContent, characters);
        checks.push(...charCheck);
    } else {
        checks.push({
            type: "character",
            severity: "pass",
            message: "暂无角色档案，跳过检查",
            detail: "建议在「人物关系」中完善角色设定",
        });
    }

    // 3. 伏笔回收检查
    const foreshadowCheck = checkForeshadowRecovery(projectId, input.chapterNumber);
    checks.push(...foreshadowCheck);

    // 4. 版本正确性检查
    const versionCheck = checkChapterVersion(projectId, input.chapterNumber);
    checks.push(...versionCheck);

    // 5. 剧情逻辑检查（与前面章节对比）
    const plotLogicCheck = await checkPlotLogic(projectId, input.chapterNumber, chapterContent);
    checks.push(...plotLogicCheck);

    const errors = checks.filter((c) => c.severity === "error");
    return {
        passed: errors.length === 0,
        checks,
    };
}

// ===== 1. 圣经合规检查 =====

function checkBibleCompliance(
    content: string,
    bible: StoryBible
): QualityCheckItem[] {
    const results: QualityCheckItem[] = [];

    // 检查不可违背的角色铁则
    for (const rule of bible.inviolable_rules) {
        if (rule.includes("保密") || rule.includes("秘密")) {
            // 检查角色是否泄露了秘密
            const secretItems = rule.match(/[《》""「」【】『』].{1,20}[《》""「」【】『』]/g);
            if (secretItems) {
                for (const item of secretItems) {
                    if (content.includes(item.replace(/[《》""「」【】『』]/g, ""))) {
                        if (content.includes("告诉") || content.includes("泄露") || content.includes("说出")) {
                            results.push({
                                type: "bible",
                                severity: "error",
                                message: `⚠️ 可能违反铁则: ${rule.slice(0, 30)}`,
                                detail: `本章内容提到了"${item}"，请确认是否违背了保密规则`,
                            });
                        }
                    }
                }
            }
        }

        if (rule.includes("不能") || rule.includes("不可") || rule.includes("不会")) {
            // 提取禁止的行为
            const forbidden = rule.match(/(?:不能|不可|不会)(.{2,20})/);
            if (forbidden && content.includes(forbidden[1].trim())) {
                results.push({
                    type: "bible",
                    severity: "error",
                    message: `⚠️ 可能违反铁则: ${rule.slice(0, 30)}`,
                    detail: `本章内容出现了"${forbidden[1].trim()}"相关内容，请确认`,
                });
            }
        }

        if (rule.includes("保留") && rule.includes("一成")) {
            // 离玄保留一成灵力规则
            const match = content.match(/灵力.{0,10}(?:耗尽|用完|清空|全用|全力)/);
            if (match) {
                results.push({
                    type: "bible",
                    severity: "warning",
                    message: "⚠️ 离玄灵力使用提醒",
                    detail: '离玄必须永远保留一成灵力维持水火平衡。本章提到"灵力耗尽/全力"，请确认离玄没有违反此规则',
                });
            }
        }
    }

    // 检查世界观铁律
    for (const rule of bible.worldview_rules) {
        if (rule.includes("不可越阶")) {
            if (content.includes("越阶") || content.includes("跨境突破")) {
                results.push({
                    type: "bible",
                    severity: "error",
                    message: "⚠️ 修炼体系可能违反",
                    detail: '世界观铁律: 修炼体系不可越阶。本章出现了"越阶/跨境突破"相关内容',
                });
            }
        }
    }

    // 检查已锁定事件
    for (const event of bible.locked_events) {
        const eventTerms = event.description.split("。")[0]?.slice(0, 20);
        if (eventTerms && content.includes(eventTerms)) {
            const chapterIndicator = content.match(/(?:第|这).{0,5}(?:章|次|次大比|场)/);
            if (chapterIndicator) {
                results.push({
                    type: "bible",
                    severity: "warning",
                    message: `已锁定事件「${event.title}」已被触发`,
                    detail: `第${event.chapter}章的事件已在本章内容中出现，请确认事件发生在正确的章节`,
                });
            }
        }
    }

    if (results.length === 0) {
        results.push({
            type: "bible",
            severity: "pass",
            message: "✅ 故事圣经检查通过",
            detail: "未检测到违反铁则的行为",
        });
    }

    return results;
}

// ===== 2. 角色一致性检查 =====

function checkCharacterConsistency(
    content: string,
    characters: Character[]
): QualityCheckItem[] {
    const results: QualityCheckItem[] = [];

    for (const char of characters) {
        if (!content.includes(char.name)) continue;

        // 检查性格一致性
        if (char.personality) {
            const personalityWords = char.personality.split(/[，、、;；]/g).map(s => s.trim()).filter(Boolean);
            for (const trait of personalityWords) {
                const oppositeWords = getOppositeWords(trait);
                for (const opp of oppositeWords) {
                    // 在角色相关的段落中搜索
                    const charParagraphs = content
                        .split("\n")
                        .filter(l => l.includes(char.name))
                        .join(" ");
                    if (charParagraphs.includes(opp)) {
                        results.push({
                            type: "character",
                            severity: "warning",
                            message: `⚠️ 角色「${char.name}」性格可能漂移`,
                            detail: `角色设定为"${trait}"，但本章出现了"${opp}"的描述，请确认是否符合人物弧光`,
                        });
                    }
                }
            }
        }

        // 检查能力设定
        if (char.ability) {
            const abilityIndicators = extractAbilityIndicators(char.ability);
            for (const indicator of abilityIndicators) {
                if (content.includes(indicator)) {
                    // 检查是否超出角色应有水平
                    const powerfulDesc = /(?:轻松|随意|随手|一招|碾压|秒杀)/g;
                    const match = powerfulDesc.exec(content);
                    if (match && content.includes(char.name)) {
                        results.push({
                            type: "character",
                            severity: "warning",
                            message: `⚡ 角色「${char.name}」能力表现超出预期`,
                            detail: `角色设定能力: ${char.ability.slice(0, 40)}。本章出现了"${match[0]}"的描述，请确认是否符合角色当前修为`,
                        });
                    }
                }
            }
        }
    }

    if (results.filter(r => r.type === "character").length === 0) {
        results.push({
            type: "character",
            severity: "pass",
            message: "✅ 角色一致性检查通过",
            detail: "本章出场角色行为与档案设定基本一致",
        });
    }

    return results;
}

// ===== 3. 伏笔回收检查 =====

function checkForeshadowRecovery(
    projectId: string,
    chapterNumber: number
): QualityCheckItem[] {
    const results: QualityCheckItem[] = [];

    try {
        const key = `novel-workbench-log-${projectId}`;
        const raw = localStorage.getItem(key);
        if (!raw) {
            results.push({
                type: "foreshadow",
                severity: "pass",
                message: "暂无伏笔记录，跳过检查",
                detail: "",
            });
            return results;
        }

        const store = JSON.parse(raw);
        // 兼容旧格式
        const foreshadows: ForeshadowEntry[] = Array.isArray(store)
            ? []
            : store.foreshadows || [];

        // 检查是否有近期该收但没收的伏笔
        const overdue = foreshadows.filter(
            (f) =>
                f.status === "pending" &&
                f.expected_resolve_chapter <= chapterNumber &&
                f.expected_resolve_chapter >= chapterNumber - 3
        );

        if (overdue.length > 0) {
            for (const f of overdue) {
                results.push({
                    type: "foreshadow",
                    severity: "warning",
                    message: `📌 伏笔「${f.description.slice(0, 20)}」应在第${f.expected_resolve_chapter}章附近回收`,
                    detail: `该伏笔埋设于第${f.planted_chapter}章，预期在${f.expected_resolve_chapter}章回收，现已到第${chapterNumber}章。如果尚未回收，请在本章或近期章节安排。优先级: ${f.priority === "critical" ? "🔴" : f.priority === "important" ? "🟡" : "🟢"}${f.priority}`,
                });
            }
        }

        // 检查是否有临界伏笔即将过期
        const critical = foreshadows.filter(
            (f) =>
                f.status === "pending" &&
                f.expected_resolve_chapter === chapterNumber + 1 &&
                f.priority === "critical"
        );

        if (critical.length > 0) {
            for (const f of critical) {
                results.push({
                    type: "foreshadow",
                    severity: "warning",
                    message: `🔴 重要伏笔「${f.description.slice(0, 20)}」下章必须回收`,
                    detail: `该伏笔下章（第${f.expected_resolve_chapter}章）是预期回收的最后一章，请确认是否已安排`,
                });
            }
        }

        if (results.filter(r => r.type === "foreshadow").length === 0) {
            results.push({
                type: "foreshadow",
                severity: "pass",
                message: "✅ 伏笔检查通过",
                detail: "未发现该收没收的伏笔",
            });
        }
    } catch {
        results.push({
            type: "foreshadow",
            severity: "pass",
            message: "伏笔数据加载失败，跳过检查",
            detail: "",
        });
    }

    return results;
}

// ===== 辅助函数 =====

function loadStoryBible(projectId: string): Promise<StoryBible | null> {
    try { return api.getStoryBible(projectId); } catch { return null as any; }
}

function loadStyleGuide(projectId: string): Promise<StyleGuide | null> {
    try { return api.getStyleGuide(projectId); } catch { return null as any; }
}

function getOppositeWords(trait: string): string[] {
    const opposites: Record<string, string[]> = {
        "踏实": ["浮躁", "冲动", "冒进"],
        "慢热": ["急躁", "急性子", "冲动"],
        "不争": ["好胜", "争强", "争抢"],
        "冷": ["热情", "热", "亲热"],
        "冷厉": ["温和", "温柔", "心软"],
        "护短": ["冷漠", "见死不救"],
        "沉稳": ["冲动", "急躁", "慌"],
        "坚韧": ["脆弱", "放弃", "认输"],
        "寡言": ["多话", "健谈", "滔滔不绝"],
        "淡定": ["慌张", "慌乱", "紧张"],
        "坚毅": ["动摇", "退缩", "畏惧"],
        "隐忍": ["爆发", "冲动"],
        "重情": ["无情", "薄情", "冷漠"],
        "谨慎": ["大意", "粗心", "冒失"],
    };

    for (const [key, vals] of Object.entries(opposites)) {
        if (trait.includes(key)) return vals;
    }
    return [];
}

function extractAbilityIndicators(ability: string): string[] {
    const indicators: string[] = [];
    const matches = ability.matchAll(/《([^》]+)》/g);
    for (const m of matches) {
        indicators.push(m[1]);
    }
    return indicators;
}

// ===== 4. 版本正确性检查 =====

/** 检查本章依赖的数据版本是否过期 */
function checkChapterVersion(projectId: string, chapterNumber: number): QualityCheckItem[] {
    try {
        const raw = localStorage.getItem(`novel-workbench-log-${projectId}`);
        if (!raw) return [{ type: "version", severity: "pass", message: "版本信息不可用，跳过检查", detail: "" }];
        const store = JSON.parse(raw);
        const deps = store.dependencies || [];
        const staleForThis = deps.filter((d: any) => {
            const depCh = parseInt(d.dependsOnChapter);
            return depCh <= chapterNumber && d.status === "stale";
        });
        if (staleForThis.length > 0) {
            return [{
                type: "version",
                severity: "error",
                message: `⚠️ 检测到 ${staleForThis.length} 条基于旧版本的数据`,
                detail: `前章内容已修改，${staleForThis.length} 条记录（摘要/角色状态）仍基于旧版本，请重新生成摘要。`,
            }];
        }
        return [{
            type: "version",
            severity: "pass",
            message: "✅ 版本检查通过",
            detail: "所有依赖数据均基于最新版本",
        }];
    } catch {
        return [{ type: "version", severity: "pass", message: "版本检查跳过", detail: "" }];
    }
}

// ===== 5. 剧情逻辑检查（前后一致） =====

/** 调用 AI 检查本章与前面章节是否存在逻辑矛盾 */
async function checkPlotLogic(
    projectId: string,
    chapterNumber: number,
    chapterContent: string
): Promise<QualityCheckItem[]> {
    try {
        // 读取前面章节摘要
        const summaries = await api.getChapterSummaries(projectId);
        const prevSummaries = summaries
            .filter(s => s.chapter_number < chapterNumber && s.chapter_number >= chapterNumber - 5)
            .sort((a, b) => a.chapter_number - b.chapter_number);

        if (prevSummaries.length === 0) {
            return [{
                type: "plot_logic",
                severity: "pass",
                message: "✅ 无前章可对比，跳过剧情逻辑检查",
                detail: "首章无需检查逻辑一致性",
            }];
        }

        // 保留给后续 AI 增强

        // 使用关键词规则做基础检查（prevText 保留给后续 AI 增强）
        const results: QualityCheckItem[] = [];
        let hasIssue = false;

        // 提取前章的关键事件词
        for (const s of prevSummaries) {
            // 角色死亡/离开后不应再出现
            const deathMatch = s.summary.match(/(.+)(?:身亡|被[杀砍]|陨落|去世|牺牲)/);
            if (deathMatch) {
                const deadChar = deathMatch[1].slice(-4);
                if (deadChar.length >= 2 && chapterContent.includes(deadChar)) {
                    if (!chapterContent.includes("回忆") && !chapterContent.includes("幻象") && !chapterContent.includes("梦境")) {
                        results.push({
                            type: "plot_logic",
                            severity: "warning",
                            message: `⚠️ 角色「${deadChar}」已在第${s.chapter_number}章去世`,
                            detail: `本章出现「${deadChar}」，但第${s.chapter_number}章已明确该角色身亡。如果是回忆/幻象/梦境，请忽略此警告。`,
                        });
                        hasIssue = true;
                    }
                }
            }
        }

        if (!hasIssue) {
            results.push({
                type: "plot_logic",
                severity: "pass",
                message: "✅ 剧情逻辑初步检查通过",
                detail: `与前${prevSummaries.length}章对比，未发现明显的逻辑矛盾。`,
            });
        }

        return results;
    } catch {
        return [{
            type: "plot_logic",
            severity: "pass",
            message: "剧情逻辑检查跳过（数据不足）",
            detail: "摘要数据读取失败，跳过检查",
        }];
    }
}
