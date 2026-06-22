# 修复文档元审查报告

> 审查对象：`docs/FULL-AUDIT-20260621.md` + `docs/REMEDIATION-PLAN.md`  
> 审查标准：Karpathy 12 准则 + 技术可行性 + 事实准确性  
> 审查日期：2026-06-21
>
> **📝 修订记录**  
> - 2026-06-21 初版  
> - 2026-06-21 二次校对（见 `docs/AUDIT-VERIFICATION-20260621.md`）：本报告对 FULL-AUDIT 的事实性纠正确方向，但部分数量仍偏低。下方标注 `[校对更新]` 的为二次校对后再次修正的数据。

---

## 一、事实性错误

| # | 文档声称 | 实际情况 | 来源 | 严重程度 |
|---|---------|---------|------|----------|
| 1 | storage.ts 导出 16 个函数 | 实际 **12 个**，其中 6 个是死代码（`projectKey`/`get`/`set`/`remove`/`getJSON`/`removeSync` 无外部调用者） | `storage.ts` 全文 + grep 调用链 | 低 |
| 2 | AiChatPanel.tsx 有 2304 行 | 实际 **2431 行**（少报 127 行） | `Get-Content` 行数统计 | 低 |
| 3 | WritingModule.tsx 有 1615 行 | 实际 **1707 行**（少报 92 行） | `Get-Content` 行数统计 | 低 |
| 4 | 需新建 Rust 命令 `list_app_settings` | **已存在**于 `db_cmds.rs:1140`，`get_setting`（行1118）和 `set_setting`（行1130）也已有，均已在 `lib.rs` 注册 | `db_cmds.rs` + `lib.rs` | **高** |
| 5 | 20+ `.ok()` 全改为 `?` 传播 | **不能全部改** — DELETE 清理（9处）和批量 INSERT（9处）需保留容错机制，但应加错误收集 | `db_cmds.rs:1200-1417` 逐行分析 | **高** |
| 6 | `[校对更新]` `getJSONSync` 93 调用点 | 实测 **104 处** 跨 20 文件（本报告偏低 11 处） | 全量 grep `getJSONSync` | 中 |
| 7 | `[校对更新]` `setJSONSync` 42 调用点 | 实测 **50 处** 跨 14 文件（本报告偏低 8 处，不含 .bak） | 全量 grep `setJSONSync` | 中 |
| 8 | `[校对更新]` Rust `.ok()` 20+ | 实测 **44 处**（db_cmds 42 + mod.rs 2） | 全量 grep `.ok\(\)` | 中 |
| 9 | `[校对更新]` 漏报 9 处 `serde_json::to_string().unwrap()` | `db_cmds.rs:468,469,494,553,575,705,780,842,917` | grep `.unwrap\(\)` | 中 |
| 10 | `[校对更新]` 漏报 `reqwest` `multipart` 特性在用 | `ai.rs:205-213` STT 上传使用，REMEDIATION 阶段 2.6 不可删 `multipart` | grep `multipart` | **高** |
| 11 | `[校对更新]` 漏报 `tokio` 用 `full` feature 可精简 | 实际只需 `["rt-multi-thread", "macros"]` | `Cargo.toml` | 低 |
| 12 | `[校对更新]` 漏报 `lib.rs:66` 启动 `.expect()` | `.expect("error while running tauri application")` 启动失败 panic | grep `.expect\(` | 低 |

---

## 二、技术可行性评估

### 2.1 阶段 1：storage.ts 精简 — ⚠️ 有风险

**文档方案**：16 函数 → 2 函数（`loadJSON` / `saveJSON`），同步改异步。

**问题**：
- `getJSONSync` 有 **93 个调用点**分布在 16 个文件中，`setJSONSync` 有 **42 个调用点**分布在 10 个文件中
- 全部从同步改为异步是**高风险改动**：React render 函数中不能直接 await，需改为 useEffect + state 模式，可能导致 UI 闪烁或竞态
- `setJSON`（异步版）仅 4 个调用者（全在 `StoryBibleModule.tsx`），说明代码库**明确偏好同步 API**

