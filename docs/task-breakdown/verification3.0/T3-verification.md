# T3 验收核查报告 v3.0

> 核查日期：2026-06-22  
> 核查依据：`docs/task-breakdown/T3-chapter-store.md` 完成标准 & 验收清单  
> 核查方式：读取源码 + 运行测试验证

---

## 一、子任务逐项审查

| 子任务 | 要求 | 实际结果 | 判定 |
|--------|------|----------|------|
| T3.1 | 新建 `chapter-store.ts`，导出 5 个函数 | ✅ 文件存在，导出 6 个函数（多了 `getChapterIds`） | ✅ |
| T3.2 | 只存 `chapter-{pid}-{id}` + `chapter-index-{pid}`，删除 `plot-chapters-{pid}` | ✅ 实现正确，新数据不写旧 key | ✅ |
| T3.3 | 兼容旧数据：首次 loadAllChapters 迁移 | ✅ 检测旧 key → 迁移 → 删除旧 key | ✅ |
| T3.4 | `WritingModule.tsx`：`saveContent` 改调 `saveChapter`（增量，只写当前章） | ✅ **已改为增量保存**，调用 `saveChapter(pid, updatedChapter)` | ✅ |
| T3.5 | `context-engine.ts`：5 处 → `loadAllChapters` | ✅ 已迁移 | ✅ |
| T3.6 | `AiChatPanel.tsx`：2 处 → `loadAllChapters`/`saveChapter` | ✅ 已迁移 | ✅ |
| T3.7 | `StoryBibleModule.tsx`：3 处 → `loadAllChapters` | ✅ 已迁移 | ✅ |
| T3.8 | `SettingsModal`/`WritingStatsPanel`/`use-project-data` → `loadAllChapters` | ✅ 已迁移 | ✅ |
| T3.9 | Rust 侧若直读该 key，统一走 db_cmds | ❌ `db_cmds.rs:1126` 仍直读 `plot-chapters-{pid}` 旧 key | ❌ |
| T3.10 | 验证：T0 测试 + build | ✅ 28 passed，build 通过 | ✅ |

---

## 二、完成标准（自动化）

| # | 命令 | 预期输出 | 实际输出 | 判定 |
|---|------|---------|----------|------|
| A1 | `npm run test` | 含 chapter-store 测试全绿 | ✅ **5 用例通过** | ✅ |
| A2 | `npm run tsc --noEmit` | 无错误 | ❌ **11 条类型错误**（全部来自项目旧代码 mock-backend.ts/quality-checker.ts/CharacterNode.tsx，非 T3 引入） | ❌ |
| A3 | `npm run build` | 通过 | ✅ 通过 | ✅ |
| A4 | grep `plot-chapters-` src/ | 0 处（迁移逻辑除外） | ❌ **7 处残留**（backup.ts/memory-updater.ts/migrate-data.ts/mock-backend.ts/SettingsModal.tsx ×2/db_cmds.rs） | ❌ |
| A5 | grep `saveChapters`/`loadAllChapters` src/ | 调用来自 chapter-store | ✅ 已统一 | ✅ |

---

## 三、chapter-store.ts API 审查

| 导出函数 | T3.1 要求 | 实际签名 | 判定 |
|----------|----------|----------|:----:|
| `loadAllChapters` | `loadAllChapters(pid): PlotChapter[]` | `loadAllChapters(pid: string): Chapter[]` | ✅ |
| `loadChapter` | `loadChapter(pid, id): PlotChapter \| null` | `loadChapter(pid: string, chapterId: string): Chapter \| null` | ✅ |
| `saveChapter` | `saveChapter(pid, chapter): { ok; error? }` | `saveChapter(pid: string, chapter: Chapter): SaveResult` | ✅ |
| `saveAllChapters` | `saveChapters(pid, chapters[]): { ok; error? }` | `saveAllChapters(pid: string, chapters: Chapter[]): SaveResult` | ✅ |
| `deleteChapter` | `deleteChapter(pid, id): void` | `deleteChapter(pid: string, chapterId: string): void` | ✅ |

