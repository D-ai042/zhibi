// useAiChatStream.ts — AI 流式对话 hook（T7）
import { useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { loadAllChapters } from "@/lib/chapter-store";
import { parseCharacterBatch } from "@/lib/character-parser";
import { uuid } from "@/lib/uuid";
import type { ChatMessage, WorldTerm } from "@/types";

export function useAiChatStream(
  setPendingTerms: (v: WorldTerm[]) => void,
  setPendingEdges: (v: { sourceTitle: string; targetTitle: string }[]) => void,
  setPendingChars: (v: { name: string; faction: string }[]) => void,
  setPendingCharEdges: (v: { sourceName: string; targetName: string; relation_type: string; strength: number }[]) => void,
  _setPendingRemoveEdges: (v: { sourceName: string; targetName: string }[]) => void,
  _setPendingSnapshots: (v: { name: string; changes: Record<string, string> }[]) => void,
  setPendingPlotSegments: (v: any[]) => void,
  setPendingPlotEdges: (v: any[]) => void,
  setPendingPlotBeats: (v: any[]) => void,
  setPendingChapters: (v: any[]) => void,
  setStreamingContent: (v: string) => void,
  setStreamingThinking: (v: string) => void,
  setStreamingPhase: (v: "idle"|"thinking"|"content"|"done") => void,
  setThinkingDuration: (v: number) => void,
) {
  const abortRef = useRef<AbortController | null>(null);
  const thinkingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; }
    setStreamingPhase("done");
  }, [setStreamingPhase]);

  const send = useCallback(async (input: string, uploadedFiles: { id: string; name: string; size: number; content: string }[]) => {
    const store = useAppStore.getState();
    const { currentProject, chatMessages, addChatMessage, appendChatMessages } = store;
    if (!currentProject) return;

    const hasAttachments = uploadedFiles.length > 0;
    let fullContent = input;
    if (hasAttachments) {
      const blocks = uploadedFiles.map(f => "\u2501".repeat(19) + "\n\u{1F4CE} \u9644\u4ef6: " + f.name + "\n\u2501".repeat(19) + "\n" + f.content + "\n\u2501".repeat(19));
      fullContent = input ? input + "\n\n---\n\u4ee5\u4e0b\u662f\u6211\u4e0a\u4f20\u7684\u53c2\u8003\u8d44\u6599\uff1a\n\n" + blocks.join("\n\n") + "\n---\n" : "\u8bf7\u53c2\u8003\u4ee5\u4e0b\u4e0a\u4f20\u7684\u8d44\u6599\uff1a\n" + blocks.join("\n\n");
    }

    const userMsg: ChatMessage = { id: uuid(), role: "user", content: fullContent, created_at: new Date().toISOString() };
    addChatMessage(userMsg);
    setPendingTerms([]); setPendingEdges([]); setPendingChars([]); setPendingCharEdges([]);
    setPendingPlotSegments([]); setPendingPlotEdges([]); setPendingPlotBeats([]); setPendingChapters([]);

    const streamId = uuid();
    try {
      const chapters = loadAllChapters(currentProject.id);
      const chapterSnippets = chapters.slice(-10).map(c => "\u7b2c" + c.number + "\u7ae0 " + c.title + ": " + (c.content || "").slice(0, 500)).join("\n");

      const chatHistory = chatMessages.slice(-20);
      const historyStr = chatHistory.map(m => m.role + ": " + m.content).join("\n");

      const controller = new AbortController();
      abortRef.current = controller;

      setStreamingContent(""); setStreamingThinking(""); setStreamingPhase("thinking");
      const thinkingStart = Date.now();
      thinkingRef.current = setInterval(() => setThinkingDuration(Math.floor((Date.now() - thinkingStart) / 1000)), 1000);

      let thinkBuf = "", contentBuf = "";
      let phase: "thinking" | "content" = "thinking";

      await api.aiCompleteStream({
        action: "chat",
        entity_type: "project",
        entity_id: currentProject.id,
        extra: {
          system_hint: "\u4f60\u662f\u4e00\u4e2a\u5c0f\u8bf4\u521b\u4f5c\u52a9\u624b\u3002\n\u3010\u6700\u8fd1\u7ae0\u8282\u6458\u8981\u3011\n" + chapterSnippets,
          user_message: historyStr + "\nuser: " + fullContent,
          history: [] as ChatMessage[],
        },
      } as any, {
        onChunk: (chunk: string, _type: string) => {
          if (phase === "thinking") { phase = "content"; setStreamingPhase("content"); if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; } }
          if (_type === "content" || _type === "") { contentBuf += chunk; setStreamingContent(contentBuf); }
        },
      }, controller.signal);

      if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; }
      setStreamingPhase("done");

      const finalContent = (thinkBuf ? "\u{1F9E0} **\u601d\u8003\u8fc7\u7a0b**\n" + thinkBuf + "\n\n" : "") + contentBuf;
      if (finalContent.trim()) {
        appendChatMessages([{ id: streamId, role: "assistant", content: finalContent, created_at: new Date().toISOString() }]);
      }
      const parsed = parseCharacterBatch(finalContent);
      if (parsed.chars?.length) setPendingChars((parsed.chars as any));
      if (parsed.edges?.length) setPendingCharEdges((parsed.edges as any));

    } catch (e: any) {
      if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; }
      setStreamingPhase("done");
      if (e?.name === "AbortError") {
        appendChatMessages([{ id: streamId, role: "system", content: "\u23F9 \u5df2\u505c\u6b62\u751f\u6210", created_at: new Date().toISOString() }]);
      } else {
        appendChatMessages([{ id: streamId, role: "system", content: "\u274C AI \u8bf7\u6c42\u5931\u8d25\uff1a" + (e?.message || String(e)), created_at: new Date().toISOString() }]);
      }
    }
    if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; }
    setStreamingPhase("done"); setStreamingContent(""); setStreamingThinking("");
  }, []);

  return { send, stopStream };
}
