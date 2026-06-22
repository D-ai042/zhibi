# R-T3 — plot-chapters- 残留清零

> 对应验收：V-T3（`verification3.0/T3-verification.md`）  
> 优先级：**P0**（A4 7 处残留 + T3.9 Rust 侧未改）

---

## 问题描述

T3 标准 A4 要求 `plot-chapters-` 裸读清零（除 chapter-store 迁移逻辑），实测 **7 处残留**（不含测试文件）。

| 文件 | 行号 | 当前调用 | 类型 |
|------|------|---------|------|
| `backup.ts` | 21 | 前缀列表含 `plot-chapters-` | 备份 key 过滤 |
| `memory-updater.ts` | 653 | `key.startsWith("plot-chapters-")` | 旧 key 前缀过滤 |
| `migrate-data.ts` | 30 | 迁移 key 列表含 `plot-chapters-` | 数据迁移 |
| `mock-backend.ts` | 941, 1088 | `getLocal(`plot-chapters-${pid}`)` | mock 读写 |
| `SettingsModal.tsx` | 918, 1027 | 导入导出 fallback `plot-chapters-` | 导入导出 |
| **`db_cmds.rs`** | **1126** | `read_setting_array("plot-chapters-{}")` | **Rust 直读** |

---

## 子任务 T3.9：Rust 侧修复

`src-tauri/src/commands/db_cmds.rs:1126`：

```rust
// 当前
let plot_chapters: Vec<Value> = read_setting_array(&format!("plot-chapters-{}", project_id));

// 目标：改为从分片逐章存储读取
let plot_chapters: Vec<Value> = {
    let chapter_ids: Vec<String> = read_setting_array(&format!("chapter-index-{}", project_id));
    chapter_ids.iter().filter_map(|id| {
        let key = format!("chapter-{}-{}", project_id, id);
        read_setting(&key).and_then(|v| serde_json::from_str(&v).ok())
    }).collect()
};
```

---

## 具体改动

### 1. `backup.ts:21`（前缀列表）

```diff
- const prefixes = [..., `plot-chapters-`, ...];
+ const prefixes = [..., ...];  // 删除 plot-chapters-，由 chapter-index- 替代
```

同时在 `matchKey` 中增加对 `chapter-${projectId}-` 的匹配（已存在）。

---

### 2. `memory-updater.ts:653`（classifyKey）

`classifyKey` 中的 `key.startsWith("plot-chapters-")` 移到内部迁移兼容逻辑中，添加注释：

```ts
// T3 兼容：旧 key 仅在迁移时使用
if (key.startsWith("plot-chapters-")) return "chapters";
```

---

### 3. `migrate-data.ts:30`

```diff
- "plot-chapters-",
+ // 已迁移到逐章存储，不再处理
```

---

### 4. `mock-backend.ts:941, 1088`

```diff
- const plotChapters = getLocal(`plot-chapters-${pid}`);
+ // T3: 从逐章存储读取
+ const chapterIndex = getLocal(`chapter-index-${pid}`) || [];
+ const plotChapters = chapterIndex.map((id: string) => getLocal(`chapter-${pid}-${id}`)).filter(Boolean);
```

---

### 5. `SettingsModal.tsx:918, 1027`

导入导出中 `tryGetKey("plot-chapters-")` fallback 改为：

```diff
- (projData as ImportedProjectData).plotChapters = chaptersFromShards.length > 0 ? chaptersFromShards : (tryGetKey("plot-chapters-") || []);
+ (projData as ImportedProjectData).plotChapters = chaptersFromShards;  // 优先逐章，无旧 key fallback
```

---

## 验证标准

- [ ] `npm run test` 28 用例全绿
- [ ] `npm run build` 通过
- [ ] `cargo build` 通过
- [ ] grep `plot-chapters-` src/（排除 chapter-store 迁移逻辑 + 测试文件）：**0 处**
- [ ] grep `plot-chapters-` src-tauri/：**0 处**

---

## 预估影响

| 文件 | 改动量 | 风险评估 |
|------|:--:|------|
| `backup.ts` | 2 行 | 低 |
| `memory-updater.ts` | 3 行 | 低 |
| `migrate-data.ts` | 1 行 | 低 |
| `mock-backend.ts` | 6 行 | 中（mock 模式受影响） |
| `SettingsModal.tsx` | 3 行 | 中（导入导出受影响） |
| `db_cmds.rs` | 12 行 | 中（Rust 端读取逻辑变更） |
