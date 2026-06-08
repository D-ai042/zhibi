/**
 * 浏览器 dev 模式下的内存 + localStorage 模拟，便于无 Rust 时调试 UI。
 */
import type {
  AiRequest,
  AiResponse,
  ApiConfig,
  BeatCard,
  Chapter,
  ChapterContent,
  Character,
  FrameworkProgress,
  LockedField,
  PlotEvent,
  Project,
  RelationshipEdge,
  TimelineNode,
  Volume,
  WorldTerm,
} from "@/types";


const STORAGE_KEY = "novel-workbench-mock";

/** 简单的 XOR 混淆（非加密，仅防明文直接暴露在 localStorage 中） */
const OBFUSCATE_KEY = "zhibi2024";
function obfuscate(str: string): string {
  if (!str) return "";
  const chars = str.split("").map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ OBFUSCATE_KEY.charCodeAt(i % OBFUSCATE_KEY.length)));
  return btoa(chars.join(""));
}
function deobfuscate(encoded: string): string {
  if (!encoded) return "";
  try {
    const chars = atob(encoded).split("").map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ OBFUSCATE_KEY.charCodeAt(i % OBFUSCATE_KEY.length)));
    return chars.join("");
  } catch { return ""; }
}

interface MockStore {
  projects: Project[];
  volumes: Volume[];
  chapters: Chapter[];
  timelineNodes: TimelineNode[];
  plotEvents: PlotEvent[];
  characters: Character[];
  edges: RelationshipEdge[];
  beatCards: BeatCard[];
  chapterContents: ChapterContent[];
  lockedFields: LockedField[];
  worldTerms: WorldTerm[];
  apiConfig: ApiConfig & { api_key?: string };
  currentProjectId: string | null;
}

function uid() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // fallback for environments where crypto.randomUUID is not available (e.g. VS Code embedded browser)
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const n = Number(c);
    return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
  });
}

function load(): MockStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const data = JSON.parse(raw) as MockStore;
    // 反混淆 API Key
    if (data.apiConfig.api_key) data.apiConfig.api_key = deobfuscate(data.apiConfig.api_key);
    if (data.apiConfig.provider_keys) {
      for (const k of Object.keys(data.apiConfig.provider_keys)) {
        if (data.apiConfig.provider_keys[k]) data.apiConfig.provider_keys[k] = deobfuscate(data.apiConfig.provider_keys[k]);
      }
    }
    // 迁移旧 STT 结构（flat → providers）
    if (data.apiConfig.stt && !(data.apiConfig.stt as any).providers) {
      const old = data.apiConfig.stt as any;
      const pName = old.provider || "openai";
      data.apiConfig.stt = {
        activeProvider: pName,
        providers: { [pName]: { api_key: old.api_key || "", secret_key: old.secret_key || "", base_url: old.base_url || "https://api.openai.com/v1", model: old.model || "whisper-1" } },
        enabled: old.enabled || false,
      } as any;
    }
    if (data.apiConfig.stt?.providers) {
      for (const p of Object.keys(data.apiConfig.stt.providers)) {
        if (data.apiConfig.stt.providers[p].api_key) data.apiConfig.stt.providers[p].api_key = deobfuscate(data.apiConfig.stt.providers[p].api_key);
        if (data.apiConfig.stt.providers[p].secret_key) data.apiConfig.stt.providers[p].secret_key = deobfuscate(data.apiConfig.stt.providers[p].secret_key);
      }
    }
    // 迁移：旧数据没有 provider_keys 字段
    if (!data.apiConfig.provider_keys) data.apiConfig.provider_keys = {};
    if (!data.apiConfig.provider_base_urls) data.apiConfig.provider_base_urls = {};
    if (!data.apiConfig.provider_models) data.apiConfig.provider_models = {};
    // 迁移：确保所有数组字段存在
    if (!data.worldTerms) data.worldTerms = [];
    if (!data.characters) data.characters = [];
    if (!data.edges) data.edges = [];
    if (!data.plotEvents) data.plotEvents = [];
    if (!data.timelineNodes) data.timelineNodes = [];
    if (!data.volumes) data.volumes = [];
    if (!data.chapters) data.chapters = [];
    if (!data.beatCards) data.beatCards = [];
    if (!data.chapterContents) data.chapterContents = [];
    if (!data.lockedFields) data.lockedFields = [];
    if (!data.apiConfig.provider_models) data.apiConfig.provider_models = {};
    return data;
  }
  return {
    projects: [],
    volumes: [],
    chapters: [],
    timelineNodes: [],
    plotEvents: [],
    characters: [],
    edges: [],
    beatCards: [],
    chapterContents: [],
    lockedFields: [],
    worldTerms: [],
    apiConfig: {
      api_base_url: "https://api.deepseek.com",
      api_model: "deepseek-chat",
      has_api_key: false,
      provider_keys: {},
      provider_base_urls: {},
      provider_models: {},
      stt: { activeProvider: "openai", providers: { openai: { api_key: "", secret_key: "", base_url: "https://api.openai.com/v1", model: "whisper-1" } }, enabled: false },
    },
    currentProjectId: null,
  };
}

