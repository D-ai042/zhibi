# 修复方案文档 — 按功能模块拆分

> 基准审计：`docs/FULL-AUDIT-20260621.md`  
> 元审查修正：`docs/META-REVIEW-20260621.md`  
> 二次校对：`docs/AUDIT-VERIFICATION-20260621.md`  
> 核心原则：每个模块独立修复，从底层到上层，每修完一个模块立即验证，确保不会"修 1 个 bug 出 10 个 bug"
>
> **📝 修订记录**  
> - 2026-06-21 初版  
> - 2026-06-21 二次校对：修正阶段 1 别名设计、阶段 2 multipart/unwrap/tokio、阶段 8 工作量、阶段 10 引用数。本文中标注 `[校对更新]` 的为二次校对后修正的内容。

---

## 修复顺序（依赖链从下到上）

```
模块依赖关系：

  StoryBible  AiChatPanel  Settings  Writing  Characters  Outline  Overview
      │          │            │          │          │          │        │
      └──────────┴────────────┴──────────┴──────────┴──────────┴────────┘
                                       │
                              ┌────────┴────────┐
                              │   context-engine │
                              │  memory-updater  │
                              │   quality-checker│
                              │     backup       │
                              └────────┬────────┘
                                       │
                              ┌────────┴────────┐
                              │   chapter-store  │  ← 新建（从 WritingModule 抽取）
                              └────────┬────────┘
                                       │
                              ┌────────┴────────┐
                              │    storage.ts    │  ← 基础层
                              └─────────────────┘
                                       │
                              ┌────────┴────────┐
                              │   Rust (独立)    │
                              └─────────────────┘
                                       │
                              ┌────────┴────────┐
                              │ 阶段 0: 测试     │  ← 最底层保障
                              └─────────────────┘
```

**修复必须严格按顺序：0 → 1 → 2 → ... → 10。每修完一个立即验证。**

---

## 阶段 0：测试基础设施（新增 — 零阶段）

### 审计问题
Rule 9（零测试覆盖）— 6,000+ 行前端 + 2,200+ 行 Rust 零自动化验证

### 为什么先做
在改动任何代码之前，用测试锁定当前正确行为。后续 10 个阶段每改一处，跑测试即可发现回归。

### 具体改动

| # | 操作 | 内容 |
|---|------|------|
| 0.1 | **安装** | `npm install -D vitest @testing-library/react jsdom` |
| 0.2 | **配置** | 新建 `vitest.config.ts`，配置 jsdom 环境 + `@/` 路径别名 |
| 0.3 | **测试 1** | `src/lib/__tests__/storage.test.ts` — `loadJSON` 读已有 key、`saveJSON` 写后读回比对、写入失败返回 `{ ok: false }`（3 个测试） |
| 0.4 | **测试 2** | `src/lib/__tests__/chapter-store.test.ts` — 创建章节、读取、删除、批量保存、旧格式迁移（5 个测试） |
| 0.5 | **测试 3** | `src/lib/__tests__/context-engine.test.ts` — `estimateTokens` 中文/英文/混合文本（1 个测试） |
| 0.6 | **测试 4** | `src/lib/__tests__/parse-chapter-range.test.ts` — "1-3"/"4,7-9"/空字符串/中文逗号（4 个测试） |
| 0.7 | **脚本** | `package.json` 新增 `"test": "vitest run"` 和 `"test:watch": "vitest"` |

### 影响范围
不修改任何业务代码，纯新增。

### 验证标准
- [ ] `npm run test` 全部 13 个测试通过
- [ ] 每个测试同时验证"正确输入"和"错误输入"两路

---

## 阶段 1：storage.ts（基础层）— 1 个文件

### 审计问题
B1（写入静默失败）、B4（静默吞异常）、4.4（12 个导出函数过度设计）、7（裸调绕过）、5.3（耦合热力图最高）

### 当前状态
```typescript
// 12 个导出函数，199 行（其中 6 个是死代码：projectKey/get/set/remove/getJSON/removeSync 无外部调用者）
// setSync 写入失败只打 console.warn，调用方无感知
// 存在"同步/异步"两套 + "EXE/浏览器"两套（实际只需 EXE）
// _sqliteCache + prewarmFromSqlite 复杂内存缓存层
```

> `[校对更新]` 实测 `storage.ts` 共 **146 行**（非 199）。导出函数实测 **12 个**（与元审查一致）。高频调用点实测：`getJSONSync` **104 处** 跨 20 文件（非 93）、`setJSONSync` **50 处** 跨 14 文件（非 42，不含 .bak）。

