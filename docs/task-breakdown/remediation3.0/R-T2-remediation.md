# R-T2 — .ok() 静默丢弃补日志

> 对应验收：V-T2（`verification3.0/T2-verification.md`）  
> 优先级：**P0**

---

## 问题描述

`src-tauri/src/commands/db_cmds.rs` 中 **21 处 `.ok()`**，仅 **3 处有日志**（`collect_rows_or_warn`/backup 删除/mkdir），**18 处静默丢弃错误**。

| 类型 | 行号 | 数量 | 风险 |
|------|------|:--:|------|
| INSERT OR REPLACE | 1400,1420,1435,1451,1467,1480,1493,1507,1520 | **9** | 导入失败静默 |
| serde_json::from_value | 120,125,130 | 3 | 数据丢失无声 |
| 配置读取 | 1089,1122,1139 | 3 | 配置缺失无感知 |
| 文件遍历 | 1252,1259 | 2 | 文件系统故障无声 |
| 数字解析 | 1356 | 1 | 旧数据兼容 |
| 查询行解析 | 1630, 1652 | 2 | 查询结果容错 |

---

## 子任务 T2.2 特殊要求

INSERT OR REPLACE 9 处需**收集错误到 `Vec<String>`，导入完统一报告前端**（非仅加 log）。

---

## 具体改动

### 1. INSERT OR REPLACE 9 处（T2.2 — 最重要）

```rust
// 当前（静默丢弃）
conn.execute("INSERT OR REPLACE INTO ...", params![...]).ok();

// 目标（收集并报告）
let mut import_errors: Vec<String> = Vec::new();
// ...
if let Err(e) = conn.execute("INSERT OR REPLACE INTO ...", params![...]) {
    import_errors.push(format!("world_terms 导入失败: {}", e));
}
// 导入完统一报告
if !import_errors.is_empty() {
    log::warn!("[import] {} 条导入失败: {:?}", import_errors.len(), import_errors);
    // 通过 Tauri 事件通知前端
}
```

涉及函数：`import_project`（第 1284 行起）

---

### 2. serde_json::from_value 3 处

```rust
// 当前
.and_then(|v| serde_json::from_value(v.clone()).ok())

// 目标
.and_then(|v| serde_json::from_value(v.clone())
    .map_err(|e| log::warn!("[deserialize] value 解析失败: {}", e)).ok())
```

行号：120, 125, 130

---

### 3. 配置读取 3 处

```rust
// 当前
).ok().and_then(|raw| ...).unwrap_or_default()

// 目标
).ok().or_else(|| { log::warn!("[config] key not found"); None })
    .and_then(|raw| ...).unwrap_or_default()
```

行号：1089, 1122, 1139

---

### 4. 文件遍历 / 数字解析（3 处）

行号：1252, 1259, 1356。每处 `.ok()` 前加 `.map_err(|e| log::warn!(...))`。

### 5. 查询行解析（2 处）

行号：1630, 1652。查询结果遍历时 `.ok()` 静默丢弃解析失败的行。

```rust
// 当前
.and_then(|v| v.as_str().and_then(|s| s.parse().ok()))

// 目标
.and_then(|v| v.as_str().and_then(|s| {
    s.parse().map_err(|e| log::warn!("[query] 行解析失败: {} → {}", s, e)).ok()
}))
```

---

## 验证标准

### 自动化

- [ ] `cargo build` 无错误
- [ ] `cargo build --release` 无错误
- [ ] grep `.ok()` db_cmds.rs：每处均带日志或处于 `collect_rows_or_warn` 等已处理函数中

### 手动测试清单

> 验收方逐项操作勾选，一项不通过即判定 R-T2 未完成。

| # | 操作步骤 | 预期结果 | 对应验收 |
|---|---------|---------|:--:|
| M1 | 准备损坏的 JSON 导出文件，执行导入 | 前端收到错误报告，日志含 `[import]` 前缀 | V-T2 A4 |
| M2 | 删除 `world_settings` 表中的某行配置，重启应用 | 日志含 `[config] key not found`，应用不崩溃 | V-T2 V4 |
| M3 | 在项目目录下放置无权限读取的文件，触发备份流程 | 日志含文件遍历 warning，备份不中断 | V-T2 V8 |

---

## 预估影响

| 文件 | 改动量 | 风险评估 |
|------|:--:|------|
| `db_cmds.rs` | ~60 行 | 低风险（纯加日志和错误收集） |
