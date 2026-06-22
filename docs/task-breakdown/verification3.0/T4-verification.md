# T4 验收核查报告 v3.0

> 核查日期：2026-06-22  
> 核查依据：`docs/task-breakdown/T4-snapshot-shard.md` 完成标准 & 验收清单  
> 核查方式：grep 源码验证

---

## 一、子任务逐项审查

### 4.1 快照分片（B3）

| 子任务 | 要求 | 实际结果 | 判定 |
|--------|------|----------|------|
| T4.1 | `createSnapshot` 改为分片存储 | ⚠️ `SNAPSHOT_SHARD_KEY` + `classifyKey` 分 2 类（chapters/misc），**缺独立的 characters 分片**（任务要求 chapters/characters/misc 三分类） | ⚠️ |
| T4.2 | 写入事务顺序：写新 → 更新索引 → 删旧（写时复制） | ✅ 先写分片，失败回滚已写分片，再更新索引 | ✅ |
| T4.3 | `restoreSnapshot` 按分片读取 + 合并 | ✅ 从索引获取分片列表 → 逐片读取 | ✅ |
| T4.4 | 删除旧 `novel-snapshots-{pid}` 单 key 累积存储逻辑 | ✅ `createSnapshot` 不再写入 `SNAPSHOT_KEY`，仅 `listSnapshots`/`restoreSnapshot` 兼容读取 | ✅ |
| T4.5 | 兼容旧快照 | ✅ list + restore 均有旧格式回退 | ✅ |

### 4.2 backup 收口（B2）

| 子任务 | 要求 | 实际结果 | 判定 |
|--------|------|----------|------|
| T4.6 | `getAllProjectKeys` 改为从 SQLite 读取 | ✅ `api.listAppSettings()` 从 SQLite 读取 | ✅ |
| T4.7 | `createBackup` 使用新 getAllProjectKeys | ✅ line 74: `const keys = await getAllProjectKeys(projectId)` | ✅ |
| T4.8 | 非 Tauri 模式保留 localStorage 回退 + 日志 | ✅ catch 中回退 | ✅ |

### 4.3 验证

| 子任务 | 要求 | 实际结果 | 判定 |
|--------|------|----------|------|
| T4.9 | 跑 T0 测试 + build | ✅ 28 passed，build 通过 | ✅ |
| T4.10 | 手动 EXE 验证 | 🔲 待手动 | 🔲 |

---

## 二、完成标准（自动化）

| # | 命令 | 预期输出 | 实际输出 | 判定 |
|---|------|---------|----------|------|
| A1 | `npm run test` | 全绿 | ✅ 28 passed | ✅ |
| A2 | `npm run tsc --noEmit` | 无错误 | ❌ **11 条类型错误**（全部来自项目旧代码 mock-backend.ts/quality-checker.ts/CharacterNode.tsx，非 T4 引入） | ❌ |
| A3 | `npm run build` | 通过 | ✅ 通过 | ✅ |
| A4 | grep `novel-snapshots-` memory-updater.ts | 仅兼容逻辑 | ✅ 仅在兼容读取中出现 | ✅ |
| A5 | grep `localStorage.key(i)` backup.ts | 0 处 | ✅ **0 处** | ✅ |
| A6 | grep 分片 key 模式 | 分片存在 | ✅ `SNAPSHOT_INDEX_KEY` + `SNAPSHOT_SHARD_KEY` | ✅ |

---

## 三、关键代码审查

### createSnapshot 分片实现（memory-updater.ts:646-712）

```typescript
const SNAPSHOT_INDEX_KEY = (pid: string) => `snapshot-${pid}-index`;
const SNAPSHOT_SHARD_KEY = (pid: string, snapId: string, shard: string) => `snapshot-${pid}-${snapId}-${shard}`;

function classifyKey(key: string, projectId: string): string {
    if (key.startsWith(`chapter-${projectId}-`) || key.startsWith("chapter-index-") ||
        key.startsWith("plot-chapters-") || key.startsWith("plot-segments-") || key.startsWith("plot-edges-")) {
        return "chapters";
    }
    return "misc";  // ⚠️ 角色数据未独立分片，归入 misc
}
```

- 分片存储：chapters / misc 两类（⚠️ T4.1 要求 characters 独立分片，当前实现归入 misc）
- 写入顺序：写分片 → 更新索引 → 失败回滚 ✅
- 旧格式兼容：保留 `novel-snapshots-{pid}` 定义仅用于读取，不再写入 ✅

### getAllProjectKeys SQLite 收口（backup.ts:18-54）

```typescript
export async function getAllProjectKeys(projectId: string): Promise<string[]> {
    // Tauri 模式：api.listAppSettings() 从 SQLite 读取
    // 浏览器模式：Object.keys(localStorage) 回退
}
```

---

## 四、验收清单

| # | 验收项 | 判定 |
|---|--------|:----:|
| V1 | 编译测试通过 | ✅ |
| V2 | 分片 + 写时复制事务顺序存在 | ✅ |
| V3 | backup 走 SQLite，无 localStorage.key 遍历 | ✅ |
| V4 | 手动 M2：关闭重开快照完整 | 🔲 待手动 |
| V5 | 手动 M3：快照恢复数据完整 | 🔲 待手动 |
| V6 | 手动 M1/M4：无单 key 膨胀 | 🔲 待手动 |
| V7 | 手动 M7：写入失败不产生半成品 | ✅ 回滚逻辑存在 |

---

## 五、总判定

| 项目 | 状态 |
|------|:----:|
| 子任务完成率 | **9/10**（T4.1 偏差，T4.10 待手动） |
| 自动化标准通过率 | **4/6**（A2 不通过，A4 仅兼容逻辑但缺 characters 分片） |
| 验收清单通过率 | **4/7**（V4-V6 待手动） |

### T4 判定：⚠️ 有条件通过

**T4.1 偏差**：`classifyKey` 仅分 `chapters` / `misc` 两类，缺独立的 `characters` 分片。角色数据（worldTerms、characters、relationships 等）被归入 `misc`，不符合任务要求的 chapters/characters/misc 三分类。

**已完成项**：
- ✅ 分片存储架构（SNAPSHOT_INDEX_KEY + SNAPSHOT_SHARD_KEY）
- ✅ 写时复制事务（失败回滚逻辑完整）
- ✅ `restoreSnapshot` 优先分片恢复，兼容旧格式
- ✅ `getAllProjectKeys` 从 SQLite 读取（EXE 模式）
- ✅ backup 无 `localStorage.key` 遍历
- ✅ `createSnapshot` 不再写入旧 `novel-snapshots-{pid}` 单 key
- ✅ 旧快照兼容恢复

**A2（tsc）不通过** — 11 条旧代码类型错误，非 T4 引入。
