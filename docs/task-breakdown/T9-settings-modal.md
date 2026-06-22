# T9 — SettingsModal.tsx 拆分

> 任务 ID：T9  
> 优先级：**P2**（1192 行 God File + 导入逻辑重复 60%）  
> 前置依赖：T1

---

## 任务目标

将 SettingsModal.tsx（1192 行）拆分为 5 个文件，每个 < 300 行。消除导入逻辑 60% 重复。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/components/settings/SettingsModal.tsx`（瘦身到 ~150 行） |
| 新建 | `src/components/settings/ApiConfigTab.tsx` |
| 新建 | `src/components/settings/SttConfigTab.tsx` |
| 新建 | `src/components/settings/SnapshotManagerTab.tsx` |
| 新建 | `src/components/settings/DataMigrateTab.tsx` |

## 子任务清单

- [ ] T9.1 `SettingsModal.tsx` 瘦身（~150 行）：标签导航 + 弹窗壳
- [ ] T9.2 抽取 `ApiConfigTab.tsx`（~200 行）：API 配置（模型选择 / Key / 测试连接）
- [ ] T9.3 抽取 `SttConfigTab.tsx`（~150 行）：STT 配置（百度凭据）
- [ ] T9.4 抽取 `SnapshotManagerTab.tsx`（~200 行）：快照管理，适配 T4 的分片存储
- [ ] T9.5 抽取 `DataMigrateTab.tsx`（~250 行）：数据导入导出迁移，消除 60% 重复导入逻辑
- [ ] T9.6 治理 SettingsModal 内 12 处 `as any`
- [ ] T9.7 验证：T0 测试 + tsc + build

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全绿 |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | SettingsModal.tsx 行数 | ≤ 200 行 |
| A5 | 各新文件行数 | 各 < 300 行 |
| A6 | grep `as any` SettingsModal.tsx + 子文件 | ≤ 4 处（从 12 降） |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 设置页 5 个标签切换 | 全部正常 |
| M2 | API 配置保存 → 重开 | 保留 |
| M3 | STT 配置保存 → 重开 | 保留 |
| M4 | 快照管理创建/删除 | 正常（适配分片） |
| M5 | 数据导入导出 | 正常 |
| M6 | 导入含冲突 | 提示覆盖/跳过 |

## 证据清单（我必须提交）

1. `git diff --stat` 输出（1 改 + 4 新建）
2. `npm run test` + `tsc --noEmit` + `build` 输出
3. 各文件行数统计（SettingsModal ≤ 200，子文件 < 300）
4. grep `as any` 前后对比（12 → ≤ 4）
5. `DataMigrateTab.tsx` 全文（Read 工具，证明导入逻辑去重）

## 验收清单（你勾选）

- [ ] V1 证据 1-3：编译测试通过
- [ ] V2 证据 4：行数达标
- [ ] V3 证据 5：导入逻辑去重
- [ ] V4 手动 M1：5 标签正常
- [ ] V5 手动 M2-M3：配置保存重开保留
- [ ] V6 手动 M4-M5：快照/迁移正常

## 回退方案

```bash
git checkout 418c623 -- src/components/settings/SettingsModal.tsx
rm -f src/components/settings/ApiConfigTab.tsx src/components/settings/SttConfigTab.tsx src/components/settings/SnapshotManagerTab.tsx src/components/settings/DataMigrateTab.tsx
```
