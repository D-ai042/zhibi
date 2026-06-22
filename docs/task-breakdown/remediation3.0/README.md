# 修复方案 v3.0 索引

> 基准验收：`verification3.0/` 各任务验收报告  
> V-Tx — 验收 → R-Tx — 修复，一一对应  
> 修复顺序：严格按 T0 → T1 → … → T10

---

## 修复任务总览

| 修复 ID | 对应验收 | 目标问题 | 优先级 |
|---------|---------|---------|:--:|
| [R-T0](./R-T0-remediation.md) | V-T0 | tsc 类型错误 20+ 条（mock-backend/quality-checker/CharacterNode） | **P0** |
| [R-T1](./R-T1-remediation.md) | V-T1 | 导出函数数 6>5，getSync 保留合理性说明 | P2 |
| [R-T2](./R-T2-remediation.md) | V-T2 | 18 处 .ok() 无 log::warn | **P0** |
| [R-T3](./R-T3-remediation.md) | V-T3 | 7 处 plot-chapters- 残留 + Rust 侧直读 | **P0** |
| [R-T4](./R-T4-remediation.md) | V-T4 | classifyKey 缺 characters 独立分片 | P1 |
| [R-T5](./R-T5-remediation.md) | V-T5 | buildProjectContext 2 处直接调用 | P1 |
| [R-T6](./R-T6-remediation.md) | V-T6 | WritingModule 1457→≤300 行 | **P0** |
| [R-T7](./R-T7-remediation.md) | V-T7 | AiChatPanel 2306→≤600 行 | **P0** |
| [R-T8](./R-T8-remediation.md) | V-T8 | 14 处遍历残留分类 + 注释说明 | P2 |
| [R-T9](./R-T9-remediation.md) | V-T9 | SettingsModal 1140→≤200 行 | **P0** |
| [R-T10](./R-T10-remediation.md) | V-T10 | app-store 369→≤200 行 + re-export | **P0** |

---

## 依赖关系

```
R-T0(类型错误) ──── 阻塞全部后续（先修复才能 tsc --noEmit 通过）
    │
    ├─→ R-T1(导出函数) ────→ R-T3(残留清零) ──→ R-T5(context入口)
    │                                    │
    ├─→ R-T2(.ok()日志)                  ├─→ R-T6(Writing瘦身)
    │                                    ├─→ R-T7(AiChat瘦身)
    ├─→ R-T4(分片完善)                   └─→ R-T8(遍历残留)
    │
    └─→ R-T9(Settings瘦身) + R-T10(app-store瘦身)  [独立，无前依赖]
```

---

## 优先级定义

| 等级 | 含义 |
|:--:|------|
| **P0** | 阻塞交付，必须修复 |
| **P1** | 建议修复，不阻塞但有质量风险 |
| **P2** | 低优先级，记录偏差理由即可 |
