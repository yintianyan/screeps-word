# 02 架构与类型规范

- 分层：Kernel 统一调度；Process 做决策/编排；Creep 执行 Task
- 依赖：模块单向依赖，禁止循环依赖
- Task：原子行为；可重试或可判定失败；不依赖隐式跨 tick 状态

## TypeScript

- strict 模式；禁止 any
- 维护稳定的 Memory 类型（CreepMemory、RoomMemory、process/metrics）
- Memory 读写必须集中在明确模块/函数，避免散落写入
