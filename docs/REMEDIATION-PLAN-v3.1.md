# 功能恢复方案 v3.1 — 骨架填肉

> 目标：在现有 17 文件骨架基础上，从 418c623 快照迁移完整业务逻辑
> 策略：按模块顺序，逐一从快照源码移植 → 适配骨架接口 → build验证 → 冒烟测试

---

## 总体策略

```
快照 418c623 原有 4 个 God File (5398 行)
  → 当前骨架 17 个文件 (1955 行, 丢失 3443 行 = 64%)
  → 目标 17 个文件 (~4500 行, 功能恢复 + 代码更清晰)
```

**核心原则**：
1. 不破坏现有骨架（文件结构保留）
2. 从 418c623 快照直接读取原代码，按职责切分
3. 每完成一个子文件 → `npm run build` → 冒烟测试 → 再移下一个
4. 保留当前已有的子文件注释标记（"T6/T7/T9 瘦身壳"）

---

## 阶段一：SettingsModal 功能恢复（�� 低风险）

> 当前骨架：SettingsModal 68行壳 + 4个Tab子文件
> 原代码：1260行，含 API配置/STT/快照/数据迁移/关于 + 版本检查

### S1.1 — ApiConfigTab.tsx 补全（当前 156行 → 目标 ~300行）

**要移植的功能**（从 418c623 快照第 120-420 行区域）：
- [ ] 保存 API 配置逻辑（`handleSave`）
- [ ] 测试连接逻辑（`handleTest`）
- [ ] 自定义厂商添加/删除
- [ ] 厂商模型列表编辑
- [ ] setProviderModels 调用
- [ ] 保存成功/失败状态提示（`saveMsg`）

**移植方式**：读取 `git show 418c623:src/components/settings/SettingsModal.tsx` 中 API 相关函数，移入 `ApiConfigTab` 组件内

### S1.2 — SttConfigTab.tsx 补全（当前 108行 → 目标 ~180行）

**要移植的功能**：
- [ ] STT 预设厂商配置（OpenAI/SiliconFlow/Baidu）
- [ ] 自定义 STT 厂商
- [ ] 激活厂商切换
- [ ] 启用/禁用开关
- [ ] 保存 STT 配置

### S1.3 — SnapshotManagerTab.tsx 补全（当前 99行 → 目标 ~250行）

**要移植的功能**：
- [ ] 快照列表加载（`listSnapshots`）
- [ ] 创建快照按钮 + 确认
- [ ] 恢复快照按钮 + 确认弹窗
- [ ] 删除快照
- [ ] 空状态提示

### S1.4 — DataMigrateTab.tsx 补全（当前 117行 → 目标 ~350行）

**要移植的功能**：
- [ ] 项目导出（选择项目 → 导出 JSON → 下载）
- [ ] 项目导入（选择文件 → 解析 → 确认导入模式）
- [ ] 导入模式选择（覆盖/新建/合并）
- [ ] localStorage 数据迁移到 SQLite（EXE 模式）
- [ ] 进度和结果反馈

### S1.5 — SettingsModal.tsx 壳微调（当前 68行 → 目标 ~100行）

- [ ] 添加"关于"Tab（版本信息 + 检查更新）
- [ ] 添加 Escape 键关闭
- [ ] 传递 `onSave` / `onError` 回调给子 Tab

---

## 阶段二：WritingModule 功能恢复（�� 中风险）

> 当前骨架：WritingModule 129行壳 + 6个子组件
> 原代码：1707行

### S2.1 — ChapterTree.tsx 补全（当前 177行 → 目标 ~250行）

**要移植的功能**：
- [ ] 多选模式（复选框、全选、发送到AI）
- [ ] 章节拖拽排序
- [ ] 右键菜单（重命名/删除/定稿）
- [ ] 卷折叠动画

### S2.2 — ChapterEditor.tsx 补全（当前 125行 → 目标 ~300行）

**要移植的功能**：
- [ ] contentEditable 编辑器初始化/同步
- [ ] 工具栏（加粗/斜体/标题/引用/列表/链接）
- [ ] Ctrl+S 保存快捷键
- [ ] 保存按钮 + 脏状态指示
- [ ] AI写作进度指示器
- [ ] 字体大小调节
- [ ] 修订感知横幅（staleInfo）
- [ ] Rebase 进度条

### S2.3 — ContextPanel.tsx 补全（当前 147行 → 目标 ~200行）

当前已有基本的面板渲染，需要确认完整性：
- [ ] 章节摘要列表
- [ ] 节拍卡片
- [ ] 角色列表
- [ ] 上一章内容预览
- [ ] 世界观规则/风格红线