**建议修正**：
```
保留同步 API 签名，但修复错误传播：
  export function loadJSON<T>(key: string, defaultVal: T): T   // 同步，内部读 _sqliteCache
  export function saveJSON(key: string, value: unknown): boolean // 同步，写失败返回 false + 触发 Toast

不改异步，避免 135+ 个调用点的连锁修改。
```

### 2.2 阶段 2：Rust 修复 — ✅ 可行（需修正方案）

**文档方案**：所有 `.ok()` 改 `?` 传播。

**问题**：`import_project` 中的 18 个 `.ok()` 分属三类，处理策略应不同：

| 类型 | 数量 | 当前行为 | 正确修复 |
|------|------|---------|---------|
| DELETE 清理（行1200-1208） | 9 | 静默忽略 | 保留 `.ok()`，加 `log::warn!` |
| INSERT OR REPLACE（行1290-1410） | 9 | 静默忽略 | 收集错误到 `Vec<String>`，导入完成后统一报告给前端 |
| CREATE TABLE IF NOT EXISTS（行1429） | 1 | 静默忽略 | 保留 `.ok()`（预期行为） |

**其余修复项可行**：
- 互斥锁 `.unwrap()` → `unwrap_or_else(|e| e.into_inner())` ✅
- `.expect()` → 返回 `Result` ✅
- 百度凭据 URL query → POST body ✅
- 路径遍历验证 ✅
- 清理未使用依赖 ✅

### 2.3 阶段 3：chapter-store.ts — ✅ 可行

- `plot-chapters-{pid}` 被 9 个模块直读，统一入口是正确方向
- 需要旧格式自动迁移逻辑（旧 key → 新格式），文档已考虑
- 唯一风险：迁移过程中如果旧 key 被删除但新格式写入失败，会丢数据。需要事务性保证

### 2.4 阶段 4：快照分片 — ⚠️ 部分可行

**可行部分**：
- `getAllProjectKeys` 改调 Rust `list_app_settings` ✅（命令已存在）
- `restoreSnapshot` 逻辑简单，适配分片不难

**挑战**：
- `createSnapshot` 当前一次性写入整个 `data` 对象到单 key。分片后需要：拆分 data → 写多个 key → 更新索引。如果中间失败，会产生孤儿分片
- `listSnapshots` 需要读索引 + 逐个读分片重组，性能下降
- `SettingsModal.tsx` 的快照管理面板需适配新格式

### 2.5 阶段 5：context-engine 精简 — ✅ 可行

- 无循环依赖，边界清晰
- `assembleContext(pid, chId, mode)` 设计合理
- `typeLabel` 重复 3 次 → 提取常量，机械性改动

### 2.6 阶段 6：WritingModule 拆分 — ⚠️ 有挑战

**可行性验证**：
- ChapterTree（行1088-1231）：依赖清晰，可提取 ✅
- ContextPanel（行1234-1349）：纯展示组件，可提取 ✅
- useChapterSave：依赖 `pushUndo`、`saveChapters`、`bumpSavedChapterVersion`、`_skipNextChapterEffect` ref — 需传递 4+ 个依赖
- useAiWriting：依赖 **10+ 个外部变量**（`pid`、`selectedChapter`、`editingContent`、`buildProjectContext`、`api.aiComplete`、`saveChapters`、`syncEditorHTML`、`pushUndo`、`lastWriteParamsRef`、`aiWritingRef`、`timeoutIdsRef`）

**关键问题**：`useAiWriting` 的依赖过多，直接提取会导致参数列表爆炸。建议：
```
方案A: 创建 WritingContext（React Context），将共享状态放入
方案B: 将共同依赖放入 useChapterSave 返回值，useAiWriting 接收
方案C: 保持 useAiWriting 在 WritingModule 内部，只提取纯逻辑部分
```

### 2.7 阶段 7：AiChatPanel 拆分 — ⚠️ 有挑战

