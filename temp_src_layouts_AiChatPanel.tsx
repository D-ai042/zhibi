import { useRef, useEffect, useState, useCallback } from "react";
import {
  FileText, Paperclip, Send, Sparkles, Trash2, X,
  ClipboardPlus, Download, Eraser, Mic, MicOff,
  Edit3, Square, Copy, RotateCcw,
} from "lucide-react";
import { useSttRecorder } from "@/lib/use-stt";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { buildModuleContext, buildChatContext, buildChapterContext, type ChatContextInput } from "@/lib/context-engine";
import { useAppStore } from "@/stores/app-store";
import { MemoryEngine } from "@/lib/memory-engine";
import type { ChatMessage, Character, MemoryEntry, WorldTerm } from "@/types";
import { MODULE_LABEL, OUTLINE_SECTION_LABEL } from "@/types";
import { uuid } from "@/lib/uuid";

/** 上传的文本文件 */
interface UploadedFile {
  id: string;
  name: string;
  size: number;
  content: string;
}

/** 支持上传的文件扩展名 */
const TEXT_EXTENSIONS = [
  ".txt", ".md", ".json", ".csv", ".yaml", ".yml",
  ".xml", ".html", ".htm", ".css", ".js", ".ts", ".py",
  ".java", ".c", ".cpp", ".h", ".rs", ".go", ".rb",
  ".sh", ".bat", ".ps1", ".env", ".cfg", ".ini",
  ".toml", ".tex", ".rtf", ".log",
  ".docx",
];

/** 文件大小格式化 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "我是你的小说创作助手。\n\n" +
    "⚠️ **使用前请在「API 设置」中配置对应厂商的 API Key**，未配置时 AI 功能不可用。\n\n" +
    "建议流程：\n" +
    "1. 在大纲里完善【世界观】【人物关系】【剧情走向】\n" +
    "2. 在【写作台】中按卷章写作，可随时框选文字进行扩写/润色/续写\n" +
    "3. **告诉我你想创建什么新模块**，我会为你生成并添加到左侧导航\n\n" +
    "������ 试试说：\n" +
    "• 「创建一个情节检查面板」\n" +
    "• 「帮我做一个角色分析模块」\n" +
    "• 「创建一个伏笔追踪面板」",
  created_at: new Date().toISOString(),
};

function contextHint(): string {
  const { activeModule, outlineSection, selectedEntity, currentProject } =
    useAppStore.getState();
  const parts = [`作品：${currentProject?.name ?? "未命名"}`];
  if (activeModule === "custom") {
    parts.push(`自定义模块`);
  } else {
    parts.push(`模块：${MODULE_LABEL[activeModule]}`);
    if (activeModule === "outline") {
      parts.push(`大纲分组：${OUTLINE_SECTION_LABEL[outlineSection]}`);
    }
  }
  if (selectedEntity) {
    parts.push(`选中：${selectedEntity.type} / ${selectedEntity.name}`);
  }
  return parts.join(" · ");
}

/**
 * 解析 AI 回复中的世界观词条创建指令（JSON 格式）。
 * AI 可在回复末尾附上：
 * ```json
 * {
 *   "action": "create_world_term",
 *   "term": {
 *     "term_type": "rule|faction|place|item|system|other",
 *     "title": "词条名",
 *     "one_liner": "一句话定义",
 *     "detail": "详细说明"
 *   }
 * }
 * ```
 */
function parseWorldTermAction(
  content: string
): { term_type: WorldTerm["term_type"]; title: string; one_liner?: string; detail?: string } | null {
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed.action === "create_world_term" && parsed.term) {
      return {
        term_type: parsed.term.term_type || "rule",
        title: parsed.term.title || "新词条",
        one_liner: parsed.term.one_liner || "",
        detail: parsed.term.detail || "",
      };
    }
  } catch {
    // 忽略解析失败
  }
  return null;
}

/**
 * 兜底方案：当 AI 未输出 JSON 时，从自然语言回复中提取词条信息。
 * 匹配模式如：「词条名」、创建了 xxx 词条 等。
 */

/**
 * 解析 AI 回复中的词条修改指令（update_world_term）。
 * AI 可通过对话直接修改已有词条：
 * ```json
 * {
 *   "action": "update_world_term",
 *   "term": {
 *     "title": "九霄宗",
 *     "title_new": "九霄宗·修改后",  // 如果改名称则传此项
 *     "one_liner": "新的定义",
 *     "detail": "新的详细描述"
 *   }
 * }
 * ```
 * 只传需要修改的字段，title 必填（用于匹配词条），title_new 选填（改为新名）。
 */
function parseWorldTermUpdate(
  content: string
): { title: string; title_new?: string; one_liner?: string; detail?: string } | null {
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed.action === "update_world_term" && parsed.term && parsed.term.title) {
      return {
        title: parsed.term.title,
        title_new: parsed.term.title_new,
        one_liner: parsed.term.one_liner,
        detail: parsed.term.detail,
      };
    }
  } catch { /* ignore */ }
  return null;
}

function extractWorldTermFromText(
  content: string,
  userMsg: string
): { term_type: WorldTerm["term_type"]; title: string; one_liner: string; detail: string } | null {
  // 尝试提取词条名：从「xxx」中提取
  const titleMatch = content.match(/「([^」]{1,20})」/);
  if (!titleMatch) return null;

  const title = titleMatch[1].trim();

  // 尝试从用户消息中推断类型
  let termType: WorldTerm["term_type"] = "rule";
  const typeMap: Record<string, WorldTerm["term_type"]> = {
    规则: "rule", 势力: "faction", 地点: "place", 道具: "item", 制度: "system", 其他: "other",
  };
  const bothMsgs = userMsg + "\n" + content;
  for (const [cn, en] of Object.entries(typeMap)) {
    if (bothMsgs.includes(cn)) { termType = en; break; }
  }

  // 从 AI 回复中提取一句话定义（第一段非标题文本）
  const lines = content.split("\n").filter(l => l.trim());
  const detailLines: string[] = [];
  let foundTitle = false;
  for (const line of lines) {
    const clean = line.replace(/^[#*> ]+/, "").trim();
    if (!clean) continue;
    if (clean.includes(title) && !foundTitle) { foundTitle = true; continue; }
    if (foundTitle && clean.length > 5 && !clean.startsWith("```")) {
      detailLines.push(clean);
    }
  }
  const oneLiner = detailLines[0] || "";
  const detail = detailLines.join("\n");

  // 只在明确提及创建词条时才生效
  const createHints = /(?:创建|添加|建立|增加)(?:了)?(?:一个|个|些)?(?:世界观)?(?:词条|术语|概念|设定)/;
  if (!createHints.test(content)) return null;

  return { term_type: termType, title, one_liner: oneLiner, detail };
}

/**
 * 解析 AI 回复中的批量世界观词条创建指令（JSON 数组格式）。
 * AI 可输出：
 * ```json
 * [{"action":"create_world_term","term":{"term_type":"rule","title":"灵力体系","one_liner":"...","detail":"..."}},
 *  {"action":"create_world_term","term":{"term_type":"faction","title":"九霄宗","one_liner":"...","detail":"..."}}]
 * ```
 */
function parseBatchWorldTerms(
  content: string
): { term_type: WorldTerm["term_type"]; title: string; one_liner: string; detail: string }[] {
  const mk = (t: string) => ({ term_type: inferTypeFromText(t) as WorldTerm["term_type"], title: t, one_liner: "", detail: "" });

  // 0) 特殊标记 ---WORLD_TERMS---（不会被 parseUIActions 误抢）
  const wtm = content.match(/---WORLD_TERMS---\s*([\s\S]*?)\s*---END_WORLD_TERMS---/);
  if (wtm) {
    try {
      const p = JSON.parse(wtm[1]);
      if (Array.isArray(p)) {
        return p
          .filter((a: Record<string, unknown>) => a.action === "create_world_term" && a.term)
          .map((a: Record<string, unknown>) => {
            const t = a.term as Record<string, string>;
            return { term_type: (t.term_type || "rule") as WorldTerm["term_type"], title: (t.title || "新词条").slice(0, 30), one_liner: t.one_liner || "", detail: t.detail || "" };
          });
      }
    } catch { }
  }

  // 1) JSON 数组块
  const jm = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (jm) {
    try {
      const p = JSON.parse(jm[1]);
      if (Array.isArray(p)) {
        return p
          .filter((a: Record<string, unknown>) => a.action === "create_world_term" && a.term)
          .map((a: Record<string, unknown>) => {
            const t = a.term as Record<string, string>;
            return { term_type: (t.term_type || "rule") as WorldTerm["term_type"], title: (t.title || "新词条").slice(0, 30), one_liner: t.one_liner || "", detail: t.detail || "" };
          });
      }
    } catch { }
  }

  // 2) Markdown ### 标题
  const hs = [...content.matchAll(/^#{2,4}\s+(.+)/gm)];
  if (hs.length >= 2) return hs.map(h => mk(h[1].replace(/\*\*/g, "").trim().slice(0, 30)));

  // 3) 粗体数字 **1. xxx**
  const bs = [...content.matchAll(/\*\*(\d+)[.)、]\s*([^*]{1,40})\*\*/g)];
  if (bs.length >= 2) return bs.map(m => mk(m[2].replace(/\*\*/g, "").trim().slice(0, 30)));

  // 4) 纯文本编号 一、xxx  1. xxx
  const ns = [...content.matchAll(/(?:^|\n)([一二三四五六七八九十\d]+)[、.]\s*(.{1,30})/g)];
  if (ns.length >= 2) return ns.map(m => mk(m[2].trim().slice(0, 30)));

  // 5) 兜底：任何 Markdown 列表项 - xxx
  const li = [...content.matchAll(/(?:^|\n)[\s]*[-*•]\s+(.{2,30})/gm)];
  if (li.length >= 2) return li.map(m => mk(m[1].trim().slice(0, 30)));

  return [];
}

/** 从文本推断类型 */
function inferTypeFromText(text: string): WorldTerm["term_type"] {
  if (/规则|法则|体系|境界|修炼|功法|灵力|熟练度|品阶/.test(text) && !(/宗门|势力|王朝|门派/.test(text))) return "rule";
  if (/势力|宗门|王朝|家族|门派|组织|分布/.test(text)) return "faction";
  if (/地点|禁地|村|州|界|大陆|天地|国|朝/.test(text) && !(/势力|宗门/.test(text))) return "place";
  if (/道具|法器|丹药|物品|剑|神器/.test(text)) return "item";
  if (/制度|规矩|大比|资格|管理|层次|比试/.test(text)) return "system";
  return "other";
}

/**
 * 解析 AI 回复中的自动连线指令（create_edge）
 */
function parseEdgeActions(content: string): { sourceTitle: string; targetTitle: string }[] {
  // 优先从 WORLD_TERMS 标记中读
  const wtm = content.match(/---WORLD_TERMS---\s*([\s\S]*?)\s*---END_WORLD_TERMS---/);
  const source = wtm ? wtm[1] : content;
  // 尝试匹配裸 JSON 数组
  const arrMatch = source.match(/\[[\s\S]*?\]/);
  if (!arrMatch) return [];
  try {
    const parsed = JSON.parse(arrMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a: { action: string }) => a.action === "create_edge")
      .map((a: { edge: { sourceTitle: string; targetTitle: string } }) => a.edge);
  } catch { return []; }
}

/**
 * 解析 AI 回复中的人物角色批量创建指令（---CHARACTERS--- 块）
 */
function parseCharacterBatch(content: string): {
  chars: { name: string; faction: string; gender?: string; age?: string; race?: string; appearance?: string; personality?: string; background?: string; ability?: string; style?: string; interests?: string }[];
  edges: { sourceName: string; targetName: string; relation_type: string; strength: number }[];
  removeEdges: { sourceName: string; targetName: string }[];
} {
  const m = content.match(/---CHARACTERS---\s*([\s\S]*?)\s*---END_CHARACTERS---/);
  if (!m) return { chars: [], edges: [], removeEdges: [] };
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr)) return { chars: [], edges: [], removeEdges: [] };
    const chars = arr
      .filter((a: any) => a.action === "create_character" && a.character)
      .map((a: any) => ({
        name: (a.character.name || "").slice(0, 20),
        faction: a.character.faction || "",
        gender: a.character.gender,
        age: a.character.age,
        race: a.character.race,
        appearance: a.character.appearance,
        personality: a.character.personality,
        background: a.character.background,
        ability: a.character.ability,
        style: a.character.style,
        interests: a.character.interests,
      }));
    const edges = arr
      .filter((a: any) => a.action === "create_relationship" && a.edge)
      .map((a: any) => ({ sourceName: a.edge.sourceName, targetName: a.edge.targetName, relation_type: a.edge.relation_type || "关联", strength: a.edge.strength || 5 }));
    const removeEdges = arr
      .filter((a: any) => (a.action === "remove_relationship" || a.action === "delete_relationship") && a.edge)
      .map((a: any) => ({ sourceName: a.edge.sourceName, targetName: a.edge.targetName }));
    return { chars, edges, removeEdges };
  } catch { return { chars: [], edges: [], removeEdges: [] }; }
}