### S2.4 — useAiWriting.ts 补全（当前 232行 → 目标 ~350行）

**要移植的功能**：
- [ ] AI 写本章完整流程（包含上下文拼接）
- [ ] 润色流程
- [ ] 去 AI 味流程
- [ ] Rebase 逻辑（`handleRebase`）
- [ ] `detectStaleAhead` 脏链检测
- [ ] `aiExtractNewCharacters` AI 识别新角色（独立到 WritingModule 调用链）

### S2.5 — WritingContext.tsx 强化（当前 19行 → 目标 ~80行）

- [ ] 承载共享状态（chapters/selectedChapter/saveContent/autosaveStatus/isDirty/pushUndo）

### S2.6 — WritingModule.tsx 壳补全（当前 129行 → 目标 ~120行，保持瘦身）

- [ ] 重新引入 `aiExtractNewCharacters` 调用链（保存章节后触发）
- [ ] 重新引入 `detectStaleAhead` 脏链检测

---

## 阶段三：AiChatPanel 功能恢复（�� 高风险）

> 当前骨架：AiChatPanel 222行壳 + 5个子模块
> 原代码：2431行，是最复杂的模块

### S3.1 — useAiChatStream.ts 补全（当前 111行 → 目标 ~300行）

当前已有基本流式对话，需要补：
- [ ] 上下文模块切换参数（worldview/writing/storybible/manuscript/material）
- [ ] 更完整的角色解析 + 关系解析 + 词条解析
- [ ] 快照解析（`---SNAPSHOT---` 块）
- [ ] 剧情段落解析（`---PLOT---` 块）
- [ ] 节拍卡片解析
- [ ] 章节创建指令解析
- [ ] 自定义模块创建指令解析
- [ ] 错误重试逻辑

### S3.2 — ChatMessageBubble.tsx 补全（当前 69行 → 目标 ~150行）

- [ ] Markdown 渲染增强（代码高亮、表格、Mermaid 图表）
- [ ] 消息操作按钮（复制/重试/编辑/删除）
- [ ] 流式内容实时渲染光标

### S3.3 — useSttVoice.ts 补全（当前 27行 → 目标 ~200行）

- [ ] 麦克风权限请求
- [ ] 音频录制（MediaRecorder API）
- [ ] 音频转文字（调用 api.sttTranscribe）
- [ ] 录音状态管理（idle/recording/transcribing）
- [ ] 错误处理

### S3.4 — CharacterApplyButton.tsx 补全（当前 30行 → 目标 ~180行）

- [ ] "应用到星图"按钮
- [ ] 确认弹窗（显示待创建角色/关系详情）
- [ ] 去重检查（已存在角色提示）
- [ ] 批量创建角色 + 关系边
- [ ] 成功/失败反馈

### S3.5 — usePendingCharacters.ts 补全（当前 48行 → 目标 ~250行）

- [ ] pending 状态全生命周期管理
- [ ] 从 localStorage 加载待确认数据
- [ ] 去重逻辑（避免重复创建）
- [ ] 应用后清理
- [ ] bump 机制（跨组件通信）

### S3.6 — AiChatPanel.tsx 壳微调（当前 222行 → 目标 ~300行）

- [ ] 上下文模块切换 UI
- [ ] 记忆面板（短期/长期记忆切换）
- [ ] pending 确认条（角色/关系/词条/剧情/章节）
- [ ] 自定义模块创建确认

---

## 执行顺序

```
S1.1 → S1.5（SettingsModal，低风险先验证流程）
  ↓ 冒烟测试：设置弹窗各Tab功能正常
S2.1 → S2.6（WritingModule）
  ↓ 冒烟测试：章节CRUD + AI写作 + 定稿正常
S3.1 → S3.6（AiChatPanel，最后做最复杂）
  ↓ 冒烟测试：AI流式对话 + 角色应用 + STT正常
```

## 验证清单

每个阶段完成后执行：

| # | 验证项 | 命令/操作 |
|---|--------|----------|
| 1 | 编译通过 | `npm run build` |
| 2 | 测试全绿 | `npm run test` |
| 3 | 类型检查 | `npx tsc --noEmit` |
| 4 | 冒烟测试 | 打开浏览器实际使用对应功能 |

## 回退方案

如果某个阶段出了问题：

```bash
# 只回退受损的3个文件
git checkout 418c623 -- src/components/settings/SettingsModal.tsx
git checkout 418c623 -- src/modules/writing/WritingModule.tsx  
git checkout 418c623 -- src/layouts/AiChatPanel.tsx
```