function save(s: MockStore) {
  // 保存前混淆 API Key
  const clone = JSON.parse(JSON.stringify(s)) as MockStore;
  if (clone.apiConfig.api_key) clone.apiConfig.api_key = obfuscate(clone.apiConfig.api_key);
  if (clone.apiConfig.provider_keys) {
    for (const k of Object.keys(clone.apiConfig.provider_keys)) {
      if (clone.apiConfig.provider_keys[k]) clone.apiConfig.provider_keys[k] = obfuscate(clone.apiConfig.provider_keys[k]);
    }
  }
  if (clone.apiConfig.stt?.providers) {
    for (const p of Object.keys(clone.apiConfig.stt.providers)) {
      if (clone.apiConfig.stt.providers[p].api_key) clone.apiConfig.stt.providers[p].api_key = obfuscate(clone.apiConfig.stt.providers[p].api_key);
      if (clone.apiConfig.stt.providers[p].secret_key) clone.apiConfig.stt.providers[p].secret_key = obfuscate(clone.apiConfig.stt.providers[p].secret_key);
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clone));
}

function progressFor(projectId: string, s: MockStore): FrameworkProgress {
  const nodes = s.timelineNodes.filter((n) => n.project_id === projectId);
  const events = s.plotEvents.filter((e) => e.project_id === projectId);
  const chars = s.characters.filter((c) => c.project_id === projectId);
  const terms = s.worldTerms.filter((t) => t.project_id === projectId);
  const chaps = s.chapters.filter((c) => {
    const vol = s.volumes.find((v) => v.id === c.volume_id);
    return vol?.project_id === projectId;
  });
  const beats = s.beatCards.filter((b) => chaps.some((c) => c.id === b.chapter_id));
  const plotDir = nodes.length + events.length;
  return {
    worldview: terms.length ? Math.min(100, terms.length * 20) : 0,
    characters: chars.length ? Math.min(100, chars.length * 15) : 0,
    plot_direction: plotDir ? Math.min(100, plotDir * 15) : 0,
    beats: chaps.length ? Math.round((beats.length / (chaps.length * 3)) * 100) : 0,
  };
}

/** 百度 STT：获取 access_token */
let baiduTokenCache: { token: string; expiresAt: number } | null = null;

