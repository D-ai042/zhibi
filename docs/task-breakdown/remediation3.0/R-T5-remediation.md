# R-T5 — buildProjectContext 直调改 assembleContext 统一入口

> 对应验收：V-T5（`verification3.0/T5-verification.md`）  
> 优先级：**P1**（不阻塞，但 T5.1 合并不彻底）

---

## 问题描述

T5.1 要求 `loadContextPanelData` + `buildProjectContext` → 统一 `assembleContext(mode)`。当前 `assembleContext` 存在但 **2 处仍直调 `buildProjectContext`**：

| 调用方 | 行号 | 调用 |
|--------|------|------|
| `WritingModule.tsx` | 842 | `buildProjectContext({...})` |
| `useAiWriting.ts` | 83 | `buildProjectContext({...})` |

---

## 具体改动

### 1. `useAiWriting.ts:83`

```diff
- const output = await buildProjectContext({
-     projectId: pid,
-     chapterId: currentChapter.id,
- });
+ const output = await assembleContext(pid, currentChapter.id, "ai") as ContextEngineOutput;
```

### 2. `WritingModule.tsx:842`

```diff
- const output = await buildProjectContext({
-     projectId: pid,
-     chapterId: ch.id,
- });
+ const output = await assembleContext(pid!, ch.id, "ai") as ContextEngineOutput;
```

### 3. 可选：将 `buildProjectContext` 从 export 改为内部函数

```diff
- export async function buildProjectContext(input: ContextEngineInput): Promise<ContextEngineOutput> {
+ async function buildProjectContext(input: ContextEngineInput): Promise<ContextEngineOutput> {
```

---

## 验证标准

### 自动化

- [ ] `npm run build` 通过
- [ ] `npm run test` 全绿
- [ ] grep `import.*buildProjectContext` src/：**0 处**（除 context-engine 自身定义）

### 手动测试清单

> 验收方逐项操作勾选，一项不通过即判定 R-T5 未完成。

| # | 操作步骤 | 预期结果 | 对应验收 |
|---|---------|---------|:--:|
| M1 | 打开写作页面，展开上下文面板 | 上下文面板显示角色/世界设定/最近章节摘要，无报错 | V-T5 V7 |
| M2 | 点击"AI 写本章"，等待生成完成 | AI 生成内容基于正确的上下文数据，不报类型错误 | V-T5 V7 |

---

## 预估影响

| 文件 | 改动量 | 风险评估 |
|------|:--:|------|
| `useAiWriting.ts` | 3 行 | 低 |
| `WritingModule.tsx` | 3 行 | 低 |
| `context-engine.ts` | 1 行（去掉 export） | 低 |
