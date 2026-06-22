# 执笔 (Zhibi) 完整审计报告

> 审计日期：2026-06-21  
> 项目：ai-novel-writer v0.3.6  
> 技术栈：Tauri 2 + React 18 + TypeScript + Zustand + TipTap + SQLite  
> 交付目标：Windows EXE  
> 审查标准：12 准则 (by Claude) + 功能 Bug 排查
>
> **📝 修订记录**  
> - 2026-06-21 初版  
> - 2026-06-21 二次校对（见 `docs/AUDIT-VERIFICATION-20260621.md`）：修正行数、补全漏报项、校正数量统计。本文中标注 `[校对更新]` 的部分为二次校对后修正的内容。

---

## 一、12 准则评分总览

| 准则 | 评定 | 严重度 |
|------|------|--------|
| Rule 1: 先思考再编码 | ⚠️ 部分通过 | 中 |
| Rule 2: 简单优先 | ❌ 不通过 | **高** |
| Rule 3: 外科手术式改动 | ❌ 不通过 | 高 |
| Rule 4: 目标驱动执行 | ✅ 通过 | — |
| Rule 5: 模型仅用于判断 | ✅ 通过 | — |
| Rule 6: Token 预算 | ⚠️ 部分通过 | 中 |
| Rule 7: 暴露冲突 | ❌ 不通过 | 高 |
| Rule 8: 先读后写 | ❌ 不通过 | 高 |
| Rule 9: 测试验证意图 | ❌ 不通过 | **严重** |
| Rule 10: 检查点 | ✅ 通过 | — |
| Rule 11: 匹配惯例 | ❌ 不通过 | 中 |
| Rule 12: 失败要大声 | ❌ 不通过 | **严重** |

**统计：** 3 ✅ / 2 ⚠️ / 7 ❌

---

## 二、Bug 清单

### B1. 章节内容丢失 🔴 致命

**现象**：前 25 章正常，第 26 章起保存/定稿后关闭再打开，内容变为空。显示"✅ 已保存"但数据未写入磁盘。

**根因**：`src/lib/storage.ts:121-126` — `setSync` 写入失败（配额溢出）时只打 `console.warn`，不抛异常。`saveContent` 收不到错误，显示"已保存"。

**涉及文件**：`src/lib/storage.ts`、`src/modules/writing/WritingModule.tsx`

---

### B2. 快照和备份在 EXE 下数据不完整 🔴 致命

**现象**：创建的快照和备份可能为空或残缺，恢复后数据不全。

**根因**：`createSnapshot` / `createBackup` 共用 `getAllProjectKeys`（`backup.ts:12-40`），该函数只遍历 WebView `localStorage`，不知道 SQLite `app_settings` 表的数据。EXE 下真实数据在 SQLite。

**涉及文件**：`src/lib/backup.ts`、`src/lib/memory-updater.ts`

---

### B3. 快照全量塞一个 key 导致存储膨胀 🔴 致命

**现象**：多个快照后单个 key 越来越大，加速触发配额上限。

**根因**：`createSnapshot`（`memory-updater.ts:649-668`）把全部快照（含完整项目数据）存入同一个 `novel-snapshots-{pid}` key。

**涉及文件**：`src/lib/memory-updater.ts`

---

### B4. 静默吞异常 🔴 致命

**现象**：EXE 下无控制台，`console.error` 和 `catch { /* ignore */ }` 全不可见。

> `[校对更新]` 经全量 grep 实测，前端静默 `catch {}` 共 **119 处** 跨 24 文件（初版估"50+"偏低 2.4 倍）；Rust `.ok()` 共 **44 处**（db_cmds 42 + mod.rs 2，初版估"20+"偏低）。

**分布（实测）**：
- `StoryBibleModule.tsx`: 22 处 `catch {}`
- `AiChatPanel.tsx`: 19 处
- `context-engine.ts`: 13 处
- `memory-updater.ts`: 11 处
- `mock-backend.ts`: 11 处
- `WritingModule.tsx`: 11 处
- `app-store.ts`: 4 处
- `SettingsModal.tsx`: 5 处
- `storage.ts`: 3 处
- 其余 15 文件：合计 30 处
- Rust `db_cmds.rs`: 42 处 `.ok()` 静默吞
- Rust `db/mod.rs`: 2 处 `.ok()`

---

### B5. Rust 端严重问题 🔴 致命

