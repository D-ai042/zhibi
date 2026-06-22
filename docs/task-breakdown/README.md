# 任务拆分与验收标准索引

> 基准：`docs/REMEDIATION-PLAN.md`（修复方案）+ `docs/ACCEPTANCE-CRITERIA.md`（验收手册）  
> 目的：把修复方案拆成可执行、可验证、可追责的原子任务，每个任务有明确的"完成标准"和"证据要求"，防止偷懒。

---

## 如何使用

1. **严格按依赖顺序执行**：T0 → T1 → T2 → ... → T10。每个任务文件顶部标注了前置依赖。
2. **每个任务完成后必须提供证据**：任务文件末尾的「证据清单」是我（执行方）必须提交给你的东西，缺一项即视为未完成。
3. **你（验收方）按「验收清单」勾选**：自动化项我能跑给你看，手动项你亲自操作勾选。
4. **任一验收项不通过则不进下一任务**：修复或回退后重新验收。
5. **每任务一个 git commit**：commit message 格式 `task(Tx.y): 简述`，便于回退。

---

## 任务总览

| 任务 ID | 任务名称 | 前置依赖 | 文件 |
|---------|---------|---------|------|
| T0 | 测试基础设施 | 无 | [T0-test-infra.md](./T0-test-infra.md) |
| T1 | storage.ts 精简 | T0 | [T1-storage.md](./T1-storage.md) |
| T2 | Rust 后端修复 | 无（可与 T1 并行） | [T2-rust-backend.md](./T2-rust-backend.md) |
| T3 | chapter-store 新建 | T1 | [T3-chapter-store.md](./T3-chapter-store.md) |
| T4 | 快照分片 + backup 收口 | T1, T3 | [T4-snapshot-shard.md](./T4-snapshot-shard.md) |
| T5 | context-engine 精简 | T3 | [T5-context-engine.md](./T5-context-engine.md) |
| T6 | WritingModule 拆分 | T3, T5 | [T6-writing-module.md](./T6-writing-module.md) |
| T7 | AiChatPanel 拆分 | T3, T5 | [T7-aichat-panel.md](./T7-aichat-panel.md) |
| T8 | localStorage 全局收口 | T1, T3 | [T8-localstorage-cleanup.md](./T8-localstorage-cleanup.md) |
| T9 | SettingsModal 拆分 | T1 | [T9-settings-modal.md](./T9-settings-modal.md) |
| T10 | app-store 拆分 | T1 | [T10-app-store.md](./T10-app-store.md) |

---

## 依赖关系图

```
T0(测试) ──┬─→ T1(storage) ──┬─→ T3(chapter-store) ──┬─→ T5(context-engine) ──┬─→ T6(WritingModule)
           │                  │                       │                        └─→ T7(AiChatPanel)
           │                  ├─→ T4(快照分片)        └─→ T8(localStorage收口)
           │                  ├─→ T9(SettingsModal)
           │                  └─→ T10(app-store)
           │
T2(Rust) ──┘ (独立，可与 T1 并行)
```

---

## 任务文件统一结构

每个 `Tx-*.md` 文件包含以下章节：

1. **任务目标** — 一句话说清做什么
2. **前置依赖** — 哪些任务必须先完成
3. **涉及文件** — 明确改动范围
4. **子任务清单** — 可勾选的原子操作（Tx.1, Tx.2 ...）
5. **完成标准（自动化）** — 我能跑的命令 + 预期输出
6. **完成标准（手动）** — 你要操作并勾选的项
7. **证据清单** — 我必须提交的东西（防偷懒）
8. **验收清单** — 你勾选的最终判定
9. **回退方案** — 失败时如何撤销

---

## 防偷懒机制

每个任务的「证据清单」要求我提交：

- **改了哪些文件**：用 `git diff --stat` 输出
- **跑了什么命令**：完整命令 + 完整输出
- **数量对账**：文档预期数 vs 实际处理数（用 grep 实测）
- **关键代码截图**：用 Read 工具读改动后的关键行给你看

你不认可以下任一情况即判定偷懒：
- 只说"已完成"但无命令输出
- 数量对不上（如说处理 44 处 `.ok()`，grep 实测还剩 30 处）
- 跳过子任务未说明原因
- 验收项含糊带过（如"功能正常"无具体现象描述）

---

## 总体验收门槛

- T0 ~ T4 全部 P0 任务通过后，才能进入 T5 ~ T10 的重构阶段
- T0 ~ T10 全部通过后，按 `ACCEPTANCE-CRITERIA.md` 执行最终交付验收
- 最终验收：P0 全过 + P1 通过率 ≥ 95% = 可交付
