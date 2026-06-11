# AI 写文上下文优化 —— 待完善

> 创建时间：2026-06-11

---

## 一、P1 当前卷（完整细纲） vs 其他卷（只展示卷词条）

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP1`（约第 545-555 行）

### 核心逻辑

`plot-segments` 是一个树形结构：
- **卷（PlotSegment）**：类型 bright（明线卷），有 `title`、`characters`、`time`、`event`、`chapters` 等字段
- **细纲（PlotBeat）**：卷的 `beats[]` 数组，每个 beat 有 `number`（卷内序号）、`title`、`characters`、`time`、`event`、`chapters`
- `plot-chapters` 中每章的 `volumeSegmentId` 指向所属卷，`number` 是全书全局章节号

### 当前卷（含正在写的章）

- 展示卷词条的完整字段（title、characters、time、event、chapters 等）
- 展开卷内**所有细纲 beats**（完整信息：number、title、characters、location、time、event、chapters）
- **标记当前章节**属于哪个细纲范畴（beat.number 匹配当前 chapter.number）

```
【当前卷 — 卷名】
卷概要：角色：xxx  时间：xxx  章节范围：xx-xx  事件：xxx

细纲列表：
· Beat #1「标题」← 已完成 ✓
· Beat #2「标题」
  ...
· Beat #20「标题」← 当前正在写的章 ← AI 应关注此处
· Beat #21「标题」
  ...
· Beat #100「标题」
```

### 其他卷

- 只展示卷词条的完整字段（title、characters、time、event、chapters 等）
- **不展开细纲 beats**

```
【其他卷 — 第二卷·发展】
角色：xxx  时间：xxx  章节范围：11-20  事件：xxx

【其他卷 — 第三卷·高潮】
...
```

### 暗线

保持现状，不做改动。

---

---

## P0 世界观背景 — 移除冗余项、改善词条选取

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP0`（约第 450 行）

### 问题

1. **角色铁则 `inviolable_rules`** — UI 中不存在此输入框，永远为空数组，应删除
2. **故事主要阶段 `main_stages`** — 已放在 P1（卷章结构+细纲），P0 重复，应删除
3. **世界观词条 `worldTerms`** — `slice(0, 20)` 按 ID 取前 20 个太粗暴
4. `ring_level` 字段无 UI 修改入口，所有词条都是 1，无法按此筛选

### 改为

1. 删除 `inviolable_rules` 的输出代码块
2. 删除 `main_stages` 的输出代码块
3. 世界观词条改为**按"当前剧情关联度"筛选**：

   从 `plot-chapters` 和 `plot-segments` 提取关键词：
   - 当前章标题
   - 当前卷的 beats 中所有 `characters`、`location`、`event` 分词
   - 词条 `title` 或 `one_liner` 包含以上任意关键词 → 加载
   - 同时保证至少加载 `type === "rule"` 的词条（底层规则不可缺）
   
   数量无硬限制，token 超出由 `enforceTokenBudget` 裁剪。

```
【世界设定】
· [规则] 重力锁定：星球表面无法使用反重力
· [势力] 银色黎明：星际最大佣兵组织
· [地点] 新星城：联邦首府
...
```

---

### 数据结构确认
```typescript
interface PlotBeat {
    id: string;
    number: number;      // 卷内序号（每卷从1重新开始）
    title: string;       // 细纲标题
    characters: string;  // 出场角色
    location: string;    // 地点
    time: string;        // 时间
    event: string;       // 事件概要
    chapters: string;    // 章节范围
}
```

**PlotSegment**（卷词条）：
```typescript
interface PlotSegment {
    id: string;
    project_id: string;
    type: "bright" | "dark";
    title: string;       // 卷标题
    characters: string;
    location: string;
    time: string;
    event: string;
    chapters: string;    // 例如 "1-10"
    beats: PlotBeat[];   // 细纲数组
}
```

---