### 目标状态
```typescript
// 保留同步 API 签名（104 个调用点不改调用方式），修复错误传播：
export function loadJSON<T>(key: string, defaultVal: T): T     // 同步，内部 Tauri invoke（通过 _sqliteCache）
export function saveJSON(key: string, value: unknown): boolean  // 同步，写失败返回 false + 触发 Toast
```

> **元审查修正**：原方案建议同步改异步 → 会波及 135+ 个调用点连锁修改，React render 中不能 await。改为保留同步签名，只修复错误传播。

### 具体改动

| # | 操作 | 内容 |
|---|------|------|
| 1.1 | **删除死代码** | `projectKey`、`prewarmFromSqlite`、`get`、`set`、`remove`、`getJSON`、`removeSync`（6 个无外部调用者的导出） |
| 1.2 | **保留并重命名** | `getJSONSync` → `loadJSON`，接口不变（key + defaultVal），内部逻辑不变 |
| 1.3 | **修改** | `setJSONSync` → `saveJSON`，接口改为返回 `boolean`：写入成功返回 `true`；失败捕获异常后调用 `reportDiagnostic()` + UI Toast，返回 `false` |
| 1.4 | **新增** | `saveJSON` 内部写后验证：`setSync` 后立即 `getSync` 读回比对，不一致 → `reportDiagnostic()` + 返回 `false` |
| 1.5 | **保留** | `setJSONSync` / `getJSONSync` 作为废弃别名重新导出，标记 `@deprecated`，阶段 3-10 中逐步替换 |

> `[校对更新]` **1.5 别名设计修正**：原方案让 `setJSONSync` 别名直接指向 `saveJSON`（返回 `boolean`），但现有 50 个 `setJSONSync` 调用点都是 `void` 上下文，TypeScript 不会强制检查返回值，等于静默丢失错误检查。  
> **正确做法**：`setJSONSync` 别名应返回 `void`，内部调用 `saveJSON` 并自行处理失败（调 `reportDiagnostic()`），让 50 个调用点在阶段 3-10 逐步迁移到显式检查 `saveJSON` 返回值。别名签名：  
> ```typescript
> /** @deprecated 改用 saveJSON 并检查返回值 */
> export function setJSONSync(key: string, value: unknown): void {
>     const ok = saveJSON(key, value);
>     if (!ok) reportDiagnostic({ level: "error", category: "storage", message: `保存失败：${key}` });
> }
> ```

### 影响范围（需同步修改 — 仅调用方检查返回值）

| 模块 | 改动 |
|------|------|
| `app-store.ts` | `persistChat`/`loadChat` 中 `setJSONSync` → `saveJSON`，检查返回值 |
| `WritingModule.tsx` | `saveContent` 中 `saveChapters` 内调用 `saveJSON`，检查返回值 → 失败时显示"保存失败" |
| 其他 42 个 `setJSONSync` 调用点 | **阶段 1 暂不改**（通过废弃别名兼容），阶段 3-10 中逐步迁移 |

### 验证标准
- [ ] `npm run test` 阶段 0 的 storage 测试全部通过
- [ ] `npm run build` 通过（废弃别名兼容保证）
- [ ] 启动 EXE → 写章节 → 保存 → 关闭 → 重开 → 内容还在
- [ ] 故意填满存储 → 保存 → 收到 `false` + 用户可见红色 Toast "保存失败：存储空间不足，请清理旧备份"
- [ ] `saveJSON` 返回 `true` 后，立即 `loadJSON` 同 key 读到一致数据

### 回滚方案
```bash
git checkout 418c623 -- src/lib/storage.ts src/hooks/use-project-data.ts
# 然后逐个文件还原 import 路径
```

---

## 阶段 2：Rust 后端（独立，可与阶段 1 并行）

### 审计问题
B5（.ok() 吞错误、.unwrap() 崩溃、凭据泄露、路径遍历）、D5（未使用依赖）

> `[校对更新]` 实测 `.ok()` 共 **44 处**（db_cmds 42 + mod.rs 2，非 20+）；另漏报 9 处 `to_string().unwrap()`、2 处互斥锁 `.unwrap()`、1 处 `lib.rs` 启动 `.expect()`。

### 2.1 修复导入路径静默吞错误 — 分三类处理

**文件**：`src-tauri/src/commands/db_cmds.rs:1200-1417`

> **元审查修正**：原方案建议 20+ `.ok()` 全改 `?` → 不能全改。DELETE 清理和 CREATE TABLE 需保留容错，INSERT 需收集错误而非中断。

| 类型 | 位置 | 数量 | 当前 | 正确修复 |
|------|------|------|------|---------|
| DELETE 清理 | 行1200-1208 | 9 | `.ok()` 静默 | 保留 `.ok()`，加 `log::warn!("清理旧数据失败: {}", e)` |
| INSERT OR REPLACE | 行1290-1410 | 9 | `.ok()` 静默 | 收集错误到 `Vec<String>`，导入完成后统一报告给前端 |
| CREATE TABLE IF NOT EXISTS | 行1429 | 1 | `.ok()` 静默 | 保留 `.ok()`（表已存在是预期行为） |

