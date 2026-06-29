/**
 * AI 错误分类器 —— 用于定稿失败步骤的诊断与修复策略
 *
 * 将各种 AI 调用失败归类为有限的几种 errorType，
 * 便于 UI 显示修复建议、决定是否可自动重试。
 */

/** 定稿步骤 key（与 finalizeChapter.FinalizeStep.key 保持一致） */
export type FinalizeStepKey =
    | "preflight" | "summary" | "terms" | "characters"
    | "backup" | "snapshot" | "stage";

/** AI 错误分类 */
export type AiErrorType = "format" | "network" | "parse" | "empty" | "unknown";

/** 定稿步骤结果（与 finalizeChapter.FinalizeStep 结构一致；这里用结构类型避免循环依赖） */
export interface FinalizeStepLike {
    key: FinalizeStepKey;
    name: string;
    ok: boolean;
    error?: string;
    errorType?: AiErrorType;
    rawResponse?: string;
    durationMs?: number;
}

/** 根据错误信息与原始返回，归类错误类型 */
export function classifyAiError(err: unknown, rawResponse?: string): AiErrorType {
    const errObj = err as { message?: string } | null;
    const msg = `${errObj?.message || ""} ${rawResponse || ""}`;
    if (/timeout|network|fetch|ECONN|网络|超时|abort/i.test(msg)) return "network";
    if (/JSON|parse|解析|未按.*格式|格式错误|---\w+_END---|---CHAPTER_ANALYSIS---|---TERM_ACTIVATION---|---QUALITY_CHECK---/i.test(msg)) return "format";
    if (/为空|empty|无响应|no content|null|undefined/i.test(msg)) return "empty";
    if (/syntax|unexpected token|invalid json/i.test(msg)) return "parse";
    return "unknown";
}

/** 修复建议（用于 UI 展示） */
export interface FixSuggestion {
    title: string;
    description: string;
    /** 是否可自动重试（强化 prompt 重试） */
    autoFixable: boolean;
}

/** 根据错误类型生成修复建议 */
export function getFixSuggestion(errorType: AiErrorType | undefined): FixSuggestion {
    switch (errorType) {
        case "network":
            return {
                title: "网络/AI 服务异常",
                description: "通常是网络超时或 AI 服务暂时不可用，可直接重试。",
                autoFixable: true,
            };
        case "empty":
            return {
                title: "AI 返回为空",
                description: "AI 没有返回任何内容，可能是上下文过长被截断。建议简化章节或重试。",
                autoFixable: true,
            };
        case "format":
            return {
                title: "AI 未按模板输出",
                description: "AI 返回内容缺少格式标记。点击修复将自动强化 prompt 重试。",
                autoFixable: true,
            };
        case "parse":
            return {
                title: "JSON 解析失败",
                description: "AI 返回了内容但 JSON 格式错误，将尝试提取后重试。",
                autoFixable: true,
            };
        default:
            return {
                title: "未知错误",
                description: "请查看详细错误信息后重试。",
                autoFixable: false,
            };
    }
}

/** 格式化失败步骤为聊天消息内容 */
export function formatFailedStepMessage(step: FinalizeStepLike): string {
    const suggestion = getFixSuggestion(step.errorType);
    const lines: string[] = [];
    lines.push(`⚠️ **${step.name}** 失败`);
    lines.push("");
    lines.push(`**错误类型**：${suggestion.title}`);
    lines.push(`**原因**：${step.error || "未知"}`);
    lines.push(`**建议**：${suggestion.description}`);
    if (step.rawResponse) {
        const truncated = step.rawResponse.length > 500
            ? step.rawResponse.slice(0, 500) + "..."
            : step.rawResponse;
        lines.push("");
        lines.push("**AI 原始返回**：");
        lines.push("```");
        lines.push(truncated);
        lines.push("```");
    }
    return lines.join("\n");
}
