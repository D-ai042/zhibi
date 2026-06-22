# T3 — chapter-store 新建

> 任务 ID：T3  
> 优先级：**P0**（冗余三写 + 10 处越权裸读）  
> 前置依赖：T1

---

## 任务目标

新建 `chapter-store.ts` 作为章节数据唯一入口，消除 `plot-chapters-{pid}` 全量聚合缓存（三写冗余），收口 10 处越权裸读。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 新建 | `src/lib/chapter-store.ts` |
| 修改 | `src/modules/writing/WritingModule.tsx` |
| 修改 | `src/lib/context-engine.ts` |
| 修改 | `src/layouts/AiChatPanel.tsx` |
| 修改 | `src/modules/story-bible/StoryBibleModule.tsx` |
| 修改 | `src/components/settings/SettingsModal.tsx` |
| 修改 | `src/modules/overview/WritingStatsPanel.tsx` |
| 修改 | `src/hooks/use-project-data.ts` |
| 修改 | `src-tauri/src/commands/db_cmds.rs`（若 Rust 侧也直读该 key） |

## 子任务清单

- [ ] T3.1 新建 `src/lib/chapter-store.ts`，导出：
  - `loadAllChapters(pid): PlotChapter[]`
  - `loadChapter(pid, id): PlotChapter | null`
  - `saveChapter(pid, chapter): { ok: boolean; error?: string }`
  - `saveChapters(pid, chapters[]): { ok: boolean; error?: string }`
  - `deleteChapter(pid, id): void`
- [ ] T3.2 内部实现：只存 `chapter-{pid}-{id}`（逐章）+ `chapter-index-{pid}`（索引），**删除 `plot-chapters-{pid}` 全量聚合缓存**
- [ ] T3.3 兼容旧数据：首次 loadAllChapters 时若发现 `plot-chapters-{pid}` 旧 key，迁移为逐章存储后删除旧 key
- [ ] T3.4 `WritingModule.tsx`：删除本地 `loadChapters`/`saveChapters`，改 import chapter-store；`saveContent` 改调 `saveChapter`（增量，只写当前章）
- [ ] T3.5 `context-engine.ts`：5 处 `getJSONSync("plot-chapters-")` → `loadAllChapters(pid)`
- [ ] T3.6 `AiChatPanel.tsx`：2 处 plot-chapters 读写 → `loadAllChapters` / `saveChapter`
- [ ] T3.7 `StoryBibleModule.tsx`：3 处 `localStorage.getItem("plot-chapters-")` → `loadAllChapters`
- [ ] T3.8 `SettingsModal.tsx` / `WritingStatsPanel.tsx` / `use-project-data.ts`：各自 plot-chapters 直读改 `loadAllChapters`
- [ ] T3.9 Rust 侧若直读该 key，统一走 db_cmds 查询
- [ ] T3.10 验证：T0 测试 + build

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 含 chapter-store 测试全绿 |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | grep `plot-chapters-` src/ | **0 处**（除 chapter-store 内部迁移逻辑外） |
| A5 | grep `saveChapters\|loadAllChapters` src/ | 调用点来自 chapter-store 统一入口 |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 写 5 章 → 关闭重开 | 章节全部保留 |
| M2 | 写第 26 章 → 重开 | 内容在（B1 回归） |
| M3 | 删除某章 → 重开 | 该章确实删除，其余保留 |
| M4 | 旧项目（含 plot-chapters 旧 key）打开 | 自动迁移，数据完整 |

## 证据清单（我必须提交）

1. `git diff --stat` 输出（证明 8+ 文件改动）
2. `npm run test` + `npm run tsc --noEmit` + `npm run build` 三项输出
3. `chapter-store.ts` 全文（Read 工具）
4. grep `plot-chapters-` src/ 输出（证明 0 处残留，迁移逻辑除外）
5. grep `localStorage.getItem.*plot-chapters` src/ 输出（0 处）
6. `WritingModule.tsx` saveContent 改动行（Read 工具，证明增量保存）

## 验收清单（你勾选）

- [ ] V1 证据 1-3：编译 + 测试通过
- [ ] V2 证据 4：plot-chapters- 裸读清零
- [ ] V3 证据 5：localStorage 裸读 plot-chapters 清零
- [ ] V4 证据 6：saveContent 改为增量保存
- [ ] V5 手动 M1-M2：章节保存重开不丢（含第 26 章）
- [ ] V6 手动 M3：删除章节生效
- [ ] V7 手动 M4：旧项目迁移成功

## 回退方案

```bash
git checkout 418c623 -- src/modules/writing/WritingModule.tsx src/lib/context-engine.ts src/layouts/AiChatPanel.tsx src/modules/story-bible/StoryBibleModule.tsx src/components/settings/SettingsModal.tsx src/modules/overview/WritingStatsPanel.tsx src/hooks/use-project-data.ts src-tauri/src/commands/db_cmds.rs
rm -f src/lib/chapter-store.ts
```
