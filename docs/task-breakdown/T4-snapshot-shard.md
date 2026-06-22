# T4 — 快照分片 + backup 收口

> 任务 ID：T4  
> 优先级：**P0 致命**（B2 快照不全 + B3 快照膨胀）  
> 前置依赖：T1, T3

---

## 任务目标

1. 修复快照全量塞单 key 导致膨胀（B3）：改为分片存储
2. 修复 backup `getAllProjectKeys` 只遍历 localStorage（B2）：改为从 SQLite 读取项目列表
3. 保证分片写入的事务性（META-REVIEW 指出的未解问题）

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/memory-updater.ts`（createSnapshot / restoreSnapshot） |
| 修改 | `src/lib/backup.ts`（getAllProjectKeys / createBackup） |

## 子任务清单

### 4.1 快照分片（B3）

- [ ] T4.1 `createSnapshot` 改为分片存储：
  - 章节数据 → `snapshot-{pid}-{snapId}-chapters`
  - 角色数据 → `snapshot-{pid}-{snapId}-characters`
  - 大纲/设定 → `snapshot-{pid}-{snapId}-misc`
  - 索引 → `snapshot-{pid}-{snapId}-index`（记录分片清单 + 元信息）
- [ ] T4.2 写入事务顺序（META-REVIEW 方案）：**写新分片 key → 更新索引 key → 成功后才删旧格式 key**（写时复制），失败保留旧格式
- [ ] T4.3 `restoreSnapshot` 改为按分片读取 + 合并
- [ ] T4.4 删除旧的 `novel-snapshots-{pid}` 单 key 累积存储逻辑
- [ ] T4.5 兼容旧快照：读取时若发现旧 `novel-snapshots-{pid}` 格式，按旧格式恢复并提示用户"建议重新创建快照以启用分片"

### 4.2 backup 收口（B2）

- [ ] T4.6 `backup.ts` 的 `getAllProjectKeys` 改为从 SQLite `app_settings` 表读取项目列表（通过 Tauri invoke），而非遍历 `localStorage.key(i)`
- [ ] T4.7 `createBackup` 使用新的 getAllProjectKeys，确保 EXE 下能枚举全部项目
- [ ] T4.8 非 Tauri 模式（dev）保留 localStorage 回退，但加日志

### 4.3 验证

- [ ] T4.9 跑 T0 测试 + build
- [ ] T4.10 手动 EXE 验证（见手动项）

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全绿 |
| A2 | `npm run tsc --noEmit` | 无错误 |
| A3 | `npm run build` | 通过 |
| A4 | grep `novel-snapshots-` memory-updater.ts | 仅在兼容读取逻辑中出现（不再作为主存储） |
| A5 | grep `localStorage.key(i)` backup.ts | **0 处**（改为 SQLite 查询） |
| A6 | grep `snapshot-.*-chapters\|snapshot-.*-index` memory-updater.ts | 分片 key 模式存在 |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 创建快照（30 章项目）→ 查看存储 | 无单 key 膨胀，分片存储 |
| M2 | **关闭 EXE → 重开 → 查看快照列表** | **快照完整可见（B2 核心验证）** |
| M3 | 恢复快照 → 检查章节/角色/大纲 | 全部完整还原 |
| M4 | 创建 5 个快照 → 存储占用 | 无线性膨胀 |
| M5 | 备份导出全部项目 | 项目列表完整（B2 修复） |
| M6 | 旧快照（单 key 格式）恢复 | 能恢复 + 提示重新创建 |
| M7 | 模拟分片写入中途失败 | 旧数据保留，不出现半成品 |

## 证据清单（我必须提交）

1. `git diff --stat` 输出
2. `npm run test` + `tsc --noEmit` + `build` 输出
3. `memory-updater.ts` createSnapshot 改动后代码（Read 工具，证明分片 + 事务顺序）
4. `backup.ts` getAllProjectKeys 改动后代码（Read 工具，证明走 SQLite）
5. grep `localStorage.key` backup.ts 输出（0 处）
6. grep 分片 key 模式输出（证明分片存在）

## 验收清单（你勾选）

- [ ] V1 证据 1-2：编译测试通过
- [ ] V2 证据 3：分片 + 写时复制事务顺序存在
- [ ] V3 证据 4-5：backup 走 SQLite，无 localStorage.key 遍历
- [ ] V4 手动 M2：**关闭重开快照完整（B2 红线）**
- [ ] V5 手动 M3：快照恢复数据完整
- [ ] V6 手动 M1/M4：无单 key 膨胀
- [ ] V7 手动 M7：写入失败不产生半成品

## 回退方案

```bash
git checkout 418c623 -- src/lib/memory-updater.ts src/lib/backup.ts
```
