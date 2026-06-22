# T0 — 测试基础设施

> 任务 ID：T0  
> 优先级：**P0 致命**（后续所有任务的安全网）  
> 前置依赖：无

---

## 任务目标

建立最小化自动化测试基建，锁定当前正确行为，为后续 10 个重构任务提供回归保护。没有测试网，"修 1 个出 10 个"无法被及时发现。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 新建 | `vitest.config.ts` |
| 新建 | `src/lib/__tests__/storage.test.ts` |
| 新建 | `src/lib/__tests__/chapter-store.test.ts` |
| 新建 | `src/lib/__tests__/context-engine.test.ts` |
| 新建 | `src/lib/__tests__/parse-chapter-range.test.ts` |
| 修改 | `package.json`（新增 test 脚本 + devDependencies） |

## 子任务清单

- [ ] T0.1 安装依赖：`npm install -D vitest @testing-library/react jsdom`
- [ ] T0.2 新建 `vitest.config.ts`：jsdom 环境 + `@/` 路径别名（与 vite.config 对齐）
- [ ] T0.3 `package.json` 新增 `"test": "vitest run"` 和 `"test:watch": "vitest"`
- [ ] T0.4 编写 `storage.test.ts`（3 个用例）：
  - loadJSON 读已有 key 返回正确值
  - saveJSON 写后读回比对一致
  - 写入失败（mock localStorage.setItem 抛错）返回 `{ ok: false }` 或 `false`
- [ ] T0.5 编写 `chapter-store.test.ts`（5 个用例）：
  - 创建章节 → 读取一致
  - 读取不存在的章节 → 返回 null
  - 删除章节 → 再读为 null
  - 批量保存 → loadAllChapters 返回全部
  - 旧格式（plot-chapters-{pid}）迁移为新格式
- [ ] T0.6 编写 `context-engine.test.ts`（1 个用例）：
  - estimateTokens：中文/英文/混合文本各一组，断言返回值在合理区间
- [ ] T0.7 编写 `parse-chapter-range.test.ts`（4 个用例）：
  - "1-3" → [1,2,3]
  - "4,7-9" → [4,7,8,9]
  - "" → []
  - 中文逗号 "1，2" → [1,2]
- [ ] T0.8 运行 `npm run test`，确认全部通过

## 完成标准（自动化）

| # | 命令 | 预期输出 |
|---|------|---------|
| A1 | `npm run test` | 全部测试通过，**至少 13 个用例**，0 失败 |
| A2 | `npm run build` | 编译通过（测试文件不影响构建） |
| A3 | `npm run tsc --noEmit` | 无类型错误 |

## 完成标准（手动）

无（本任务纯基建，无 UI 交互）。

## 证据清单（我必须提交）

1. `git diff --stat` 输出，证明新增了 5 个文件 + 修改 package.json
2. `npm run test` 完整输出（含通过用例数）
3. `package.json` 的 scripts 和 devDependencies 截图（Read 工具）
4. `vitest.config.ts` 全文（Read 工具）

## 验收清单（你勾选）

- [ ] V1 证据 1 已提交，文件数符合预期（6 个文件变更）
- [ ] V2 证据 2 显示 ≥13 个用例全绿
- [ ] V3 证据 3 显示 test 脚本和 vitest 依赖已添加
- [ ] V4 证据 4 显示 vitest 配置含 jsdom + 路径别名
- [ ] V5 `npm run build` 无报错

## 回退方案

```bash
# 本任务纯新增，回退即删除新建文件 + 还原 package.json
git checkout -- package.json
rm -f vitest.config.ts src/lib/__tests__/storage.test.ts src/lib/__tests__/chapter-store.test.ts src/lib/__tests__/context-engine.test.ts src/lib/__tests__/parse-chapter-range.test.ts
rmdir src/lib/__tests__ 2>$null
```
