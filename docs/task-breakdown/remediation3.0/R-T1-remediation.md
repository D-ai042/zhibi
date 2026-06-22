# R-T1 — 导出函数数偏差说明

> 对应验收：V-T1（`verification3.0/T1-verification.md`）  
> 优先级：**P2**（低优先级，记录偏差理由即可）

---

## 问题描述

T1 标准 A4 要求 `export function` ≤ 5 个（`loadJSON`/`saveJSON` + `getSync`/`setSync` + 2 别名 = 5），实测 **6 个**，多出 `setSync`。

| 导出函数 | 作用 | 能否删除 |
|---------|------|:--:|
| `loadJSON` | 核心 API | ❌ |
| `saveJSON` | 核心 API | ❌ |
| `getSync` | 底层 API | ❌ backup/mock/migrate/memory 4 文件依赖 |
| `setSync` | 底层 API | ❌ saveJSON 内部调用 + chapter-store 用 |
| `getJSONSync` | 废弃别名 | 保留兼容 |
| `setJSONSync` | 废弃别名 | 保留兼容 |

---

## 根因

`getSync` 被 `backup.ts` 导入用于读原始字符串值（非 JSON 解析），`loadJSON` 返回 `JSON.parse` 后的对象无法替代。

---

## 修复方案：无需改代码，接受偏差

在 `storage.ts` 文件头部注释中明确说明：

```ts
/**
 * 导出函数清单（共 6 个，标准 ≤5 偏差 1）：
 *   - 核心 API：loadJSON / saveJSON
 *   - 底层 API：getSync（backup/mock/migrate/memory 4 文件依赖）/ setSync
 *   - 废弃别名：getJSONSync / setJSONSync（@deprecated）
 */
```

---

## 验证标准

- [ ] 文件头注释更新，明确偏差理由
- [ ] `npm run build` 通过
