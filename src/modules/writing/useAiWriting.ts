// useAiWriting.ts — AI 写作相关 hooks（T6：从 WritingModule.tsx 提取）
import { useCallback, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { assembleContext } from "@/lib/context-engine";
import { getJSONSync } from "@/lib/storage";
import { loadAllChapters, type Chapter } from "@/lib/chapter-store";
import { uuid } from "@/lib/uuid";
import type { ChapterSummary, BeatCard } from "@/types";

const HUMANIZER_RULES = `你是一位文字编辑，请对以下小说段落进行"去 AI 味"处理：
1. 删除多余的"了"字（如"走了过去"→"走去"）
2. 删除多余的"的"字（如"轻轻的说道"→"轻轻说"）
3. 拆分过长句子
4. 添加适当的拟声词、感官描写
5. 保持原文内容不变，只优化语言表达`;

export interface UseAiWritingReturn {
    aiWriting: boolean;
    humanizing: boolean;
    polishing: boolean;
    aiError: string;
    rebaseRunning: boolean;
    rebaseProgress: { current: number; total: number } | null;
    staleInfo: { count: number; chapters: string; fromChapter: number } | null;
    writeDlg: { wordCount: number; plotDirection: string } | null;
    setWriteDlg: (v: { wordCount: number; plotDirection: string } | null) => void;
    handleAiWriteChapter: (wordCount: number, plotDirection: string, refIds?: string[]) => Promise<void>;
    handleHumanize: () => Promise<void>;
    handlePolish: () => Promise<void>;
    handleRebase: () => Promise<void>;
    handleReadToAI: () => void;
    setStaleInfo: (v: { count: number; chapters: string; fromChapter: number } | null) => void;
}

export function useAiWriting(
    pid: string | undefined,
    selectedChapter: Chapter | null | undefined,
    editingContent: string,
    chapters: Chapter[],
    setEditingContent: (v: string) => void,
    setChapters: (updater: (prev: Chapter[]) => Chapter[]) => void,
    saveChapters: (chs: Chapter[]) => void,
    pushUndo: () => void,
    syncEditorHTML: (content: string) => void,
): UseAiWritingReturn {
    const [aiWriting, setAiWriting] = useState(false);
    const [humanizing, setHumanizing] = useState(false);
    const [polishing, setPolishing] = useState(false);
    const [aiError, setAiError] = useState("");
    const [rebaseRunning, setRebaseRunning] = useState(false);
    const [rebaseProgress, setRebaseProgress] = useState<{ current: number; total: number } | null>(null);
    const [staleInfo, setStaleInfo] = useState<{ count: number; chapters: string; fromChapter: number } | null>(null);
    const [writeDlg, setWriteDlg] = useState<{ wordCount: number; plotDirection: string } | null>(null);

    const aiWritingRef = useRef(false);
    const humanizingRef = useRef(false);
    const _skipNextChapterEffect = useRef(false);
    const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    const handleAiWriteChapter = useCallback(async (wordCount: number, plotDirection: string, refIds?: string[]) => {
        if (!pid) { useAppStore.getState().setAutosaveStatus("⚠ 未选择项目"); return; }
        if (!selectedChapter) { useAppStore.getState().setAutosaveStatus("⚠ 未选择章节"); return; }
        if (aiWritingRef.current) {
            useAppStore.getState().setAutosaveStatus("⚠ AI 写作进行中，请等待完成");
            return;
        }
        aiWritingRef.current = true;
        setAiWriting(true);
        setAiError("");
        setWriteDlg(null);

        const safetyTimer = setTimeout(() => {
            if (aiWritingRef.current) {
                aiWritingRef.current = false;
                setAiWriting(false);
                setAiError("AI 写作超时（5分钟），请重试");
            }
        }, 5 * 60 * 1000);
        timeoutIdsRef.current.push(safetyTimer);

        try {
            const output = await assembleContext(pid, selectedChapter.id, "ai") as any;

            let structureHint = "";
            let inspContext = "";
            if (refIds && refIds.length > 0) {
                const inspIds = refIds.filter(r => r.startsWith("insp:")).map(r => r.slice(5));
                if (inspIds.length > 0) {
                    const allCards = getJSONSync(`inspiration-cards-${pid}`, [] as any[]);
                    const selected = allCards.filter((c: any) => inspIds.includes(c.id));
                    if (selected.length > 0) {
                        inspContext = "\n【灵感参考】\n";
                        for (const c of selected) {
                            inspContext += `- ${c.title || "无标题"}：${(c.content || "").slice(0, 300)}\n`;
                        }
                    }
                }
            }

            const maxChars = Math.round(wordCount * 1.1);
            const minChars = Math.round(wordCount * 0.9);

            let userMsg = "";
            if (structureHint) userMsg += `\n\n${structureHint}`;
            userMsg += `\n\n请写第${selectedChapter.number}章「${selectedChapter.title}」。`;
            userMsg += `\n\n【字数要求】必须严格控制在 ${minChars}-${maxChars} 字之间（目标 ${wordCount} 字），不可超出此范围。`;
            if (plotDirection) userMsg += `\n\n剧情方向：\n${plotDirection}`;
            if (inspContext) userMsg += `\n\n${inspContext}`;
            userMsg += `\n\n根据以上上下文，写出本章正文。`;

            const res = await api.aiComplete({
                action: "write_chapter",
                entity_type: "chapter",
                entity_id: selectedChapter.id,
                extra: {
                    system_hint: output.systemHint,
                    user_message: userMsg,
                    history: [],
                },
            });

            if (res.error) {
                setAiError(res.error);
            } else {
                if (editingContent) pushUndo();
                const safeContent = String(res.content ?? '');
                setEditingContent(safeContent);
                const tid = setTimeout(() => syncEditorHTML(safeContent), 0);
                timeoutIdsRef.current.push(tid);
                _skipNextChapterEffect.current = true;
                setChapters(prev => {
                    const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: safeContent } : c);
                    saveChapters(upd);
                    return upd;
                });
            }
        } catch (e) {
            setAiError(String(e));
        } finally {
            clearTimeout(safetyTimer);
            setAiWriting(false);
            aiWritingRef.current = false;
        }
    }, [pid, selectedChapter, editingContent, pushUndo, setEditingContent, setChapters, saveChapters, syncEditorHTML]);

    const handleHumanize = useCallback(async () => {
        if (!pid || !selectedChapter || humanizingRef.current) return;
        humanizingRef.current = true;
        setHumanizing(true);
        try {
            const res = await api.aiComplete({
                action: "chat",
                entity_type: "chapter",
                entity_id: selectedChapter.id,
                extra: { system_hint: HUMANIZER_RULES, user_message: `请去除以下文本的 AI 写作痕迹：\n\n${editingContent}`, history: [] },
            });
            if (res.content && !res.error) {
                const safeContent = String(res.content ?? '');
                pushUndo();
                setEditingContent(safeContent);
                setTimeout(() => syncEditorHTML(safeContent), 0);
                _skipNextChapterEffect.current = true;
                setChapters(prev => {
                    const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: safeContent } : c);
                    saveChapters(upd);
                    return upd;
                });
            }
        } catch { /* ignore */ } finally {
            humanizingRef.current = false;
            setHumanizing(false);
        }
    }, [pid, selectedChapter, editingContent, pushUndo, setEditingContent, setChapters, saveChapters, syncEditorHTML]);

    const handlePolish = useCallback(async () => {
        if (!pid || !selectedChapter) return;
        setPolishing(true);
        try {
            const res = await api.aiComplete({
                action: "chat",
                entity_type: "chapter",
                entity_id: selectedChapter.id,
                extra: { system_hint: "你是一位小说编辑，请精简冗余段落、优化句式结构，保持原文含义不变。", user_message: `请精简优化以下文本：\n\n${editingContent}`, history: [] },
            });
            if (res.content && !res.error) {
                const safeContent = String(res.content ?? '');
                pushUndo();
                setEditingContent(safeContent);
                setTimeout(() => syncEditorHTML(safeContent), 0);
                _skipNextChapterEffect.current = true;
                setChapters(prev => {
                    const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: safeContent } : c);
                    saveChapters(upd);
                    return upd;
                });
            }
        } catch { /* ignore */ } finally {
            setPolishing(false);
        }
    }, [pid, selectedChapter, editingContent, pushUndo, setEditingContent, setChapters, saveChapters, syncEditorHTML]);

    const handleRebase = useCallback(async () => {
        if (!pid) return;
        setRebaseRunning(true);
        setRebaseProgress(null);
        try {
            const { rebaseMemory } = await import("@/lib/memory-updater");
            await rebaseMemory(pid, staleInfo?.fromChapter || 1, (current, total) => {
                setRebaseProgress({ current, total });
            });
            setStaleInfo(null);
            useAppStore.getState().setAutosaveStatus("✅ 级联重跑完成");
        } catch (e) {
            useAppStore.getState().setAutosaveStatus("⚠ 级联重跑失败");
        } finally {
            setRebaseRunning(false);
            setRebaseProgress(null);
        }
    }, [pid, staleInfo]);

    const handleReadToAI = useCallback(() => {
        // 委托给 WritingModule 中处理（依赖 storeSelIds 等状态）
    }, []);

    return {
        aiWriting, humanizing, polishing, aiError, rebaseRunning, rebaseProgress,
        staleInfo, writeDlg, setWriteDlg,
        handleAiWriteChapter, handleHumanize, handlePolish, handleRebase, handleReadToAI,
        setStaleInfo,
    };
}
