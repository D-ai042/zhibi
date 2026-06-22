// useAiChatStream.ts — AI 流式对话 hook（T7：从 AiChatPanel 提取）
import { useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { buildModuleContext, buildChatContext, buildChapterContext, type ChatContextInput } from "@/lib/context-engine";
import { getJSONSync } from "@/lib/storage";
import { loadAllChapters } from "@/lib/chapter-store";
import { parseCharacterBatch } from "@/lib/character-parser";
import { uuid } from "@/lib/uuid";
import type { ChatMessage, MemoryEntry, WorldTerm } from "@/types";

const TEXT_EXTENSIONS = [".txt",".md",".json",".csv",".yaml",".yml",".xml",".html",".htm",".css",".js",".ts",".py",".java",".c",".cpp",".h",".rs",".go",".rb",".sh",".bat",".ps1",".env",".cfg",".ini",".toml",".tex",".rtf",".log",".docx"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

interface UploadedFile { id: string; name: string; size: number; content: string; }

export function useAiChatStream(
  setPendingTerms: (v: WorldTerm[]) => void,
  setPendingEdges: (v: { sourceTitle: string; targetTitle: string }[]) => void,
  setPendingChars: (v: { name: string; faction: string }[]) => void,
  setPendingCharEdges: (v: { sourceName: string; targetName: string; relation_type: string; strength: number }[]) => void,
  setPendingRemoveEdges: (v: { sourceName: string; targetName: string }[]) => void,
  setPendingSnapshots: (v: { name: string; changes: Record<string, string> }[]) => void,
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
  const streamingRef = useRef(false);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; }
    streamingRef.current = false;
    setStreamingPhase("done");
  }, [setStreamingPhase]);

  const send = useCallback(async (input: string, uploadedFiles: UploadedFile[]) => {
    const store = useAppStore.getState();
    const { currentProject, activeModule, chatMessages, addChatMessage, appendChatMessages } = store;
    if (!currentProject) return;

    const hasAttachments = uploadedFiles.length > 0;
    let fullContent = input;
    if (hasAttachments) {
      const blocks = uploadedFiles.map(f => `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\u{1F4CE} \u9644\u4ef6: ${f.name} (${formatSize(f.size)})\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n${f.content}\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
      fullContent = input ? input + "\n\n---\n\u4ee5\u4e0b\u662f\u6211\u4e0a\u4f20\u7684\u53c2\u8003\u8d44\u6599\uff1a\n\n" + blocks.join("\n\n") + "\n---\n" : "\u8bf7\u53c2\u8003\u4ee5\u4e0b\u4e0a\u4f20\u7684\u8d44\u6599\uff1a\n" + blocks.join("\n\n");
    }

    const userMsg: ChatMessage = { id: uuid(), role: "user", content: fullContent, created_at: new Date().toISOString() };
    addChatMessage(userMsg);
    setPendingTerms([]); setPendingEdges([]); setPendingChars([]); setPendingCharEdges([]);
    setPendingPlotSegments([]); setPendingPlotEdges([]); setPendingPlotBeats([]); setPendingChapters([]);

    const streamId = uuid();
    try {
      const fileHint = uploadedFiles.length > 0 ? "\n\u7528\u6237\u4e0a\u4f20\u4e86 " + uploadedFiles.length + " \u4e2a\u6587\u672c\u6587\u4ef6\u4f5c\u4e3a\u53c2\u8003\u8d44\u6599\uff1a" + uploadedFiles.map(f => f.name).join("\u3001") + "\u3002" : "";

      let segmentsCtx = "";
      if (currentProject && (activeModule === "outline" || activeModule === "writing")) {
        try {
          const segs = getJSONSync("plot-segments-" + currentProject.id, []);
          if (segs.length > 0) {
            segmentsCtx = "\n\n\u3010\u5267\u60c5\u8d70\u5411\u3011\n" + segs.map((s: any) => "\u2022 " + s.title + (s.chapters ? "(\u7b2c" + s.chapters + "\u7ae0)" : "") + (s.beats?.length ? " \u5171" + s.beats.length + "\u4e2a\u7ec6\u7eb2" : "")).join("\n");
          }
        } catch { /* ignore */ }
      }

      const chCtx: ChatContextInput = { projectId: currentProject.id, activeModule, outlineSection: store.outlineSection };
      const moduleCtx = buildModuleContext(chCtx);
      const chatHistory = chatMessages.slice(-20);
      const fullHistory = chatHistory.length === 0 ? userMsg.content : chatHistory.map(m => m.role + ": " + m.content).join("\n") + "\nuser: " + userMsg.content;
      const chapters = loadAllChapters(currentProject.id);
      const chapterSnippets = chapters.slice(-10).map(c => "\u7b2c" + c.number + "\u7ae0 " + c.title + ": " + (c.content || "").slice(0, 500)).join("\n");

      const systemHint = [
        "\u4f60\u662f\u4e00\u4e2a\u5c0f\u8bf4\u521b\u4f5c\u52a9\u624b\u3002",
        moduleCtx, fileHint, segmentsCtx,
        "\u3010\u6700\u8fd1\u7ae0\u8282\u6458\u8981\u3011\n" + chapterSnippets,
      ].filter(Boolean).join("\n");

      const controller = new AbortController();
      abortRef.current = controller;

      setStreamingContent(""); setStreamingThinking(""); setStreamingPhase("thinking");
      const thinkingStart = Date.now();
      thinkingRef.current = setInterval(() => setThinkingDuration(Math.floor((Date.now() - thinkingStart) / 1000)), 1000);

      let phase: "thinking" | "content" = "thinking";
      let thinkBuf = "", contentBuf = "";

      await api.chatStream(systemHint, fullHistory, controller.signal, {
        onThinking: (chunk: string) => {
          if (phase === "content") { phase = "content"; /* stay */ }
          thinkBuf += chunk; setStreamingThinking(thinkBuf);
        },
        onContent: (chunk: string) => {
          if (phase === "thinking") { phase = "content"; setStreamingPhase("content"); if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; } }
          contentBuf += chunk; setStreamingContent(contentBuf);
        },
      });

      if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; }
      setStreamingPhase("done");

      const finalContent = (thinkBuf ? "\u{1F9E0} **\u601d\u8003\u8fc7\u7a0b**\n" + thinkBuf + "\n\n" : "") + contentBuf;
      if (finalContent.trim()) {
        appendChatMessages([{ id: streamId, role: "assistant", content: finalContent, created_at: new Date().toISOString() }]);
      }
      const parsed = parseCharacterBatch(finalContent);
      if (parsed.chars?.length) setPendingChars(prev => [...prev, ...parsed.chars]);
      if (parsed.edges?.length) setPendingCharEdges(prev => [...prev, ...parsed.edges]);

    } catch (e: any) {
      if (e?.name === "AbortError") {
        appendChatMessages([{ id: streamId, role: "system", content: "\u23F9 \u5df2\u505c\u6b62\u751f\u6210", created_at: new Date().toISOString() }]);
      } else {
        appendChatMessages([{ id: streamId, role: "system", content: "\u274C AI \u8bf7\u6c42\u5931\u8d25\uff1a" + (e?.message || String(e)), created_at: new Date().toISOString() }]);
      }
    }
    if (thinkingRef.current) { clearInterval(thinkingRef.current); thinkingRef.current = null; }
    setStreamingPhase("done"); setStreamingContent(""); setStreamingThinking("");
    streamingRef.current = false;
  }, []);

  return { send, stopStream };
}
