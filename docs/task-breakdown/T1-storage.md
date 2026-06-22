# T1 — storage.ts 精简

> 任务 ID：T1  
> 优先级：**P0 致命**（B1 章节丢失的根因）  
> 前置依赖：T0

---

## 任务目标

精简 storage.ts 从 12 个导出函数到 2 个核心 API（`loadJSON` / `saveJSON`），修复写入静默失败问题（B1），保留同步签名避免波及 104+ 调用点连锁修改。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/storage.ts`（146 行 → 精简） |
| 修改 | `src/lib/diagnostics.ts`（新建，若不存在）含 `reportDiagnostic` |

## 子任务清单

- [ ] T1.1 删除 6 个死代码导出：`projectKey`、`prewarmFromSqlite`（迁入 use-project-data.ts）、`get`、`set`、`remove`、`getJSON`、`removeSync`、`setJSON` (async)
- [ ] T1.2 `getJSONSync` 重命名为 `loadJSON`，接口签名不变（key + defaultVal）
- [ ] T1.3 `setJSONSync` 重命名为 `saveJSON`，返回 `boolean`：成功 `true`；失败捕获异常 → `reportDiagnostic()` + UI Toast → 返回 `false`
- [ ] T1.4 `saveJSON` 内部写后验证：`setSync` 后立即 `getSync` 读回比对，不一致 → `reportDiagnostic()` + 返回 `false`
- [ ] T1.5 `setSync` 写入失败时不再只 `console.warn`，改为抛异常让 `saveJSON` 捕获
- [ ] T1.6 保留 `setJSONSync` / `getJSONSync` 作为废弃别名，标记 `@deprecated`：
  - `getJSONSync` → 直接指向 `loadJSON`
  - `setJSONSync` 返回 `void`，内部调 `saveJSON`，失败时调 `reportDiagnostic()`（**不直接指向 saveJSON**，避免 50 个调用点静默丢错）
- [ ] T1.7 新建/补充 `reportDiagnostic` 实现：写入失败的 Toast + 日志（不写入 localStorage，避免新的静默失败）
- [ ] T1.8 运行 T0 测试 + build 验证

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | T0 的测试全绿 + storage 新测试全绿 |
| A2 | `npm run tsc --noEmit` | 无类型错误 |
| A3 | `npm run build` | 编译通过 |
| A4 | grep `export function` storage.ts | 导出函数 ≤ 6 个（loadJSON/saveJSON/getSync/setSync + 2 别名）。`getSync` 被 backup/mock/migrate/memory 4 文件依赖无法删除。 |
| A5 | grep `console.warn` storage.ts | `setSync` 内无静默 `console.warn`（改为 throw） |

## 完成标准（手动）

| # | 操作 | 预期 |
|---|------|------|
| M1 | 模拟保存失败（如 localStorage 配额耗尽） | 界面出现红色 Toast"保存失败"，**不**显示"已保存" |
| M2 | 正常保存章节 → 重开 | 内容保留 |
| M3 | 控制台无新报错 | （dev 模式下观察） |

## 证据清单（我必须提交）

1. `git diff --stat` 输出
2. `npm run test` 完整输出
3. `npm run tsc --noEmit` 输出（无错误）
4. `git diff storage.ts` 关键改动行（Read 工具读 saveJSON / setSync / 别名部分）
5. grep `export function` storage.ts 的输出（证明函数数减少）
6. grep `console.warn` storage.ts 的输出（证明静默 warn 已移除）

## 验收清单（你勾选）

- [ ] V1 证据 1-3 已提交，编译 + 测试通过
- [ ] V2 证据 4 显示 saveJSON 返回 boolean 且写后验证逻辑存在
- [ ] V3 证据 5 显示导出函数数 ≤ 6
- [ ] V4 证据 6 显示 setSync 不再静默 console.warn
- [ ] V5 手动 M1：保存失败有红色 Toast
- [ ] V6 手动 M2：正常保存重开内容在
- [ ] V7 别名 setJSONSync 返回 void 并内部自检（非直接指向 saveJSON）

## 回退方案

```bash
git checkout 418c623 -- src/lib/storage.ts
# 若新建了 diagnostics.ts：
rm -f src/lib/diagnostics.ts
```
