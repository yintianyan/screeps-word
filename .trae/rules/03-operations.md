# 03 性能、调度、指标与安全

## 性能与内存

- CPU 优先级：生存与防御 > 经济 > 建造 > 扩张
- cpuBucket 低于阈值：暂停非关键进程（建造/外矿/规划）
- Memory 禁止膨胀：仅存 id/数值/短字符串/必要序列化结构
- 禁止存放大型数组、CostMatrix 原始对象、Room/Structure/Creep 引用
- 热点缓存：优先 global heap；Global Reset 后可重建

## 调度与异常

- 任务优先级：Critical/High/Medium/Normal/Low
- 资源预定 reservation：避免争抢与空跑
- 拥堵控制：targetSlots + targetAssignedCreeps，超额不得分配
- 异常自愈：PathBlocked/TargetInvalid/Timeout 可检测与恢复

## 指标与安全

- Memory.stats 必须稳定写入：cpu.bucket、cpu.usage、cpu.scheduler
- 房间指标：room.energyAvailable、room.rcl_progress（或等价拆分）
- 禁止输出/记录敏感信息；禁止引入新第三方库（除非说明收益与替代）

