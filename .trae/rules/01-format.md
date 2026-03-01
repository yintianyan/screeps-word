# 01 交互与写作规范

- 规则表达固定四元组：目标 / 观测 / 动作 / 反馈
- 每条规则补充 1–3 条 success criterion，用“⇒”前缀
- 隐含依赖必须显式为 contextVariables，统一 camelCase
- 长段落最小粒度拆分，每段 ≤80 字

## Definition of Done

- 输出可直接驱动实现与迭代
- 不破坏既有术语与接口；变更需给迁移说明
- 符合 Screeps 游戏规则与 API 规范
- 代码/方案生成后做验收
- 符合性能、调度、指标与安全规则