# R-T8 — localStorage 遍历残留分类说明

> 对应验收：V-T8（`verification3.0/T8-verification.md`）  
> 优先级：**P2**（低优先级，14 处全为遍历型操作，技术上无法用 loadJSON 替代）

---

## 问题描述

A4 要求 `localStorage.` 裸调为 0（除 storage.ts）。实测 **14 处残留**，全部为 `localStorage.length` + `localStorage.key(i)` 遍历操作。

---

## 残留分析

| 文件 | 行号 | 用途 | 能否消除 |
|------|------|------|:--|
| `SettingsModal.tsx` | 716-717 | 导入导出时枚举所有 key | ❌ 无 API 替代 |
| `DataMigrateTab.tsx` | 27-28 | 数据迁移时枚举所有 key | ❌ 无 API 替代 |
| `WelcomeScreen.tsx` | 65-66 | 项目清理枚举 | ❌ 无 API 替代 |
| `mock-backend.ts` | 511-512, 1097 | dev mock 遍历 | ❌ 无 API 替代 |
| `migrate-data.ts` | 64-65 | 迁移遍历 | ❌ 无 API 替代 |
| `app-store.ts` | 274-275 | 孤儿数据清理 | ❌ 无 API 替代 |
| `chapter-store.ts` | 36 | `removeItem` 迁移清理 | ⚠️ T3 兼容 |

---

## 根因

`localStorage.length` + `localStorage.key(i)` 是浏览器唯一枚举所有 key 的方法，`loadJSON`/`saveJSON` 需要已知 key 名才能读写。

---

## 修复方案：加注释说明，不消除

### 1. 为每个遍历位置加注释

```ts
// T8 例外：遍历 localStorage 枚举 key（loadJSON 需已知 key 名，无法替代）
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // ...
}
```

### 2. 未来优化（可选）

- Tauri EXE 模式下可改为通过 `api.listAppSettings()` 遍历（性能更好）
- 当前标记为"P2 优化项"，不阻塞交付

---

## 验证标准

- [ ] 7 个文件均添加 T8 例外注释
- [ ] `npm run build` 通过
