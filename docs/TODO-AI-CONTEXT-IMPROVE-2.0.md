# AI 写文上下文优化 2.0

> 创建时间：2026-06-11

---

## 一、AI 写文完成后移除冗余动作（与"定稿"按钮去重）

**文件**：`src/modules/writing/WritingModule.tsx`  
**函数**：`handleAiWriteChapter`（第 746 行起，AI 返回后的处理在第 830-895 行）

**影响函数**：`handleAiWriteChapter` + 定稿按钮 onClick（第 1284 行起） + `qualityPanel` state（第 82 行起）

### 当前 AI 写完后执行的逻辑

| 步骤 | 动作 | AI 写完 | 定稿按钮 | 结论 |
|------|------|:--:|:--:|------|
| 1 | `pushUndo` + `setEditingContent` + `saveChapters` | ✅ | ❌ | **保留**（写入编辑器必须） |
| 2 | `runQualityCheck`（质量检查） | ✅ | ❌ | **删除**（整个功能移除） |
| 3 | `updateMemory`（摘要 + 角色状态 + 故事线 + 伏笔） | ✅ | ✅ | **删除**（定稿做） |
| 4 | `createSnapshot`（快照） | ✅ | ✅ | **删除**（定稿做） |
| 5 | `aiExtractNewCharacters`（新角色识别） | ✅ | ✅ | **删除**（定稿做） |

### 定稿按钮独有的

| 步骤 | 动作 | AI 写完 | 定稿按钮 |
|------|------|:--:|:--:|
| A | `saveContent` | ❌ | ✅ |
| B | `activateNextChapterTerms` | ❌ | ✅ |

### 改为

AI 写完后的流程极简化：

```
AI 返回正文
  → pushUndo
  → setEditingContent（写入编辑器）
  → saveChapters（更新章节目录）
  → 结束。用户自己看、自己编辑。
```

质量检查（`runQualityCheck`）整块移除，不在 AI 写完后也不在定稿按钮中执行。

用户编辑满意后，点「定稿」按钮统一执行：
```
定稿按钮
  → saveContent
  → updateMemory
  → activateNextChapterTerms
  → activateNextChapterCharacters   ← 🆕 新增
  → createSnapshot
  → aiExtractNewCharacters
```

---

## 1.1 🆕 定稿后 AI 判断下一章角色调度

**文件**：`src/lib/memory-updater.ts` — 新增函数（放在 `activateNextChapterTerms` 之后，第 309 行附近）
**调用位置**：`WritingModule.tsx` 定稿按钮 onClick（第 1284 行起），在 `activateNextChapterTerms` 之后
**依赖**：需要在 `memory-updater.ts` 中导入 `getJSONSync`、`setJSONSync`（从 `./storage`），以及 `api.aiComplete`

### 目的

每一章定稿后，AI 根据上下文（前情摘要 + 当前卷细纲 + 角色名册）判断下一章应该出场哪些角色，写入 `logStore.nextChapterCharacters`。

这样 `assembleP4` 组装角色池时可以直接用这个预测结果，把预测角色放入"活跃角色"层（完整卡），而不是仅仅依赖 `characterStates.last_active_chapter`（只能反映过去，无法预判未来）。

### 逻辑

```typescript
export async function activateNextChapterCharacters(
    projectId: string,
    currentChapterNumber: number,  // 刚定稿的章节号
): Promise<void> {
    const nextChapter = currentChapterNumber + 1;
    
    // 收集上下文
    const [allCharacters, allEdges, summaries, segs, chaps] = await Promise.all([
        api.listCharacters(projectId),
        api.listRelationshipEdges(projectId).catch(() => []),
        api.getChapterSummaries(projectId),
        Promise.resolve(getJSONSync(`plot-segments-${projectId}`, [])),
        Promise.resolve(getJSONSync(`plot-chapters-${projectId}`, [])),
    ]);
    
    // 找到下一章所属的 beat
    const nextChap = chaps.find(c => c.number === nextChapter);
    const nextVol = segs.find(s => s.id === nextChap?.volumeSegmentId);
    const nextBeat = nextVol?.beats?.find(b => {
        const beatChapters = parseChapterRange(b.chapters || "");
        return beatChapters.includes(nextChapter);
    });
    
    const prompt = `
你是小说角色调度助手。根据以下信息，判断第${nextChapter}章应该出场哪些角色。