/**
 * 解析 AI 回复中的人物角色更新指令（---CHARACTER_UPDATE--- 块）
 * 用于完善角色卡字段：种族、外在形象、内在性格、背景经历、能力、行事风格、兴趣爱好
 */
function parseCharacterUpdate(content: string): { name: string; fields: Record<string, string> }[] {
  const results: { name: string; fields: Record<string, string> }[] = [];
  const regex = /---CHARACTER_UPDATE---\s*(\[[\s\S]*?\])\s*---END_CHARACTER_UPDATE---/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      const arr = JSON.parse(match[1]);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (item.name && item.fields) {
          results.push({ name: item.name, fields: item.fields });
        }
      }
    } catch { /* skip invalid JSON */ }
  }
  return results;
}

/**
 * 从文本中删除所有不属于当前模块的块模板（物理过滤）。
 * 保留自然语言信息，只删除 ---XXX--- 标记块。
 */
function stripOtherModuleBlocks(content: string, currentModule: string, outlineSection: string): string {
  let result = content;
  // 当前模块的世界观块要保留，其他模块的世界观块删除
  if (!(currentModule === "outline" && outlineSection === "worldview")) {
    result = result
      .replace(/---WORLD_TERMS---[\s\S]*?---END_WORLD_TERMS---/g, "")
      .replace(/```(?:json)?\s*\{[\s\S]*?"action"\s*:\s*"(?:create_world_term|update_world_term)"[\s\S]*?\}\s*```/g, "");
  }
  // 当前模块的人物块要保留，其他模块的人物块删除
  if (!(currentModule === "outline" && outlineSection === "characters")) {
    result = result
      .replace(/---CHARACTERS---[\s\S]*?---END_CHARACTERS---/g, "")
      .replace(/---CHARACTER_UPDATE---[\s\S]*?---END_CHARACTER_UPDATE---/g, "");
  }
  // 当前模块的剧情块要保留，其他模块的剧情块删除
  if (!(currentModule === "outline" && outlineSection === "plot-direction")) {
    result = result
      .replace(/---PLOT_SEGMENTS---[\s\S]*?---END_PLOT_SEGMENTS---/g, "");
  }
  return result;
}

/**
 * 从文本中删除所有块模板，仅保留自然语言（用于保存到历史）。
 */
function stripAllBlocks(content: string): string {
  return content
    .replace(/---WORLD_TERMS---[\s\S]*?---END_WORLD_TERMS---/g, "")
    .replace(/---CHARACTERS---[\s\S]*?---END_CHARACTERS---/g, "")
    .replace(/---CHARACTER_UPDATE---[\s\S]*?---END_CHARACTER_UPDATE---/g, "")
    .replace(/---PLOT_SEGMENTS---[\s\S]*?---END_PLOT_SEGMENTS---/g, "")
    .replace(/---WORLD_TERM_UPDATE---[\s\S]*?---END_WORLD_TERM_UPDATE---/g, "")
    .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
    .trim();
}

/**
 * 解析 AI 回复中的批量世界观词条修改指令（---WORLD_TERM_UPDATE--- 块）
 * 与 ---CHARACTER_UPDATE--- 格式一致，用于批量更新世界词条
 */
function parseWorldTermUpdateBatch(content: string): { title: string; fields: Record<string, string> }[] {
  const results: { title: string; fields: Record<string, string> }[] = [];
  const regex = /---WORLD_TERM_UPDATE---\s*(\[[\s\S]*?\])\s*---END_WORLD_TERM_UPDATE---/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      const arr = JSON.parse(match[1]);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (item.title && item.fields) {
          results.push({ title: item.title, fields: item.fields });
        }
      }
    } catch { /* skip invalid JSON */ }
  }
  return results;
}

/**
 * 解析 AI 回复中的剧情走向段落创建指令（---PLOT_SEGMENTS--- 块）
 */
function parsePlotSegments(content: string): {
  segments: { type: "bright" | "dark"; title: string; characters: string; location: string; time: string; chapters: string; event: string }[];
  edges: { sourceTitle: string; targetTitle: string }[];
} {
  const m = content.match(/---PLOT_SEGMENTS---\s*([\s\S]*?)\s*---END_PLOT_SEGMENTS---/);
  if (!m) return { segments: [], edges: [] };
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr)) return { segments: [], edges: [] };
    const segments = arr
      .filter((a: any) => a.action === "create_segment" && a.segment)
      .map((a: any) => ({
        type: a.segment.type === "dark" ? "dark" as const : "bright" as const,
        title: (a.segment.title || "").slice(0, 30),
        characters: a.segment.characters || "",
        location: a.segment.location || "",
        time: a.segment.time || "",
        chapters: a.segment.chapters || "",
        event: a.segment.event || "",
      }));
    const edges = arr
      .filter((a: any) => a.action === "create_edge" && a.edge)
      .map((a: any) => ({ sourceTitle: a.edge.sourceTitle, targetTitle: a.edge.targetTitle }));
    return { segments, edges };
  } catch { return { segments: [], edges: [] }; }
}

