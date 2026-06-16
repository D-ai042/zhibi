# 执笔 v0.3.4 — Bug 修复清单

## 一、严重 Bug 修复

### 1. 自动保存光标跳转
- **现象**：在写作台编辑时，自动保存触发后光标跳回文首
- **根因**：`saveContent()` 调用 `setChapters()` 更新 state，触发 `useEffect([selectedChapterId, chapters])`，effect 中 `syncEditorHTML()` 重置编辑器 innerHTML，导致光标丢失
- **修复**：`WritingModule.tsx` 增加 `_skipNextChapterEffect` ref，`saveContent` 保存前设为 `true`，跳过本次 effect 执行
- **文件**：`src/modules/writing/WritingModule.tsx`

### 2. EXE 安装版保存后重启数据丢失
- **现象**：本地直接运行 EXE 正常，但通过安装包安装后，编辑内容保存后关闭重启，数据回退
- **根因**：`prewarmFromSqlite()` 启动时无条件用 SQLite 数据覆盖 localStorage（`localStorage.setItem(key, value)`）。如果 autosave 写了 localStorage 但异步 SQLite 写入未完成就关闭 app，下次启动 prewarm 用旧 SQLite 数据覆盖新的 localStorage 数据
- **修复**：`prewarmFromSqlite` 改为只写入 localStorage 中不存在的 key（`if (localStorage.getItem(key) === null)`）
- **文件**：`src/lib/storage.ts`

### 3. 导入丢失剧情走向和卷章树
- **现象**：导入备份后，剧情走向画布和写作台卷章树为空
- **根因**：`api.importProject()` 只恢复 SQLite 核心数据（角色、词条等），但剧情走向（`plot-segments-{pid}`）、卷章树（`plot-chapters-{pid}`）等存在 localStorage 中，未被恢复。且导入时项目 ID 可能变化（"新建"模式），旧 key 无法匹配新项目
- **修复**：
  - `export_project` 补充返回 `plotSegments`、`plotEdges`、`plotChapters`、`chapterIndex`、`chapterShards`、`worldviewEdges`、`worldviewGroups`
  - `doImportWithMode` 从 `projectData` 提取这些字段，用新 `project_id` 写入 localStorage
- **文件**：`src/lib/mock-backend.ts`、`src-tauri/src/commands/db_cmds.rs`、`src/components/settings/SettingsModal.tsx`

---

## 二、中危 Bug 修复

### 4. 记忆压缩只压缩一半消息
- **现象**：对话超过 20 轮后，记忆压缩只处理了前 10 轮
- **根因**：`processable.slice(0, rounds)` 中 `rounds` 是 user 消息数量（20），但 `processable` 包含 user+assistant（40 条），slice(0, 20) 只取了前 20 条
- **修复**：改为 `processable`（压缩全部待处理消息）
- **文件**：`src/lib/memory-engine.ts`

### 5. 定稿流程切换章节导致写入错误
- **现象**：定稿过程中切换章节，摘要/质量检查等操作写入错误的章节
- **根因**：定稿 `onClick` 是 async 函数，`selectedChapter` 在闭包中可能被更新
- **修复**：定稿开始时快照 `finalizeChapterId`、`finalizeChapterNum`、`finalizeChapterTitle`、`finalizeContent`，全程使用快照值
- **文件**：`src/modules/writing/WritingModule.tsx`

### 6. 项目阶段永远不更新
- **现象**：Header 始终显示"构思中"
- **根因**：整个代码库没有 `stage` 的更新逻辑
- **修复**：定稿后自动更新阶段：`framework_locked` → `writing`，全部章节写完 → `completed`
- **文件**：`src/modules/writing/WritingModule.tsx`

### 7. 重新生成可能删错消息
- **现象**：点"重新生成"后丢失用户原始输入
- **根因**：`handleRegenerate` 假设最后一条 assistant 消息的前一条是 user（`realIdx - 1`），但中间可能有 system 消息
- **修复**：从 `realIdx` 向前遍历找第一条 `role === "user"` 的消息
- **文件**：`src/layouts/AiChatPanel.tsx`

