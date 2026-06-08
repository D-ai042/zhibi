# AI Novel Writer · 架构差距分析与改造路线图

> 最后更新：2026-06-04（v2.0 — 新增修订感知模块）
>
> 核心理念：你是导演（设定框架），AI 是执行编剧（在框架内创作），系统确保 AI 不跑偏。

---

## 目录

1. [理想目标定义](#1-理想目标定义)
2. [当前架构评分](#2-当前架构评分)
3. [现存问题清单](#3-现存问题清单)
4. [你的需求映射](#4-你的需求映射)
5. [完整解决方案](#5-完整解决方案)
6. [实施路线图](#6-实施路线图)

---

## 1. 理想目标定义

### 创作流程理想态

```
阶段一：设定框架
─────────────────────────────
你在各模块中完成：
  · 世界观画布 → 词条 + 规则体系
  · 人物星图 → 角色卡 + 关系网
  · 剧情走向 → 明暗线 + 时间轴节点
  · 故事圣经 → 风格指南 + 铁则 + 版本

阶段二：逐章写作（核心循环）
─────────────────────────────
① 你在写作台选中本章
② 系统自动组装上下文（40K token 上限）
   ├── P0 铁则（不可裁）
   ├── P1 前情摘要（按相关性检索，不限于5章）
   ├── P2 风格指南
   ├── P3 全书结构（卷章树 + 进度 + 角色状态全景）
   ├── P4 角色池（所有已出场角色完整卡）
   ├── P5 当前章节+节拍（AI 知道本章写了什么）
   └── P6 相关设定（按本章内容过滤）
③ AI 写出本章
④ 你审阅
⑤ 定稿 → 系统自动执行：
   ├── 质量检查器（4项检查，有 error 弹窗）
   ├── AI 摘要生成（结构化）
   ├── 新角色自动提取（写入角色库标记待确认）
   ├── 角色状态更新（位置/情绪/状态 → 写回角色卡）
   ├── 故事线推进（匹配剧情走向节点 → 更新进度%）
   ├── 伏笔管理（新伏笔入库/到期提醒）
   └── 全书结构刷新（卷章状态 + 完成度）
⑥ 下一章开始，重复

阶段三：审阅与修正
─────────────────────────────
· 质量检查器随时可手动触发
· 每10章自动生成审计报告
· 角色漂移/伏笔逾期/铁则违反 → 主动警告
```

### 每次发给 AI 的上下文（理想态）

```
分层结构（40K 上限，不是每次都满）：
┌─────────────────────────────────────────────┐
│ P0 铁则          ~1,000t  不可裁剪           │
│  风格指南 + 故事圣经铁则 + 世界观铁律         │
├─────────────────────────────────────────────┤
│ P1 前情摘要      ~8,000t  按需检索，不限于5章 │
│  前N章摘要（按相关性检索）+ 故事线进度 + 伏笔 │
├─────────────────────────────────────────────┤
│ P2 风格          ~800t   可压缩              │
│  叙述风格 + 文笔基调 + 写作红线 + 角色语言    │
├─────────────────────────────────────────────┤
│ P3 全书结构      ~1,500t  不可裁剪           │
│  卷章树 + 写作进度 + 活跃角色状态 + 待收伏笔  │
│  AI 知道自己写到哪一卷哪一章                  │
├─────────────────────────────────────────────┤
│ P4 角色池        ~5,000t  可裁数量           │
│  所有已出场角色完整卡（性格/状态/禁忌）        │
├─────────────────────────────────────────────┤
│ P5 当前章节内容  ~3,000t  写入时携带          │
│  本章节拍卡片 + 写作意图 + 已写正文片段       │
├─────────────────────────────────────────────┤
│ P6 相关设定      ~3,000t  可省略             │
│  本章涉及的世界观词条 + 关联地点 + 相关道具   │
├─────────────────────────────────────────────┤
│ 总计：~22K（安全范围，40K 时才裁剪）          │
└─────────────────────────────────────────────┘
```

---

## 2. 当前架构评分

| 维度 | 权重 | 评分 | 说明 |
|------|------|------|------|
| **架构设计** | 20% | 65/100 | 三层架构+P0-P4分层思路正确，但实现粗糙 |
| **数据连通性** | 20% | 30/100 | localStorage 和 API 混用，多源不同步 |
| **上下文感知** | 20% | 15/100 | `buildChatContext` 不区分模块，AI 不知道你在看什么 |
| **防跑偏能力** | 15% | 25/100 | 质量检查器写了但未接入，等于不存在 |
| **自动化程度** | 15% | 20/100 | 记忆更新器硬编码，不自动追踪角色/故事线 |
| **Token 策略** | 10% | 30/100 | 6000 硬上限 + 粗暴从后砍，不适合长文 |

**综合评分：32/100**

---

## 3. 现存问题清单

### 3.1 已修复的问题

| 问题 | 修复内容 | 状态 |
|------|---------|------|
| AI 词条跑到导航栏 | 移除 AI 操控导航能力（parseUIActions/moduleAction） | ✅ |
| AI 创建词条/角色后画布不刷新 | 插入后自动 bump + 导航到对应面板 | ✅ |
| 剧情走向创建后不刷新 | 新增 plotBump 独立刷新 | ✅ |
| 导航栏"让AI操控界面"按钮 | 已移除 | ✅ |

### 3.2 未修复的核心问题

按严重程度排列：

#### 🔴 P0 - 必须修

| ID | 问题 | 文件 | 具体表现 |
|----|------|------|---------|
| **P0-1** | 上下文引擎无模块感知 | `context-engine.ts` → `buildChatContext()` | 不管你在世界观还是写作台，AI 收到相同数据。写作台下 AI 看不到当前章内容 |
| **P0-2** | 质量检查器已写但未接入 | `quality-checker.ts` + `WritingModule.tsx` | `runQualityCheck()` 从未被调用。AI 写完直接保存，无人把关 |
| **P0-3** | 上下文裁剪粗暴 | `context-engine.ts` → `enforceTokenBudget()` | 从后往前砍段落，P1 前情可能被 P4 挤掉。600 章时 AI 看不到足够前情 |
| **P0-4** | 数据层不一致 | 全局 | 风格指南/故事圣经直接读 localStorage（不走 `api.ts`），Tauri 模式下为空 |
| **P0-5** | 未接入质量检查器至写作流程 | - | 质量检查器已开发但未在任何代码路径中调用 |
| **P0-6** | **章节修订无级联更新** | 全局 | 修改前章后，后续摘要/角色状态/伏笔全部过时，系统无声崩塌 |

#### 🟠 P1 - 应该修

| ID | 问题 | 文件 | 具体表现 |
|----|------|------|---------|
| **P1-1** | 摘要硬编码取 5 章 | `context-engine.ts` → `loadRecentSummaries()` | `.slice(0, 5)` 硬编码上限。600 章时前 595 章消失 |
| **P1-2** | 角色追踪硬编码 | `memory-updater.ts` → `KNOWN_CHARACTERS` | 角色名列表、故事线、地点全部硬编码在代码里 |
| **P1-3** | 记忆压缩无语义 | `memory-engine.ts` → `buildLocalEntries()` | 只拼接前 3 块前 80 字，不做语义摘要 |
| **P1-4** | Token 上限 6000 | `context-engine.ts` → `MAX_TOKENS = 6_000` | 长文不够用，40K 才合理 |
| **P1-5** | 故事线不连通用户创建的数据 | `memory-updater.ts` → `knownLines` | 4 条硬编码线，与 PlotDirectionPanel 的明暗线无关 |
| **P1-6** | 导出功能在浏览器模式不可用 | `api.ts` → 无 `exportProject` | `AppShell.tsx` 调用了不存在的方法，必然报错 |
| **P1-7** | `ChapterEditor` (TipTap) 摆设 | `ChapterEditor.tsx` | 写了但不被任何模块引用，写作台自用 contentEditable |

#### 🟡 P2 - 可以修

| ID | 问题 | 文件 | 具体表现 |
|----|------|------|---------|
| **P2-1** | `BeatsModule` 摆设 | `BeatsModule.tsx` | 永远不会渲染，路由已被 `WritingModule` 覆盖 |
| **P2-2** | `PlotLinesModule`/`PlotTimelineModule` 不可访问 | 两个模块 | 完整代码但导航无入口 |
| **P2-3** | `Phase2Placeholder` 摆设 | `Phase2Placeholder.tsx` | 无人引用 |
| **P2-4** | `contextCache`/`writingStatus`/`writingIntent` 摆设 | `app-store.ts` | 定义了状态但从未被实际使用 |
| **P2-5** | 语音转文字 STT 写死 | `AiChatPanel.tsx` | `const sttEnabled = false` |
| **P2-6** | 框架完成度永久 0% | `AppShell.tsx` footer | 从未有代码去计算 |

---

## 4. 你的需求映射

| 你的原文 | 对应的架构需求 | 关联问题 ID |
|---------|---------------|------------|
| "AI 能读取画布上的东西" | 上下文引擎模块感知 → 按模块组装上下文 | P0-1 |
| "处于世界观下能读取词条" | `buildChatContext` 增加 `{ module: "worldview" }` 参数，只强调词条数据 | P0-1 |
| "处于写作台第一章能读第一章内容" | P5 层携带当前章节正文 + 节拍卡片 | P0-1 |
| "写完后自动检查是否符合逻辑" | 质量检查器接入写作定稿流程 | P0-2 |
| "6000 token 不够，可以到 4 万" | `MAX_TOKENS` → 40000 + 重新设计裁剪优先级 | P1-4 |
| "AI 梳理书的结构" | P3 层新增全书结构（卷章树 + 进度 + 角色状态 + 伏笔） | 新增需求 |
| "AI 知道自己写到哪里" | 全书结构中包含当前卷/章/位置 | 新增需求 |
| "自动更新世界观/人物/剧情走向" | 记忆更新器增强：定稿后自动提取新角色/更新关系/推进故事线 | P1-2, P1-5 |
| "出现新人物自动创建" | 定稿后扫描正文新名 → 创建草稿角色卡 | 新增需求 |
| "AI 不容易逻辑矛盾" | 质量检查器 + 更长的上下文 + 更准的摘要 | P0-2, P0-3, P1-1 |
| "回头改前文后系统不崩" | 修订感知模块 + 依赖图 + 脏链传播 + 级联重跑 | P0-6 |
| "AI 不会自己检查自己放水" | 质量检查器用独立 system prompt + 温度=0 | P0-2 |

---

## 5. 完整解决方案

### Sprint 1：上下文感知 + 质量检查（预计 6h）

#### 5.1 上下文引擎模块感知化

**目标**：`buildChatContext` 按模块组装，AI 知道你在看什么

**改动文件**：`lib/context-engine.ts`、`layouts/AiChatPanel.tsx`

```typescript
// 新接口
interface ChatContextInput {
  projectId: string;
  module: "worldview" | "characters" | "plot-direction" | "writing" | "story-bible" | "chat";
  section?: string;       // 大纲下的分组
  chapterId?: string;     // 写作台当前章
  entityId?: string;      // 选中实体 ID
}

// 按模块组装：
// worldview → 全部词条 + 编组 + 连线
// characters → 全部角色 + 关系网
// plot-direction → 全部明暗线 + 连线 + 时间轴
// writing → P0-P4 + 本章正文 + 节拍卡片（完整写作上下文）
// story-bible → 风格指南 + 铁则 + 版本记录
// chat（默认）→ 全量概要（当前行为保留）
```

**效果**：你在世界观下问"这个设定有什么矛盾" → AI 知道你画布上有哪些词条；你在写作台问"下一段怎么写" → AI 知道你本章写了什么。

#### 5.2 质量检查器接入写作流程

**目标**：AI 写完后自动 4 项检查，有 error 弹窗

**改动文件**：`modules/writing/WritingModule.tsx`、`lib/quality-checker.ts`

```
AI写本章 → 保存 → runQualityCheck() → ✅全pass → updateMemory()
                                      → ❌有error → 弹窗确认 → 你决定是否继续
```

**4 项检查**：
1. 圣经合规（AI 是否违反铁则）→ error
2. 角色一致（角色表现是否符合档案）→ warning
3. 伏笔回收（该收的是否收了）→ warning
4. 版本正确（设定的版本是否对）→ error

---

### Sprint 2：40K Token + 全书结构（预计 5h）

#### 5.3 Token 上限提高到 40K + 重设计裁剪

**目标**：上限提到 40000，按层级优先级裁剪

**改动文件**：`lib/context-engine.ts`

```typescript
const MAX_TOKENS = 40_000;

// 各层预算
const LAYER_BUDGET = {
  p0: { max: 1_500,  fixed: true  },  // 铁则，不可裁
  p1: { max: 8_000,  fixed: true  },  // 前情，不可裁
  p3: { max: 1_500,  fixed: true  },  // 全书结构，不可裁
  p2: { max: 1_000,  fixed: false },  // 风格，可压缩
  p4: { max: 8_000,  fixed: false },  // 角色池，可裁数量
  p5: { max: 3_000,  fixed: false },  // 当前章，可压缩
  p6: { max: 3_000,  fixed: false },  // 相关设定，可省略
};

// 裁剪顺序：P6 → P5 → P4 → P2，P0/P1/P3 不动
```

#### 5.4 全书结构感知（P3 增强）

**目标**：AI 知道全部卷章树、当前进度、活跃角色、待收伏笔

**改动文件**：`lib/context-engine.ts`、`lib/memory-updater.ts`

```typescript
// 新增函数：assembleP3_BookStructure()
function assembleP3_BookStructure(projectId: string, currentChapterNumber: number): string {
  return `
【全书结构】
第一卷「${name}」: 第1-${end}章 (${status})
  ├── 第1章「${title}」✓ 定稿
  ├── 第2章「${title}」✓ 定稿
  ...
  └── 第${current}章「${title}」✍ 写作中 ← 当前位置

【当前状态】
· 完成度: ${finalizedChapters}/${totalChapters} 章定稿
· 活跃角色: ${activeCharacters.map(c => `${c.name}(${c.status})`)}
· 故事线: ${activeStorylines.map(s => `${s.name}(${s.progress}%)`)}
· 待收伏笔: ${pendingForeshadows.length} 条
  ${pendingForeshadows.map(f => `· ${f.description}（预期第${f.expected}章回收）`)}
`
}
```

---

### Sprint 3：记忆自动更新 + 修订感知（预计 12h）

#### 5.5 角色追踪动态化

**目标**：从 API 读取角色，不是硬编码

**改动文件**：`lib/memory-updater.ts`

```
现在：
  KNOWN_CHARACTERS = ["陈拾一", "祝楹", ...]

改成：
  定稿时调用 api.listCharacters(projectId) 读取真实角色
  遍历正文，匹配角色名（支持中文名/西文名/单字名，可配置正则模板）
  不在列表的 → 自动创建草稿角色卡（标记 status: "draft_auto"）
```

#### 5.6 故事线追踪动态化

**目标**：从剧情走向读取明暗线，不是硬编码

**改动文件**：`lib/memory-updater.ts`

```
现在：
  knownLines = [{ name: "宗门大比", keywords: [...] }]

改成：
  从 localStorage("plot-segments-{pid}") 读取用户创建的所有明暗线段落
  匹配正文 → 推进对应段落的进度
  增强：由写作 AI 在定稿时主动输出"本章推进了哪些故事线"，而非纯关键词匹配
```

#### 5.7 定稿后自动提取新角色

**流程**：

```
定稿 → 扫描正文 → AI 命名实体识别提取角色名（不限字数/语种）
     → 自动创建角色卡（字段空白，标记"待完善"）
     → 追加到 P4 角色池
     → 你可以在人物星图中看到新角色并完善信息
```

#### 5.8 ★ 章节版本号 + 脏链标记

**目标**：追踪每条记忆记录依赖哪个章节的哪个版本

**改动文件**：`lib/memory-updater.ts`、`types/index.ts`

```typescript
// 新增类型
interface ChapterVersion {
  chapterId: string;
  version: number;         // 每次保存 +1
  updatedAt: string;
}

interface VersionDependency {
  dependantId: string;     // 摘要/状态/伏笔的 ID
  dependsOnChapter: string; // 来源章节 ID
  dependsOnVersion: number; // 创建时的版本号
  status: "current" | "stale";
}

// LogStore 新增字段
interface LogStore {
  summaries?: ChapterSummary[];
  characterStates?: CharacterState[];
  storylines?: StorylineProgress[];
  foreshadows?: ForeshadowEntry[];
  snapshots?: ChapterSnapshot[];
  chapterVersions?: Record<string, number>;     // chapterId → version
  dependencies?: VersionDependency[];            // 依赖图
}
```

**写流程**：每次定稿时，将所有产出记录标记 `dependsOnChapter: currentChapter, dependsOnVersion: currentVersion`

**读流程**：构建上下文时，检查每条记录的状态——`stale` 的记录在 P1 中标注"⚠ 基于旧版本，可能已过时"

#### 5.9 ★ 精确依赖图 + 级联重跑（方案C）

**目标**：修改前章后，自动检测哪些数据过时，提供一键重跑

**改动文件**：`lib/memory-updater.ts`、`modules/writing/WritingModule.tsx`

```typescript
interface DependencyGraph {
  // 正向：章节 → 依赖该章的数据条目
  forward: Map<string, Set<string>>;   // chapterId → Set<dependantId>
  // 反向：数据条目 → 依赖的章节版本
  reverse: Map<string, { chapterId: string; version: number }>;
}
```

**工作流**：

```
① 第N章定稿 → 生成摘要Sₙ、角色状态Cₙ、伏笔Fₙ
              → 每条记录写入依赖 (dependsOn: N, version: vₙ)

② 第M章被修改(M < N) → version 从 vₘ 升到 vₘ'
                       → 遍历依赖图，找到所有 dependsOnChapter === M 的记录
                       → 将记录标记为 stale
                       → 将第 M+1 到第 N 章的所有摘要标记为 "上游已变更"

③ 用户看到效果：
   ├── 写作台第N章编辑器上方出现横幅：
   │   ╔══════════════════════════════════════════════════════════╗
   │   ║ ⚠ 第10章已修改 → 第11~49章的摘要/角色状态/伏笔已过时  ║
   │   ║ [从第10章开始重跑记忆] [查看受影响数据]                  ║
   │   ╚══════════════════════════════════════════════════════════╝
   │
   ├── 点击"重跑记忆" → 调用 rebaseMemory(fromChapter: 10)
   │   → 删除第10章之后的所有摘要/状态/伏笔
   │   → 从第10章开始，逐章重新运行 updateMemory()
   │   → 每一步使用新版本的第10章内容
   │   → 完成后刷新全书结构 P3
   │
   └── P1 前情摘要中 stale 记录前加 ⚠ 标记

④ rebaseMemory 核心函数：
   async function rebaseMemory(
     projectId: string,
     fromChapter: number,
     onProgress?: (current: number, total: number) => void
   ): Promise<void> {
     const store = getLogStore(projectId);
     // 0. 自动创建快照（用于回退）
     createSnapshot(projectId, `重跑前-从第${fromChapter}章开始`);
     // 1. 删除 fromChapter 及之后的所有记录
     store.summaries = store.summaries.filter(s => s.chapter_number < fromChapter);
     store.characterStates = [];
     store.storylines = [];
     store.foreshadows = store.foreshadows.filter(f => f.planted_chapter < fromChapter);
     // 2. 逐章重跑
     const chapters = loadPlotChapters(projectId)
       .filter(ch => ch.number >= fromChapter)
       .sort((a, b) => a.number - b.number);
     for (let i = 0; i < chapters.length; i++) {
       const ch = chapters[i];
       onProgress?.(ch.number, chapters[chapters.length - 1].number);
       await updateMemory({
         projectId,
         chapterNumber: ch.number,
         chapterTitle: ch.title,
         chapterContent: ch.content,
         characters: [],
       });
     }
     // 3. 更新版本号
     bumpChapterVersion(projectId, fromChapter);
     // 4. 清除 stale 标记
     clearStaleFlags(projectId);
   }

⑤ 快照机制：
   interface Snapshot {
     id: string;
     timestamp: string;
     label: string;
     data: {
       summaries: ChapterSummary[];
       characterStates: CharacterState[];
       storylines: StorylineProgress[];
       foreshadows: ForeshadowEntry[];
       chapterVersions: Record<string, number>;
     };
   }
   // 执行 rebaseMemory 前自动创建
   // 用户可在设置中查看快照列表并回退
   // 回退时替换当前数据 + 版本号回退
```

#### 5.10 质量检查器防 AI 自我放水

**目标**：检查器使用独立的 system prompt + 温度=0，确保不会放过真问题

**改动文件**：`lib/quality-checker.ts`

```
当前：
  aiComplete({ action: "chat", ... })
  使用默认 temperature

改成：
  aiComplete({
    action: "chat",
    extra: {
      system_hint: `你是一个严格的文学质量检查官。
  你的任务是从以下章节内容中找出问题，不要遗漏。
  规则：temperature=0，严格对照铁则，宁严勿宽。`,
      temperature: 0,
    }
  })
```

---

### Sprint 4：数据层统一 + 缓存 + 清理摆设（预计 5h）

#### 5.11 数据层统一

- 风格指南：`localStorage.getItem` → `api.getStyleGuide(projectId)`
- 故事圣经：`localStorage.getItem` → `api.getStoryBible(projectId)`
- 角色状态：`localStorage.getItem` → `api.getCharacterStates(projectId)`
- 摘要：`localStorage.getItem` → `api.getChapterSummaries(projectId)`

#### 5.12 40K Token 缓存设计

**目标**：不变的内容不重复传给 AI，节省 API 成本

```typescript
// 对 P0 铁则、P2 风格、P3 结构做内容哈希
// 如果哈希未变，用缓存替代重传
interface ContextCache {
  hash: string;
  content: string;
  expiresAt: number;
}
const contextCache = new Map<string, ContextCache>();
// 缓存有效期：直到相关数据被修改
```

#### 5.13 清理摆设代码

- 移除 `BeatsModule.tsx`（被 `WritingModule` 覆盖）
- 为 `PlotLinesModule`、`PlotTimelineModule` 添加导航入口或确认是否保留
- 移除 `Phase2Placeholder.tsx`
- 移除 `contextCache`/`writingStatus`/`writingIntent` 等未使用的 store 字段
- 移除 `ChapterEditor.tsx`（未被引用）
- 修复导出功能（`api.ts` 增加 `exportProject`）
- 修复 STT 或移除按钮

---

## 6. 实施路线图

### 总工时估算：约 28 小时

```
Sprint 1（6h）→ 上下文感知 + 质量检查
  ├── 5.1 上下文引擎模块感知化    4h  ← ★ 从这里开始
  ├── 5.2 质量检查器接入写作流程  1.5h
  └── 验证 + 修复 bug            0.5h

Sprint 2（5h）→ 40K Token + 全书结构
  ├── 5.3 Token 上限 + 重设计裁剪  2h
  ├── 5.4 P3 全书结构感知         2.5h
  └── 验证 + 修复 bug            0.5h

Sprint 3（12h）→ 记忆自动更新 + 修订感知
  ├── 5.5 角色追踪动态化          2h
  ├── 5.6 故事线追踪动态化        1.5h
  ├── 5.7 自动提取新角色          1h
  ├── 5.8 章节版本号 + 脏链标记   1.5h
  ├── 5.9 依赖图 + rebaseMemory   4h  ← 方案C 核心
  ├── 5.10 质量检查器防放水       0.5h
  └── 验证 + 修复 bug            1.5h

Sprint 4（5h）→ 数据层统一 + 缓存 + 清理
  ├── 5.11 数据层统一            2h
  ├── 5.12 40K Token 缓存设计    1h
  ├── 5.13 清理摆设              1.5h
  └── 最终验证                   0.5h
```

### 效果预期

```
改造前（当前）：                         改造后：
┌──────────────────┐                    ┌──────────────────┐
│ 支撑章节     30章 │                    │ 支撑章节    600章 │
│ Token上限    6K  │                    │ Token上限   40K  │
│ 模块感知    无   │                    │ 模块感知    有   │
│ 质量检查    未用 │                    │ 质量检查    自动 │
│ 角色追踪    硬编 │                    │ 角色追踪    动态 │
│ 故事线      硬编 │                    │ 故事线      动态 │
│ 摘要选择    5章 │                    │ 摘要选择    按需 │
│ 新角色      不追 │                    │ 新角色      自动 │
│ 全书结构    不报 │                    │ 全书结构    上报 │
│ 修订传播    无   │                    │ 修订传播    精确依赖图 │
│ 质量防放水  无   │                    │ 质量防放水  独立 prompt + t=0 │
│ API 缓存    无   │                    │ API 缓存    哈希缓存 │
│ 数据层      混乱 │                    │ 数据层      统一 │
│ 摆设代码    大量 │                    │ 摆设代码    干净 │
└──────────────────┘                    └──────────────────┘
```

---

## 一句话总结

**骨架对了（三层架构 + P0-P4 分层），血肉填了约 30%。** 要到百万字不跑偏的稳定状态，需要依次完成上下文感知 → 质量检查接入 → 40K 裁剪重设计 → 全书结构上报 → 记忆动态化 → **修订感知（方案C：精确依赖图）** → 数据层统一 这 7 项核心改造。最短路径约 28 小时工时。
