---
name: "creeps运行守则"
description: "强制执行 Creep 的基于角色的约束。在定义、调试或优化 Creep 逻辑时调用，以确保它们遵守分配的职责。"
---

# Creeps 运行守则 (Creeps Operation Protocol)

此技能提供了代码库中所有 Creep 的标准操作程序和约束。在实现或调试 Creep 行为时，请以此作为参考。

## 核心原则 (Core Principle)

**“专人专职” (One Role, One Job)**：每个 Creep 必须有定义的角色，并严格遵守分配给该角色的任务。除非明确定义为紧急协议，否则禁止跨角色活动（例如，采集者进行长途运输）。

## 角色约束 (Role Constraints)

### 1. 采集者 (Harvester)

- **主要任务**：从能量源 (Source) 采集能量。
- **次要任务**：将能量转移到**附近**的容器 (Container, 范围 1) 或链路 (Link)。
- **允许**：
  - 维修脚下的容器（自我维护）。
  - 在范围 3 内建造工地（如果能量已满且没有容器）。
- **禁止**：
  - 移动到控制器 (Controller) 进行升级。
  - 移动到重生点 (Spawn) 进行转移（除非处于紧急模式）。
  - 从分配给它们的能量源以外的地方采集。

### 2. 搬运工 (Hauler)

- **主要任务**：将能量从采矿容器 (Mining Container) 运输到仓库 (Storage)/重生点 (Spawn)/扩展 (Extensions)。
- **允许**：
  - 捡起掉落的能量。
  - 从墓碑 (Tombstones)/废墟 (Ruins) 中提取能量。
- **禁止**：
  - 采集能量（无 WORK 部件）。
  - 将能量**运回**到采矿容器。
  - 升级控制器。

### 3. 升级者 (Upgrader)

- **主要任务**：升级房间控制器 (Room Controller)。
- **允许**：
  - 从控制器链路 (Link)/容器 (Container) 中提取能量。
  - 采集能量（仅在早期游戏 RCL 1 时）。
- **禁止**：
  - 建造工地（使用建造者）。
  - 将能量运送到重生点。

### 4. 建造者 (Builder)

- **主要任务**：建造工地 (Construction Sites)。
- **次要任务**：维修建筑（道路、容器）。
- **允许**：
  - 从仓库 (Storage)/容器 (Container) 中提取能量。
  - 采集能量（仅当仓库中没有能量时）。
- **优先级**：
  - Spawn (重生点) > Extension (扩展) > Tower (防御塔) > Container (容器) > Road (道路)。

## 实现指南 (Implementation Guidelines)

编写 Creep 代码时：

1.  **状态机**：始终使用布尔开关（例如 `memory.working`）在收集和工作状态之间切换。
2.  **互斥动作**：确保每 tick 仅执行一个动作（采集/建造/维修/转移）。
3.  **视觉反馈**：使用 `creep.say()` 可视化当前状态（例如 "🔄 harvest", "🚧 build"）。
