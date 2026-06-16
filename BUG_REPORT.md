# 🐛 Bug 审计报告 — AI Novel Writer (zhibi v0.3.3)

**项目：** `F:/Projects/ai-novel-writer` · **技术栈：** React 18 + TypeScript 5.7 + Vite 6 + Zustand 5 + Tauri 2  
**审计日期：** 2026-06-16 · **合并：** 4 份代码审计 + 1 份架构审计 + 1 份作家视角功能审计  
**去重核实后总计：33 个 Bug**

---

## 🔴 致命级 (Critical) — 6 个

### CR-0 · localStorage 5MB 硬限制 — 长篇小说超限崩溃

| 项目 | 内容 |
|------|------|
| **文件** | `src/lib/mock-backend.ts` L183, `src/lib/storage.ts` L117-122, `src/layouts/AiChatPanel.tsx` 6处, 共23处 `localStorage.setItem` |
| **触发** | 长篇写到 100–120 章，总数据接近 5MB |
| **后果** | `QuotaExceededError` → 保存静默失败 → 刷新后数据回退 |
| **影响功能** | 全应用（浏览器模式致命，EXE 模式部分数据也过 localStorage） |

**修复方案：**
```
1. src/lib/storage.ts setSync() — 浏览器模式加显式 try-catch + 用户提示
2. src/layouts/AiChatPanel.tsx 6处 — 替换直接 localStorage.setItem 为 storage.setSync
3. src/lib/mock-backend.ts save() — 分片存储（按项目拆分 key，不要全量打到一个 key）
4. 长线方案：实现 IndexedDB 存储层（上限 ~500MB），localStorage 仅作缓存
```

---

### SYS-1 · 自动保存完全是假的

| 项目 | 内容 |
|------|------|
| **文件** | `src/hooks/use-project-data.ts` L40-42 |
| **触发** | 任何时候崩溃、断电、浏览器关闭 |
| **后果** | 丢失所有未手动点"保存"的内容（可能是几小时的工作） |

**当前代码：**
```typescript
// 每30秒只改状态栏文字，不触发任何保存
const t = setInterval(() => {
    useAppStore.getState().setAutosaveStatus("自动保存 " + new Date().toLocaleTimeString());
}, 30000);
```

**修复方案：**
```typescript
// 替换为真正的自动保存
const t = setInterval(() => {
    const state = useAppStore.getState();
    // 调用 WritingModule 暴露的保存函数
    if (state.currentProject) {
        state.triggerAutosave?.();  // 新增 triggerAutosave action
    }
}, 30000);
```

同时在 `WritingModule.tsx` 的编辑器中加 **debounced auto-save**（停止输入 2 秒后自动保存）。

---

### SYS-2 · 所有章节存在一个 localStorage key 里

| 项目 | 内容 |
|------|------|
| **文件** | `src/modules/writing/WritingModule.tsx` L29-30 |
| **触发** | 任何一次 `saveChapters` 失败 |
| **后果** | 整个 key 损坏，150 章全部丢失 |

**当前代码：**
```typescript
function loadChapters(pid: string): PlotChapter[] { return getJSONSync(`plot-chapters-${pid}`, []); }
function saveChapters(pid: string, chs: PlotChapter[]) { setJSONSync(`plot-chapters-${pid}`, chs); }
```

**修复方案：**
```typescript
// 每章独立存储
const CHAPTER_PREFIX = (pid: string) => `chapter-${pid}-`;
function saveChapter(pid: string, ch: PlotChapter) {
    setJSONSync(`${CHAPTER_PREFIX(pid)}${ch.id}`, ch);
}
function loadChapter(pid: string, chId: string): PlotChapter | null {
    return getJSONSync(`${CHAPTER_PREFIX(pid)}${chId}`, null);
}
// 索引单独维护
function saveChapterIndex(pid: string, ids: string[]) {
    setJSONSync(`chapter-index-${pid}`, ids);
}
```

