# 02 架构与类型规范

- 分层：Kernel 统一调度；Process 做决策/编排；Creep 执行 Task
- 依赖：模块单向依赖，禁止循环依赖
- Task：原子行为；可重试或可判定失败；不依赖隐式跨 tick 状态
- Process：协调多个 Task，不直接执行行为
- 指标：每个 Process 必须有稳定的指标写入 Memory.stats（cpu.* 与 room.*）
- 动态：Process 必须能根据当前状态动态调整行为（如根据房间指标调整工作负载）

## TypeScript

- strict 模式；禁止 any
- 维护稳定的 Memory 类型（CreepMemory、RoomMemory、process/metrics）
- Memory 读写必须集中在明确模块/函数，避免散落写入
