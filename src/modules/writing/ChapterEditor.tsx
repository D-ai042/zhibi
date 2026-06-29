// ChapterEditor.tsx — 正文编辑器组件（T6 拆分，JSX 原样从 WritingModule 提取）
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Sparkles, AlignLeft, Undo2, Redo2, CheckCircle, ShieldCheck, X, RefreshCw } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { runQualityCheckForChapter, simpleHash as computeContentHash, type StoredQualityCheck } from "@/lib/quality-checker";

/** 质检条目类型（与 quality-checker.ts QualityCheckItem 保持一致；这里用结构类型避免循环依赖） */
interface QualityCheckItem {
    type: "bible" | "character" | "foreshadow" | "plot_logic" | "timeline";
    severity: "pass" | "warning" | "error";
    message: string;
    detail: string;
    quote?: string;
    location?: string;
}

/** 跳转目标（来自 app-store.qualityJumpTarget） */
interface JumpTarget {
    chapterId: string;
    chapterNumber: number;
    location: string;
    quote?: string;
    bump: number;
}

interface ChapterEditorProps {
    selectedChapter: { number: number; title: string } | null | undefined;
    selectedVolume: { title: string } | null | undefined;
    editingContent: string;
    isDirty: boolean;
    aiWriting: boolean;
    humanizing: boolean;
    polishing: boolean;
    aiError: string;
    fontSize: number;
    staleInfo: { count: number; chapters: string; fromChapter: number } | null;
    rebaseRunning: boolean;
    rebaseProgress: { current: number; total: number } | null;
    canUndo: boolean;
    canRedo: boolean;
    /** ★ 定稿中状态：防止重复点击 */
    finalizing: boolean;
    selectionRange: { start: number; end: number } | null;
    lastWriteParams: { wordCount: number; plotDirection: string } | null;
    editorRef: React.RefObject<HTMLDivElement | null>;
    onAiWrite: () => void;
    onHumanize: () => void;
    onPolish: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onSave: () => void;
    onFinalize: () => void;
    onRebase: () => void;
    onRetryWrite: () => void;
    onAutoFormat: () => void;
    onFontSizeChange: (size: number) => void;
    onEditorInput: (e: React.FormEvent<HTMLDivElement>) => void;
    onEditorMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
    onEditorKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    /** 质检跳转目标（来自 app-store.qualityJumpTarget），监听 bump 触发滚动高亮 */
    jumpTarget?: JumpTarget | null;
    /** 项目 ID，用于读取 LogStore.qualityChecks 显示「质检」按钮 */
    projectId?: string;
}

/** 把质检 location 描述（"第3段"/"开头"/"中部"/"结尾"）映射到段落索引 */
function parseLocationToParagraphIndex(location: string | undefined, total: number): number {
    if (total <= 0) return 0;
    if (!location) return 0;
    const m = location.match(/第\s*(\d+)\s*[段节]/);
    if (m) {
        const idx = parseInt(m[1]) - 1;
        return Math.max(0, Math.min(idx, total - 1));
    }
    if (/开头|^开头|开头部分/.test(location)) return 0;
    if (/结尾|末尾|最后/.test(location)) return total - 1;
    if (/中部|中间|中央/.test(location)) return Math.floor(total / 2);
    return 0;
}

/** 生成质检项的唯一标识（基于内容，跨重新质检保持稳定，用于忽略/恢复） */
function checkItemKey(c: QualityCheckItem): string {
    return `${c.type}|${c.message}|${c.quote || ""}`;
}

const TYPE_LABEL: Record<QualityCheckItem["type"], string> = {
    bible: "圣经铁则",
    character: "角色性格",
    foreshadow: "伏笔回收",
    plot_logic: "剧情逻辑",
    timeline: "时间线",
};

const SEVERITY_STYLE: Record<QualityCheckItem["severity"], string> = {
    pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    error: "bg-red-50 text-red-700 border-red-200",
};

const SEVERITY_LABEL: Record<QualityCheckItem["severity"], string> = {
    pass: "通过",
    warning: "警告",
    error: "错误",
};