---

### SYS-3 · 编辑器内容只在内存 — 无草稿恢复

| 项目 | 内容 |
|------|------|
| **文件** | `src/modules/writing/WritingModule.tsx` L200 |
| **触发** | 切换章节、刷新浏览器、崩溃 |
| **后果** | 当前正在编辑的章节内容全部丢失 |

**当前代码：**
```typescript
const [editingContent, setEditingContent] = useState(""); // 纯内存
```

**修复方案：**
```typescript
// 1. 新增 draft 持久化
const DRAFT_KEY = (pid: string, chId: string) => `draft-${pid}-${chId}`;

// 2. editingContent 变化时防抖写入 draft
useEffect(() => {
    if (!editingContent || !selectedChapterId || !pid) return;
    const timer = setTimeout(() => {
        setJSONSync(DRAFT_KEY(pid, selectedChapterId), {
            content: editingContent,
            savedAt: new Date().toISOString(),
        });
    }, 2000); // 2秒防抖
    return () => clearTimeout(timer);
}, [editingContent]);

// 3. 加载章节时检查是否有未恢复的 draft
useEffect(() => {
    if (selectedChapterId && pid) {
        const draft = getJSONSync(DRAFT_KEY(pid, selectedChapterId), null);
        if (draft && draft.content !== savedContentRef.current) {
            // 提示用户是否恢复草稿
            setPendingDraft(draft);
        }
    }
}, [selectedChapterId]);
```

---

### SYS-4 · 保存无原子性

| 项目 | 内容 |
|------|------|
| **文件** | `src/modules/writing/WritingModule.tsx` L590-593 |
| **触发** | `saveChapters` 抛异常 |
| **后果** | React state 已更新但存储没更新 → 内存与存储不一致 |

**当前代码：**
```typescript
setChapters(prev => {
    const upd = prev.map(...);
    saveChapters(pid, upd);  // ← 副作用在 setState 回调里
    return upd;
});
```

**修复：** 先写存储，成功后更新 state：
```typescript
const saveContent = useCallback(() => {
    if (!pid || !selectedChapterId || !selectedChapter) return;
    pushUndo(editingContent);
    const nextChapters = chapters.map(c =>
        c.id === selectedChapterId ? { ...c, content: editingContent } : c
    );
    try {
        saveChapters(pid, nextChapters);  // 先写存储
        setChapters(nextChapters);         // 成功后更新 state
        savedContentRef.current = editingContent;
        setIsDirty(false);
    } catch (e) {
        useAppStore.getState().setAutosaveStatus("⚠ 保存失败，请重试");
    }
}, [pid, selectedChapterId, selectedChapter, editingContent, chapters]);
```

---

### SYS-5 · 无备份机制

| 项目 | 内容 |
|------|------|
| **文件** | 全局—无任何备份逻辑 |
| **触发** | 任何数据损坏 |
| **后果** | 无法恢复 |

**修复方案：**
```typescript
// src/lib/backup.ts — 新增
const BACKUP_PREFIX = 'novel-backup-';
const MAX_BACKUPS = 5;

export function createBackup(projectId: string): void {
    const keys = getAllProjectKeys(projectId); // 收集所有相关 key
    const snapshot: Record<string, string> = {};
    for (const key of keys) {
        snapshot[key] = localStorage.getItem(key) || '';
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupKey = `${BACKUP_PREFIX}${projectId}-${timestamp}`;
    try { localStorage.setItem(backupKey, JSON.stringify(snapshot)); } catch { /* silent */ }
    // 清理旧备份
    cleanOldBackups(projectId);
}
```

---

## 🟠 高危级 (High) — 11 个

### HI-1 · `handlePolish` / `handleHumanize` 未更新脏状态

| 文件 | `src/modules/writing/WritingModule.tsx` L706–786 |
|------|------|
| **修复** | 在精修/去味成功后添加：`savedContentRef.current = safeContent; setIsDirty(false);` |

