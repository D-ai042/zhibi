/**
 * Tauri invoke 封装；浏览器开发时用 localStorage 模拟后端。
 * EXE 生产包走 Tauri Rust 后端（SQLite），浏览器走 localStorage mock。
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
  StyleGuide,
  StoryBible,
  ChapterSummary,
} from "@/types";

export const isTauri = () =>
  typeof window !== "undefined" &&
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    // EXE 模式：走 Tauri Rust 后端（SQLite 持久化）
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args ?? {});
  }
  // 浏览器模式：走 localStorage mock 后端
  const { mockInvoke } = await import("./mock-backend");
  return mockInvoke<T>(cmd, args);
}

export const api = {
  getProjects: () => call<Project[]>("get_projects"),
  createProject: (name: string) => call<Project>("create_project", { name }),
  openProject: (projectId: string) => call<void>("open_project", { projectId }),
  deleteProject: (projectId: string) => call<void>("delete_project", { projectId }),
  renameProject: (projectId: string, name: string) => call<Project>("rename_project", { projectId, name }),

  getApiConfig: () => call<ApiConfig>("get_api_config"),
  setApiConfig: (baseUrl: string, model: string, apiKey?: string, providerName?: string) =>
    call<void>("set_api_config", { baseUrl, model, apiKey, providerName }),
  testApiConnection: () => call<{ ok: boolean; message: string }>("test_api_connection"),
  sttTranscribe: (audioBase64: string) => call<{ text: string }>("stt_transcribe", { audioBase64 }),
  setSttConfig: (stt: import("@/types").SttConfig) => call<void>("set_api_config", { stt }),
  /** 保存自定义厂商的模型列表 */
  setProviderModels: (provider: string, models: string[]) =>
    call<void>("set_provider_models", { provider, models }),

  getFrameworkProgress: (projectId: string) =>
    call<FrameworkProgress>("get_framework_progress", { projectId }),

  listVolumes: (projectId: string) => call<Volume[]>("list_volumes", { projectId }),
  listChapters: (projectId: string) => call<Chapter[]>("list_chapters", { projectId }),

  listTimelineNodes: (projectId: string) =>
    call<TimelineNode[]>("list_timeline_nodes", { projectId }),
  saveTimelineNode: (node: TimelineNode) => call<TimelineNode>("save_timeline_node", { node }),
  deleteTimelineNode: (id: string) => call<void>("delete_timeline_node", { id }),

  listPlotEvents: (projectId: string) => call<PlotEvent[]>("list_plot_events", { projectId }),
  savePlotEvent: (event: PlotEvent) => call<PlotEvent>("save_plot_event", { event }),
  deletePlotEvent: (id: string) => call<void>("delete_plot_event", { id }),

  listCharacters: (projectId: string) => call<Character[]>("list_characters", { projectId }),
  saveCharacter: (c: Character) => call<Character>("save_character", { character: c }),
  deleteCharacter: (id: string) => call<void>("delete_character", { id }),

  listRelationshipEdges: (projectId: string) =>
    call<RelationshipEdge[]>("list_relationship_edges", { projectId }),
  saveRelationshipEdge: (edge: RelationshipEdge) =>
    call<RelationshipEdge>("save_relationship_edge", { edge }),
  deleteRelationshipEdge: (id: string) => call<void>("delete_relationship_edge", { id }),
  saveNodeLayout: (entityType: string, entityId: string, x: number, y: number) =>
    call<void>("save_node_layout", { entityType, entityId, x, y }),

  listBeatCards: (chapterId: string) => call<BeatCard[]>("list_beat_cards", { chapterId }),
  saveBeatCard: (card: BeatCard) => call<BeatCard>("save_beat_card", { card }),
  deleteBeatCard: (id: string) => call<void>("delete_beat_card", { id }),

  getChapterContent: (chapterId: string) =>
    call<ChapterContent | null>("get_chapter_content", { chapterId }),
  saveChapterContent: (content: ChapterContent) =>
    call<void>("save_chapter_content", { content }),

  listLockedFields: (projectId: string) =>
    call<LockedField[]>("list_locked_fields", { projectId }),

  listWorldTerms: (projectId: string) => call<WorldTerm[]>("list_world_terms", { projectId }),
  saveWorldTerm: (term: WorldTerm) => call<WorldTerm>("save_world_term", { term }),
  deleteWorldTerm: (id: string) => call<void>("delete_world_term", { id }),

  // ===== v2.0 新增：数据层统一 =====
  getStyleGuide: (projectId: string) =>
    call<import("@/types").StyleGuide | null>("get_style_guide", { projectId }),
  saveStyleGuide: (guide: import("@/types").StyleGuide) =>
    call<void>("save_style_guide", { guide }),
  getStoryBible: (projectId: string) =>
    call<import("@/types").StoryBible | null>("get_story_bible", { projectId }),
  saveStoryBible: (bible: import("@/types").StoryBible) =>
    call<void>("save_story_bible", { bible }),
  getChapterSummaries: (projectId: string) =>
    call<import("@/types").ChapterSummary[]>("get_chapter_summaries", { projectId }),

  aiComplete: (req: AiRequest) => call<AiResponse>("ai_complete", { request: req }),

  /** 流式 AI 完成（浏览器模式），支持实时展示思考过程和中途终止 */
  aiCompleteStream: async (
    req: AiRequest,
    callbacks: { onChunk: (chunk: string, type: "thinking" | "content") => void },
    signal?: AbortSignal
  ): Promise<AiResponse> => {
    if (isTauri()) {
      // Tauri 模式下也用前端 fetch 走 SSE 流式，体验与浏览器一致
      const config = await call<ApiConfig>("get_api_config");
      const currentModel = config.api_model;
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
      if (config.provider_models) {
        for (const [p, models] of Object.entries(config.provider_models)) {
          if (models.includes(currentModel)) { provider = p; break; }
        }
      }
      if (!provider) provider = modelToProvider[currentModel] || "";
      const effectiveKey = config.provider_keys[provider] || "";
      const effectiveBaseUrl = config.provider_base_urls[provider] || config.api_base_url;
      if (effectiveKey && effectiveBaseUrl) {
        const { realAiCompleteStream } = await import("./mock-backend");
        return realAiCompleteStream(req, effectiveKey, effectiveBaseUrl, currentModel, callbacks, signal);
      }
      // Tauri 模式下没 Key 也尝试走 mockAiCompleteStream（降级报错）
      const { mockAiCompleteStream } = await import("./mock-backend");
      return mockAiCompleteStream(req, callbacks, signal);
    }
    // 浏览器模式 → 走 mockAiCompleteStream（里面有 Key 检测逻辑）
    const { mockAiCompleteStream } = await import("./mock-backend");
    return mockAiCompleteStream(req, callbacks, signal);
  },

  exportZip: (projectId: string) => call<string>("export_zip", { projectId }),
  /** 导出项目数据为 JSON 对象 */
  exportProject: (projectId: string) =>
    call<{
      project: Record<string, unknown>;
      worldTerms: Record<string, unknown>[];
      characters: Record<string, unknown>[];
      relationships: Record<string, unknown>[];
      plotEvents: Record<string, unknown>[];
      timelineNodes: Record<string, unknown>[];
      volumes: Record<string, unknown>[];
      chapters: Record<string, unknown>[];
      beatCards: Record<string, unknown>[];
      chapterContents: Record<string, unknown>[];
    }>("export_project", { projectId }),

  /** 保存导出文件（Tauri 模式） */
  saveExportFile: (projectId: string, filename: string, dataBase64: string, filePath: string) =>
    call<string>("save_export_file", { projectId, filename, dataBase64, filePath }),

  /** 通用设置读取（通过 app_settings 表） */
  getSetting: (key: string) =>
    call<string | null>("get_setting", { key }),
  /** 通用设置写入（通过 app_settings 表） */
  setSetting: (key: string, value: string) =>
    call<void>("set_setting", { key, value }),
};
