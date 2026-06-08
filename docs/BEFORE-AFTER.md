# 改造前后完整对比文档

> 对照当前代码库 (`f:\Projects\ai-novel-writer`) 与理想目标的逐项差距

---

## 目录

1. [架构总览对比](#1-架构总览对比)
2. [上下文引擎对比](#2-上下文引擎对比)
3. [写作流程对比](#3-写作流程对比)
4. [质量检查对比](#4-质量检查对比)
5. [记忆更新对比](#5-记忆更新对比)
6. [修订感知对比（新增）](#6-修订感知对比新增)
7. [数据层对比](#7-数据层对比)
8. [摆设代码清理清单](#8-摆设代码清理清单)
9. [实施路线图](#9-实施路线图)

---

## 1. 架构总览对比

### 当前

```
创作层 → 7 个独立模块，各自为政
调度层 → 上下文引擎(无感知) + 质量检查器(未接入) + 记忆更新器(硬编码)
数据层 → localStorage 和 API 混用，无统一接口
          无缓存设计
          无版本追踪
总线   → 无依赖图，数据流单向不可逆
```

### 改造后

```
创作层 → 7 模块 + 模块感知上下文
调度层 → 上下文引擎(按模块组装) + 质量检查器(已接入+t=0) + 记忆更新器(动态追踪)
数据层 → 全部走 API 层，localStorage 仅作 mock 回退
          内容哈希缓存(P0/P2/P3)
          章节版本号 + 精确依赖图
总线   → 有向依赖图，支持级联重跑
```

---

## 2. 上下文引擎对比

### 接口

| 维度 | 当前 | 改造后 |
|------|------|--------|
| 函数签名 | `buildChatContext(projectId)` | `buildChatContext(projectId, { module, section?, chapterId?, entityId? })` |
| 模块感知 | 无 | `worldview / characters / plot-direction / writing / story-bible / chat` |
| 写作台 | 不读章节正文 | P5 层携带：正文+节拍+意图 |
| 世界观下 | 全量 dump | 强调词条+编组+连线，弱化角色 |
| 人物下 | 全量 dump | 强调角色卡+关系网，弱化词条 |
| 剧情走向 | 全量 dump | 强调明暗线+节点+时间轴 |

### Token 策略

| 维度 | 当前 | 改造后 |
|------|------|--------|
| 上限 | `MAX_TOKENS = 6_000` | `MAX_TOKENS = 40_000` |
| 裁剪策略 | 从后往前砍段落 | 按层级优先级：P6→P5→P4→P2，P0/P1/P3 不可裁 |
| P0 铁则 | 可被裁 | 固定 1500t，不可裁 |
| P1 前情 | 可能被 P4 挤掉 | 固定 8000t，不可裁 |
| P3 结构 | 不存在 | 固定 1500t，不可裁 |
| 缓存 | 无 | 内容哈希缓存，不变不传 |

### 摘要选择

| 维度 | 当前 | 改造后 |
|------|------|--------|
| 数量 | 硬编码最近 5 章 | 按相关性检索，不限数量 |
| 检索方式 | 无（固定取） | 关键词匹配章节标题/内容 |
| stale 标记 | 无 | 依赖图检测到上游变更时标记 ⚠ |

---

## 3. 写作流程对比

### 当前流程

```
选中章节 → 点击"AI写本章" → AI 返回 → 放入编辑器 → 保存
                  ↓                     ↓
          context-engine              updateMemory()
          (P0-P4 无章节内容)          (硬编码摘要+角色+故事线)
                                           ↓
                                      结束，无质量检查
```

### 改造后流程

```
选中章节 → 点击"AI写本章"
                  ↓
      ① context-engine（模块感知，含本章内容）
                  ↓
      ② AI 写出本章
                  ↓
      ③ 你审阅
                  ↓
      ④ 点击"定稿"
                  ↓
      ⑤ runQualityCheck() ──── ❌ error → 弹窗确认 → 你决定
                  │                             ↓
                  │                         退回/强制继续
                  │
                  ├── ✅ pass → ⑥ updateMemory()
                  │               ├── 生成结构化摘要
                  │               ├── 提取新角色 → 创建草稿卡
                  │               ├── 更新角色状态 → 写回角色库
                  │               ├── 推进故事线 → 写回剧情走向
                  │               ├── 管理伏笔 → 标记已收/新增
                  │               ├── 写入依赖图(dependsOn: ver N)
                  │               └── 刷新全书结构 P3
                  │
                  └── ⑦ 检测是否有前章被修改过
                        ├── 无 → 正常继续
                        └── 有 → 显示横幅 + 提供重跑按钮
```

---

## 4. 质量检查对比

| 维度 | 当前 | 改造后 |
|------|------|--------|
| 是否被调用 | ❌ 从未被调用 | ✅ AI 定稿后自动触发 |
| 圣经合规 | 已实现，未用 | 已接入，error 级弹窗 |
| 角色一致 | 已实现，未用 | 已接入，warning 级 |
| 伏笔回收 | 已实现，未用 | 已接入，warning 级 |
| 版本正确 | 已实现，未用 | 已接入，error 级弹窗 |
| 防 AI 放水 | 无 | 独立 system prompt + temperature=0 |
| 触发方式 | 无 | 定稿自动 + 手动按钮 |
| 弹窗确认 | 无 | ❌ error 时弹出，你确认后才继续 |

---

## 5. 记忆更新对比

| 维度 | 当前 | 改造后 |
|------|------|--------|
| 角色名单 | `KNOWN_CHARACTERS` 硬编码 | 运行时调用 `api.listCharacters()` 动态读取 |
| 故事线 | `knownLines` 硬编码 4 条 | 读取 `plot-segments-{pid}` 用户创建的真实明暗线 |
| 新角色 | 不追踪 | AI 命名实体识别 → 自动创建草稿卡(标记待完善) |
| 角色状态推断 | 纯关键词（受伤/突破/高兴…） | 关键词 + AI 辅助推断 |
| 故事线进度 | 固定 +5% | 匹配真实段落 + AI 主动输出推进信息 |
| 伏笔检测 | 3 条正则 | 关键词 + AI 辅助 + 扩展模式库 |
| 摘要生成 | fallback 截取前 500 字 | AI 结构化摘要：[核心剧情/结尾状态/出场角色/剧情推进] |
| 记忆压缩 | 本地拼接前 3 块前 80 字 | AI 语义压缩（或按 N-gram 关键词聚类） |
| 版本追踪 | 无 | 每条记录标记 `dependsOnChapter + dependsOnVersion` |

---

## 6. 修订感知对比（新增）

| 维度 | 当前 | 改造后 |
|------|------|--------|
| 修改检测 | 无 | 每次保存时对比 version 变化 |
| 依赖图 | 无 | 完整有向图：forward(章→条目) + reverse(条目→章版本) |
| 脏链标记 | 无 | stale/current 状态标记 |
| 级联重跑 | 无 | `rebaseMemory(fromChapter)` 函数 |
| 用户提示 | 无 | 编辑器上方横幅提示 + 受影响条目列表 |
| 重跑范围 | 无 | 从修改章到最后一章，逐章重建 |
| 重跑进度 | 无 | 实时进度回调 (current/total) |
| 自动化程度 | 无 | 手动触发级联（自动提示 + 一键执行） |

### 依赖图数据结构

```typescript
// 新增
interface ChapterVersion {
  chapterId: string;
  version: number;
  updatedAt: string;
}

interface VersionDependency {
  dependantId: string;
  dependsOnChapter: string;
  dependsOnVersion: number;
  status: "current" | "stale";
  kind: "summary" | "character_state" | "storyline" | "foreshadow";
}

// LogStore 扩展
interface LogStore {
  // ... 现有字段
  chapterVersions: Record<string, number>;   // chapterId → version
  dependencies: VersionDependency[];
}
```

### 崩坏链修复验证

```
场景：第50章时修改第10章

改造前：
  改第10章 → (无事发生) → 第51章 AI 收到矛盾摘要 → 故事崩塌

改造后：
  改第10章 → version v₁₀ → v₁₀'
           → 依赖图查到 300+ 条记录依赖第10章
           → 全部标记 stale
           → 第11~50章摘要前加 ⚠
           → 第51章编辑器上方横幅提示
           → 点击重跑 → rebaseMemory(10) → 逐章重建
           → 完成，全书状态一致
```

---

## 7. 数据层对比

| 数据项 | 当前读取方式 | 改造后读取方式 |
|--------|------------|--------------|
| 风格指南 | `localStorage.getItem("novel-workbench-style-{pid}")` | `api.getStyleGuide(projectId)` |
| 故事圣经 | `localStorage.getItem("novel-workbench-bible-{pid}")` | `api.getStoryBible(projectId)` |
| 角色状态 | `localStorage.getItem("novel-workbench-log-{pid}")` | `api.getCharacterStates(projectId)` |
| 章节摘要 | `localStorage.getItem("novel-workbench-log-{pid}")` | `api.getChapterSummaries(projectId)` |
| 世界观词条 | `api.listWorldTerms()` ✅ 已统一 | 不变 |
| 角色 | `api.listCharacters()` ✅ 已统一 | 不变 |
| 关系 | `api.listRelationshipEdges()` ✅ 已统一 | 不变 |
| 章节 | `api.listChapters()` ✅ 已统一 | 不变 |

---

## 8. 摆设代码清理清单

| 文件/代码 | 当前状态 | 处理方式 |
|----------|---------|---------|
| `modules/beats/BeatsModule.tsx` | 完整编辑器，永不渲染 | 移除 |
| `modules/placeholder/Phase2Placeholder.tsx` | 写了无人引用 | 移除 |
| `modules/plot-lines/PlotLinesModule.tsx` | 完整模块，无导航入口 | 确认是否保留，加入口或移除 |
| `modules/plot-timeline/PlotTimelineModule.tsx` | 完整模块，无导航入口 | 确认是否保留，加入口或移除 |
| `components/editor/ChapterEditor.tsx` | TipTap 编辑器，无人引用 | 移除 |
| `app-store.ts → contextCache` | 定义但从未使用 | 移除 |
| `app-store.ts → writingStatus` | 定义但从未使用 | 移除 |
| `app-store.ts → writingIntent` | 定义，`handleAiWriteChapter` 传死了 `undefined` | 移除或真正接入 |
| `app-store.ts → setWritingChapterId` | 写作台自己管理选中章，store 字段无人读 | 移除 |
| `app-store.ts → writingDraft` | AiChatPanel 写入但 WritingModule 不读 | 移除或打通 |
| `AiChatPanel.tsx → sttEnabled = false` | 写死的关闭状态 | 修复 STT 或移除按钮 |
| `AppShell.tsx → api.exportProject()` | 浏览器模式不存在，必然报错 | `api.ts` 增加 `exportProject` |
| `api.ts → 缺少 exportProject` | 功能缺失 | 新增 |
| `CustomModuleRenderer.tsx "刷新"按钮` | 只加消息不自动触发 AI | 改为真正触发 AI 重新生成 |
| `DynamicPageRenderer.tsx` | 导航操控已移除，此模块无输入源 | 确认是否保留 |

---

## 9. 实施路线图

```
Sprint 1（6h）★ 从这里开始
─────────────────────────────────────────────────────────────
  上下文感知 + 质量检查接入
  ├── context-engine.ts: buildChatContext 增加模块参数
  │   ├── module: worldview → 强调词条+编组+连线
  │   ├── module: characters → 强调角色+关系网
  │   ├── module: plot-direction → 强调明暗线+时间轴
  │   ├── module: writing → P0-P4 + 本章正文 + 节拍
  │   ├── module: story-bible → 风格+铁则+版本
  │   └── module: chat(default) → 全量概要(保留当前行为)
  ├── AiChatPanel.tsx: send() 中传入当前模块信息
  ├── WritingModule.tsx: handleAiWriteChapter 末尾调用
  │   runQualityCheck()
  ├── quality-checker.ts: 独立 system prompt + temperature=0
  └── 效果: AI 知道你当前在看什么 + 写完自动把关

Sprint 2（5h）
─────────────────────────────────────────────────────────────
  40K Token + 全书结构
  ├── context-engine.ts: MAX_TOKENS = 40_000
  ├── context-engine.ts: 重写 enforceTokenBudget()
  │   按 P0→P1→P3(fixed) → P6→P5→P4→P2(可裁) 优先级
  ├── context-engine.ts: 新增 assembleP3_BookStructure()
  │   卷章树 + 完成度 + 活跃角色 + 故事线 + 伏笔
  ├── memory-updater.ts: 读取写作台章节数据供 P3 使用
  └── 效果: AI 看到全书结构 + 40K 不浪费

Sprint 3（12h）
─────────────────────────────────────────────────────────────
  记忆自动更新 + 修订感知（方案C）
  ├── memory-updater.ts: 角色追踪动态化
  │   api.listCharacters() → 遍历正文匹配
  ├── memory-updater.ts: 故事线追踪动态化
  │   读取 plot-segments → 匹配正文 → 推进进度
  ├── memory-updater.ts: 新角色自动提取
  │   AI 命名实体识别 → 创建草稿卡(待完善)
  ├── types/index.ts: 新增 ChapterVersion / VersionDependency
  ├── memory-updater.ts: 定稿时写入依赖图
  ├── memory-updater.ts: rebaseMemory(fromChapter) 级联重跑
  ├── WritingModule.tsx: 修订检测 + 横幅提示 + 重跑按钮
  └── 效果: 改前文后系统不崩 + 一键重跑

Sprint 4（5h）
─────────────────────────────────────────────────────────────
  数据层统一 + 缓存 + 清理
  ├── api.ts: 新增 getStyleGuide / getStoryBible / 等
  ├── context-engine.ts: 内容哈希缓存(P0/P2/P3)
  ├── 按清单移除摆设代码
  ├── 修复导出功能
  └── 最终验证
```

---

## 一句话总结

**从 32/100 到目标的路径清晰——4 个 Sprint、28 小时、7 项核心改造。** 每个 Sprint 产出可验证的效果，Sprint 1 做完你就立刻感受到"AI 知道我在看什么了"，Sprint 3 做完系统才真正具备承载百万字反复修订的能力。
