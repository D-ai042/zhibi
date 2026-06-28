import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import {
    FileText, Trash2, File as FileIcon, Image as ImageIcon, Sparkles,
    FileUp, Folder, FolderPlus, ChevronRight, ChevronDown
} from "lucide-react";
import { uuid } from "@/lib/uuid";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { confirmDialog, alertDialog } from "@/lib/confirm";

// ===== 支持上传的文件类型 =====
const TEXT_EXTS = [".txt", ".md", ".json", ".csv", ".yaml", ".yml", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h", ".rs", ".go", ".rb", ".sh", ".bat", ".ps1", ".env", ".cfg", ".ini", ".toml", ".tex", ".rtf", ".log"];
const DOCX_EXTS = [".docx"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
const ALL_EXTS = [...TEXT_EXTS, ...DOCX_EXTS, ...IMAGE_EXTS];

// ===== 类型定义 =====
interface MaterialGroup {
    id: string;
    name: string;
    createdAt: string;
}

interface MaterialItem {
    id: string;
    name: string;
    content: string;
    type: "text" | "upload" | "image";
    groupId: string | null;
    fileType?: string;
    fileSize?: number;
    createdAt: string;
    structureAnalysis?: string;
}

// ===== storage =====
function storageKey(pid: string, kind: string) { return `material-${kind}-${pid}`; }
function load<T>(pid: string, kind: string, def: T): T { return getJSONSync(storageKey(pid, kind), def); }
function save<T>(pid: string, kind: string, data: T) { setJSONSync(storageKey(pid, kind), data); }

function fmtSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function extName(file: string) {
    return "." + file.split(".").pop()?.toLowerCase();
}

/** 拖拽高亮状态 */
type DragState = { over: boolean; groupTarget: string | null };

export function MaterialModule() {
    const { currentProject } = useAppStore();
    const pid = currentProject?.id;

    const [groups, setGroups] = useState<MaterialGroup[]>([]);
    const [items, setItems] = useState<MaterialItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState("");
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [dragState, setDragState] = useState<DragState>({ over: false, groupTarget: null });
    const [uploading, setUploading] = useState(false);
    const [analyzingId, setAnalyzingId] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [newGroupName, setNewGroupName] = useState("");
    const [showNewGroup, setShowNewGroup] = useState(false);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteDialog, setDeleteDialog] = useState<{ groupId: string; groupName: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropRef = useRef<HTMLDivElement>(null);

    // ===== 数据加载 =====
    useEffect(() => {
        if (!pid) return;
        setGroups(load(pid, "groups", []));
        setItems(load(pid, "items", []));
    }, [pid]);

    const persist = useCallback((g: MaterialGroup[], i: MaterialItem[]) => {
        if (!pid) return;
        save(pid, "groups", g);
        save(pid, "items", i);
        setGroups(g);
        setItems(i);
    }, [pid]);

    // ===== 分组操作 =====
    const addGroup = useCallback(() => {
        if (!pid || !newGroupName.trim()) return;
        const g: MaterialGroup = { id: uuid(), name: newGroupName.trim(), createdAt: new Date().toLocaleString("zh-CN") };
        persist([...groups, g], items);
        setSelectedGroupId(g.id);
        setNewGroupName("");
        setShowNewGroup(false);
    }, [pid, newGroupName, groups, items, persist]);

    const deleteGroup = useCallback((gid: string, deleteItems: boolean) => {
        if (!pid) return;
        const ng = groups.filter(g => g.id !== gid);
        const ni = deleteItems ? items.filter(i => i.groupId !== gid) : items.map(i => i.groupId === gid ? { ...i, groupId: null } : i);
        persist(ng, ni);
        setDeleteDialog(null);
    }, [pid, groups, items, persist]);

    const moveItemToGroup = useCallback((itemId: string, gid: string | null) => {
        if (!pid) return;
        persist(groups, items.map(i => i.id === itemId ? { ...i, groupId: gid } : i));
    }, [pid, groups, items, persist]);

    const moveSelectedToGroup = useCallback((gid: string | null) => {
        if (!pid || selectedIds.size === 0) return;
        persist(groups, items.map(i => selectedIds.has(i.id) ? { ...i, groupId: gid } : i));
        setSelectedIds(new Set());
    }, [pid, groups, items, selectedIds, persist]);

    const deleteSelectedItems = useCallback(() => {
        if (!pid || selectedIds.size === 0) return;
        confirmDialog(`确定删除选中的 ${selectedIds.size} 项素材？此操作不可恢复。`).then(ok => { if (!ok) return;
        persist(groups, items.filter(i => !selectedIds.has(i.id)));
        if (selectedId && selectedIds.has(selectedId)) { setSelectedId(null); setEditingContent(""); }
        setSelectedIds(new Set()); });
    }, [pid, groups, items, selectedIds, selectedId, persist]);

    const toggleSelectGroup = useCallback((itemIds: string[]) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            const allSelected = itemIds.every(id => next.has(id));
            if (allSelected) { itemIds.forEach(id => next.delete(id)); }
            else { itemIds.forEach(id => next.add(id)); }
            return next;
        });
    }, []);

    // ===== 素材重命名 =====
    const startRename = useCallback((id: string, currentName: string) => {
        setRenamingId(id);
        setRenamingGroupId(null);
        setRenameValue(currentName);
    }, []);

    const confirmRename = useCallback(() => {
        if (!pid || !renamingId || !renameValue.trim()) { setRenamingId(null); return; }
        persist(groups, items.map(i => i.id === renamingId ? { ...i, name: renameValue.trim() } : i));
        setRenamingId(null);
    }, [pid, renamingId, renameValue, groups, items, persist]);

    const cancelRename = useCallback(() => { setRenamingId(null); }, []);

    // ===== 分组重命名（内联） =====
    const startGroupRename = useCallback((gid: string, currentName: string) => {
        setRenamingGroupId(gid);
        setRenamingId(null);
        setRenameValue(currentName);
    }, []);

    const confirmGroupRename = useCallback(() => {
        if (!pid || !renamingGroupId || !renameValue.trim()) { setRenamingGroupId(null); return; }
        persist(groups.map(g => g.id === renamingGroupId ? { ...g, name: renameValue.trim() } : g), items);
        setRenamingGroupId(null);
    }, [pid, renamingGroupId, renameValue, groups, items, persist]);

    const cancelGroupRename = useCallback(() => { setRenamingGroupId(null); }, []);

    const toggleCollapse = useCallback((gid: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(gid)) next.delete(gid); else next.add(gid);
            return next;
        });
    }, []);

    // ===== 素材操作 =====
    const addTextItem = useCallback((groupId: string | null) => {
        if (!pid || !newName.trim()) return;
        const item: MaterialItem = {
            id: uuid(), name: newName.trim(), content: "", type: "text",
            groupId, createdAt: new Date().toLocaleString("zh-CN"),
        };
        persist(groups, [...items, item]);
        setSelectedId(item.id);
        setEditingContent("");
        setNewName("");
    }, [pid, newName, groups, items, persist]);

    const deleteItem = useCallback((id: string) => {
        if (!pid) return;
        persist(groups, items.filter(i => i.id !== id));
        if (selectedId === id) { setSelectedId(null); setEditingContent(""); }
    }, [pid, groups, items, selectedId, persist]);

    const saveContent = useCallback(() => {
        if (!pid || !selectedId) return;
        const sel = items.find(i => i.id === selectedId);
        if (!sel || sel.type === "image") return;
        persist(groups, items.map(i => i.id === selectedId ? { ...i, content: editingContent } : i));
    }, [pid, selectedId, editingContent, groups, items, persist]);

    // ===== 结构分析（AI 提取情节骨架） =====
    const analyzeStructure = useCallback(async (item: MaterialItem) => {
        if (!pid) return;
        if (!item.content || item.content.length < 500) {
            alertDialog("素材内容不足 500 字，无法分析结构");
            return;
        }
        setAnalyzingId(item.id);
        try {
            const { api } = await import("@/lib/api");
            const sample = item.content.slice(0, 8000);
            const res = await api.aiComplete({
                action: "chat",
                entity_type: "beats",
                entity_id: pid,
                extra: {
                    system_hint: `你是资深小说结构分析师。你的任务是把一段小说/素材拆解为情节骨架——场景链+每场景的情节动作+情绪曲线。
不分析文笔、不评价好坏，只提取"这一段发生了什么事，怎么发生的"。输出纯文本。`,
                    user_message: `分析以下素材的故事结构：

${sample}

请输出以下格式的文本（不要JSON，不要标记）：

【场景链】
场景1：场景名称
  情节功能：
  核心动作：
  情绪基调：

场景2：
  ...

【情绪曲线】
开篇：
低谷：
高潮：
收尾：

【爽点机制】

【推荐用法】`,
                    history: [],
                },
            });
            if (res.content && !res.error) {
                const analysis = res.content.trim();
                const updatedItems = items.map(i => i.id === item.id ? { ...i, structureAnalysis: analysis } : i);
                persist(groups, updatedItems);
                // 注意：不覆盖 editingContent —— 编辑区始终保留原文，分析结果只展示在结构分析折叠区
            } else {
                alertDialog("分析失败：" + (res.error || "未知错误"));
            }
        } catch (e: any) {
            alertDialog("分析失败：" + (e.message || "未知错误"));
        } finally {
            setAnalyzingId(null);
        }
    }, [pid, groups, items, selectedId, persist]);

    // ===== 文件上传（无大小限制） =====
    const processFiles = useCallback(async (files: FileList | File[], targetGroup: string | null) => {
        if (!pid) return;
        setUploading(true);
        const newItems: MaterialItem[] = [];
        for (const file of Array.from(files)) {
            const ext = extName(file.name);
            if (!ALL_EXTS.includes(ext)) {
                alertDialog(`不支持的文件类型「${ext}」`);
                continue;
            }
            if (IMAGE_EXTS.includes(ext)) {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                newItems.push({
                    id: uuid(), name: file.name, content: dataUrl,
                    type: "image", groupId: targetGroup, fileType: ext, fileSize: file.size,
                    createdAt: new Date().toLocaleString("zh-CN"),
                });
            } else if (DOCX_EXTS.includes(ext)) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const mammoth = await import("mammoth");
                    const result = await mammoth.extractRawText({ arrayBuffer });
                    newItems.push({
                        id: uuid(), name: file.name, content: result.value,
                        type: "upload", groupId: targetGroup, fileType: ext, fileSize: file.size,
                        createdAt: new Date().toLocaleString("zh-CN"),
                    });
                } catch { alertDialog(`解析 Word 文档「${file.name}」失败`); }
            } else {
                const content = await file.text();
                newItems.push({
                    id: uuid(), name: file.name, content,
                    type: "upload", groupId: targetGroup, fileType: ext, fileSize: file.size,
                    createdAt: new Date().toLocaleString("zh-CN"),
                });
            }
        }
        if (newItems.length > 0) {
            const all = [...items, ...newItems];
            persist(groups, all);
            setSelectedId(newItems[0].id);
            setEditingContent(newItems[0].type === "image" ? "" : newItems[0].content);
        }
        setUploading(false);
    }, [pid, groups, items, persist]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) processFiles(e.target.files, selectedGroupId);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }, [processFiles, selectedGroupId]);

    // ===== 拖拽上传 =====
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.target as HTMLElement;
        const groupEl = el.closest("[data-group-id]");
        const gid = groupEl ? (groupEl as HTMLElement).dataset.groupId! : null;
        setDragState({ over: true, groupTarget: gid });
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) {
            setDragState({ over: false, groupTarget: null });
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const gid = dragState.groupTarget ?? selectedGroupId;
        setDragState({ over: false, groupTarget: null });
        if (e.dataTransfer.files?.length) {
            processFiles(e.dataTransfer.files, gid);
        }
    }, [processFiles, dragState.groupTarget, selectedGroupId]);

    const selected = items.find(i => i.id === selectedId);

    if (!currentProject || !pid) {
        return <div className="flex h-full items-center justify-center text-slate-500">请先创建作品</div>;
    }

    // ===== 按分组渲染 =====
    const ungrouped = items.filter(i => !i.groupId);
    const grouped = groups.map(g => ({ group: g, items: items.filter(i => i.groupId === g.id) }));

    return (
        <div className="flex h-full" ref={dropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* 左侧列表 */}
            <aside className={`relative w-72 shrink-0 overflow-y-auto border-r bg-white p-3 transition-colors ${dragState.over ? "bg-amber-50" : ""}`}>
                {/* 拖拽遮罩 */}
                {dragState.over && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-amber-400 bg-amber-50/80">
                        <div className="text-center text-amber-600">
                            <FileUp size={32} className="mx-auto mb-1" />
                            <p className="text-sm font-medium">拖放到此处</p>
                            <p className="text-xs">
                                {(dragState.groupTarget ?? selectedGroupId)
                                    ? `→ 放入「${groups.find(g => g.id === (dragState.groupTarget ?? selectedGroupId))?.name || "分组"}」`
                                    : "→ 未分组区域"}
                            </p>
                        </div>
                    </div>
                )}

                {/* 工具栏 */}
                <div className="mb-3 space-y-2">
                    <div className="flex items-center gap-2">
                        <input
                            className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-amber-400"
                            placeholder="素材名称…"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") addTextItem(selectedGroupId); }}
                        />
                        <button onClick={() => setShowNewGroup(!showNewGroup)}
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-500 hover:bg-amber-50 hover:text-amber-600" title="新建分组 + 素材">
                            <FolderPlus size={16} />
                        </button>
                    </div>
                    {showNewGroup && (
                        <div className="flex items-center gap-2 pl-1">
                            <Folder size={14} className="text-amber-500 shrink-0" />
                            <input className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-amber-400"
                                placeholder="分组名称…" value={newGroupName}
                                onChange={e => setNewGroupName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") addGroup(); }} autoFocus
                            />
                            <button onClick={addGroup} disabled={!newGroupName.trim()}
                                className="rounded bg-amber-500 px-2 py-1 text-xs text-white disabled:opacity-40">确定</button>
                            <button onClick={() => { setShowNewGroup(false); setNewGroupName(""); }}
                                className="text-xs text-slate-400 hover:text-slate-600">取消</button>
                        </div>
                    )}
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 hover:border-amber-400 hover:text-amber-600 disabled:opacity-50">
                        <FileUp size={14} />
                        {uploading ? "上传中…" : "上传文档 / 图片"}
                    </button>
                    <input ref={fileInputRef} type="file" multiple accept={ALL_EXTS.join(",")} onChange={handleFileSelect} className="hidden" />
                </div>

                <p className="mb-2 text-xs text-slate-400">共 {items.length} 项素材 · {groups.length} 个分组</p>

                {/* 批量操作栏 */}
                {selectedIds.size > 0 && (
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
                        <span className="text-xs font-medium text-amber-700">已选 {selectedIds.size} 项</span>
                        <select className="flex-1 rounded border border-amber-300 px-1.5 py-0.5 text-xs outline-none bg-white"
                            defaultValue=""
                            onChange={e => { if (e.target.value !== "__placeholder__") moveSelectedToGroup(e.target.value || null); }}
                        >
                            <option value="__placeholder__" disabled>移动到…</option>
                            <option value="">未分组</option>
                            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                        <button onClick={deleteSelectedItems}
                            className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-500">删除</button>
                        <button onClick={() => setSelectedIds(new Set())}
                            className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:text-slate-600">取消</button>
                    </div>
                )}

                {items.length === 0 && groups.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                        <FileUp size={32} className="mx-auto mb-2 text-slate-200" />
                        <p>拖入文件、点击上传或新建素材</p>
                        <p className="mt-1">支持 {ALL_EXTS.length} 种格式</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {/* 分组 */}
                        {grouped.map(({ group, items: gItems }) => {
                            const isGrpRenaming = renamingGroupId === group.id;
                            return (
                                <div key={group.id} data-group-id={group.id}>
                                    <div className={`group flex items-center gap-1 rounded-lg px-1 py-1 cursor-pointer ${selectedGroupId === group.id ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50"}`}
                                        onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                                        onDoubleClick={() => startGroupRename(group.id, group.name)}
                                    >
                                        <input type="checkbox" checked={gItems.length > 0 && gItems.every(i => selectedIds.has(i.id))} onChange={(e) => { e.stopPropagation(); toggleSelectGroup(gItems.map(i => i.id)); }}
                                            className="shrink-0 size-3 accent-amber-500 cursor-pointer" />
                                        <button onClick={() => toggleCollapse(group.id)} className="rounded p-0.5 hover:bg-slate-200 text-slate-400">
                                            {collapsedGroups.has(group.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                        </button>
                                        <Folder size={14} className="text-amber-500 shrink-0" />
                                        {isGrpRenaming ? (
                                            <div className="flex flex-1 items-center gap-1">
                                                <input className="min-w-0 flex-1 rounded border border-amber-300 px-2 py-0.5 text-xs outline-none"
                                                    value={renameValue}
                                                    onChange={e => setRenameValue(e.target.value)}
                                                    onKeyDown={e => { if (e.key === "Enter") confirmGroupRename(); if (e.key === "Escape") cancelGroupRename(); }}
                                                    autoFocus
                                                />
                                                <button onClick={confirmGroupRename} className="rounded bg-amber-500 px-1.5 py-0.5 text-xs text-white">确定</button>
                                                <button onClick={cancelGroupRename} className="text-xs text-slate-400 hover:text-slate-600">取消</button>
                                            </div>
                                        ) : (
                                            <span className="flex-1 truncate text-xs font-medium text-slate-700">{group.name}</span>
                                        )}
                                        <span className="text-[10px] text-slate-400">{gItems.length}</span>
                                        <button onClick={(e) => { e.stopPropagation(); setDeleteDialog({ groupId: group.id, groupName: group.name }); }}
                                            className="rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-500" title="删除分组">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    {!collapsedGroups.has(group.id) && gItems.map(item => renderItem(item))}
                                </div>
                            );
                        })}
                        {/* 未分组 */}
                        {ungrouped.length > 0 && (
                            <div>
                                <div className="flex items-center gap-1 px-2 py-1">
                                    <input type="checkbox" checked={ungrouped.every(i => selectedIds.has(i.id))} onChange={() => toggleSelectGroup(ungrouped.map(i => i.id))}
                                        className="shrink-0 size-3 accent-amber-500 cursor-pointer" />
                                    <span className="flex-1 text-[10px] font-medium text-slate-400 uppercase">未分组</span>
                                    <span className="text-[10px] text-slate-400">{ungrouped.length}</span>
                                </div>
                                {ungrouped.map(item => renderItem(item))}
                            </div>
                        )}
                    </div>
                )}

                {/* 删除分组确认弹窗 */}
                {deleteDialog && (
                    <div className="absolute inset-0 z-20 flex items-start justify-center pt-20 bg-black/20" onClick={() => setDeleteDialog(null)}>
                        <div className="rounded-xl bg-white shadow-xl border border-slate-200 p-5 w-72" onClick={e => e.stopPropagation()}>
                            <p className="text-sm font-semibold text-slate-800 mb-1">删除分组「{deleteDialog.groupName}」</p>
                            <p className="text-xs text-slate-500 mb-4">组内素材如何处理？</p>
                            <div className="flex gap-2">
                                <button onClick={() => deleteGroup(deleteDialog.groupId, true)}
                                    className="flex-1 rounded-lg bg-red-500 px-3 py-2 text-xs font-medium text-white hover:bg-red-600">是（删素材）</button>
                                <button onClick={() => deleteGroup(deleteDialog.groupId, false)}
                                    className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-white hover:bg-amber-600">否（移出）</button>
                                <button onClick={() => setDeleteDialog(null)}
                                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">取消</button>
                            </div>
                        </div>
                    </div>
                )}
            </aside>

            {/* 右侧面板 */}
            <div className="flex flex-1 flex-col">
                {selected ? (
                    <>
                        <div className="flex items-center justify-between border-b bg-white px-4 py-2">
                            <div className="flex items-center gap-2">
                                {selected.type === "image" ? (
                                    <ImageIcon size={16} className="text-green-500" />
                                ) : (
                                    <FileText size={16} className="text-slate-500" />
                                )}
                                <h2 className="text-sm font-semibold">{selected.name}</h2>
                                {selected.fileSize && <span className="text-[10px] text-slate-400">{fmtSize(selected.fileSize)}</span>}
                                {/* 分组选择器 */}
                                <select className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] outline-none"
                                    value={selected.groupId || ""}
                                    onChange={e => moveItemToGroup(selected.id, e.target.value || null)}
                                >
                                    <option value="">未分组</option>
                                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                            </div>
                            {selected.type !== "image" && (
                                <div className="flex items-center gap-2">
                                    <button onClick={() => analyzeStructure(selected)} disabled={analyzingId === selected.id}
                                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:border-amber-400 hover:text-amber-600 disabled:opacity-50">
                                        <Sparkles size={12} />
                                        {analyzingId === selected.id ? "分析中…" : (selected.structureAnalysis ? "重新分析" : "分析结构")}
                                    </button>
                                    <button onClick={saveContent}
                                        className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600">保存</button>
                                </div>
                            )}
                        </div>
                        {/* 结构分析折叠区 */}
                        {selected.structureAnalysis && (
                            <details className="border-b bg-amber-50/50 group">
                                <summary className="flex cursor-pointer items-center gap-1.5 px-4 py-2 text-xs font-medium text-amber-700 select-none hover:bg-amber-50">
                                    <svg className="size-3 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M6 3l5 5-5 5z" />
                                    </svg>
                                    <Sparkles size={12} />
                                    结构分析
                                </summary>
                                <pre className="whitespace-pre-wrap px-4 pb-3 pt-1 text-xs leading-relaxed text-slate-600 max-h-[75vh] overflow-y-auto">{selected.structureAnalysis}</pre>
                            </details>
                        )}
                        {selected.type === "image" ? (
                            <div className="flex flex-1 items-start justify-center overflow-auto bg-slate-50 p-6">
                                <img src={selected.content} alt={selected.name}
                                    className="max-w-full rounded-lg shadow-sm"
                                    style={{ maxHeight: "calc(100vh - 200px)" }} />
                            </div>
                        ) : (
                            <textarea className="flex-1 resize-none border-0 p-6 text-sm leading-relaxed outline-none"
                                value={editingContent}
                                onChange={e => setEditingContent(e.target.value)}
                                placeholder="在此编辑素材内容…"
                                style={{ minHeight: 200 }} />
                        )}
                    </>
                ) : (
                    <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
                        <div className="text-center">
                            <FileIcon size={40} className="mx-auto mb-2 text-slate-200" />
                            <p>从左侧选择一个素材</p>
                            <p className="mt-1 text-xs">或直接拖入文件 / 图片到左侧区域</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    /** 渲染单个素材项 */
    function renderItem(item: MaterialItem) {
        const isRenaming = renamingId === item.id;
        const isChecked = selectedIds.has(item.id);
        const toggleCheck = () => {
            const next = new Set(selectedIds);
            if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
            setSelectedIds(next);
        };
        return (
            <div key={item.id} className="group flex items-center gap-0.5">
                <input type="checkbox" checked={isChecked} onChange={toggleCheck}
                    className="shrink-0 size-3 accent-amber-500 cursor-pointer" />
                {isRenaming ? (
                    <div className="flex flex-1 items-center gap-1 rounded-lg px-2 py-1">
                        <input className="min-w-0 flex-1 rounded border border-amber-300 px-2 py-0.5 text-xs outline-none"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") cancelRename(); }}
                            autoFocus
                        />
                        <button onClick={confirmRename} className="rounded bg-amber-500 px-1.5 py-0.5 text-xs text-white">确定</button>
                        <button onClick={cancelRename} className="text-xs text-slate-400 hover:text-slate-600">取消</button>
                    </div>
                ) : (
                    <button onClick={() => { setSelectedId(item.id); setEditingContent(item.type === "image" ? "" : item.content); }}
                        onDoubleClick={() => startRename(item.id, item.name)}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-left text-sm ${selectedId === item.id ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50"}`}
                    >
                        <div className="flex items-center gap-1.5">
                            {item.type === "image" ? (
                                <ImageIcon size={12} className="text-green-500 shrink-0" />
                            ) : (
                                <FileText size={12} className="text-slate-400 shrink-0" />
                            )}
                            <span className="truncate text-xs">{item.name}</span>
                            {item.fileSize && <span className="shrink-0 text-[9px] text-slate-400">{fmtSize(item.fileSize)}</span>}
                        </div>
                    </button>
                )}
                {!isRenaming && (
                    <>
                        <button onClick={() => startRename(item.id, item.name)}
                            className="hidden shrink-0 rounded p-0.5 text-slate-300 hover:text-amber-500 group-hover:inline" title="重命名">
                            <FileText size={12} />
                        </button>
                        <button onClick={() => { confirmDialog(`确定删除「${item.name}」？`).then(ok => { if (ok) deleteItem(item.id); }) }}
                            className="ml-0.5 shrink-0 rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-500" title="删除">
                            <Trash2 size={14} />
                        </button>
                    </>
                )}
            </div>
        );
    }
}
