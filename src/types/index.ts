export type ProjectStage =
  | "ideation"
  | "framework_review"
  | "framework_locked"
  | "writing"
  | "completed";

/** 内置模块 ID */
export type ModuleId = "overview" | "outline" | "beats" | "writing" | "story-bible" | "manuscript" | "material";

/** 所有可导航的目标：内置模块 | 自定义模块 | 动态页面 */
export type NavTarget = ModuleId | "custom" | "dynamic";

/** 大纲下的分组 */
export type OutlineSection = "worldview" | "characters" | "plot-direction";

/** 总览下的分组 */
export type OverviewSection = "stats" | "worldview" | "characters";

/** 灵感下的分组 */
export type ManuscriptSection = "inspirations" | "cards";

export interface Project {
  id: string;
  name: string;
  stage: ProjectStage;
  framework_locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Volume {
  id: string;
  project_id: string;
  title: string;
  sort_order: number;
}

export interface Chapter {
  id: string;
  volume_id: string;
  number: number;
  title: string;
  status: "beat_ready" | "draft" | "reviewed" | "final";
  word_count: number;
}

export interface WorldTerm {
  id: string;
  project_id: string;
  term_type: "rule" | "faction" | "place" | "item" | "system" | "other";
  title: string;
  one_liner: string;
  detail: string;
  ring_level: number;
  forbidden: string[];
  is_locked: boolean;
  layout_x: number;
  layout_y: number;
}

export interface TimelineNode {
  id: string;
  project_id: string;
  type: "opening" | "turn" | "climax" | "ending" | "custom";
  title: string;
  summary: string;
  volume_id: string | null;
  sort_order: number;
  is_locked: boolean;
  layout_y: number;
  must_achieve: string[];
  character_ids: string[];
  linked_chapter_id: string | null;
}

export interface PlotEvent {
  id: string;
  project_id: string;
  line_type: "bright" | "dark";
  title: string;
  chapter_start: number;
  chapter_end: number;
  reader_knowledge: "unknown" | "hint" | "partial" | "known";
  truth_content: string;
  plant_method: string;
  convergence_chapter: number | null;
  is_locked: boolean;
  character_ids: string[];
}

export interface Character {
  id: string;
  project_id: string;
  name: string;
  gender: string;
  age: string;
  race: string;
  appearance: string;
  personality: string;
  background: string;
  ability: string;
  style: string;
  interests: string;
  faction: string;
  weight: number;
  desire: string;
  fear: string;
  flaw: string;
  arc: string;
  voice_style: string;
  ending_node_id: string | null;
  avatar_path: string | null;
  layout_x: number;
  layout_y: number;
  is_locked: boolean;
  first_appearance_chapter?: number;
  /** AI 生成的一句话身份标识，创建/编辑时自动填充，不暴露在 UI */
  summary?: string;
  /** 角色随时间变化的快照（字段级差异），按 age 排序 */
  snapshots?: CharacterSnapshot[];
  [key: string]: any;
}

/** 角色在某个年龄时的字段变化快照 */
export interface CharacterSnapshot {
  /** 角色在该快照时的年龄（如"20"、"30"） */
  age: string;
  /** 本章变化的具体字段 */
  changes: {
    personality?: string;
    ability?: string;
    appearance?: string;
    background?: string;
    style?: string;
    interests?: string;
    desire?: string;
    fear?: string;
    flaw?: string;
    arc?: string;
    voice_style?: string;
    faction?: string;
    race?: string;
    gender?: string;
  };
}

export interface RelationshipEdge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  strength: number;
  is_secret: boolean;
}

export interface BeatCard {
  id: string;
  chapter_id: string;
  column_type: "goal" | "conflict" | "turn" | "hook" | "reveal";
  content: string;
  sort_order: number;
}

export interface ChapterContent {
  chapter_id: string;
  body_json: string;
  body_html: string;
  updated_at: string;
}