**关键依赖问题**：
- `send()` 函数（行1172-1179）在发送新消息时**清空所有 pending chars 状态**
- `parseCharacterBatch` 在 `send()` 内被调用，直接 `setPendingChars()`
- `handleCharacterInsert`（行709-860，152行）调用 `appendChatMessages` 发送系统消息

这是**双向依赖**：chat 产生 pending chars，pending chars 操作回调 chat。需要 store/context 中介来打破。

### 2.8 阶段 8-10 — ✅ 可行

- 阶段 8：11 处 `localStorage` 裸调用 → `loadJSON`/`saveJSON`，机械性替换
- 阶段 9：SettingsModal 拆分为 4 个标签组件，边界清晰
- 阶段 10：见下方 Rule 2 评估

---

## 三、12 准则合规性评估

### Rule 1: 先思考再编码 — ✅ 通过

- 有清晰的依赖链分析（模块依赖关系图）
- 每阶段有影响范围表
- 有回滚方案（附录 B）

### Rule 2: 简单优先 — ⚠️ 部分通过

**问题 1**：阶段 10 的兼容导出层是过度设计：
```typescript
// 文档提议
export const useAppStore = () => ({
    ...useProjectStore(),
    ...useUiStore(),
    ...useChatStore(),
    ...useWritingStore(),
});
```
每次调用 `useAppStore()` 都会订阅 4 个 store 的**所有字段**变化，导致不必要的重渲染。正确做法是直接改 18 个调用文件使用具体 store。

**问题 2**：阶段 1 同步改异步引入了不必要的复杂度。保留同步 API 修复错误传播更简单。

### Rule 3: 外科手术式改动 — ✅ 通过

每阶段只改一个模块，改动范围明确，不碰无关代码。

### Rule 4: 目标驱动执行 — ✅ 通过

每阶段有：
- 明确的验证标准（checkbox 清单）
- 回滚命令
- 影响范围表

### Rule 5: 模型仅用于判断 — ✅ 通过

修复方案不涉及 AI 逻辑，纯工程改动。

### Rule 6: Token 预算 — ✅ 通过

文档结构化良好，可快速定位每个阶段。

### Rule 7: 暴露冲突 — ❌ 不通过

**文档自身暴露了冲突但未解决**：

| 冲突 | 文档位置 | 未解决的问题 |
|------|---------|-------------|
| 同步 vs 异步 API | 阶段 1 | 93 个同步调用点改异步的风险未评估 |
| `.ok()` 容错 vs 严格错误 | 阶段 2 | "全部改 `?"` 会破坏导入功能，但文档未区分 |
| 兼容导出层 vs 直接修改 | 阶段 10 | 兼容层的性能影响（重渲染）未评估 |

### Rule 8: 先读后写 — ⚠️ 部分通过

- 对 `storage.ts`、`WritingModule.tsx`、`db_cmds.rs` 的验证充分
- 但对 `AiChatPanel.tsx` 的行数核实不足（少报 127 行）
- 未验证 `list_app_settings` 等 Rust 命令是否已存在

### Rule 9: 测试验证意图 — ❌ 不通过

**最严重的问题**：10 个阶段的重构计划中，自动化测试被放在 P2（最后）。这意味着：
- 6,000+ 行前端代码 + 2,200+ 行 Rust 代码将在**零自动化测试**的情况下进行大规模重构
- 每阶段只有手动测试清单，无法防止回归
- 阶段 3-10 的改动涉及 18+ 个文件的 import 替换，手动测试覆盖率必然不足

**建议**：在阶段 1 之前增加"阶段 0"——为核心逻辑建立最小测试覆盖：
```
阶段 0: 测试基础设施
  - 添加 vitest + @testing-library/react
  - 为 storage.ts 写 3 个测试（读/写/失败）
  - 为 chapter-store.ts 写 5 个测试（CRUD + 迁移）
  - 为 context-engine 的 estimateTokens 写 1 个测试
  - 总计约 10 个测试，耗时 < 1 天
