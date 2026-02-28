---
name: "screeps-guide-coder"
description: "把 screep world.md 指南转为可运行的 TypeScript Screeps 代码。用户说“按指南写代码/生成模块/落地实现”时调用。"
---

# Screeps Guide Coder

## 输入（必须读取）

- 指南：[screep world.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/doc/screep%20world.md)
- 规则入口：[project_rules.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/project-rules.md)
- 规则细则：
  - [01-format.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/01-format.md)
  - [02-architecture.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/02-architecture.md)
  - [03-operations.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/03-operations.md)

## 目标

- 将指南中的架构与规则落地成可运行代码（Kernel/Process/Task）。
- 以“先可运行、再扩展”的顺序实现：核心循环 → 最小进程集 → 调度与任务 → 自动布局。

## 执行流程（严格顺序）

1. 读取并提取 contextVariables 与术语表（camelCase，禁止新占位符）。
2. 生成模块清单：Kernel、Process、Task、Planner、Scheduler、Metrics。
3. 先实现可运行骨架：main → kernel.run → processRegistry → 1 个房间进程。
4. 再实现业务：能量链路、孵化、基础运输、升级、建造、防御。
5. 最后实现优化：cpuBucket 熔断、reservation、slots/assigned、异常自愈。

## 强制约束

- TypeScript：strict；禁止 any。
- 注释：禁止添加任何注释（除非用户明确要求）。
- Memory：仅存 id/数值/短字符串/必要序列化结构；禁止存对象引用。
- 依赖：禁止循环依赖；分层必须稳定（Kernel/Process/Task）。
- 调度：必须有 priority、reservation、slots/assigned、PathBlocked/TargetInvalid/Timeout。
- 指标：必须稳定写入 Memory.stats（cpu.* 与 room.*）。

## 输出要求

- 若生成文档：所有规则用“目标-观测-动作-反馈”四元组，并给 1–3 条“⇒”。
- 若生成代码：保持模块边界清晰；新增文件前先对齐现有命名与目录结构。