| 问题 | 位置 | 后果 |
|------|------|------|
| 导入路径 20+ `.ok()` 静默吞 | `db_cmds.rs:1200-1410` | 导入"成功"但数据丢失 |
| 互斥锁中毒崩溃 | `db_cmds.rs:211` | `.unwrap()` 将崩溃整个应用 |
| `[校对更新]` 互斥锁 `.unwrap()` 另有 2 处 | `db/mod.rs:61`、`db/mod.rs:70` | 同上，`with_conn`/`open_project_db` 均未处理中毒锁 |
| `.expect()` 崩溃 | `db/mod.rs:71` | 项目打开前调用任何命令崩溃 |
| `[校对更新]` 9 处 `serde_json::to_string().unwrap()` | `db_cmds.rs:468,469,494,553,575,705,780,842,917` | 序列化失败将 panic（实际不会失败但属同类风险） |
| `[校对更新]` Tauri 启动 `.expect()` | `lib.rs:66` | 启动失败 panic，无友好提示 |
| API 凭据泄露 | `ai.rs:162` | 百度密钥通过 URL 查询字符串传递 |
| 路径遍历风险 | `export.rs:43-49` | 文件写入路径无验证 |

> `[校对更新]` 初版仅列 5 项，二次校对补充互斥锁额外 2 处、`to_string().unwrap()` 9 处、`lib.rs` 启动 `.expect()` 1 处。Rust 静默 `.ok()` 实测 44 处（见 B4）。

---

## 三、设计缺陷

### D1. 角色概要 `summary` 全链路缺失 🟡 高

类型有定义但 Rust DB 无列、结构体无字段、创建/编辑时不生成。

**涉及文件**：`src/types/index.ts`、`src-tauri/src/db/schema.sql`、`src-tauri/src/commands/db_cmds.rs`、`src/lib/memory-updater.ts`、`src/lib/context-engine.ts`

---

### D2. 快照匹配用"最大年龄"而非剧情判断 🟡 中

`context-engine.ts:803` — 活跃角色完整卡永远取 `age` 最大的快照，不管当前章节时间线。

---

### D3. 两条上下文路径不一致 🟡 中

写作台面板 `loadContextPanelData`（给人看）和 AI 写作 `buildProjectContext`（给 AI）是两套独立代码。

**涉及文件**：`src/modules/writing/WritingModule.tsx`、`src/lib/context-engine.ts`

---

### D4. `saveChapters` 每次全量写入 🟡 中

每次保存一章把全部章节重写一遍。30 章 = 32 次写入（逐章 + 索引 + 聚合缓存）。

**涉及文件**：`src/modules/writing/WritingModule.tsx`

---

### D5. 未使用的 Rust 依赖 🟢 低

`futures-util`、`keyring`、`dirs` 未使用；`reqwest` 的 `stream` 特性未使用。

> `[校对更新]` 注意：`reqwest` 的 **`multipart` 特性实际在使用**（`ai.rs:205-213` STT 音频上传 `reqwest::multipart::Form`），**不可删除**，只能删 `stream`。  
> 另漏报：`tokio` 使用 `full` feature，实际只需 `["rt-multi-thread", "macros"]`，可精简二进制体积。

---

## 四、Rule 2 深挖：简单优先（不通过）

> "最少代码解决问题。不做推测性功能。不为一次性的东西建抽象。"

### 4.1 God Files（巨型文件）

| 文件 | 行数 | 职责数 |
|------|------|--------|
| `AiChatPanel.tsx` | 2304 | 聊天+角色创建+快照+上下文+pending |
| `WritingModule.tsx` | 1615 | 树+编辑器+AI写作+润色+面板+保存+定稿+撤销+草稿+修订+重跑 |
| `db_cmds.rs` | 1517 | 全部CRUD+配置+导入导出 |
| `SettingsModal.tsx` | 1192 | API+STT+快照+迁移+关于 |
| `CharactersModule.tsx` | 983 | 节点+边+编组+撤销+快照编辑 |
| `context-engine.ts` | 897 | 6种模块上下文+P0-P4+Token预算 |

> `[校对更新]` 行数二次校对（raw-split 实测，含末行换行）：AiChatPanel **2432**、WritingModule **1708**、db_cmds **1518**、SettingsModal 1192、CharactersModule 983、context-engine 897。`storage.ts` 实测 146 行（非 199）。初版使用 `Measure-Object` 少算最后一行。

### 4.2 God Store

`app-store.ts` — 单一 Zustand store，**60+ 字段**，被 **18 个文件** 依赖：
- 项目管理 / 导航 / UI抽屉 / AI状态 / 聊天消息 / 写作状态 / 9个 bump 计数器

