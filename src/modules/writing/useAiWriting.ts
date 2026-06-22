// useAiWriting.ts — AI 写作 hooks（T6 拆分，从 WritingModule 完整提取）
import { useCallback, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { buildProjectContext } from "@/lib/context-engine";
import { rebaseMemory } from "@/lib/memory-updater";
import { getJSONSync } from "@/lib/storage";
import { uuid } from "@/lib/uuid";
import type { Chapter } from "@/types";

const POLISH_RULES = `你是资深文学编辑，专门给AI生成的小说去AI味。你的工作是做减法，不是做加法。你的任务：读完一章AI生成的小说，输出润色后的版本。只删不改——删冗余、简啰嗦、去模板化。`;

const HUMANIZER_RULES = `你是文字编辑，专门去除 AI 生成文本的痕迹，使文字听起来更自然、更有人味。核心原则：1. 删除填充短语 2. 打破公式结构 3. 变化节奏 4. 信任读者 5. 删除金句。直接输出改写后的完整文本。`;

export function useAiWriting(
    pid: string | undefined,
    selectedChapter: Chapter | null | undefined,
    editingContent: string,
    pushUndo: () => void,
    setEditingContent: (v: string) => void,
    setChapters: (updater: (prev: Chapter[]) => Chapter[]) => void,
    saveChapters: (pid: string, chs: Chapter[]) => void,
    syncEditorHTML: (content: string) => void,
) {
    const [aiWriting, setAiWriting] = useState(false);
    const [aiError, setAiError] = useState("");
    const [humanizing, setHumanizing] = useState(false);
    const [polishing, setPolishing] = useState(false);
    const [writeDlg, setWriteDlg] = useState<{ wordCount: number; plotDirection: string } | null>(null);

    const aiWritingRef = useRef(false);
    const polishingRef = useRef(false);
    const humanizingRef = useRef(false);
    const lastWriteParamsRef = useRef<{ wordCount: number; plotDirection: string } | null>(null);
    const _skipNextChapterEffect = useRef(false);
    const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    const handlePolish = useCallback(async () => {
        if (!pid || !selectedChapter || !String(editingContent ?? '').trim() || polishingRef.current) return;
        polishingRef.current = true; setPolishing(true);
        useAppStore.getState().setAutosaveStatus("正在精修...");
        try {
            const res = await api.aiComplete({ action: "chat", entity_type: "chapter", entity_id: selectedChapter.id, extra: { system_hint: POLISH_RULES, user_message: `请对以下文本做精修：\n\n${editingContent}`, history: [] } });
            if (res.content && !res.error) {
                const safeContent = String(res.content ?? '');
                pushUndo(); setEditingContent(safeContent);
                setTimeout(() => syncEditorHTML(safeContent), 0);
                _skipNextChapterEffect.current = true;
                setChapters(prev => { const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: safeContent } : c); saveChapters(pid, upd); return upd; });
                useAppStore.getState().setAutosaveStatus("✅ 精修完成");
            }
        } catch { } finally { polishingRef.current = false; setPolishing(false); }
    }, [pid, selectedChapter, editingContent, pushUndo, setEditingContent, setChapters, saveChapters, syncEditorHTML]);

    const handleHumanize = useCallback(async () => {
        if (!pid || !selectedChapter || !String(editingContent ?? '').trim() || humanizingRef.current) return;
        humanizingRef.current = true; setHumanizing(true);
        useAppStore.getState().setAutosaveStatus("正在去 AI 味...");
        try {
            const res = await api.aiComplete({ action: "chat", entity_type: "chapter", entity_id: selectedChapter.id, extra: { system_hint: HUMANIZER_RULES, user_message: `请去除以下文本的 AI 写作痕迹：\n\n${editingContent}`, history: [] } });
            if (res.content && !res.error) {
                const safeContent = String(res.content ?? '');
                pushUndo(); setEditingContent(safeContent);
                setTimeout(() => syncEditorHTML(safeContent), 0);
                _skipNextChapterEffect.current = true;
                setChapters(prev => { const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: safeContent } : c); saveChapters(pid, upd); return upd; });
                useAppStore.getState().setAutosaveStatus("✅ 去 AI 味完成");
            }
        } catch { } finally { humanizingRef.current = false; setHumanizing(false); }
    }, [pid, selectedChapter, editingContent, pushUndo, setEditingContent, setChapters, saveChapters, syncEditorHTML]);

    const handleAiWriteChapter = useCallback(async (wordCount: number, plotDirection: string, refIds?: string[]) => {
        if (!pid || !selectedChapter || aiWritingRef.current) return;
        aiWritingRef.current = true; setAiWriting(true); setAiError(""); setWriteDlg(null);
        lastWriteParamsRef.current = { wordCount, plotDirection };
        const safetyTimer = setTimeout(() => { if (aiWritingRef.current) { aiWritingRef.current = false; setAiWriting(false); setAiError("AI 写作超时（5分钟），请重试"); } }, 5 * 60 * 1000);
        timeoutIdsRef.current.push(safetyTimer);
        try {
            const output = await buildProjectContext({ projectId: pid, chapterId: selectedChapter.id, userIntent: undefined });
            let structureHint = ""; let inspContext = "";
            if (refIds?.length) {
                const inspIds = refIds.filter(r => r.startsWith("insp:")).map(r => r.slice(5));
                if (inspIds.length) { const allCards = getJSONSync(`inspiration-cards-${pid}`, [] as any[]); const sel = allCards.filter((c: any) => inspIds.includes(c.id)); if (sel.length) { inspContext = "\n【灵感参考】\n"; for (const c of sel) inspContext += `- ${c.title || "无标题"}：${(c.content || "").slice(0, 300)}\n`; } }
                const matIds = refIds.filter(r => r.startsWith("mat:")).map(r => r.slice(4));
                if (matIds.length) { const allItems = getJSONSync(`material-items-${pid}`, [] as any[]); const sel = allItems.filter((i: any) => matIds.includes(i.id) && (i.type === "text" || i.content)); if (sel.length) { const analyzed = sel.filter((i: any) => i.structureAnalysis); const plain = sel.filter((i: any) => !i.structureAnalysis); if (analyzed.length) { structureHint = "\n\n【⚠️ 结构参考，必须严格遵循】\n"; for (const t of analyzed) structureHint += `\n── ${t.name || "未命名"} ──\n${t.structureAnalysis}\n\n`; } if (plain.length) { inspContext += "\n【素材参考】\n" + plain.map(t => `── ${t.name || "未命名"} ──\n${t.content}\n`).join("\n"); } } }
            }
            const maxChars = Math.round(wordCount * 1.1); const minChars = Math.round(wordCount * 0.9);
            let um = structureHint ? `\n\n${structureHint}` : "";
            um += `\n\n请写第${selectedChapter.number}章「${selectedChapter.title}」。\n【字数要求】${minChars}-${maxChars}字（目标${wordCount}字），不可超出。`;
            if (plotDirection) um += `\n\n剧情方向：\n${plotDirection}`;
            if (inspContext) um += `\n\n${inspContext}`;
            um += `\n\n根据以上上下文，写出本章正文。`;
            const res = await api.aiComplete({ action: "write_chapter", entity_type: "chapter", entity_id: selectedChapter.id, extra: { system_hint: output.systemHint, user_message: um, history: [] } });
            if (res.error) setAiError(res.error);
            else if (res.content) {
                if (editingContent) pushUndo();
                const sc = String(res.content ?? ''); setEditingContent(sc);
                setTimeout(() => syncEditorHTML(sc), 0);
                _skipNextChapterEffect.current = true;
                setChapters(prev => { const upd = prev.map(c => c.id === selectedChapter.id ? { ...c, content: sc } : c); saveChapters(pid, upd); return upd; });
            }
        } catch (e) { setAiError(String(e)); }
        finally {
            for (let i = timeoutIdsRef.current.length - 1; i >= 0; i--) { if (timeoutIdsRef.current[i] === safetyTimer) { clearTimeout(timeoutIdsRef.current[i]); timeoutIdsRef.current.splice(i, 1); break; } }
            setAiWriting(false); aiWritingRef.current = false;
        }
    }, [pid, selectedChapter, editingContent, pushUndo, setEditingContent, setChapters, saveChapters, syncEditorHTML]);

    return { aiWriting, aiError, humanizing, polishing, writeDlg, setWriteDlg, lastWriteParamsRef, handleAiWriteChapter, handleHumanize, handlePolish };
}
