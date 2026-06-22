/**
 * chapter-store.ts —— 章节逐章存储（T3：B1 章节丢失根治）
 *
 * 存储结构：
 *   chapter-{pid}-{chapterId}   每章独立存储
 *   chapter-index-{pid}          章节ID索引数组
 *
 * 废弃 key（仅做读时兼容迁移）：
 *   plot-chapters-{pid}          旧的全量聚合缓存
 */

import { getJSONSync, setJSONSync, getSync, setSync, saveJSON } from "@/lib/storage";

export interface Chapter {
    id: string;
    volumeSegmentId: string;
    number: number;
    title: string;
    content: string;
}

export interface SaveResult {
    ok: boolean;
    error?: string;
}

/** 加载项目所有章节（兼容旧格式自动迁移） */
export function loadAllChapters(pid: string): Chapter[] {
    const ids: string[] = getJSONSync(`chapter-index-${pid}`, []);
    if (ids.length === 0) {
        // 兼容旧格式：从 plot-chapters-{pid} 迁移到分片存储
        const old = getJSONSync(`plot-chapters-${pid}`, null as Chapter[] | null);
        if (old && old.length > 0) {
            saveAllChapters(pid, old);
            // 迁移后删除旧聚合 key
            try { localStorage.removeItem(`plot-chapters-${pid}`); } catch { /* ignore */ }
            return old;
        }
        return [];
    }
    const chapters: Chapter[] = [];
    for (const id of ids) {
        const ch = getJSONSync(`chapter-${pid}-${id}`, null as Chapter | null);
        if (ch) chapters.push(ch);
    }
    return chapters;
}

/** 加载单个章节 */
export function loadChapter(pid: string, chapterId: string): Chapter | null {
    return getJSONSync(`chapter-${pid}-${chapterId}`, null as Chapter | null);
}

/** 保存单个章节（同步更新索引），返回结果对象 */
export function saveChapter(pid: string, chapter: Chapter): SaveResult {
    try {
        const raw = JSON.stringify(chapter);
        setSync(`chapter-${pid}-${chapter.id}`, raw);
        // 写后验证
        const readBack = getSync(`chapter-${pid}-${chapter.id}`);
        if (readBack !== raw) {
            return { ok: false, error: "写后验证失败" };
        }
        // 更新索引
        const ids: string[] = getJSONSync(`chapter-index-${pid}`, []);
        if (!ids.includes(chapter.id)) {
            ids.push(chapter.id);
            const idxOk = saveJSON(`chapter-index-${pid}`, ids);
            if (!idxOk) return { ok: false, error: "索引更新失败" };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

/** 批量保存所有章节（重建索引，不写旧聚合 key），返回结果对象 */
export function saveAllChapters(pid: string, chapters: Chapter[]): SaveResult {
    const errors: string[] = [];
    const ids: string[] = [];
    for (const ch of chapters) {
        const r = saveChapter(pid, ch);
        if (!r.ok) errors.push(`章节 ${ch.id}: ${r.error}`);
        ids.push(ch.id);
    }
    // 重建索引
    const idxOk = saveJSON(`chapter-index-${pid}`, ids);
    if (!idxOk) errors.push("索引重建失败");
    if (errors.length > 0) {
        return { ok: false, error: `${errors.length}/${chapters.length} 章节保存失败: ${errors.join("; ")}` };
    }
    return { ok: true };
}

/** 删除单个章节（同步更新索引） */
export function deleteChapter(pid: string, chapterId: string): void {
    const key = `chapter-${pid}-${chapterId}`;
    try { setJSONSync(key, null); } catch { /* ignore */ }
    const ids: string[] = getJSONSync(`chapter-index-${pid}`, []);
    const newIds = ids.filter(id => id !== chapterId);
    if (newIds.length !== ids.length) {
        setJSONSync(`chapter-index-${pid}`, newIds);
    }
}

/** 获取项目所有章节 ID（轻量读取，不加载正文） */
export function getChapterIds(pid: string): string[] {
    return getJSONSync(`chapter-index-${pid}`, []);
}