> `[校对更新]` 实测 `useAppStore` / `app-store` 被引用 **27 个文件**（不含 .bak），初版 18 偏低。

### 4.3 复杂函数

| 函数 | 行数 |
|------|------|
| `import_project` (`db_cmds.rs:1178`) | 239 |
| `WritingModule` 定稿 handler | 112 |
| `assembleP3` (`context-engine.ts:740`) | 135 |
| `assembleP1` (`context-engine.ts:572`) | 127 |
| `assembleP0` (`context-engine.ts:440`) | 111 |
| `loadChat` (`app-store.ts:234`) | 90 |

### 4.4 存储层过度设计

`storage.ts`（199 行）导出 **16 个函数**：
```
projectKey / prewarmFromSqlite / get / set / remove
/ getSync / setSync / removeSync / getJSON / setJSON
/ getJSONSync / setJSONSync / ...

原因："同步/异步"两套+"EXE/浏览器"两套+_sqliteCache
实际：EXE 交付只需要 2 个（loadJSON / saveJSON）
```

> `[校对更新]` 实测 `storage.ts` 共 **146 行**（非 199），导出 **12 个函数**（非 16）。其中 6 个为死代码：`projectKey` / `get` / `set` / `remove` / `getJSON` / `removeSync` 无外部调用者。高频使用：`getJSONSync`（**104 处**跨 20 文件）、`setJSONSync`（**50 处**跨 14 文件，不含 .bak）。

### 4.5 冗余：同一数据写 3 份

```typescript
// WritingModule.tsx:50-58
setJSONSync(`chapter-{pid}-{id}`, ch)     // ① 逐章
setJSONSync(`chapter-index-{pid}`, ids)   // ② 索引
setJSONSync(`plot-chapters-{pid}`, chs)   // ③ 全量冗余
```

### 4.6 重复代码

| 重复项 | 位置 |
|--------|------|
| `parseChapterRange` | `memory-updater.ts:28` & `context-engine.ts:556` — 14 行完全相同 |
| `estimateTokens` | `context-engine.ts:64` & `memory-engine.ts:23` |
| `loadStoryBible` / `loadStyleGuide` / `loadRecentSummaries` | `context-engine.ts` & `quality-checker.ts` |
| `POLISH_RULES` / `ACTION_PROMPT.polish` | `WritingModule.tsx` & `AiWritingDialog.tsx` |
| `AI_MODELS` / `MODEL_TO_PROVIDER` | `AppShell.tsx` & `model-config.ts` — 需手动同步 |
| `handleExport` / `handleExportAll` | `AppShell.tsx` — 共享 ~80% 代码 |
| `typeLabel` Record | `context-engine.ts` 内定义 3 次（行111、266、493） |

### 4.7 `as any` 类型逃逸 30+ 处

`context-engine.ts`: 20+ / `memory-updater.ts`: 10+

> `[校对更新]` 实测 `as any` 共 **126 处** 跨 18 文件（初版 30+ 偏低 4 倍）。分布：mock-backend 20、context-engine 16、WorldviewPanel 14、CharactersModule 13、SettingsModal 12、WritingModule 8、AppShell 4、use-project-data 5、AiChatPanel 6、app-store 3、memory-updater 9、PlotStoryNode 4、useUndoRedo 2、AiWriteChapterDialog 2、PlotDirectionPanel 2、StoryBible 4、quality-checker 1、AiWritingDialog 1。

### 4.8 推测性功能

`model-config.ts` 定义了 GPT-5.5、Claude Opus 4.8 等不存在的模型名称。

---

## 五、Rule 8 深挖：紧耦合（不通过）

> "先读再写。'看起来正交'很危险。"

### 5.1 数据键域所有权矩阵

| 键 | 拥有者 | 越权访问者 | 数量 |
|----|--------|-----------|------|
| `plot-chapters-{pid}` | `writing` | AiChatPanel / Settings / context-engine / story-bible / WritingStats / use-project-data / mock-backend / migrate-data / Rust export | **9** |
| `plot-segments-{pid}` | `outline` | writing / story-bible / context-engine / WritingStats / AppShell | **5** |
| `novel-workbench-log-{pid}` | `memory-updater` | writing / context-engine / quality-checker / mock-backend | **4** |
| `novel-workbench-mock` | `mock-backend` | story-bible / AiChatPanel / Characters / Settings | **4** |
| `novel-snapshots-{pid}` | `memory-updater` | Settings / backup | **2** |
| `ai-pending-chars-{pid}` | `AiChatPanel` | writing | **1** |
| `novel-workbench-bible-{pid}` | `story-bible` | context-engine | **1** |