### 2.2 修复互斥锁崩溃

**文件**：`src-tauri/src/commands/db_cmds.rs:211` + `src-tauri/src/db/mod.rs:61,70`

**当前**：3 处 `state.0.lock().unwrap()`

**改为**：`state.0.lock().unwrap_or_else(|e| e.into_inner())`

> `[校对更新]` 初版只列 `db_cmds.rs:211` 一处，实测 `db/mod.rs:61`（`with_conn`）和 `db/mod.rs:70`（`open_project_db`）也是 `.unwrap()`，共 **3 处**需统一处理。

### 2.3 修复 .expect() 崩溃

**文件**：`src-tauri/src/db/mod.rs:71` + `src-tauri/src/lib.rs:66`

**当前**：
- `db/mod.rs:71`：`.expect("no project db open")`
- `lib.rs:66`：`.expect("error while running tauri application")`

**改为**：
- `db/mod.rs:71`：返回 `Result`，前端展示"请先打开项目"
- `lib.rs:66`：改为捕获 panic 并通过对话框提示"Tauri 启动失败"，而非直接崩溃

> `[校对更新]` 初版漏报 `lib.rs:66` 启动 `.expect()`，二次校对补入。

### 2.4 修复凭据泄露

**文件**：`src-tauri/src/commands/ai.rs:162`

**当前**：百度密钥通过 URL query string 传递

**改为**：通过 POST body 传递

### 2.5 修复路径遍历

**文件**：`src-tauri/src/commands/export.rs:43-49`

**改为**：验证写入路径在 `data_dir()` 子目录内

### 2.6 清理未使用依赖

**文件**：`src-tauri/Cargo.toml`

移除：`futures-util`、`keyring`、`dirs`；移除 `reqwest` 的 `stream` feature

> `[校对更新]` **不可移除 `reqwest` 的 `multipart` feature** — `ai.rs:205-213` STT 音频上传使用 `reqwest::multipart::Form`，删 `multipart` 会破坏语音识别。只能删 `stream`。  
> 另建议顺带精简 `tokio`：`features = ["full"]` → `features = ["rt-multi-thread", "macros"]`，减小 EXE 体积。

### 2.7 修复 9 处 `serde_json::to_string().unwrap()`

**文件**：`src-tauri/src/commands/db_cmds.rs:468,469,494,553,575,705,780,842,917`

**当前**：序列化 `Vec<String>` 或结构体时 `.unwrap()`，失败将 panic

**改为**：`.map_err(|e| format!("序列化失败: {e}"))?` 或 `.unwrap_or_default()`（取决于语义）

> `[校对更新]` 二次校对新增项，初版漏报。虽 `serde_json::to_string` 对标准类型实际不会失败，但属同类 panic 风险，应一并治理。

### 影响范围
前端不需要改动，Rust 接口签名不变。

### 验证标准
- [ ] `cargo build` 通过
- [ ] 导入有损坏数据的项目 → 前端收到明确错误信息，非"导入成功但数据为空"
- [ ] 项目未打开时调用命令 → 前端收到"请先打开项目"，非崩溃
- [ ] `[校对更新]` STT 语音识别功能正常（验证 `multipart` 未被误删）
- [ ] `[校对更新]` 序列化失败场景不 panic（2.7）

---

## 阶段 3：chapter-store.ts（新建）— 1 个新文件，修改 8 个旧文件

### 审计问题
②（冗余三写）、③（16 处裸读）、⑨（9 个越权访问者）、D4（全量写入）、4.5（冗余缓存）

### 当前状态
```
plot-chapters-{pid}       被 9 个模块直读
chapter-{pid}-{id}        仅 WritingModule 读写
chapter-index-{pid}       仅 WritingModule 读写
```

### 目标状态
```
新增 lib/chapter-store.ts，作为章节数据的唯一入口：
  export loadAllChapters(pid): PlotChapter[]
  export loadChapter(pid, id): PlotChapter | null
  export saveChapter(pid, chapter): { ok: boolean; error?: string }
  export saveChapters(pid, chapters[]): { ok: boolean; error?: string }
  export deleteChapter(pid, id): void

内部实现：
  存储键：chapter-{pid}-{id} (逐章) + chapter-index-{pid} (索引)
  删除 plot-chapters-{pid} 全量聚合缓存
```

### 具体改动