async function getBaiduAccessToken(apiKey: string, secretKey: string): Promise<string> {
  if (baiduTokenCache && Date.now() < baiduTokenCache.expiresAt) {
    return baiduTokenCache.token;
  }
  const resp = await fetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`, { method: "POST" });
  const data = await resp.json();
  if (data.access_token) {
    baiduTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  }
  throw new Error(`百度 token 获取失败: ${data.error_description || "未知错误"}`);
}

/** 百度 STT：语音转文字 */
async function handleBaiduStt(audioBase64: string, apiKey: string, secretKey: string): Promise<{ text: string; error?: string }> {
  if (!apiKey || !secretKey) return { text: "", error: "请填写 API Key 和 Secret Key" };
  // Tauri EXE 无 Vite proxy，需直接请求完整 URL
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const baiduApi = isTauri ? "https://aip.baidubce.com" : "";
  const baiduVop = isTauri ? "https://vop.baidu.com" : "";
  try {
    const tokenResp = await fetch(`${baiduApi}/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`, { method: "POST" });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      return { text: "", error: `百度 token 获取失败: ${tokenData.error_description || tokenData.error || "未知错误"}` };
    }
    const token = tokenData.access_token;

    const binaryLen = atob(audioBase64).length;

    const resp = await fetch(`${baiduVop}/server_api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "wav",
        rate: 16000,
        channel: 1,
        cuid: "novel-workbench",
        token,
        speech: audioBase64,
        len: binaryLen,
        dev_pid: 1537,
      }),
    });
    const data = await resp.json();
    if (data.err_no === 0 && data.result?.length > 0) {
      return { text: data.result[0] };
    }
    return { text: "", error: `百度返回错误: err_no=${data.err_no}, err_msg=${data.err_msg || "未知"}` };
  } catch (e) {
    return { text: "", error: `百度 API 请求失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 浏览器环境下直接调用 DeepSeek API（绕过 Tauri/Rust）。
 * 当用户在设置中配置了 API Key 后，走此路径获得真实 AI 回复。
 */
async function realAiComplete(req: AiRequest, apiKey: string, baseUrl: string, model: string): Promise<AiResponse> {
  const extra = req.extra ?? {};
  const systemHint = (extra.system_hint as string) ?? "你是小说创作助手。";
  const context = (extra.context as string) ?? "";
  const history = (extra.history as { role: string; content: string }[]) ?? [];

  // 将项目数据上下文合并到 system_hint 中（如果存在）
  const fullSystemHint = context
    ? systemHint + "\n\n===== 项目数据参考 =====\n" + context
    : systemHint;

  const messages: { role: string; content: string }[] = [
    { role: "system", content: fullSystemHint },
    ...history.slice(0, -1), // 历史除最后一条用户消息
    { role: "user", content: (extra.user_message as string) ?? "" },
  ];

  try {
    const url = `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (resp.status === 401) {
      return { content: "", citations: [], error: "API Key 无效 (401)" };
    }
    if (resp.status === 429) {
      return { content: "", citations: [], error: "请求过于频繁，请稍后重试 (429)" };
    }
    if (!resp.ok) {
      let detail = "";
      try { const err = await resp.json(); detail = err?.error?.message || JSON.stringify(err); } catch { detail = resp.statusText; }
      return { content: "", citations: [], error: `API 请求失败 (${resp.status}): ${detail}` };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return {
      content,
      citations: [`${req.entity_type}#${req.entity_id}`],
      error: undefined,
    };
  } catch (e) {
    return {
      content: "",
      citations: [],
      error: `网络错误: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 流式 AI 完成（浏览器模式）
 * - 有 API Key 时通过 SSE 实时获取回复
 * - 支持 AbortSignal 中断（保留已生成内容）
 * - 区分 thinking（思维链）和 content（正文）两阶段
 * - 无 API Key 时直接报错
 */
export async function mockAiCompleteStream(
  req: AiRequest,
  callbacks: { onChunk: (chunk: string, type: "thinking" | "content") => void },
  signal?: AbortSignal
): Promise<AiResponse> {
  const s = load();
  const currentModel = s.apiConfig.api_model;
  const modelToProvider: Record<string, string> = {
    "deepseek-v4-flash": "DeepSeek", "deepseek-v4-pro": "DeepSeek",
    "gpt-5.5": "OpenAI", "gpt-5.4": "OpenAI", "gpt-5.4-mini": "OpenAI",
    "claude-opus-4-8": "Anthropic", "claude-sonnet-4-6": "Anthropic", "claude-haiku-4-5": "Anthropic",
    "qwen-plus": "阿里云", "qwen-max": "阿里云",
    "glm-4-plus": "智谱", "glm-4-flash": "智谱",
    "moonshot-v1-8k": "月之暗面", "moonshot-v1-32k": "月之暗面",
    "baichuan2-53b": "百川智能",
    "yi-34b-chat": "零一万物",
    "Pro/Qwen2.5-7B-Instruct": "硅基流动", "Pro/deepseek-ai/DeepSeek-V3": "硅基流动",
    "mimo-v2.5-pro": "小米", "mimo-v2.5": "小米", "mimo-v2-flash": "小米",
  };
  // 1. 优先查 provider_models（自定义厂商），再回退到静态内置映射
  let provider = "";
  if (s.apiConfig.provider_models) {
    for (const [p, models] of Object.entries(s.apiConfig.provider_models)) {
      if (models.includes(currentModel)) { provider = p; break; }
    }
  }
  if (!provider) provider = modelToProvider[currentModel] || "";
  const effectiveKey = s.apiConfig.provider_keys?.[provider] || s.apiConfig.api_key || "";
  const effectiveBaseUrl = s.apiConfig.provider_base_urls?.[provider] || s.apiConfig.api_base_url || "";

  // 有 API Key → 真实流式调用
  if (effectiveKey && effectiveBaseUrl) {
    return realAiCompleteStream(req, effectiveKey, effectiveBaseUrl, currentModel, callbacks, signal);
  }

  // 无 API Key → 直接报错
  throw new Error("⚠️ 未配置 API Key。请在「API 设置」中配置对应厂商的 API Key。");
}

/**
 * 真实流式 AI 调用（SSE）
 * 解析 server-sent events，逐 chunk 回调
 * 区分 thinking（reasoning_content）和 content（正文）
 */
export async function realAiCompleteStream(
  req: AiRequest,
  apiKey: string,
  baseUrl: string,
  model: string,
  callbacks: { onChunk: (chunk: string, type: "thinking" | "content") => void },
  signal?: AbortSignal
): Promise<AiResponse> {
  const extra = req.extra ?? {};
  const systemHint = (extra.system_hint as string) ?? "你是小说创作助手。";
  const context = (extra.context as string) ?? "";
  const history = (extra.history as { role: string; content: string }[]) ?? [];
  const fullSystemHint = context
    ? systemHint + "\n\n===== 项目数据参考 =====\n" + context
    : systemHint;

  const messages: { role: string; content: string }[] = [
    { role: "system", content: fullSystemHint },
    ...history.slice(0, -1),
    { role: "user", content: (extra.user_message as string) ?? "" },
  ];

  const url = `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/chat/completions`;
  // thinking 参数仅 DeepSeek 支持，其他模型发过去会导致 400
  const useThinking = model.startsWith("deepseek");
  const body: Record<string, unknown> = { model, messages, stream: true };
  if (useThinking) body.thinking = { type: "enabled" };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (resp.status === 401) return { content: "", citations: [], error: "API Key 无效 (401)" };
  if (resp.status === 429) return { content: "", citations: [], error: "请求过于频繁 (429)" };
  if (!resp.ok) {
    let detail = "";
    try { const err = await resp.json(); detail = err?.error?.message || JSON.stringify(err); } catch { detail = resp.statusText; }
    return { content: "", citations: [], error: `API 请求失败 (${resp.status}): ${detail}` };
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let fullThinking = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          // DeepSeek 先发 reasoning_content（思维链），再发 content（正文）
          const reasoning = delta?.reasoning_content || "";
          const contentDelta = delta?.content || "";
          if (reasoning) {
            fullThinking += reasoning;
            callbacks.onChunk(reasoning, "thinking");
          }
          if (contentDelta) {
            fullContent += contentDelta;
            callbacks.onChunk(contentDelta, "content");
          }
        } catch { /* 跳过格式异常的 SSE 行 */ }
      }
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      return { content: fullContent, citations: [], error: undefined, thinking: fullThinking };
    }
    throw e;
  }

  return { content: fullContent, citations: [`${req.entity_type}#${req.entity_id}`], error: undefined, thinking: fullThinking };
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const s = load();
  const now = new Date().toISOString();

  switch (cmd) {
    case "get_projects":
      return s.projects as T;

    case "create_project": {
      const name = (args?.name as string) || "未命名作品";
      const id = uid();
      const project: Project = {
        id,
        name,
        stage: "ideation",
        framework_locked_at: null,
        created_at: now,
        updated_at: now,
      };
      s.projects.push(project);
      const vol: Volume = { id: uid(), project_id: id, title: "第一卷", sort_order: 0 };
      s.volumes.push(vol);
      for (let i = 1; i <= 3; i++) {
        s.chapters.push({
          id: uid(),
          volume_id: vol.id,
          number: i,
          title: `第${i}章`,
          status: "beat_ready",
          word_count: 0,
        });
      }
      save(s);
      return project as T;
    }

    case "open_project":
      s.currentProjectId = args?.projectId as string;
      save(s);
      return undefined as T;

    case "delete_project": {
      const pid = args?.projectId as string;
      // 获取项目名（清理聊天记录用）
      const delProj = s.projects.find(p => p.id === pid);
      const projName = delProj?.name;
      // ---- 先收集所有待删除的实体 ID（用于清理 lockedFields 等无 project_id 的数据） ----
      const volIds = new Set(s.volumes.filter(v => v.project_id === pid).map(v => v.id));
      const delChapterIds = new Set(s.chapters.filter(c => volIds.has(c.volume_id)).map(c => c.id));
      const delCharIds = new Set(s.characters.filter(c => c.project_id === pid).map(c => c.id));
      const delTermIds = new Set(s.worldTerms.filter(t => t.project_id === pid).map(t => t.id));
      const delNodeIds = new Set(s.timelineNodes.filter(n => n.project_id === pid).map(n => n.id));
      const delEventIds = new Set(s.plotEvents.filter(e => e.project_id === pid).map(e => e.id));
      const allDeletedEntityIds = new Set([...delChapterIds, ...delCharIds, ...delTermIds, ...delNodeIds, ...delEventIds]);
      // ---- 删除项目及相关数据 ----
      s.projects = s.projects.filter(p => p.id !== pid);
      s.volumes = s.volumes.filter(v => v.project_id !== pid);
      s.chapters = s.chapters.filter(c => !volIds.has(c.volume_id));
      s.characters = s.characters.filter(c => c.project_id !== pid);
      s.edges = s.edges.filter(e => e.project_id !== pid);
      s.timelineNodes = s.timelineNodes.filter(n => n.project_id !== pid);
      s.plotEvents = s.plotEvents.filter(e => e.project_id !== pid);
      s.beatCards = s.beatCards.filter(b => !delChapterIds.has(b.chapter_id));
      s.chapterContents = s.chapterContents.filter(cc => !delChapterIds.has(cc.chapter_id));
      s.worldTerms = s.worldTerms.filter(t => t.project_id !== pid);
      s.lockedFields = s.lockedFields.filter(l => !allDeletedEntityIds.has(l.entity_id));
      // 清理 localStorage 中的聊天记录
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(`novel-workbench-chat-${pid}`)) {
          localStorage.removeItem(key);
        }
      }
      if (projName) {
        localStorage.removeItem(`novel-workbench-chat-name:${projName}`);
      }
      save(s);
      return undefined as T;
    }

    case "rename_project": {
      const pid2 = args?.projectId as string;
      const newName = args?.name as string;
      const proj = s.projects.find(p => p.id === pid2);
      if (proj) {
        proj.name = newName;
        proj.updated_at = now;
      }
      save(s);
      return proj as T;
    }

    case "get_api_config":
      return {
        api_base_url: s.apiConfig.api_base_url,
        api_model: s.apiConfig.api_model,
        has_api_key: !!s.apiConfig.api_key || Object.values(s.apiConfig.provider_keys || {}).some(Boolean),
        provider_keys: s.apiConfig.provider_keys || {},
        provider_base_urls: s.apiConfig.provider_base_urls || {},
        provider_models: s.apiConfig.provider_models || {},
        stt: s.apiConfig.stt || { activeProvider: "openai", providers: { openai: { api_key: "", secret_key: "", base_url: "https://api.openai.com/v1", model: "whisper-1" } }, enabled: false },
      } as T;

    case "set_api_config": {
      // 全局设置
      s.apiConfig.api_base_url = (args?.baseUrl as string) || s.apiConfig.api_base_url;
      s.apiConfig.api_model = (args?.model as string) || s.apiConfig.api_model;
      if (args?.apiKey) s.apiConfig.api_key = args.apiKey as string;
      if (args?.providerName && args?.apiKey) {
        s.apiConfig.provider_keys[args.providerName as string] = args.apiKey as string;
      }
      if (args?.providerName && args?.baseUrl) {
        s.apiConfig.provider_base_urls[args.providerName as string] = args.baseUrl as string;
      }
      // 记录当前选中的提供商，用于模型下拉去重
      if (args?.providerName) {
        s.apiConfig.provider_base_urls["__active_provider__"] = args.providerName as string;
      }
      // 保存 STT 配置
      if (args?.stt) {
        s.apiConfig.stt = args.stt as typeof s.apiConfig.stt;
      }
      const allKeys = s.apiConfig.provider_keys ? Object.values(s.apiConfig.provider_keys).filter(Boolean) : [];
      s.apiConfig.has_api_key = !!s.apiConfig.api_key || allKeys.length > 0;
      save(s);
      return undefined as T;
    }

    case "test_api_connection": {
      const ok = !!s.apiConfig.api_key || Object.values(s.apiConfig.provider_keys || {}).some(Boolean);
      return { ok, message: ok ? "连接成功" : "请先填写 API Key" } as T;
    }

    case "stt_transcribe": {
      const audioBase64 = args?.audioBase64 as string;
      if (!audioBase64) return { text: "" } as T;

      // Tauri EXE 模式：走 Rust 后端（绕过 CORS）
      if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const result = await invoke<{ text: string }>("stt_transcribe", { audioBase64 });
          return result as T;
        } catch (e: any) {
          return { text: `（语音识别错误: ${e}）` } as T;
        }
      }

      const config = s.apiConfig.stt;
      // 未配置 STT 或未启用则报错
      if (!config?.enabled) {
        return { text: "（语音识别未启用。请在设置-语音配置中开启并填入 API Key。）" } as T;
      }

      // 从多 provider 中读取当前激活的配置
      const activeProvider = config.activeProvider || "openai";
      const providerCfg = config.providers?.[activeProvider] || config.providers?.openai || { api_key: "", secret_key: "", base_url: "https://api.openai.com/v1", model: "whisper-1" };

      // 根据不同 provider 调用
      if (activeProvider === "baidu") {
        const result = await handleBaiduStt(audioBase64, providerCfg.api_key, providerCfg.secret_key);
        if (result.text) return result as T;
        return { text: result.error ? `（百度语音识别错误: ${result.error}）` : "（百度语音识别未返回结果）" } as T;
      }

      // OpenAI 兼容格式（OpenAI / 硅基流动 / 自定义）
      const apiKey = providerCfg.api_key || s.apiConfig.api_key || Object.values(s.apiConfig.provider_keys || {})[0] || "";
      if (!apiKey) return { text: "（未找到 API Key，请在设置-语音配置中填入 Key）" } as T;
      const baseUrl = providerCfg.base_url.replace(/\/+$/, "");
      try {
        const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: (() => {
            const binary = atob(audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: "audio/webm" });
            const form = new FormData();
            form.append("file", blob, "audio.webm");
            form.append("model", providerCfg.model || "whisper-1");
            return form;
          })(),
        });
        if (!resp.ok) return { text: `（语音识别请求失败: ${resp.status}）` } as T;
        const data = await resp.json();
        return { text: data.text || "" } as T;
      } catch (e) {
        return { text: `（语音识别网络错误: ${e instanceof Error ? e.message : "未知"}）` } as T;
      }
    }

    case "get_framework_progress":
      return progressFor(args?.projectId as string, s) as T;

    case "list_volumes":
      return s.volumes.filter((v) => v.project_id === args?.projectId) as T;

    case "list_chapters": {
      const volIds = s.volumes
        .filter((v) => v.project_id === args?.projectId)
        .map((v) => v.id);
      return s.chapters.filter((c) => volIds.includes(c.volume_id)) as T;
    }

    case "list_timeline_nodes":
      return s.timelineNodes.filter((n) => n.project_id === args?.projectId) as T;

    case "save_timeline_node": {
      const node = args?.node as TimelineNode;
      const idx = s.timelineNodes.findIndex((n) => n.id === node.id);
      if (idx >= 0) s.timelineNodes[idx] = node;
      else s.timelineNodes.push(node);
      save(s);
      return node as T;
    }

    case "delete_timeline_node":
      s.timelineNodes = s.timelineNodes.filter((n) => n.id !== args?.id);
      save(s);
      return undefined as T;

    case "list_plot_events":
      return s.plotEvents.filter((e) => e.project_id === args?.projectId) as T;

    case "save_plot_event": {
      const event = args?.event as PlotEvent;
      const idx = s.plotEvents.findIndex((e) => e.id === event.id);
      if (idx >= 0) s.plotEvents[idx] = event;
      else s.plotEvents.push(event);
      save(s);
      return event as T;
    }

    case "delete_plot_event":
      s.plotEvents = s.plotEvents.filter((e) => e.id !== args?.id);
      save(s);
      return undefined as T;

    case "list_characters":
      return s.characters.filter((c) => c.project_id === args?.projectId) as T;

    case "save_character": {
      const c = args?.character as Character;
      const idx = s.characters.findIndex((x) => x.id === c.id);
      if (idx >= 0) s.characters[idx] = c;
      else s.characters.push(c);
      save(s);
      return c as T;
    }

    case "delete_character":
      s.characters = s.characters.filter((c) => c.id !== args?.id);
      save(s);
      return undefined as T;

    case "list_relationship_edges":
      return s.edges.filter((e) => e.project_id === args?.projectId) as T;

    case "save_relationship_edge": {
      const edge = args?.edge as RelationshipEdge;
      const idx = s.edges.findIndex((e) => e.id === edge.id);
      if (idx >= 0) s.edges[idx] = edge;
      else s.edges.push(edge);
      save(s);
      return edge as T;
    }

    case "delete_relationship_edge":
      s.edges = s.edges.filter((e) => e.id !== args?.id);
      save(s);
      return undefined as T;

    case "save_node_layout": {
      const { entityType, entityId, x, y } = args as {
        entityType: string;
        entityId: string;
        x: number;
        y: number;
      };
      if (entityType === "character") {
        const c = s.characters.find((ch) => ch.id === entityId);
        if (c) {
          c.layout_x = x;
          c.layout_y = y;
        }
      } else if (entityType === "world_term") {
        const t = s.worldTerms.find((wt) => wt.id === entityId);
        if (t) {
          t.layout_x = x;
          t.layout_y = y;
        }
      }
      save(s);
      return undefined as T;
    }

    case "list_beat_cards":
      return s.beatCards.filter((b) => b.chapter_id === args?.chapterId) as T;

    case "save_beat_card": {
      const card = args?.card as BeatCard;
      const idx = s.beatCards.findIndex((b) => b.id === card.id);
      if (idx >= 0) s.beatCards[idx] = card;
      else s.beatCards.push(card);
      save(s);
      return card as T;
    }

    case "delete_beat_card":
      s.beatCards = s.beatCards.filter((b) => b.id !== args?.id);
      save(s);
      return undefined as T;

    case "get_chapter_content":
      return (s.chapterContents.find((c) => c.chapter_id === args?.chapterId) ?? null) as T;

    case "save_chapter_content": {
      const content = args?.content as ChapterContent;
      const idx = s.chapterContents.findIndex((c) => c.chapter_id === content.chapter_id);
      if (idx >= 0) s.chapterContents[idx] = content;
      else s.chapterContents.push(content);
      save(s);
      return undefined as T;
    }

    case "list_locked_fields":
      return s.lockedFields.filter((f) => {
        const pid = args?.projectId as string;
        const node = s.timelineNodes.find((n) => n.id === f.entity_id);
        return node?.project_id === pid || s.characters.find((c) => c.id === f.entity_id)?.project_id === pid;
      }) as T;

    case "list_world_terms":
      return s.worldTerms.filter((t) => t.project_id === args?.projectId) as T;

    case "save_world_term": {
      const term = args?.term as WorldTerm;
      const idx = s.worldTerms.findIndex((t) => t.id === term.id);
      if (idx >= 0) s.worldTerms[idx] = term;
      else s.worldTerms.push(term);
      save(s);
      return term as T;
    }

    case "delete_world_term":
      s.worldTerms = s.worldTerms.filter((t) => t.id !== args?.id);
      save(s);
      return undefined as T;

    case "ai_complete": {
      const req = args?.request as AiRequest;

      // === 有 API Key 时走真实 API 调用 ===
      // 先查当前模型对应厂商的 key，没有则用全局 key
      const currentModel = s.apiConfig.api_model;
      // 从 AI_MODELS 列表查这个模型属于哪个厂商（简化处理：用 model 值的匹配前缀）
      const modelToProvider: Record<string, string> = {
        "deepseek-v4-flash": "DeepSeek", "deepseek-v4-pro": "DeepSeek",
        "gpt-5.5": "OpenAI", "gpt-5.4": "OpenAI", "gpt-5.4-mini": "OpenAI",
        "claude-opus-4-8": "Anthropic", "claude-sonnet-4-6": "Anthropic", "claude-haiku-4-5": "Anthropic",
        "qwen-plus": "阿里云", "qwen-max": "阿里云",
        "glm-4-plus": "智谱", "glm-4-flash": "智谱",
        "moonshot-v1-8k": "月之暗面", "moonshot-v1-32k": "月之暗面",
        "baichuan2-53b": "百川智能",
        "yi-34b-chat": "零一万物",
        "Pro/Qwen2.5-7B-Instruct": "硅基流动", "Pro/deepseek-ai/DeepSeek-V3": "硅基流动",
        "mimo-v2.5-pro": "小米", "mimo-v2.5": "小米", "mimo-v2-flash": "小米",
      };
      // 1. 优先查 provider_models（自定义厂商），再回退到静态内置映射
      let provider = "";
      if (s.apiConfig.provider_models) {
        for (const [p, models] of Object.entries(s.apiConfig.provider_models)) {
          if (models.includes(currentModel)) { provider = p; break; }
        }
      }
      if (!provider) provider = modelToProvider[currentModel] || "";
      const effectiveKey = s.apiConfig.provider_keys[provider] || s.apiConfig.api_key;
      const effectiveBaseUrl = s.apiConfig.provider_base_urls[provider] || s.apiConfig.api_base_url;

      if (effectiveKey) {
        const result = await realAiComplete(
          req,
          effectiveKey,
          effectiveBaseUrl,
          currentModel,
        );
        // 仅 chat 动作保留模块创建能力；其余动作直接返回
        if (req.action !== "chat") return result as T;
        // API 返回错误时直接透传
        if (result.error) {
          return result as T;
        }
        // 成功：返回真实 AI 回复，并保留模块创建检测
        const aiContent = result.content;
        const createJsonMatch = aiContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (createJsonMatch) {
          try {
            const parsed = JSON.parse(createJsonMatch[1]);
            if (parsed.action === "create_module") {
              // 包含模块创建指令，原样返回
              return result as T;
            }
          } catch { /* ignore */ }
        }
        return result as T;
      }

      // === 无 API Key 时直接报错 ===
      throw new Error("⚠️ 未配置 API Key。请在「API 设置」中配置对应厂商的 API Key。");
    }

    case "get_style_guide": {
      const pid = args?.projectId as string;
      try {
        const raw = localStorage.getItem(`novel-workbench-style-${pid}`);
        return raw ? JSON.parse(raw) : null as T;
      } catch { return null as T; }
    }

    case "save_style_guide": {
      const guide = args?.guide as Record<string, unknown>;
      if (guide?.project_id) {
        localStorage.setItem(`novel-workbench-style-${guide.project_id}`, JSON.stringify(guide));
      }
      return undefined as T;
    }

    case "get_story_bible": {
      const pid = args?.projectId as string;
      try {
        const raw = localStorage.getItem(`novel-workbench-bible-${pid}`);
        return raw ? JSON.parse(raw) : null as T;
      } catch { return null as T; }
    }

    case "save_story_bible": {
      const bible = args?.bible as Record<string, unknown>;
      if (bible?.project_id) {
        localStorage.setItem(`novel-workbench-bible-${bible.project_id}`, JSON.stringify(bible));
      }
      return undefined as T;
    }

    case "get_chapter_summaries": {
      const pid = args?.projectId as string;
      try {
        const raw = localStorage.getItem(`novel-workbench-log-${pid}`);
        if (!raw) return [] as T;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as T;
        return (parsed.summaries || []) as T;
      } catch { return [] as T; }
    }

    case "export_zip":
      return "mock-export.zip" as T;

    case "export_project": {
      const pid = args?.projectId as string;
      if (!pid) throw new Error("缺少 projectId");

      const proj = s.projects.find(p => p.id === pid);
      if (!proj) throw new Error("项目不存在");

      const volIds = new Set((s.volumes || []).filter(v => v.project_id === pid).map(v => v.id));
      const chapters = (s.chapters || []).filter(c => volIds.has(c.volume_id));
      const chapterIds = new Set(chapters.map(c => c.id));

      return {
        project: proj as Record<string, unknown>,
        worldTerms: (s.worldTerms || []).filter(t => t.project_id === pid) as Record<string, unknown>[],
        characters: (s.characters || []).filter(c => c.project_id === pid) as Record<string, unknown>[],
        relationships: (s.edges || []).filter(e => e.project_id === pid) as Record<string, unknown>[],
        plotEvents: (s.plotEvents || []).filter(e => e.project_id === pid) as Record<string, unknown>[],
        timelineNodes: (s.timelineNodes || []).filter(n => n.project_id === pid) as Record<string, unknown>[],
        volumes: (s.volumes || []).filter(v => v.project_id === pid) as Record<string, unknown>[],
        chapters: chapters as Record<string, unknown>[],
        beatCards: (s.beatCards || []).filter(b => chapterIds.has(b.chapter_id)) as Record<string, unknown>[],
        chapterContents: (s.chapterContents || []).filter(cc => chapterIds.has(cc.chapter_id)) as Record<string, unknown>[],
      } as T;
    }

    case "set_provider_models": {
      const { provider, models } = args as { provider: string; models: string[] };
      if (!s.apiConfig.provider_models) s.apiConfig.provider_models = {};
      s.apiConfig.provider_models[provider] = models;
      save(s);
      return undefined as T;
    }

    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}
