/**
 * T0 回归测试 —— parseChapterRange（context-engine.ts）
 *
 * 锁定当前章节范围解析行为，为 T5（重复代码消除）提供回归保护。
 * 该函数在 context-engine.ts 和 memory-updater.ts 各有一份副本，
 * T5 将删除副本统一从 context-engine 导出。
 */
import { describe, it, expect } from "vitest";
import { parseChapterRange } from "@/lib/context-engine";

describe("parseChapterRange", () => {
    it("单段范围 '1-3' → [1,2,3]", () => {
        expect(parseChapterRange("1-3")).toEqual([1, 2, 3]);
    });

    it("多段混合 '4,7-9' → [4,7,8,9]", () => {
        expect(parseChapterRange("4,7-9")).toEqual([4, 7, 8, 9]);
    });

    it("空字符串 → []", () => {
        expect(parseChapterRange("")).toEqual([]);
    });

    it("中文逗号 '1，2' → [1,2]", () => {
        expect(parseChapterRange("1，2")).toEqual([1, 2]);
    });

    it("单个数字 '5' → [5]", () => {
        expect(parseChapterRange("5")).toEqual([5]);
    });

    it("含空格 '1 - 3 , 7' → [1,2,3,7]", () => {
        expect(parseChapterRange("1 - 3 , 7")).toEqual([1, 2, 3, 7]);
    });

    it("反向范围不处理（当前行为：返回空，因为循环条件 i<=parseInt(m[2]) 不满足）", () => {
        // "5-3" → m[1]=5, m[2]=3, 循环 i=5; i<=3 不执行 → []
        expect(parseChapterRange("5-3")).toEqual([]);
    });
});