export interface ApiConfig {
  api_base_url: string;
  api_model: string;
  has_api_key: boolean;
  /** 每个厂商的独立 API Key，keyed by provider name */
  provider_keys: Record<string, string>;
  /** 每个厂商的自定义 Base URL，keyed by provider name */
  provider_base_urls: Record<string, string>;
  /** 自定义厂商对应的可用模型列表，keyed by provider name */
  provider_models: Record<string, string[]>;
  /** 语音转文字 (STT) 配置 */
  stt: SttConfig;
}

export interface SttConfig {
  activeProvider: string;   // 当前激活的 provider 名
  providers: Record<string, {
    api_key: string;
    secret_key: string;     // Baidu 需要 Secret Key
    base_url: string;
    model: string;
  }>;
  enabled: boolean;
}

export interface FrameworkProgress {
  worldview: number;
  characters: number;
  plot_direction: number;
  beats: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  /** 估计 token 数 */
  tokens?: number;
  /** 话题标签（AI 自动归纳） */
  tags?: string[];
  /** 思考过程（DeepSeek reasoning_content） */
  thinking?: string;
}

/** 短期记忆条目（对话摘要压缩） */
export interface MemoryEntry {
  id: string;
  topic: string;
  summary: string;
  tags: string[];
  tokens: number;
  createdAt: string;
  /** 对应原始消息的 id 区间 */
  sourceMsgIds: string[];
  /** 涉及的角色/实体名 */
  entities: string[];
}

/** 长期记忆（项目知识沉淀） */
export interface LongTermMemory {
  worldview_rules: { rule: string; source: string; createdAt: string }[];
  character_traits: { char: string; trait: string; source: string; createdAt: string }[];
  plot_decisions: { topic: string; decision: string; source: string; createdAt: string }[];
  writing_prefs: { pref: string; source: string; createdAt: string }[];
  unresolved: { item: string; createdAt: string }[];
}

export interface AiRequest {
  action: string;
  entity_type: string;
  entity_id: string;
  extra?: Record<string, unknown>;
}

export interface AiResponse {
  content: string;
  citations: string[];
  error?: string;
  /** 思维链/思考过程（与 content 分离） */
  thinking?: string;
}

export interface LockedField {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
}

export interface CustomModule {
  id: string;
  name: string;
  icon: string;
  content: string;
  data?: Record<string, unknown>;
  source_message_id: string;
  created_at: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  kind: "builtin" | "custom" | "dynamic";
  customModuleId?: string;
  renderer?: "markdown" | "table" | "chart";
  pinned?: boolean;
}

/** 章节摘要 */
export interface ChapterSummary {
  project_id: string;
  chapter_number: number;
  chapter_title: string;
  summary: string;
  key_characters: string[];
  key_locations: string[];
  advanced_storylines: string[];
  planted_foreshadow: string[];
  created_at: string;
  updated_at: string;
}

/** 角色状态 */
export interface CharacterState {
  project_id: string;
  character_name: string;
  current_location: string;
  current_status: string;
  last_active_chapter: number;
  recent_changes: string[];
}

/** 故事线进度 */
export interface StorylineProgress {
  project_id: string;
  storyline_name: string;
  storyline_type: "main" | "branch" | "mystery";
  progress_percent: number;
  last_active_chapter: number;
  status: "active" | "dormant" | "completed";
  next_milestone: string;
}

/** 伏笔清单 */
export interface ForeshadowEntry {
  id: string;
  project_id: string;
  description: string;
  planted_chapter: number;
  expected_resolve_chapter: number;
  resolved_chapter: number | null;
  status: "pending" | "resolved" | "missed";
  priority: "critical" | "important" | "minor";
}

/** 章节快照 */
export interface ChapterSnapshot {
  project_id: string;
  chapter_number: number;
  excerpts: { text: string; purpose: string }[];
}

/** T5 剧情段落数据（plot-segments localStorage 格式） */
export interface PlotSegmentData {
  id: string; project_id: string; type: "bright" | "dark";
  title: string; characters: string; location: string; time: string;
  chapters: string; event: string;
  beats?: PlotBeatData[];
  [key: string]: unknown;
}

