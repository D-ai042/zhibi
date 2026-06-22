# T6 — WritingModule.tsx 拆分

> 任务 ID：T6  
> 优先级：**P1**（1708 行 God File）  
> 前置依赖：T3, T5

---

## 任务目标

将 WritingModule.tsx（1708 行）拆分为 6 个文件，每个 < 300 行。使用 WritingContext 中介解决 `useAiWriting` 依赖 10+ 外部变量的参数爆炸问题。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/modules/writing/WritingModule.tsx`（瘦身到 ~250 行） |
| 新建 | `src/modules/writing/ChapterTree.tsx` |
| 新建 | `src/modules/writing/ChapterEditor.tsx` |
| 新建 | `src/modules/writing/ContextPanel.tsx` |
| 新建 | `src/modules/writing/AiWriteChapterDialog.tsx`（若与现有 components/editor 的不同） |
| 新建 | `src/modules/writing/useAiWriting.ts` |
| 新建 | `src/modules/writing/WritingContext.tsx`（中介） |

## 子任务清单

- [ ] T6.1 新建 `WritingContext.tsx`：提供 chapters / currentChapter / saveContent / autosaveStatus 等，作为 useAiWriting 的依赖中介
- [ ] T6.2 抽取 `ChapterTree.tsx`（~200 行）：章节树渲染 + 拖拽 + 增删改
- [ ] T6.3 抽取 `ChapterEditor.tsx`（~250 行）：TipTap 编辑器 + 工具栏 + 保存
- [ ] T6.4 抽取 `ContextPanel.tsx`（~200 行）：上下文面板，调 T5 的 `assembleContext(mode="panel")`
- [ ] T6.5 抽取 `useAiWriting.ts`（~200 行）：AI 写本章/润色/去AI味/续写，通过 WritingContext 取依赖而非参数传递
- [ ] T6.6 抽取定稿流程为 `finalizeChapter`（返回 `{ ok, steps }` 多步结果对象，非静默）
- [ ] T6.7 WritingModule.tsx 瘦身为壳（~250 行）：组合上述组件 + WritingContext.Provider
- [ ] T6.8 `App.tsx` import 不变（WritingModule 仍从同目录导出）
- [ ] T6.9 治理 WritingModule 内 8 处 `as any`
- [ ] T6.10 验证：T0 测试 + tsc + build

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全绿 |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | 统计各新文件行数 | 每个 < 300 行 |
| A5 | WritingModule.tsx 行数 | ≤ 300 行 |
| A6 | grep `as any` WritingModule.tsx | ≤ 2 处（从 8 降） |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 写 → 保存 → 定稿 → AI 写 → 润色 → 去 AI 味 → 撤销 → 重做 | 全流程正常 |
| M2 | 上下文面板展开/折叠 | 数据与 AI 收到一致 |
| M3 | 章节树拖拽/增删 | 正常 |
| M4 | 第 26 章保存重开 | 内容在（B1 回归） |
| M5 | 定稿失败 | 收到明确错误（非静默成功） |

## 证据清单（我必须提交）

1. `git diff --stat` 输出（证明 1 改 + 6 新建）
2. `npm run test` + `tsc --noEmit` + `build` 输出
3. 各新文件行数统计（RunCommand `wc -l` 或等价）证明每个 < 300
4. WritingModule.tsx 行数（≤ 300）
5. `WritingContext.tsx` 全文（Read 工具，证明中介存在）
6. `finalizeChapter` 返回 steps 结构代码（Read 工具，证明非静默）

## 验收清单（你勾选）

- [ ] V1 证据 1-3：编译测试通过
- [ ] V2 证据 4-5：每个文件 < 300 行
- [ ] V3 证据 6：WritingContext 中介存在
- [ ] V4 证据 7：finalizeChapter 多步结果对象
- [ ] V5 手动 M1：全流程正常
- [ ] V6 手动 M4：第 26 章不丢
- [ ] V7 手动 M5：定稿失败有反馈

## 回退方案

```bash
git checkout 418c623 -- src/modules/writing/WritingModule.tsx
rm -f src/modules/writing/ChapterTree.tsx src/modules/writing/ChapterEditor.tsx src/modules/writing/ContextPanel.tsx src/modules/writing/useAiWriting.ts src/modules/writing/WritingContext.tsx
```