## 二、P4 出场角色：全量角色+全量关系 → 历史章节已出场的角色

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP4`（约第 730 行）  
**调用处**：`buildProjectContext`（约第 380 行）

### 当前代码

```typescript
function assembleP4(allCharacters: Character[], currentChapterNumber: number, allEdges: RelationshipEdge[] = []): string {
    const parts: string[] = ["━━━━ P4 · 已出场角色池 ━━━━"];
    const appeared = allCharacters.filter(c => {
        if (!c.first_appearance_chapter) return true;
        return c.first_appearance_chapter <= currentChapterNumber;
    });
    // ... 输出全部 appeared 角色 + allEdges 全部关系
```

**问题**：
1. `first_appearance_chapter` 字段在 Character 类型中不存在，导致 `!c.first_appearance_chapter` 恒为 true → 全部角色都被认为是已出场
2. `allEdges` 是全部人物关系，包含了尚未出场的角色关系

### 改为

```typescript
function assembleP4(
    allCharacters: Character[],
    currentChapterNumber: number,
    allEdges: RelationshipEdge[] = [],
    recentSummaries: ChapterSummary[] = [],  // 新增参数
): string {
```

**出场角色判断逻辑**：
1. 从前情摘要 `recentSummaries` 中提取所有 `key_characters`（前面章节摘要中的出场角色列表）
2. 同时从前几章的 `plot-chapters` 正文中匹配角色名（作为补充检测）
3. 去重 → 得到 `appearedNames: Set<string>`
4. `allCharacters` 中 `name` 在 `appearedNames` 中的才算已出场
5. 第一章（`currentChapterNumber === 1`）→ 无出场角色 → 输出"暂无已出场角色，AI 可自由安排"

**关系过滤**：
- `allEdges` 中只有 `source_id` 和 `target_id` **都在**已出场角色集合中的，才输出
- 即只展示已出场角色之间的关系，不展示未出场角色

### 输出格式

```
【已出场角色】（共 N 人）
· 角色名（派系）性格：xxx  外貌：xxx  背景：xxx...

【已出场角色关系】
· A → B [朋友] 亲密度: 7/10
```

---

## 三、移除节拍卡片（beat_cards）

**文件**：
1. `src/lib/context-engine.ts` — `buildProjectContext`（约第 395-405 行）
2. `src/lib/context-engine.ts` — `buildModuleContext` 的 `writing` 分支（约第 198-210 行）

### 删除代码

**`buildProjectContext` 中**（第 393-405 行）：
```typescript
        // 节拍卡片
        try {
            const beatCards = await api.listBeatCards(chapterId);
            if (beatCards.length > 0) {
                const colLabel: Record<string, string> = { goal: "目标", conflict: "冲突", turn: "转折", hook: "钩子", reveal: "揭示" };
                const beatStr = beatCards.map(b => `· [${colLabel[b.column_type] || b.column_type}] ${b.content}`).join("\n");
                p5 += `\n━━━━ 本章节拍卡片 ━━━━\n${beatStr}`;
            }
        } catch { /* ignore */ }
```

**`buildModuleContext` 中** writing 分支的节拍卡片代码块（类似结构，约第 198-210 行）。

保留 P5 本章已有正文部分，只删除节拍卡片。

---

## 四、素材优先级：已结构分析的素材置顶

**文件**：`src/modules/writing/WritingModule.tsx`  
**函数**：`handleAiWriteChapter`（约第 755-815 行）

### 当前代码

```typescript
// 组装带字数+剧情方向的 user_message
let userMsg = `请写第${selectedChapter.number}章「${selectedChapter.title}」。`;
userMsg += `\n\n字数要求：约 ${wordCount} 字。`;
if (plotDirection) {
    userMsg += `\n\n剧情方向：\n${plotDirection}`;
}
if (contextStr) {
    userMsg += `\n\n参考素材：\n${contextStr}`;
}
userMsg += `\n\n根据以上上下文，写出本章正文。`;
```

### 改为

素材分两类：
1. **已结构分析**（`t.structureAnalysis` 非空）→ 最高优先级，放在 `system_hint` 前面
2. **普通素材 / 灵感** → 放在 user_message 靠前位置

```typescript
// 组装结构分析素材（最高优先级，注入 system_hint）
let structureHint = "";
if (refIds && refIds.length > 0) {
    const matIds = refIds.filter(r => r.startsWith("mat:")).map(r => r.slice(4));
    if (matIds.length > 0) {
        const allItems = JSON.parse(localStorage.getItem(`material-items-${pid}`) || "[]");
        const analyzed = allItems.filter((i: any) => matIds.includes(i.id) && i.structureAnalysis);
        if (analyzed.length > 0) {
            structureHint = "\n\n【⚠️ 最高优先级 — 结构参考】\n";
            for (const t of analyzed) {
                structureHint += `\n──── ${t.name || "未命名"} ────\n`;
                structureHint += `【结构分析】\n${t.structureAnalysis}\n\n`;
                structureHint += `【原文】\n${t.content}\n`;
                structureHint += `\n（请严格遵循以上结构分析来组织本章内容）\n`;
            }
        }
    }
}

// system_hint 追加结构参考
const finalSystemHint = output.systemHint + structureHint;

// user_message 中灵感放在靠前位置（但不高于剧情方向）
let userMsg = `请写第${selectedChapter.number}章「${selectedChapter.title}」。`;
userMsg += `\n\n字数要求：约 ${wordCount} 字。`;
if (plotDirection) {
    userMsg += `\n\n剧情方向：\n${plotDirection}`;
}
// 灵感参考
const inspContext = buildInspContext(refIds, pid);  // 只取灵感
if (inspContext) {
    userMsg += `\n\n【灵感参考】\n${inspContext}`;
}
userMsg += `\n\n根据以上上下文，写出本章正文。`;
```

结构分析素材注入到 `system_hint`，AI 会将其视为指令级指导；灵感参考放在 user_message，作为辅助参考。

---

## 五、`context-engine.ts` — P4 调用处改造

`buildProjectContext` 中调用 `assembleP4` 时传入 `recentSummaries`：

```typescript
// 当前：
const p4 = assembleP4(allCharacters, currentChapter?.number || 1, allEdges);

// 改为：
const p4 = assembleP4(allCharacters, currentChapter?.number || 1, allEdges, recentSummaries);
```

---

## 六、定稿摘要字数：200 → 200-400 字

**文件**：`src/lib/memory-updater.ts`  
**行**：`buildChapterAnalysisPrompt` 函数，约第 82 行

### 当前

```
"summary": "本章核心剧情摘要（200字以内）",
```

### 改为

```
"summary": "本章核心剧情摘要（200-400字，包含关键出场人物、事件经过、场景地点）",
```

200 字是保底线，上限 400 字。AI 可以自由发挥但不少于 200、不超过 400。多了的 key_characters 和 key_locations 结构化字段已经有，这里主要是叙事性摘要。

---

## 七、定稿后追加「AI 判断词条激活状态」（新增功能）

### 触发时机

点击「定稿」按钮 → `updateMemory()` 完成后 → 执行新的 `activateNextChapterTerms()`。

### 完整定稿流程

```
点击「定稿」
  │
  ├─ 1. saveContent()                               // 保存正文
  ├─ 2. updateMemory()                              // AI 生成摘要/角色状态
  ├─ 3. activateNextChapterTerms() ★新增★           // AI 判断下一章词条激活
  │     └─ 给定：所有 worldTerms + 前5章摘要 + 第N+1章 beat
  │        → 返回每个词条的 active / dormant 标记
  │        → 写入 novel-workbench-log-{pid}.termActivity
  ├─ 4. createSnapshot()                            // 快照
  └─ 5. aiExtractNewCharacters()                    // 识别新角色
```

### AI Prompt（定稿后追加的短请求）

```
你是资深小说设定编辑。

给定：
1. 所有世界观词条列表（id、title、one_liner、term_type）
2. 前 5 章摘要（key_characters、key_locations、summary）
3. 下一章（第 N+1 章）的剧情规划（所属卷概要 + 当前细纲 beat 的完整信息）

对每个词条判断第 N+1 章是否需要：

- rule 类型：本章剧情是否涉及该规则约束的场景？
- place 类型：本章是否发生在该地点或直接关联地点？
- faction/character 类型：本章是否会出现该势力或人物？
- 其他类型：默认不需要

严格规则：
- 只有第 N+1 章明确相关才标 active，其他标 dormant
- 不要因为"以后可能会用到"而提前激活
- 输出纯 JSON，放在 ---TERM_ACTIVATION--- 块中：
---TERM_ACTIVATION---
{
  "terms": [
    {"id": "词条id", "status": "active", "reason": "一句话原因"}
  ]
}
---END_TERM_ACTIVATION---
```

### 数据存储

写入 `novel-workbench-log-{pid}` 的 `termActivity` 字段：

```typescript
interface TermActivityEntry {
  termId: string;
  termTitle: string;
  activeForChapter: number;  // 为第几章激活
  status: "active" | "dormant";
  reason: string;
  evaluatedAt: string;       // ISO 时间戳
}
```

## 下载

### AI 写文时 P0 加载逻辑改为

```typescript
// 旧：terms.slice(0, 20)
// 新：
terms.filter(t => {
  // 1. rule 类型始终加载
  if (t.term_type === "rule") return true;
  // 2. 查 termActivity 是否标记为 active
  const activity = logStore.termActivity?.find(a => a.termId === t.id);
  return activity?.status === "active";
});
```

### 首章无 termActivity 时的兜底

对第一章（无现成的 termActivity），AI 写文前按当前 beat 的 characters / location 匹配词条 title：

```typescript
// 第一章保底：beat 直接引用的词条
const beatTerms = terms.filter(t =>
  beat.characters.includes(t.title) || beat.location.includes(t.title)
);
```

---

## 八、移除「生成摘要」按钮

**文件**：`src/modules/writing/WritingModule.tsx`  
**位置**：定稿按钮右侧的"生成摘要"按钮（约 1309-1325 行）

### 原因

此按钮仅执行 `updateMemory()`，而定稿按钮已包含该调用。功能重复，移除。

---

## 九、故事圣经·上下文摘要 → 可编辑的上下文预览

**文件**：`src/modules/story-bible/StoryBibleModule.tsx`  
**组件**：`StyleSummary`（约第 495 行）

### 问题

当前"上下文摘要"标签页预览旧 P0-P5 结构（`buildProjectContext()`），但 AI 写文的上下文即将全部改造。预览和实际 AI 收到的不一致，且不能编辑。

### 改为

上下文摘要预览页面同步 AI 写文的实际上下文结构，并可编辑每层内容：

| 区块 | 来源 | 可编辑 |
|------|------|--------|
| **P0 世界观背景** | `rule` 词条 + `termActivity.active` | ✅ 手动增删词条 |
| **P1 剧情走向** | 当前卷细纲 + 其他卷概要 + 前5章摘要 | ✅ 编辑文本 |
| **P2 风格指南** | 风格指南 + 角色语言 | ✅ 编辑文本 |
| **P3 全书结构** | 卷章树 + 角色状态 + 故事线 + 伏笔 | ✅ 编辑文本 |
| **P4 已出场角色** | 前情摘要中已出场的角色 + 关系 | ✅ 增删角色 |
| **用户补充** | 用户自由填写 | ✅ 自由文本 |

编辑后的内容保存为 `customContextOverrides`，AI 写文时优先使用。

---

## 十、数据传递链路验证 —— 定稿 → AI写文

每章定稿产生的数据，必须被下一章 AI 写文正确读取。逐链路清单：

### 数据写入（定稿）→ 读取（AI写文）映射

| 写入方 | 写入位置 | 读取方 | 读取位置 | 链路状态 |
|--------|---------|--------|---------|---------|
| `updateMemory.saveSummary()` | `setJSONSync(novel-workbench-log-{pid})` → localStorage + fire-and-forget SQLite | `loadRecentSummaries()` → `api.getChapterSummaries()` → Rust → SQLite `app_settings` | `novel-workbench-log-{pid}` 的 `summaries[]` | ⚠️ 写入走 sync，读取走 async SQLite，但 updateMemory 耗时几秒，时间差足够 |
| `updateMemory` 角色状态 | 同上 `characterStates[]` | `assembleP3_BookStructure` 读 `getLogStoreV2()` → `getJSONSync(novel-workbench-log-{pid})` | localStorage 直接读 | ✅ 同一路径读写 |
| `activateNextChapterTerms()` (新增) | `setJSONSync(novel-workbench-log-{pid}.termActivity)` → localStorage | `assembleP0` 读 `getLogStoreV2()` → `getJSONSync()` | localStorage 直接读 | ✅ 同一路径读写 |
| `saveContent()` | `setJSONSync(plot-chapters-{pid})` → localStorage | `assembleP1` 读 `getJSONSync(plot-chapters-{pid})` | localStorage 直接读 | ✅ |
| — | `plot-segments-{pid}`（剧情走向，手动创建） | `assembleP1` 读 `getJSONSync(plot-segments-{pid})` | localStorage | ✅ 不参与定稿，手动存在 |
| — | `world_terms`（SQLite 项目表） | `assembleP0` 通过 `api.listWorldTerms()` 读 SQLite | SQLite | ✅ |
| — | `story_bible`（SQLite 项目表） | `assembleP0` 通过 `loadStoryBible()` 读 SQLite | SQLite | ✅ |
| `saveSummary` 的 `key_characters` | `novel-workbench-log-{pid}.summaries[].key_characters` | `assembleP4` 新增参数 `recentSummaries` | 从 `loadRecentSummaries()` 传入 | ✅ |

### 链路中的缺口和修复

| # | 当前问题 | 修复方式 |
|---|---------|---------|
| 1 | `assembleP0` 中 `terms.slice(0,20)` | 改为 `termActivity` 过滤 |
| 2 | `assembleP0` 中 `inviolable_rules` 永远为空 | 删除此代码块 |
| 3 | `assembleP0` 中 `main_stages` 与 P1 重复 | 删除此代码块 |
| 4 | `assembleP4` 无 `recentSummaries` 参数 | 新增参数并按 `key_characters` 过滤 |
| 5 | `assembleP1` 其他卷只有标题 | 改为输出卷概要 + 各章事件（不展开细纲） |
| 6 | `assembleP1` 当前卷不标记当前章位置 | 新增 `← 当前正在写的章` 标记 |
| 7 | 节拍卡片代码块无效 | 删除 |

### 数据流动路线（完整）

```
第 N 章定稿
  │
  ├─ 1. saveContent()
  │     ├─ plot-chapters-{pid}[].content ← 正文
  │
  ├─ 2. updateMemory()
  │     ├─ novel-workbench-log-{pid}.summaries[] ← 摘要 + key_characters + key_locations
  │     ├─ novel-workbench-log-{pid}.characterStates[] ← 角色状态/位置
  │     ├─ novel-workbench-log-{pid}.storylines[] ← 故事线进度
  │     └─ novel-workbench-log-{pid}.foreshadows[] ← 伏笔
  │
  ├─ 3. activateNextChapterTerms()  ★新增
  │     └─ novel-workbench-log-{pid}.termActivity[] ← 词条激活清单
  │
  ├─ 4. createSnapshot()
  └─ 5. aiExtractNewCharacters()

第 N+1 章 AI 写文
  │
  ├─ assembleP0() → world_terms（SQLite）
  │    └─ 过滤：rule 类型全部保留 + termActivity 中 active 的
  │
  ├─ assembleP1() → plot-segments + plot-chapters（localStorage）
  │    ├─ 当前卷：卷概要 + 全部 beats + 标记当前章
  │    ├─ 其他卷：卷概要（不含细纲）
  │    ├─ 暗线
  │    └─ 前5章摘要 → novel-workbench-log-{pid}.summaries
  │
  ├─ assembleP2() → style_guide + voices（SQLite + localStorage）
  │
  ├─ assembleP3() → novel-workbench-log-{pid}（角色状态+故事线+伏笔）
  │
  └─ assembleP4() → characters（SQLite） + summaries（key_characters）
       └─ 过滤：只输出前情摘要中已出场的角色 + 它们之间的关系
```

---

## 十一、改动文件汇总 | 文件 | 改动 |
|--------|------|------|
| ⭐⭐⭐ | `src/lib/context-engine.ts` | P1 当前卷/其他卷、P0 词条筛选、P4 出场角色、P4 调用处、移除节拍卡片 |
| ⭐⭐⭐ | `src/modules/writing/WritingModule.tsx` | 素材优先级、「定稿」追加 activateNextChapterTerms()、移除「生成摘要」 |
| ⭐⭐⭐ | `src/lib/memory-updater.ts` | 摘要字数 200→200-400、新增 activateNextChapterTerms() |
| ⭐⭐⭐ | `src/modules/story-bible/StoryBibleModule.tsx` | 上下文摘要 → 可编辑上下文编辑器 |

## 需要确认的数据结构

| 确认项 | 说明 |
|--------|------|
| beat 字段名 | `beats[].number`、`beats[].title`、`beats[].characters`、`beats[].location`、`beats[].time`、`beats[].event`、`beats[].chapters` |
| Character 类型 | 确认是否有 `first_appearance_chapter` 字段（当前代码用了类型定义可能没声明） |
| `recentSummaries.key_characters` | 摘要中的角色名能与 Character.name 精确匹配 |
| `material-items-*` 结构 | `structureAnalysis`、`content`、`name` 字段确认 |
| `termActivity` 存储路径 | `novel-workbench-log-{pid}.termActivity` 是否与其他字段冲突 |
