# T8 — localStorage 全局收口

> 任务 ID：T8  
> 优先级：**P0 致命**（EXE 下数据丢失重灾区，93 处）  
> 前置依赖：T1, T3

---

## 任务目标

收口全局 93 处 `localStorage` 裸调用（跨 16 文件），全部走 `loadJSON` / `saveJSON` / `chapter-store`。分两个子阶段：UI 组件层（8.A）+ lib 层（8.B）。

> 注意：StoryBible 的 16 处、AiChatPanel 的 9 处已在 T7 部分处理；本任务处理剩余全部。

## 涉及文件

### 8.A UI 组件层（~39 处）

| 文件 | 处理数 |
|------|--------|
| `src/modules/story-bible/StoryBibleModule.tsx` | 16（含第 642 行单行 7 次） |
| `src/modules/outline/OutlineModule.tsx` | 4 |
| `src/components/welcome/WelcomeScreen.tsx` | 4 |
| `src/components/settings/SettingsModal.tsx` | 4 |
| `src/layouts/AppShell.tsx` | 1 |
| `src/modules/manuscript/InspirationPanel.tsx` | 1 |
| 其余 UI 文件 | ~9 |

### 8.B lib 层（~36 处）

| 文件 | 处理数 |
|------|--------|
| `src/lib/backup.ts` | 12（部分已在 T4 处理） |
| `src/lib/mock-backend.ts` | 17 |
| `src/lib/version-check.ts` | 3 |
| `src/lib/migrate-data.ts` | 3 |
| `src/lib/memory-updater.ts` | 1 |

> `storage.ts` 自身 11 处是实现层，不计。

## 子任务清单

### 8.A UI 组件层

- [ ] T8.1 `StoryBibleModule.tsx`：16 处全部替换（第 642 行单行 7 次 `getItem` 需逐个拆分为独立调用）
- [ ] T8.2 `OutlineModule.tsx`：4 处 → `loadJSON` / `saveJSON`
- [ ] T8.3 `WelcomeScreen.tsx`：4 处 → `loadJSON`
- [ ] T8.4 `SettingsModal.tsx`：4 处 → `loadJSON` / `saveJSON`
- [ ] T8.5 `AppShell.tsx`：1 处 → `loadJSON`
- [ ] T8.6 `InspirationPanel.tsx`：1 处 → `loadJSON`
- [ ] T8.7 其余 UI 文件 ~9 处

### 8.B lib 层

- [ ] T8.8 `backup.ts`：剩余 localStorage（T4 已处理 getAllProjectKeys，本任务处理其余）
- [ ] T8.9 `mock-backend.ts`：17 处 → 统一走 `loadJSON` / `saveJSON`（dev 模式回退保留但封装）
- [ ] T8.10 `version-check.ts`：3 处
- [ ] T8.11 `migrate-data.ts`：3 处
- [ ] T8.12 `memory-updater.ts`：1 处

### 8.C 验证

- [ ] T8.13 跑 T0 测试 + tsc + build
- [ ] T8.14 grep 全局 localStorage 裸调（除 storage.ts 实现层外应为 0）

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全绿 |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | grep `localStorage\.` src/（排除 storage.ts） | **0 处** |
| A5 | grep `localStorage\.` src/lib/storage.ts | 仅实现层（11 处左右） |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 打开故事圣经 → 关闭 → 重开 | 所有子项加载，无空白 |
| M2 | 修改故事圣经各子项 → 重开 | 全部保留 |
| M3 | **关闭 EXE → 重开 → 打开故事圣经** | **数据完整（5.2 修复红线）** |
| M4 | 大纲/素材/灵感各页面打开 | 正常加载 |
| M5 | 设置页各配置保存 → 重开 | 保留 |
| M6 | mock 模式（dev）功能 | 仍可用 |

## 证据清单（我必须提交）

1. `git diff --stat` 输出（证明 16 文件改动）
2. `npm run test` + `tsc --noEmit` + `build` 输出
3. grep `localStorage\.` src/ 输出（排除 storage.ts，应为 0）
4. grep 前后对比：93 处 → 0 处（除 storage.ts 实现层）
5. `StoryBibleModule.tsx` 第 642 行改动前后对比（证明 7 次裸调已拆分）

## 验收清单（你勾选）

- [ ] V1 证据 1-3：编译测试通过
- [ ] V2 证据 3-4：localStorage 裸调清零（93 → 0）
- [ ] V3 证据 5：StoryBible 第 642 行已拆分
- [ ] V4 手动 M3：**关闭重开故事圣经完整（红线）**
- [ ] V5 手动 M4-M5：各页面正常
- [ ] V6 手动 M6：dev mock 模式可用

## 回退方案

```bash
# 本任务涉及文件多，按子阶段回退
git checkout 418c623 -- src/modules/story-bible/StoryBibleModule.tsx src/modules/outline/OutlineModule.tsx src/components/welcome/WelcomeScreen.tsx src/components/settings/SettingsModal.tsx src/layouts/AppShell.tsx src/modules/manuscript/InspirationPanel.tsx src/lib/mock-backend.ts src/lib/version-check.ts src/lib/migrate-data.ts src/lib/memory-updater.ts
```