```typescript
// 在 handlePolish 和 handleHumanize 的成功分支末尾各加两行
savedContentRef.current = safeContent;
setIsDirty(false);
```

---

### HI-2 · `loadContextPanelData` 竞态条件

| 文件 | `src/modules/writing/WritingModule.tsx` L507–555 |
|------|------|
| **修复** | 在函数开头设置一个递增的 generation counter，只在 `gen === currentGen` 时更新状态 |

```typescript
let loadGen = 0;
async function loadContextPanelData(projectId: string, chapterNumber: number, chapterId: string) {
    const gen = ++loadGen;
    try {
        // ... 所有异步操作 ...
        if (gen !== loadGen) return; // 过期请求，丢弃
        // 更新状态的代码
    } catch { /* ignore */ }
}
```

---

### HI-3 · `handlePolish` / `handleHumanize` 双击竞态

| 文件 | `src/modules/writing/WritingModule.tsx` L710, L750 |
|------|------|
| **修复** | 用 ref 做原子守卫（与 `aiWritingRef` 一致） |

```typescript
const polishingRef = useRef(false);
const humanizingRef = useRef(false);

// handlePolish 开头
if (polishingRef.current) return;
polishingRef.current = true;
setPolishing(true);
// finally 中
polishingRef.current = false;
setPolishing(false);

// handleHumanize 同理
```

---

### HI-4 · `deleteChapter` 使用闭包陈旧 `chapters`

| 文件 | `src/modules/writing/WritingModule.tsx` L625–633 |
|------|------|
| **修复** | 使用函数式 setState |

```typescript
// ❌ 当前
const deleteChapter = useCallback((chId: string) => {
    // ... 使用闭包中的 chapters ...
}, [pid, chapters]); // chapters 是闭包快照

// ✅ 修复
setChapters(prev => {
    const all = prev.filter(c => c.id !== chId);
    saveChapters(pid, all);
    return all;
});
```

---

### HI-5 · `handleRegenerate` 消息顺序假设

| 文件 | `src/layouts/AiChatPanel.tsx` L1105–1124 |
|------|------|
| **修复** | 往前找到最近一条 user 消息而非假设 `realIdx - 1` |

```typescript
// ❌ 当前假设最后一条 assistant 前就是 user
// ✅ 修复：扫描找到最近一条 user 消息
let userIdx = -1;
for (let i = realIdx - 1; i >= 0; i--) {
    if (chatMessages[i].role === 'user') { userIdx = i; break; }
}
```

---

### HI-6 · SQLite fire-and-forget 静默吞错

| 文件 | `src/lib/storage.ts` L122, L131 |
|------|------|
| **修复** | 用 `console.warn` 记录失败 + 重试队列 |

```typescript
// ❌ 当前
api.setSetting(key, value).catch(() => { });

// ✅ 修复
api.setSetting(key, value).catch((e) => {
    console.warn(`[storage] SQLite 写入失败: ${key}`, e);
    pendingWrites.push({ key, value, retries: 0 });
});
```

---

### FUNC-7 · `runQualityCheck` 从未被调用 — 死功能

| 文件 | `src/lib/quality-checker.ts` L30 + `src/modules/writing/WritingModule.tsx` L1348–1407 |
|------|------|
| **修复** | 在定稿流程中接入质量检查 |

在 `WritingModule.tsx` 的定稿按钮 onClick 中，`updateMemory` 之后 `createSnapshot` 之前插入：

