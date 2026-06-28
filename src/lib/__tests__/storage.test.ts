/**
 * T0/T1 回归测试 —— storage.ts 公开 API
 *
 * 锁定当前正确行为，为 T1（storage 精简）提供回归保护。
 * 覆盖 B1（章节丢失）的核心场景：写后必读回、写入失败不静默吞。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    getJSONSync,
    setJSONSync,
    getSync,
    setSync,
    loadJSON,
    saveJSON,
} from "@/lib/storage";

beforeEach(() => {
    localStorage.clear();
});

describe("getSync / setSync", () => {
    it("写入后读取返回相同值", () => {
        setSync("key1", "value1");
        expect(getSync("key1")).toBe("value1");
    });

    it("读取不存在的 key 返回 null", () => {
        expect(getSync("not-exist")).toBeNull();
    });
});

describe("getJSONSync / setJSONSync（废弃别名）", () => {
    it("写入对象后读取返回相同对象", () => {
        const data = { name: "张三", age: 16, tags: ["主角", "少年"] };
        setJSONSync("char-1", data);
        expect(getJSONSync("char-1", null)).toEqual(data);
    });

    it("读取不存在的 key 返回默认值", () => {
        const def = { fallback: true };
        expect(getJSONSync("no-key", def)).toEqual(def);
    });

    it("损坏的 JSON 返回默认值", () => {
        localStorage.setItem("broken", "{not json");
        expect(getJSONSync("broken", "default")).toBe("default");
    });
});

describe("loadJSON", () => {
    it("写入后读取返回相同对象", () => {
        const data = { name: "李四", age: 20 };
        saveJSON("char-2", data);
        expect(loadJSON("char-2", null)).toEqual(data);
    });

    it("读取不存在的 key 返回默认值", () => {
        expect(loadJSON("no-key", { def: 1 })).toEqual({ def: 1 });
    });
});

describe("saveJSON", () => {
    it("正常写入返回 true", () => {
        expect(saveJSON("ok-key", { a: 1 })).toBe(true);
        expect(loadJSON("ok-key", null)).toEqual({ a: 1 });
    });

    it("写入失败（localStorage.setItem 抛错）返回 false", () => {
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        expect(saveJSON("fail-key", { a: 1 })).toBe(false);
        expect(errSpy).toHaveBeenCalled();
        spy.mockRestore();
        errSpy.mockRestore();
    });

    it("写后验证已移除：setSync 成功即返回 true（不再读回比对）", () => {
        // 写后验证已移除（EXE 模式验证内存缓存无意义），setSync 不抛错即返回 true
        const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { });
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        expect(saveJSON("verify-removed", { a: 1 })).toBe(true);
        expect(errSpy).not.toHaveBeenCalled();
        setSpy.mockRestore();
        errSpy.mockRestore();
    });

    it("JSON 序列化失败（循环引用）返回 false", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        expect(saveJSON("circular", circular)).toBe(false);
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});

describe("setSync 写入失败", () => {
    it("localStorage.setItem 抛错时 setSync 抛出异常（B1 修复：不再静默 warn）", () => {
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        // B1 修复后：setSync 应抛异常（而非静默 console.warn）
        expect(() => setSync("k", "v")).toThrow("QuotaExceededError");
        spy.mockRestore();
    });
});