| # | 文件 | 操作 |
|---|------|------|
| 3.1 | **新建** `src/lib/chapter-store.ts` | 4 个导出函数（如上） |
| 3.2 | `WritingModule.tsx` | 删除 `loadChapters`、`saveChapters` 函数，改为 import `chapter-store`；`saveContent` 改为调 `saveChapter`（增量，只写当前章） |
| 3.3 | `context-engine.ts` | 5 处 `getJSONSync("plot-chapters-")` → `loadAllChapters(pid)` |
| 3.4 | `AiChatPanel.tsx` | 2 处 `getJSONSync/setItem("plot-chapters-")` → `loadAllChapters(pid)` / `saveChapter` |
| 3.5 | `StoryBibleModule.tsx` | 3 处 `localStorage.getItem("plot-chapters-")` → `loadAllChapters(pid)` |
| 3.6 | `SettingsModal.tsx` | 2 处 `tryGetKey/getFromKeys("plot-chapters-")` → `loadAllChapters(pid)` |
| 3.7 | `WritingStatsPanel.tsx` | 1 处 → `loadAllChapters(pid)` |
| 3.8 | `use-project-data.ts` | 1 处 → `loadAllChapters(pid)` |
| 3.9 | `db_cmds.rs` | `read_setting_array("plot-chapters-")` → 从 `chapter-index` + 逐章组装 |

### 影响范围
**关键：** 8 个文件改调用方式，但功能不变。所有改动都是替换 import 和函数调用名。

### 回退兼容
`loadChapters` 内部先尝试旧格式 `plot-chapters-{pid}`（如果存在且新格式为空），自动迁移后删除旧 key。

### 验证标准
- [ ] 所有 8 个模块编译通过
- [ ] 创建项目 → 写 3 章 → 保存 → 关闭 → 重开 → 3 章内容都在
- [ ] `localStorage` 或 `app_settings` 中不再出现 `plot-chapters-{pid}` key
- [ ] 旧项目打开后自动迁移（旧 `plot-chapters-{pid}` 内容不丢）

---

## 阶段 4：memory-updater.ts 解耦 — 1 个文件

### 审计问题
B2（快照数据不全）、B3（快照膨胀）、D1（summary 缺失）、④（parseChapterRange 副本）、5.3（耦合）

### 4.1 修复 `createSnapshot` / `createBackup` 数据收集

**文件**：`src/lib/memory-updater.ts:649-668`、`src/lib/backup.ts:12-40`

**当前**：`getAllProjectKeys` 只遍历 `localStorage`

**改为**：通过 Rust 端已有的 `list_app_settings` 命令（`db_cmds.rs:1140`，已在 `lib.rs` 注册）收集所有 SQLite key，不再用 `localStorage.key(i)`

> **元审查修正**：`list_app_settings` 命令已存在，无需新建。`get_setting`/`set_setting` 也已注册。

### 4.2 快照分片存储

**文件**：`src/lib/memory-updater.ts:649-668`

**当前**：所有快照塞在 `novel-snapshots-{pid}` 一个 key

**改为**：每个快照独立存储 `novel-snapshot-{pid}-{snapId}`，加索引 `novel-snapshot-index-{pid}`（`string[]`）

### 4.3 删除 `parseChapterRange` 副本

**文件**：`src/lib/context-engine.ts:556-569`

**操作**：删除本地定义，`import { parseChapterRange } from "@/lib/memory-updater"`

### 4.4 修复静默吞异常 + 定义 `reportDiagnostic()`

**文件**：`src/lib/memory-updater.ts`

将以下改为 `reportDiagnostic()` + 返回错误：
- `catch { /* ignore */ }` 角色列表/故事线获取失败（行 150、155）
- `catch { /* 快照保存失败不阻塞定稿 */ }` （行 321）
- `catch { /* 角色预测失败不阻塞定稿 */ }` （行 633）

**`reportDiagnostic()` 实现**（新增 `src/lib/diagnostics.ts`）：
```typescript
interface DiagnosticEntry {
    id: string; level: "error" | "warn" | "info";
    category: string;        // "storage" | "ai" | "snapshot" | "context" | "unknown"
    message: string;         // 用户可读中文
    detail?: string;         // 技术细节（默认隐藏）
    sessionId: string; operationId?: string; timestamp: string;
}
export function reportDiagnostic(entry: Omit<DiagnosticEntry, "id"|"sessionId"|"timestamp">): void {
    const full: DiagnosticEntry = {
        ...entry, id: uuid(), sessionId: getSessionId(), timestamp: new Date().toISOString()
    };
    // 1. 持久化到 diagnostics-{sessionId} key
    const logs = loadJSON(`diagnostics-${full.sessionId}`, [] as DiagnosticEntry[]);
    logs.push(full);
    saveJSON(`diagnostics-${full.sessionId}`, logs);
    // 2. error 级别弹出 Toast
    if (full.level === "error") showToast(full.message, "error");
}
```

