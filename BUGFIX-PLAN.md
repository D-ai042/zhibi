# 严重功能 Bug 修复计划

> 生成日期：2026-06-26
> 原则：只做功能不变的 bug 修复，不改变 UI 布局和用户功能，不强制重构耦合代码

---

## 批次一：EXE 模式下删除操作失效（window.confirm 被拦截）

### 根因
Tauri 2.x WebView2 拦截 `window.confirm()`，尝试调用 `plugin:dialog|confirm`，但 dialog 插件 v2.7.1 已废弃 `confirm` 命令（合并为 `message`），ACL 无对应权限导致拒绝。`alert()` 同族 API 同理。

### 影响范围
17 处 `window.confirm` + 2 处 `alert`，覆盖全部删除/清空确认操作。

### 涉及文件
- `src/lib/confirm.ts`（新建）
- `src/modules/writing/WritingModule.tsx`
- `src/modules/writing/ChapterTree.tsx`
- `src/layouts/AiChatPanel.tsx`
- `src/layouts/ChatPanelLayout.tsx`
- `src/layouts/AppShell.tsx`
- `src/modules/characters/CharactersModule.tsx`
- `src/modules/characters/CustomEdge.tsx`
- `src/modules/outline/WorldviewPanel.tsx`
- `src/modules/story-bible/StoryBibleModule.tsx`
- `src/modules/material/MaterialModule.tsx`
- `src/modules/plot-direction/PlotStoryNode.tsx`
- `src/modules/manuscript/InspirationPanel.tsx`
- `src/components/custom-module/CustomModuleRenderer.tsx`

### 修复方案
1. 新建 `src/lib/confirm.ts`，导出 `confirmDialog(message): Promise<boolean>` 和 `alertDialog(message): Promise<void>`
2. 浏览器模式走 `window.confirm` / `window.alert`
3. EXE 模式走 `@tauri-apps/plugin-dialog` 的 `message` 函数
4. 将所有 `window.confirm(...)` 替换为 `await confirmDialog(...)`（调用方需变 async）
5. 将所有 `alert(...)` 替换为 `await alertDialog(...)`

### 验收标准
- [ ] EXE 模式下点击删除章节/角色/词条，弹出确认对话框
- [ ] 确认后执行删除，取消后不执行
- [ ] 浏览器开发模式行为不变
- [ ] `npm run tsc -- --noEmit` 通过
- [ ] `npm run build` 通过

---

## 批次二：数据删除不彻底（EXE 模式存储泄漏）

### 根因
`deleteChapter` 用 `setJSONSync(key, null)` 写入字符串 `"null"` 而非真正删除 key。`deleteSnapshot` 和 `WelcomeScreen` 删除项目时用 `localStorage.removeItem`，未清理 SQLite。

### 涉及文件
- `src/lib/chapter-store.ts`
- `src/lib/memory-updater.ts`
- `src/components/welcome/WelcomeScreen.tsx`
- `src/lib/__tests__/chapter-store.test.ts`（调整断言）

### 修复方案
1. `chapter-store.ts:107` — `setJSONSync(key, null)` → `removeSync(key)`
2. `memory-updater.ts:724` — `localStorage.removeItem(...)` → `removeSync(...)`
3. `WelcomeScreen.tsx:68` — `setJSONSync(key, null); localStorage.removeItem(key)` → `removeSync(key)`
4. `WelcomeScreen.tsx:72` — `localStorage.removeItem(...)` → `removeSync(...)`
5. 调整 `chapter-store.test.ts` 中删除相关断言：断言 key 不存在而非值为 null

### 验收标准
- [ ] 删除章节后，`localStorage` 和 SQLite 中 `chapter-{pid}-{id}` key 不存在
- [ ] 删除快照后，分片数据从 SQLite 清除
- [ ] 删除项目后，聊天记录从 SQLite 清除
- [ ] 重启 EXE 后被删除的数据不会"复活"
- [ ] `npm run test` 通过

---

## 批次三：WelcomeScreen 无错误处理 + rename_project 数据库未打开

### 根因
`WelcomeScreen.tsx` 的 `confirmRename`、`confirmDelete`、`create`、`open` 均无 try/catch。Rust 侧 `rename_project` 不自动打开数据库。

### 涉及文件
- `src-tauri/src/commands/db_cmds.rs`
- `src/components/welcome/WelcomeScreen.tsx`