```

### Rule 10: 检查点 — ✅ 通过

每阶段有验证标准和回滚方案，附录 B 提供了精确的 git checkout 命令。

### Rule 11: 匹配惯例 — ⚠️ 部分通过

**问题**：阶段 1 将同步 API 改为异步是**惯例变更**。当前代码库 93+ 个调用点使用同步模式，改为异步意味着：
- React 组件中不能在 render/事件处理中直接调用
- 需要改为 `useEffect` + `useState` 模式或 `Suspense`
- 这是全代码库的风格变更，不仅仅是 API 变更

### Rule 12: 失败要大声 — ⚠️ 部分通过

- 文档提议了 `reportDiagnostic()` 函数（阶段 4.4），但**没有定义其实现**
- 如果 `reportDiagnostic()` 本身实现不当（比如写入失败的 localStorage），会成为新的静默失败点
- 阶段 1 的 `saveJSON` 返回 `{ ok: boolean; error?: string }` 是好设计，但需要确保所有 42 个 `setJSONSync` 调用点都检查返回值

---

## 四、综合评定

| 维度 | 评定 | 说明 |
|------|------|------|
| 事实准确性 | ⚠️ 85% | 5 处不准确，其中 2 处高严重度（Rust 命令已存在、`.ok()` 不能全改） |
| 技术可行性 | ⚠️ 75% | 阶段 1 同步改异步、阶段 10 兼容导出层有性能风险 |
| 12 准则合规 | ⚠️ 8/12 通过 | Rule 7（暴露冲突）和 Rule 9（测试）是主要缺失 |
| 可执行性 | ✅ 90% | 依赖链清晰、分阶段合理、有回滚方案 |

> `[校对更新]` 二次校对后修订：事实准确性 **78%**（本报告自身又有 7 处数量偏低/漏报，见第一节新增 6-12 项）；技术可行性维持 75%；可执行性下调至 **85%**（阶段 1 别名设计、阶段 2 multipart 误删、阶段 8 工作量低估三处影响执行）。

---

## 五、修正建议汇总

| 优先级 | 建议 | 影响阶段 |
|--------|------|---------|
| **P0** | 阶段 2 的 `.ok()` 修复分三类处理，不能全改 `?` | 阶段 2 |
| **P0** | 新增"阶段 0"：建立最小测试基础设施 | 阶段 1 之前 |
| **P1** | 阶段 1 保留同步 API，只修复错误传播 | 阶段 1 |
| **P1** | 阶段 10 改为直接修改 18 个调用文件，不用兼容导出层 | 阶段 10 |
| **P1** | 阶段 6 的 `useAiWriting` 用 WritingContext 中介 | 阶段 6 |
| **P2** | 更新行数数据：AiChatPanel 2431 行、WritingModule 1707 行 | 全文 |
| **P2** | 移除"需新建 Rust 命令"的描述（已存在） | 阶段 4 |
| **P2** | 定义 `reportDiagnostic()` 的具体实现 | 阶段 4 |
| **P0** `[校对更新]` | 阶段 2 不可删 `reqwest` 的 `multipart` 特性（STT 在用），只删 `stream` | 阶段 2 |
| **P0** `[校对更新]` | 阶段 1 废弃别名 `setJSONSync` 应返回 `void` 并内部自检，避免 50 个调用点静默丢错 | 阶段 1 |
| **P1** `[校对更新]` | 阶段 2 补处理 9 处 `to_string().unwrap()` + 互斥锁另 2 处（mod.rs:61,70）+ lib.rs:66 `.expect()` | 阶段 2 |
| **P1** `[校对更新]` | 阶段 8 扩范围至 lib 层（backup 12 + mock-backend 17），总 93 处非 17 处 | 阶段 8 |
| **P2** `[校对更新]` | 阶段 2 顺带精简 `tokio` feature：`full` → `["rt-multi-thread", "macros"]` | 阶段 2 |
| **P2** `[校对更新]` | S14（`as any` 治理）扩至 18 文件 126 处，非 2 文件 30+ 处 | 阶段 5 |