> **元审查修正**：原方案未定义 `reportDiagnostic()` 实现。必须确保它自身不失败（写入用 `saveJSON` 带错误处理、Toast 有 fallback）。

### 影响范围
- `backup.ts` 的 `getAllProjectKeys` 改为调 Rust 命令
- `context-engine.ts` 删除本地 `parseChapterRange`
- `SettingsModal.tsx` 的快照管理面板适配新存储格式

### 验证标准
- [ ] 创建快照 → EXE 重启 → 快照列表仍可见，数据完整
- [ ] 恢复快照 → 所有章节、角色、词条数据完整恢复
- [ ] 连续创建 10 个快照 → 存储 key 为 11 个（1 索引 + 10 分片），非 1 个巨型 key

---

## 阶段 5：context-engine.ts 精简 — 1 个文件

### 审计问题
D2（快照匹配）、D3（两套上下文路径）、⑤（两套组装器）、⑧（any 逃逸）、4.6（typeLabel 重复 3 次）

### 5.1 合并两套上下文组装器

**当前**：
```
loadContextPanelData (WritingModule.tsx:547) — UI 面板
buildProjectContext (context-engine.ts:344)  — AI 写作
```

**改为**：
```typescript
// context-engine.ts
export function assembleContext(projectId, chapterId, mode: "panel" | "ai"): ContextResult
// panel 模式：返回轻量数据给 UI 面板渲染
// ai 模式：返回 P0-P4 token 预算控制的 system_hint
```

`WritingModule.tsx` 删除 `loadContextPanelData`，改为调 `assembleContext(pid, chId, "panel")`。

### 5.2 修复快照匹配

**当前**：取 `age` 最大的快照（`context-engine.ts:803`）

**改为**：取 `age` 最接近当前章节对应时间线的快照。如果无法判断时间线（缺少章节→年龄映射），用最新快照并附加警告日志。

### 5.3 消除重复定义

- `typeLabel` Record 在行 111、266、493 定义 3 次 → 提取到文件顶部常量
- `estimateTokens` 与 `memory-engine.ts` 重复 → 统一从 `context-engine.ts` 导出

### 5.4 `as any` → 接口定义

为以下定义接口（新建或复用 `types/index.ts`）：
```typescript
interface PlotSegmentData { id: string; type: string; title: string; ... }
interface PlotChapterData { id: string; volumeSegmentId: string; number: number; ... }
interface LogStoreData { summaries?: ChapterSummary[]; characterStates?: CharacterState[]; ... }
```

> `[校对更新]` **S14 治理范围扩展**：`as any` 实测共 **126 处** 跨 18 文件（初版仅列 context-engine 20+ / memory-updater 10+，共 30+ 偏低 4 倍）。阶段 5 只处理 context-engine（16 处）和 memory-updater（9 处）共 25 处。其余 101 处分布在 mock-backend（20）、WorldviewPanel（14）、CharactersModule（13）、SettingsModal（12）、WritingModule（8）、use-project-data（5）、AiChatPanel（6）、app-store（3）、PlotStoryNode（4）、useUndoRedo（2）、AiWriteChapterDialog（2）、PlotDirectionPanel（2）、StoryBible（4）、quality-checker（1）、AiWritingDialog（1），建议在各模块对应阶段（6/7/8/9）顺手治理，不单列阶段。

### 影响范围
- `WritingModule.tsx` 面板改为调 `assembleContext`
- `AiChatPanel.tsx` 的 `buildModuleContext` 不变（聊天场景不同）

### 验证标准
- [ ] 面板展示角色和 AI 收到角色一致
- [ ] 快照匹配：写第 3 章 → AI 收到角色 16 岁信息，非 30 岁
- [ ] `npm run tsc --noEmit` 无新增类型错误

---

## 阶段 6：WritingModule.tsx 拆分 — 1 拆 6

### 审计问题
⑥（1707 行 God File）、3.4（15 lib import）、3.5（8 个操作内联在 JSX）、D3（上下文面板）、B1（保存静默失败）

> **元审查修正**：实际行数 1707，非原报告 1615。`useAiWriting` 依赖 10+ 个外部变量，直接提取会导致参数爆炸，使用 WritingContext 中介。

> `[校对更新]` 实测行数 **1708**（含末行换行）。

### 拆分方案