【角色名册】（共 ${allCharacters.length} 人）
${allCharacters.map(c => `- ${c.name}（${c.faction || "无"}）${c.summary || c.personality || ""}`).join("\n")}

【前情摘要】
${summaries.filter(s => s.chapter_number <= currentChapterNumber).slice(-5).map(s => `第${s.chapter_number}章：${s.summary}`).join("\n")}

【下一章细纲】
${nextBeat ? `#${nextBeat.number}「${nextBeat.title}」角色：${nextBeat.characters}  事件：${nextBeat.event}` : "（未找到对应细纲）"}

请输出 JSON，列出第${nextChapter}章预计出场的角色名（从角色名册中选取，可新增名册外角色）：
---NEXT_CHARS---
["角色名1", "角色名2", ...]
---END---`;

    const res = await api.aiComplete({
        action: "chat", entity_type: "project", entity_id: projectId,
        extra: { system_hint: "你是一个小说角色调度助手。只输出 JSON 数组。", user_message: prompt, history: [], context: "" },
    });
    
    if (!res.content || res.error) return;
    
    const m = res.content.match(/---NEXT_CHARS---\s*([\s\S]*?)\s*---END---/);
    if (!m) return;
    
    const chars: string[] = JSON.parse(m[1]);
    
    // 写入日志库
    const logStore = getLogStoreV2(projectId);
    logStore.nextChapterCharacters = {
        forChapter: nextChapter,
        characterNames: chars,
        updatedAt: new Date().toISOString(),
    };
    setJSONSync(`novel-workbench-log-${projectId}`, logStore);
}
```

### 效果

`assembleP4` 读取角色池时：

```
活跃角色来源：
  1. characterStates 中 last_active_chapter >= 当前章-10  → 过去活跃
  2. beat.characters 中引用的角色                        → 细纲指定
  3. logStore.nextChapterCharacters?.forChapter === 当前章  → 🆕 AI 预测
```

三个来源去重后合并。AI 预测的角色即使前面 50 章没出场，也能在本章拿到完整卡。

---

## 二、P0 世界观词条：上限 20 条 + 只发精简核心

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP0`（第 440 行）

### 当前代码

```typescript
for (const t of filtered) {
    parts.push(`· [${typeLabel[t.term_type]}] ${t.title}：${t.one_liner || ""}`);
}
// 不限制数量，兜底场景 slice(0, 10)
```

### 问题

1. 无硬上限：筛选后可能有 40+ 条
2. 每行格式 `title：one_liner`，`one_liner` 可能很长
3. 仅输出 `one_liner`，没有用到 `detail` 字段（这个是对的，detail 太长）

### 改为

```typescript
const MAX_TERMS = 20;
const MAX_CHARS = 600; // 总中文字数

// 优先级：rule > 当前章激活 > 按 term_type 去重分散
const prioritized = [
    ...filtered.filter(t => t.term_type === "rule"),   // 规则无条件最高优
    ...filtered.filter(t => t.term_type !== "rule"),   // 其余按原筛选
].slice(0, MAX_TERMS);

// 每条精简：title + one_liner 裁剪到 30 中文字
// 累计超 600 字时截断
let charCount = 0;
for (const t of prioritized) {
    const line = `· [${label}] ${t.title}：${(t.one_liner || "").slice(0, 30)}`;
    if (charCount + line.length > MAX_CHARS) {
        parts.push(`...（还有 ${remaining} 条，已省略）`);
        break;
    }
    parts.push(line);
    charCount += line.length;
}
```

### 注意

`one_liner` 是用户写的一句话梗概，**不**发 `detail`（长篇详细设定）。AI 只需要知道"这个词条是什么"，不需要知道全部细节。

---

## 三、P1 当前卷细纲：只发当前 beat 前后 ±3

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP1`（第 524 行起，细纲循环第 548-580 行）

### 当前代码

```typescript
const beats = vol.beats || [];
if (beats.length > 0) {
    parts.push("══════ 本卷所有细纲 ══════");
    for (const b of beats) {  // ← 全部 beats，无论多少条
        // ... 输出每个 beat 的完整信息
    }
}
```

### 问题

- 一卷可能有 50-100 个 beat，全部展开 token 爆炸
- 卷内只有当前章附近的 beat 有参考价值
- 远端的 beat AI 看了也用不上（详见 Lost in the Middle 分析）

### 改为

