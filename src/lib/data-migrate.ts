/**
 * 数据迁移引擎 v2 — 导入时自动识别旧版格式并迁移
 *
 * 核心原则：**按项目为单位整合数据**。
 * 每本书的数据（项目、角色、词条、卷、章节）绑定导入，
 * 不与其他书的同名 id 混淆。
 */

import { getSync, setSync, setJSONSync } from "./storage";
import { clearMockStoreCache } from "./mock-backend";

export interface MigrationResult {
    projectsFound: number;
    chaptersMigrated: number;
    charactersMigrated: number;
    worldTermsMigrated: number;
    edgesMigrated: number;
    volumesMigrated: number;
    keysWritten: string[];
    errors: string[];
}

/** 将导入的一批 key-value 对迁移到新版格式 */
export function migrateImport(entries: { key: string; value: string }[]): MigrationResult {
    const result: MigrationResult = {
        projectsFound: 0, chaptersMigrated: 0, charactersMigrated: 0,
        worldTermsMigrated: 0, edgesMigrated: 0, volumesMigrated: 0,
        keysWritten: [], errors: [],
    };

    // === 第一遍：收集所有数据 ===
    const mockStores: any[] = [];                 // novel-workbench-mock
    const plotChaptersByPid: Record<string, any[]> = {};
    const otherKeys: { key: string; value: string }[] = [];

    for (const { key, value } of entries) {
        if (key === "novel-workbench-mock") {
            try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === "object") mockStores.push(parsed);
            } catch { result.errors.push("novel-workbench-mock JSON 解析失败"); }
            continue;
        }
        const m = key.match(/^plot-chapters-(.+)$/);
        if (m) {
            try {
                const chs = JSON.parse(value);
                if (Array.isArray(chs) && chs.length > 0) plotChaptersByPid[m[1]] = chs;
            } catch { /* skip */ }
            continue;
        }
        otherKeys.push({ key, value });
    }

    // === 第二遍：按项目写入（每本书独立） ===
    const currentRaw = getSync("novel-workbench-mock");
    const cur = (() => {
        if (!currentRaw) return { projects: [], worldTerms: [], characters: [], edges: [], volumes: [], chapters: [], beatCards: [], chapterContents: [], plotEvents: [], timelineNodes: [], lockedFields: [], _migrated_v2: false };
        try { return JSON.parse(currentRaw); } catch { return { projects: [], worldTerms: [], characters: [], edges: [], volumes: [], chapters: [], beatCards: [], chapterContents: [], plotEvents: [], timelineNodes: [], lockedFields: [], _migrated_v2: false }; }
    })();

    console.log("[migrate] 导入文件包含 mockStores 数量:", mockStores.length);
    console.log("[migrate] 当前已有项目:", (cur.projects || []).map((p: any) => p.name || p.id));

    // 已有项目 ID 集合
    const existingProjIds = new Set((cur.projects || []).map((p: any) => p.id));

    for (const store of mockStores) {
        const projects = store.projects || [];
        const charactersItems = store.characters || [];
        const worldTermsItems = store.worldTerms || [];
        // ★ 字段名兼容：旧版后端导出用 relationships，新版 mock store 用 edges
        const edgesItems = store.edges || store.relationships || [];
        const volumesItems = store.volumes || [];
        const chaptersItems = store.chapters || [];
        const beatCardsItems = store.beatCards || [];
        const chapterContentsItems = store.chapterContents || [];
        const plotEventsItems = store.plotEvents || [];
        const timelineNodesItems = store.timelineNodes || [];
        // 按 project_id 分组
        for (const proj of projects) {
            const pid = proj.id;
            if (!pid) continue;
            console.log("[migrate] 发现项目:", proj.name, pid, existingProjIds.has(pid) ? "(已存在，跳过)" : "(新项目)");
            if (existingProjIds.has(pid)) continue; // 跳过已存在的项目

            result.projectsFound++;
            // 1. 项目
            cur.projects.push(proj);

            // 2. 角色
            const projChars = charactersItems.filter((c: any) => c.project_id === pid);
            for (const c of projChars) { cur.characters.push(c); result.charactersMigrated++; }

            // 3. 词条
            const projTerms = worldTermsItems.filter((t: any) => t.project_id === pid);
            for (const t of projTerms) { cur.worldTerms.push(t); result.worldTermsMigrated++; }

            // 4. 关系边
            const projEdges = edgesItems.filter((e: any) => e.project_id === pid);
            for (const e of projEdges) { cur.edges.push(e); result.edgesMigrated++; }

            // 5. 卷
            const projVols = volumesItems.filter((v: any) => v.project_id === pid);
            for (const v of projVols) { cur.volumes.push(v); result.volumesMigrated++; }

            // 6. 章节（按 volume 引用）
            const projVolIds = new Set(projVols.map((v: any) => v.id));
            const projChs = chaptersItems.filter((c: any) => projVolIds.has(c.volume_id));
            const projChIds = new Set(projChs.map((c: any) => c.id));
            for (const c of projChs) { cur.chapters.push(c); }

            // 7. beatCards / chapterContents
            const projBeatCards = beatCardsItems.filter((b: any) => projChIds.has(b.chapter_id));
            for (const b of projBeatCards) cur.beatCards.push(b);
            const projContents = chapterContentsItems.filter((c: any) => projChIds.has(c.chapter_id));
            for (const c of projContents) cur.chapterContents.push(c);

            // 8. plotEvents / timelineNodes
            const projEvents = plotEventsItems.filter((e: any) => e.project_id === pid);
            for (const e of projEvents) cur.plotEvents.push(e);
            const projNodes = timelineNodesItems.filter((n: any) => n.project_id === pid);
            for (const n of projNodes) cur.timelineNodes.push(n);

            existingProjIds.add(pid);
        }
    }

    cur._migrated_v2 = true;
    setSync("novel-workbench-mock", JSON.stringify(cur));
    // ★ 清除 mock 内存缓存，强制下次从 localStorage 重新读取
    clearMockStoreCache();
    result.keysWritten.push("novel-workbench-mock");

    // === 第三遍：迁移 plot-chapters（旧版章节） ===
    for (const [pid, chs] of Object.entries(plotChaptersByPid)) {
        try {
            const ids: string[] = [];
            for (const ch of chs) {
                if (!ch.id) ch.id = crypto.randomUUID?.() || "gen-" + Math.random().toString(36).slice(2);
                ids.push(ch.id);
                setJSONSync(`chapter-${pid}-${ch.id}`, ch);
            }
            setJSONSync(`chapter-index-${pid}`, ids);
            result.chaptersMigrated += chs.length;
            result.keysWritten.push(`chapter-index-${pid}`);
        } catch (e) {
            result.errors.push(`章节迁移失败 (${pid}): ${e}`);
        }
    }

    // === 第四遍：写入其余 key ===
    for (const { key, value } of otherKeys) {
        try { setSync(key, value); result.keysWritten.push(key); } catch (e) { result.errors.push(`${key}: ${e}`); }
    }

    return result;
}
