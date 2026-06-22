# T10 — app-store.ts 拆分

> 任务 ID：T10  
> 优先级：**P2**（1200 行 God File，被 27 文件引用）  
> 前置依赖：T1

---

## 任务目标

将 app-store.ts（1200 行，被 27 文件引用）拆分为领域分片，每个 < 400 行。保证引用方 import 路径不变（统一从 `app-store` re-export），避免 27 文件连锁修改。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/store/app-store.ts`（瘦身到 ~150 行，仅 re-export） |
| 新建 | `src/store/app-store/project-slice.ts` |
| 新建 | `src/store/app-store/chapter-slice.ts` |
| 新建 | `src/store/app-store/character-slice.ts` |
| 新建 | `src/store/app-store/ui-slice.ts` |
| 新建 | `src/store/app-store/writing-history-slice.ts` |
| 新建 | `src/store/app-store/writing-state-slice.ts` |

## 子任务清单

- [ ] T10.1 按 store 现有字段归类为 5 个 slice
- [ ] T10.2 抽取 `project-slice.ts`：projects / currentProject / openProject / createProject / deleteProject
- [ ] T10.3 抽取 `chapter-slice.ts`：chapters / currentChapterId / saveChapter（调 chapter-store）
- [ ] T10.4 抽取 `character-slice.ts`：characters / relationships / pendingChars（解耦 AiChatPanel）
- [ ] T10.5 抽取 `ui-slice.ts`：activeTab / sidebarCollapsed / aiChatOpen / modals
- [ ] T10.6 抽取 `writing-history-slice.ts` + `writing-state-slice.ts`：撤销/重做栈、AI 写作状态
- [ ] T10.7 `app-store.ts` 瘦身为组合入口：合并 slices + re-export（保持 27 个引用方不变）
- [ ] T10.8 治理 app-store 内 8 处 `as any`（其余分散在各模块的 80+ 处不在本任务）
- [ ] T10.9 验证：T0 测试 + tsc + build

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全绿 |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | app-store.ts 行数 | ≤ 200 行 |
| A5 | 各 slice 行数 | 各 < 400 行 |
| A6 | grep `from '@/store/app-store'` src/ | 仍是 27 文件（引用未改） |
| A7 | grep `as any` app-store.ts + slices | ≤ 3 处 |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 全局状态读写（创建项目/切换章节/切换标签） | 全部正常 |
| M2 | 撤销/重做 | 正常 |
| M3 | 关闭重开 | 状态恢复 |
| M4 | AI 写作状态在多模块间同步 | 一致 |

## 证据清单（我必须提交）

1. `git diff --stat` 输出（1 改 + 6 新建）
2. `npm run test` + `tsc --noEmit` + `build` 输出
3. app-store.ts 行数（≤ 200）
4. 各 slice 行数（各 < 400）
5. grep `from '@/store/app-store'` src/ 数量（仍为 27，证明引用未破）
6. `app-store.ts` 改动后代码（Read 工具，证明是 re-export 入口）

## 验收清单（你勾选）

- [ ] V1 证据 1-3：编译测试通过
- [ ] V2 证据 4-5：行数达标
- [ ] V3 证据 6：引用方 27 文件未变
- [ ] V4 证据 7：app-store 为组合入口
- [ ] V5 手动 M1：全局状态正常
- [ ] V6 手动 M2-M3：撤销重做 + 重开恢复
- [ ] V7 手动 M4：AI 状态跨模块同步

## 回退方案

```bash
git checkout 418c623 -- src/store/app-store.ts
rm -rf src/store/app-store/
```

---

## 最终交付验收（T0-T10 全部通过后）

执行 `docs/ACCEPTANCE-CRITERIA.md` 完整验收：

- P0 全部通过
- P1 通过率 ≥ 95%
- `cargo build --release` 生成 EXE 可双击运行
- 关闭重开、重启电脑、复制数据目录到另一台机器，三项跨会话验证全过

满足以上即视为可交付。