```
Before: src/modules/writing/WritingModule.tsx (1707 行)
After:
  src/modules/writing/WritingModule.tsx        (~350 行) 核心：编辑器 + 工具栏
  src/modules/writing/ChapterTree.tsx          (~200 行) 左侧卷章树
  src/modules/writing/ContextPanel.tsx         (~200 行) 中间上下文面板
  src/modules/writing/WritingContext.tsx       (~50 行)  React Context 中介
  src/modules/writing/useChapterSave.ts        (~150 行) 保存/定稿/撤销/草稿
  src/modules/writing/useAiWriting.ts          (~200 行) AI 写/润色/去 AI 味
  src/lib/prompts.ts                           (~100 行) 提示词常量
  src/lib/chapter-utils.ts                     (~50 行)  工具函数
```

> **元审查修正**：新增 `WritingContext.tsx`。`useAiWriting` 依赖 10+ 个外部变量（`pid`、`selectedChapter`、`editingContent`、`buildProjectContext`、`api.aiComplete`、`saveChapters`、`syncEditorHTML`、`pushUndo`、`lastWriteParamsRef`、`aiWritingRef`、`timeoutIdsRef`），通过 Context 传递共享状态。

### 具体拆分

| 新文件 | 从 WritingModule.tsx 迁移的内容 |
|--------|-------------------------------|
| `ChapterTree.tsx` | 卷章树渲染、展开折叠、重命名、新建删除、宽度拖拽 |
| `ContextPanel.tsx` | `ctxCollapsed` 状态、P0/P1/P2/P3/P4 面板渲染、`loadContextPanelData` → 调 `assembleContext(pid, chId, "panel")` |
| `useChapterSave.ts` | `saveContent`、`saveContentRef`、自动保存注册、`DRAFT_KEY`、草稿持久化、定稿 handler（从 JSX onClick 提取为独立函数） |
| `useAiWriting.ts` | `handleAiWriteChapter`、`handlePolish`、`handleHumanize`、AI 弹窗状态 |
| `lib/prompts.ts` | `POLISH_RULES`、`HUMANIZER_RULES`、扩写/缩写/改第三人称的 prompt |
| `lib/chapter-utils.ts` | `detectStaleAhead`、`bumpSavedChapterVersion`、`migrateTitle` |

### 定稿 handler 改写

**当前**（`WritingModule.tsx:1441-1553`，112 行 JSX onClick 内联）：
```tsx
<button onClick={async () => {
    // 保存 → 摘要 → 词条 → 预测 → 质检 → 备份 → 快照 → 新角色 → 阶段推进
}}>
```

**改为**（`useChapterSave.ts`）：
```typescript
async function finalizeChapter(params: FinalizeParams): Promise<FinalizeResult> {
    const steps: StepResult[] = [];
    
    const saveResult = await saveChapter(pid, chapter);
    steps.push({ step: "save", ...saveResult });
    if (!saveResult.ok) return { ok: false, steps, error: "保存失败" };
    
    try { 
        await updateMemory(...); 
        steps.push({ step: "summary", ok: true });
    } catch (e) { 
        steps.push({ step: "summary", ok: false, error: e.message }); 
    }
    // ... 其余步骤类推
    
    return { ok: allOk, steps };
}
```

### 影响范围
`App.tsx` 的 import 不变（`WritingModule` 仍从同目录导出）。

### 验证标准
- [ ] 所有功能路径遍历：写 → 保存 → 定稿 → AI 写 → 润色 → 去 AI 味 → 撤销 → 重做
- [ ] 上下文面板展开/折叠正常，数据与 AI 收到的一致
- [ ] 每个新文件 < 300 行

---

## 阶段 7：AiChatPanel.tsx 拆分 — 1 拆 4

### 审计问题
⑥（2431 行 God File）、3.5（耦合 4 个模块）、⑦（3 处 localStorage 裸调）

> **元审查修正**：实际行数 2431，非原报告 2304。

> `[校对更新]` 实测行数 **2432**（含末行换行）。localStorage 裸调实测 **9 处**（非 3 处），分布第 531/830/947 行及其他 6 处。

### 拆分方案

```
Before: src/layouts/AiChatPanel.tsx (2431 行)
After:
  src/layouts/AiChatPanel.tsx              (~600 行) 聊天 UI + 消息渲染 + STT
  src/layouts/usePendingCharacters.ts      (~300 行) pending chars/edges/snapshots 状态管理
  src/layouts/CharacterApplyButton.tsx     (~200 行) "应用到星图" 按钮 + 确认流程
  src/lib/character-parser.ts              (~200 行) parseCharacterBatch 纯函数
```

### 具体改动

| 新文件 | 迁移内容 |
|--------|---------|
| `usePendingCharacters.ts` | `pendingChars`/`pendingCharEdges`/`pendingSnapshots`/`pendingRemoveEdges` 状态 + `loadedRef` + `loadPendingChars` + `applyAll` 中的角色增删改逻辑 |
| `CharacterApplyButton.tsx` | "应用到星图" 按钮渲染 + 点击后的确认/执行流程 |
| `lib/character-parser.ts` | `parseCharacterBatch` 纯函数（从 `---CHARACTERS---` 块提取 JSON） |