### 修复方案
1. `db_cmds.rs` `rename_project` — 开头加 `open_project_db(&project_id, &state).map_err(|e| e.to_string())?;`
2. `WelcomeScreen.tsx` `confirmRename` — 包 try/catch，失败时 alert + 不关闭输入框
3. `WelcomeScreen.tsx` `confirmDelete` — 包 try/catch，失败时 alert + 不关闭确认框
4. `WelcomeScreen.tsx` `create` — 加 catch，失败时 alert
5. `WelcomeScreen.tsx` `open` — 包 try/catch，失败时 alert

### 验收标准
- [ ] EXE 模式下重命名项目成功
- [ ] 重命名失败时弹出错误提示，输入框不卡死
- [ ] 删除项目失败时弹出错误提示，确认框不卡死
- [ ] 创建项目失败时弹出错误提示，按钮恢复
- [ ] `npm run tsc -- --noEmit` 通过
- [ ] `cargo build` 通过（Rust 侧改动）

---

## 批次四：保存返回值未检查 + 竞态保护失效

### 根因
`loadCtx` 的竞态保护变量 `loadGen` 用 `let` 而非 `useRef`，每次渲染重置导致保护失效。多处 `saveChapter`/`saveAllChapters` 返回值未检查。`aiExtractNewCharacters` 未 await 导致 try/catch 失效。

### 涉及文件
- `src/modules/writing/WritingModule.tsx`
- `src/modules/writing/finalizeChapter.ts`

### 修复方案
1. `WritingModule.tsx:111` — `let loadGen = 0` → `const loadGenRef = useRef(0)`，函数内 `++loadGenRef.current`
2. `WritingModule.tsx:138` — `addChapter` 将副作用移出 state updater
3. `WritingModule.tsx:140` — `renameChapter` 检查 `saveChapter` 返回值
4. `WritingModule.tsx:143` — `persistAiChapters` 检查返回值
5. `finalizeChapter.ts:152` — `aiExtractNewCharacters` 改为 `.catch(() => {})` fire-and-forget

### 验收标准
- [ ] 快速切换章节后，上下文面板显示的内容对应当前选中章节
- [ ] 保存失败时状态栏显示"⚠ 保存失败"
- [ ] AI 写作后内容保存失败时有提示
- [ ] 定稿不再产生 unhandled rejection
- [ ] `npm run test` 通过
- [ ] `npm run tsc -- --noEmit` 通过

---

## 批次五：数据健壮性（JSON.parse 无保护 + UI 偏好丢失）

### 根因
`mock-backend.ts:77` 主存储 `JSON.parse` 无 try-catch，数据损坏导致全 API 瘫痪。Store 初始化早于 prewarm，EXE 启动后 UI 偏好丢失。`OutlineModule.tsx` 裸 `JSON.parse` 无保护。聊天持久化失败静默。

### 涉及文件
- `src/lib/mock-backend.ts`
- `src/stores/app-store/character-slice.ts`
- `src/stores/app-store/ui-slice.ts`
- `src/hooks/use-project-data.ts`
- `src/modules/outline/OutlineModule.tsx`
- `src/stores/app-store/writing-state-slice.ts`

### 修复方案
1. `mock-backend.ts:77` — `JSON.parse` 包 try-catch，失败时清除损坏数据并返回默认值
2. `use-project-data.ts` — prewarm 完成后重新读取 UI 偏好并更新 store
3. `OutlineModule.tsx:21` 等 — 裸 `JSON.parse(localStorage.getItem(...))` 替换为 `getJSONSync`
4. `writing-state-slice.ts:32` — catch 中加 `reportDiagnostic`

### 验收标准
- [ ] 手动损坏 `novel-workbench-mock` 后启动浏览器模式，不崩溃，恢复默认数据
- [ ] EXE 重启后角色区域勾选状态保留
- [ ] 大纲模块在损坏数据下不崩溃
- [ ] 聊天保存失败时诊断面板有记录
- [ ] `npm run test` 通过

---

## 执行顺序

每批完成后顺序执行：
```
cd /d F:\projects\ai-novel-writer
npm.cmd run test
npm.cmd run tsc -- --noEmit
npm.cmd run build
```

批次三涉及 Rust 改动，额外执行 `cargo build`（在 `src-tauri/` 目录）。

## 成功标准
- test 通过
- tsc 通过
- build 通过
- EXE 模式下删除/重命名/保存/定稿操作正常
- 无 unhandled rejection
- 数据删除后不复活
