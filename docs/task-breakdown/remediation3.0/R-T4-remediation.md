# R-T4 — classifyKey 补 characters 独立分片

> 对应验收：V-T4（`verification3.0/T4-verification.md`）  
> 优先级：**P1**（不阻塞交付，但快照恢复时角色数据混在 misc 中）

---

## 问题描述

T4.1 要求分片存储 3 类：`chapters` / `characters` / `misc`。当前 `classifyKey` 仅分 2 类（`chapters` / `misc`），角色数据归入 misc。

---

## 当前实现

```ts
function classifyKey(key: string, projectId: string): string {
    if (key.startsWith(`chapter-${projectId}-`) || key.startsWith("chapter-index-") ||
        key.startsWith("plot-chapters-") || key.startsWith("plot-segments-") || key.startsWith("plot-edges-")) {
        return "chapters";
    }
    return "misc";  // ← 角色/worldTerms/characters/relationships 全进 misc
}
```

---

## 具体改动

```ts
const CHAR_KEY_PREFIXES = [
    "characters-", "character-", "world-terms-", "relationship-",
    "char-groups-", "ai-pending-chars-", "ai-pending-world-terms-",
];

function classifyKey(key: string, projectId: string): string {
    if (key.startsWith(`chapter-${projectId}-`) || key.startsWith("chapter-index-") ||
        key.startsWith("plot-chapters-") || key.startsWith("plot-segments-") || key.startsWith("plot-edges-")) {
        return "chapters";
    }
    if (CHAR_KEY_PREFIXES.some(p => key.startsWith(p))) {
        return "characters";
    }
    return "misc";
}
```

同时调整 `shardData` 初始化：

```diff
- const shardData: Record<string, Record<string, string>> = { chapters: {}, misc: {} };
+ const shardData: Record<string, Record<string, string>> = { chapters: {}, characters: {}, misc: {} };
```

---

## 验证标准

- [ ] `npm run build` 通过
- [ ] `classifyKey` 三路分支存在（chapters / characters / misc）
- [ ] 创建快照 → 查看存储：角色数据在独立 `snapshot-{pid}-{snapId}-characters` key 中

---

## 预估影响

| 文件 | 改动量 | 风险评估 |
|------|:--:|------|
| `memory-updater.ts` | ~10 行 | 低（纯增加分支，不影响现有逻辑） |
