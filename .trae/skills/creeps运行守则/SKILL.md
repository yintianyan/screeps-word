---
name: "creeps运行守则"
description: "强制执行 Creep 的基于角色的约束。在定义、调试或优化 Creep 逻辑时调用，以确保它们遵守分配的职责。"
---

# Creeps 运行守则 (Creeps Operation Protocol)

此技能提供了代码库中所有 Creep 的标准操作程序和约束。在实现或调试 Creep 行为时，请以此作为参考。

## 核心原则 (Core Principle)

1.  **“专人专职” (One Role, One Job)**：每个 Creep 必须有定义的角色，并严格遵守分配给该角色的任务。除非明确定义为紧急协议，否则禁止跨角色活动。
2.  **“定点工作” (Stationary Work)**：采集者、升级者和建造者（尽可能）应在工作地点保持**稳定不动**。通过减少移动，提高工作效率并降低 CPU 消耗。
3.  **“全权运输” (Centralized Logistics)**：所有的能量运输工作应由 **搬运工 (Hauler)** 承担。其他角色不应进行长途运输。

## 角色约束 (Role Constraints)

### 1. 采集者 (Harvester)

- **定位**：**稳定不动**。
  - **首选**：驻扎在能量源 (Source) 旁的容器 (Container) 上。
  - **次选**：如果容器被占用，驻扎在 Source 旁 Range 1 的任意可用空地上（避免争抢）。
- **主要任务**：持续采集能量。
- **次要任务**：将能量转移到脚下的容器。
- **允许**：
  - 维修脚下的容器（自我维护）。
  - 在范围 3 内建造工地（如果能量已满且没有容器）。
- **禁止**：
  - **任何形式的长途运输**。
  - 移动离开分配的 Source（除非容器被摧毁或需要逃生）。
  - 移动到控制器或重生点。

### 2. 搬运工 (Hauler)

- **定位**：**全图游走，动态绑定**。
- **主动物流 (Active Delivery Protocol)**：
  - **核心职责**：不再只是填满容器，而是**主动配送**能量给急需的 Creep。
  - **触发条件**：
    - 目标必须是 `upgrader` 或 `builder`。
    - 目标能量低 (< 50%) 且正在工作或等待 (`working` or `requestingEnergy`)。
    - (Builder) 正在建造关键设施 (Spawn/Extension)。
  - **优先级**：Spawn/Extension > Tower > **Upgrader/Builder (直送)** > Sink Containers > Storage。
- **取货策略**：
  - **第一优先级**：掉落资源 (Dropped Resources)。这是会衰减的资源，必须最快捡起。
  - **第二优先级**：源头容器 (Mining Container)。
- **禁止**：
  - 采集能量。
  - 将能量运回采矿容器。

### 3. 升级者 (Upgrader)

- **定位**：**稳定不动 / 请求支援**。
- **主要任务**：持续升级控制器。
- **智能获取 (Smart Acquisition)**：
  - **优先**：捡起脚下的掉落能量。
  - **次选**：从身边的 Link/Container 取货。
  - **请求支援 (Requesting Energy)**：如果以上均无，在 Memory 中设置 `requestingEnergy: true`，头顶显示 `📡 help`，原地等待 Hauler 配送。
  - **最后手段**：仅在极度缺乏能量且无 Hauler 响应时，才去 Source 采集。

### 4. 建造者 (Builder)

- **定位**：**区域稳定 / 请求支援**。
- **主要任务**：建造工地。
- **优先级系统**：严格遵循 `PriorityModule` (Spawn > Tower > Container > Extension > Wall > Road)。
- **智能获取**：
  - 同 Upgrader，优先利用掉落物或容器。
  - 当能量耗尽且在进行关键建设时，发出 `requestingEnergy` 信号，获得 Hauler 的优先配送。
- **强制工作**：如果尝试取能失败但背包内有剩余能量，**必须**强制开始工作。

## 实现指南 (Implementation Guidelines)

1.  **身体部件优化**：对于“定点工作”的 Creep (Harvester/Upgrader)，可以减少 `MOVE` 部件的数量（只需到达工作点即可），增加 `WORK` 部件以提高效率。
2.  **状态机**：始终使用布尔开关（例如 `memory.working`）在收集和工作状态之间切换。
3.  **互斥动作**：确保每 tick 仅执行一个动作。
4.  **视觉反馈**：使用 `creep.say()` 可视化当前状态。