### 8. 编辑消息 setInput 竞态
- **现象**：编辑用户消息重新发送时，可能发送旧内容
- **根因**：`setInput(text)` 是异步 state 更新，`requestAnimationFrame` 中 send 读取的 input 可能是旧值
- **修复**：改用 `editingContentRef.current` 读取最新值
- **文件**：`src/layouts/AiChatPanel.tsx`

### 9. 词条改名后关系连线断裂
- **现象**：通过"X改为Y"指令改名词条后，世界观画布上的连线和编组丢失
- **根因**：`deleteWorldTerm` + `saveWorldTerm` 生成新 ID，所有引用旧 ID 的连线/编组失效
- **文件**：`src/layouts/AiChatPanel.tsx`

---

## 三、低危 Bug 修复

### 10. 快照年龄 NaN 排序异常
- **修复**：`parseInt(age)` → `(parseInt(age) || 0)`，无效 age 跳过
- **文件**：`src/lib/context-engine.ts`、`src/lib/memory-updater.ts`

### 11. 拖拽回调频繁重建
- **修复**：移除 `[pos]` 依赖，改为从 DOM 读取位置
- **文件**：`src/components/editor/AiWritingDialog.tsx`

### 12. 上下文面板竞态条件
- **现象**：快速切换章节时上下文面板显示错误数据
- **修复**：`loadGen` 计数器守卫，过期请求丢弃
- **文件**：`src/modules/writing/WritingModule.tsx`

### 13. localStorage 写入无 try-catch
- **修复**：全局替换为 `getJSONSync` + `try-catch`
- **文件**：`src/layouts/AiChatPanel.tsx`

### 14. 待确认角色列表 key 冲突
- **修复**：`key={i}` → `key={c.name}`
- **文件**：`src/layouts/AiChatPanel.tsx`

### 15. parseEdgeActions 正则过于贪婪
- **修复**：缩小匹配范围到 `---WORLD_TERMS---` 标记前
- **文件**：`src/layouts/AiChatPanel.tsx`

### 16. existingEdges 用旧快照做重复检查
- **修复**：删除旧关系后重新加载 edges 集合
- **文件**：`src/layouts/AiChatPanel.tsx`

---

## 四、macOS 构建修复

### 17. DMG 文件互相覆盖
- **现象**：Intel 和 ARM 两个 macOS 构建输出同名 `.dmg`，后上传的覆盖先上传的，导致文件损坏
- **修复**：文件名区分架构（`dmg-x64.dmg` / `dmg-arm64.dmg`）
- **文件**：`.github/workflows/build.yml`

### 18. macOS 找不到 DMG 产物
- **现象**：macOS 构建成功但"重命名产物"步骤失败
- **修复**：按平台指定 `--bundles dmg` / `--bundles nsis`，搜索多个输出路径
- **文件**：`.github/workflows/build.yml`

---

## 五、NSIS 安装包行为修复

### 19. 安装时"卸载"选择无效
- **现象**：安装新版时弹出"是否卸载旧版"，无论选什么都直接卸载
- **根因**：Tauri NSIS 模板硬编码行为，无法通过配置修改
- **修复**：改用 MSI 安装包分发（原生支持平滑覆盖升级），NSIS 从构建目标中移除
- **文件**：`src-tauri/tauri.conf.json`

---

## 构建产物

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `zhibi.exe`（便携版） | 双击即用，无需安装 |
| Windows | `zhibi-writer_0.3.4_x64_en-US.msi` | MSI 安装包，平滑升级 |
| macOS Intel | `zhibi-v0.3.4-dmg-x64.dmg` | Intel Mac 安装包 |
| macOS ARM | `zhibi-v0.3.4-dmg-arm64.dmg` | M1/M2/M3/M4 Mac 安装包 |