```typescript
const beats = vol.beats || [];
if (beats.length > 0) {
    // 找到当前 beat 的卷内序号（beat.number 是 1-based 卷内序号）
    const volChaps = chaps.filter(c => c.volumeSegmentId === currentVolId)
        .sort((a, b) => a.number - b.number);
    const currentChap = volChaps.find(c => c.number === currentChapterNumber);
    const currentBeatIdx = currentChap
        ? volChaps.indexOf(currentChap)  // 0-based
        : -1;
    const currentBeatNumber = currentBeatIdx >= 0 ? currentBeatIdx + 1 : 0;
    
    const RANGE = 3;
    const startBeat = Math.max(1, currentBeatNumber - RANGE);
    const endBeat = Math.min(beats.length, currentBeatNumber + RANGE);
    
    parts.push(`══════ 细纲（#${startBeat}-#${endBeat}，共 ${beats.length} 条）══════`);
    
    if (startBeat > 1) parts.push(`...（#1-#${startBeat - 1} 已省略）`);
    
    for (const b of beats) {
        if (b.number < startBeat || b.number > endBeat) continue;
        // ... 输出
    }
    
    if (endBeat < beats.length) parts.push(`...（#${endBeat + 1}-#${beats.length} 已省略）`);
}
```

### 效果

| 场景 | 当前 | 改为 |
|------|------|------|
| 一卷 50 个 beat，当前第 5 章 | 输出 50 条 | 输出 #2-#8（7 条） |
| 一卷 100 个 beat，当前第 50 章 | 输出 100 条 | 输出 #47-#53（7 条） |
| tokens | 可能 5000+ | ~700 |

首章（beat #1）：输出 #1-#4，前面不省略，后面省略。

---

## 四、🐛 紧急修复：beat → chapter 映射错误

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP1`（第 553-556 行）

**⚠️ 同源 Bug**：`memory-updater.ts` 的 `activateNextChapterTerms`（第 323-328 行）使用了完全相同的 `b.number === idxInVol + 1` 错误映射逻辑，需要同步修复。

### Bug

```typescript
const relatedChap = relatedChaps.find((c: any) => {
    const volChaps = relatedChaps.sort((a, b2) => a.number - b2.number);
    const idx = volChaps.indexOf(c);
    return idx >= 0 && (idx + 1) === b.number; // ← bug
});
```

代码假设 `beat.number` = 章节在卷内的排位序号。但 beat 和 chapter 是**一对多**关系（`beat.chapters: "1-3"`），不是一对一。

例：beat#1 管理第 1-3 章，beat#2 管理第 4 章。当遍历 beat#2（`b.number=2`）时，代码找"卷内排第 2 的章节" → 找到了第 2 章，但第 2 章实际属于 beat#1。

**后果**：发给 AI 的细纲中，章节完成标记（✓/🔥当前章）错位，AI 以为当前章在写错误的 beat。

### 修复

改用 `beat.chapters` 字符串匹配 `chapter.number`（全局章节号）：

```typescript
function parseChapterRange(range: string): number[] {
    const nums: number[] = [];
    const parts = range.split(/[,，]/);
    for (const p of parts) {
        const m = p.match(/(\d+)\s*[-−–—]\s*(\d+)/);
        if (m) {
            for (let i = parseInt(m[1]); i <= parseInt(m[2]); i++) nums.push(i);
        } else {
            const n = parseInt(p);
            if (!isNaN(n)) nums.push(n);
        }
    }
    return nums;
}

// 替换原来的匹配逻辑
for (const b of beats) {
    const beatChapters = parseChapterRange(b.chapters || "");
    const beatRelatedChaps = volChaps.filter(c => beatChapters.includes(c.number));
    const isWritten = beatRelatedChaps.length > 0 && beatRelatedChaps.every(c => c.content?.trim());
    const isCurrent = beatRelatedChaps.some(c => c.number === currentChapterNumber);
    // ...
}
```

---

