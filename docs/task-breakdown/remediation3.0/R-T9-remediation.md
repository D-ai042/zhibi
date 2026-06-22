# R-T9 — SettingsModal.tsx 瘦身

> 对应验收：V-T9（`verification3.0/T9-verification.md`）  
> 优先级：**P0**（God File 1140 行 → ≤200 行）

---

## 问题描述

T9.1 要求 SettingsModal.tsx ≤200 行。当前 **1140 行**，4 个 Tab 子文件已创建但主文件未移交逻辑。

---

## 剩余架构

主文件 1140 行中可移走的模块：

| 模块 | 约行数 | 目标位置（已存在） |
|------|:--:|------|
| API 配置（模型选择/Key/测试连接） | ~200 行 | `ApiConfigTab.tsx`（74→270 行） |
| STT 配置（百度凭据） | ~150 行 | `SttConfigTab.tsx`（39→190 行） |
| 快照管理（创建/删除/恢复） | ~250 行 | `SnapshotManagerTab.tsx`（91→340 行） |
| 数据导入导出迁移 | ~300 行 | `DataMigrateTab.tsx`（108→400 行） |
| 壳（标签导航 + 弹窗壳） | ≤100 行 | `SettingsModal.tsx` |
| **总计** | **~900 移出** | **主文件 ~100 行** |

---

## 具体改动策略

### 主文件最终形态

```tsx
// SettingsModal.tsx — 约 100 行
const TABS = [
    { id: "api", label: "API 配置", component: ApiConfigTab },
    { id: "stt", label: "语音配置", component: SttConfigTab },
    { id: "snapshots", label: "快照管理", component: SnapshotManagerTab },
    { id: "data", label: "数据迁移", component: DataMigrateTab },
];

export function SettingsModal({ open, onClose }: Props) {
    const [tab, setTab] = useState("api");
    if (!open) return null;

    return (
        <Modal onClose={onClose}>
            <TabBar tabs={TABS} active={tab} onChange={setTab} />
            <TabContent>
                {TABS.map(t => t.id === tab && <t.component key={t.id} />)}
            </TabContent>
        </Modal>
    );
}
```

### 通过 props 传递共享状态

```ts
interface TabProps {
    onSave?: () => void;
    onError?: (msg: string) => void;
}
```

---

## 验证标准

### 自动化

- [ ] `npm run build` 通过
- [ ] SettingsModal.tsx ≤ **200 行**
- [ ] 4 个子文件 ≥ 原功能行数

### 手动测试清单

> 验收方逐项操作勾选，一项不通过即判定 R-T9 未完成。

| # | 操作步骤 | 预期结果 | 对应验收 |
|---|---------|---------|:--:|
| M1 | 打开设置 → 依次切换 API配置/语音配置/快照管理/数据迁移 4 个标签 | 每个标签内容正确渲染，无报错 | V-T9 V4 |
| M2 | API配置：修改模型/Key → 保存 → 关闭设置 → 重新打开 | 配置值保留不变 | V-T9 V4 |
| M3 | 语音配置：修改 STT 凭据 → 保存 → 关闭 → 重新打开 | 凭据保留不变 | V-T9 V4 |
| M4 | 快照管理：创建新快照 → 列表中显示 → 点击恢复 → 确认 | 快照创建成功，恢复后数据正确 | V-T9 V4 |
| M5 | 快照管理：选中快照 → 删除 → 确认 | 快照从列表中移除 | V-T9 V4 |
| M6 | 数据迁移：导出项目 → 下载文件 → 用另一个项目导入 | 数据正确导入，章节/角色/设定完整 | V-T9 V3 |

---

## 预估影响

| 文件 | 改动量 | 风险评估 |
|------|:--:|------|
| `SettingsModal.tsx` | -940 行 | 中 |
| `ApiConfigTab.tsx` | +196 行 | 低 |
| `SttConfigTab.tsx` | +151 行 | 低 |
| `SnapshotManagerTab.tsx` | +249 行 | 中 |
| `DataMigrateTab.tsx` | +292 行 | 中 |
