# 执笔 v4.0 待完善清单

> 创建时间：2026-06-14
> 聚焦：编组白屏 + 导入覆盖 + 数据恢复

---

## 一、🔴 P0 — 世界观编组连接未编组词条导致白屏

### 1.1 编组字段缺失 → NaN 坐标 → 白屏

**文件**：`src/modules/outline/WorldviewPanel.tsx` → `load` 函数 ~420 行

**问题**：当编组数据缺少 `x`、`y`、`w`、`h`、`bg`、`border` 字段时（旧版迁移、手动修改 JSON、或部分保存），代码未做防御：

```typescript
// ~420 行
for (const g of saved) {
  for (const cn of termNodes) {
    if (g.childIds.includes(cn.id)) {
      cn.position = { x: cn.position.x - g.x, y: cn.position.y - g.y };
      // g.x 为 undefined → NaN → ReactFlow SVG 矩阵运算全部 NaN → 画布白屏
    }
  }
}
```

以及编组样式：
```typescript
style: { backgroundColor: g.bg + "1a", border: "1.5px solid " + g.border }
// g.bg 为 undefined → "undefined1a"（无效 CSS）
// g.border 为 undefined → "1.5px solid undefined"（无效 CSS）
```

**修复方案**：

1. 读取编组后立即补默认值：
```typescript
const safeGroup = {
  ...g,
  x: g.x ?? 0,  y: g.y ?? 0,
  w: g.w ?? 400,  h: g.h ?? 300,
  bg: g.bg ?? "#f3f4f6",  border: g.border ?? "#9ca3af",
};
```

2. 整个 `load` 函数中对 `saved` 数组逐项执行此防御

### 1.2 已删词条仍被编组引用

**文件**：`src/modules/outline/WorldviewPanel.tsx` → `delRef.current`

**问题**：用户删除词条时，编组的 `childIds` 中可能残留该词条的 ID → 下次加载时找不到对应节点 → `undefined` 参与后续逻辑 → 异常

**修复方案**：确认所有删除路径（Delete 键、右键菜单、底部按钮）都调用了 `childIds` 清理逻辑

### 1.3 孤立连线

**文件**：`src/modules/outline/WorldviewPanel.tsx` → `computeLayout` + `MergedEdgesGroup`

**问题**：source 或 target 节点已被删除，但边数据仍在 → `nodeMap.get()` 返回 `undefined`

- `MergedEdgesGroup`：`if (!tgt) continue` 已跳过，不会崩溃
- `computeLayout`：构建邻接表时未过滤孤立边，影响布局结果

**修复方案**：加载边时过滤掉 source 或 target 不在节点列表中的边

---

## 二、🔴 P0 — 数据导入直接覆盖（三选一方案）

### 2.1 当前问题

**文件**：`src-tauri/src/commands/db_cmds.rs` → `import_project`（~1058 行）

```rust
// 当前逻辑：无脑 DELETE + INSERT
conn.execute("DELETE FROM beat_cards WHERE ...").ok();
conn.execute("DELETE FROM chapter_contents WHERE ...").ok();
conn.execute("DELETE FROM chapters WHERE ...").ok();
// ... 共 9 条 DELETE
// 然后 INSERT 导入数据
```

没有任何备份、没有任何确认（除了前端的导入按钮）。

**场景**：用户写了一本书到第 30 章，导出备份 ZIP。后续写了 10 章到第 40 章。某天误导入旧备份 → 第 31~40 章永久丢失。

### 2.2 修复方案 — 导入三选一

导入前弹出对话框，三个选项：

#### 选项A：覆盖当前项目（默认，有备份保护）
- **操作**：先复制 `project.db` → `project_backup_{timestamp}.db`，再执行 DELETE + INSERT
- **保留**：最近 5 个备份，超出自动删除最旧的
- **适用**：用户确认要用旧备份替换当前数据

#### 选项B：创建为新项目
- **操作**：给导入数据生成新 `project_id`（UUID），在 `%APPDATA%/projects/` 下新建目录
- **不覆盖**：现有项目完全不受影响
- **适用**：用户想对比两个版本，或者不确定要不要替换

#### 选项C：合并数据
- **操作**：不 DELETE，只 INSERT OR REPLACE（以导入数据中的 id 为准）
- **保留**：当前项目中不在导入文件内的所有数据
- **适用**：用户从另一台机器导入了部分数据，想合并过来

### 2.3 需要修改的文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands/db_cmds.rs` | `import_project` 增加 `mode: "overwrite" | "new" | "merge"` 参数 |
| `src/lib/api.ts` | `importProject` 增加 `mode` 参数 |
| 前端导入对话框 | 三选一 UI（覆盖 / 新建 / 合并）+ 备份路径提示 |

### 2.4 Rust 端伪代码

```rust
#[tauri::command]
pub fn import_project(project_data: Value, mode: String, state: State<DbState>) -> Result<String, String> {
    match mode.as_str() {
        "overwrite" => {
            // 1. 备份
            let backup_path = db_path.with_file_name(format!("project_backup_{}.db", timestamp));
            std::fs::copy(&db_path, &backup_path)?;
            // 2. 清理旧备份（保留最新5个）
            cleanup_old_backups(&db_path.parent());
            // 3. DELETE + INSERT
            do_overwrite(project_data, state)
        },
        "new" => {
            // 1. 生成新 UUID
            // 2. 创建新 project.db
            // 3. 只 INSERT，不 DELETE
            do_new_project(project_data, state)
        },
        "merge" => {
            // 1. 不 DELETE
            // 2. INSERT OR REPLACE（保留现有数据）
            do_merge(project_data, state)
        },
        _ => Err("未知导入模式".into())
    }
}

fn cleanup_old_backups(dir: &Path) {
    // 找到所有 project_backup_*.db，按时间排序，删除超过5个的
}
```

---

## 三、🟡 P1 — 数据恢复能力

### 3.1 恢复脚本独立于程序

**文件**：`scripts/recover-data.ps1`

**问题**：
- 用户不知道有这个脚本，不知道怎么用
- 需要手动关闭程序 → 右键运行 PowerShell

**改进**：打包进 EXE 或在设置页加"导出恢复工具"按钮

### 3.2 无内置恢复入口

**问题**：程序内没有任何"从备份恢复"的功能

**改进**：设置页增加"备份与恢复"面板，列出备份文件，支持一键恢复

---

## 四、修复优先级

```
第一优先（不修会丢数据/白屏）
  ├── 1.1 编组字段缺失防御
  ├── 1.2 编组引用清理
  ├── 1.3 孤立连线过滤
  └── 2.1 导入三选一（overwrite + 备份 / new / merge）

第二优先（体验）
  ├── 3.1 恢复脚本内嵌
  └── 3.2 内置恢复入口
```
