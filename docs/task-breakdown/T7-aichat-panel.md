# T7 — AiChatPanel.tsx 拆分

> 任务 ID：T7  
> 优先级：**P1**（2432 行 God File + 耦合 4 模块）  
> 前置依赖：T3, T5

---

## 任务目标

将 AiChatPanel.tsx（2432 行）拆分为 4 个文件，每个 < 600 行。解决与 WritingModule/CharactersModule 的双向依赖（chat ↔ pending chars）。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/layouts/AiChatPanel.tsx`（瘦身到 ~600 行） |
| 新建 | `src/layouts/usePendingCharacters.ts` |
| 新建 | `src/layouts/CharacterApplyButton.tsx` |
| 新建 | `src/lib/character-parser.ts` |

## 子任务清单

- [ ] T7.1 抽取 `character-parser.ts`（~200 行）：`parseCharacterBatch` 纯函数（从 `---CHARACTERS---` 块提取 JSON）
- [ ] T7.2 抽取 `usePendingCharacters.ts`（~300 行）：pendingChars / pendingCharEdges / pendingSnapshots / pendingRemoveEdges 状态 + loadedRef + loadPendingChars + applyAll 中角色增删改
- [ ] T7.3 抽取 `CharacterApplyButton.tsx`（~200 行）："应用到星图"按钮渲染 + 确认/执行流程
- [ ] T7.4 AiChatPanel.tsx 瘦身（~600 行）：聊天 UI + 消息渲染 + STT
- [ ] T7.5 修复 9 处 localStorage 裸调（实测 9 处，非 3 处）：
  - `AiChatPanel.tsx:531` `localStorage.getItem("ai-pending-chars-")` → `loadJSON`
  - `AiChatPanel.tsx:830` `localStorage.getItem("novel-workbench-mock")` → 通过 api 读
  - `AiChatPanel.tsx:947` `localStorage.setItem("plot-chapters-")` → `saveChapter`（T3）
  - 其余 6 处逐个替换
- [ ] T7.6 双向依赖通过 store 中介（pending chars 提到 chat-store 或 usePendingCharacters 独立 hook）
- [ ] T7.7 治理 AiChatPanel 内 6 处 `as any`
- [ ] T7.8 验证：T0 测试 + tsc + build

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全绿 |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | AiChatPanel.tsx 行数 | ≤ 600 行 |
| A5 | 各新文件行数 | 各 < 350 行 |
| A6 | grep `localStorage` AiChatPanel.tsx | **0 处**（9 处全清） |
| A7 | grep `as any` AiChatPanel.tsx | ≤ 2 处（从 6 降） |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 聊天面板发消息 | AI 流式回复正常 |
| M2 | AI 建议创建角色 → "应用到星图" | 角色出现在人物关系图 |
| M3 | AI 建议创建快照 | 快照保存成功 |
| M4 | 重复应用同一批角色 | 去重或提示，不重复创建 |
| M5 | 关闭重开 → 历史对话 | 保留 |
| M6 | STT 语音输入 | 正常 |

## 证据清单（我必须提交）

1. `git diff --stat` 输出（1 改 + 3 新建）
2. `npm run test` + `tsc --noEmit` + `build` 输出
3. AiChatPanel.tsx 行数（≤ 600）
4. grep `localStorage` AiChatPanel.tsx 输出（0 处）
5. grep `localStorage` AiChatPanel.tsx 前后对比（9 → 0）
6. `usePendingCharacters.ts` 全文（Read 工具）
7. `character-parser.ts` 全文（Read 工具，证明纯函数）

## 验收清单（你勾选）

- [ ] V1 证据 1-3：编译测试通过
- [ ] V2 证据 4-5：行数达标 + localStorage 清零
- [ ] V3 证据 6-7：抽取文件存在且合理
- [ ] V4 手动 M2：应用到星图正常
- [ ] V5 手动 M4：重复应用去重
- [ ] V6 手动 M5：历史对话保留

## 回退方案

```bash
git checkout 418c623 -- src/layouts/AiChatPanel.tsx
rm -f src/layouts/usePendingCharacters.ts src/layouts/CharacterApplyButton.tsx src/lib/character-parser.ts
```
