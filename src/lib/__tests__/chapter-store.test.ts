import { describe, it, expect, beforeEach } from "vitest";
import { loadAllChapters, loadChapter, saveChapter, saveAllChapters, deleteChapter } from "../chapter-store";

const PID = "test-project-1";

describe("chapter-store", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("创建章节后可正确读取", () => {
        const ch = { id: "ch1", title: "测试章节", content: "内容", number: 1, volumeSegmentId: PID };
        saveChapter(PID, ch);
        const loaded = loadChapter(PID, "ch1");
        expect(loaded).not.toBeNull();
        expect(loaded!.title).toBe("测试章节");
    });

    it("读取不存在的章节返回 null", () => {
        const result = loadChapter(PID, "nonexistent");
        expect(result).toBeNull();
    });

    it("删除章节后再读取返回 null", () => {
        const ch = { id: "ch2", title: "待删除", content: "", number: 2, volumeSegmentId: PID };
        saveChapter(PID, ch);
        deleteChapter(PID, "ch2");
        expect(loadChapter(PID, "ch2")).toBeNull();
    });

    it("批量保存后 loadAllChapters 返回全部章节", () => {
        const chapters = [
            { id: "a", title: "A", content: "", number: 1, volumeSegmentId: PID },
            { id: "b", title: "B", content: "", number: 2, volumeSegmentId: PID },
        ];
        saveAllChapters(PID, chapters);
        const all = loadAllChapters(PID);
        expect(all.length).toBe(2);
        expect(all.map(c => c.id).sort()).toEqual(["a", "b"]);
    });

    it("自动迁移旧格式 plot-chapters-{pid}", () => {
        const oldData = [
            { id: "old1", title: "旧章", content: "旧内容", number: 1, volumeSegmentId: PID },
        ];
        localStorage.setItem(`plot-chapters-${PID}`, JSON.stringify(oldData));
        const all = loadAllChapters(PID);
        expect(all.length).toBe(1);
        expect(all[0].title).toBe("旧章");
        // 迁移后旧 key 应已清除
        expect(localStorage.getItem(`plot-chapters-${PID}`)).toBeNull();
    });

    it("已有分片章节时清理遗留旧聚合 key", () => {
        const ch = { id: "new1", title: "新章", content: "新内容", number: 1, volumeSegmentId: PID };
        saveChapter(PID, ch);
        localStorage.setItem(`plot-chapters-${PID}`, JSON.stringify([
            { id: "old1", title: "旧章", content: "旧内容", number: 1, volumeSegmentId: PID },
        ]));

        const all = loadAllChapters(PID);

        expect(all).toHaveLength(1);
        expect(all[0].id).toBe("new1");
        expect(localStorage.getItem(`plot-chapters-${PID}`)).toBeNull();
    });
});
