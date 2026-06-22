# R-T10 — app-store.ts 瘦身 + re-export

> 对应验收：V-T10（`verification3.0/T10-verification.md`）  
> 优先级：**P0**（God File 369 行 → ≤200 行，6 个 slice 为孤立空壳）

---

## 问题描述

T10.7 要求 `app-store.ts` ≤200 行，改为 re-export 组合入口。当前 **369 行**，6 个 slice 文件存在但**未被主文件 import**（空壳）。

---

## 当前与目标对比

```
当前：
  app-store.ts (369 行, 单体 Zustand store)
  app-store/project-slice.ts         (27 行, 孤立)
  app-store/chapter-slice.ts         (27 行, 孤立)
  app-store/character-slice.ts       (19 行, 孤立)
  app-store/ui-slice.ts              (27 行, 孤立)
  app-store/writing-history-slice.ts (54 行, 孤立)
  app-store/writing-state-slice.ts   (27 行, 孤立)

目标：
  app-store.ts (≤200 行, Zustand create + slices 组合 + re-export)
  app-store/project-slice.ts         (含 project 领域逻辑)
  app-store/chapter-slice.ts         (含 chapter 领域逻辑)
  app-store/character-slice.ts       (含 character 领域逻辑)
  app-store/ui-slice.ts              (含 UI 状态逻辑)
  app-store/writing-history-slice.ts (含 undo/redo 栈逻辑)
  app-store/writing-state-slice.ts   (含 AI 写作状态逻辑)
```

---

## 具体改动

### 1. 拆 slice（将主文件逻辑移入对应 slice）

主文件 369 行按领域切分：

| 领域 | 当前行范围 | 目标文件 | 目标行数 |
|------|:--:|------|:--:|
| project 状态 | ~40 行 | `project-slice.ts` | ≤100 |
| chapter 状态 | ~30 行 | `chapter-slice.ts` | ≤80 |
| character 状态 | ~25 行 | `character-slice.ts` | ≤80 |
| UI 状态（tab/collapse/modal） | ~50 行 | `ui-slice.ts` | ≤100 |
| undo/redo 栈 | ~60 行 | `writing-history-slice.ts` | ≤80 |
| AI 写作状态 | ~50 行 | `writing-state-slice.ts` | ≤80 |
| 孤儿清理 + 杂项 | ~40 行 | 保留在 `app-store.ts` | ≤50 |

### 2. 主文件改为 re-export

```ts
// app-store.ts — ~150 行
import { create } from "zustand";
import { createProjectSlice, type ProjectSlice } from "./app-store/project-slice";
import { createChapterSlice, type ChapterSlice } from "./app-store/chapter-slice";
import { createCharacterSlice, type CharacterSlice } from "./app-store/character-slice";
import { createUiSlice, type UiSlice } from "./app-store/ui-slice";
import { createWritingHistorySlice, type WritingHistorySlice } from "./app-store/writing-history-slice";
import { createWritingStateSlice, type WritingStateSlice } from "./app-store/writing-state-slice";

export type AppStore = ProjectSlice & ChapterSlice & CharacterSlice & UiSlice & WritingHistorySlice & WritingStateSlice;

export const useAppStore = create<AppStore>()((...args) => ({
    ...createProjectSlice(...args),
    ...createChapterSlice(...args),
    ...createCharacterSlice(...args),
    ...createUiSlice(...args),
    ...createWritingHistorySlice(...args),
    ...createWritingStateSlice(...args),
}));

// 保持 import 路径不变
// 27 个引用方 import { useAppStore } from "@/stores/app-store" 无需修改
```

---

## 验证标准

### 自动化

- [ ] `npm run build` 通过
- [ ] `npm run test` 全绿
- [ ] app-store.ts ≤ **200 行**
- [ ] 6 个 slice 文件均被 import 使用
- [ ] 27 个引用方 import 路径不变（`from "@/stores/app-store"`）

### 回归测试计划

> 此为 P0 高风险重构，**每拆分一个 slice 后**必须执行以下快速回归：
> 1. `npm run build` — 编译零错误
> 2. `npm run test` — 28 用例全绿
> 3. 冒烟测试（M1-M2）— 创建项目+切换章节链路不断

### 手动测试清单

> 验收方逐项操作勾选，一项不通过即判定 R-T10 未完成。

| # | 操作步骤 | 预期结果 | 对应验收 |
|---|---------|---------|:--:|
| M1 | 首页点击"新建项目" → 填写名称 → 创建 | 项目列表中出现新项目，可进入写作页面 | V-T10 V5 |
| M2 | 在写作页面切换章节（点击不同章节） | 编辑器内容切换到对应章节，无闪烁/报错 | V-T10 V5 |
| M3 | 编辑内容后 Ctrl+Z → Ctrl+Y | 内容撤销/重做正常，undo/redo 栈正确 | V-T10 V5 |
| M4 | 点击"AI 写本章" → 等待生成 | 进度指示器显示，生成完成后内容正确写入 | V-T10 V5 |
| M5 | 打开设置面板 → 修改配置 → 关闭 → 重新打开写作页 | 所有 UI 状态（折叠/展开/标签）保持正确 | V-T10 V5 |

---

## 预估影响

| 文件 | 改动量 | 风险评估 |
|------|:--:|------|
| `app-store.ts` | -170 行 | 高（核心状态重构） |
| 6 个 slice 文件 | 各 +50~100 行 | 中（拆分+重组） |
| 27 个引用方 | **0 行** | 无（import 路径不变） |