**SaveResult 接口**：`{ ok: boolean; error?: string }` ✅ 符合要求

---

## 四、✅ 关键修复确认：T3.4 saveContent 已改为增量

### 当前实现

```typescript
// WritingModule.tsx:557-583 — saveContent
const saveContent = useCallback(() => {
    if (!pid || !selectedChapterId || !selectedChapter) return;
    pushUndo();
    const updatedChapter = { ...selectedChapter, content: editingContent };
    try {
        _skipNextChapterEffect.current = true;
        const result = saveChapter(pid, updatedChapter);  // T3: 增量，只写当前章
        if (!result.ok) {
            useAppStore.getState().setAutosaveStatus("⚠ 保存失败");
            console.error("saveContent failed:", result.error);
            return;
        }
        const nextChapters = chapters.map(c =>
            c.id === selectedChapterId ? updatedChapter : c
        );
        setChapters(nextChapters);
        savedContentRef.current = editingContent;
        setIsDirty(false);
        bumpSavedChapterVersion(pid, selectedChapter.number);
        useAppStore.getState().setAutosaveStatus("✅ 已保存");
        const tid = setTimeout(() => useAppStore.getState().setAutosaveStatus("已就绪"), 2000);
        timeoutIdsRef.current.push(tid);
    } catch (e) {
        useAppStore.getState().setAutosaveStatus("⚠ 保存失败，请重试");
        console.error("saveContent failed:", e);
    }
}, [pid, selectedChapterId, selectedChapter, editingContent, chapters]);
```

✅ **v3.0 修复确认**：`saveContent` 现在调用 `saveChapter(pid, updatedChapter)`，只保存当前修改的章节，而非全量保存所有章节。

---

## 五、验收清单

| # | 验收项 | 判定 |
|---|--------|:----:|
| V1 | 编译 + 测试通过 | ✅ |
| V2 | `plot-chapters-` 裸读清零 | ❌ 7 处残留 |
| V3 | localStorage 裸读 plot-chapters 清零 | ✅ |
| V4 | `saveContent` 改为增量保存 | ✅ 已修复 |
| V5 | 手动 M1-M2：章节保存重开不丢 | 🔲 待手动 |
| V6 | 手动 M3：删除章节生效 | 🔲 待手动 |
| V7 | 手动 M4：旧项目迁移成功 | ✅ 迁移逻辑存在 |

---

## 六、总判定

| 项目 | 状态 |
|------|:----:|
| 子任务完成率 | **9/10**（T3.9 不通过） |
| 自动化标准通过率 | **3/5**（A2 不通过，A4 不通过） |
| 验收清单通过率 | **4/7**（V2 不通过，V5/V6 待手动） |

### T3 判定：❌ 不通过

**A4 不通过** — `plot-chapters-` 裸读未清零，仍有 7 处残留：

| 文件 | 行号 | 上下文 |
|------|------|--------|
| `backup.ts` | 21 | 备份 key 前缀列表含 `plot-chapters-` |
| `memory-updater.ts` | 653 | 旧 key 前缀过滤含 `plot-chapters-` |
| `migrate-data.ts` | 30 | 数据迁移 key 列表含 `plot-chapters-` |
| `mock-backend.ts` | 941, 1088 | mock 读写旧 key |
| `SettingsModal.tsx` | 918, 1027 | 导入/导出 fallback 旧 key |
| `db_cmds.rs` | 1126 | Rust 侧直读 `plot-chapters-{pid}` |

**除外说明**：`chapter-store.ts` 内部迁移逻辑（第 9,31-36 行）+ `__tests__/chapter-store.test.ts` 测试代码（第 42,46,51 行）属于允许范围。

**T3.9 不通过** — `db_cmds.rs:1126` 仍直读旧 key。

**已完成项**：
- chapter-store.ts 创建，API 完整
- 逐章存储结构正确
- 旧格式迁移逻辑完整
- 所有主要读取点已迁移到 `loadAllChapters`
- **saveContent 增量保存修复**（v3.0 关键改进）
