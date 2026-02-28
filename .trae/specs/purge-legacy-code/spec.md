# 遗留代码合并与清理 Spec

## Why
- 目标: 彻底按指南合并必要能力并删除冗余遗留代码。
- 观测: 现有 `src/legacy` 与主干实现重复且易被误引入。
- 动作: 将主干缺失能力补齐到 Kernel/Process/Task 分层后删除遗留。
- 反馈: 构建与运行稳定，目录更清晰，维护成本下降。
⇒ 主干代码不依赖 `src/legacy`
⇒ `npm run build` 与 `npm run lint` 均通过
⇒ 主循环在单点异常下继续运行

## What Changes
- 合并遗留能力: trafficMatrix、smartMove、远程发现/远矿调度、孵化策略。
- 统一架构边界: Kernel 负责调度与异常隔离，Process 负责编排，Task 负责执行。
- 删除冗余代码: 移除 `src/legacy/**` 及其未使用的主干重复实现。
- **BREAKING**: 若外部脚本或手工调试依赖 `src/legacy` 路径，将失效。

## Impact
- Affected specs: 架构分层、任务调度、异常隔离、性能与缓存策略。
- Affected code:
  - `src/main.ts` 主循环与 Kernel 异常隔离
  - `src/core/**` 全局缓存与交通矩阵
  - `src/modules/**` 远矿/孵化/防御等业务进程
  - `src/tasks/**` smartMove 与可复用 Task
  - `src/legacy/**` 计划删除

## contextVariables
- changeId: purgeLegacyCode
- legacyDir: srcLegacyDir
- guideDocPath: screepWorldMdPath
- errorIsolationPolicy: kernelPanicIsolation
- migrationScope: legacyMergeScope

## ADDED Requirements

### Requirement: 遗留能力迁移后清理
系统 SHALL 在确认主干具备等价能力后删除 `src/legacy`。

#### Scenario: 清理成功
- **WHEN** 主干实现覆盖遗留能力并完成构建校验
- **THEN** `src/legacy` 被删除且无 import 引用残留
⇒ 代码库中无 `from \"../legacy\"` 或等价引用
⇒ 运行时不出现缺失模块错误

### Requirement: Kernel 级异常隔离
系统 SHALL 避免单个 Process/Creep 异常导致整个 loop 崩溃。

#### Scenario: 单点异常不致停机
- **WHEN** 任一 Process 在 tick 内抛出异常
- **THEN** 仅记录可定位的 stack，主循环继续推进
⇒ main loop 不因单点异常终止
⇒ 异常可定位到 stack
⇒ 关键指标仍稳定写入 Memory.stats

## MODIFIED Requirements

### Requirement: SmartMove 交通矩阵一致性
- 目标: smartMove 的成本矩阵来源单一且可缓存重建。
- 观测: 遗留 trafficManager 与主干 TrafficManager 并存。
- 动作: 以主干 `TrafficManager` 为唯一实现并移除遗留版本。
- 反馈: moveTo 的 costCallback 类型正确且运行无异常。
⇒ TS 类型检查不出现 CostMatrix value/type 混用
⇒ `ERR_NO_PATH` 时按指南触发重新寻路策略

### Requirement: 远矿发现与孵化策略去重
- 目标: 远矿发现、威胁评估与孵化目标由主干进程统一负责。
- 观测: 遗留 RemoteManager/roles 与主干 RemoteMiningProcess 重复。
- 动作: 以主干流程为准，清理重复逻辑与未使用入口。
- 反馈: 远矿新增/暂停/恢复行为可预测且可回溯。
⇒ `RoomMemory.remote` 的写入点集中且类型稳定
⇒ SK 威胁存在时不进入无意义孵化循环

## REMOVED Requirements

### Requirement: 保留遗留实现
**Reason**: 与指南的分层与单向依赖相冲突，且增加维护成本。
**Migration**: 先完成等价能力迁移与验证，再删除 `src/legacy`。
