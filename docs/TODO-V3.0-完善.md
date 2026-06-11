# 执笔 v3.0 待完善清单

> 创建时间：2026-06-11
> 基于全面审查（数据流 + 存储层 + 撤回保护）

---

## 一、🔴 P0 — 数据存储与迁移重构

### 1.1 `getJSONSync` EXE 模式下不读 SQLite（致命）

**文件**：`src/lib/storage.ts`

**问题**：
```typescript
export function getJSONSync<T>(key: string, def: T): T {
    const raw = localStorage.getItem(key);  // ← 永远只读 localStorage
    if (!raw) return def;                   // ← 找不到就回默认值
    ...
}
```

迁移把数据从 localStorage → SQLite 后，所有用 `getJSONSync` 的模块（WritingModule、context-engine、app-store、memory-engine 等 20+ 处）**仍然只读 localStorage**。只要 WebView2 重置 localStorage，SQLite 里有数据也读不回。

**影响范围**（所有用同步读的模块）：

| 模块 | 影响数据 |
|------|---------|
| `WritingModule.tsx` | plot-chapters、plot-segments、plot-edges |
| `context-engine.ts` | plot-chapters、plot-segments、plot-edges、worldview-edges、novel-workbench-log、novel-workbench-bible |
| `app-store.ts` | novel-workbench-chat、novel-workbench-chat-name |
| `memory-engine.ts` | novel-workbench-memory-short、novel-workbench-memory-long、novel-workbench-compressed-idx |
| `memory-updater.ts` | plot-segments、plot-chapters、chapter-hash、novel-workbench-log、novel-snapshots |
| `WorldviewPanel.tsx` | worldview-edges、worldview-groups |
| `PlotDirectionPanel.tsx` | plot-segments、plot-edges、plot-positions、plot-groups |
| `CharactersModule.tsx` | novel-workbench-mock、char-groups |
| `MaterialModule.tsx` | material- |
| `InspirationPanel.tsx` | inspiration-cards |
| `AiChatPanel.tsx` | plot-segments、plot-edges、plot-chapters、ai-pending-chars、novel-workbench-mock、worldview-edges |

**修复方案**：
- `getJSONSync` 在 EXE 模式下：`localStorage → 读取失败 → 异步查 SQLite → 写回 localStorage → 返回`
- `setJSONSync` 在 EXE 模式下：同时写 `localStorage + SQLite`（当前已经是 fire-and-forget，可保留）

### 1.2 Rust 数据目录在 exe 旁边（安装版崩溃）

**文件**：`src-tauri/src/db/mod.rs` / `src-tauri/src/commands/db_cmds.rs`

```rust
pub fn projects_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()  // ← exe 旁边
        ...
    exe_dir.join("data").join("projects")
}

fn open_or_create_settings_db() -> rusqlite::Connection {
    ...
    let conn = rusqlite::Connection::open(&path).expect("open settings.db"); // ← 会 panic!
    ...
}
```

