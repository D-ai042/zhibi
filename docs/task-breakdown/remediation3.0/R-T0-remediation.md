# R-T0 — tsc 类型错误修复

> 对应验收：V-T0（`verification3.0/T0-verification.md`）  
> 优先级：**P0**（阻塞全部后续任务的 A2/tsc 自动化标准）

---

## 问题描述

`npm run tsc --noEmit` 返回 **11 条类型错误**，集中在 3 个旧文件：

| 文件 | 错误数 | 错误码 | 示例 |
|------|:--:|------|------|
| `src/lib/mock-backend.ts` | 8 | TS2352/TS6133/TS2304/TS18004 | 类型转换不当、未声明变量 `matched`/`key` |
| `src/lib/quality-checker.ts` | 1 | TS6196 | `ForeshadowEntry` import 未使用 |
| `src/modules/characters/CharacterNode.tsx` | 2 | TS2344 | `CharacterNodeData` 不满足 `Node<>` 泛型约束 |

---

## 影响范围

T0~T10 所有任务的 A2（`npm run tsc --noEmit`）均被此错误阻塞。必须优先修复。

---

## 具体改动

### 1. `src/lib/quality-checker.ts`（1 处 — 最简单）

| 操作 | 内容 |
|------|------|
| 删除 | 第 10 行 `import type { ForeshadowEntry, ... }` 中的 `ForeshadowEntry` |

```diff
- import type { ForeshadowEntry, StoryBible, StyleGuide } from "@/types";
+ import type { StoryBible, StyleGuide } from "@/types";
```

---

### 2. `src/modules/characters/CharacterNode.tsx`（1 处）

| 操作 | 内容 |
|------|------|
| 修改 | 第 12 行泛型参数改 `Node<Record<string, unknown>>` 或加 `id`/`position`/`data` 属性 |

两种方案：
- **方案 A（最小改动）**：`function CharacterNode({ data, selected }: NodeProps<Record<string, unknown>>)` + 内部 `as CharacterNodeData`
- **方案 B（类型安全）**：为 `CharacterNodeData` 补充 `id`、`position`、`data` 字段

推荐方案 A（不改类型定义，不影响其他引用方）。

---

### 3. `src/lib/mock-backend.ts`（8 处 — 最复杂）

| 行号范围 | 错误 | 修复 |
|---------|------|------|
| 974-978 | TS2352 ×5：`normalizeItem(x as Record<string, unknown>)` | 加中间转换 `x as unknown as Record<string, unknown>` |
| 1086 | TS6133：`prefixes` 声明未使用 | 删除该变量声明 |
| 1098 | TS2304：`matched` 未声明 | 补充 `const matched = ...` 或删除相关代码块 |
| 1099 | TS2304：`key` 未声明 | 同上，在适当的循环中声明 |
| 1100 | TS18004：`{ key, value }` 缺少 `key` | 同上 |

需要读取第 1086-1105 行完整上下文后再确定最佳修复方式。

---

## 验证标准

- [ ] `npm run tsc --noEmit` **0 错误**
- [ ] `npm run test` 28 用例全绿（回归验证）
- [ ] `npm run build` 通过

---

## 预估影响

| 修改文件 | 改动量 | 风险评估 |
|---------|:--:|------|
| `quality-checker.ts` | 1 行 | 无风险 |
| `CharacterNode.tsx` | 1 行 | 低风险（不影响渲染） |
| `mock-backend.ts` | ~10 行 | 中风险（dev mock 模式受影响） |
