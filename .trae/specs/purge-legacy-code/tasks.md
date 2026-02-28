# Tasks

- [x] Task 1: 盘点遗留与主干重复点并锁定迁移范围
  - [x] 子任务 1.1: 列出 `src/legacy` 能力清单与主干对应关系
  - [x] 子任务 1.2: 证明主干无 `src/legacy` import 依赖
  - [x] 子任务 1.3: 明确需要补齐到主干的缺口列表

- [x] Task 2: 按指南补齐主干缺口并消除重复实现
  - [x] 子任务 2.1: Kernel 级异常隔离与可定位错误输出
  - [x] 子任务 2.2: smartMove 与 trafficMatrix 统一为单实现
  - [x] 子任务 2.3: 远矿发现/威胁/孵化目标去重与集中写入

- [x] Task 3: 删除遗留目录与冗余文件并修复引用
  - [x] 子任务 3.1: 删除 `src/legacy/**`
  - [x] 子任务 3.2: 删除主干中未再使用的重复 helper/模块
  - [x] 子任务 3.3: 修复类型定义与 Memory 迁移字段

- [x] Task 4: 验证与回归
  - [x] 子任务 4.1: 运行 `npm run build` 与 `npm run lint`
  - [x] 子任务 4.2: 运行 1 个 tick 的核心流程验证脚本或最小集成验证
  - [x] 子任务 4.3: 检查 Memory.stats 与关键房间指标持续写入

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 depends on Task 3