### 修复 `localStorage` 裸调用

`AiChatPanel.tsx:531` — `localStorage.getItem("ai-pending-chars-")` → `loadJSON`  
`AiChatPanel.tsx:830` — `localStorage.getItem("novel-workbench-mock")` → 通过 api 读  
`AiChatPanel.tsx:947` — `localStorage.setItem("plot-chapters-")` → `saveChapter`

### 验证标准
- [ ] 聊天面板功能正常
- [ ] AI 建议创建角色 → "应用到星图" → 角色出现在人物关系模块
- [ ] AI 建议创建快照 → 快照保存成功

---

## 阶段 8：StoryBibleModule.tsx 修复 — 1 个文件

### 审计问题
⑪（11 处 localStorage 裸调）、5.2（最严重绕过封装）

### 改动

11 处 `localStorage.getItem/setItem` 全部替换：

| 旧 | 新 |
|----|----|
| `localStorage.getItem("plot-chapters-")` | `loadAllChapters(pid)` |
| `localStorage.getItem("plot-segments-")` | `loadJSON("plot-segments-" + pid, [])` |
| `localStorage.getItem("novel-workbench-mock")` | 通过 api 或 loadJSON 读 |
| `localStorage.setItem(...)` | `saveJSON(key, value)` |

如果 `loadJSON` 返回 `null` 且非 Tauri 模式，仍需回退读 `localStorage` 作为迁移兼容——这单独处理，不裸调。

> `[校对更新]` **工作量修正**：StoryBibleModule 实测 **16 处** 裸调（非 11），且第 642 行单行内含 7 次 `localStorage.getItem` + 1 次 `setItem`，是 EXE 下数据丢失重灾区，需逐个拆分。  
> **阶段 8 范围扩展**：localStorage 裸调实测共 **93 处** 跨 16 文件（非 ~17 处）。初版只列 UI 组件层，漏算 lib 层：`backup.ts`（12）、`mock-backend.ts`（17）、`version-check.ts`（3）、`migrate-data.ts`（3）、`memory-updater.ts`（1）。阶段 8 需覆盖这些 lib 层文件，建议拆为两个子阶段：  
> - 8.A：UI 组件层（StoryBible 16 + AiChatPanel 9 + Outline 4 + WelcomeScreen 4 + SettingsModal 4 + AppShell 1 + Inspiration 1 ≈ 39 处）  
> - 8.B：lib 层（backup 12 + mock-backend 17 + version-check 3 + migrate-data 3 + memory-updater 1 = 36 处；storage.ts 自身 11 处属实现层不计）

### 验证标准
- [ ] 故事圣经页面打开正常，风格指南/铁则/版本记录全部加载
- [ ] 保存故事圣经 → 关闭 → 重开 → 数据还在

---

## 阶段 9：SettingsModal.tsx 拆分 — 1 拆 4

### 审计问题
⑥（1192 行 God File）、4.6（导入逻辑重复 60%）

### 拆分方案

```
Before: src/components/settings/SettingsModal.tsx (1192 行)
After:
  src/components/settings/SettingsModal.tsx        (~150 行) 标签导航 + 弹窗壳
  src/components/settings/ApiConfigTab.tsx         (~200 行) API 配置
  src/components/settings/SttConfigTab.tsx         (~150 行) STT 配置
  src/components/settings/SnapshotManagerTab.tsx   (~200 行) 快照管理 + 适配新分片存储
  src/components/settings/DataMigrateTab.tsx       (~250 行) 数据导入导出迁移
```

### 验证标准
- [ ] 设置页 5 个标签正常切换
- [ ] 每个标签子文件 < 300 行

---

## 阶段 10：app-store.ts 拆分 — 1 拆 4

### 审计问题
⑩（上帝对象，60+ 字段，18 文件依赖）、5.3（耦合最高）

> `[校对更新]` 实测 `app-store` 被 **27 文件** 引用（不含 .bak，初版 18 偏低）。子阶段 10.7 "其余 13 个文件" 实际为 **22 个文件**，工作量需相应上调。

> **元审查修正**：原方案用"兼容导出层"`useAppStore = () => ({...4 stores})` — 这会导致每次调用订阅所有 4 个 store 的全部字段变化，**组件重渲染爆炸**。改为直接修改 18 个调用文件，各取所需。

### 拆分方案