export function AiChatPanel() {
  const {
    chatMessages,
    addChatMessage,
    appendChatMessages,
    clearChat,
    activeModule,
    outlineSection,
    selectedEntity,
    currentProject,
    memoryBump,
    pendingAiCharsBump,
    chapterSelectMode,
  } = useAppStore();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [pendingTerms, setPendingTerms] = useState<WorldTerm[]>([]);
  const [pendingEdges, setPendingEdges] = useState<{ sourceTitle: string; targetTitle: string }[]>([]);
  const [pendingChars, setPendingChars] = useState<{ name: string; faction: string; gender?: string; age?: string; race?: string; appearance?: string; personality?: string; background?: string; ability?: string; style?: string; interests?: string }[]>([]);
  const [pendingCharEdges, setPendingCharEdges] = useState<{ sourceName: string; targetName: string; relation_type: string; strength: number }[]>([]);
  const [pendingRemoveEdges, setPendingRemoveEdges] = useState<{ sourceName: string; targetName: string }[]>([]);
  const [pendingPlotSegments, setPendingPlotSegments] = useState<{ type: "bright" | "dark"; title: string; characters: string; location: string; time: string; chapters: string; event: string }[]>([]);
  const [pendingPlotEdges, setPendingPlotEdges] = useState<{ sourceTitle: string; targetTitle: string }[]>([]);
  const [memoryTab, setMemoryTab] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [sttLoading, setSttLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingPhase, setStreamingPhase] = useState<"idle" | "thinking" | "content" | "done">("idle");
  const [, setStreamingMsgId] = useState<string | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState(0);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const memoryEngineRef = useRef<MemoryEngine | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamThinkingRef = useRef("");
  const streamContentRef = useRef("");
  const streamingPhaseRef = useRef<"idle" | "thinking" | "content" | "done">("idle");
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  const stt = useSttRecorder();

  // STT 录音并转文字
  const handleSttToggle = useCallback(async () => {
    if (stt.stateRef.current === "recording") {
      setSttLoading(true);
      const text = await stt.stopAndTranscribe();
      setSttLoading(false);
      if (text) {
        setInput(prev => prev + text);
      }
    } else {
      stt.startRecording();
    }
  }, [stt]);

  // STT 启用状态由 apiConfig 控制

  const messages = chatMessages.length > 0 ? chatMessages : [WELCOME];

  useEffect(() => {
    // flex-col-reverse 模式下滚动已在底部，无需 scrollIntoView
  }, [messages.length, loading]);

  // 自动滚动到底部（非 reversed 模式）
  useEffect(() => {
    const el = chatContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, loading, streamingContent, streamingThinking]);

  // 初始化记忆引擎
  useEffect(() => {
    if (currentProject?.id) {
      const engine = new MemoryEngine(currentProject.id);
      memoryEngineRef.current = engine;
      setMemoryEntries(engine.getShortTerm());
    } else {
      memoryEngineRef.current = null;
      setMemoryEntries([]);
    }
  }, [currentProject?.id]);

  // 记忆更新时刷新显示
  useEffect(() => {
    if (memoryEngineRef.current) {
      setMemoryEntries(memoryEngineRef.current.getShortTerm());
    }
  }, [memoryBump]);

  // AI 写本章后识别到新角色 → 合并到待确认列表
  useEffect(() => {
    if (!currentProject?.id || pendingAiCharsBump <= 0) return;
    try {
      const raw = localStorage.getItem(`ai-pending-chars-${currentProject.id}`);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data.chars?.length && !data.edges?.length) return;
      // 合并到本地 pending 状态
      if (data.chars?.length > 0) {
        setPendingChars(prev => [...prev, ...data.chars]);
      }
      if (data.edges?.length > 0) {
        setPendingCharEdges(prev => [...prev, ...data.edges]);
      }
      // 清除已读取的数据
      localStorage.removeItem(`ai-pending-chars-${currentProject.id}`);
    } catch { /* ignore */ }
  }, [pendingAiCharsBump, currentProject?.id]);

  /** 读取上传的文件（支持文本 + .docx） */
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: UploadedFile[] = [];
    for (const file of files) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext)) {
        appendChatMessages([{
          id: uuid(),
          role: "system",
          content: `⚠️ 不支持的文件类型「${ext}」。支持：文本文件（.txt .md .json .csv .yaml .xml .html .js .ts .py 等）和 Word 文档（.docx）`,
          created_at: new Date().toISOString(),
        }]);
        continue;
      }

      // .docx 文件限制 10MB（富文本较大）
      const isDocx = ext === ".docx";
      const maxSize = isDocx ? 10 * 1024 * 1024 : 1024 * 1024;
      if (file.size > maxSize) {
        appendChatMessages([{
          id: uuid(),
          role: "system",
          content: `⚠️ 文件「${file.name}」超过 ${isDocx ? "10MB" : "1MB"} 限制。`,
          created_at: new Date().toISOString(),
        }]);
        continue;
      }

      try {
        let content: string;
        if (isDocx) {
          // 用 mammoth 解析 .docx → 纯文本
          try {
            const arrayBuffer = await file.arrayBuffer();
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ arrayBuffer });
            content = result.value;
          } catch {
            appendChatMessages([{
              id: uuid(),
              role: "system",
              content: `⚠️ 解析 Word 文档「${file.name}」失败，请确认文件未损坏。`,
              created_at: new Date().toISOString(),
            }]);
            continue;
          }
        } else {
          content = await file.text();
        }
        newFiles.push({
          id: uuid(),
          name: file.name,
          size: file.size,
          content,
        });
      } catch {
        appendChatMessages([{
          id: uuid(),
          role: "system",
          content: `⚠️ 读取文件「${file.name}」失败，请重试。`,
          created_at: new Date().toISOString(),
        }]);
      }
    }
    setUploadedFiles((prev) => [...prev, ...newFiles]);
    // 重置 file input 以便重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [appendChatMessages]);

  /** 移除已上传的文件 */
  const removeFile = useCallback((fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const hasAttachments = uploadedFiles.length > 0;

  /** 获取最后一条 AI 回复 */
  const lastAssistantMessage = useCallback(() => {
    const reversed = [...chatMessages].reverse();
    return reversed.find((m) => m.role === "assistant") ?? null;
  }, [chatMessages]);

  /** 插入：将待插入的词条写入画布 */
  const handleInsert = useCallback(async () => {
    if (pendingTerms.length === 0) {
      appendChatMessages([{
        id: uuid(),
        role: "system",
        content: "⚠️ 没有待插入的词条。请先在对话中让 AI 生成词条内容。",
        created_at: new Date().toISOString(),
      }]);
      return;
    }
    const store = useAppStore.getState();
    const curProject = store.currentProject;
    if (!curProject) return;

    const idMap = new Map<string, string>();
    const titles: string[] = [];

    for (const term of pendingTerms) {
      const id = uuid();
      idMap.set(term.title, id);
      await api.saveWorldTerm({ ...term, id, project_id: curProject.id });
      titles.push(term.title);
    }

    // 连线
    if (pendingEdges.length > 0 && curProject) {
      const edgeKey = "worldview-edges-" + curProject.id;
      const existing = JSON.parse(localStorage.getItem(edgeKey) || "[]");
      for (const ea of pendingEdges) {
        const srcId = idMap.get(ea.sourceTitle);
        const tgtId = idMap.get(ea.targetTitle);
        if (srcId && tgtId) {
          existing.push({
            id: uuid(),
            source: srcId,
            target: tgtId,
            type: "straight",
            style: { stroke: "#94a3b8", strokeWidth: 2 },
          });
        }
      }
      localStorage.setItem(edgeKey, JSON.stringify(existing));
    }

    store.bumpWorldTerms();
    setPendingTerms([]);
    setPendingEdges([]);

    // 自动导航到世界观画布查看
    store.navigateTo("outline");
    store.setOutlineSection("worldview");

    appendChatMessages([{
      id: uuid(),
      role: "system",
      content: `������ 已插入 ${titles.length} 个词条到画布：${titles.join("、")}`,
      created_at: new Date().toISOString(),
    }]);
  }, [pendingTerms, pendingEdges, appendChatMessages]);

  /** 插入人物：将待插入角色写入画布 */
  const handleCharacterInsert = useCallback(async () => {
    if (pendingChars.length === 0 && pendingCharEdges.length === 0) return;
    const store = useAppStore.getState();
    const curProject = store.currentProject;
    if (!curProject) return;

    // 加载已有角色构建完整 name→id 映射
    const existingChars = await api.listCharacters(curProject.id);
    const nameMap = new Map<string, string>();
    for (const ec of existingChars) nameMap.set(ec.name, ec.id);

    for (const ch of pendingChars) {
      const id = uuid();
      nameMap.set(ch.name, id);
      const c: Character = {
        id, project_id: curProject.id, name: ch.name, faction: ch.faction,
        weight: 5, desire: "", fear: "", flaw: "", arc: "",
        voice_style: "", ending_node_id: null, avatar_path: null,
        layout_x: 0, layout_y: 0, is_locked: false,
        gender: ch.gender ?? "", age: ch.age ?? "", race: ch.race ?? "",
        appearance: ch.appearance ?? "", personality: ch.personality ?? "",
        background: ch.background ?? "", ability: ch.ability ?? "",
        style: ch.style ?? "", interests: ch.interests ?? "",
      };
      await api.saveCharacter(c);
    }

    // 删除旧关系
    const existingEdges = await api.listRelationshipEdges(curProject.id);
    for (const re of pendingRemoveEdges) {
      const srcId = nameMap.get(re.sourceName);
      const tgtId = nameMap.get(re.targetName);
      if (!srcId || !tgtId) continue;
      const toRemove = existingEdges.filter(
        e => e.source_id === srcId && e.target_id === tgtId
      );
      for (const e of toRemove) await api.deleteRelationshipEdge(e.id);
    }

    // 新增关系
    for (const ea of pendingCharEdges) {
      const srcId = nameMap.get(ea.sourceName);
      const tgtId = nameMap.get(ea.targetName);
      if (srcId && tgtId) {
        await api.saveRelationshipEdge({
          id: uuid(), project_id: curProject.id,
          source_id: srcId, target_id: tgtId,
          relation_type: ea.relation_type, strength: ea.strength, is_secret: false,
        });
      }
    }

    store.bumpCharacters();
    setPendingChars([]);
    setPendingCharEdges([]);
    setPendingRemoveEdges([]);

    // 自动导航到人物关系星图
    store.navigateTo("outline");
    store.setOutlineSection("characters");

    const parts: string[] = [];
    if (pendingChars.length > 0) parts.push(`角色：${pendingChars.map(c => c.name).join("、")}`);
    if (pendingCharEdges.length > 0) parts.push(`${pendingCharEdges.length} 条关系`);
    if (pendingRemoveEdges.length > 0) parts.push(`删除 ${pendingRemoveEdges.length} 条关系`);
    appendChatMessages([{
      id: uuid(), role: "system",
      content: `������ 已更新人物星图：${parts.join(" · ")}`,
      created_at: new Date().toISOString(),
    }]);
  }, [pendingChars, pendingCharEdges, pendingRemoveEdges, appendChatMessages]);

  /** 剧情段落：将待确认的段落插入到剧情走向画布 */
  const handlePlotInsert = useCallback(async () => {
    if (!currentProject || pendingPlotSegments.length === 0) return;
    const pid = currentProject.id;
    const existing = JSON.parse(localStorage.getItem("plot-segments-" + pid) || "[]");
    const nameMap = new Map<string, string>();
    for (const s of existing) nameMap.set(s.title, s.id);

    for (const seg of pendingPlotSegments) {
      const id = uuid();
      nameMap.set(seg.title, id);
      existing.push({ id, project_id: pid, ...seg });
    }
    localStorage.setItem("plot-segments-" + pid, JSON.stringify(existing));

    // 连线
    const existingEdges = JSON.parse(localStorage.getItem("plot-edges-" + pid) || "[]");
    for (const ea of pendingPlotEdges) {
      const srcId = nameMap.get(ea.sourceTitle);
      const tgtId = nameMap.get(ea.targetTitle);
      if (srcId && tgtId) {
        existingEdges.push({
          id: uuid(), source: srcId, target: tgtId,
          sourceHandle: "right", targetHandle: "left",
          type: "straight", style: { stroke: "#94a3b8", strokeWidth: 2 },
        });
      }
    }
    localStorage.setItem("plot-edges-" + pid, JSON.stringify(existingEdges));

    // 触发刷新
    const store = useAppStore.getState();
    store.setOutlineSection("plot-direction");
    store.bumpPlot();

    setPendingPlotSegments([]);
    setPendingPlotEdges([]);

    appendChatMessages([{
      id: uuid(), role: "system",
      content: `������ 已创建 ${pendingPlotSegments.length} 个剧情段落（${pendingPlotSegments.filter(s => s.type === "bright").length} 明线 + ${pendingPlotSegments.filter(s => s.type === "dark").length} 暗线）${pendingPlotEdges.length > 0 ? ` + ${pendingPlotEdges.length} 条连线` : ""}，刷新画布查看。`,
      created_at: new Date().toISOString(),
    }]);
  }, [currentProject, pendingPlotSegments, pendingPlotEdges, appendChatMessages]);

  /** 插入文本：将 AI 回复文本插入到写作台编辑器 */
  const handleTextInsert = useCallback(() => {
    const store = useAppStore.getState();
    const activeModule = store.activeModule;
    const writingChapterId = store.writingChapterId;
    if (activeModule !== "writing" || !writingChapterId) {
      appendChatMessages([{
        id: uuid(), role: "system",
        content: "⚠️ 请先在「写作台」中打开一个章节，再插入文本。",
        created_at: new Date().toISOString(),
      }]);
      return;
    }
    // 检查最后一条 AI 回复（优先 store 中的，其次显示中的 WELCOME）
    const last = lastAssistantMessage();
    const source = last ?? (chatMessages.length === 0 ? WELCOME : null);
    if (!source) {
      appendChatMessages([{
        id: uuid(), role: "system",
        content: "⚠️ 没有可插入的 AI 回复。请先在对话中让 AI 生成内容。",
        created_at: new Date().toISOString(),
      }]);
      return;
    }
    // 提取文本内容（去除 markdown 图片、链接）
    let text = source.content;
    text = text.replace(/!\[.*?\]\(.*?\)/g, "");
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // 追加到写作台草稿
    const currentDraft = store.writingDraft;
    store.setWritingDraft(currentDraft ? currentDraft + "\n\n" + text : text);
    appendChatMessages([{
      id: uuid(), role: "system",
      content: `������ 已将 AI 回复插入到写作台章节编辑器中。`,
      created_at: new Date().toISOString(),
    }]);
  }, [lastAssistantMessage, appendChatMessages, chatMessages.length]);

  /** 移除：删除最后一条 AI 回复 */
  const handleRemoveLast = useCallback(() => {
    const last = lastAssistantMessage();
    if (!last) {
      appendChatMessages([{
        id: uuid(),
        role: "system",
        content: "⚠️ 没有可移除的 AI 回复。",
        created_at: new Date().toISOString(),
      }]);
      return;
    }
    // 从 store 中移除最后一条 assistant 消息
    const store = useAppStore.getState();
    const idx = [...store.chatMessages].reverse().findIndex((m) => m.role === "assistant");
    if (idx >= 0) {
      const realIdx = store.chatMessages.length - 1 - idx;
      const newMsgs = store.chatMessages.filter((_, i) => i !== realIdx);
      // 直接替换 chatMessages
      useAppStore.setState({ chatMessages: newMsgs });
    }
  }, [lastAssistantMessage, appendChatMessages]);

  /** 保存：将最后一条 AI 回复下载为 .md 文件 */
  const handleSave = useCallback(() => {
    const last = lastAssistantMessage();
    if (!last) {
      appendChatMessages([{
        id: uuid(),
        role: "system",
        content: "⚠️ 没有可保存的 AI 回复。",
        created_at: new Date().toISOString(),
      }]);
      return;
    }
    const blob = new Blob([last.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-");
    a.href = url;
    a.download = `AI-回复-${timestamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
    appendChatMessages([{
      id: uuid(),
      role: "system",
      content: `✅ AI 回复已保存为「${a.download}」。`,
      created_at: new Date().toISOString(),
    }]);
  }, [lastAssistantMessage, appendChatMessages]);

  /** 终止 AI 生成 */
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  /** 编辑用户消息：进入行内编辑模式 */
  const handleEditUserMessage = useCallback((msgId: string, content: string) => {
    setEditingMsgId(msgId);
    setEditingContent(content);
  }, []);

  /** 确认修改：删除该消息及之后所有消息，重新发送 */
  const handleConfirmEdit = useCallback((msgId: string) => {
    const store = useAppStore.getState();
    const idx = store.chatMessages.findIndex(m => m.id === msgId);
    if (idx < 0) return;
    const newMsgs = store.chatMessages.slice(0, idx);
    useAppStore.setState({ chatMessages: newMsgs });
    const text = editingContent.trim();
    if (text) {
      setInput(text);
      requestAnimationFrame(() => {
        const btn = document.querySelector<HTMLButtonElement>('[data-send-btn]');
        btn?.click();
      });
    }
    setEditingMsgId(null);
    setEditingContent("");
  }, [editingContent]);

  /** 删除用户消息及其对应的 AI 回复 */
  const handleDeleteMessage = useCallback((msgId: string) => {
    const store = useAppStore.getState();
    const msgs = store.chatMessages;
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx < 0) return;
    const toRemove = new Set([idx]);
    // 如果下一跳是 assistant，也一起删掉
    if (msgs[idx + 1]?.role === "assistant") toRemove.add(idx + 1);
    useAppStore.setState({ chatMessages: msgs.filter((_, i) => !toRemove.has(i)) });
  }, []);

  /** 复制 AI 回复到剪贴板 */
  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      appendChatMessages([{
        id: uuid(), role: "system",
        content: "✅ 已复制到剪贴板",
        created_at: new Date().toISOString(),
      }]);
    } catch {
      // 降级：创建临时 textarea
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, [appendChatMessages]);

  /** 重新生成：删除最后 AI 回复，直接用原消息重新发送 */
  const handleRegenerate = useCallback(() => {
    const store = useAppStore.getState();
    const all = store.chatMessages;
    const idx = [...all].reverse().findIndex((m) => m.role === "assistant");
    if (idx < 0) return;
    const realIdx = all.length - 1 - idx;
    const userIdx = realIdx - 1;
    const userMsg = userIdx >= 0 && all[userIdx]?.role === "user" ? all[userIdx] : null;
    const toRemove = new Set<number>([realIdx]);
    if (userMsg) toRemove.add(userIdx);
    useAppStore.setState({ chatMessages: all.filter((_, i) => !toRemove.has(i)) });
    if (userMsg) {
      setInput(userMsg.content);
      // 用 rAF 确保 React 更新 input 后再触发 send
      requestAnimationFrame(() => {
        const btn = document.querySelector<HTMLButtonElement>('[data-send-btn]');
        btn?.click();
      });
    }
  }, []);

  const send = async () => {
    const text = input.trim();
    if ((!text && !hasAttachments) || loading) return;

    // 如果有上传文件，将文件内容拼接到用户消息中
    let fullContent = text;
    if (hasAttachments) {
      const fileBlocks = uploadedFiles.map((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        return [
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `������ 附件：${f.name} (${formatSize(f.size)})`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `${f.content}`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ].join("\n");
      });
      const fileSection = `\n\n---\n以下是我上传的参考资料：\n\n${fileBlocks.join("\n\n")}\n---\n`;
      fullContent = text
        ? `${text}\n\n${fileSection}`
        : `请参考以下上传的资料：\n${fileSection}`;
    }

    const userMsg: ChatMessage = {
      id: uuid(),
      role: "user",
      content: fullContent,
      created_at: new Date().toISOString(),
    };
    addChatMessage(userMsg);
    setInput("");
    const sentFiles = [...uploadedFiles];
    setUploadedFiles([]);
    setLoading(true);
    // 新对话开始：清空旧待插入词条/角色/剧情段落
    setPendingTerms([]);
    setPendingEdges([]);
    setPendingChars([]);
    setPendingCharEdges([]);
    setPendingPlotSegments([]);
    setPendingPlotEdges([]);

    const store = useAppStore.getState();
    const streamId = uuid();

    try {

      // 文件附加上下文提示
      const fileContextHint =
        sentFiles.length > 0
          ? `\n用户上传了 ${sentFiles.length} 个文本文件作为参考资料：${sentFiles.map((f) => f.name).join("、")}。`
          : "";

      // 通过上下文引擎加载项目数据上下文（模块感知 v2.0）
      let projectContext = "";
      if (currentProject) {
        try {
          // 根据当前模块选择上下文类型
          let ctxModule: ChatContextInput["module"] = "chat";
          if (activeModule === "outline") {
            if (outlineSection === "worldview") ctxModule = "worldview";
            else if (outlineSection === "characters") ctxModule = "characters";
            else if (outlineSection === "plot-direction") ctxModule = "plot-direction";
          } else if (activeModule === "writing") {
            ctxModule = "writing";
          } else if (activeModule === "story-bible") {
            ctxModule = "story-bible";
          }
          projectContext = await buildModuleContext({
            projectId: currentProject.id,
            module: ctxModule,
            section: outlineSection,
            chapterId: store.writingChapterId ?? undefined,
            entityId: selectedEntity?.id,
          });
        } catch {
          projectContext = await buildChatContext(currentProject.id).catch(() => "");
        }

        // 单独检测用户消息中的章节引用（独立 try-catch，不影响主上下文）
        try {
          const chapterRange = detectChapterRange(input); // 用 input（原始文本）而非 fullContent
          if (chapterRange) {
            const chapterCtx = await buildChapterContext(currentProject.id, chapterRange);
            projectContext += "\n\n===== ������ 用户指定查看的章节 =====\n" + chapterCtx;
          }
        } catch { /* 章节读取失败不影响主流程 */ }
      }

      // ====== 直接指令：检测"X改为Y"模式，不经过 AI ======
      if (currentProject && activeModule === "outline" && outlineSection === "worldview") {
        const renameMatch = fullContent.match(/(?:把|将)?(.{2,20})(?:改名为?|修改为|改成|改为)(.{2,20})/);
        if (renameMatch) {
          const oldName = renameMatch[1].trim();
          const newName = renameMatch[2].trim();
          const allTerms = await api.listWorldTerms(currentProject.id);
          const target = allTerms.find(t => t.title === oldName);
          if (target) {
            await api.deleteWorldTerm(target.id);
            await api.saveWorldTerm({ ...target, id: uuid(), title: newName });
            useAppStore.getState().bumpWorldTerms();
            appendChatMessages([{
              id: uuid(), role: "system",
              content: `✅ 已修改词条「${oldName}」→「${newName}」`,
              created_at: new Date().toISOString(),
            }]);
          } else {
            // 尝试模糊匹配
            const fuzzy = allTerms.find(t => t.title.includes(oldName) || oldName.includes(t.title));
            if (fuzzy) {
              await api.deleteWorldTerm(fuzzy.id);
              await api.saveWorldTerm({ ...fuzzy, id: uuid(), title: newName });
              useAppStore.getState().bumpWorldTerms();
              appendChatMessages([{
                id: uuid(), role: "system",
                content: `✅ 已修改词条「${fuzzy.title}」→「${newName}」`,
                created_at: new Date().toISOString(),
              }]);
            } else {
              appendChatMessages([{
                id: uuid(), role: "system",
                content: `⚠️ 未找到名为「${oldName}」的词条`,
                created_at: new Date().toISOString(),
              }]);
            }
          }
          setLoading(false);
          return; // 不调用 AI，直接返回
        }
      }

      // ====== 流式 AI 调用（支持实时展示和中途终止） ======
      const controller = new AbortController();
      abortControllerRef.current = controller;
      streamThinkingRef.current = "";
      streamContentRef.current = "";
      setStreamingMsgId(streamId);
      setStreamingContent("");
      setStreamingThinking("");
      setThinkingDuration(0);

      streamingPhaseRef.current = "thinking";
      setStreamingPhase("thinking");

      // 启动思考计时器
      const startTime = Date.now();
      thinkingTimerRef.current = setInterval(() => {
        setThinkingDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      let accumulatedThinking = "";
      let accumulatedContent = "";
      let thinkingDone = false;
      const res = await api.aiCompleteStream(
        {
          action: "chat",
          entity_type:
            activeModule === "outline"
              ? `outline_${outlineSection}`
              : activeModule === "custom"
                ? "custom_module"
                : activeModule,
          entity_id: selectedEntity?.id ?? currentProject?.id ?? "",
          extra: {
            user_message: fullContent,
            context: (() => {
              let ctx = contextHint() + fileContextHint + (projectContext ? "\n\n" + projectContext : "");
              const engine = memoryEngineRef.current;
              if (engine) {
                const { memorySummary } = engine.buildHistory(store.chatMessages, input);
                if (memorySummary) ctx += "\n\n" + memorySummary;
              }
              // 拼接写作台选取的临时章节上下文（不进记忆）
              const eph = useAppStore.getState().ephemeralChapterContext;
              if (eph) ctx += "\n\n" + eph;
              return ctx;
            })(),
            system_hint:
              `你是小说创作助手，可以自由对话辅助创作。\n` +
              (activeModule === "outline" && outlineSection === "worldview"
                ? `\n【世界观词条创建 — 重要！】` +
                `用户正在世界观画布上工作。当用户要求生成/按大纲生成词条时，你必须按以下流程操作：\n\n` +
                `1. 回顾对话历史（含上传文件），识别所有概念及其层级/包含/从属关系\n` +
                `2. 判断内容属于以下哪种布局模板（五选一）：\n\n` +
                `【模板A：方位型】适用于地理位置、势力版图、空间分布\n` +
                `  连线: 中心节点→四方节点（十字形）\n` +
                `  例: 中州→东苍灵洲, 中州→南炎火洲, 中州→西金荒洲, 中州→北寒冰洲\n\n` +
                `【模板B：族谱/树型】适用于宗门架构、组织层级、概念分解、世界嵌套\n` +
                `  连线: 根节点→多个一级子节点（水平展开），每个子节点→其下属（纵向延展）\n` +
                `  例: 九霄宗→神霄峰, 九霄宗→青霄峰, ...(9峰水平排列)\n` +
                `       神霄峰→神霄堂, 青霄峰→青霄堂, ...(峰下挂堂)\n\n` +
                `【模板C：层层递进型】适用于等级体系、功法品阶、修炼境界\n` +
                `  连线: 单向链式，从高到低（或低到高）依次连接\n` +
                `  例: 圣品→顶级→上品→中品→下品\n` +
                `       炼气期→筑基期→金丹期→元婴期→化神期\n\n` +
                `【模板F：时间线型】适用于历史事件、纪元更替、人物生平\n` +
                `  连线: 按时间先后，左到右单向箭头\n` +
                `  例: 开天辟地→远古纪元→上古大战→黑暗时代→现代复兴\n\n` +
                `【模板G：循环/制衡型】适用于五行相生相克、轮回转世、多极制衡\n` +
                `  连线: 环形闭合或两两互连\n` +
                `  例: 金→水→木→火→土→金（循环）\n` +
                `       三大势力: A↔B, B↔C, C↔A（三角形全连接）\n\n` +
                `3. 确定模板后，用以下格式输出词条和连线：\n` +
                "```\n---WORLD_TERMS---\n[{\"action\":\"create_world_term\",\"term\":{\"term_type\":\"place\",\"title\":\"中州\",\"one_liner\":\"中央大陆\",\"detail\":\"...\"}},\n" +
                " {\"action\":\"create_world_term\",\"term\":{\"term_type\":\"place\",\"title\":\"东苍灵洲\",\"one_liner\":\"东方大陆\",\"detail\":\"...\"}},\n" +
                " {\"action\":\"create_edge\",\"edge\":{\"sourceTitle\":\"中州\",\"targetTitle\":\"东苍灵洲\"}}]\n---END_WORLD_TERMS---\n```\n" +
                `关键规则：\n` +
                `- 每个概念都生成 create_world_term，描述要完整（是段落不是一句话）\n` +
                `- 父子/关联关系用 create_edge（sourceTitle→targetTitle）\n` +
                `- 平级概念之间不连线\n` +
                `- 上传了 Markdown 文件时，优先按 #/##/### 标题层级判断父子\n` +
                `- term_type：rule(规则) faction(势力) place(地点) item(道具) system(制度) other(其他)\n` +
                `- 在 ---WORLD_TERMS--- 块之前，用一句话说明选用的模板\n\n` +
                `【修改已有词条】你也可以通过对话批量修改已存在的词条，使用 ---WORLD_TERM_UPDATE--- 块：\n` +
                "```\n---WORLD_TERM_UPDATE---\n[{\"title\":\"九霄宗\",\"fields\":{\"term_type\":\"faction\",\"one_liner\":\"新定义\",\"detail\":\"新描述\",\"title_new\":\"新名称\"}}]\n---END_WORLD_TERM_UPDATE---\n```\n" +
                `可修改字段：term_type(类型)、one_liner(一句话)、detail(描述)、title_new(改名)\n` +
                `- title 必填，用来匹配要修改的词条\n` +
                `- title_new 选填，当用户说「改名为」时传此项\n` +
                `- 只传需要修改的字段，不传的字段保留原值\n` +
                `- 如果用户说「修改某某词条」「更新某某」「把某某改成」等，都使用此指令\n`
                : activeModule === "outline" && outlineSection === "characters"
                  ? `\n【人物角色创建 — 重要！】` +
                  `用户正在人物关系星图上工作。当用户要求生成/批量生成角色时：\n\n` +
                  `1. 从对话中提取所有角色名称和所属派系\n` +
                  `2. 推断角色之间的关系（师徒/敌对/爱慕/朋友/同盟/亲属/...）\n` +
                  `3. 用以下格式输出：\n` +
                  "```\n---CHARACTERS---\n[{\"action\":\"create_character\",\"character\":{\"name\":\"叶玄\",\"faction\":\"九霄宗\"}},\n" +
                  " {\"action\":\"create_character\",\"character\":{\"name\":\"曲凌霜\",\"faction\":\"长霄峰\"}},\n" +
                  " {\"action\":\"create_relationship\",\"edge\":{\"sourceName\":\"叶玄\",\"targetName\":\"曲凌霜\",\"relation_type\":\"师徒\",\"strength\":8}}]\n---END_CHARACTERS---\n```\n" +
                  `规则：\n` +
                  `- 每个角色生成一个 create_character，name 必填\n` +
                  `- 有关联的角色用 create_relationship 连线\n` +
                  `- relation_type：师徒/敌对/爱慕/朋友/同盟/亲属/其他\n` +
                  `- strength 1-10 表示关系紧密程度\n` +
                  `- 在 ---CHARACTERS--- 之前用自然语言简述角色和关系\n\n` +
                  `【完善角色卡 — 重要！】\n` +
                  `当用户要求完善某个角色的信息时，请用以下格式输出更新内容：\n` +
                  "```\n---CHARACTER_UPDATE---\n[{\"name\":\"曲凌霜\",\"fields\":{\"race\":\"人族\",\"appearance\":\"银白长发，冰蓝眼眸...\",\"personality\":\"冷若冰霜...\",\"background\":\"九霄宗内门首席...\",\"ability\":\"冰心剑诀·第六重...\",\"style\":\"凌厉果决...\",\"interests\":\"独处、抚琴...\"}}]\n---END_CHARACTER_UPDATE---\n```\n" +
                  `可更新的字段：race(种族)、appearance(外在形象)、personality(内在性格)、background(背景经历)、ability(能力)、style(行事风格)、interests(兴趣爱好)\n` +
                  `- 每次可以更新一个或多个角色\n` +
                  `- 只填需要修改的字段，其他字段不传\n` +
                  `- 在 ---CHARACTER_UPDATE--- 之前用自然语言描述角色信息\n`
                  : activeModule === "outline" && outlineSection === "plot-direction"
                    ? `\n【剧情走向 — 重要！】` +
                    `用户正在剧情走向画布上工作。明线是故事表层发展，暗线是隐藏的伏笔与阴谋。\n\n` +
                    `当用户要求创建剧情段落时，请用以下格式输出：\n` +
                    "```\n---PLOT_SEGMENTS---\n[{\"action\":\"create_segment\",\"segment\":{\"type\":\"bright\",\"title\":\"少年入世\",\"characters\":\"叶玄\",\"time\":\"天元纪元205年\",\"chapters\":\"1-90\",\"event\":\"叶玄拜入九霄宗开始修炼之路\"}},\n" +
                    " {\"action\":\"create_segment\",\"segment\":{\"type\":\"dark\",\"title\":\"暗流涌动\",\"characters\":\"慕容云\",\"time\":\"天元纪元205年\",\"chapters\":\"1-90\",\"event\":\"暗影盟暗中观察九霄宗动向\"}},\n" +
                    " {\"action\":\"create_edge\",\"edge\":{\"sourceTitle\":\"少年入世\",\"targetTitle\":\"初露锋芒\"}}]\n---END_PLOT_SEGMENTS---\n```\n" +
                    `规则：\n` +
                    `- 每个段落生成一个 create_segment，type=bright(明线)或dark(暗线)\n` +
                    `- title 必填，chapters 必须填写章节区间（如 "1-90"）\n` +
                    `- time 填写故事内时间（纪元/年份/时代，如 "天元纪元205年"）\n` +
                    `- characters/event 可选但建议填完整\n` +
                    `- 段落之间的先后关系用 create_edge 连线（sourceTitle→targetTitle）\n` +
                    `- 明线在上方，暗线在下方，分别独立排序\n` +
                    `- 在 ---PLOT_SEGMENTS--- 之前用自然语言描述剧情走向\n`
                    : ""
              ) +
              `\n【重要规则】你当前正在「${activeModule === "outline" ? OUTLINE_SECTION_LABEL[outlineSection] : MODULE_LABEL[activeModule]}」模块中工作。\n` +
              `- 只允许输出当前模块对应的块模板，绝对不能输出其他模块的块模板。\n` +
              `- 当前模块：${activeModule === "outline" && outlineSection === "worldview" ? "只能输出 ---WORLD_TERMS--- 和 ---WORLD_TERM_UPDATE--- 块" : activeModule === "outline" && outlineSection === "characters" ? "只能输出 ---CHARACTERS--- 和 ---CHARACTER_UPDATE--- 块" : activeModule === "outline" && outlineSection === "plot-direction" ? "只能输出 ---PLOT_SEGMENTS--- 块" : "不需要输出任何块模板"}\n` +
              `- 即使对话历史中有其他模块的块模板示例，也不要模仿输出。\n` +
              `- 你可以自然地讨论所有项目数据（世界观、角色、剧情等），但创建操作只能用当前模块的格式。\n` +
              fileContextHint,
            history: (() => {
              const engine = memoryEngineRef.current;
              if (engine) {
                const { history } = engine.buildHistory(store.chatMessages, input);
                return history.map((m) => ({ role: m.role, content: m.content }));
              }
              return [...store.chatMessages, userMsg]
                .slice(-50)
                .map((m) => ({ role: m.role, content: m.content }));
            })(),
          },
        },
        {
          onChunk: (chunk: string, type: "thinking" | "content") => {
            if (type === "thinking") {
              accumulatedThinking += chunk;
              streamThinkingRef.current = accumulatedThinking;
              setStreamingThinking(accumulatedThinking);
            } else {
              // 首次收到 content → 立即切到 content phase，开始流式显示
              if (!thinkingDone) {
                thinkingDone = true;
                streamingPhaseRef.current = "content";
                setStreamingPhase("content");
                if (thinkingTimerRef.current) {
                  clearInterval(thinkingTimerRef.current);
                  thinkingTimerRef.current = null;
                }
              }
              accumulatedContent += chunk;
              streamContentRef.current = accumulatedContent;
              setStreamingContent(accumulatedContent);
            }
          },
        },
        controller.signal
      );

      // 流完成：确保 timer 清理
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      streamingPhaseRef.current = "content";
      setStreamingPhase("content");

      const aiContent = res.error ?? res.content;

      // 只保留当前模块的块模板（物理过滤）
      const filteredAiContent = stripOtherModuleBlocks(aiContent, activeModule, outlineSection);

      // 检查是否包含世界观词条创建指令（仅世界观模块）
      let worldTermDef =
        activeModule === "outline" && outlineSection === "worldview"
          ? parseWorldTermAction(filteredAiContent)
          : null;

      // 去除 AI 回复中的 JSON 块（显示时隐藏）
      let displayContent = aiContent;
      // 去除世界观词条创建 JSON 块
      if (worldTermDef) {
        displayContent = displayContent
          .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/, "")
          .trim();
        if (!displayContent) {
          displayContent = `✅ 已创建世界观词条「${worldTermDef.title}」，请在画布中查看。`;
        }
      }

      // 兜底：如果 JSON 解析没找到，但 AI 回复中可能提到了创建词条
      if (!worldTermDef && activeModule === "outline" && outlineSection === "worldview") {
        const fallbackTermDef = extractWorldTermFromText(filteredAiContent, fullContent);
        if (fallbackTermDef) {
          worldTermDef = fallbackTermDef;
          displayContent = displayContent
            .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/, "")
            .trim();
        }
      }

      // 添加 AI 回复消息
      const thinkingRef = streamThinkingRef.current;
      const assistantMsg: ChatMessage = {
        id: uuid(),
        role: "assistant",
        content: displayContent,
        created_at: new Date().toISOString(),
        thinking: thinkingRef || undefined,
      };
      appendChatMessages([assistantMsg]);

      // ====== 词条修改：解析 update_world_term（仅世界观模块） ======
      if (currentProject && activeModule === "outline" && outlineSection === "worldview") {
        const updateDef = parseWorldTermUpdate(filteredAiContent);
        if (updateDef) {
          try {
            const terms = await api.listWorldTerms(currentProject.id);
            const target = terms.find(t => t.title === updateDef.title);
            if (target) {
              const updated = { ...target };
              if (updateDef.title_new !== undefined) updated.title = updateDef.title_new;
              if (updateDef.one_liner !== undefined) updated.one_liner = updateDef.one_liner;
              if (updateDef.detail !== undefined) updated.detail = updateDef.detail;
              if (updateDef.title_new !== undefined) {
                // 删除旧词条，创建新词条（保留 ID 会导致旧节点残留）
                await api.deleteWorldTerm(target.id);
                const newTerm = { ...updated, id: uuid() };
                await api.saveWorldTerm(newTerm);
              } else {
                await api.saveWorldTerm(updated);
              }
              useAppStore.getState().bumpWorldTerms();
              const newName = updateDef.title_new || updateDef.title;
              appendChatMessages([{
                id: uuid(), role: "system",
                content: `✅ 已更新词条「${newName}」${updateDef.title_new ? "· 名称已更改" : ""}${updateDef.one_liner ? "· 一句话定义" : ""}${updateDef.detail ? "· 详细描述" : ""}`,
                created_at: new Date().toISOString(),
              }]);
              displayContent = displayContent.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/, "").trim();
            } else {
              appendChatMessages([{
                id: uuid(), role: "system",
                content: `⚠️ 未找到词条「${updateDef.title}」，请检查名称是否匹配。`,
                created_at: new Date().toISOString(),
              }]);
            }
          } catch (e) {
            appendChatMessages([{
              id: uuid(), role: "system",
              content: `⚠️ 更新词条失败：${e}`,
              created_at: new Date().toISOString(),
            }]);
          }
        }
      }

      // ====== 世界词条：不再自动创建，存为待插入状态（仅世界观模块） ======
      const pendingWorldTerms: WorldTerm[] = [];

      if (activeModule === "outline" && outlineSection === "worldview") {
        if (worldTermDef && currentProject) {
          pendingWorldTerms.push({
            id: uuid(),
            project_id: currentProject.id,
            term_type: worldTermDef.term_type,
            title: worldTermDef.title,
            one_liner: worldTermDef.one_liner || "",
            detail: worldTermDef.detail || "",
            ring_level: 1,
            forbidden: [],
            is_locked: false,
            layout_x: 0,
            layout_y: 0,
          });
        }

        // 批量词条解析仅在"世界观"分组下运行
        const batchWorldTerms = parseBatchWorldTerms(filteredAiContent);
        if (batchWorldTerms.length > 0 && currentProject) {
          const edgeActs = parseEdgeActions(filteredAiContent);
          for (const wt of batchWorldTerms) {
            pendingWorldTerms.push({
              id: uuid(),
              project_id: currentProject.id,
              term_type: wt.term_type,
              title: wt.title,
              one_liner: wt.one_liner,
              detail: wt.detail,
              ring_level: 1,
              forbidden: [],
              is_locked: false,
              layout_x: 0,
              layout_y: 0,
            });
          }
          setPendingEdges(edgeActs);
        }

        // ====== 批量词条修改：解析 ---WORLD_TERM_UPDATE--- 块 ======
        const termUpdates = parseWorldTermUpdateBatch(filteredAiContent);
        if (termUpdates.length > 0 && currentProject) {
          try {
            const allTerms = await api.listWorldTerms(currentProject.id);
            const updatedNames: string[] = [];
            for (const u of termUpdates) {
              const target = allTerms.find((t: any) => t.title === u.title);
              if (target) {
                const updated = { ...target };
                if (u.fields.term_type) updated.term_type = u.fields.term_type;
                if (u.fields.one_liner !== undefined) updated.one_liner = u.fields.one_liner;
                if (u.fields.detail !== undefined) updated.detail = u.fields.detail;
                if (u.fields.title_new) {
                  await api.deleteWorldTerm(target.id);
                  await api.saveWorldTerm({ ...updated, id: uuid(), title: u.fields.title_new });
                } else {
                  await api.saveWorldTerm(updated);
                }
                updatedNames.push(u.fields.title_new || u.title);
              } else {
                // 未匹配到词条，作为新建词条推入 pending
                pendingWorldTerms.push({
                  id: uuid(),
                  project_id: currentProject.id,
                  term_type: (u.fields.term_type as any) || "other",
                  title: u.title,
                  one_liner: u.fields.one_liner || "",
                  detail: u.fields.detail || "",
                  ring_level: 1,
                  forbidden: [],
                  is_locked: false,
                  layout_x: 0,
                  layout_y: 0,
                });
              }
            }
            if (updatedNames.length > 0) {
              useAppStore.getState().bumpWorldTerms();
              appendChatMessages([{
                id: uuid(), role: "system",
                content: `✅ 已更新词条：${updatedNames.join("、")}`,
                created_at: new Date().toISOString(),
              }]);
            }
          } catch (e) {
            console.error("WORLD_TERM_UPDATE 处理失败:", e);
          }
        }
      }

      if (pendingWorldTerms.length > 0) {
        setPendingTerms(prev => [...prev, ...pendingWorldTerms]);
        displayContent = displayContent
          .replace(/---WORLD_TERMS---[\s\S]*?---END_WORLD_TERMS---/g, "")
          .replace(/---WORLD_TERM_UPDATE---[\s\S]*?---END_WORLD_TERM_UPDATE---/g, "")
          .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
          .trim();
        if (!displayContent) {
          displayContent = `������ 已解析 ${pendingWorldTerms.length} 个词条，点击下方「插入到画布」添加到画布。`;
        }
      }

      // ====== 人物角色：解析 ---CHARACTERS--- 块 ======
      if (activeModule === "outline" && outlineSection === "characters") {
        const charBatch = parseCharacterBatch(filteredAiContent);
        if (charBatch.chars.length > 0 || charBatch.edges.length > 0 || charBatch.removeEdges.length > 0) {
          setPendingChars(prev => [...prev, ...charBatch.chars]);
          setPendingCharEdges(prev => [...prev, ...charBatch.edges]);
          setPendingRemoveEdges(prev => [...prev, ...charBatch.removeEdges]);
          displayContent = displayContent
            .replace(/---CHARACTERS---[\s\S]*?---END_CHARACTERS---/g, "")
            .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
            .trim();
          if (!displayContent) {
            const parts: string[] = [];
            if (charBatch.chars.length > 0) parts.push(`${charBatch.chars.length} 个角色`);
            if (charBatch.edges.length > 0) parts.push(`${charBatch.edges.length} 条关系`);
            if (charBatch.removeEdges.length > 0) parts.push(`删除 ${charBatch.removeEdges.length} 条关系`);
            displayContent = `������ 已解析 ${parts.join("、")}，点击下方「应用到星图」更新画布。`;
          }
        }

        // ====== 角色卡更新：解析 ---CHARACTER_UPDATE--- 块 ======
        const charUpdates = parseCharacterUpdate(filteredAiContent);
        if (charUpdates.length > 0 && currentProject) {
          const allChars = await api.listCharacters(currentProject.id);
          const fields = ["race", "appearance", "personality", "background", "ability", "style", "interests"];
          const updatedNames: string[] = [];
          for (const cu of charUpdates) {
            const target = allChars.find((c: any) => c.name === cu.name);
            if (target) {
              const updated = { ...target };
              for (const key of fields) {
                if (cu.fields[key] !== undefined) {
                  (updated as any)[key] = cu.fields[key];
                }
              }
              await api.saveCharacter(updated);
              updatedNames.push(cu.name);
            }
          }
          if (updatedNames.length > 0) {
            const store = useAppStore.getState();
            store.bumpCharacters();
          }
          displayContent = displayContent
            .replace(/---CHARACTER_UPDATE---[\s\S]*?---END_CHARACTER_UPDATE---/g, "")
            .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
            .trim();
          if (!displayContent) {
            const names = charUpdates.map(cu => cu.name).join("、");
            displayContent = `✅ 已完善角色「${names}」的角色卡信息，点击查看。`;
          }
        }
      }

      // ====== 剧情走向段落：解析 ---PLOT_SEGMENTS--- 块（仅剧情走向模块，存为待确认） ======
      if (activeModule === "outline" && outlineSection === "plot-direction") {
        const plotBatch = parsePlotSegments(filteredAiContent);
        if (plotBatch.segments.length > 0) {
          setPendingPlotSegments(prev => [...prev, ...plotBatch.segments]);
          setPendingPlotEdges(prev => [...prev, ...plotBatch.edges]);
          displayContent = displayContent
            .replace(/---PLOT_SEGMENTS---[\s\S]*?---END_PLOT_SEGMENTS---/g, "")
            .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
            .trim();
          if (!displayContent) {
            displayContent = `������ 已解析 ${plotBatch.segments.length} 个剧情段落（${plotBatch.segments.filter(s => s.type === "bright").length} 明线 + ${plotBatch.segments.filter(s => s.type === "dark").length} 暗线）${plotBatch.edges.length > 0 ? ` + ${plotBatch.edges.length} 条连线` : ""}，点击下方「插入」确认。`;
          }
        }
      }

      // ====== 最终清理：从历史记录中删除所有块模板，只保留自然语言 ======
      const cleanContent = stripAllBlocks(displayContent);
      if (cleanContent !== displayContent) {
        // 更新已追加的 assistant 消息（用干净的内容替换）
        const store = useAppStore.getState();
        const msgs = [...store.chatMessages];
        const lastIdx = msgs.length - 1;
        if (lastIdx >= 0 && msgs[lastIdx].role === "assistant" && msgs[lastIdx].id === assistantMsg.id) {
          msgs[lastIdx] = { ...msgs[lastIdx], content: cleanContent };
          useAppStore.setState({ chatMessages: msgs });
        }
      }

    } catch (e: any) {
      if (e?.name === "AbortError") {
        // 用户终止 — 保留已生成的部分内容
        const partialThinking = streamThinkingRef.current;
        const partialContent = streamContentRef.current;
        let abortMsg = "";
        if (partialThinking) abortMsg += partialThinking + "\n\n";
        if (partialContent) abortMsg += partialContent;
        if (abortMsg) {
          appendChatMessages([{
            id: streamId,
            role: "assistant",
            content: abortMsg + "\n\n---\n*������ 已终止*",
            created_at: new Date().toISOString(),
          }]);
        }
      } else {
        appendChatMessages([
          {
            id: uuid(),
            role: "assistant",
            content: `出错了：${e}`,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      // 发送完毕，清空临时章节上下文 + 取消选取模式
      const store = useAppStore.getState();
      store.setEphemeralChapterContext("");
      store.setChapterSelectMode(false);
      store.setSelectedChapterIds([]);
      // 记忆压缩 + 标记
      try {
        const engine = memoryEngineRef.current;
        if (engine && currentProject) {
          engine.tagMessages(store.chatMessages);
          engine.performCompression(store.chatMessages).then(count => {
            if (count > 0) {
              setMemoryEntries(engine.getShortTerm());
              useAppStore.getState().bumpMemory();
            }
          });
          // 检测 AI 回复中的 ---MEMORY--- 标记
          const lastMsg = store.chatMessages[store.chatMessages.length - 1];
          if (lastMsg?.role === "assistant") {
            engine.extractLongTerm(lastMsg.content);
          }
        }
      } catch { /* 记忆处理失败不影响主流程 */ }
      abortControllerRef.current = null;
      streamingPhaseRef.current = "idle";
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setStreamingContent("");
      setStreamingThinking("");
      setStreamingPhase("idle");
      setStreamingMsgId(null);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-semibold">AI 创作助手</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="记忆"
            onClick={() => setMemoryTab(!memoryTab)}
            className={`rounded p-1 hover:bg-slate-100 ${memoryTab ? "text-amber-600 bg-amber-50" : "text-slate-400"}`}
          >
            <FileText className="h-4 w-4" />
            {memoryEntries.length > 0 && (
              <span className="ml-0.5 text-[9px] font-medium">{memoryEntries.length}</span>
            )}
          </button>
          <button
            type="button"
            title="清空对话"
            onClick={clearChat}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="border-b bg-slate-50/80 px-3 py-1 text-[10px] text-slate-400">
        {contextHint()}
      </p>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" ref={chatContainerRef}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "user" ? (
              <div className="group relative max-w-[92%]">
                {editingMsgId === m.id ? (
                  <div className="rounded-2xl px-3 py-2 bg-violet-600">
                    <textarea
                      className="w-full resize-none rounded-lg border border-violet-400 bg-violet-700 px-2 py-1 text-sm text-white placeholder-violet-300 outline-none"
                      value={editingContent}
                      onChange={e => setEditingContent(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleConfirmEdit(m.id);
                        }
                        if (e.key === "Escape") {
                          setEditingMsgId(null);
                          setEditingContent("");
                        }
                      }}
                      rows={Math.min(editingContent.split('\n').length + 1, 10)}
                      autoFocus
                    />
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-violet-300">
                      Enter 确认 · Esc 取消 · Shift+Enter 换行
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap bg-violet-600 text-white">
                    {m.content}
                  </div>
                )}
                {/* 常驻操作按钮 */}
                {editingMsgId !== m.id && (
                  <div className="flex items-center gap-0.5 mt-1 justify-end">
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(m.content)}
                      className="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                      title="复制"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditUserMessage(m.id, m.content)}
                      className="rounded p-0.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                      title="编辑消息"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMessage(m.id)}
                      className="rounded p-0.5 text-slate-400 hover:text-red-500 hover:bg-red-50"
                      title="删除消息"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            ) : m.role === "system" ? (
              <div className="group relative max-w-[92%]">
                <div className="rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap border border-violet-200 bg-violet-50 text-violet-800">
                  {m.content}
                </div>
                {/* 常驻删除按钮 */}
                <div className="flex items-center gap-0.5 mt-1 justify-end">
                  <button
                    type="button"
                    onClick={() => handleDeleteMessage(m.id)}
                    className="rounded p-0.5 text-slate-400 hover:text-red-600 hover:bg-red-50"
                    title="删除消息"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="group relative max-w-[92%]">
                {m.thinking && (
                  <details className="mb-1.5">
                    <summary className="flex cursor-pointer items-center gap-1.5 rounded-full bg-[#f0f0f0] hover:bg-[#e8e8e8] px-3 py-1 text-xs text-slate-500 select-none transition-colors [&::-webkit-details-marker]:hidden list-none">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        <span>已思考</span>
                      </span>
                      <span className="ml-auto text-[10px] text-slate-400 group-open:rotate-180 transition-transform">▾</span>
                    </summary>
                    <div className="mt-1.5 rounded-lg border border-slate-200/80 bg-[#f7f7f8] px-3 py-2.5 text-xs leading-relaxed text-slate-600 prose prose-slate max-w-none">
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.thinking!) }} />
                    </div>
                  </details>
                )}
                <div
                  className="rounded-2xl px-4 py-3 text-sm border border-slate-100 bg-white text-slate-800 shadow-sm prose prose-slate max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(m.content),
                  }}
                />
                {/* 操作按钮栏 — 常驻显示 */}
                <div className="mt-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(m.content)}
                    className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    title="复制"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteMessage(m.id)}
                    className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50"
                    title="删除"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    className="rounded p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                    title="重新生成"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {/* ========== DeepSeek 风格流式输出 ========== */}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[92%]">
              {/* 思考过程 — 始终显示 */}
              <details className="group mb-1.5" open>
                <summary className="flex cursor-pointer items-center gap-1.5 select-none list-none [&::-webkit-details-marker]:hidden">
                  {/* thinking 阶段: 跳动三点；content 阶段: 静态圆点 */}
                  {streamingPhase === "thinking" ? (
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    </div>
                  )}
                  <span className="text-xs font-medium text-slate-500">
                    {streamingPhase === "thinking" ? "思考过程" : `已思考 · ${thinkingDuration}s`}
                  </span>
                  {streamingPhase === "content" && (
                    <span className="ml-auto text-[10px] text-slate-400 group-open:rotate-180 transition-transform">▾</span>
                  )}
                </summary>
                {/* 思考内容 — 展开时才显示 */}
                <div className="mt-1.5 rounded-lg border border-slate-200/80 bg-[#f7f7f8] px-3 py-2.5 text-xs leading-relaxed text-slate-600 prose prose-slate max-w-none">
                  {streamingThinking ? (
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingThinking) }} />
                  ) : (
                    <span className="text-slate-400 italic">正在分析你的请求...</span>
                  )}
                  {streamingPhase === "thinking" && (
                    <span className="inline-block w-0.5 h-4 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
                  )}
                </div>
              </details>
              {/* 正文 — content 阶段才显示 */}
              {streamingPhase === "content" && (
                <div>
                  <div className="rounded-2xl px-4 py-3 text-sm border border-slate-100 bg-white text-slate-800 shadow-sm prose prose-slate max-w-none">
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }} />
                    <span className="inline-block w-0.5 h-4 bg-slate-700 animate-pulse ml-0.5 align-text-bottom" />
                  </div>
                </div>
              )}
              {/* 终止按钮 */}
              <div className="flex justify-end mt-1.5">
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 shadow-sm transition-colors"
                >
                  <Square size={12} fill="currentColor" /> 终止
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 待插入角色预览 */}
        {pendingChars.length > 0 && (
          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-blue-700">
                ������ 待插入星图（{pendingChars.length} 个角色{pendingCharEdges.length > 0 ? ` · ${pendingCharEdges.length} 条关系` : ""}）
              </p>
              <button className="text-[10px] text-slate-400 hover:text-red-500" onClick={() => { setPendingChars([]); setPendingCharEdges([]); setPendingRemoveEdges([]); }}>清空全部</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingChars.map((c, i) => (
                <div key={i} className="relative group rounded-lg border bg-white p-2 shadow-sm min-w-[120px]" style={{ borderColor: "#3b82f6", borderLeftWidth: 3 }}>
                  <button className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs leading-none"
                    onClick={() => setPendingChars(prev => prev.filter((_, j) => j !== i))}>✕</button>
                  <p className="text-xs font-semibold text-slate-800 pr-4">{c.name}</p>
                  {c.faction && <p className="text-[10px] text-slate-400">{c.faction}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 待插入词条预览 */}
        {pendingTerms.length > 0 && (
          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-amber-700">
                ������ 待插入画布（{pendingTerms.length} 个词条{pendingEdges.length > 0 ? ` · ${pendingEdges.length} 条连线` : ""}）
              </p>
              <button className="text-[10px] text-slate-400 hover:text-red-500 whitespace-nowrap ml-2" onClick={() => { setPendingTerms([]); setPendingEdges([]); }}>清空全部</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingTerms.map((t) => {
                const typeColors: Record<string, string> = { rule: "#3b82f6", faction: "#ec4899", place: "#10b981", item: "#8b5cf6", system: "#f97316", other: "#9ca3af" };
                const typeLabels: Record<string, string> = { rule: "规则", faction: "势力", place: "地点", item: "道具", system: "制度", other: "其他" };
                const c = typeColors[t.term_type] ?? "#9ca3af";
                return (
                  <div key={t.id} className="rounded-lg border bg-white p-2.5 shadow-sm min-w-[160px] max-w-[240px] relative group" style={{ borderColor: c, borderLeftWidth: 3 }}>
                    <button className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs leading-none" onClick={(e) => { e.stopPropagation(); setPendingTerms(prev => prev.filter(x => x.id !== t.id)); }}>✕</button>
                    <span className="rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: c }}>{typeLabels[t.term_type] ?? "其他"}</span>
                    <p className="mt-1 text-xs font-semibold text-slate-800 truncate pr-4">{t.title}</p>
                    <p className="text-[10px] text-slate-500 line-clamp-2">{t.one_liner}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 记忆面板（在消息区和工具栏之间） */}
      {memoryTab && (
        <div className="max-h-60 overflow-y-auto border-t border-slate-100 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-600">������ 短期记忆</h4>
            <span className="text-[10px] text-slate-400">{memoryEntries.length} 条</span>
          </div>
          {memoryEntries.length === 0 ? (
            <p className="text-xs text-slate-400">暂无记忆，对话积累后会生成摘要</p>
          ) : (
            memoryEntries.map(e => (
              <div key={e.id} className="mb-2 rounded border border-slate-100 bg-slate-50 p-2">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-700">{e.topic}</span>
                  {e.tags.slice(0, 4).map(t => (
                    <span key={t} className="rounded bg-violet-100 px-1 py-0.5 text-[9px] text-violet-600">{t}</span>
                  ))}
                </div>
                <p className="text-[10px] leading-relaxed text-slate-500">{e.summary}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* 操作工具栏：插入 / 移除 / 保存 */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-3 py-1.5">
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <span>
            {pendingTerms.length > 0 ? "待插入词条："
              : pendingChars.length > 0 ? "待插入角色："
                : pendingPlotSegments.length > 0 ? "待插入剧情段落："
                  : "对最后一条 AI 回复操作："}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* 词条插入按钮 */}
          {pendingTerms.length > 0 && (
            <button type="button" title="插入到画布" onClick={handleInsert} disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100">
              <ClipboardPlus className="h-3 w-3" />
              插入 {pendingTerms.length} 个词条
            </button>
          )}
          {/* 角色插入按钮 */}
          {(pendingChars.length > 0 || pendingCharEdges.length > 0) && (
            <button type="button" title="应用到星图" onClick={handleCharacterInsert} disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100">
              <ClipboardPlus className="h-3 w-3" />
              {pendingChars.length > 0
                ? `插入 ${pendingChars.length} 个角色`
                : `应用 ${pendingCharEdges.length} 条关系`}
            </button>
          )}
          {/* 剧情段落插入按钮 */}
          {pendingPlotSegments.length > 0 && (
            <button type="button" title="插入到剧情走向画布" onClick={handlePlotInsert} disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-100">
              <ClipboardPlus className="h-3 w-3" />
              插入 {pendingPlotSegments.length} 个剧情段落
            </button>
          )}
          {/* 选取写作台章节到 AI（仅写作台模块） */}
          {activeModule === "writing" && (
            <button type="button" title="在卷章树中选取章节，内容随本次发送给 AI（不进记忆）"
              onClick={() => {
                const store = useAppStore.getState();
                store.setChapterSelectMode(!chapterSelectMode);
                if (chapterSelectMode) store.setSelectedChapterIds([]);
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-violet-100 ${chapterSelectMode ? "border-violet-500 bg-violet-100 text-violet-700" : "border-slate-200 bg-white text-slate-600"}`}>
              <FileText className="h-3 w-3" />
              选取
            </button>
          )}
          {/* 无待插入词条/角色/剧情时，插入 AI 回复文本到编辑器 */}
          {pendingTerms.length === 0 && pendingChars.length === 0 && pendingPlotSegments.length === 0 && (
            <button type="button" title="将 AI 回复插入到当前章节" onClick={handleTextInsert} disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100">
              <ClipboardPlus className="h-3 w-3" />插入
            </button>
          )}
          <button type="button" title="移除 — 删除最后一条 AI 回复"
            onClick={handleRemoveLast} disabled={loading || chatMessages.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-40">
            <Eraser className="h-3 w-3" />移除
          </button>
          <button type="button" title="保存 — 将 AI 回复下载为 .md 文件"
            onClick={handleSave} disabled={loading || chatMessages.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-40">
            <Download className="h-3 w-3" />
            保存
          </button>
        </div>
      </div>

      <div className="border-t bg-white p-3">
        {/* 已上传文件列表 */}
        {hasAttachments && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {uploadedFiles.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-700"
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="max-w-[120px] truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="text-violet-400">({formatSize(f.size)})</span>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="ml-0.5 rounded p-0.5 text-violet-400 hover:bg-violet-200 hover:text-violet-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            className="min-h-[48px] max-h-[200px] flex-1 resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
            placeholder={
              hasAttachments
                ? "输入对上传资料的描述或要求…（留空则直接发送文件内容）"
                : "描述你想完善的设定，或让 AI 创建新模块…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />

          {/* STT 录音提示 */}
          {stt.state === "recording" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              ������ 录音中… 点击 ������ 停止并识别
            </div>
          )}
          {sttLoading && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700">
              ⏳ 正在识别语音…
            </div>
          )}
          {stt.state === "error" && stt.errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              ❌ {stt.errorMsg}
              <button type="button" className="ml-2 underline" onClick={() => stt.cancel()}>关闭</button>
            </div>
          )}

          {/* 操作按钮组 */}
          <div className="flex shrink-0 flex-col gap-1.5">
            {/* 语音按钮 */}
            <button
              type="button"
              title={stt.state === "recording" ? "点击停止并识别" : "语音输入（录音转文字）"}
              onClick={handleSttToggle}
              disabled={sttLoading}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${stt.state === "recording"
                ? "border-red-300 bg-red-50 text-red-600 animate-pulse"
                : sttLoading
                  ? "border-slate-200 text-slate-300 cursor-wait"
                  : "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-violet-600"
                }`}
            >
              {stt.state === "recording" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            {/* 上传文件按钮 */}
            <button
              type="button"
              title="上传文本资料"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-violet-600"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {/* 发送 / 终止按钮 — DeepSeek 风格 */}
            {loading ? (
              <button
                type="button"
                onClick={handleStop}
                title="终止生成"
                className="flex h-9 w-9 items-center justify-center self-end rounded-lg bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
              >
                <Square className="h-4 w-4" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                data-send-btn
                disabled={(!input.trim() && !hasAttachments)}
                onClick={send}
                className="flex h-9 w-9 items-center justify-center self-end rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-300 disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-slate-400 disabled:hover:border-slate-200 transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* 隐藏的文件选择器 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={TEXT_EXTENSIONS.join(",")}
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          Enter 发送 · Shift+Enter 换行 · ������支持 .txt .md .docx 等文本文件
        </p>
      </div>
    </div>
  );
}

/** 从用户消息中检测"第X章"或"第X-Y章"的模式 */
function detectChapterRange(text: string): string | undefined {
  // 第1-5章 / 第1~5章 / 第1到5章
  let m = text.match(/第(\d+)\s*[-~—]\s*(\d+)\s*章/);
  if (m) return `${m[1]}-${m[2]}`;
  // 第1章到第5章 / 第1章至第5章
  m = text.match(/第(\d+)章\s*(?:到|至)\s*第(\d+)章/);
  if (m) return `${m[1]}-${m[2]}`;
  // 第5章
  m = text.match(/第(\d+)章/);
  if (m) return m[1];
  // 1-5章（没有"第"前缀）
  m = text.match(/(\d+)\s*[-~—]\s*(\d+)\s*章/);
  if (m) return `${m[1]}-${m[2]}`;
  return undefined;
}