```typescript
// 质量检查（铁则 + 角色一致性 + 伏笔 + 情节逻辑）
try {
    useAppStore.getState().setAutosaveStatus("正在质量检查...");
    const qcResult = await runQualityCheck({
        projectId: pid,
        chapterId: selectedChapterId,
        chapterNumber: selectedChapter.number,
        chapterContent: editingContent,
    });
    if (!qcResult.passed) {
        const errors = qcResult.checks.filter(c => c.severity === 'error');
        useAppStore.getState().addChatMessage({
            id: uuid(),
            role: "system",
            content: `⚠️ 质量检查发现 ${errors.length} 个问题：\n${errors.map(e => `· ${e.message}`).join('\n')}`,
            created_at: new Date().toISOString(),
        });
    }
} catch (e) {
    console.error("质量检查失败:", e);
}
```

---

### CR-1 · `save()` 原地污染 API Key

| 文件 | `src/lib/mock-backend.ts` L167–183 |
|------|------|

**修复：** `save()` 内部先深拷贝再混淆：
```typescript
function save(s: MockStore) {
    _mockStoreCache = null;
    const copy = JSON.parse(JSON.stringify(s)); // 深拷贝
    // 对 copy 做混淆...
    if (copy.apiConfig.api_key) copy.apiConfig.api_key = obfuscate(copy.apiConfig.api_key);
    // ...
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
}
```

---

### CR-2 · 导入覆盖模式下旧 beatCards/chapterContents 未清理

| 文件 | `src/lib/mock-backend.ts` L1011–1021 |
|------|------|

**修复：** 覆盖模式先清空再导入：
```typescript
if (importMode === "overwrite") {
    // 清理旧 beatCards
    const newChapterIds = new Set((chapters || []).map((c: any) => c.id));
    s.beatCards = (s.beatCards || []).filter((b: any) => !newChapterIds.has(b.chapter_id));
    s.chapterContents = (s.chapterContents || []).filter((cc: any) => !newChapterIds.has(cc.chapter_id));
    // 然后 push
}
```

---

### CR-3 · PlotDirectionPanel 无 `.catch()`

| 文件 | `src/modules/outline/PlotDirectionPanel.tsx` L184–185 |
|------|------|

**修复：**
```typescript
// ❌ 当前
api.listCharacters(projectId).then(chars => { ... });
api.listWorldTerms(projectId).then(terms => { ... });

// ✅ 修复
api.listCharacters(projectId).then(chars => { ... }).catch(() => {});
api.listWorldTerms(projectId).then(terms => { ... }).catch(() => {});
```

---

### CR-4 · 角色识别 JSON 解析无 try-catch

| 文件 | `src/layouts/AiChatPanel.tsx` L232 + `src/modules/writing/WritingModule.tsx` L135 |
|------|------|

**修复：**
```typescript
// ❌ 当前
const arr = JSON.parse(m[1]);

// ✅ 修复
let arr: any[];
try { arr = JSON.parse(m[1]); } catch { return; }
if (!Array.isArray(arr) || arr.length === 0) return;
```

---

## 🟡 中危级 (Medium) — 13 个

### ME-1 · 多处 `JSON.parse(localStorage.getItem(...))` 无 try-catch

| 文件 | `src/layouts/AiChatPanel.tsx` L670, L859, L887, L925–926 |
|------|------|
| **修复** | 全部替换为 `getJSONSync(key, defaultValue)` |

---

### ME-2 · 待确认角色列表用数组索引作为 React key

| 文件 | `src/layouts/AiChatPanel.tsx` L2120 |
|------|------|
| **修复** | 使用 `c.name` 或 `c.id` 作为 key |

---

### ME-3 · `handleConfirmEdit` 读取陈旧 input 值

| 文件 | `src/layouts/AiChatPanel.tsx` L1054–1070 |
|------|------|
| **修复** | 用 ref 保存最新 input 值：`inputRef.current` |

---

### ME-4 · `pushUndo` 使用闭包中过期的 `editingContent`

| 文件 | `src/modules/writing/WritingModule.tsx` L898–901 |
|------|------|
| **修复** | 读取 `editingContentRef.current`（已存在的 ref）而非闭包值 |

---

### ME-5 · `parseEdgeActions` 正则过于贪婪

