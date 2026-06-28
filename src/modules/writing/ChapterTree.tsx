// ChapterTree.tsx — 章节树组件（T6 拆分，JSX 原样从 WritingModule 提取）
import { Plus, FileText, Trash2 } from "lucide-react";
import { confirmDialog } from "@/lib/confirm";

interface ChapterTreeProps {
    sidebarWidth: number;
    selectMode: boolean;
    storeSelIds: string[];
    selIdSet: Set<string>;
    volumes: { id: string; title: string }[];
    chapters: { id: string; volumeSegmentId: string; number: number; title: string }[];
    selectedChapterId: string | null;
    volCollapsed: Record<string, boolean>;
    showAddDlg: string | null;
    newChapterTitle: string;
    renameText: string;
    renamingId: string | null;
    nextChapterNumber: number;
    onResizeStart: (e: React.MouseEvent) => void;
    onReadToAI: () => void;
    onCancelSelect: () => void;
    onVolCollapseToggle: (colKey: string) => void;
    onShowAddDlg: (volId: string | null) => void;
    onNewChapterTitleChange: (v: string) => void;
    onChapterSelect: (id: string) => void;
    onSelectAllInVolume: (vid: string, allSel: boolean) => void;
    onSelectToggle: (chId: string) => void;
    onStartRename: (chId: string, title: string) => void;
    onRenameTextChange: (v: string) => void;
    onCommitRename: (chId: string) => void;
    onCancelRename: () => void;
    onDeleteChapter: (chId: string) => void;
    onAddChapter: (volId: string) => void;
}