## 五、P2 移除角色语言的独立全量加载

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP2`（第 636 行起，角色语言块第 644-650 行）

### 当前代码

```typescript
try {
    const voices = getJSONSync(`novel-workbench-voices-${projectId}`, null);
    if (voices) {
        if (Array.isArray(voices) && voices.length > 0) {
            parts.push("【角色语言】");
            for (const v of voices) parts.push(`· ${v.char}：${v.voice}`);
        }
    }
} catch { /* ignore */ }
```

### 问题

- 全量无条件加载所有角色的语言风格，不管该角色本章是否出场
- 200 章项目 300 个角色 → 300 条语音风格全量 dump
- 应该按需调度，纳入 P4 角色池的三层体系

### 改为

P2 只保留 `styleGuide` 的三个字段（`narrative_style` / `writing_tone` / `writing_rules`），**删除角色语言的独立全量加载**。

`voice_style` 作为角色的一个字段，随 P4 完整卡一起发送（仅对活跃角色发完整卡时带上）。

---

## 六、P3 全书结构：拆解冗余

**文件**：`src/lib/context-engine.ts`  
**函数**：`assembleP3_BookStructure`（第 678 行起，卷章树第 687-705 行）

**调用处**：`buildProjectContext`（第 369 行），删除后该行改为跳过 P3 组装。

### P3 当前 5 块内容

| 块 | 数据来源 | 用途 | 问题 |
|----|---------|------|------|
| 1. 卷章树 | `plot-chapters` + `plot-segments` | 展示所有卷所有章的状态 | 200 章全量 dump，P1 已覆盖 |
| 2. 写作进度 | `currentChapter` | 显示当前位置 | 1 行，无害 |
| 3. 活跃角色状态 | `logStore.characterStates` | 近 10 章活跃角色的状态/位置 | 与 P4 角色池重叠 |
| 4. 故事线进度 | `logStore.storylines` | 每条故事线进度% | 有用但放这里位置不好 |
| 5. 伏笔提醒 | `logStore.foreshadows` | 待回收的伏笔 | 有用但放这里位置不好 |

### 改为

**删除 P3 整层**，内容重新分配到其他层：

| 内容 | 迁移到 |
|------|--------|
| 写作进度（1 行） | P1 开头 |
| 伏笔提醒 | P1 末尾（紧贴前情摘要之后） |
| 活跃角色状态 | P4（合并到三层调度的完整卡层） |
| 故事线进度 | P1（合并到当前卷信息） |
| 卷章树 | **删除**（P1 已经展示了卷结构+当前细纲范围，不需要再来一遍全量章节列表） |

P3 移除后，层级从 P0-P5 变为 **P0-P4（5 层）**，总数减少。

---

## 七、移除各处的粗暴截断（后续实施）

以下 `slice(0, N)` 改为由 `enforceTokenBudget` 统一管控，不在组装阶段硬截：

| 位置 | 当前 | 改为 |
|------|------|------|
| P5 `chapterContent.slice(0, 3000)` | 硬截 3000 字 | token 预算裁剪 |
| `quality-checker.ts` `slice(0, 4000)` | 硬截 4000 字 | 随质量检查一起移除 |
| `memory-updater.ts` `slice(0, 6000)` | 硬截 6000 字 | 保持（摘要生成需要限制） |
| `aiExtractNewCharacters` `slice(0, 15000)` | 硬截 15000 字 | 保持（新角色识别已足够长） |

---

## 八、P3（新）角色池三层调度

**文件**：`src/lib/context-engine.ts` — 重写 `assembleP4`（第 770 行起）

**调用处**：`buildProjectContext`（第 371 行），P3 删除后 P4 变为 P3，需更新调用处编号。

### 8.1 角色卡新增 `summary` 衍生字段

**文件**：`src/types/index.ts` — `Character` 接口

在 `Character` 接口增加一个**非 UI 暴露**的字段：

```typescript
export interface Character {
  // ... 现有字段保持不变 ...
  /** AI 生成的一句话身份标识，创建/编辑时自动填充，不暴露在 UI */
  summary?: string;
}
```

**生成时机**：创建/编辑角色卡保存时，将角色的核心字段（gender、age、faction、personality、ability、background 等）发给 AI，由 AI 生成一句 ≤ 40 字的核心摘要。

**生成 Prompt**：
```
根据以下角色设定，生成一句 ≤ 40 字的身份摘要。格式："性别 年龄 势力 ｜ 性格+能力关键词"

角色名：叶尘  性别：男  年龄：16  势力：青云宗
性格：坚毅隐忍，寡言少语  能力：天生剑心，御剑术
背景：山村孤儿，被剑老收留

→ AI 输出："男 16岁 青云宗 | 坚毅隐忍 天生剑心 孤儿入道"
```

**调用位置**：
- `mock-backend.ts` 的 `save_character` 分支
- Rust 后端 `save_character` 命令
- `AiChatPanel.tsx` 中 AI 批量创建角色时，同样请求 AI 生成 summary

**用途**：P3 角色池的"名册层"直接用 `summary`，不再每章拼接字段。

### 8.2 角色池三层结构

```
【本章活跃角色】（完整卡，16 字段全量）
  入选条件：logStore.characterStates 中 last_active_chapter >= 当前章-10
           + beat.characters 中引用的角色
  预估：~12 人