```
Before: src/stores/app-store.ts (60+ 字段，18 文件引用)
After:
  src/stores/project-store.ts — projects / currentProject / frameworkProgress / selectedEntity / bump* / navigateTo
  src/stores/ui-store.ts      — drawerOpen / navCollapsed / settingsOpen / outlineSection / overviewSection
  src/stores/chat-store.ts    — chatMessages / deepseekStatus / persistChat / loadChat / addChatMessage
  src/stores/writing-store.ts — autosaveStatus / pendingInsertContent / triggerAutosave
  src/stores/app-store.ts     — 删除本文件（18 个引用文件已改造完成）
```

### 分步改造（避免一次性大规模替换）

| 子阶段 | 内容 | 涉及文件数 |
|--------|------|-----------|
| 10.1 | 创建 4 个新 store，`app-store.ts` 仍保留全部字段 | 0（纯新增） |
| 10.2 | `WritingModule.tsx` 改用 `useWritingStore` + `useProjectStore` | 1 |
| 10.3 | `AiChatPanel.tsx` 改用 `useChatStore` + `useProjectStore` | 1 |
| 10.4 | `AppShell.tsx` 改用 `useUiStore` + `useProjectStore` | 1 |
| 10.5 | `SettingsModal.tsx` 改用 `useUiStore` | 1 |
| 10.6 | `CharactersModule.tsx` 改用 `useProjectStore` | 1 |
| 10.7 | 其余 13 个文件逐批改造 | 13 |
| 10.8 | 删除 `app-store.ts`，更新 `types/index.ts` 导出 | 1 |

### 验证标准
- [ ] 子阶段 10.2-10.8 每步 `npm run build` 通过
- [ ] 所有 18 个依赖文件编译通过（最后一步）
- [ ] 项目导航/抽屉/设置/AI 状态/聊天/写作状态全部正常
- [ ] 无组件因订阅无关 store 字段而发生不必要重渲染

---

## 完整验证清单（所有阶段完成后）

### 核心流程验证

- [ ] 创建项目 → 设定大纲 → 创建角色 → 写 5 章 → 每章定稿 → 关闭 → 重开 → 所有数据完整
- [ ] 第 26 章保存后关闭重开 → 内容不丢
- [ ] 创建快照 → 恢复 → 所有数据完整
- [ ] 导入旧版本项目 → 数据自动迁移 → 不丢失
- [ ] AI 写本章 → 上下文正确 → 角色信息符合时间线
- [ ] 设置页所有标签正常 → API 配置/STT/快照/迁移
- [ ] Rust 后端：项目未打开时调用命令 → 不崩溃
- [ ] 存储空间不足 → 红色 Toast "保存失败：存储空间不足"
- [ ] `[校对更新]` STT 语音输入功能正常（验证 `multipart` 特性未被误删）
- [ ] `[校对更新]` Tauri 启动失败时显示友好提示而非崩溃（验证 lib.rs:66 修复）

### 编译验证

- [ ] `npm run build` 通过
- [ ] `cargo build` 通过
- [ ] `npm run tsc --noEmit` 无类型错误

### 性能验证

- [ ] 30 章项目保存一章 < 1 秒（增量写入）
- [ ] 上下文组装 < 2 秒（加载 + 组装 + token 裁剪）
- [ ] 快照创建 < 3 秒（分片存储）

---

## 附录 A：不可并行修复的模块对

| 模块 A | 模块 B | 原因 |
|--------|--------|------|
| storage.ts | chapter-store.ts | chapter-store 依赖 storage 新 API |
| chapter-store.ts | context-engine.ts | context-engine 依赖 chapter-store 的 `loadAllChapters` |
| context-engine.ts | WritingModule.tsx | WritingModule 的面板依赖 context-engine 的 `assembleContext` |

**可并行的模块对：**

| 模块 A | 模块 B | 原因 |
|--------|--------|------|
| storage.ts | Rust 修复 | 无互相依赖 |
| chapter-store.ts | memory-updater.ts | 无互相依赖 |
| AiChatPanel | StoryBibleModule | 无互相依赖 |
| SettingsModal | app-store | SettingsModal 依赖 app-store，但 app-store 通过兼容导出不影响 |

---

## 附录 B：每个阶段验证不通过时的回退命令

```bash
# 阶段 1
git checkout 418c623 -- src/lib/storage.ts src/hooks/use-project-data.ts
# 阶段 2
git checkout 418c623 -- src-tauri/
# 阶段 3
git checkout 418c623 -- src/lib/chapter-store.ts  # 删除新建
git checkout 418c623 -- src/modules/writing/WritingModule.tsx src/lib/context-engine.ts src/layouts/AiChatPanel.tsx src/modules/story-bible/StoryBibleModule.tsx src/components/settings/SettingsModal.tsx src/modules/overview/WritingStatsPanel.tsx src/hooks/use-project-data.ts src-tauri/src/commands/db_cmds.rs
# ... 后续阶段类推
```