export function ChapterTree(props: ChapterTreeProps) {
    const {
        sidebarWidth, selectMode, storeSelIds, selIdSet, volumes, chapters,
        selectedChapterId, volCollapsed, showAddDlg, newChapterTitle,
        renameText, renamingId, nextChapterNumber,
        onResizeStart, onReadToAI, onCancelSelect, onVolCollapseToggle,
        onShowAddDlg, onNewChapterTitleChange, onChapterSelect,
        onSelectAllInVolume, onSelectToggle,
        onStartRename, onRenameTextChange, onCommitRename, onCancelRename,
        onDeleteChapter, onAddChapter,
    } = props;

    return (
        <>
            <aside style={{ width: sidebarWidth }} className="relative shrink-0 overflow-y-auto border-r bg-white p-4">
                <div
                    className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-amber-400/50 active:bg-amber-500"
                    onMouseDown={onResizeStart}
                />
                <h2 className="mb-3 text-lg font-bold">
                    {selectMode ? "选取章节到 AI" : "卷章树"}
                    {selectMode && storeSelIds.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-violet-600">已选 {storeSelIds.length} 章</span>
                    )}
                </h2>
                {selectMode && (
                    <div className="mb-3 flex items-center gap-2">
                        <button onClick={onReadToAI}
                            className="rounded-md bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
                            disabled={storeSelIds.length === 0}>
                            读取到AI ({storeSelIds.length})
                        </button>
                        <button onClick={onCancelSelect}
                            className="rounded-md border px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                            取消
                        </button>
                    </div>
                )}
                {volumes.length === 0 && (
                    <p className="text-xs text-slate-400">暂无剧情走向，请先在大纲·剧情走向中创建明暗线段落</p>
                )}
                {volumes.map(vol => {
                    const volChapters = chapters.filter(c => c.volumeSegmentId === vol.id).sort((a, b) => a.number - b.number);
                    const colKey = "v-" + vol.id;
                    const isCol = volCollapsed[colKey];
                    const allSel = volChapters.length > 0 && volChapters.every(c => selIdSet.has(c.id));
                    const someSel = volChapters.some(c => selIdSet.has(c.id));
                    return (
                        <div key={vol.id} className="mb-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                    {selectMode && (
                                        <input type="checkbox" checked={allSel}
                                            ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
                                            onChange={() => onSelectAllInVolume(vol.id, allSel)}
                                            className="shrink-0 accent-violet-600"
                                        />
                                    )}
                                    <button onClick={() => onVolCollapseToggle(colKey)}
                                        className="text-xs text-slate-400 hover:text-slate-600 shrink-0 w-4">
                                        {isCol ? "▶" : "▼"}
                                    </button>
                                    <p className="text-base font-semibold text-slate-700 truncate">{vol.title}</p>
                                </div>
                                <button onClick={() => onShowAddDlg(vol.id)}
                                    className="text-amber-600 hover:text-amber-700 shrink-0 ml-1" title="添加章节">
                                    <Plus size={18} />
                                </button>
                            </div>
                            {!isCol && (
                                <>
                                    {volChapters.length === 0 && (
                                        <p className="ml-2 mt-1 text-xs text-slate-300">暂无章节，点击 + 添加</p>
                                    )}
                                    {volChapters.map(ch => (
                                        <div key={ch.id} className="group flex items-center">
                                            {selectMode && (
                                                <input type="checkbox" checked={selIdSet.has(ch.id)}
                                                    onChange={() => onSelectToggle(ch.id)}
                                                    className="shrink-0 ml-1 accent-violet-600"
                                                />
                                            )}
                                            <button
                                                onClick={() => { if (!selectMode) onChapterSelect(ch.id); }}
                                                className={`mt-1 flex-1 rounded px-2 py-1.5 text-left text-base flex items-center gap-1.5 ${selectedChapterId === ch.id && !selectMode ? "bg-amber-100" : "hover:bg-slate-50"}`}
                                            >
                                                <FileText size={14} className="text-slate-400 shrink-0" />
                                                <span className="text-slate-400 shrink-0 w-[3.6rem]">第{ch.number}章</span>
                                                {renamingId === ch.id ? (
                                                    <input
                                                        className="ml-1 flex-1 min-w-0 rounded border border-amber-400 px-1 py-0 text-base outline-none"
                                                        value={renameText}
                                                        onChange={e => onRenameTextChange(e.target.value)}
                                                        onBlur={() => onCommitRename(ch.id)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') onCommitRename(ch.id);
                                                            if (e.key === 'Escape') onCancelRename();
                                                        }}
                                                        autoFocus
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <span
                                                        className="ml-1 flex-1 min-w-0 truncate rounded px-1 py-0.5 hover:bg-slate-100 cursor-text"
                                                        onClick={e => { e.stopPropagation(); if (!selectMode) { onChapterSelect(ch.id); onStartRename(ch.id, ch.title); } }}
                                                        title="点击修改章节名"
                                                    >
                                                        {ch.title || '未命名'}
                                                    </span>
                                                )}
                                            </button>
                                            {!selectMode && (
                                                <button onClick={async () => {
                                                    if (await confirmDialog(`确定删除「第${ch.number}章 ${ch.title}」？`)) onDeleteChapter(ch.id);
                                                }}
                                                    className="ml-1 hidden group-hover:block text-red-400 hover:text-red-600" title="删除章节">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    );
                })}

                {/* 加章弹窗 */}
                {showAddDlg && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
                        onClick={() => onShowAddDlg(null)}>
                        <div className="rounded-xl border bg-white p-4 shadow-xl" onClick={e => e.stopPropagation()} style={{ minWidth: 280 }}>
                            <h3 className="mb-3 text-sm font-semibold">新建章节</h3>
                            <div className="mb-2 text-xs text-slate-400">
                                将自动生成：第{nextChapterNumber}章
                            </div>
                            <input className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-amber-400"
                                value={newChapterTitle} onChange={e => onNewChapterTitleChange(e.target.value)}
                                placeholder="输入章节名称" autoFocus
                                onKeyDown={e => { if (e.key === "Enter" && showAddDlg) onAddChapter(showAddDlg); if (e.key === "Escape") onShowAddDlg(null); }} />
                            <div className="mt-3 flex justify-end gap-2">
                                <button className="rounded-lg border px-4 py-1.5 text-sm hover:bg-slate-50" onClick={() => onShowAddDlg(null)}>取消</button>
                                <button className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600" onClick={() => showAddDlg && onAddChapter(showAddDlg)}>创建</button>
                            </div>
                        </div>
                    </div>
                )}
            </aside>
        </>
    );
}
