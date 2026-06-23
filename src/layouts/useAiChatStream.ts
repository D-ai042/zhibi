// useAiChatStream.ts — AI 流式对话 Hook（T7 职责：完整 send() 业务逻辑）
//
// 职责边界：
// - 接收输入（用户文本、上传文件）和状态回调
// - 调用 context-engine 组装上下文
// - 生成完整 system_hint（含世界观/角色/剧情模板）
// - 调用 api.aiCompleteStream 流式请求
// - 解析 AI 回复（调用 character-parser 全部解析函数）
// - 填充 pending state（待插入词条/角色/剧情/章节）
// - 记忆引擎（tagMessages + executeAICCompression + extractLongTerm）
// - 终止流式请求（AbortController）

import { useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { buildModuleContext, buildChatContext, buildChapterContext, type ChatContextInput } from "@/lib/context-engine";
import { MemoryEngine } from "@/lib/memory-engine";
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { uuid } from "@/lib/uuid";
import type { ChatMessage, WorldTerm, MemoryEntry } from "@/types";
import { MODULE_LABEL, OUTLINE_SECTION_LABEL } from "@/types";
import {
  parseWorldTermAction,
  parseWorldTermUpdate,
  parseBatchWorldTerms,
  parseEdgeActions,
  parseCharacterBatch,
  parseCharacterUpdate,
  parsePlotSegments,
  parseChapters,
  parseWorldTermUpdateBatch,
  stripOtherModuleBlocks,
  stripAllBlocks,
} from "@/lib/character-parser";

// ===== 类型 =====

interface UploadedFile { id: string; name: string; size: number; content: string; }

export interface AiChatStreamCallbacks {
  // streaming UI state
  setStreamingContent: (v: string) => void;
  setStreamingThinking: (v: string) => void;
  setStreamingPhase: (v: "idle" | "thinking" | "content" | "done") => void;
  setThinkingDuration: (v: number) => void;
  setLoading: (v: boolean) => void;
  // memory UI state
  setMemoryEntries: (v: MemoryEntry[]) => void;
  // pending state
  setPendingTerms: (fn: WorldTerm[] | ((prev: WorldTerm[]) => WorldTerm[])) => void;
  setPendingEdges: (fn: { sourceTitle: string; targetTitle: string }[] | ((prev: { sourceTitle: string; targetTitle: string }[]) => { sourceTitle: string; targetTitle: string }[])) => void;
  setPendingChars: (fn: any[] | ((prev: any[]) => any[])) => void;
  setPendingCharEdges: (fn: any[] | ((prev: any[]) => any[])) => void;
  setPendingRemoveEdges: (fn: any[] | ((prev: any[]) => any[])) => void;
  setPendingSnapshots: (fn: any[] | ((prev: any[]) => any[])) => void;
  setPendingPlotSegments: (fn: any[] | ((prev: any[]) => any[])) => void;
  setPendingPlotEdges: (fn: any[] | ((prev: any[]) => any[])) => void;
  setPendingPlotBeats: (fn: any[] | ((prev: any[]) => any[])) => void;
  setPendingChapters: (fn: any[] | ((prev: any[]) => any[])) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 检测用户消息中的章节范围引用 */
function detectChapterRange(text: string): string | undefined {
  let m = text.match(/第(\d+)\s*[-~—]\s*(\d+)\s*章/);
  if (m) return `${m[1]}-${m[2]}`;
  m = text.match(/第(\d+)章\s*(?:到|至)\s*第(\d+)章/);
  if (m) return `${m[1]}-${m[2]}`;
  m = text.match(/第(\d+)章/);
  if (m) return m[1];
  m = text.match(/(\d+)\s*[-~—]\s*(\d+)\s*章/);
  if (m) return `${m[1]}-${m[2]}`;
  return undefined;
}

export function useAiChatStream(
  memoryEngineRef: { current: MemoryEngine | null },
  callbacks: AiChatStreamCallbacks
) {
  const {
    setStreamingContent, setStreamingThinking, setStreamingPhase,
    setThinkingDuration, setLoading, setMemoryEntries,
    setPendingTerms, setPendingEdges, setPendingChars, setPendingCharEdges,
    setPendingRemoveEdges, setPendingSnapshots,
    setPendingPlotSegments, setPendingPlotEdges, setPendingPlotBeats,
    setPendingChapters,
  } = callbacks;

  const abortControllerRef = useRef<AbortController | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamThinkingRef = useRef("");
  const streamContentRef = useRef("");
  const streamingPhaseRef = useRef<"idle" | "thinking" | "content" | "done">("idle");

  /** 终止 AI 生成 */
  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    streamingPhaseRef.current = "idle";
    setStreamingPhase("idle");
    setStreamingContent("");
    setStreamingThinking("");
    setThinkingDuration(0);
  }, [setStreamingContent, setStreamingThinking, setStreamingPhase, setThinkingDuration]);

  /** 核心 send 函数 */
  const send = useCallback(async (
    input: string,
    uploadedFiles: UploadedFile[],
    // 显式传入当前模块状态，确保点击发送瞬间的精确值
    moduleContext?: { activeModule: string; outlineSection: string }
  ) => {
    const store = useAppStore.getState();
    const {
      chatMessages, addChatMessage, appendChatMessages,
      selectedEntity, currentProject,
    } = store;

    // 优先使用调用方传入的模块上下文（点击时刻抓取），否则用 store 当前值
    const activeModule = moduleContext?.activeModule ?? store.activeModule;
    const outlineSection = moduleContext?.outlineSection ?? store.outlineSection;

    const text = input.trim();
    const hasAttachments = uploadedFiles.length > 0;
    if ((!text && !hasAttachments)) return;

    // ===== 拼装完整用户消息（含附件） =====
    let fullContent = text;
    if (hasAttachments) {
      const fileBlocks = uploadedFiles.map((f) => [
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📎 附件：${f.name} (${formatSize(f.size)})`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        f.content,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ].join("\n"));
      const fileSection = `\n\n---\n以下是我上传的参考资料：\n\n${fileBlocks.join("\n\n")}\n---\n`;
      fullContent = text ? `${text}\n\n${fileSection}` : `请参考以下上传的资料：\n${fileSection}`;
    }

    const userMsg: ChatMessage = {
      id: uuid(), role: "user", content: fullContent,
      created_at: new Date().toISOString(),
    };
    addChatMessage(userMsg);

    // 清空旧的 pending 数据
    setPendingTerms([]);
    setPendingEdges([]);
    setPendingChars([]);
    setPendingCharEdges([]);
    setPendingRemoveEdges([]);
    setPendingSnapshots([]);
    setPendingPlotSegments([]);
    setPendingPlotEdges([]);
    setPendingPlotBeats([]);
    setPendingChapters([]);

    setLoading(true);
    const streamId = uuid();

    try {
      // ===== 文件附加上下文提示 =====
      const fileContextHint = uploadedFiles.length > 0
        ? `\n用户上传了 ${uploadedFiles.length} 个文本文件作为参考资料：${uploadedFiles.map((f) => f.name).join("、")}。`
        : "";

      // ===== 剧情走向 / 写作台：传递当前段落和细纲数据给 AI =====
      let segmentsContext = "";
      if (currentProject && (activeModule === "outline" || activeModule === "writing")) {
        try {
          const segs = getJSONSync("plot-segments-" + currentProject.id, [] as any[]);
          if (segs.length > 0) {
            const segList = segs.map((s: any) =>
              `「${s.title}」(${s.type === "bright" ? "明线" : "暗线"},` +
              `章节:${s.chapters || "—"},细纲:${(s.beats?.length || 0)}个)` +
              ((s.beats?.length || 0) > 0
                ? `[${s.beats.map((b: any) => `#${b.number} ${b.title}`).join("; ")}]`
                : "")
            ).join("\n");
            segmentsContext = `\n\n当前项目剧情走向数据：\n${segList}\n`;
          }
        } catch { /* ignore */ }
      }

      // ===== 通过上下文引擎加载项目数据上下文（模块感知 v2.0） =====
      let projectContext = "";
      if (currentProject) {
        try {
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
            zoneFilter: ctxModule === "worldview" ? store.worldviewZoneEnabled
              : ctxModule === "characters" ? store.characterZoneEnabled
                : undefined,
          });
        } catch {
          projectContext = await buildChatContext(currentProject.id).catch(() => "");
        }

        // 检测用户消息中的章节引用
        try {
          const chapterRange = detectChapterRange(input);
          if (chapterRange) {
            const chapterCtx = await buildChapterContext(currentProject.id, chapterRange);
            projectContext += "\n\n===== 📖 用户指定查看的章节 =====\n" + chapterCtx;
          }
        } catch { /* ignore */ }
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
          return;
        }
      }

      // ====== 初始化记忆引擎（由 AiChatPanel 外部创建后传入） ======
      if (currentProject?.id && !memoryEngineRef.current) {
        memoryEngineRef.current = new MemoryEngine(currentProject.id);
        // 初始化时读取已有短期记忆
        const existing = memoryEngineRef.current.getShortTerm();
        if (existing.length > 0) setMemoryEntries(existing);
      }

      // ====== 流式 AI 调用 ======
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStreamingContent("");
      setStreamingThinking("");
      streamingPhaseRef.current = "thinking";
      setStreamingPhase("thinking");

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
              let ctx = fileContextHint + (projectContext ? "\n\n" + projectContext : "");
              const engine = memoryEngineRef.current;
              if (engine) {
                const { memorySummary } = engine.buildHistory(store.chatMessages, input);
                if (memorySummary) ctx += "\n\n" + memorySummary;
              }
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
                  "```\n---CHARACTERS---\n[{\"action\":\"create_character\",\"character\":{\"name\":\"叶玄\",\"faction\":\"九霄宗\",\"gender\":\"男\",\"age\":\"18\",\"race\":\"人族\",\"appearance\":\"清秀少年，黑衣佩剑\",\"personality\":\"坚韧隐忍，重情护短\",\"background\":\"九霄宗外门弟子\",\"ability\":\"基础剑法\",\"style\":\"低调务实\"}},\n" +
                  " {\"action\":\"create_character\",\"character\":{\"name\":\"曲凌霜\",\"faction\":\"长霄峰\",\"gender\":\"女\",\"age\":\"20\",\"race\":\"人族\",\"appearance\":\"银白长发，冰蓝眼眸\",\"personality\":\"冷若冰霜\",\"background\":\"九霄宗内门首席\",\"ability\":\"冰心剑诀\"}},\n" +
                  " {\"action\":\"create_relationship\",\"edge\":{\"sourceName\":\"叶玄\",\"targetName\":\"曲凌霜\",\"relation_type\":\"师徒\",\"strength\":8}}]\n---END_CHARACTERS---\n```\n" +
                  `规则：\n` +
                  `- 每个角色生成一个 create_character，name 必填\n` +
                  `- 可填字段：name(姓名)、faction(派系)、gender(性别 male/female/other)、age(年龄)、race(种族)、appearance(外在形象)、personality(内在性格)、background(背景经历)、ability(能力)、style(行事风格)、interests(兴趣爱好)\n` +
                  `- 有关联的角色用 create_relationship 连线\n` +
                  `- relation_type：师徒/敌对/爱慕/朋友/同盟/亲属/其他\n` +
                  `- strength 1-10 表示关系紧密程度\n` +
                  `- 在 ---CHARACTERS--- 之前用自然语言简述角色和关系\n\n` +
                  `【完善角色卡 — 重要！】\n` +
                  `当用户要求完善某个角色的信息时，请用以下格式输出更新内容：\n` +
                  "```\n---CHARACTER_UPDATE---\n[{\"name\":\"曲凌霜\",\"fields\":{\"gender\":\"女\",\"age\":\"20\",\"race\":\"人族\",\"appearance\":\"银白长发，冰蓝眼眸...\",\"personality\":\"冷若冰霜...\",\"background\":\"九霄宗内门首席...\",\"ability\":\"冰心剑诀·第六重...\",\"style\":\"凌厉果决...\",\"interests\":\"独处、抚琴...\"}}]\n---END_CHARACTER_UPDATE---\n```\n" +
                  `可更新的字段：gender(性别)、age(年龄)、race(种族)、appearance(外在形象)、personality(内在性格)、background(背景经历)、ability(能力)、style(行事风格)、interests(兴趣爱好)、faction(派系)、desire(渴望)、fear(恐惧)、flaw(缺陷)、arc(弧光)\n` +
                  `- 每次可以更新一个或多个角色\n` +
                  `- 只填需要修改的字段，其他字段不传\n` +
                  `- 在 ---CHARACTER_UPDATE--- 之前用自然语言描述角色信息\n`
                  : activeModule === "outline" && outlineSection === "plot-direction"
                    ? `\n【剧情走向 — 重要！】` +
                    `用户正在剧情走向画布上工作。明线是故事表层发展，暗线是隐藏的伏笔与阴谋。\n\n` +
                    `当用户要求创建、修改或删除剧情段落和细纲时，请用以下格式输出：\n` +
                    "```\n---PLOT_SEGMENTS---\n[{\"action\":\"create_segment\",\"segment\":{\"type\":\"bright\",\"title\":\"少年入世\",\"characters\":\"叶玄\",\"time\":\"天元纪元205年\",\"chapters\":\"1-90\",\"event\":\"叶玄拜入九霄宗开始修炼之路\"}},\n" +
                    " {\"action\":\"create_segment\",\"segment\":{\"type\":\"dark\",\"title\":\"暗流涌动\",\"characters\":\"慕容云\",\"time\":\"天元纪元205年\",\"chapters\":\"1-90\",\"event\":\"暗影盟暗中观察九霄宗动向\"}},\n" +
                    " {\"action\":\"create_beat\",\"segmentTitle\":\"少年入世\",\"beat\":{\"title\":\"拜入山门\",\"characters\":\"叶玄\",\"chapters\":\"1-5\",\"time\":\"天元纪元205年\",\"location\":\"九霄宗山门\",\"event\":\"叶玄通过入门试炼成为外门弟子\"}},\n" +
                    " {\"action\":\"update_beat\",\"segmentTitle\":\"少年入世\",\"beatNumber\":3,\"fields\":{\"title\":\"修改后的名称\",\"characters\":\"新增角色\",\"chapters\":\"3-8\",\"time\":\"天元纪元206年\",\"event\":\"修改后的事件描述\"}},\n" +
                    " {\"action\":\"delete_beat\",\"segmentTitle\":\"少年入世\",\"beatNumber\":5},\n" +
                    " {\"action\":\"create_edge\",\"edge\":{\"sourceTitle\":\"少年入世\",\"targetTitle\":\"初露锋芒\"}}]\n---END_PLOT_SEGMENTS---\n```\n" +
                    `规则：\n` +
                    `- create_segment: 创建段落（type=bright/dark），title/chapters 必填\n` +
                    `- create_beat: 在已有段落下创建细纲，segmentTitle 指定段落标题。细纲字段：title(名称)、characters(人物)、chapters(章节范围)、time(时间)、location(地点)、event(事件)\n` +
                    `- update_beat: 修改细纲的任意字段（只传需要改的字段），beatNumber 是细纲序号。可更新字段同上\n` +
                    `- delete_beat: 删除细纲，beatNumber 是细纲序号\n` +
                    `- create_edge: 段落之间连线\n` +
                    `- 用户当前剧情走向中的段落列表在对话开始时会列出，你可以据此引用段落标题和细纲序号。\n` +
                    `\n当用户要求创建章节时，请用以下格式输出：\n` +
                    "```\n---CHAPTERS---\n[{\"action\":\"create_chapter\",\"chapter\":{\"volumeTitle\":\"少年入世\",\"number\":1,\"title\":\"初入九霄\"}},\n" +
                    " {\"action\":\"create_chapter\",\"chapter\":{\"volumeTitle\":\"少年入世\",\"number\":2,\"title\":\"拜见师尊\"}}]\n---END_CHAPTERS---\n```\n" +
                    `规则：\n` +
                    `- volumeTitle 对应明线段落的标题（卷名）\n` +
                    `- number 章节号（从1开始递增）\n` +
                    `- title 章节标题\n`
                    : ""
              ) +
              `\n【重要规则】你当前正在「${activeModule === "outline" ? OUTLINE_SECTION_LABEL[outlineSection] : MODULE_LABEL[activeModule]}」模块中工作。\n` +
              `- 只允许输出当前模块对应的块模板，绝对不能输出其他模块的块模板。\n` +
              `- 当前模块：${activeModule === "outline" && outlineSection === "worldview" ? "只能输出 ---WORLD_TERMS--- 和 ---WORLD_TERM_UPDATE--- 块" : activeModule === "outline" && outlineSection === "characters" ? "只能输出 ---CHARACTERS--- 和 ---CHARACTER_UPDATE--- 块" : activeModule === "outline" && outlineSection === "plot-direction" ? "只能输出 ---PLOT_SEGMENTS--- 和 ---CHAPTERS--- 块" : "只能输出 ---CHAPTERS--- 块（创建章节）"}\n` +
              `- 即使对话历史中有其他模块的块模板示例，也不要模仿输出。\n` +
              `- 你可以自然地讨论所有项目数据（世界观、角色、剧情等），但创建操作只能用当前模块的格式。\n` +
              fileContextHint + segmentsContext,
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

      // 流完成：清理 timer
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      streamingPhaseRef.current = "content";
      setStreamingPhase("content");

      // ====== 解析 AI 回复 ======
      const aiContent = res.error ?? res.content;
      const rawAiContent = aiContent;
      const filteredAiContent = stripOtherModuleBlocks(aiContent, activeModule, outlineSection);

      // 检查是否包含世界观词条创建指令（仅世界观模块）
      let worldTermDef = activeModule === "outline" && outlineSection === "worldview"
        ? parseWorldTermAction(filteredAiContent)
        : null;

      // 去除 AI 回复中的 JSON 块
      let displayContent = aiContent;
      if (worldTermDef) {
        displayContent = displayContent.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/, "").trim();
        if (!displayContent) {
          displayContent = `✅ 已创建世界观词条「${worldTermDef.title}」，请在画布中查看。`;
        }
      }

      // 添加 AI 回复消息
      const thinkingRef = streamThinkingRef.current;
      const assistantMsg: ChatMessage = {
        id: uuid(), role: "assistant",
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
                await api.deleteWorldTerm(target.id);
                await api.saveWorldTerm({ ...updated, id: uuid() });
              } else {
                await api.saveWorldTerm(updated);
              }
              useAppStore.getState().bumpWorldTerms();
              appendChatMessages([{
                id: uuid(), role: "system",
                content: `✅ 已更新词条「${updateDef.title_new || updateDef.title}」`,
                created_at: new Date().toISOString(),
              }]);
              displayContent = displayContent.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/, "").trim();
            } else {
              appendChatMessages([{
                id: uuid(), role: "system",
                content: `⚠️ 未找到词条「${updateDef.title}」`,
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

      // ====== 世界词条：存为待插入状态（仅世界观模块） ======
      const pendingWorldTerms: WorldTerm[] = [];
      if (activeModule === "outline" && outlineSection === "worldview") {
        if (worldTermDef && currentProject) {
          pendingWorldTerms.push({
            id: uuid(), project_id: currentProject.id,
            term_type: worldTermDef.term_type, title: worldTermDef.title,
            one_liner: worldTermDef.one_liner || "", detail: worldTermDef.detail || "",
            ring_level: 1, forbidden: [], is_locked: false, layout_x: 0, layout_y: 0,
          });
        }

        const batchWorldTerms = parseBatchWorldTerms(filteredAiContent);
        if (batchWorldTerms.length > 0 && currentProject) {
          const edgeActs = parseEdgeActions(filteredAiContent);
          for (const wt of batchWorldTerms) {
            pendingWorldTerms.push({
              id: uuid(), project_id: currentProject.id,
              term_type: wt.term_type, title: wt.title,
              one_liner: wt.one_liner, detail: wt.detail,
              ring_level: 1, forbidden: [], is_locked: false, layout_x: 0, layout_y: 0,
            });
          }
          setPendingEdges(edgeActs);
        }

        // 批量词条修改
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
                pendingWorldTerms.push({
                  id: uuid(), project_id: currentProject.id,
                  term_type: (u.fields.term_type as any) || "other", title: u.title,
                  one_liner: u.fields.one_liner || "", detail: u.fields.detail || "",
                  ring_level: 1, forbidden: [], is_locked: false, layout_x: 0, layout_y: 0,
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
          displayContent = `📋 已解析 ${pendingWorldTerms.length} 个词条，点击下方「插入到画布」添加到画布。`;
        }
      }

      // ====== 人物角色：从 RAW 内容解析 ---CHARACTERS--- 块 ======
      if (currentProject) {
        const charBatch = parseCharacterBatch(rawAiContent);
        if (charBatch.chars.length > 0 || charBatch.edges.length > 0 || charBatch.removeEdges.length > 0 || charBatch.snapshots.length > 0) {
          setPendingChars(prev => {
            const existingNames = new Set(prev.map((c: any) => c.name));
            return [...prev, ...charBatch.chars.filter((c: any) => !existingNames.has(c.name))];
          });
          setPendingCharEdges(prev => {
            const existingKeys = new Set(prev.map((e: any) => `${e.sourceName}::${e.targetName}`));
            return [...prev, ...charBatch.edges.filter((e: any) => !existingKeys.has(`${e.sourceName}::${e.targetName}`))];
          });
          setPendingRemoveEdges(prev => [...prev, ...charBatch.removeEdges]);
          setPendingSnapshots(prev => [...prev, ...charBatch.snapshots]);
          displayContent = displayContent
            .replace(/---CHARACTERS---[\s\S]*?---END_CHARACTERS---/g, "")
            .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
            .trim();
          if (!displayContent) {
            const parts: string[] = [];
            if (charBatch.chars.length > 0) parts.push(`${charBatch.chars.length} 个角色`);
            if (charBatch.edges.length > 0) parts.push(`${charBatch.edges.length} 条关系`);
            if (charBatch.removeEdges.length > 0) parts.push(`删除 ${charBatch.removeEdges.length} 条关系`);
            displayContent = `🌟 已解析 ${parts.join("、")}，点击下方「应用到星图」更新画布。`;
          }
        }

        // 角色卡更新
        const charUpdates = parseCharacterUpdate(rawAiContent);
        if (charUpdates.length > 0 && currentProject) {
          const allChars = await api.listCharacters(currentProject.id);
          const fields = ["gender", "age", "race", "appearance", "personality", "background", "ability", "style", "interests", "faction", "desire", "fear", "flaw", "arc"];
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
            useAppStore.getState().bumpCharacters();
          }
          displayContent = displayContent
            .replace(/---CHARACTER_UPDATE---[\s\S]*?---END_CHARACTER_UPDATE---/g, "")
            .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
            .trim();
          if (!displayContent) {
            displayContent = `✅ 已完善角色「${charUpdates.map(cu => cu.name).join("、")}」的角色卡信息。`;
          }
        }
      }

      // ====== 剧情走向段落：解析 ---PLOT_SEGMENTS--- 块 ======
      if (activeModule === "outline" && outlineSection === "plot-direction") {
        const plotBatch = parsePlotSegments(filteredAiContent);
        if (plotBatch.segments.length > 0 || plotBatch.beats.length > 0) {
          if (plotBatch.segments.length > 0) setPendingPlotSegments(prev => [...prev, ...plotBatch.segments]);
          if (plotBatch.edges.length > 0) setPendingPlotEdges(prev => [...prev, ...plotBatch.edges]);
          if (plotBatch.beats.length > 0) setPendingPlotBeats(prev => [...prev, ...plotBatch.beats]);
          displayContent = displayContent
            .replace(/---PLOT_SEGMENTS---[\s\S]*?---END_PLOT_SEGMENTS---/g, "")
            .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
            .trim();
          if (!displayContent) {
            const parts: string[] = [];
            if (plotBatch.segments.length > 0) parts.push(`${plotBatch.segments.length} 个剧情段落`);
            if (plotBatch.beats.length > 0) parts.push(`${plotBatch.beats.length} 个细纲`);
            displayContent = `📋 已解析 ${parts.join(" + ")}，点击下方「插入」确认。`;
          }
        }

        // 细纲更新/删除：立即执行
        if (plotBatch.updateBeats.length > 0 || plotBatch.deleteBeats.length > 0) {
          const pid = currentProject!.id;
          const segs = getJSONSync("plot-segments-" + pid, [] as any[]);
          const updatedInfo: string[] = [];
          for (const ub of plotBatch.updateBeats) {
            const seg = segs.find((s: any) => s.title === ub.segmentTitle);
            if (seg && seg.beats) {
              const beat = seg.beats.find((b: any) => b.number === ub.beatNumber);
              if (beat) { Object.assign(beat, ub.fields); updatedInfo.push(`「${ub.segmentTitle}」#${ub.beatNumber}`); }
            }
          }
          for (const db of plotBatch.deleteBeats) {
            const seg = segs.find((s: any) => s.title === db.segmentTitle);
            if (seg && seg.beats) {
              const before = seg.beats.length;
              seg.beats = seg.beats.filter((b: any) => b.number !== db.beatNumber);
              if (seg.beats.length < before) updatedInfo.push(`删除「${db.segmentTitle}」#${db.beatNumber}`);
            }
          }
          if (updatedInfo.length > 0) {
            try { setJSONSync("plot-segments-" + pid, segs); } catch { }
            useAppStore.getState().bumpPlot();
            displayContent = displayContent
              .replace(/---PLOT_SEGMENTS---[\s\S]*?---END_PLOT_SEGMENTS---/g, "")
              .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
              .trim();
            if (!displayContent) displayContent = `✅ 已更新细纲：${updatedInfo.join("、")}`;
          }
        }
      }

      // ====== 卷章：解析 ---CHAPTERS--- 块 ======
      if (currentProject) {
        const chaps = parseChapters(filteredAiContent);
        if (chaps.length > 0) {
          setPendingChapters(prev => [...prev, ...chaps]);
          displayContent = displayContent
            .replace(/---CHAPTERS---[\s\S]*?---END_CHAPTERS---/g, "")
            .replace(/```(?:json)?\s*[\s\S]*?```/g, "")
            .trim();
          if (!displayContent) {
            displayContent = `📋 已解析 ${chaps.length} 个章节，点击下方「插入」确认。`;
          }
        }
      }

      // ====== 最终清理：从历史记录中删除所有块模板 ======
      const cleanContent = stripAllBlocks(displayContent);
      if (cleanContent !== displayContent) {
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
            id: streamId, role: "assistant",
            content: abortMsg + "\n\n---\n*⏹ 已终止*",
            created_at: new Date().toISOString(),
          }]);
        }
      } else {
        appendChatMessages([{
          id: uuid(), role: "assistant",
          content: `出错了：${e}`,
          created_at: new Date().toISOString(),
        }]);
      }
    } finally {
      // 发送完毕：清空临时章节上下文 + 取消选取模式
      const store = useAppStore.getState();
      store.setEphemeralChapterContext("");
      store.setChapterSelectMode(false);
      store.setSelectedChapterIds([]);

      // 记忆压缩 + 标记
      try {
        const engine = memoryEngineRef.current;
        if (engine && currentProject) {
          engine.tagMessages(store.chatMessages);
          engine.executeAICCompression(store.chatMessages).then(() => {
            // 不管压缩是否创建了新条目，都刷新记忆面板
            setMemoryEntries(engine.getShortTerm());
            useAppStore.getState().bumpMemory();
          });
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
      setThinkingDuration(0);
      setLoading(false);
    }
  }, [
    setStreamingContent, setStreamingThinking, setStreamingPhase,
    setThinkingDuration, setLoading, setMemoryEntries,
    setPendingTerms, setPendingEdges, setPendingChars, setPendingCharEdges,
    setPendingRemoveEdges, setPendingSnapshots,
    setPendingPlotSegments, setPendingPlotEdges, setPendingPlotBeats,
    setPendingChapters,
  ]);

  return { send, stopStream };
}
