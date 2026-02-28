# Screeps World 项目规则 (Index)

目标：用 TypeScript 构建可扩展、低 CPU、可观测、可恢复的 Screeps 系统。  
架构：Kernel / Process / Task。范围：单房到多房演进。

## 规则文件

- 交互与写作规范：[01-format.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/01-format.md)
- 架构与类型规范：[02-architecture.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/02-architecture.md)
- 性能、调度、指标与安全：[03-operations.md](file:///Users/songhao/Library/Application%20Support/Screeps/scripts/screeps.com/default/.trae/rules/03-operations.md)

## 总约束（必须遵守）

- 禁止 any；Memory 仅存 id/数值/短字符串/必要序列化结构
- 禁止循环依赖；Task 原子、可重试或可判定失败
- 禁止输出/记录敏感信息；禁止加注释（除非用户要求）
