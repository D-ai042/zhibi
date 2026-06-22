# R-T7 — AiChatPanel.tsx 瘦身

> 对应验收：V-T7（`verification3.0/T7-verification.md`）  
> 优先级：**P0**（God File 2306 行 → ≤600 行）

---

## 问题描述

T7.4 要求 AiChatPanel.tsx ≤600 行。当前 **2306 行**，3 个子文件已抽取但主文件未移交逻辑。

| 子文件 | 行数 | 当前状态 |
|--------|:--:|------|
| `character-parser.ts` | 52 | ✅ 独立可用 |
| `usePendingCharacters.ts` | 43 | 含 hook，主文件未用 |
| `CharacterApplyButton.tsx` | 27 | 含按钮组件，主文件未用 |

---

## 剩余架构

主文件 2306 行中可移走的模块：

| 模块 | 约行数 | 目标位置 |
|------|:--:|------|
| 聊天消息渲染（消息气泡/Markdown/代码块） | ~400 行 | `ChatMessageBubble.tsx`（新建） |
| STT 语音输入 + 音频录制 | ~250 行 | `useSttVoice.ts`（新建） |
| Pending 角色应用流程 | ~200 行 | 现有 `usePendingCharacters.ts` + `CharacterApplyButton.tsx` |
| AI 流式响应处理 | ~300 行 | `useAiChatStream.ts`（新建） |
| 消息历史管理 | ~200 行 | 内联到 hook 中 |
| 上下文模块切换 | ~150 行 | 独立组件 |
| 壳（组合） | ≤300 行 | `AiChatPanel.tsx` |
| **总计** | **~1800 移出** | **主文件 ~500 行** |

---

## 具体改动策略

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/layouts/ChatMessageBubble.tsx` | 聊天消息渲染（提取 `renderMessage` 函数） |
| `src/layouts/useSttVoice.ts` | STT 语音输入 hook |
| `src/layouts/useAiChatStream.ts` | AI 流式响应 hook |

### 强化现有文件

| 文件 | 当前行数 | 目标行数 | 需移入逻辑 |
|------|:--:|:--:|------|
| `usePendingCharacters.ts` | 43 | ~250 | pending 角色全生命周期 |
| `CharacterApplyButton.tsx` | 27 | ~200 | 确认/执行/去重流程 |

### 迁移步骤

1. 抽 STT → `useSttVoice.ts`（独立性强，先做）
2. 抽流式响应 → `useAiChatStream.ts`
3. 抽消息渲染 → `ChatMessageBubble.tsx`
4. 补齐 pending 角色逻辑 → 现有文件
5. 主文件瘦身为壳

---

## 验证标准

### 自动化

- [ ] `npm run build` 通过
- [ ] `npm run test` 全绿
- [ ] AiChatPanel.tsx ≤ **600 行**

### 回归测试计划

> 此为 P0 高风险重构，**每迁移一个子模块后**必须执行以下快速回归：
> 1. `npm run build` — 编译零错误
> 2. 冒烟测试（M1）— 发消息+流式回复链路不断

### 手动测试清单

> 验收方逐项操作勾选，一项不通过即判定 R-T7 未完成。

| # | 操作步骤 | 预期结果 | 对应验收 |
|---|---------|---------|:--:|
| M1 | 在 AI 对话面板输入消息 → 发送 → 等待回复 | AI 流式逐字返回，Markdown 正确渲染（代码块/表格/列表） | V-T7 V4 |
| M2 | 点击麦克风按钮 → 说话 → 停止录音 | 语音识别结果填入输入框 | V-T7 V4 |
| M3 | AI 返回含角色设定的回复 → 点击"应用到星图" | 角色成功添加到角色面板，确认弹窗显示详情 | V-T7 V4 |
| M4 | 对同一角色再次点击"应用到星图" | 提示"角色已存在"或自动去重，不重复创建 | V-T7 V5 |
| M5 | 关闭 AI 面板 → 重新打开 | 历史对话消息完整保留 | V-T7 V6 |

---

## 预估影响

| 文件 | 改动量 | 风险评估 |
|------|:--:|------|
| `AiChatPanel.tsx` | -1700 行 | 高（核心聊天流程重构） |
| `ChatMessageBubble.tsx`（新建） | +400 行 | 中 |
| `useSttVoice.ts`（新建） | +250 行 | 中 |
| `useAiChatStream.ts`（新建） | +300 行 | 中 |
| `usePendingCharacters.ts` | +200 行 | 低 |
| `CharacterApplyButton.tsx` | +170 行 | 低 |