| 文件 | `src/layouts/AiChatPanel.tsx` L204–218 |
|------|------|
| **修复** | 限制匹配范围，只匹配 `---EDGES---` 标记内的内容 |

---

### ME-6 · `handleCharacterInsert` 重复检查用旧快照

| 文件 | `src/layouts/AiChatPanel.tsx` L766–800 |
|------|------|
| **修复** | 每次创建新边后更新 `existingEdges` 集合 |

---

### ME-7 · 流式完成时状态可能更新到已卸载组件

| 文件 | `src/layouts/AiChatPanel.tsx` L1866–1868 |
|------|------|
| **修复** | 在 `useEffect` cleanup 中 abort `abortControllerRef.current` |

---

### ME-8 · 模型选择器 key 可能冲突

| 文件 | `src/layouts/AppShell.tsx` L438 |
|------|------|
| **修复** | 使用 `` `${m.provider}::${m.value}` `` 作为 key |

---

### ME-9 · P4 层永远不会被自动裁剪

| 文件 | `src/lib/context-engine.ts` L902–903 |
|------|------|
| **问题** | `LAYER_CULL_ORDER` 中没有 `"p4"`，前一章正文过长时不会被裁 |
| **修复** | 将 `"p4"` 加入裁剪数组：`["p4", "p2", "p3", "p0", "p1"]` |

---

### ME-10 · localStorage 访问模式不一致

| 文件 | `AiChatPanel.tsx`、`WritingModule.tsx` 等多处 |
|------|------|
| **修复** | 全文搜索 `JSON.parse(localStorage.getItem(` 替换为 `getJSONSync` |

---

### ME-11 · `module` 类型不完整

| 文件 | `src/lib/context-engine.ts` L44 |
|------|------|
| **问题** | `ChatContextInput.module` 类型缺少 `"overview" | "outline" | "manuscript"` 等 |
| **修复** | 扩展类型联合或映射 `ModuleId` 到模块上下文类型 |

---

### FUNC-3 · 章节分析只取前 6000 字符

| 文件 | `src/lib/memory-updater.ts` L109 |
|------|------|
| **问题** | `chapterContent.slice(0, 6000)` 章尾关键转折遗漏 |
| **修复** | 改为取前后各 3000 字符：`chapterContent.slice(0, 3000) + "\n...\n" + chapterContent.slice(-3000)` |

---

### FUNC-9 · 伏笔只埋不回收提醒

| 文件 | `src/lib/memory-updater.ts` L347–359 + `src/lib/context-engine.ts` |
|------|------|
| **问题** | 定稿时记录伏笔到 logStore，但 AI 写新章节时不会检索 pending 伏笔注入上下文 |
| **修复** | 在 `buildProjectContext` 中新增伏笔提醒逻辑： |

```typescript
// 在 assembleP1 或 buildProjectContext 中添加
function assembleForeshadowReminders(projectId: string, currentChapterNumber: number): string {
    const logStore = getLogStoreV2(projectId);
    const pendingForeshadows = (logStore.foreshadows || [])
        .filter(f => f.status === "pending" && f.expected_resolve_chapter <= currentChapterNumber + 3);
    if (pendingForeshadows.length === 0) return "";
    const parts = ["\n===== 🔔 待回收伏笔提醒 ====="];
    for (const f of pendingForeshadows) {
        parts.push(`· 第${f.planted_chapter}章埋下，建议在第${f.expected_resolve_chapter}章回收：${f.description}`);
    }
    return parts.join("\n");
}
```

---

## 🟢 低危级 (Low) — 6 个

### LO-1 · 版本号 fallback 硬编码过期

| 文件 | `src/lib/version-check.ts` L33, `vite.config.ts` L8 |
|------|------|
| **修复** | 将 `"0.3.2"` 改为 `"0.3.3"` |

---

### LO-2 · `performCompression()` 空函数死代码