/** T5 节拍数据（beat 子结构） */
export interface PlotBeatData {
  number: number; title: string; characters?: string; location?: string;
  time?: string; event?: string; chapters?: string;
}

/** T5 日志库数据（novel-workbench-log localStorage 格式） */
export interface LogStoreData {
  summaries?: ChapterSummary[];
  characterStates?: CharacterState[];
  storylines?: StorylineProgress[];
  foreshadows?: ForeshadowEntry[];
  snapshots?: ChapterSnapshot[];
  termActivity?: { termId: string; status: string; activeForChapter: number; reason: string }[];
  nextChapterCharacters?: { forChapter: number; characterNames: string[]; updatedAt: string };
  dependencies?: Record<string, unknown>[];
  chapterVersions?: Record<string, number>;
  [key: string]: unknown;
}

/** 风格指南 */
export interface StyleGuide {
  project_id: string;
  narrative_style: string;
  writing_tone: string;
  writing_rules: string;
  character_voices: string;
  updated_at: string;
  updated_by_chapter: number;
}

/** 故事圣经 */
export interface StoryBible {
  project_id: string;
  main_stages: { name: string; chapter_range: [number, number]; status: string; description: string }[];
  locked_events: { chapter: number; title: string; description: string }[];
  inviolable_rules: string[];
  worldview_rules: string[];
  version: string;
  updated_at: string;
}

/** 写作意图 */
export interface WritingIntent {
  emphasis?: string;
  foreshadow?: string;
  emotion_curve?: string;
  custom?: string;
}

/** 上下文引擎输出 */
export interface ContextEngineOutput {
  systemHint: string;
  layers: {
    p0: string;
    p1: string;
    p2: string;
    p3: string;
    p4: string;
  };
  totalTokens: number;
  omitted: string[];
  characters: string[];
  worldTerms: string[];
  summaries: string[];
}

/** 上下文面板数据（T5 assembleContext panel 模式） */
export interface ContextPanelData {
  summaries: ChapterSummary[];
  beatCards: BeatCard[];
  characters: { name: string; status?: string }[];
  prevContent: { number: number; title: string; content: string } | null;
  worldRules: string[];
  styleRedlines: string;
  styleNarrative: string;
  styleTone: string;
}

/** AI UI 操控动作 — 在 AI 回复中通过 JSON 解析 */
export interface AiUIAction {
  action:
  | "add_nav_item"
  | "remove_nav_item"
  | "rename_nav_item"
  | "write_content"
  | "set_project_name"
  | "set_page_title"
  | "modify_data";
  params: Record<string, unknown>;
}

/** 支持的 lucide 图标列表（AI 创建模块时限定） */
export const LUCIDE_ICONS = [
  "BookMarked", "BrainCircuit", "Search", "Eye", "Zap",
  "Heart", "Target", "BarChart3", "Network", "TreePine",
  "GitFork", "Waypoints", "Split", "Combine", "Crosshair",
  "Radical", "ScanSearch", "TableOfContents", "NotebookText",
  "Quote", "MessageSquare", "Lightbulb", "AlertTriangle",
  "CheckCircle2", "ListChecks", "Timer", "CalendarDays",
  "Stars", "Wand2", "Paintbrush", "Puzzle",
] as const;

export const OUTLINE_SECTION_LABEL: Record<OutlineSection, string> = {
  worldview: "世界观",
  characters: "人物关系",
  "plot-direction": "剧情走向",
};

export const MODULE_LABEL: Record<ModuleId, string> = {
  overview: "总览",
  outline: "大纲",
  beats: "写作台",
  writing: "写作台",
  "story-bible": "故事圣经",
  manuscript: "灵感",
  material: "素材库",
};

export const OVERVIEW_SECTION_LABEL: Record<OverviewSection, string> = {
  stats: "写作统计",
  worldview: "世界观词库",
  characters: "角色档案",
};
