---
name: "screeps-rule-gate"
description: "对照 project_rules.md 审查 agent 生成的 Screeps 代码/方案并给最小修复清单。用户要验收“是否符合规范”时调用。"
---

# Screeps Rule Gate

## 输入（必须读取）

- [project_rules.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/project-rules.md)
- [01-format.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/01-format.md)
- [02-architecture.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/02-architecture.md)
- [03-operations.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/03-operations.md)

## 何时调用

- 代码/方案生成后做验收。
- 怀疑出现：any、Memory 膨胀、循环依赖、缺少熔断、缺少自愈、缺少指标。

## 检查清单（逐条给结论）

- 架构：是否 Kernel/Process/Task 分层清晰；是否存在循环依赖。
- TS：是否 strict；是否出现 any；Memory 类型是否稳定。
- 性能：是否 cpuBucket 熔断；是否避免每 tick 重扫描高成本逻辑。
- 调度：是否有 priority、reservation、slots/assigned。
- 异常：是否覆盖 PathBlocked/TargetInvalid/Timeout 的检测与恢复。
- 指标：是否稳定写入 Memory.stats（cpu.* 与 room.*）。

## 输出格式

- 结论：通过 / 不通过
- 最小修复清单：按优先级排序（P0/P1/P2）