**问题**：
1. 安装到 `C:\Program Files\` 后，普通用户无法在 exe 目录下创建 `data/projects/`
2. `expect()` → 数据库打不开时整个进程崩溃，无法优雅降级

**修复方案**：
- 改用 `app.path().app_data_dir()`（Tauri v2 API）→ 实际路径为 `%APPDATA%/com.zhibi.writer/`
- 所有 `expect()` 改为 `map_err()` 返回 `Result`

### 1.3 迁移标记在全部失败时仍会写入

**文件**：`src/lib/migrate-data.ts`

```typescript
// 即使所有 key 都迁移失败，标记也被写入
try {
    await api.setSetting(MIGRATION_FLAG_KEY, "1");
} catch { }
```

**修复方案**：
- 只有 `count > 0`（至少成功迁移了一条）才写入标记
- 或者记录成功/失败计数，失败率 > 50% 不写标记

### 1.4 迁移列表缺失的 key

**文件**：`src/lib/migrate-data.ts` — `MIGRATABLE_PREFIXES`

当前缺了以下 key 前缀（数据永远不会被迁移到 SQLite）：

| 缺失前缀 | 存储内容 | 影响 |
|---------|---------|------|
| `novel-snapshots-` | 项目快照列表 | 定稿回退恢复 |
| `novel-workbench-memory-short-` | AI 短期记忆 | AI 对话上下文丢失 |
| `novel-workbench-memory-long-` | AI 长期记忆 | AI 对话上下文丢失 |
| `novel-workbench-compressed-idx-` | 记忆压缩索引 | AI 记忆错乱 |
| `inspiration-cards-` | 灵感卡片 | 灵感面板数据丢失 |
| `char-groups-` | 角色分组 | 角色星图分组丢失 |
| `chapter-hash-` | 内容哈希缓存 | 每章重复 AI 分析 |
| `ai-pending-world-terms-` | 待确认世界观词条 | AI 写入审核丢失 |
| `novel-workbench-mock` | Mock 全量数据 | 浏览器模式数据丢失 |
| `novel-workbench-snapshots-` | 快照（mock 中） | 快照历史丢失 |

---

## 二、🔴 P1 — 不可撤销操作修复

### 2.1 世界观词条删除（无保护）

**文件**：`src/modules/outline/WorldviewPanel.tsx`

```typescript
delRef.current = useCallback(async (id: string) => {
    await api.deleteWorldTerm(id);  // ← 无确认、无快照
    setTerms(p => p.filter(t => t.id !== id));
    ...
}, [setNodes, setEdges, currentProject]);
```

ReactFlow 还配置了 `deleteKeyCode="Delete"`，按 Delete 键直接删除选中词条。

**修复方案**：
- 加 `window.confirm("确定删除词条「xxx」？")` 确认框
- 或加 undo 快照栈（参考 `PlotDirectionPanel` 的 `pushSnapshot` 模式）

### 2.2 写作台删除章节（无保护）

**文件**：`src/modules/writing/WritingModule.tsx`

```typescript
const deleteChapter = useCallback((chId: string) => {
    if (!pid) return;
    const all = loadChapters(pid).filter(c => c.id !== chId);  // ← 直接过滤掉
    saveChapters(pid, all);  // ← 覆盖保存
    ...
}, [pid, selectedChapterId]);
```

**修复方案**：
- 加 `window.confirm()` 确认框
- 或将删除的章节暂存到 undo 栈中

### 2.3 自定义模块删除（无保护）

**文件**：`src/components/custom-module/CustomModuleRenderer.tsx`

```typescript
<button onClick={() => removeCustomModule(mod.id)}>  // ← 无确认
```

**修复方案**：
- 加 `window.confirm()` 确认框

### 2.4 清空聊天记录（无保护）

**文件**：`src/stores/app-store.ts`

```typescript
clearChat: () => {
    set({ chatMessages: [] });  // ← 无确认
    setTimeout(() => get().persistChat(), 0);
},
```

**修复方案**：
- 在调用处加确认框（`AiChatPanel.tsx` 中 `clearChat` 按钮）

### 2.5 故事铁则条目删除（无保护）

**文件**：`src/modules/story-bible/StoryBibleModule.tsx`

删除按钮直接调用 `removeEntry`，无确认框。

**修复方案**：
- 加确认框

---

## 三、🟡 P2 — 自动更新机制完善

### 3.1 配置补齐

**文件**：`src-tauri/tauri.conf.json`

```json
"plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://ghfast.top/github.com/D-ai042/zhibi/releases/latest/download/latest.json"
      ],
      "dialog": true,
      "pubkey": ""  // ← 需要填入公钥
    }
}
```

**问题**：
- `pubkey` 为空 → 客户端无法验证签名
- `latest.json` 未发布 → 客户端不知道有新版本
- 需要生成签名密钥对（`tauri signer generate`）

**修复方案**：
1. 生成 Tauri 签名密钥
2. 配置 GitHub Actions 构建时签名
3. CI 流程中生成并上传 `latest.json`
4. 将公钥填入 `tauri.conf.json`

---

## 四、🟡 P3 — 体验改进

### 4.1 章节选取模式无反馈

**文件**：`src/modules/writing/WritingModule.tsx`

UI 中章节选取模式（`chapterSelectMode`）的交互比较隐晦，用户不知道已经进入了选取模式。

**改进**：
- 选取模式时在卷章树顶部显示 banner："已选择 N 章，发送 AI 消息后自动清空"
- 选取按钮增加视觉反馈（颜色/动画）

### 4.2 定稿按钮进度透明

**文件**：`src/modules/writing/WritingModule.tsx`

定稿时依次触发 `updateMemory` → `activateNextChapterTerms` → `activateNextChapterCharacters` → `createSnapshot`，但 UI 上只有一个按钮，无进度提示。

**改进**：
- 加 `loading` 状态，按钮禁用并显示"定稿中…"
- 可选：在按钮下方显示进度文字

### 4.3 localStorage → SQLite 迁移无 UI 反馈

**文件**：`src/hooks/use-project-data.ts`

迁移在后台静默执行，用户不知道是否成功、迁移了多少条。

**改进**：
- 迁移完成后在控制台输出统计（已实现）
- 第一次启动时在欢迎页右下角显示「数据迁移完成（N 条）」

---

## 五、代码健康度

### 5.1 废弃代码清理

| 文件 | 废弃内容 |
|------|---------|
| `src/lib/quality-checker.ts` | 整个模块已不再使用 |
| `_exe_Writing_1317.tsx` | 根目录的旧版写作台 |
| `temp_src_lib_memory-updater.ts` | 临时文件 |
| `src/lib/context-engine.ts` 中 `inviolable_rules` 输出 | 始终为空 |
| `src/lib/context-engine.ts` 中 `main_stages` 输出 | 已在 P1 重复 |
| 节拍卡片（beat_cards）相关代码 | 已在 2.0 移除，检查残留 |

### 5.2 `chapter-hash-` 缓存脏检测漏洞

**文件**：`src/lib/memory-updater.ts`

```typescript
const lastHashKey = `chapter-hash-${projectId}-${chapterNumber}`;
```

内容哈希只在 `updateMemory` 时保存和检测，但 `updateMemory` 只在**定稿**时才调用。用户保存章节内容后如果直接关闭应用，哈希缓存比内容旧，下次打开定稿时不会触发重新分析。

**改进**：保存章节时（`saveContent`）同时更新哈希缓存。

---

## 六、汇总：各模块撤回保护覆盖表

| 模块 | 删除 | 修改 | 拖拽位置 | 评估 |
|------|:---:|:---:|:--------:|------|
| 欢迎页 · 项目 | ✅确认 | — | — | 🟢 |
| 角色星图 | ✅快照 | ✅快照 | ❌ | 🟡 |
| **世界观星图** | **❌** | ✅快照 | ❌ | 🔴 |
| 剧情走向 | ✅快照 | ✅快照 | ✅快照 | 🟢 |
| **写作台 · 章节** | **❌** | — | — | 🔴 |
| 写作台 · 内容 | ✅撤销栈 | ✅撤销栈 | — | 🟢 |
| **自定义模块** | **❌** | — | — | 🔴 |
| 素材库 | ✅确认 | ✅确认 | — | 🟢 |
| 灵感面板 | ✅确认 | ✅确认 | — | 🟢 |
| **聊天记录** | **❌** | — | — | 🔴 |
| 故事铁则 | ❌ | ❌ | — | 🟡 |

---

## 七、修复优先级建议

```
第一优先（P0 — 数据不会丢）
  ├── 1.1 getJSONSync 双读回退
  ├── 1.2 数据目录改到 %APPDATA%
  ├── 1.3 迁移失败不写标记
  └── 1.4 补齐缺失的迁移前缀

第二优先（P1 — 操作不会丢）
  ├── 2.1 世界观词条删除确认
  ├── 2.2 写作台删除章节确认
  ├── 2.3 自定义模块删除确认
  ├── 2.4 清空聊天确认
  └── 2.5 故事铁则删除确认

第三优先（P2 — 发布体验）
  ├── 3.1 自动更新配置
  ├── 4.1 章节选取反馈
  └── 4.2 定稿进度

第四优先（P3 — 代码健康）
  ├── 5.1 废弃代码清理
  └── 5.2 哈希缓存同步
```
