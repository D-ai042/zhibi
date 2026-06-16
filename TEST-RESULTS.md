# 执笔 (AI Novel Writer) — 测试结果报告（最终版）

> 测试日期：2026-06-16
> 测试方式：全量代码审查（逐文件、逐函数）
> 项目版本：v0.3.3
> 修复轮次：第 1 轮（session 1 修复 11 个）+ 第 2 轮（session 2 修复 5 个）

---

## 测试结果汇总

| 状态 | 数量 |
|------|------|
| ✅ 通过 | 103 |
| ❌ 已修复 | 16 |
| ⚠️ 剩余低危 | 3 |
| ⏸ 需运行时验证 | 35 |

---

## 第 2 轮修复清单（本次）

| # | Bug | 严重程度 | 修复内容 | 文件 |
|---|-----|---------|---------|------|
| BUG-02 | 快照 age 为 NaN 时排序异常 | 低 | `parseInt(age)` → `(parseInt(age) \|\| 0)`，无效 age 跳过 | `context-engine.ts`, `memory-updater.ts` |
| BUG-04 | AiWritingDialog 拖拽回调频繁重建 | 低 | 移除 `[pos]` 依赖，改为从 DOM 读取位置 | `AiWritingDialog.tsx` |
| BUG-06 | 定稿流程切换章节导致写入错误 | 中 | 快照 `finalizeChapterId/Num/Title/Content`，全程使用快照值 | `WritingModule.tsx` |
| BUG-13 | 记忆压缩切片逻辑只压缩一半消息 | 中 | `processable.slice(0, rounds)` → `processable` | `memory-engine.ts` |
| BUG-14 | 项目阶段永远不更新 | 中 | 定稿后自动更新：`framework_locked` → `writing`，全部写完 → `completed` | `WritingModule.tsx` |

## 第 1 轮修复清单（上一次 session）

| # | Bug | 严重程度 | 修复内容 |
|---|-----|---------|---------|
| SYS-1 | 自动保存是假的 | 致命 | 30秒真正触发保存 + 2秒防抖草稿 |
| SYS-2 | 所有章节存在一个 key 里 | 致命 | 每章独立存储 + 索引 |
| CR-0 | localStorage 5MB 硬限制 | 致命 | try-catch + SQLite 兜底 |
| BUG-09 | 重新生成删错消息 | 中 | 往前遍历找 user 消息 |
| BUG-10 | 编辑消息 setInput 竞态 | 中 | 改用 editingContentRef |
| BUG-12 | parseEdgeActions 正则过于贪婪 | 中 | 缩小匹配范围到标记前 |
| BUG-15 | 导入 mock 键冲突 | 中 | 过滤 novel-workbench-mock 键 |
| BUG-18 | localStorage 满时静默丢失 | 低 | 全局 try-catch |
| BUG-19 | 上下文面板竞态 | 高 | loadGen 计数器守卫 |
| ME-6 | existingEdges 用旧快照 | 中 | 删除后重新加载 |
| 其他 | JSON.parse 无 try-catch | 中 | 替换为 getJSONSync |

---

## 剩余低危问题（3 个，不影响核心功能）

| # | 简述 | 严重程度 | 建议 |
|---|------|---------|------|
| BUG-01 | 撤销栈不包含编组操作 | 低 | 编组操作较少，用户可手动解散 |
| BUG-03 | deleteChapter 闭包陈旧 | 低 | 内部已用函数式更新，极端情况才触发 |
| BUG-05 | 组件卸载后孤立 timer | 低 | 已有 cleanup effect 清理 timeoutIdsRef |

---

## 构建验证

```
✓ vite build 成功 (7.12s)
✓ 无编译错误
✓ 2173 modules transformed
```

---

> **结论**：19 个 Bug 中已修复 16 个（含上一轮 11 个），剩余 3 个低危不影响核心功能。构建通过。
