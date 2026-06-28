// DataMigrateTab.tsx — 数据导入导出标签页（T9）
import { useState, useCallback } from "react";
import { Download, Upload, FileDown, AlertTriangle, X } from "lucide-react";
import { getSync, getJSONSync, setSync } from "@/lib/storage";
import { useAppStore } from "@/stores/app-store";
import { runIntegrityCheck } from "@/lib/diagnostics";
import { api, isTauri } from "@/lib/api";
import { clearMockStoreCache } from "@/lib/mock-backend";

interface ImportResult {
    ok: boolean;
    skipped: string[];
    errors: string[];
    warnings: string[];
    diagnostic: string[];
    /** 迁移统计 */
    projectsFound: number;
    chaptersMigrated: number;
    charactersMigrated: number;
    worldTermsMigrated: number;
    edgesMigrated: number;
    volumesMigrated: number;
    keysWritten: number;
}

export function DataMigrateTab() {
    const { currentProject } = useAppStore();
    const pid = currentProject?.id;
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [msg, setMsg] = useState("");
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [importCheckIssues, setImportCheckIssues] = useState<number>(0);


    /** 核心导出逻辑：收集指定前缀的 keys → JSON → Tauri 弹窗或 Blob 下载 */
    const doExport = useCallback(async (label: string, keyFilter: (k: string) => boolean) => {
        setExporting(true); setMsg("");
        try {
            const collected: { key: string; value: string }[] = [];
            const seenKeys = new Set<string>();
            // 1. 收集 localStorage keys
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (!keyFilter(key)) continue;
                const value = getSync(key);
                if (value !== null) {
                    collected.push({ key, value });
                    seenKeys.add(key);
                }
            }
            // 1.5 EXE 模式：补充 SQLite 中的 key（chapter-* 等不镜像到 localStorage 的 key）
            if (isTauri()) {
                try {
                    const sqliteKeys = await api.listAppSettings();
                    for (const item of sqliteKeys) {
                        const key = item.key;
                        const value = item.value;
                        if (seenKeys.has(key) || !keyFilter(key)) continue;
                        collected.push({ key, value });
                        seenKeys.add(key);
                    }
                } catch { /* skip */ }
            }
            // 2. 收集 projectsData（结构化项目数据，含剧情走向/章节正文/分片）
            let projectsData: any[] = [];
            try {
                const projects = await api.getProjects();
                for (const p of projects) {
                    try {
                        const pd = await api.exportProject(p.id);
                        if (pd) projectsData.push(pd);
                    } catch { /* skip single project */ }
                }
            } catch { /* skip */ }
            const data: Record<string, unknown> = { version: "2.0", exportedAt: new Date().toISOString(), keys: collected };
            if (projectsData.length > 0) data.projectsData = projectsData;
            const jsonStr = JSON.stringify(data, null, 2);
            const fileName = `${label}_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`;
            let saved = false;
            try {
                const blob = new Blob([jsonStr], { type: "application/json" });
                const { save } = await import("@tauri-apps/plugin-dialog");
                const { invoke } = await import("@tauri-apps/api/core");
                const filePath = await save({ defaultPath: fileName, filters: [{ name: "JSON", extensions: ["json"] }] });
                if (filePath) {
                    const buf = await blob.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    await invoke("save_export_file", { projectId: pid || "", filename: fileName, dataBase64: btoa(binary), filePath });
                    saved = true;
                }
            } catch { /* 降级到浏览器下载 */ }
            if (!saved) {
                const blob = new Blob([jsonStr], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
            }
            setMsg(`✅ ${label}已导出（${collected.length} 条）`); setTimeout(() => setMsg(""), 2500);
        } catch (e) { setMsg(`❌ 导出失败：${e}`); }
        setExporting(false);
    }, [pid]);

    /** 导出全部数据（所有 localStorage keys） */
    const handleExportAll = useCallback(() => doExport("全部数据备份", () => true), [doExport]);

    /** 导出当前项目（只含当前 projectId 的 key + 从 mock 中提取的项目数据） */
    const handleExportProject = useCallback(async () => {
        if (!pid) { setMsg("⚠️ 请先打开一个项目"); setTimeout(() => setMsg(""), 2000); return; }
        setExporting(true); setMsg("");
        try {
            const collected: { key: string; value: string }[] = [];
            const seenKeys = new Set<string>();
            // 1. 收集所有属于当前项目的 localStorage 分片 key
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || key === "novel-workbench-mock") continue;
                if (!key.includes(pid)) continue;
                const value = getSync(key);
                if (value !== null) {
                    collected.push({ key, value });
                    seenKeys.add(key);
                }
            }
            // 1.5 EXE 模式：补充 SQLite 中的 key（chapter-* 等不镜像到 localStorage 的 key）
            if (isTauri()) {
                try {
                    const sqliteKeys = await api.listAppSettings();
                    for (const item of sqliteKeys) {
                        const key = item.key;
                        const value = item.value;
                        if (seenKeys.has(key) || key === "novel-workbench-mock") continue;
                        if (!key.includes(pid)) continue;
                        collected.push({ key, value });
                        seenKeys.add(key);
                    }
                } catch { /* skip */ }
            }
            // 2. 从 novel-workbench-mock 中提取当前项目的数据
            const mock = getJSONSync("novel-workbench-mock", {} as any);
            if (mock && typeof mock === "object") {
                const projSlice: any = {
                    projects: (mock.projects || []).filter((p: any) => p.id === pid),
                    worldTerms: (mock.worldTerms || []).filter((t: any) => t.project_id === pid),
                    characters: (mock.characters || []).filter((c: any) => c.project_id === pid),
                    edges: (mock.edges || []).filter((e: any) => e.project_id === pid),
                    volumes: (mock.volumes || []).filter((v: any) => v.project_id === pid),
                };
                const volIds = new Set((projSlice.volumes || []).map((v: any) => v.id));
                projSlice.chapters = (mock.chapters || []).filter((c: any) => volIds.has(c.volume_id));
                const chIds = new Set((projSlice.chapters || []).map((c: any) => c.id));
                projSlice.beatCards = (mock.beatCards || []).filter((b: any) => chIds.has(b.chapter_id));
                projSlice.chapterContents = (mock.chapterContents || []).filter((c: any) => chIds.has(c.chapter_id));
                projSlice.plotEvents = (mock.plotEvents || []).filter((e: any) => e.project_id === pid);
                projSlice.timelineNodes = (mock.timelineNodes || []).filter((n: any) => n.project_id === pid);
                projSlice.lockedFields = (mock.lockedFields || []);
                projSlice.currentProjectId = pid;
                collected.push({ key: "novel-workbench-mock", value: JSON.stringify(projSlice) });
            }
            // 3. ★ 关键：调用 api.exportProject 获取结构化项目数据（含剧情走向/章节正文/分片）
            let projectsData: any[] = [];
            try {
                const pd = await api.exportProject(pid);
                if (pd) projectsData.push(pd);
            } catch { /* skip */ }
            const data: Record<string, unknown> = { version: "2.0", exportedAt: new Date().toISOString(), pid, keys: collected };
            if (projectsData.length > 0) data.projectsData = projectsData;
            const jsonStr = JSON.stringify(data, null, 2);
            const fileName = `项目「${currentProject?.name || pid}」_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`;
            let saved = false;
            try {
                const blob = new Blob([jsonStr], { type: "application/json" });
                const { save } = await import("@tauri-apps/plugin-dialog");
                const { invoke } = await import("@tauri-apps/api/core");
                const filePath = await save({ defaultPath: fileName, filters: [{ name: "JSON", extensions: ["json"] }] });
                if (filePath) {
                    const buf = await blob.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    await invoke("save_export_file", { projectId: pid, filename: fileName, dataBase64: btoa(binary), filePath });
                    saved = true;
                }
            } catch { /* 降级到浏览器下载 */ }
            if (!saved) {
                const blob = new Blob([jsonStr], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
            }
            setMsg(`✅ 项目已导出（${collected.length} 条）`); setTimeout(() => setMsg(""), 2500);
        } catch (e) { setMsg(`❌ 导出失败：${e}`); }
        setExporting(false);
    }, [pid, currentProject]);

    const handleImport = useCallback(async (file: File) => {
        setImporting(true); setImportResult(null); setImportCheckIssues(0);
        const result: ImportResult = {
            ok: true, skipped: [], errors: [], warnings: [], diagnostic: [],
            projectsFound: 0, chaptersMigrated: 0, charactersMigrated: 0,
            worldTermsMigrated: 0, edgesMigrated: 0, volumesMigrated: 0, keysWritten: 0,
        };
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            // 统一规整为带 projectsData 字段的对象，便于后续分支处理
            let data: any = parsed;
            let entries: { key: string; value: string }[] = Array.isArray(data?.keys) ? data.keys : [];

            // ★ 旧版格式兼容：当文件没有 keys 字段时，尝试识别其他常见格式并转换为 entries
            if (entries.length === 0) {
                // 格式 A: 直接是 mock store 对象（含 projects 字段）
                if (data && typeof data === "object" && Array.isArray(data.projects)) {
                    entries = [{ key: "novel-workbench-mock", value: JSON.stringify(data) }];
                    result.warnings.push("检测到旧版 mock store 格式，已自动转换");
                }
                // 格式 B: 直接是 projectsData 数组（后端 export_project 的批量格式）
                else if (data && Array.isArray(data.projectsData)) {
                    // 保留 data.projectsData 供后续分支处理；构造占位项让流程继续
                    entries = [{ key: "__placeholder__", value: "{}" }];
                    result.warnings.push("检测到 projectsData 数组格式");
                }
                // 格式 C: 直接是单个 projectData 对象（含 project 字段）
                else if (data && typeof data === "object" && data.project && typeof data.project === "object") {
                    const singleProjectData = data;
                    data = { projectsData: [singleProjectData] };
                    entries = [{ key: "__placeholder__", value: "{}" }];
                    result.warnings.push("检测到单项目对象格式");
                }
                // 格式 D: 顶层是数组，假设是 projectsData
                else if (Array.isArray(parsed)) {
                    data = { projectsData: parsed };
                    entries = [{ key: "__placeholder__", value: "{}" }];
                    result.warnings.push("检测到顶层数组格式");
                }
            }

            if (entries.length === 0) {
                result.errors.push("文件中没有可导入的数据，或文件格式无法识别");
                result.ok = false;
                setImportResult(result);
                setImporting(false);
                return;
            }

            // ★ 新版导出格式: projectsData 含结构化项目数据（剧情走向/章节正文/分片）
            const projectsData = data.projectsData as any[] | undefined;
            result.diagnostic.push(`[格式] keys=${data.keys?.length || 0}, projectsData=${projectsData?.length || 0}`);
            if (projectsData && projectsData.length > 0) {
                // ★ 不再注入 projectsData 到 mock store（会导致 mock store 分支用空数据抢先导入，
                //   projectsData 分支因 pidMap 已存在而跳过，丢失 chapterContents/plotSegments）。
                //   projectsData 分支会直接用 pd.chapterContents / pd.plotSegments 等完整数据导入。
                // 仅将 plotSegments/plotEdges/chapterShards 等 key 注入 entries 作为 extraKeys 回退源
                for (const pd of projectsData) {
                    if (!pd.project) continue;
                    const pid = pd.project.id;
                    if (pd.plotSegments) {
                        const sk = `plot-segments-${pid}`;
                        if (!entries.find(e => e.key === sk)) entries.push({ key: sk, value: JSON.stringify(pd.plotSegments) });
                    }
                    if (pd.plotEdges) {
                        const ek = `plot-edges-${pid}`;
                        if (!entries.find(e => e.key === ek)) entries.push({ key: ek, value: JSON.stringify(pd.plotEdges) });
                    }
                    if (pd.worldviewEdges) {
                        const wek = `worldview-edges-${pid}`;
                        if (!entries.find(e => e.key === wek)) entries.push({ key: wek, value: JSON.stringify(pd.worldviewEdges) });
                    }
                    if (pd.worldviewGroups) {
                        const gk = `worldview-groups-${pid}`;
                        if (!entries.find(e => e.key === gk)) entries.push({ key: gk, value: JSON.stringify(pd.worldviewGroups) });
                    }
                    if (pd.charGroups) {
                        const ck = `char-groups-${pid}`;
                        if (!entries.find(e => e.key === ck)) entries.push({ key: ck, value: JSON.stringify(pd.charGroups) });
                    }
                    if (pd.chapterShards) {
                        for (const [chId, chData] of Object.entries(pd.chapterShards as Record<string, any>)) {
                            const chk = `chapter-${pid}-${chId}`;
                            if (!entries.find(e => e.key === chk)) entries.push({ key: chk, value: JSON.stringify(chData) });
                        }
                    }
                    if (pd.chapterIndex) {
                        const cik = `chapter-index-${pid}`;
                        if (!entries.find(e => e.key === cik)) entries.push({ key: cik, value: JSON.stringify(pd.chapterIndex) });
                    }
                }
            }

            // ★ 导入项目：从 mock store 或 projectsData 提取项目，走 API 创建新书
            const pidMap: Record<string, string> = {};
            const extraKeys: { key: string; value: string }[] = [];
            const mockStores: any[] = [];

            for (const e of entries) {
                if (e.key === "novel-workbench-mock") {
                    try { mockStores.push(JSON.parse(e.value)); } catch { /* skip */ }
                } else if (e.key !== "__placeholder__") {
                    // 跳过格式识别阶段注入的占位项，避免污染 storage
                    extraKeys.push(e);
                }
            }
            result.diagnostic.push(`[解析] mockStores=${mockStores.length}, extraKeys=${extraKeys.length}`);
            // 记录 extraKeys 中关键 key 的存在情况
            const hasChapterShards = extraKeys.some(k => /^chapter-.+-.+$/.test(k.key) && !k.key.startsWith("chapter-index-"));
            const hasChapterIndex = extraKeys.some(k => k.key.startsWith("chapter-index-"));
            const hasPlotSegments = extraKeys.some(k => k.key.startsWith("plot-segments-"));
            result.diagnostic.push(`[extraKeys] 章节分片=${hasChapterShards}, 章节索引=${hasChapterIndex}, 剧情走向=${hasPlotSegments}`);

            // ★ Tauri 模式下 setJSONSync/setSync 是 fire-and-forget（异步不等待写入完成），
            // 导入完成后刷新页面会导致内存缓存丢失、数据未持久化到 SQLite。
            // persistWrite: 同步更新缓存 + 显式 await api.setSetting 确保持久化完成。
            const persistWrite = async (key: string, rawValue: string): Promise<void> => {
                setSync(key, rawValue); // 更新 _sqliteCache + localStorage（镜像 key）+ fire-and-forget
                // ★ 链路3：setSync 后立即验证数据是否可读（排查 _sqliteCache/localStorage 写入失败）
                if (key.startsWith("plot-segments-")) {
                    const rb = getSync(key);
                    const lb = localStorage.getItem(key);
                    result.diagnostic.push(
                        `[链路3-setSync后] ${key.slice(0, 30)} getSync=${rb !== null ? "Y" : "N"}(len=${rb?.length ?? -1}) local=${lb !== null ? "Y" : "N"}(len=${lb?.length ?? -1})`
                    );
                }
                if (isTauri()) {
                    try {
                        await api.setSetting(key, rawValue); // ★ 显式等待 SQLite 写入完成
                        // ★ 链路4：api.setSetting await 返回即成功
                        if (key.startsWith("plot-segments-")) {
                            result.diagnostic.push(`[链路4-setSetting] ${key.slice(0, 30)} await 完成（无异常）`);
                            // ★ 链路5：DB 直读验证（绕过 _sqliteCache 与 localStorage，直接从 SQLite 读取）
                            try {
                                const dbVal = await api.getSetting(key);
                                result.diagnostic.push(
                                    `[链路5-DB直读] ${key.slice(0, 30)} api.getSetting=${dbVal !== null ? "Y" : "N"}(len=${dbVal?.length ?? -1}) head=${(dbVal || "").slice(0, 60)}`
                                );
                            } catch (e) {
                                result.warnings.push(`DB 直读失败: ${key}: ${e}`);
                            }
                        }
                    } catch (e) {
                        result.warnings.push(`SQLite 写入失败: ${key}: ${e}`);
                    }
                }
            };
            const persistWriteJSON = async (key: string, value: unknown): Promise<void> => {
                await persistWrite(key, JSON.stringify(value));
            };

            // ★ 多源提取章节正文的通用函数
            const extractContent = (
                projChs: any[],
                projContents: any[],
                oldPid: string,
            ): Map<string, string> => {
                const contentMap = new Map<string, string>();
                // 源1: chapterContents.body_json.content（新版结构）
                for (const cc of projContents) {
                    const cid = cc.chapter_id || cc.chapterId || cc.id;
                    if (!cid) continue;
                    try {
                        const body = typeof cc.body_json === "string"
                            ? JSON.parse(cc.body_json || "{}")
                            : (cc.body_json || {});
                        if (body.content) { contentMap.set(cid, body.content); continue; }
                    } catch { /* fall through */ }
                    // 源2: chapterContents.body_html（纯文本回退）
                    if (cc.body_html) { contentMap.set(cid, cc.body_html); continue; }
                    // 源3: chapterContents 直接含 content 字段（旧版结构）
                    if (cc.content) { contentMap.set(cid, cc.content); continue; }
                    // 源4: chapterContents.text 字段
                    if (cc.text) { contentMap.set(cid, cc.text); }
                }
                // 源5: chapters 数组直接含 content 字段（旧版 mock store 格式）
                for (const ch of projChs) {
                    if (ch.id && !contentMap.has(ch.id) && ch.content) {
                        contentMap.set(ch.id, ch.content);
                    }
                }
                // 源6: plot-chapters-{oldPid} 旧版聚合 key
                const plotChaptersEntry = extraKeys.find(k => k.key === `plot-chapters-${oldPid}`);
                if (plotChaptersEntry) {
                    try {
                        const legacyChs = JSON.parse(plotChaptersEntry.value);
                        if (Array.isArray(legacyChs)) {
                            for (const lch of legacyChs) {
                                if (lch.id && !contentMap.has(lch.id) && lch.content) {
                                    contentMap.set(lch.id, lch.content);
                                }
                            }
                        }
                    } catch { /* skip */ }
                }
                // 源7: chapter-{oldPid}-{chId} 分片 key（现代版本逐章存储，含 content 字段）
                const shardPrefix = `chapter-${oldPid}-`;
                const indexKey = `chapter-index-${oldPid}`;
                for (const entry of extraKeys) {
                    if (!entry.key.startsWith(shardPrefix) || entry.key === indexKey) continue;
                    try {
                        const shard = JSON.parse(entry.value);
                        if (shard && shard.id && !contentMap.has(shard.id) && shard.content) {
                            contentMap.set(shard.id, shard.content);
                        }
                    } catch { /* skip malformed shard */ }
                }
                return contentMap;
            };

            // ★ 递归搜索数据中所有看起来像 PlotSegment 的对象（有 type: "bright"/"dark"）
            // 同时处理 JSON 字符串值（keys 数组中的 value 是字符串），尝试解析后递归
            const findPlotSegmentsInData = (obj: any, pid: string): any[] => {
                const results: any[] = [];
                const visited = new WeakSet();
                const search = (o: any) => {
                    if (!o || typeof o === "string") {
                        // 尝试解析 JSON 字符串（keys 数组中的 value 是字符串）
                        if (typeof o === "string" && (o.startsWith("[") || o.startsWith("{"))) {
                            try { search(JSON.parse(o)); } catch { /* not JSON */ }
                        }
                        return;
                    }
                    if (typeof o !== "object" || visited.has(o)) return;
                    visited.add(o);
                    if (Array.isArray(o)) {
                        const segs = o.filter((item: any) =>
                            item && typeof item === "object" &&
                            (item.type === "bright" || item.type === "dark") &&
                            (item.id || item.title)
                        );
                        if (segs.length > 0) {
                            const projSegs = segs.filter((s: any) => !s.project_id || s.project_id === pid);
                            if (projSegs.length > 0) results.push(...projSegs);
                        }
                        for (const item of o) search(item);
                    } else {
                        for (const key of Object.keys(o)) search(o[key]);
                    }
                };
                search(obj);
                return results;
            };

            // ★ 导入单个项目并重建章节分片/剧情走向的通用函数
            const importOneProject = async (
                proj: any,
                projChars: any[],
                projTerms: any[],
                projEdges: any[],
                projEvents: any[],
                projNodes: any[],
                projVols: any[],
                projChsIn: any[],
                projBeats: any[],
                projContents: any[],
                projSegments?: any[],
                projPlotEdges?: any[],
            ) => {
                const oldPid = proj.id;
                let projChs = projChsIn;

                // ★ 链路1-解析：记录输入数据特征（在 shard-recovery 之前）
                const _segCount = projSegments?.length || 0;
                const _firstSeg = _segCount > 0 ? {
                    id: projSegments![0].id?.slice(0, 8),
                    type: projSegments![0].type,
                    title: (projSegments![0].title || "").slice(0, 20),
                    project_id: projSegments![0].project_id?.slice(0, 8),
                } : null;
                const _firstCh = projChsIn.length > 0 ? {
                    id: projChsIn[0].id?.slice(0, 8),
                    title: (projChsIn[0].title || "").slice(0, 20),
                    hasContent: !!projChsIn[0].content,
                } : null;
                result.diagnostic.push(
                    `[链路1-解析] "${proj.name || oldPid}" oldPid=${oldPid?.slice(0, 8)} ` +
                    `chs=${projChsIn.length} segs=${_segCount} contents=${projContents?.length || 0} ` +
                    `firstSeg=${JSON.stringify(_firstSeg)} firstCh=${JSON.stringify(_firstCh)}`
                );

                // ★ 关键修复：现代版本章节存储在 chapter-{pid}-{chId} 分片 key 中，
                // 不在 mock store 的 chapters 数组里。当 projChs 为空时，从 extraKeys
                // 中的分片 key 恢复章节数据（含正文 content 和 volumeSegmentId）。
                if (projChs.length === 0) {
                    const shardPrefix = `chapter-${oldPid}-`;
                    const indexKey = `chapter-index-${oldPid}`;
                    const shardEntries = extraKeys.filter(k =>
                        k.key.startsWith(shardPrefix) && k.key !== indexKey
                    );
                    const shardChapters: any[] = [];
                    for (const entry of shardEntries) {
                        try {
                            const ch = JSON.parse(entry.value);
                            if (ch && ch.id) shardChapters.push(ch);
                        } catch { /* skip malformed shard */ }
                    }
                    // 按 chapter-index 排序，保留原始章节顺序
                    const indexEntry = extraKeys.find(k => k.key === indexKey);
                    if (indexEntry) {
                        try {
                            const ids: string[] = JSON.parse(indexEntry.value);
                            shardChapters.sort((a, b) => {
                                const ia = ids.indexOf(a.id);
                                const ib = ids.indexOf(b.id);
                                if (ia === -1 && ib === -1) return (a.number || 0) - (b.number || 0);
                                if (ia === -1) return 1;
                                if (ib === -1) return -1;
                                return ia - ib;
                            });
                        } catch { /* skip malformed index */ }
                    }
                    projChs = shardChapters;
                    if (projChs.length > 0) {
                        result.warnings.push(`项目「${proj.name || oldPid}」从分片存储恢复 ${projChs.length} 个章节`);
                    }
                }

                const importData: Record<string, unknown> = {
                    project: proj,
                    worldTerms: projTerms,
                    characters: projChars,
                    relationships: projEdges,
                    plotEvents: projEvents,
                    timelineNodes: projNodes,
                    volumes: projVols,
                    chapters: projChs,
                    beatCards: projBeats,
                    chapterContents: projContents,
                };
                try {
                    const newPid = await api.importProject(importData, "new");
                    pidMap[oldPid] = newPid;
                    result.projectsFound++;
                    result.diagnostic.push(`[导入] "${proj.name || oldPid}" oldPid=${oldPid?.slice(0, 8)} newPid=${newPid?.slice(0, 8)} chapters=${projChs.length} segments=${projSegments?.length || 0} contents=${projContents?.length || 0}`);
                    result.charactersMigrated += projChars.length;
                    result.worldTermsMigrated += projTerms.length;
                    result.edgesMigrated += projEdges.length;
                    result.volumesMigrated += projVols.length;
                    result.chaptersMigrated += projChs.length;

                    // ★ 确定 plot-segments 数据（多源提取 + 递归搜索 + 默认创建）
                    // WritingModule 把 type="bright" 的 segment 当作卷显示；没有 bright segment 时所有章节被过滤
                    let segments: any[] = projSegments || [];
                    // 源2: extraKeys 中的 plot-segments-${oldPid} key（精确匹配）
                    if (segments.length === 0) {
                        const segEntry = extraKeys.find(k => k.key === `plot-segments-${oldPid}`);
                        if (segEntry) {
                            try { segments = JSON.parse(segEntry.value); } catch { /* skip */ }
                            if (segments.length > 0) {
                                result.warnings.push(`项目「${proj.name || oldPid}」从 plot-segments key 恢复 ${segments.length} 条剧情走向`);
                            }
                        }
                    }
                    // 源2.5: 扫描所有 plot-segments-* key，找 project_id 匹配的 segments
                    // （处理 key 名中 PID 格式不同的情况，例如之前导入过导致 PID 不一致）
                    if (segments.length === 0) {
                        for (const k of extraKeys) {
                            if (!k.key.startsWith("plot-segments-")) continue;
                            try {
                                const segs = JSON.parse(k.value);
                                if (Array.isArray(segs)) {
                                    const matched = segs.filter((s: any) =>
                                        s && typeof s === "object" &&
                                        (s.type === "bright" || s.type === "dark") &&
                                        (!s.project_id || s.project_id === oldPid)
                                    );
                                    if (matched.length > 0) {
                                        segments = matched;
                                        result.warnings.push(`项目「${proj.name || oldPid}」从 key ${k.key} 匹配到 ${matched.length} 条剧情走向`);
                                        break;
                                    }
                                }
                            } catch { /* skip */ }
                        }
                    }
                    // 源3: 递归搜索数据中所有看起来像 PlotSegment 的对象（不依赖 key 名）
                    if (segments.length === 0) {
                        segments = findPlotSegmentsInData(data, oldPid);
                        if (segments.length > 0) {
                            result.warnings.push(`项目「${proj.name || oldPid}」通过数据结构识别找到 ${segments.length} 条剧情走向`);
                        }
                    }
                    // 源4: 从 volumes 重建（仅当完全没有 segment 数据时）
                    if (segments.length === 0 && projVols.length > 0) {
                        segments = projVols.map((v: any) => ({
                            id: v.id,
                            project_id: newPid,
                            type: "bright",
                            title: v.title || v.name || "未命名卷",
                            characters: "", location: "", time: "", event: "", chapters: "", beats: [],
                        }));
                        result.warnings.push(`项目「${proj.name || oldPid}」无剧情走向数据，已从卷册重建 ${segments.length} 条`);
                    }
                    // 源5: 创建默认 bright segment（确保卷章树至少有一个卷，否则所有章节被过滤）
                    if (segments.length === 0) {
                        segments = [{
                            id: `default-vol-${newPid}`,
                            project_id: newPid,
                            type: "bright",
                            title: "正文",
                            characters: "", location: "", time: "", event: "", chapters: "", beats: [],
                        }];
                        result.warnings.push(`项目「${proj.name || oldPid}」无卷册数据，已创建默认卷「正文」`);
                    }
                    // ★ 关键修复：WritingModule 会过滤掉 volumeSegmentId 不在 bright segment 中的章节。
                    // 如果 segments 存在但没有任何 bright segment（全 dark），所有章节会被过滤掉。
                    // 此处补充：若没有 bright segment，追加一个默认 bright segment 用于承载章节。
                    const hasBrightBefore = segments.some((s: any) => s.type === "bright");
                    if (!hasBrightBefore) {
                        const fallbackId = `default-vol-${newPid}`;
                        segments.push({
                            id: fallbackId,
                            project_id: newPid,
                            type: "bright",
                            title: "正文",
                            characters: "", location: "", time: "", event: "", chapters: "", beats: [],
                        });
                        result.warnings.push(`项目「${proj.name || oldPid}」现有 ${segments.length - 1} 条剧情走向但无明线段，已追加默认卷「正文」承载章节`);
                    }

                    // 重映射 project_id 并写入 plot-segments-${newPid}
                    const remappedSegs = segments.map((s: any) => ({ ...s, project_id: newPid }));
                    // ★ 链路2-准备：记录写入前的 raw 数据特征
                    const _segRaw = JSON.stringify(remappedSegs);
                    result.diagnostic.push(
                        `[链路2-准备] plot-segments-${newPid.slice(0, 8)} 将写入 ${remappedSegs.length} 条, ` +
                        `rawLen=${_segRaw.length}, rawHead=${_segRaw.slice(0, 80)}`
                    );
                    await persistWriteJSON(`plot-segments-${newPid}`, remappedSegs);
                    let _persistCount = 1;
                    result.diagnostic.push(`[写入] plot-segments-${newPid.slice(0, 8)} = ${remappedSegs.length} 条`);

                    // 收集所有 bright segment id（用于关联章节）
                    const brightIds = new Set(remappedSegs.filter((s: any) => s.type === "bright").map((s: any) => s.id));
                    const defaultVolId = remappedSegs.find((s: any) => s.type === "bright")?.id || newPid;

                    // 重建章节分片 key（chapter-{pid}-{chId}），确保写作台能读取正文
                    if (projChs.length > 0) {
                        const contentMap = extractContent(projChs, projContents, oldPid);
                        const shardIds: string[] = [];
                        let _skippedEmpty = 0;
                        for (const ch of projChs) {
                            const chId = ch.id;
                            // ★ 多源回退：extractContent结果 → 章节对象直接含 content →
                            //   直接从extraKeys的shard entry提取 → 空
                            let content = contentMap.get(chId) || ch.content || "";
                            let _directShardHit = false;
                            if (!content) {
                                const directShardKey = `chapter-${oldPid}-${chId}`;
                                const directEntry = extraKeys.find(k => k.key === directShardKey);
                                if (directEntry) {
                                    _directShardHit = true;
                                    try {
                                        const directShard = JSON.parse(directEntry.value);
                                        if (directShard?.content) content = directShard.content;
                                    } catch { /* skip */ }
                                }
                            }
                            // ★ 诊断：记录每个章节的 content 提取链路
                            result.diagnostic.push(
                                `[章节诊断] chId=${chId?.slice(0, 8)} title="${(ch.title || "").slice(0, 12)}" ` +
                                `contentMap命中=${contentMap.has(chId)} contentMapLen=${contentMap.get(chId)?.length ?? -1} ` +
                                `ch.contentLen=${ch.content?.length ?? -1} directShard=${_directShardHit ? "Y" : "N"} ` +
                                `最终contentLen=${content.length}`
                            );
                            // ★ 用户需求：没有章节数据（正文）则不强行创建空章节
                            if (!content) {
                                _skippedEmpty++;
                                continue;
                            }
                            // ★ 关联章节到 bright segment：优先用原有 volume_id/volumeSegmentId，否则关联到默认卷
                            let volId = ch.volume_id || ch.volumeSegmentId || "";
                            if (!brightIds.has(volId)) {
                                volId = defaultVolId;
                            }
                            const shard = {
                                id: chId,
                                volumeSegmentId: volId,
                                number: ch.number ?? 0,
                                title: ch.title || "",
                                content,
                            };
                            await persistWriteJSON(`chapter-${newPid}-${chId}`, shard);
                            _persistCount++;
                            shardIds.push(chId);
                        }
                        // ★ 只有存在有效章节时才写入 chapter-index
                        if (shardIds.length > 0) {
                            await persistWriteJSON(`chapter-index-${newPid}`, shardIds);
                            _persistCount++;
                        }
                        result.diagnostic.push(`[写入] 章节分片 ${shardIds.length} 个 + 索引 ${shardIds.length > 0 ? 1 : 0} (contentMap=${contentMap.size}, 跳过空=${_skippedEmpty})`);
                    }

                    // ★ 直接写入 plot-edges-${newPid}（剧情走向连线）
                    let plotEdges = projPlotEdges;
                    if (!plotEdges || plotEdges.length === 0) {
                        const edgeEntry = extraKeys.find(k => k.key === `plot-edges-${oldPid}`);
                        if (edgeEntry) {
                            try { plotEdges = JSON.parse(edgeEntry.value); } catch { /* skip */ }
                        }
                    }
                    if (plotEdges && plotEdges.length > 0) {
                        await persistWriteJSON(`plot-edges-${newPid}`, plotEdges);
                        _persistCount++;
                    }

                    // ★ 直接写入其他项目级独立 key（worldview-edges/groups, char-groups）
                    for (const prefix of ["worldview-edges-", "worldview-groups-", "char-groups-"]) {
                        const oldKey = `${prefix}${oldPid}`;
                        const entry = extraKeys.find(k => k.key === oldKey);
                        if (entry) {
                            await persistWrite(`${prefix}${newPid}`, entry.value);
                            _persistCount++;
                        }
                    }

                    result.keysWritten += _persistCount;
                    result.diagnostic.push(`[持久化] "${proj.name || oldPid}" 共写入 ${_persistCount} 个 key (await api.setSetting)`);

                    // ★ 链路6-回读：确认写入的 key 能被 getJSONSync 读到（诊断 prewarm/cache 链路）
                    const verifySegKey = `plot-segments-${newPid}`;
                    const verifySegRaw = getSync(verifySegKey);          // 原始字符串（localStorage + _sqliteCache）
                    const verifySegs = getJSONSync(verifySegKey, [] as any[]);  // 解析后
                    const verifySegLocal = localStorage.getItem(verifySegKey);   // 直接 localStorage
                    const verifyIdx = getJSONSync(`chapter-index-${newPid}`, [] as any[]);
                    let verifyShardOk = 0;
                    for (const sid of verifyIdx) {
                        if (getJSONSync(`chapter-${newPid}-${sid}`, null as any)) verifyShardOk++;
                    }
                    result.diagnostic.push(
                        `[链路6-回读] newPid=${newPid?.slice(0, 8)} ` +
                        `plot-seg raw=${verifySegRaw !== null ? "Y" : "N"}(len=${verifySegRaw?.length ?? -1}) ` +
                        `parsed=${verifySegs.length} ` +
                        `local=${verifySegLocal !== null ? "Y" : "N"}(len=${verifySegLocal?.length ?? -1}) ` +
                        `chapter-index=${verifyIdx.length} shards=${verifyShardOk}/${verifyIdx.length} ` +
                        `isTauri=${isTauri()}`
                    );
                    // 如果 raw 有值但 parsed 为 0，说明 JSON 解析失败
                    if (verifySegRaw !== null && verifySegs.length === 0) {
                        result.warnings.push(`plot-segments JSON 解析失败: rawStart=${verifySegRaw.slice(0, 80)}`);
                    }
                } catch (e) {
                    result.errors.push(`导入项目「${proj.name || oldPid}」失败: ${e}`);
                }
            };

            // ★ 从 mock store 提取项目并导入（格式 A）
            for (const mock of mockStores) {
                const projects = mock.projects || [];
                // ★ 字段名兼容：旧版后端导出用 relationships，新版 mock store 用 edges
                const edgesList = (mock.edges || mock.relationships || []).filter((e: any) => e);
                for (const proj of projects) {
                    const oldPid = proj.id;
                    if (!oldPid) continue;
                    result.diagnostic.push(`[mock分支] 处理 "${proj.name || oldPid}" chs=${(mock.chapters || []).length} contents=${(mock.chapterContents || []).length}`);
                    const projChars = (mock.characters || []).filter((c: any) => c.project_id === oldPid);
                    const projTerms = (mock.worldTerms || []).filter((t: any) => t.project_id === oldPid);
                    const projEdges = edgesList.filter((e: any) => e.project_id === oldPid);
                    const projEvents = (mock.plotEvents || []).filter((e: any) => e.project_id === oldPid);
                    const projNodes = (mock.timelineNodes || []).filter((n: any) => n.project_id === oldPid);
                    const projVols = (mock.volumes || []).filter((v: any) => v.project_id === oldPid);
                    const volIds = new Set(projVols.map((v: any) => v.id));
                    // ★ chapters 过滤：优先按 volume_id，回退按 volumeSegmentId（现代分片格式），再回退按 project_id，再回退取全部
                    let projChs = (mock.chapters || []).filter((c: any) => volIds.has(c.volume_id));
                    if (projChs.length === 0 && (mock.chapters || []).length > 0) {
                        projChs = (mock.chapters || []).filter((c: any) => volIds.has(c.volumeSegmentId));
                    }
                    if (projChs.length === 0 && (mock.chapters || []).length > 0) {
                        projChs = (mock.chapters || []).filter((c: any) => c.project_id === oldPid);
                    }
                    if (projChs.length === 0 && (mock.chapters || []).length > 0) {
                        projChs = (mock.chapters || []).slice();
                    }
                    const chIds = new Set(projChs.map((c: any) => c.id));
                    const projBeats = (mock.beatCards || []).filter((b: any) => chIds.has(b.chapter_id));
                    let projContents = (mock.chapterContents || []).filter((cc: any) => chIds.has(cc.chapter_id));
                    // ★ 从 projectsData 中查找匹配的 plotSegments/plotEdges/chapterContents
                    const matchedPd = projectsData?.find((pd: any) => pd.project?.id === oldPid);
                    const mockProjSegs = matchedPd?.plotSegments;
                    const mockProjPlotEdges = matchedPd?.plotEdges;
                    // ★ 关键修复：mock store 的 chapterContents 可能为空（写作台存章节走 shard key，
                    // 不经过 api.saveChapterContent），此时合并 projectsData 中的 chapterContents 确保正文可提取
                    if (projContents.length === 0 && matchedPd?.chapterContents?.length > 0) {
                        const pdContents = (matchedPd.chapterContents as any[]).filter((cc: any) =>
                            chIds.has(cc.chapter_id || cc.chapterId || cc.id)
                        );
                        if (pdContents.length > 0) {
                            projContents = pdContents;
                            result.warnings.push(`项目「${proj.name || oldPid}」从 projectsData 补充 ${pdContents.length} 条章节正文`);
                        }
                    }
                    await importOneProject(proj, projChars, projTerms, projEdges, projEvents, projNodes, projVols, projChs, projBeats, projContents, mockProjSegs, mockProjPlotEdges);
                }
            }

            // ★ 从 projectsData 直接导入（格式 B/C/D）—— 弥补 mockStores 为空的情况
            if (projectsData && projectsData.length > 0) {
                for (const pd of projectsData) {
                    const proj = pd.project;
                    if (!proj || !proj.id) continue;
                    const oldPid = proj.id;
                    // 如果该项目已通过 mockStores 导入过，跳过
                    if (pidMap[oldPid]) continue;
                    const projChars = pd.characters || [];
                    const projTerms = pd.worldTerms || [];
                    const projEdges = pd.relationships || pd.edges || [];
                    const projEvents = pd.plotEvents || [];
                    const projNodes = pd.timelineNodes || [];
                    const projVols = pd.volumes || [];
                    // chapters 可能直接含 content（旧版格式）
                    let projChs = pd.chapters || [];
                    const projBeats = pd.beatCards || [];
                    const projContents = pd.chapterContents || [];
                    // ★ 如果 projectsData 中没有 chapters，尝试从 plot-chapters key 提取
                    if (projChs.length === 0) {
                        const plotChaptersEntry = extraKeys.find(k => k.key === `plot-chapters-${oldPid}`);
                        if (plotChaptersEntry) {
                            try {
                                const legacyChs = JSON.parse(plotChaptersEntry.value);
                                if (Array.isArray(legacyChs)) projChs = legacyChs;
                            } catch { /* skip */ }
                        }
                    }
                    // ★ 传入 plotSegments 和 plotEdges（export_project 导出的独立 key 数据）
                    const projSegments = pd.plotSegments || [];
                    const projPlotEdges = pd.plotEdges || [];
                    await importOneProject(proj, projChars, projTerms, projEdges, projEvents, projNodes, projVols, projChs, projBeats, projContents, projSegments, projPlotEdges);
                }
            }

            // 写入额外 key（含 PID 重映射）
            // 跳过已在上文 importOneProject 中处理的 key，避免覆盖重建的数据
            // 注意：保留 plot-chapters- key 写入作为安全网（分片写入失败时 loadAllChapters 可从旧 key 迁移）
            for (const { key, value } of extraKeys) {
                try {
                    // 跳过章节分片/索引 key（已在 importOneProject 中重建）
                    if (key.startsWith("chapter-index-")) continue;
                    if (/^chapter-.+-.+$/.test(key)) continue;
                    // 跳过剧情走向/世界观/角色分组的独立 key（已在 importOneProject 中写入）
                    if (key.startsWith("plot-segments-")) continue;
                    if (key.startsWith("plot-edges-")) continue;
                    if (key.startsWith("worldview-edges-")) continue;
                    if (key.startsWith("worldview-groups-")) continue;
                    if (key.startsWith("char-groups-")) continue;
                    let finalKey = key;
                    for (const [oldPid, newPid] of Object.entries(pidMap)) {
                        if (key.includes(oldPid)) {
                            finalKey = key.replace(new RegExp(oldPid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), newPid);
                            break;
                        }
                    }
                    // ★ 使用 persistWrite 确保 Tauri 模式下 SQLite 写入完成
                    await persistWrite(finalKey, value);
                    result.keysWritten++;
                } catch (e) {
                    result.errors.push(`${key}: ${e}`);
                }
            }

            // ★ 诊断汇总
            result.diagnostic.push(`[汇总] pidMap=${Object.keys(pidMap).length} 个项目映射, keysWritten=${result.keysWritten}, chaptersMigrated=${result.chaptersMigrated}`);
            if (Object.keys(pidMap).length === 0) {
                result.diagnostic.push(`[警告] 没有项目被导入！mockStores=${mockStores.length}, projectsData=${projectsData?.length || 0}。如果备份文件缺少 projectsData/mock store，章节和剧情数据无法关联到项目。`);
            }

            // ★ 导入后完整性检查
            if (result.keysWritten > 0 || result.chaptersMigrated > 0) {
                const issues = runIntegrityCheck();
                const errCount = issues.filter(i => i.severity === "error").length;
                setImportCheckIssues(errCount);
                if (errCount > 0) result.warnings.push(`导入后完整性检查发现 ${errCount} 个错误（请在诊断日志中查看详情）`);
            }

            // ★ 刷新缓存 + 重新加载项目列表（否则欢迎页看不到新导入的项目）
            if (result.keysWritten > 0 || result.chaptersMigrated > 0 || result.charactersMigrated > 0) {
                useAppStore.getState().bumpSaveAll();
                clearMockStoreCache();
                try {
                    const list = await api.getProjects();
                    useAppStore.getState().setProjects(list);
                    // ★ 诊断：记录项目列表 ID 与 pidMap 的匹配情况
                    const pidMapEntries = Object.entries(pidMap);
                    const listIds = list.map((p: any) => p.id?.slice(0, 8));
                    const matched = pidMapEntries.filter(([, newPid]) => list.some((p: any) => p.id === newPid));
                    result.diagnostic.push(
                        `[刷新] 项目列表 ${list.length} 个, pidMap ${pidMapEntries.length} 个, 匹配 ${matched.length} 个. ` +
                        `listIds=[${listIds.join(",")}] pidMap.newPids=[${pidMapEntries.map(([, n]) => n?.slice(0, 8)).join(",")}]`
                    );
                } catch (e) {
                    result.warnings.push(`刷新项目列表失败: ${e}`);
                }
            }
        } catch (e) {
            result.ok = false;
            result.errors.push(`文件解析失败: ${e}`);
        }
        setImportResult(result);
        setImporting(false);
    }, []);

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">数据迁移</h3>

            {/* 导出 */}
            <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">导出数据</h4>
                <p className="text-xs text-slate-400 mb-3">导出为 JSON 文件，可在其他设备上导入</p>
                <div className="flex items-center gap-2">
                    <button onClick={handleExportProject} disabled={exporting || !pid}
                        className="flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                        title="仅导出当前项目的数据">
                        <FileDown className="h-4 w-4" />{exporting ? "导出中..." : "导出当前项目"}
                    </button>
                    <button onClick={handleExportAll} disabled={exporting}
                        className="flex items-center gap-2 rounded-md border border-violet-300 px-4 py-2 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        title="导出所有项目的数据">
                        <Download className="h-4 w-4" />{exporting ? "导出中..." : "导出全部数据"}
                    </button>
                </div>
            </div>

            {/* 导入 */}
            <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">导入数据</h4>
                <p className="text-xs text-slate-400 mb-3">支持导入新版或旧版 JSON 备份文件，自动识别格式并迁移</p>
                <label className="flex items-center gap-2 rounded-md border-2 border-dashed border-slate-300 p-6 text-center cursor-pointer hover:border-violet-400">
                    <Upload className="h-5 w-5 text-slate-400" />
                    <span className="text-sm text-slate-500">{importing ? "导入中..." : "点击选择 JSON 文件"}</span>
                    <input type="file" accept=".json" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
                </label>
                {importResult && (
                    <div className="mt-3 space-y-1">
                        <div className="flex items-start justify-between">
                            <span className="text-xs font-medium text-slate-600">导入结果</span>
                            <button type="button" onClick={() => { setImportResult(null); window.location.reload(); }} className="rounded p-0.5 text-slate-400 hover:text-slate-600" title="关闭并刷新">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className={`rounded p-2 text-xs ${importResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                            {importResult.chaptersMigrated > 0 || importResult.charactersMigrated > 0 ? (
                                <>
                                    迁移完成：{importResult.projectsFound} 个项目
                                    {importResult.charactersMigrated > 0 && ` | ${importResult.charactersMigrated} 个角色`}
                                    {importResult.worldTermsMigrated > 0 && ` | ${importResult.worldTermsMigrated} 个词条`}
                                    {importResult.edgesMigrated > 0 && ` | ${importResult.edgesMigrated} 条关系`}
                                    {importResult.chaptersMigrated > 0 && ` | ${importResult.chaptersMigrated} 个章节`}
                                    <div className="mt-1 font-medium">→ 请关闭设置，返回欢迎页查看新导入的项目</div>
                                </>
                            ) : (
                                <>已写入 {importResult.keysWritten} 个数据项，跳过 {importResult.skipped.length} 项</>
                            )}
                            {importResult.errors.length > 0 && <span className="text-red-500 ml-1">，{importResult.errors.length} 个错误</span>}
                        </div>
                        {importResult.warnings.length > 0 && (
                            <div className="rounded p-2 text-xs bg-amber-50 text-amber-700">
                                {importResult.warnings.map((w, i) => (
                                    <div key={i} className="flex items-start gap-1">
                                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                        <span>{w}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {importCheckIssues > 0 && (
                            <div className="rounded p-2 text-xs bg-red-50 text-red-700">
                                ⚠️ 导入后完整性检查发现 {importCheckIssues} 个数据错误，请到「设置 → 诊断日志 → 完整性检查」查看详情
                            </div>
                        )}
                        {importResult.diagnostic.length > 0 && (
                            <details className="rounded p-2 text-xs bg-slate-50 text-slate-600">
                                <summary className="cursor-pointer font-medium text-slate-500">诊断日志（{importResult.diagnostic.length} 条）— 点击展开</summary>
                                <div className="mt-1 space-y-0.5 font-mono">
                                    {importResult.diagnostic.map((d, i) => (
                                        <div key={i} className="whitespace-pre-wrap">{d}</div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </div>

            {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
    );
}
