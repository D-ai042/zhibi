# AI 模块隔离与角色创建机制

## 背景

AI 聊天面板（AiChatPanel）与写作台（WritingModule）深度集成，AI 可以创建/修改世界观词条、人物角色、剧情走向。但在实际使用中发现以下问题：

---

## 问题 1：AI 跨模块创建词条

### 现象

在世界观模块创建词条后切到人物模块，AI 的历史记忆中包含了 `---WORLD_TERMS---` 格式。当用户在人物模块对话时，AI 可能："学样"输出其他模块的块模板，导致创建了不属于当前模块的数据。

### 方案：物理过滤

不依赖 AI 自觉，纯前端物理阻拦。

```
AI 原始回复：
【自然语言】好的，我创建了 3 个角色...
【---WORLD_TERMS---】[...]  ← 如果当前不在世界观模块，物理删除
【---CHARACTERS---】[...]  ← 只在人物模块才解析
【---PLOT_SEGMENTS---】[...]  ← 只在剧情模块才解析
```

**过滤规则：**
- 保存到 `chatMessages`（历史）时：只保留自然语言，**所有块模板一律删除**
- 解析时：只解析当前模块对应的块，不匹配的直接无视
- 后续对话发给 AI 的历史中只有自然语言信息，**没有块模板格式**，AI 不会学样

### 守卫覆盖

| 块类型 | 当前模块 | 守卫状态 | 写入模式 |
|--------|---------|:--------:|:--------:|
| `---WORLD_TERMS---` 批量 | 世界观 | ✅ `outlineSection === "worldview"` 条件赋值 | ✅ pending 待确认 |
| `worldTermDef` 单条 | 世界观 | ✅ `outlineSection === "worldview"` 包裹 | ✅ pending 待确认 |
| `update_world_term` | 世界观 | ✅ `outlineSection === "worldview"` 包裹 | ❌ 直接写入（单项修改，无需确认） |
| `---WORLD_TERM_UPDATE---` 批量 | 世界观 | ✅ `outlineSection === "worldview"` 包裹 | ✅ 直接更新（按 title 匹配修改） |
| `---CHARACTERS---` | 人物关系 | ✅ `outlineSection === "characters"` 包裹 | ✅ pending 待确认 |
| `---CHARACTER_UPDATE---` | 人物关系 | ✅ 嵌套在 characters 守卫内 | ✅ 直接更新（按 name 匹配修改） |
| `---PLOT_SEGMENTS---` | 剧情走向 | ✅ `outlineSection === "plot-direction"` 包裹 | ✅ 直接写入（段落创建） |

### 物理过滤

`stripOtherModuleBlocks()` 在解析前删除不属于当前模块的块模板：

```
非世界观模块 → 删除 ---WORLD_TERMS---, ---WORLD_TERM_UPDATE---, create_world_term/update_world_term JSON
非人物模块   → 删除 ---CHARACTERS---, ---CHARACTER_UPDATE---
非剧情模块   → 删除 ---PLOT_SEGMENTS---
```

### 历史记录清理

`stripAllBlocks()` 在消息存入历史时删除所有块模板：

```
保存到 chatMessages 的消息内容 = stripAllBlocks(displayContent)
  → 只保留自然语言
  → 所有 ---XXX--- 块被删除
  → AI 下一次看不到格式例子，不会学样
```

---

## 问题 2：AI 写本章自动创建垃圾角色

### 现象

`memory-updater.ts` 用正则 `[\u4e00-\u9fff]{2,4}` 提取正文中的 2-4 字中文片段，出现 ≥2 次就自动 `api.saveCharacter()`。导致"电脑屏幕"、"办公室的"、"三层"等叙事词语被误判为角色。

### 方案：AI 识别 + 用户确认

**彻底删除自动创建逻辑**，改为：

```
AI 写本章
  → 生成正文
  → 更新记忆（摘要/角色状态/伏笔）
  → 异步调用 AI 识别本章新出场角色（aiExtractNewCharacters）
     → AI 用 ---CHARACTERS--- 块返回新角色 + 关系
     → 写入 localStorage（ai-pending-chars-{projectId}）
     → 通知 AiChatPanel
     → 右侧面板出现「待插入星图」卡片
     → 用户点击「应用到星图」确认后才写入
```

**已删除：**
- `extractCharacterNamesFromContent` 中正则匹配 + 频率 ≥ 2 的自动创建
- `updateMemory` 中的 `for (const newName of newCharacterNames)` 自动保存

**新增：**
- `WritingModule.aiExtractNewCharacters()` — 调 AI 分析本章新角色
- `app-store.pendingAiCharsBump` — 跨组件通知
- `AiChatPanel` 监听并合并到 `pendingChars`/`pendingCharEdges`

---

## 问题 3：AI 无法批量修改/更新世界观词条

### 现象

角色卡有 `---CHARACTER_UPDATE---` 块支持 AI 批量更新（种族/外貌/性格等），但世界观词条只有单条 JSON 的 `update_world_term`，不支持批量修改，也不支持改 `term_type`（如地点→规则）。

### 方案：新增 `---WORLD_TERM_UPDATE---` 块

格式与 `---CHARACTER_UPDATE---` 一致：

```
---WORLD_TERM_UPDATE---
[
  {"title":"九霄宗","fields":{"term_type":"faction","one_liner":"修仙界第一宗门","detail":"..."}},
  {"title":"金丹期","fields":{"term_type":"rule","one_liner":"筑基之后的境界","detail":"..."}}
]
---END_WORLD_TERM_UPDATE---
```

可更新的字段：
- `term_type`: rule/faction/place/item/system/other（类型变更）
- `one_liner`: 一句话定义
- `detail`: 详细描述
- `title_new`: 重命名（如改"灵田"→"灵药园"）

### 处理逻辑

```ts
// 仅在世界观模块下执行
if (activeModule === "outline" && outlineSection === "worldview") {
  const updates = parseWorldTermUpdateBatch(aiContent);
  for (const u of updates) {
    const target = terms.find(t => t.title === u.title);
    if (target) {
      // 更新字段 + 类型变更 + 重命名
    }
  }
}
```

---

## 架构原则

1. **物理隔绝 > prompt 约束** — 不依赖 AI 自觉，前端代码直接删除不匹配的块
2. **所有写入/修改必须用户确认** — pending 列表 → 按钮点击确认
3. **AI 感知全部上下文** — 历史中的自然语言信息完整保留，只过滤块模板
4. **统一格式** — 所有模块的创建/更新块都走 `---XXX---` 块 + pending 确认机制

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/layouts/AiChatPanel.tsx` | 物理过滤块模板 + 新增 `parseWorldTermUpdateBatch` + 守卫补全 |
| `src/modules/writing/WritingModule.tsx` | 新增 `aiExtractNewCharacters` 函数 |
| `src/lib/memory-updater.ts` | 删除自动创建角色逻辑 |
| `src/stores/app-store.ts` | 新增 `pendingAiCharsBump` |
