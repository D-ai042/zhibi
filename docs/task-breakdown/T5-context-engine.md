# T5 — context-engine 精简

> 任务 ID：T5  
> 优先级：**P1**（D2 快照匹配 + D3 两套上下文 + 重复代码）  
> 前置依赖：T3

---

## 任务目标

1. 合并两套上下文组装器（D3）：`loadContextPanelData` + `buildProjectContext` → 统一 `assembleContext(mode)`
2. 修复快照匹配用最大 age（D2）：改为按章节时间线匹配
3. 消除重复代码：typeLabel 3 次、estimateTokens 2 处
4. 治理 context-engine 内 `as any`（16 处）+ memory-updater（9 处）

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/context-engine.ts` |
| 修改 | `src/lib/memory-engine.ts`（estimateTokens 去重） |
| 修改 | `src/modules/writing/WritingModule.tsx`（loadContextPanelData 调用方） |
| 修改 | `src/types/index.ts`（新增接口定义） |

## 子任务清单

### 5.1 合并上下文组装器（D3）

- [ ] T5.1 新增 `assembleContext(projectId, chapterId, mode: "panel" | "ai"): ContextResult`
  - panel 模式：返回轻量数据给 UI 面板
  - ai 模式：返回 P0-P4 token 预算控制的 system_hint
- [ ] T5.2 `WritingModule.tsx` 删除 `loadContextPanelData`，改调 `assembleContext(pid, chId, "panel")`
- [ ] T5.3 保留 `buildModuleContext`（AiChatPanel 聊天场景不同，不合并）

### 5.2 修复快照匹配（D2）

- [ ] T5.4 `context-engine.ts:803` 取 `age` 最大的逻辑 → 改为取 age 最接近当前章节对应时间线的快照
- [ ] T5.5 无法判断时间线时用最新快照 + 附加 `reportDiagnostic` 警告日志

### 5.3 消除重复

- [ ] T5.6 `typeLabel` Record（行 111/266/493 三处）→ 提取到文件顶部常量
- [ ] T5.7 `estimateTokens`（context-engine.ts:64 + memory-engine.ts:23）→ 统一从 context-engine 导出，memory-engine 改 import

### 5.4 as any 治理（本任务范围 25 处）

- [ ] T5.8 为 PlotSegmentData / PlotChapterData / LogStoreData 定义接口（types/index.ts）
- [ ] T5.9 context-engine.ts 16 处 `as any` → 替换为接口
- [ ] T5.10 memory-updater.ts 9 处 `as any` → 替换为接口
- [ ] T5.11 其余 101 处 as any 在 T6/T7/T8/T9 对应阶段顺手处理（不属本任务）

### 5.5 验证

- [ ] T5.12 跑 T0 测试 + tsc + build

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全绿（含 estimateTokens 测试） |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | grep `typeLabel` context-engine.ts | 仅 1 处定义（非 3 处） |
| A5 | grep `estimateTokens` memory-engine.ts | 0 处定义（改为 import） |
| A6 | grep `as any` context-engine.ts | ≤ 3 处（从 16 降） |
| A7 | grep `as any` memory-updater.ts | ≤ 2 处（从 9 降） |
| A8 | grep `loadContextPanelData` src/ | 0 处（已删除，改 assembleContext） |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 打开某章 → 展开上下文面板 | 显示本章相关角色/设定/摘要 |
| M2 | 对比"面板角色年龄"与"AI 写作实际收到角色年龄" | **一致（D3 修复）** |
| M3 | 第 3 章建快照（角色 16 岁）→ 写到第 20 章 → AI 写第 4 章 | AI 收到年龄接近 16（D2 修复） |
| M4 | 切换章节 → 面板内容同步 | 正确更新 |

## 证据清单（我必须提交）

1. `git diff --stat` 输出
2. `npm run test` + `tsc --noEmit` + `build` 输出
3. `assembleContext` 函数代码（Read 工具）
4. grep `typeLabel` context-engine.ts 输出（1 处）
5. grep `estimateTokens` memory-engine.ts 输出（0 处定义）
6. grep `as any` context-engine.ts + memory-updater.ts 前后数量对比
7. 快照匹配逻辑改动行（Read 工具，证明按时间线而非最大 age）

## 验收清单（你勾选）

- [ ] V1 证据 1-2：编译测试通过
- [ ] V2 证据 3：assembleContext 统一入口存在
- [ ] V3 证据 4-5：重复代码消除
- [ ] V4 证据 6：as any 数量下降符合预期
- [ ] V5 证据 7：快照匹配按时间线
- [ ] V6 手动 M2：**面板与 AI 上下文一致（D3 红线）**
- [ ] V7 手动 M3：快照匹配正确（D2）

## 回退方案

```bash
git checkout 418c623 -- src/lib/context-engine.ts src/lib/memory-engine.ts src/modules/writing/WritingModule.tsx src/types/index.ts
```