**仅 4 个键域独占**（style / bible / versions / voices，全在 story-bible 内）。

> 12 个键域中 8 个被跨模块裸读。任意一处格式变更 = 其余静默崩溃。

### 5.2 `localStorage` 裸调用绕过存储封装

| 文件 | 数量 | 位置 |
|------|------|------|
| `StoryBibleModule.tsx` | **11 处** | 53,56,112,119,135,220,227,406,412,423,642 |
| `AiChatPanel.tsx` | 3 处 | 531,830,947 |
| `AppShell.tsx` | 1 处 | 329 |
| `OutlineModule.tsx` | 1 处 | 20 |
| `InspirationPanel.tsx` | 1 处 | 17 |

EXE 下这些调用**只能看到 WebView 缓存**，看不见 SQLite。

> `[校对更新]` 全量 grep 实测共 **93 处** 跨 16 文件（初版 ~17 处偏低 5.5 倍）。初版只统计 UI 组件层，漏算 lib 层：`backup.ts` 12、`mock-backend.ts` 17、`storage.ts` 11（自身实现）、`version-check.ts` 3、`migrate-data.ts` 3、`memory-updater.ts` 1。StoryBible 实测 **16 处**（非 11，第 642 行单行内含 7 次 `localStorage.getItem` + 1 次 setItem），是 EXE 下数据丢失重灾区。

### 5.3 耦合热力图

| 模块 | 被引用 | 引 lib 数 | 共享键数 | 耦合度 |
|------|--------|----------|---------|--------|
| `api.ts` | 16 | 0 | — | 🔴 最高 |
| `app-store` | 18 | 1 | — | 🔴 最高 |
| `storage.ts` | 8+14 bypass | 1 | — | 🔴 最高 |
| `modules/writing` | 1 | **7** | **8** | 🔴 最高 |
| `layouts/AiChatPanel` | 0 | **6** | **4** | 🟡 高 |
| `modules/story-bible` | 0 | 1+11 bypass | **3** | 🟡 高 |

> `[校对更新]` 实测：`api.ts` 被引用 **21 文件**（初版 16 偏低）；`app-store` 被引用 **27 文件**（初版 18 偏低）；`storage.ts` getJSONSync 104 处 + setJSONSync 50 处，bypass（裸 localStorage）实际 93 处跨 16 文件。

### 5.4 冲突模式共存

| 冲突 | 详情 |
|------|------|
| 存储访问 | 3 种模式：原始 `localStorage` / `getJSONSync` / `useAppStore` |
| 错误处理 | 4 种风格：`catch {}` / `console.error` / `alert()` / Toast |
| 撤销重做 | 2 种实现：ref-based 栈 / `useUndoRedo` hook |
| 导出逻辑 | 2 份代码共享 ~80% |

---

## 六、Rule 3 违规：关注点混合

| 问题 | 位置 |
|------|------|
| `aiExtractNewCharacters`（角色服务）嵌入 UI 组件 | `WritingModule.tsx:110-210` |
| `POLISH_RULES` / `HUMANIZER_RULES`（提示词常量）在 UI 组件中 | `WritingModule.tsx:733-784` |
| `detectStaleAhead`（纯逻辑）在 UI 组件中 | `WritingModule.tsx:81-104` |
| 定稿按钮执行 8 个不相关操作 | `WritingModule.tsx:1441-1553` |
| 运行时常量在类型文件中 | `types/index.ts:398-427` |

---

## 七、Rule 12 违规：沉默失败（最严重）

### 前端静默

`context-engine.ts`: ~11 处 `catch { /* ignore */ }`  
`app-store.ts`: ~5 处  
`WritingModule.tsx`: ~5 处  
`AppShell.tsx`: ~3 处

### Rust 静默

`db_cmds.rs:1200-1410`: 20+ `.ok()` 静默吞导入错误 — 用户收到成功、数据丢失  
`ai.rs:130-131`: API JSON 异常静默返回空字符串

> `[校对更新]` 见 B4 实测数据：前端静默 `catch {}` 共 **119 处** 跨 24 文件（初版 ~24 处偏低 5 倍）；Rust `.ok()` 共 **44 处**（初版 20+ 偏低）。最严重者为 `StoryBibleModule.tsx` 22 处、`AiChatPanel.tsx` 19 处。

---

## 八、Rule 9 违规：零测试覆盖