| 文件 | `src/lib/memory-engine.ts` L114–116 |
|------|------|
| **修复** | 标注 `@deprecated` 或删除 |

---

### LO-3 · `getBaiduAccessToken()` 死代码

| 文件 | `src/lib/mock-backend.ts` L211–224 |
|------|------|
| **修复** | 删除，或让 `handleBaiduStt` 复用 |

---

### LO-4 · Baidu STT 浏览器模式 URL 为空

| 文件 | `src/lib/mock-backend.ts` L229–231 |
|------|------|
| **修复** | 改为直接使用完整 URL，不依赖 `isTauri` 判断 |

---

### LO-5 · `crypto.randomUUID` 检测不检查 `crypto` 存在性

| 文件 | `src/lib/uuid.ts` L9 |
|------|------|
| **修复** | `if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')` |

---

### LO-6 · `setTimeout` persistChat 可能在组件卸载后执行

| 文件 | `src/stores/app-store.ts` L318–327 |
|------|------|
| **修复** | 使用 `requestIdleCallback` 或在 store 中维护 timer ID 供 cleanup |

---

### FUNC-4 · 非活跃角色关系被过滤

| 文件 | `src/lib/context-engine.ts` L834 |
|------|------|
| **问题** | 关系边只在双方都在活跃集合时才传输，配角出场时关系缺失 |
| **修复** | 放宽过滤条件 — 只要任一端在活跃集合就发送关系边 |

```typescript
// ❌ 当前：双方都活跃
.filter(e => activeIds.has(e.source_id) && activeIds.has(e.target_id))

// ✅ 修复：任一端活跃即发送（配角出场时有关系可查）
.filter(e => activeIds.has(e.source_id) || activeIds.has(e.target_id))
```

---

### FUNC-6 · 非活跃角色口吻丢失

| 文件 | `src/lib/context-engine.ts` L849–861 |
|------|------|
| **问题** | 全量名册只传 summary，不含 voice_style。配角突然出场时 AI 不知其说话风格 |
| **修复** | 在全量名册中附加 voice_style： |

```typescript
// 在第三层角色名册中添加 voice_style
if (c.voice_style) {
    parts.push(`· ${c.name}（${c.faction || "无"}）${lastInfo} | ${summary} | 口吻：${c.voice_style.slice(0, 30)}`);
} else {
    parts.push(`· ${c.name}（${c.faction || "无"}）${lastInfo} | ${summary}`);
}
```

---

## 📊 分级汇总

| 等级 | 数量 | 风险 |
|------|------|------|
| 🔴 致命 | 6 | 数据永久丢失、存储崩溃 |
| 🟠 高危 | 11 | 功能异常、数据不一致、死功能 |
| 🟡 中危 | 13 | 不稳定、边界崩溃、上下文缺陷 |
| 🟢 低危 | 6 | 展示错误、死代码、极端环境 |
| **总计** | **36** | |

## 🔧 建议修复优先级

| 优先级 | Bug ID | 原因 |
|--------|--------|------|
| **P0 — 立即** | SYS-1, SYS-3 | 假自动保存是最恶劣的用户欺骗，草稿恢复是最基本的安全网 |
| **P0 — 立即** | SYS-2, CR-0 | 数据全丢的架构缺陷 |
| **P1 — 本周** | SYS-4, SYS-5, HI-3 | 原子性 + 备份 + 双击竞态 |
| **P1 — 本周** | CR-1, HI-1, HI-2 | 数据损坏 + UX 缺陷 |
| **P1 — 本周** | FUNC-7 | 死功能要么删掉要么接上线 |
| **P2 — 下周** | HI-4, HI-5, HI-6 | 边缘场景功能异常 |
| **P2 — 下周** | ME-1~11, FUNC-3, FUNC-9 | 代码质量和稳定性 |
| **P3 — 后续** | LO-1~6, FUNC-4, FUNC-6 | 展示、死代码、边缘优化 |
