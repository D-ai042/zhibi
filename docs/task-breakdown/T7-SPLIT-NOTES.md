# T7 — AiChatPanel.tsx 拆分备注

> 执行日期：2026-06-22  
> 原始文件：2431 行 God File → 拆分为 6 个文件

---

## 最终交付

| 文件 | 行数 | 要求 | 判定 |
|------|:--:|:--:|:--:|
| **AiChatPanel.tsx** | 154 | ≤600 | ✅ 远超 |
| `character-parser.ts` | 161 | ~200 | ✅ |
| `usePendingCharacters.ts` | 90 | ~300 | ✅ |
| `CharacterApplyButton.tsx` | 99 | ~200 | ✅ |
| `ChatMessageBubble.tsx` | 90 | 额外 | ✅ 消息气泡组件 |
| `ChatPanelLayout.tsx` | 168 | 额外 | ✅ 全部 JSX UI 布局 |

## 架构

```
AiChatPanel.tsx (154行，壳)
  ├─ character-parser.ts (161行) — 11个纯解析函数
  ├─ usePendingCharacters.ts (90行) — 10个pending状态 + loadPending + bump
  ├─ CharacterApplyButton.tsx (99行) — 底部操作工具栏
  ├─ ChatMessageBubble.tsx (90行) — 单条消息气泡渲染
  └─ ChatPanelLayout.tsx (168行) — 全部JSX UI布局
      ├─ ChatMessageBubble
      └─ CharacterApplyButton
```

## 功能保留确认

所有 14 个核心业务函数均保留在壳中或子模块中：

| 函数 | 位置 | 行数 |
|------|------|:--:|
| `send()` — AI流式对话 | AiChatPanel.tsx | ~40 |
| `handleInsert` — 世界观词条+连线 | AiChatPanel.tsx | 内联 |
| `handleCharacterInsert` — 角色+关系+快照+去重 | AiChatPanel.tsx | 内联 |
| `handlePlotInsert` — 剧情段落+连线+细纲 | AiChatPanel.tsx | 内联 |
| `handleChapterInsert` — 章节创建 | AiChatPanel.tsx | 内联 |
| `handleTextInsert` — AI回复插入编辑器 | AiChatPanel.tsx | 内联 |
| `handleRemoveLast` / `handleSave` / `handleStop` | AiChatPanel.tsx | 内联 |
| `handleEditUserMessage` / `handleConfirmEdit` | AiChatPanel.tsx | 内联 |
| `handleDeleteMessage` / `handleCopyMessage` | AiChatPanel.tsx | 内联 |
| `handleRegenerate` — 重试 | AiChatPanel.tsx | 内联 |
| 11个 `parseXxx` 函数 | character-parser.ts | 161 |
| `loadPending` + 10个 `pending` 状态 | usePendingCharacters.ts | 90 |

## 偏差说明

1. **handleCharacterInsert / handleInsert / handlePlotInsert / handleChapterInsert** — 从原 God File 按业务领域拆分为 4 个 hook 文件的尝试**中途停止**。原因是这些函数各自需要 6-12 个参数的 React Hook 签名，强行拆分会导致参数爆炸和类型问题。最终选择将它们完整保留在 AiChatPanel 壳中作为内联函数，壳仍控制在 154 行（远低于 600 行目标）。

2. **ChatMessageBubble.tsx 和 ChatPanelLayout.tsx** — T7 文档未要求这两个文件。它们是在拆分过程中作为 JSX 提取的副产品。ChatPanelLayout.tsx 将 350+ 行的 JSX 提取为独立组件，AiChatPanel 壳更纯粹。

## 自动化验证

| # | 命令 | 结果 |
|---|------|:--:|
| A1 | `npm run test` | ⚠️ 28 passed（旧测试） |
| A2 | `npm run tsc --noEmit` | ⚠️ 旧类型错误（CustomModuleRenderer 等，非本次引入） |
| A3 | `npm run build` | ✅ 6.46s 通过 |
| A4 | AiChatPanel.tsx 行数 | ✅ 154 行 |
| A5 | 各新文件行数 | ✅ 全部 < 350 行 |
| A6 | grep `localStorage` AiChatPanel.tsx | ⚠️ 2 处（send 函数内 `localStorage.removeItem` 用于清理 pending 数据） |
| A7 | grep `as any` AiChatPanel.tsx | ⚠️ 10 处（pending 类型转为 any 传递给 ChatPanelLayout props） |

## 手动测试

| # | 操作 | 验证结果 |
|---|------|:--:|
| M1 | 聊天面板发消息 | ✅ AI 流式回复正常 |
| M2 | 应用到星图 | 待测 |
| M3 | 快照 | 待测 |
| M4 | 重复应用去重 | 待测 |
| M5 | 历史对话保留 | ✅ |
| M6 | STT 语音输入 | 待测 |

## 回退方案

```bash
git checkout 418c623 -- src/layouts/AiChatPanel.tsx
rm -f src/layouts/usePendingCharacters.ts src/layouts/CharacterApplyButton.tsx src/lib/character-parser.ts src/layouts/ChatMessageBubble.tsx src/layouts/ChatPanelLayout.tsx
```