| 检查项 | 结果 |
|--------|------|
| `*.test.ts` / `*.test.tsx` | 无 |
| jest / vitest 配置 | 无 |
| package.json test 脚本 | 无 |
| 测试依赖 | 无 |

6,000+ 行前端 + 2,200+ 行 Rust — 零自动化验证。

---

## 九、新需求

### N1. 诊断与自修复系统
EXE 下用户可见：中文错误 + 操作按钮 + 系统健康页 + 导出诊断报告。

### N2. 通用错误兜底管道
所有异常汇入统一收集器 → 分类翻译 → 已知错误友好提示 / 未知错误通用模板。

### N3. 写后验证
`saveChapters` 写完立即读回比对，不一致 → 记录 + 告警。

### N4. 启动时完整性检查
扫描：index vs 实际数据、JSON 可解析性、孤儿数据、存储用量。

### N5. 操作上下文快照
每次关键操作记录结构化日志（sessionId + operationId + steps）。

### N6. 动态日志级别
ERROR/WARN/INFO 默认开，DEBUG/TRACE 设置页开关。

---

## 十、统一重构路线图

### 🔴 P0：必须修（数据完整性 + 安全）

| # | 内容 | 涉及文件 |
|---|------|----------|
| S1 | `setSync` 写入失败不静默，返回 boolean + 用户可见告警 | `storage.ts`、所有调用方 |
| S2 | 每个数据键域只一个模块拥有，导出函数给他人用 | `writing` 导出 `loadAllChapters` 等 |
| S3 | `StoryBibleModule` 11 处 `localStorage` → `loadJSON/saveJSON` | `StoryBibleModule.tsx` |
| S4 | Rust 导入路径 20+ `.ok()` → `?` 传播或收集错误列表 | `db_cmds.rs` |
| S5 | Rust 互斥锁 `.unwrap()` / `.expect()` → `Result` 妥善处理 | `db_cmds.rs`、`db/mod.rs` |
| S6 | API 凭据泄露修复 + 路径遍历验证 | `ai.rs`、`export.rs` |
| S7 | 删除 `plot-chapters-{pid}` 全量聚合缓存 | `WritingModule`、8 个读取者 |
| S8 | 精简 `storage.ts` 16 → 2 | `storage.ts` |

### 🟡 P1：应该修（可维护性）

| # | 内容 |
|---|------|
| S9 | 删除 `parseChapterRange` / `estimateTokens` 等重复代码 |
| S10 | 合并两套上下文组装器 |
| S11 | 拆分 `WritingModule.tsx`（分离 ChapterTree / ContextPanel / useFinalize） |
| S12 | 拆分 `AiChatPanel.tsx`（分离角色创建 / pending chars） |
| S13 | 拆分 `db_cmds.rs`（分离 config / project / characters / world / export） |
| S14 | `as any` → 接口定义 |
| S15 | 统一错误处理为 Toast 通知，消除 `catch { /* ignore */ }` |

### 🟢 P2：长远治理

| # | 内容 |
|---|------|
| S16 | 拆分全局 store（project / ui / chat / writing） |
| S17 | 删除 `mock-backend.ts`（EXE 不需要） |
| S18 | 清理未使用 Rust 依赖 |
| S19 | 从 `types/index.ts` 移除运行时常量 → `lib/constants.ts` |
| S20 | 建立测试基础设施（vitest + @testing-library/react） |
| S21 | 实现诊断系统 UI（系统健康页 + 错误日志页） |

---

## 十一、模块架构图（当前）

```
                    ┌─────────────┐
                    │  app-store  │ ← God Object
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  layouts/   │ │  modules/   │ │ components/ │
    │  AiChatPanel│ │  writing    │ │  Settings   │
    │  (2304行)   │ │  (1615行)   │ │  (1192行)   │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
    ┌──────▼───────────────▼───────────────▼──────┐
    │                 lib/                         │
    │  api ← storage ← context-engine             │
    │       ← memory-updater ← quality-checker    │
    │       ← backup ← mock-backend ← migrate      │
    └──────────────────┬──────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  Rust    │ │localStorage││  SQLite  │
    │  Tauri   │ │ (WebView) ││ (真实存储)│
    └──────────┘ └──────────┘ └──────────┘

核心问题：
· 所有模块直读共享键，无所有权边界
· 14+ bypass 直接调 localStorage → EXE 下读不到 SQLite
· 5 个 God Files (900-2304 行)
· mock-backend.ts 在 EXE 下完全无用
· app-store 被 18 个文件依赖
· 零测试覆盖
