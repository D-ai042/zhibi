/**
 * 诊断上报层 —— 存储写入失败等关键错误的统一出口。
 *
 * 设计原则：
 * - 不写入 localStorage（避免新的静默失败：如果 localStorage 配额满，写诊断也会失败）
 * - 使用 console.error 永久记录 + dispatchEvent 通知 UI 层
 * - UI 层（AppShell）监听 'zhibi-diagnostic' 事件并显示 Toast
 *
 * 这样 storage.ts 不依赖任何 UI 模块，避免循环依赖。
 */

export type DiagnosticLevel = "warn" | "error" | "fatal";

export interface DiagnosticEvent {
    level: DiagnosticLevel;
    message: string;
    details?: unknown;
    timestamp: string;
}

/**
 * 上报一条诊断信息。
 * - 始终 console.error/warn 输出到控制台
 * - 通过 window.dispatchEvent 通知 UI（CustomEvent）
 * - 不写入 localStorage（配额满时写入本身会失败）
 */
export function reportDiagnostic(
    level: DiagnosticLevel,
    message: string,
    details?: unknown,
): void {
    const event: DiagnosticEvent = {
        level,
        message,
        details,
        timestamp: new Date().toISOString(),
    };

    // 1. 控制台输出（永久可见）
    const tag = `[zhibi:${level}]`;
    if (level === "error" || level === "fatal") {
        console.error(tag, message, details ?? "");
    } else {
        console.warn(tag, message, details ?? "");
    }

    // 2. 通知 UI 层（CustomEvent，不依赖 localStorage）
    if (typeof window !== "undefined" && window.dispatchEvent) {
        try {
            window.dispatchEvent(
                new CustomEvent<DiagnosticEvent>("zhibi-diagnostic", { detail: event }),
            );
        } catch {
            // dispatchEvent 极端情况下可能失败（如 jsdom 测试环境），不影响主流程
        }
    }
}
