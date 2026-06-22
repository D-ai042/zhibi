/**
 * T0 回归测试 —— estimateTokens（context-engine.ts）
 *
 * 锁定当前 token 估算行为，为 T5（重复代码消除）提供回归保护。
 */
import { describe, it, expect } from "vitest";
import { estimateTokens } from "@/lib/context-engine";

describe("estimateTokens", () => {
    it("纯中文：每个汉字计 2 token", () => {
        // 5 个汉字，预期 10
        expect(estimateTokens("执笔写小说")).toBe(10);
    });

    it("纯英文：每字符计 0.5 token（向上取整）", () => {
        // "hello" = 5 字符 × 0.5 = 2.5 → 向上取整 3
        expect(estimateTokens("hello")).toBe(3);
    });

    it("中英混合文本返回合理区间", () => {
        const text = "张三 said hello";
        // 张三(2字×2=4) + 空格(0.5) + said(4×0.5=2) + 空格(0.5) + hello(5×0.5=2.5)
        // 总计 9.5 → 向上取整 10
        const tokens = estimateTokens(text);
        expect(tokens).toBeGreaterThan(5);
        expect(tokens).toBeLessThan(20);
    });

    it("空字符串返回 0", () => {
        expect(estimateTokens("")).toBe(0);
    });
});