【角色关系】
  仅展示"活跃角色"之间的关系（双方都在活跃集合内）
  按 strength 降序，上限 20 条

【角色名册】（全量，仅 summary）
  项目中所有角色，每人一行
  格式：· 叶尘（青云宗）| 上次：第4章
        · 血魔（魔教）| 上次：第50章
        · 天机老人（散修）| 尚未出场
```

### 8.3 数据来源

| 层 | 数据来源 | 查询方式 |
|----|---------|---------|
| 活跃角色 | `allCharacters` + `logStore.characterStates` | `last_active_chapter >= currentNum - 10` |
| 关系 | `allEdges` | 双方都在活跃集合 + 按 strength 降序 + slice(20) |
| 名册 | `allCharacters` 全量 | 直接用 `c.summary`，一行一个 |

### 8.4 首章兜底

第一章 `characterStates` 为空 → 活跃角色取 `weight` 最高的前 5 人。

### 8.5 删掉的逻辑

- ❌ `appearedNames` 从摘要提取 + 正文扫描 → 不再需要
- ❌ `first_appearance_chapter` 字段 → 不再依赖
- ❌ 来源1 + 来源2 的复杂去重逻辑 → 完全移除
- ⚠️ `Character` 接口第 121 行 `first_appearance_chapter?: number` 保留但不再使用
- ⚠️ `Character` 接口第 122 行 `[key: string]: any` 索引签名保留以确保向后兼容

---

## 九、配套类型与预算更新

**文件**：`src/types/index.ts` — `ContextEngineOutput` 接口（第 341 行）

```typescript
// 当前（第 341-351 行）
export interface ContextEngineOutput {
  layers: { p0, p1, p2, p3, p4, p5 };
  // ...
}

// 改为
export interface ContextEngineOutput {
  layers: { p0, p1, p2, p3, p4 };  // P3 删除，原 P4→P3，原 P5→P4
  // ...
}
```

**同步更新 `buildProjectContext` 第 383 行**：`layers: { p0, p1, p2, p3, p4 }`

**文件**：`src/lib/context-engine.ts` — `LAYER_BUDGET` + `LAYER_CULL_ORDER`（第 842-860 行）

```typescript
// 当前
const LAYER_BUDGET = {
    p0: { max: 2_000, fixed: true },
    p1: { max: 15_000, fixed: false },
    p2: { max: 1_000, fixed: false },
    p3: { max: 1_500, fixed: true },   // ← 删除
    p4: { max: 8_000, fixed: false },
    p5: { max: 3_000, fixed: false },   // ← 重编号
};
const LAYER_CULL_ORDER = ["p5", "p4", "p2", "p1"];

