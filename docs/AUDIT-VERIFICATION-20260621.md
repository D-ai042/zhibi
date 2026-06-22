# 审计文档对比验证报告

> 验证日期：2026-06-21  
> 验证对象：`docs/FULL-AUDIT-20260621.md` + `docs/REMEDIATION-PLAN.md` + `docs/META-REVIEW-20260621.md`  
> 验证方法：逐项核对项目源码（`src/` + `src-tauri/`）  
> 交付目标：Windows EXE（真实存储为 SQLite，localStorage 仅 WebView 缓存）

---

## 一、Bug 清单验证

### B1. 章节内容丢失 🔴 致命 — ✅ 准确

**审计结论**：[src/lib/storage.ts:121-126](file:///f:/Projects/ai-novel-writer/src/lib/storage.ts) `setSync` 写入失败（配额溢出）只打 `console.warn`，`saveContent` 收不到错误仍显示"已保存"。

**代码核对**：
```typescript
// storage.ts:117-119
export function setSync(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch (e) {
        console.warn(`[storage] localStorage 写入失败: ${key}`, e);  // ← 不抛出
    }
    ...
}
// storage.ts:139-144  setJSONSync 同样静默
export function setJSONSync(key: string, value: unknown): void {
    try { setSync(key, JSON.stringify(value)); } catch {
        // JSON.stringify 失败（循环引用等极端情况），静默跳过
    }
}
```
**结论**：完全准确。EXE 下无控制台，`console.warn` 不可见，调用方拿不到失败信号。

---

### B2. 快照和备份在 EXE 下数据不完整 🔴 致命 — ✅ 准确

**审计结论**：[backup.ts:12-40](file:///f:/Projects/ai-novel-writer/src/lib/backup.ts) `getAllProjectKeys` 只遍历 WebView `localStorage`，不知道 SQLite `app_settings` 表。

**代码核对**：
```typescript
// backup.ts:28-39
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    ...
}
```
**结论**：完全准确。EXE 下真实数据在 SQLite，`localStorage.key(i)` 看不到。

---

### B3. 快照全量塞一个 key 导致存储膨胀 🔴 致命 — ✅ 准确

**审计结论**：[memory-updater.ts:649-668](file:///f:/Projects/ai-novel-writer/src/lib/memory-updater.ts) 把全部快照（含完整项目数据）存入 `novel-snapshots-{pid}` 单 key。

**代码核对**：
```typescript
// memory-updater.ts:649-666
export function createSnapshot(projectId: string, label: string): void {
    const snaps = getJSONSync(SNAPSHOT_KEY(projectId), [] as ProjectSnapshot[]);
    ... // 收集 data
    snaps.push({ id: uuid(), label, timestamp: ..., data });  // ← 累积塞入
    setJSONSync(SNAPSHOT_KEY(projectId), snaps);              // ← 单 key
}
```
**结论**：完全准确。

---

### B4. 50+ 处静默吞异常 🔴 致命 — ⚠️ 低估（实际更严重）

**审计结论**：50+ 处 `catch { /* ignore */ }`，分布：context-engine ~11、app-store ~5、WritingModule ~5、AppShell ~3、mock-backend 若干、Rust db_cmds 20+ `.ok()`。

**实测（grep 全量统计）**：

| 维度 | 审计文档 | 实测 | 差异 |
|------|---------|------|------|
| 前端 `catch {}` | ~50 处 | **119 处** 跨 24 文件 | 低估 2.4 倍 |
| 其中 context-engine | ~11 | 13 | 接近 |
| 其中 AiChatPanel | （未列） | **19** | 漏报 |
| 其中 StoryBible | （未列） | **22** | 漏报 |
| 其中 mock-backend | 若干 | 11 | 接近 |
| Rust `.ok()` | 20+ | **42**（db_cmds）+ 2（mod.rs） | 低估 |

**结论**：方向准确，但数量被显著低估。实际静默失败点比文档描述更密集，Rule 12 违规程度更严重。

---

### B5. Rust 端严重问题 🔴 致命 — ⚠️ 部分准确，有漏报

#### B5.1 导入路径 `.ok()` 静默吞 — ✅ 准确
- [db_cmds.rs:1200-1410](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs) 实测 42 处 `.ok()`，其中 9 处 DELETE 清理 + 9 处 INSERT OR REPLACE + 1 处 CREATE TABLE + 其余迁移容错。
- META-REVIEW 的"分三类处理"修正正确。

#### B5.2 互斥锁中毒崩溃 — ⚠️ 位置标注错误
- 审计称 `db_cmds.rs:211`，实际 [db_cmds.rs:211](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs) 是 `delete_project` 内 `state.0.lock().unwrap()`，位置准确。
- **但同问题还有 2 处未提及**：[db/mod.rs:61](file:///f:/Projects/ai-novel-writer/src-tauri/src/db/mod.rs) 和 [db/mod.rs:70](file:///f:/Projects/ai-novel-writer/src-tauri/src/db/mod.rs) 也是 `state.0.lock().unwrap()`。

#### B5.3 `.expect()` 崩溃 — ✅ 准确
- [db/mod.rs:71](file:///f:/Projects/ai-novel-writer/src-tauri/src/db/mod.rs) `guard.as_ref().expect("no project db open")` 确认。

#### B5.4 API 凭据泄露 — ✅ 准确
- [ai.rs:162](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/ai.rs) 百度密钥通过 URL query string：`client_id={}&client_secret={}` 确认。

#### B5.5 路径遍历风险 — ✅ 准确
- [export.rs:43-49](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/export.rs) `save_export_file` 直接 `std::fs::write(&file_path, &bytes)`，无路径校验确认。

#### 🔴 漏报：9 处 `serde_json::to_string().unwrap()` 未提及
[db_cmds.rs:468, 469, 494, 553, 575, 705, 780, 842, 917](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs) 共 9 处 `.unwrap()`（序列化 `Vec<String>`/结构体），REMEDIATION 阶段 2 未覆盖。虽实际不会失败，但属同类崩溃风险，应一并处理为 `map_err`。

---

## 二、设计缺陷验证

### D1. 角色概要 summary 全链路缺失 🟡 高 — ✅ 准确

**代码核对**：
- 类型有：[types/index.ts:119](file:///f:/Projects/ai-novel-writer/src/types/index.ts) `summary?: string`
- DB 无列：[schema.sql](file:///f:/Projects/ai-novel-writer/src-tauri/src/db/schema.sql) `characters` 表无 `summary` 列
- 导入也不写：[db_cmds.rs](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs) characters INSERT 列表无 summary

**结论**：准确，全链路缺失确认。

---

### D2. 快照匹配用"最大年龄"而非剧情判断 🟡 中 — ✅ 准确

**代码核对**：
```typescript
// context-engine.ts:803
const latest = [...merged.snapshots]
    .sort((a, b) => (parseInt(b.age) || 0) - (parseInt(a.age) || 0))[0];  // ← 取 age 最大
```
**结论**：准确。永远取年龄最大快照，忽略当前章节时间线。

---

### D3. 两条上下文路径不一致 🟡 中 — ✅ 准确

**代码核对**：
- [WritingModule.tsx:547](file:///f:/Projects/ai-novel-writer/src/modules/writing/WritingModule.tsx) `loadContextPanelData` — 给 UI 面板
- [context-engine.ts](file:///f:/Projects/ai-novel-writer/src/lib/context-engine.ts) `buildProjectContext` — 给 AI

**结论**：准确，两套独立实现。

---

### D4. saveChapters 每次全量写入 🟡 中 — ✅ 准确

**代码核对**：
```typescript
// WritingModule.tsx:48-58
function saveChapters(pid: string, chs: PlotChapter[]) {
    for (const ch of chs) {
        setJSONSync(`chapter-${pid}-${ch.id}`, ch);   // ① 逐章
        ids.push(ch.id);
    }
    setJSONSync(`chapter-index-${pid}`, ids);          // ② 索引
    setJSONSync(`plot-chapters-${pid}`, chs);          // ③ 全量冗余
}
```
**结论**：准确，三写确认（审计 4.5 节描述一致）。

---

### D5. 未使用的 Rust 依赖 🟢 低 — ⚠️ 部分准确

**审计结论**：`futures-util`、`keyring`、`dirs` 未使用；`reqwest` 的 `stream` 特性未使用。

**代码核对**：
- `futures-util`：grep 无 `use futures_util` / `futures_util::` ✅ 未使用
- `keyring`：grep 无 `keyring` 引用 ✅ 未使用
- `dirs`：grep 无 `use dirs` / `dirs::` ✅ 未使用
- `reqwest` 的 `stream` 特性：grep 无 `bytes_stream` / `stream::` ✅ 未使用
- **但 `multipart` 特性实际在用**：[ai.rs:205-213](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/ai.rs) STT 上传使用 `reqwest::multipart::Form` 🔴

**结论**：审计准确指出 `stream` 未用，但**未说明 `multipart` 正在使用**。REMEDIATION 阶段 2.6 若误删 `multipart` 会破坏语音识别。修正：Cargo.toml 只删 `stream`，保留 `multipart`。

**补充漏报**：`tokio` 用 `full` feature，实际只需 `["rt-multi-thread", "macros"]`，可精简二进制体积。

---

## 三、Rule 2 深挖验证（简单优先）

### 4.1 God Files — ⚠️ 行数有出入，META-REVIEW 已纠

| 文件 | FULL-AUDIT | META-REVIEW 修正 | 实测（raw-split） |
|------|-----------|------------------|------------------|
| AiChatPanel.tsx | 2304 | 2431 | **2432** |
| WritingModule.tsx | 1615 | 1707 | **1708** |
| db_cmds.rs | 1517 | （未纠） | **1518** |
| SettingsModal.tsx | 1192 | （未纠） | 1192 ✅ |
| CharactersModule.tsx | 983 | （未纠） | 983 ✅ |
| context-engine.ts | 897 | （未纠） | 897 ✅ |
| storage.ts | 199 | （未纠） | **146**（审计多报 53 行） |

**结论**：FULL-AUDIT 行数普遍少报 1 行（`Measure-Object` 不计最后一行），META-REVIEW 纠正方向正确。storage.ts 实际 146 行，审计称 199 行高估（可能含注释空行统计方式差异）。

### 4.4 存储层过度设计 — ✅ 准确

storage.ts 导出函数核对（实测 146 行，非 199）：
- 审计称"16 个函数"，META-REVIEW 纠正为 **12 个**，实测确认 12 个导出函数。
- 死代码 6 个：`projectKey` / `get` / `set` / `remove` / `getJSON` / `removeSync` ✅ 无外部调用者
- 高频使用：`getJSONSync`（**104 处**）/ `setJSONSync`（**50 处**）

**注**：META-REVIEW 称 getJSONSync 93 处、setJSONSync 42 处，实测为 **104 / 50**（不含 .bak），META-REVIEW 数据偏低。

### 4.5 冗余三写 — ✅ 准确（见 D4）

### 4.6 重复代码 — ✅ 准确

| 重复项 | 审计位置 | 实测 |
|--------|---------|------|
| parseChapterRange | context-engine.ts:556 & memory-updater.ts:28 | ✅ 确认 |
| estimateTokens | context-engine.ts:64 & memory-engine.ts:23 | ✅ 确认 |
| typeLabel Record | context-engine.ts 行 111/266/493 | ✅ 确认（3 次完全相同） |
| AI_MODELS | AppShell.tsx:44 & model-config.ts | ✅ 确认，需手动同步 |

### 4.7 `as any` 类型逃逸 — ⚠️ 低估

**审计**：30+ 处（context-engine 20+ / memory-updater 10+）  
**实测**：**126 处** 跨 18 文件

| 文件 | 审计 | 实测 |
|------|------|------|
| context-engine.ts | 20+ | 16 |
| memory-updater.ts | 10+ | 9 |
| mock-backend.ts | （未列） | **20** |
| WorldviewPanel.tsx | （未列） | **14** |
| SettingsModal.tsx | （未列） | 12 |
| CharactersModule.tsx | （未列） | 13 |
| 其余 12 文件 | — | 42 |

**结论**：总数低估 4 倍，分布文件数低估（审计只点 2 个文件，实际 18 个）。

### 4.8 推测性功能 — ✅ 准确

[model-config.ts](file:///f:/Projects/ai-novel-writer/src/lib/model-config.ts) 确认含 `gpt-5.5`、`gpt-5.4`、`claude-opus-4-8`、`claude-sonnet-4-6` 等不存在模型名。

---

## 四、Rule 8 深挖验证（紧耦合）

### 5.1 数据键域所有权 — ✅ 方向准确

`plot-chapters-{pid}` 跨模块裸读确认：审计称 9 个越权访问者，实测 grep 确认（WritingModule / AiChatPanel / SettingsModal / context-engine / StoryBible / WritingStats / use-project-data / mock-backend / migrate-data / Rust export）实际 **10 处**（含 Rust 导出），审计少算 1。

### 5.2 localStorage 裸调用 — ⚠️ 严重低估

**审计**：~17 处（StoryBible 11 / AiChatPanel 3 / AppShell 1 / Outline 1 / Inspiration 1）  
**实测**：**93 处** 跨 16 文件

| 文件 | 审计 | 实测 |
|------|------|------|
| StoryBibleModule.tsx | 11 | **16** |
| AiChatPanel.tsx | 3 | **9** |
| backup.ts | （未列，但在 B2 提及） | 12 |
| mock-backend.ts | （未列） | **17** |
| storage.ts | （自身实现） | 11 |
| OutlineModule.tsx | 1 | 4 |
| WelcomeScreen.tsx | （未列） | 4 |
| SettingsModal.tsx | （未列） | 4 |
| version-check.ts | （未列） | 3 |
| 其余 | — | — |

**结论**：审计只统计了 UI 组件层的裸调用，漏算了 lib 层（backup/mock-backend/storage 自身）。REMEDIATION 阶段 8 工作量被低估。

### 5.3 耦合热力图 — ⚠️ 数据偏低

| 模块 | 审计被引用 | 实测 |
|------|-----------|------|
| api.ts | 16 | **21** |
| app-store | 18 | **27**（不含 .bak） |
| storage.ts | 8+14 bypass | 8+16 bypass（getJSONSync 20 文件） |

**结论**：所有耦合度数字偏低，实际债务更重。

---

## 五、Rule 9 验证（零测试覆盖）— ✅ 准确

**实测**：
- `package.json` grep `test|vitest|jest` → **无匹配**
- 项目无 `*.test.ts` / `*.test.tsx` 文件
- 无 vitest/jest 配置

**结论**：准确，零自动化测试确认。

---

## 六、META-REVIEW 修正项验证

| META-REVIEW 修正 | 实测 | 评价 |
|-----------------|------|------|
| storage.ts 12 函数（非 16） | ✅ 12 个导出 | 正确 |
| AiChatPanel 2431 行 | ✅ 2432（差 1 行尾换行） | 正确 |
| WritingModule 1707 行 | ✅ 1708 | 正确 |
| `list_app_settings` 已存在 | ✅ [db_cmds.rs:1140](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs) + [lib.rs:63](file:///f:/Projects/ai-novel-writer/src-tauri/src/lib.rs) 已注册 | 正确 |
| `.ok()` 不能全改 `?` | ✅ 42 处中含 DELETE 容错/迁移容错 | 正确 |
| getJSONSync 93 处 | ❌ 实测 **104 处** | 偏低 |
| setJSONSync 42 处 | ❌ 实测 **50 处** | 偏低 |

---

## 七、审计文档遗漏的问题（查漏补缺）

### 🔴 漏报 1：Rust 9 处 `serde_json::to_string().unwrap()`
[db_cmds.rs:468, 469, 494, 553, 575, 705, 780, 842, 917](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs) 共 9 处。REMEDIATION 阶段 2 只覆盖互斥锁和 `.expect()`，未覆盖这 9 处。

### 🟡 漏报 2：`reqwest` 的 `multipart` 特性在用
[ai.rs:205-213](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/ai.rs) STT 上传使用。REMEDIATION 阶段 2.6 必须保留 `multipart`，只删 `stream`。

### 🟡 漏报 3：`tokio` 用 `full` feature 可精简
[Cargo.toml](file:///f:/Projects/ai-novel-writer/src-tauri/Cargo.toml) `tokio = { version = "1", features = ["full"] }`，实际只需 `["rt-multi-thread", "macros"]`，可减小 EXE 体积。

### 🟡 漏报 4：互斥锁 `.unwrap()` 还有 2 处未列
除 [db_cmds.rs:211](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs)，[db/mod.rs:61](file:///f:/Projects/ai-novel-writer/src-tauri/src/db/mod.rs) 和 [db/mod.rs:70](file:///f:/Projects/ai-novel-writer/src-tauri/src/db/mod.rs) 也是 `state.0.lock().unwrap()`，REMEDIATION 阶段 2.2 只改了一处。

### 🟡 漏报 5：`as any` 实际 126 处（非 30+）
分布 18 文件（非 2 文件）。REMEDIATION S14 工作量被严重低估。

### 🟡 漏报 6：localStorage 裸调用 93 处（非 ~17）
含 lib 层（backup 12 / mock-backend 17）。REMEDIATION 阶段 8 只列了 UI 组件。

### 🟢 漏报 7：StoryBible 第 642 行单行 7 次裸调
[StoryBibleModule.tsx:642](file:///f:/Projects/ai-novel-writer/src/modules/story-bible/StoryBibleModule.tsx) 一行内 7 次 `localStorage.getItem` 塞进 try-catch，是 EXE 下数据丢失重灾区，REMEDIATION 未单独标注。

### 🟢 漏报 8：lib.rs:66 `.expect()` 崩溃
[lib.rs:66](file:///f:/Projects/ai-novel-writer/src-tauri/src/lib.rs) `.expect("error while running tauri application")`，Tauri 启动失败会 panic。虽属框架层，但 EXE 交付应改友好提示。

---

## 八、修复方案（REMEDIATION-PLAN）执行性评估

| 阶段 | 可行性 | 关键问题 |
|------|--------|---------|
| **0 测试基建** | ✅ | package.json 确认无 test，纯新增安全 |
| **1 storage** | ✅ | META-REVIEW 保留同步 API 的修正正确；**但废弃别名设计有缺陷**（见下） |
| **2 Rust** | ⚠️ | 需补 9 处 `to_string().unwrap()`；`multipart` 不能删；互斥锁还有 2 处 |
| **3 chapter-store** | ✅ | 8 文件改调用，三写确认可删第三份 |
| **4 快照分片** | ⚠️ | 分片事务性未给方案（META-REVIEW 已点出） |
| **5 context-engine** | ✅ | typeLabel 3 次重复确认，机械提取 |
| **6 WritingModule 拆分** | ⚠️ | useAiWriting 依赖 10+ 变量，WritingContext 中介方案正确 |
| **7 AiChatPanel 拆分** | ⚠️ | 双向依赖（chat↔pending chars）需 store 中介 |
| **8 localStorage 收口** | ⚠️ | 工作量低估（93 处非 17 处，含 lib 层） |
| **9 SettingsModal 拆分** | ✅ | 边界清晰 |
| **10 store 拆分** | ⚠️ | 兼容导出层有性能风险（META-REVIEW 已点出） |

### 阶段 1 废弃别名设计缺陷
REMEDIATION 称 `setJSONSync` 作为废弃别名指向 `saveJSON`（返回 `boolean`）。但现有 50 处 `setJSONSync` 调用都是 `void` 上下文，TypeScript 不会强制检查返回值，等于**静默丢失错误检查**。
**建议**：别名应返回 `void`，内部调用 `saveJSON` 并自行处理失败（reportDiagnostic），让 50 个调用点在阶段 3-10 逐步迁移到显式检查 `saveJSON` 返回值。

---

## 九、综合评定

| 维度 | FULL-AUDIT | META-REVIEW | 综合 |
|------|-----------|-------------|------|
| 方向准确性 | ✅ 90% | ✅ 95% | 所有 Bug 和设计缺陷方向正确 |
| 数量准确性 | ⚠️ 60% | ⚠️ 75% | 普遍低估（as any 30+→126、catch 50+→119、localStorage 17→93） |
| 位置准确性 | ⚠️ 85% | ✅ 95% | 个别 Rust 行号/位置有小偏差 |
| 漏报项 | — | — | 9 处 unwrap、multipart 在用、tokio full、2 处互斥锁 |
| 修复方案可行性 | — | ⚠️ 80% | 阶段 1 别名、阶段 2 multipart、阶段 8 工作量需修正 |

**总体**：三份文档质量良好，Bug 定位准确，可作为重构依据。但**所有"数量"类数据偏低**，执行前需按本报告修正工作量估算。META-REVIEW 的技术修正（保留同步 API、`.ok()` 分类、WritingContext 中介）均正确，应采纳。

---

## 十、执行前必读修正清单

1. **阶段 2 补全**：增加 [db_cmds.rs](file:///f:/Projects/ai-novel-writer/src-tauri/src/commands/db_cmds.rs) 9 处 `to_string().unwrap()` → `map_err`；互斥锁再修 [db/mod.rs:61,70](file:///f:/Projects/ai-novel-writer/src-tauri/src/db/mod.rs)。
2. **阶段 2 修正**：Cargo.toml 只删 `stream`，**保留 `multipart`**；可顺手精简 `tokio` 为 `["rt-multi-thread", "macros"]`。
3. **阶段 1 修正**：废弃别名 `setJSONSync` 返回 `void` 并内部自检，避免 50 个调用点静默丢错。
4. **阶段 4 补方案**：快照分片采用"写新→更新索引→删旧"事务顺序，失败保留旧格式。
5. **阶段 8 扩范围**：从 UI 组件扩展到 lib 层（backup.ts 12 处、mock-backend.ts 17 处），总工作量 93 处非 17 处。
6. **S14 扩范围**：`as any` 治理覆盖 18 文件 126 处，非 2 文件 30+ 处。
