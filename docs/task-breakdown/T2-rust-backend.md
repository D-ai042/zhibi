# T2 — Rust 后端修复

> 任务 ID：T2  
> 优先级：**P0 致命**（崩溃 / 凭据泄露 / 路径遍历）  
> 前置依赖：无（可与 T1 并行）

---

## 任务目标

修复 Rust 端全部致命问题：静默 `.ok()` 吞错（44 处）、`.unwrap()` 崩溃（3 处互斥锁 + 9 处序列化）、`.expect()` 崩溃（2 处）、API 凭据 URL 泄露、路径遍历、清理未用依赖。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src-tauri/src/commands/db_cmds.rs` |
| 修改 | `src-tauri/src/db/mod.rs` |
| 修改 | `src-tauri/src/lib.rs` |
| 修改 | `src-tauri/src/commands/ai.rs` |
| 修改 | `src-tauri/src/commands/export.rs` |
| 修改 | `src-tauri/Cargo.toml` |

## 子任务清单

### 2.1 静默 `.ok()` 分三类处理（44 处）

- [ ] T2.1 DELETE 清理 9 处（db_cmds.rs:1200-1208）：保留 `.ok()`，加 `log::warn!("清理旧数据失败: {e}")`
- [ ] T2.2 INSERT OR REPLACE 9 处（db_cmds.rs:1290-1410）：收集错误到 `Vec<String>`，导入完统一报告前端
- [ ] T2.3 CREATE TABLE IF NOT EXISTS 1 处（db_cmds.rs:1429）：保留 `.ok()`（表已存在是预期）
- [ ] T2.4 其余 `.ok()` 逐个评估：容错型保留 + 加日志；关键型改 `?` 传播

### 2.2 互斥锁崩溃（3 处）

- [ ] T2.5 `db_cmds.rs:211` `state.0.lock().unwrap()` → `unwrap_or_else(\|e\| e.into_inner())`
- [ ] T2.6 `db/mod.rs:61` `with_conn` 同上处理
- [ ] T2.7 `db/mod.rs:70` `open_project_db` 同上处理

### 2.3 `.expect()` 崩溃（2 处）

- [ ] T2.8 `db/mod.rs:71` `.expect("no project db open")` → 返回 `Result`，前端展示"请先打开项目"
- [ ] T2.9 `lib.rs:66` `.expect("error while running tauri application")` → 捕获 panic + 对话框提示

### 2.4 凭据泄露

- [ ] T2.10 `ai.rs:162` 百度密钥从 URL query string 改为 POST body

### 2.5 路径遍历

- [ ] T2.11 `export.rs:43-49` 验证写入路径在 `data_dir()` 子目录内，否则拒绝

### 2.6 依赖清理

- [ ] T2.12 移除 `futures-util`、`keyring`、`dirs`
- [ ] T2.13 移除 `reqwest` 的 `stream` feature（**保留 multipart** — STT 在用）
- [ ] T2.14 `tokio` feature `full` → `["rt-multi-thread", "macros"]`

### 2.7 序列化 unwrap（9 处）

- [ ] T2.15 `db_cmds.rs:468,469,494,553,575,705,780,842,917` 共 9 处 `serde_json::to_string().unwrap()` → `.map_err(\|e\| format!("序列化失败: {e}"))?` 或 `.unwrap_or_default()`

### 2.8 验证

- [ ] T2.16 `cargo build` 通过
- [ ] T2.17 `cargo build --release` 通过

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `cargo build` | 无错误 |
| A2 | `cargo build --release` | 无错误，生成 EXE |
| A3 | grep `.unwrap()` db_cmds.rs | 互斥锁 3 处已改（数量下降） |
| A4 | grep `.ok()` src-tauri | 关键路径 `.ok()` 减少，保留的均带 `log::warn` |
| A5 | grep `client_secret=` ai.rs | **0 处**（凭据不再在 URL） |
| A6 | grep `multipart` Cargo.toml | 仍存在（未被误删） |
| A7 | grep `stream` Cargo.toml reqwest 行 | 已移除 |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 项目未打开时调用任何命令 | 提示"请先打开项目"，不崩溃 |
| M2 | 快速反复切换项目 | 无死锁/崩溃 |
| M3 | STT 语音输入 | 正常工作（验证 multipart 未被误删） |
| M4 | 抓包检查 STT 请求 | 密钥在 POST body，不在 URL query |
| M5 | 尝试导出到任意路径 | 拒绝写入 data_dir 之外 |
| M6 | 导入损坏数据 | 收到明确错误，不显示"成功" |
| M7 | 打开损坏 .db 文件 | 友好提示，不 panic |

## 证据清单（我必须提交）

1. `git diff --stat` 输出
2. `cargo build` 完整输出
3. `cargo build --release` 完整输出
4. grep `.unwrap()` db_cmds.rs 前后对比（数量减少）
5. grep `.ok()` db_cmds.rs 输出（证明保留的均带 log::warn）
6. `ai.rs:160-165` 改动后代码（Read 工具，证明密钥在 body）
7. `Cargo.toml` 依赖段（Read 工具，证明 multipart 在、stream 删、tokio 精简）
8. grep `client_secret` ai.rs 输出（0 处）

## 验收清单（你勾选）

- [ ] V1 证据 1-3：编译全部通过
- [ ] V2 证据 4-5：unwrap 和 .ok() 数量对账符合预期
- [ ] V3 证据 6-8：凭据/依赖修复确认
- [ ] V4 手动 M1：未打开项目不崩溃
- [ ] V5 手动 M2：切换项目无死锁
- [ ] V6 手动 M3：STT 正常（multipart 未误删）
- [ ] V7 手动 M4：抓包确认密钥在 body
- [ ] V8 手动 M5：路径遍历被拒
- [ ] V9 手动 M6-M7：错误处理友好

## 回退方案

```bash
git checkout 418c623 -- src-tauri/
```