// 改为
const LAYER_BUDGET = {
    p0: { max: 2_000, fixed: true },
    p1: { max: 15_000, fixed: false },
    p2: { max: 1_000, fixed: false },
    p3: { max: 8_000, fixed: false },   // 原 P4（角色池）
    p4: { max: 5_000, fixed: false },   // 原 P5（本章正文，增大上限）
};
const LAYER_CULL_ORDER = ["p4", "p3", "p2", "p1"];  // 先裁正文，再裁角色池
```

---

## 十、AiWritingDialog 角色信息对齐

**文件**：`src/components/editor/AiWritingDialog.tsx`（第 140 行字符拼接 + 第 133-152 行上下文加载块）

### 当前代码

```typescript
projectContextStr += `· ${c.name}${c.faction ? `（${c.faction}）` : ""}${c.personality ? `：${c.personality}` : ""}\n`;
// 只有 name + faction + personality 三个字段
```

### 改为

对齐 P3 角色池完整卡的输出格式，补充缺失字段：

```typescript
const fields: string[] = [c.name];
if (c.gender) fields.push(c.gender);
if (c.age) fields.push(`${c.age}岁`);
if (c.faction) fields.push(`【${c.faction}】`);
if (c.personality) fields.push(`性格：${c.personality}`);
if (c.appearance) fields.push(`外貌：${(c.appearance || "").slice(0, 40)}`);
if (c.ability) fields.push(`能力：${(c.ability || "").slice(0, 40)}`);
if (c.voice_style) fields.push(`口吻：${(c.voice_style || "").slice(0, 30)}`);
projectContextStr += `· ${fields.join(" ")}\n`;
```

---

## 十一、buildModuleContext 同步更新

**文件**：`src/lib/context-engine.ts` — `buildModuleContext` 函数

`buildModuleContext` 也调用了 `assembleP0`/`assembleP1`/`assembleP2`/`assembleP3`/`assembleP4`，需同步：

| 改动 | 影响 |
|------|------|
| P1 细纲 ±3 + beat 映射修复 | `writing` 分支调用 `assembleP1` 时自动生效 |
| P2 删除角色语言 | `story-bible` 分支调用 `assembleP2` 时自动生效 |
| P3 删除 | 去掉 `parts.push(p3)`，内容已迁移 |
| P4 改为三层 | `writing` / `characters` 分支调用 `assembleP4` 时自动生效 |
| P5 改为 P4 | `writing` 分支重编号 |

---

## 十二、词条 one_liner UI 校验

**文件**：`src/modules/outline/WorldviewTermNode.tsx` 或词条编辑弹窗

创建/编辑词条时，`one_liner` 输入框限制 30 字：

```typescript
// 输入框属性
maxLength={30}
// placeholder 提示
placeholder="一句话梗概，不超过 30 字"
```

源头控制，确保发给 AI 的 `one_liner` 不会超长。

---

## 十三、移除 quality-checker 残留

**文件**：`src/modules/writing/WritingModule.tsx`

```typescript
// ✂️ 删除这行 import
import { runQualityCheck } from "@/lib/quality-checker";

// ✂️ 删除 handleAiWriteChapter 中的调用块（约第 845-870 行）
// ✂️ 删除 qualityPanel state 相关 JSX（约第 1470-1500 行）
```

**文件**：`src/lib/quality-checker.ts` — 可删除整个文件（或保留备用，仅去 import）

---

## 十四、核心函数 `buildProjectContext` 改动汇总

**文件**：`src/lib/context-engine.ts`  
**函数**：`buildProjectContext`（第 340 行起）

### 改动前（当前代码第 363-395 行）

```typescript
const p0 = assembleP0(projectId, styleGuide, storyBible, allWorldTerms, currentChapter?.number);
const p1 = assembleP1(projectId, recentSummaries, currentChapter?.number);
const p2 = assembleP2(styleGuide, projectId);
const p3 = assembleP3_BookStructure(projectId, currentChapter, volumeName, allCharacters);
const p4 = assembleP4(allCharacters, currentChapter?.number || 1, allEdges, recentSummaries);
// p5 从 plot-chapters 读取...
const layers = { p0, p1, p2, p3, p4, p5: p5 || "" };
// return { layers: { p0, p1, p2, p3, p4, p5 }, ... }
```

### 改动后

```typescript
const logStore = getLogStoreV2(projectId);

// P0: 内部已改（上限 20 条 600 字）
const p0 = assembleP0(projectId, styleGuide, storyBible, allWorldTerms, currentChapter?.number);
// P1: 内部已改（±3 细纲 + beat.chapters 映射）+ 新增参数（伏笔/故事线/进度行来自原 P3）
const p1 = assembleP1(projectId, recentSummaries, logStore, currentChapter?.number, volumeName);
// P2: 内部已改（移除角色语言全量加载）
const p2 = assembleP2(styleGuide, projectId);
// ~~P3~~ 整层删除
// P3: 角色池（原 assembleP4，内部已改：三层调度 + summary）
const p3 = assembleP4(allCharacters, currentChapter?.number || 1, allEdges, logStore);
// P4: 本章正文（原 P5，不再硬截 slice(0,3000)，由 enforceTokenBudget 管控）
let p4 = "";
// ...

const layers: Record<string, string> = { p0, p1, p2, p3, p4: p4 || "" };
return { layers: { p0, p1, p2, p3, p4 }, ... };
```

### 函数签名变化

| 函数 | 当前 | 改为 |
|------|------|------|
| `assembleP1` | `(projectId, summaries, chapterNumber?)` | `(projectId, summaries, logStore, chapterNumber?, volumeName?)` |
| `assembleP4` | `(allChars, chNum, allEdges, summaries)` | `(allChars, chNum, allEdges, logStore)` |
| ~~`assembleP3_BookStructure`~~ | 删除 | — |