export function ChapterEditor(props: ChapterEditorProps) {
    const {
        selectedChapter, selectedVolume, editingContent, isDirty,
        aiWriting, humanizing, polishing, aiError, fontSize,
        staleInfo, rebaseRunning, rebaseProgress,
        canUndo, canRedo, selectionRange, lastWriteParams, editorRef, finalizing,
        onAiWrite, onHumanize, onPolish, onUndo, onRedo, onSave,
        onFinalize, onRebase, onRetryWrite, onAutoFormat, onFontSizeChange,
        onEditorInput, onEditorMouseUp, onEditorKeyDown,
        jumpTarget, projectId,
    } = props;

    const [showQualityPanel, setShowQualityPanel] = useState(false);
    const [storedCheck, setStoredCheck] = useState<StoredQualityCheck | null>(null);
    /** 已忽略的质检项 key 集合（作者判断为误判） */
    const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
    /** 质检进行中状态（独立质检按钮触发） */
    const [checking, setChecking] = useState(false);
    /** 质检错误信息（用于按钮旁提示） */
    const [checkError, setCheckError] = useState<string>("");
    // 防止 editingContent 变化重复触发同一次 bump 跳转
    const lastJumpBumpRef = useRef(0);
    // 临时高亮的段落元素引用，便于移除 class
    const highlightedElRef = useRef<HTMLElement | null>(null);
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 读取本章质检结果 + 已忽略项（章节切换/质检面板打开/定稿完成/质检完成时刷新）
    // ★ finalizing/checking 作为依赖：状态变化时触发重新读取质检结果
    useEffect(() => {
        if (!projectId || !selectedChapter) { setStoredCheck(null); setDismissedKeys(new Set()); return; }
        try {
            const logKey = `novel-workbench-log-${projectId}`;
            const logStore = getJSONSync<any>(logKey, {});
            const q = logStore?.qualityChecks?.[String(selectedChapter.number)] || null;
            setStoredCheck(q);
            // 读取已忽略的检查项 key 列表
            const dismissed = logStore?.dismissedChecks?.[String(selectedChapter.number)] || [];
            setDismissedKeys(new Set(Array.isArray(dismissed) ? dismissed : []));
        } catch {
            setStoredCheck(null);
            setDismissedKeys(new Set());
        }
    }, [projectId, selectedChapter?.number, showQualityPanel, finalizing, checking]);

    // 清理高亮
    const clearHighlight = () => {
        if (highlightedElRef.current) {
            highlightedElRef.current.classList.remove("quality-jump-highlight");
            highlightedElRef.current = null;
        }
        if (highlightTimerRef.current) {
            clearTimeout(highlightTimerRef.current);
            highlightTimerRef.current = null;
        }
    };

    useEffect(() => () => clearHighlight(), []);

    // ★ 监听 jumpTarget.bump：匹配本章时滚动 + 高亮目标段落
    useEffect(() => {
        if (!jumpTarget || !selectedChapter) return;
        if (jumpTarget.bump === lastJumpBumpRef.current) return;
        if (jumpTarget.chapterNumber !== selectedChapter.number) return;
        lastJumpBumpRef.current = jumpTarget.bump;

        // 等待 contentEditable 内的 DOM 渲染完成
        const tryScroll = (attempt: number) => {
            const editor = editorRef.current;
            if (!editor) {
                if (attempt < 5) setTimeout(() => tryScroll(attempt + 1), 100);
                return;
            }
            // 仅保留有实际文本内容的块级元素，过滤空 <p>/<br> 等，避免高亮落到空块
            const allBlocks = Array.from(editor.children) as HTMLElement[];
            const blocks = allBlocks.filter(b => (b.textContent || "").trim().length > 0);
            if (blocks.length === 0) {
                if (attempt < 5) setTimeout(() => tryScroll(attempt + 1), 100);
                return;
            }
            // 优先按 quote 原文精确匹配（最准）；找不到再回退到 location 解析
            let target: HTMLElement | undefined;
            if (jumpTarget.quote) {
                const quote = jumpTarget.quote.trim();
                target = blocks.find(b => (b.textContent || "").includes(quote));
            }
            if (!target) {
                const idx = parseLocationToParagraphIndex(jumpTarget.location, blocks.length);
                target = blocks[idx];
            }
            if (!target) return;

            clearHighlight();
            target.classList.add("quality-jump-highlight");
            highlightedElRef.current = target;
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            highlightTimerRef.current = setTimeout(() => clearHighlight(), 3500);
        };
        // 给一帧让 innerHTML 先渲染（跨章节切换时编辑器还在重设内容）
        setTimeout(() => tryScroll(0), 50);
    }, [jumpTarget?.bump, selectedChapter?.number, editingContent]);

    // 关闭质检面板时清理
    useEffect(() => {
        if (!showQualityPanel) { /* 保持 highlighted，不必清理 */ }
    }, [showQualityPanel]);

    const triggerQualityJump = useAppStore(s => s.triggerQualityJump);

    const handleJumpTo = (item: QualityCheckItem) => {
        if (!selectedChapter) return;
        triggerQualityJump({
            chapterId: (selectedChapter as any).id,
            chapterNumber: selectedChapter.number,
            location: item.location || "",
            quote: item.quote,
        });
        setShowQualityPanel(false);
    };

    // 持久化已忽略项到 LogStore
    const persistDismissed = (keys: Set<string>) => {
        if (!projectId || !selectedChapter) return;
        try {
            const logKey = `novel-workbench-log-${projectId}`;
            const logStore = getJSONSync<any>(logKey, {});
            logStore.dismissedChecks = logStore.dismissedChecks || {};
            logStore.dismissedChecks[String(selectedChapter.number)] = Array.from(keys);
            setJSONSync(logKey, logStore);
        } catch { /* 持久化失败不影响 UI */ }
    };

    // 忽略该项（作者判断为误判）
    const handleDismiss = (c: QualityCheckItem) => {
        const next = new Set(dismissedKeys);
        next.add(checkItemKey(c));
        setDismissedKeys(next);
        persistDismissed(next);
    };

    // 恢复该项（撤销忽略）
    const handleRestore = (c: QualityCheckItem) => {
        const next = new Set(dismissedKeys);
        next.delete(checkItemKey(c));
        setDismissedKeys(next);
        persistDismissed(next);
    };

    if (!selectedChapter) {
        return (
            <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
                从左侧选择一个章节开始写作
            </div>
        );
    }

    const hasQualityResult = !!storedCheck;
    // 有效检查项 = 排除已忽略的项（作者判断为误判的不计入统计）
    const effectiveChecks = storedCheck?.checks.filter(c => !dismissedKeys.has(checkItemKey(c))) || [];
    const errorCount = effectiveChecks.filter(c => c.severity === "error").length;
    const warningCount = effectiveChecks.filter(c => c.severity === "warning").length;
    // 当前正文哈希，与质检时的 contentHash 比对判断是否 stale
    const currentContentHash = useMemo(() => computeContentHash(editingContent || ""), [editingContent]);
    const isStale = hasQualityResult && storedCheck?.contentHash !== undefined && storedCheck.contentHash !== currentContentHash;

    // 独立质检：触发 AI 质检并持久化结果
    const handleRunCheck = async () => {
        if (!projectId || !selectedChapter || checking || finalizing) return;
        const content = editingContent || "";
        if (!content.trim()) {
            setCheckError("正文为空，无法质检");
            return;
        }
        setChecking(true);
        setCheckError("");
        try {
            const result = await runQualityCheckForChapter({
                projectId,
                chapterId: (selectedChapter as any)?.id || "",
                chapterNumber: selectedChapter.number,
                chapterContent: content,
            });
            // checking→false 会触发 useEffect 重新读取 storedCheck
            const errs = result.checks.filter(c => c.severity === "error").length;
            const warns = result.checks.filter(c => c.severity === "warning").length;
            // 通知用户
            useAppStore.getState().addChatMessage({
                id: Math.random().toString(36).slice(2),
                role: "system",
                content: errs > 0
                    ? `质检完成：${errs} 个错误、${warns} 个警告。点击编辑器「质检」按钮查看详情。`
                    : warns > 0
                        ? `质检完成：${warns} 个警告。点击编辑器「质检」按钮查看详情。`
                        : "✅ 质检通过，可以定稿。",
                created_at: new Date().toISOString(),
            });
            // 自动打开结果面板（首次质检或有错误时）
            if (errs > 0 || warns > 0 || !hasQualityResult) {
                setShowQualityPanel(true);
            }
        } catch (e) {
            setCheckError(e instanceof Error ? e.message : String(e));
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="flex flex-1 flex-col min-w-0">
            {staleInfo && !rebaseRunning && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <span>⚠️ 检测到 {staleInfo.count} 条过时记录（{staleInfo.chapters} 的摘要/角色状态已基于旧版本）</span>
                    <button onClick={onRebase} className="ml-auto rounded-md bg-amber-500 px-2.5 py-1 text-xs text-white hover:bg-amber-600">重跑记忆</button>
                </div>
            )}
            {rebaseProgress && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <span>⏳ 正在重跑记忆：第{rebaseProgress.current}/{rebaseProgress.total}章</span>
                    <div className="h-2 flex-1 rounded-full bg-amber-200"><div className="h-2 rounded-full bg-amber-500 transition-all" style={{ width: `${(rebaseProgress.current / rebaseProgress.total) * 100}%` }} /></div>
                </div>
            )}
            <div className="flex items-center justify-between border-b bg-white px-4 py-2">
                <div>
                    <h1 className="text-lg font-bold"><span className="text-slate-400">第{selectedChapter.number}章</span> {selectedChapter.title}</h1>
                    <p className="text-xs text-slate-400">{selectedVolume?.title || ""}</p>
                </div>
                <div className="flex items-center gap-2 relative">
                    {aiError && <span className="text-xs text-red-500">{aiError}</span>}
                    <button type="button" className="relative flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
                        onClick={onAiWrite} disabled={!selectedChapter || aiWriting}>
                        <Sparkles className="h-3.5 w-3.5" />{aiWriting ? "AI 写作中..." : "AI写文"}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] text-gray-500 whitespace-nowrap">大纲生成初稿</span>
                    </button>
                    <button type="button" onClick={onHumanize}
                        disabled={!selectedChapter || !String(editingContent ?? '').trim() || humanizing}
                        className="relative flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">
                        <Sparkles className="h-3.5 w-3.5" />{humanizing ? "处理中..." : "AI去味"}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] text-gray-500 whitespace-nowrap">语气自然化</span>
                    </button>
                    <button type="button" onClick={onPolish}
                        disabled={!selectedChapter || !String(editingContent ?? '').trim() || polishing}
                        className="relative flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50">
                        <Sparkles className="h-3.5 w-3.5" />{polishing ? "精修中..." : "AI精修"}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] text-gray-500 whitespace-nowrap">精简+段落优化</span>
                    </button>
                    <button type="button" onClick={onUndo} disabled={!canUndo}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="撤回 (Ctrl+Z)">
                        <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={onRedo} disabled={!canRedo}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="重做 (Ctrl+Y)">
                        <Redo2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={onSave} className={`rounded-lg px-3 py-1.5 text-xs text-white ${isDirty ? "bg-amber-500 hover:bg-amber-600" : "bg-slate-300 cursor-default"}`}>保存</button>
                    {/* ★ 重新质检按钮（定稿按钮左侧）：触发 AI 质检，覆盖现有结果 */}
                    <button type="button"
                        onClick={handleRunCheck}
                        disabled={!selectedChapter || checking || finalizing || !String(editingContent ?? '').trim()}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={hasQualityResult ? "重新执行质检（覆盖现有结果）" : "执行质检"}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
                        {checking ? "质检中..." : hasQualityResult ? "重新质检" : "执行质检"}
                    </button>
                    <button type="button" onClick={onFinalize} disabled={finalizing}
                        className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-white ${finalizing ? "bg-emerald-400 cursor-wait" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                        <CheckCircle className="h-3.5 w-3.5" />{finalizing ? "定稿中..." : "定稿"}
                    </button>
                    {lastWriteParams && (
                        <button type="button" onClick={onRetryWrite} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" title="用相同参数让 AI 重新生成">退回重写</button>
                    )}
                    <button type="button" onClick={onAutoFormat} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title="自动排版段落缩进">
                        <AlignLeft className="h-3.5 w-3.5" />
                    </button>
                    {/* ★ 质检按钮：常驻显示。
                        - 未质检：紫色，点击触发首次质检
                        - 已质检全通过：绿色 + ✓
                        - 已质检仅 warning：橙色 + {n}警
                        - 已质检有 error：红色 + {n}错
                        - 正文已修改（stale）：按钮加橙色圆点提示重检
                        点击行为：已有结果时打开/关闭面板；无结果时触发首次质检 */}
                    <button type="button"
                        onClick={() => {
                            if (checking || finalizing) return;
                            if (!hasQualityResult) {
                                handleRunCheck();
                            } else {
                                setShowQualityPanel(!showQualityPanel);
                            }
                        }}
                        disabled={checking || finalizing}
                        className={`relative flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs ${
                            checking ? "bg-violet-400 cursor-wait text-white"
                            : hasQualityResult
                                ? `text-white ${errorCount > 0 ? "bg-red-600 hover:bg-red-700" : warningCount > 0 ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"}`
                                : "bg-violet-600 hover:bg-violet-700 text-white"
                        }`}
                        title={
                            checking ? "质检中..."
                            : isStale ? "正文已修改，建议重新质检"
                            : hasQualityResult ? "查看质检结果并跳转修复"
                            : "执行质检"
                        }>
                        <ShieldCheck className="h-3.5 w-3.5" />
                        质检
                        {hasQualityResult && errorCount > 0 && <span className="ml-1 rounded-full bg-white/30 px-1.5 text-[10px]">{errorCount}错</span>}
                        {hasQualityResult && errorCount === 0 && warningCount > 0 && <span className="ml-1 rounded-full bg-white/30 px-1.5 text-[10px]">{warningCount}警</span>}
                        {hasQualityResult && errorCount === 0 && warningCount === 0 && <span className="ml-1 rounded-full bg-white/30 px-1.5 text-[10px]">✓</span>}
                        {isStale && !checking && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white" title="正文已修改" />}
                    </button>
                    {checkError && <span className="text-xs text-red-500 ml-1" title={checkError}>!</span>}
                    <div className="flex items-stretch rounded-lg border border-slate-200 overflow-hidden" title={`正文字体 ${fontSize}px`}>
                        <button type="button" onClick={() => onFontSizeChange(Math.max(fontSize - 1, 12))}
                            className="flex items-center justify-center px-1 py-1.5 text-xs text-slate-600 hover:bg-slate-100"><Minus className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => onFontSizeChange(Math.min(fontSize + 1, 100))}
                            className="flex items-center justify-center px-1 py-1.5 text-xs text-slate-600 hover:bg-slate-100"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                </div>
            </div>
            <div className="relative flex-1 min-h-0">
                <div ref={editorRef as any}
                    className="chapter-editor-surface absolute inset-0 overflow-y-auto bg-stone-50 p-6 font-serif font-medium leading-relaxed text-stone-800 outline-none cursor-text"
                    style={{ fontSize }} contentEditable suppressContentEditableWarning
                    onInput={onEditorInput} onMouseUp={onEditorMouseUp} onKeyDown={onEditorKeyDown}
                />
                {/* ★ 质检结果面板（浮层） */}
                {showQualityPanel && storedCheck && (
                    <div className="absolute inset-0 z-30 flex items-start justify-end bg-black/20 p-4" onClick={() => setShowQualityPanel(false)}>
                        <div className="mt-0 mr-0 max-h-full w-[420px] max-w-[90%] overflow-y-auto rounded-lg bg-white shadow-2xl ring-1 ring-slate-200" onClick={e => e.stopPropagation()}>
                            <div className="sticky top-0 flex items-center justify-between border-b bg-white px-4 py-2.5">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className={`h-4 w-4 ${errorCount > 0 ? "text-red-600" : warningCount > 0 ? "text-amber-500" : "text-emerald-600"}`} />
                                        <span className="font-semibold text-slate-800">质检结果 · 第{selectedChapter.number}章</span>
                                        {errorCount === 0 && warningCount === 0
                                            ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">全部通过</span>
                                            : errorCount > 0
                                                ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">{errorCount} 错 · {warningCount} 警</span>
                                                : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{warningCount} 警</span>}
                                    </div>
                                    <p className="mt-0.5 text-[10px] text-slate-400">检查于 {new Date(storedCheck.checkedAt).toLocaleString("zh-CN")}</p>
                                </div>
                                <button onClick={() => setShowQualityPanel(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" title="关闭">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            {isStale && (
                                <div className="flex items-center justify-between gap-2 border-b border-orange-200 bg-orange-50 px-4 py-1.5 text-xs text-orange-800">
                                    <span>⚠️ 正文已修改，质检结果可能已过时</span>
                                    <button type="button" onClick={handleRunCheck} disabled={checking || finalizing}
                                        className="rounded bg-orange-600 px-2 py-0.5 text-[11px] text-white hover:bg-orange-700 disabled:opacity-40">
                                        {checking ? "重检中..." : "重新质检"}
                                    </button>
                                </div>
                            )}
                            <div className="space-y-2 p-3">
                                {storedCheck.checks.map((c, i) => {
                                    const isDismissed = dismissedKeys.has(checkItemKey(c));
                                    return (
                                    <div key={i} className={`rounded-md border p-2.5 ${isDismissed ? "bg-slate-50 border-slate-200 opacity-60" : SEVERITY_STYLE[c.severity]}`}>
                                        <div className="flex items-center gap-2">
                                            <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold">{TYPE_LABEL[c.type]}</span>
                                            <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold">{SEVERITY_LABEL[c.severity]}</span>
                                            <span className="flex-1 text-xs font-semibold">{c.message}</span>
                                            {isDismissed && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">已忽略</span>}
                                        </div>
                                        {c.detail && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-700">{c.detail}</p>}
                                        {c.quote && (
                                            <div className="mt-1.5 rounded bg-white/60 px-2 py-1 text-[11px] italic text-slate-600 border-l-2 border-slate-300">
                                                「{c.quote}」
                                            </div>
                                        )}
                                        <div className="mt-1.5 flex items-center justify-between">
                                            <span className="text-[10px] text-slate-400">位置：{c.location || "未定位"}</span>
                                            <div className="flex items-center gap-1.5">
                                                {!isDismissed && (c.severity === "error" || c.severity === "warning") && c.location && (
                                                    <button onClick={() => handleJumpTo(c)}
                                                        className="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-white hover:bg-slate-900">
                                                        跳转修复 →
                                                    </button>
                                                )}
                                                {!isDismissed && (c.severity === "error" || c.severity === "warning") && (
                                                    <button onClick={() => handleDismiss(c)}
                                                        className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100"
                                                        title="标记为误判，忽略此项（不再计入统计）">
                                                        忽略
                                                    </button>
                                                )}
                                                {isDismissed && (
                                                    <button onClick={() => handleRestore(c)}
                                                        className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100">
                                                        恢复
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t bg-white px-4 py-1 text-xs text-slate-400">
                {(() => {
                    const text = editingContent || "";
                    const totalChars = text.replace(/\s/g, "").length;
                    const paragraphs = text.split("\n").filter(l => l.trim()).length;
                    const selText = selectionRange ? text.slice(selectionRange.start, selectionRange.end) : "";
                    const selChars = selText.replace(/\s/g, "").length;
                    return (
                        <>
                            {selChars > 0 && <span>{selChars}/{totalChars}</span>}
                            <span>{totalChars} 字 · {paragraphs} 段</span>
                        </>
                    );
                })()}
            </div>
        </div>
    );
}
