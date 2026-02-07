---
name: "creep-计划生育"
description: "管理 Creep 的计划生育策略。在调整人口数量、优化孵化逻辑、设计身体部件或处理紧急人口恢复时调用此技能。"
---

# Creep 计划生育 (Creep Population Planning)

本技能定义了 Creep 人口管理的完整生命周期，包括目标计算、孵化优先级、身体部件动态生成及紧急恢复机制。

## 1. 核心理念 (Core Philosophy)

- **按需生产 (Demand-Driven)**：不使用固定的静态数值，而是根据房间当前的经济状况（能量、工地、Controller 降级时间）动态计算目标人口。
- **动态平衡 (Dynamic Balancing)**：随 RCL (Room Control Level) 提升自动调整 Creep 的数量和质量。
- **优先级优先 (Priority First)**：确保维持基础生存的角色（采集、搬运）永远优先于消耗型角色（升级、建造）。

## 2. 人口目标计算 (Target Calculation)

在 `module.population.js` 中实现，应遵循以下逻辑：

### 采集者 (Harvester)

- **基准**：每个 Source 配备 1 名。
- **模式**：
  - 如果有搬运工 (Hauler)：只需 1 名（定点挖掘）。
  - 如果没有搬运工：优先保证 1 名（维持基本产出），然后立即触发紧急孵化搬运工。

### 搬运工 (Hauler)

- **基准**：每个 Source 配备 1 名。
- **动态调整**：
  - **积压检测**：如果 Container 能量 > 1000，+1 名；> 1800，+2 名。
  - **掉落检测**：如果地面掉落能量 > 500，+1 名。
  - **等待惩罚**：如果 Upgrader 平均等待时间 > 20 ticks，全局 +1 名。
- **动态再平衡 (Dynamic Rebalancing)**：
  - 每 5 ticks 系统会自动检查所有 Source 的供需情况。
  - 如果发现某个 Source 严重积压（需求高）而另一个 Source 运力过剩，系统会**强制调拨**多余的 Hauler 进行跨线支援。
- **上限**：设定硬性上限（如 6 名）以防拥堵。

### 升级者 (Upgrader)

- **基准**：1 名（维持 Controller 不降级）。
- **动态调整**：
  - **富裕模式**：如果 Storage 能量 > 20,000 或 Mining Container 积压严重，增加至 2 名。
  - **极度富裕模式**：如果 Storage 能量 > 100,000 或所有 Mining Container 都满载，增加至 3 名（甚至更多）。
  - **紧急模式**：如果 Controller 降级计时 < 4000 ticks，强制设定为 3 名（最高优先级）。
  - **基建让路**：如果有大量工地（Container/Extension），降至 1 名以节省能量。
- **Super Upgrader**：当能量极度充裕时，孵化拥有更多 WORK 部件 (6+) 的升级者，单体消耗能力翻倍。

### 建造者 (Builder)

- **基准**：0 名（无工地时）。
- **动态调整**：
  - **有工地**：根据工地数量调整，每 5 个工地 +1 名，上限 3 名。
  - **关键设施**：如果是 Container/Extension 工地，设定为至少 2 名。

## 3. 孵化优先级 (Spawn Priority)

当多个角色数量不足时，必须严格遵守以下孵化顺序：

1.  **Harvester (0 -> 1)**: 只要有任意 Source 没人在挖，这是最高优先级（生死存亡）。
2.  **Hauler (0 -> 1)**: 有人挖没人运是最大的浪费。
3.  **Harvester (补齐)**: 补齐所有 Source 的采集者。
4.  **Hauler (补齐)**: 补齐运输缺口。
5.  **Upgrader (紧急)**: 如果即将降级。
6.  **Builder (关键)**: 如果有 Container/Extension 需要建造。
7.  **Upgrader / Builder (常规)**: 消耗多余能量。

## 4. 身体部件生成 (Body Generation)

根据房间当前的 `energyAvailable` (紧急情况) 或 `energyCapacityAvailable` (正常情况) 动态组装。

### 设计原则

- **定点角色 (Harvester/Upgrader)**:
  - **极致产出 (Max WORK)**: 随着 RCL 提升，尽可能堆叠 WORK 部件。
  - **最低移动 (Min MOVE)**: 仅保留 1 个 MOVE（配合 CARRY 移动）或极少 MOVE，因为它们几乎不移动。
  - **微量负载 (Min CARRY)**: 1 个 CARRY 用于中转能量到 Container/Link。
- **移动角色 (Hauler)**:
  - **CARRY + MOVE**: 保持 2:1 或 1:1 的比例，确保满载移动速度。
  - **WORK**: 无。
- **混合角色 (Builder)**:
  - **WORK + CARRY + MOVE**: 均衡配置，适应多变环境。

### 详细配置表 (Harvester)

| RCL / Energy          | 配置 (Configuration)     | Cost | 说明                                                            |
| :-------------------- | :----------------------- | :--- | :-------------------------------------------------------------- |
| **RCL 8 (1100+)**     | `[WORK*10, CARRY, MOVE]` | 1100 | 10 WORK 极限开采，为 Power 强化预留空间。                       |
| **RCL 6-7 (900+)**    | `[WORK*8, CARRY, MOVE]`  | 900  | 8 WORK，单 tick 产出 16 能量。                                  |
| **RCL 5 (700+)**      | `[WORK*6, CARRY, MOVE]`  | 700  | 6 WORK，完全饱和 Source (12/tick > 10/tick)，允许少量移动损耗。 |
| **RCL 2-4 (500+)**    | `[WORK*4, CARRY, MOVE]`  | 500  | 4 WORK，RCL 2 即可达成，效率极高。                              |
| **Transition (400+)** | `[WORK*3, CARRY, MOVE]`  | 400  | 平滑过渡配置，填补 300-500 的空白，提升紧急恢复效率。           |
| **RCL 1-2 (300+)**    | `[WORK*2, CARRY, MOVE]`  | 300  | 基础启动配置。                                                  |

### 紧急恢复配置 (Emergency Recovery)

当 `counts.harvester === 0` 或 `counts.hauler === 0` 时：

- 忽略 `energyCapacityAvailable`。
- 使用当前 `energyAvailable` 制造“小而快”的 Creep（如 `[WORK, CARRY, MOVE]` = 200 能量）。
- **目标**：先活下来，再谈效率。

## 5. 实现代码片段 (Snippet)

在 `main.js` 或 `module.population.js` 中应用：

```javascript
// 提前孵化逻辑 (Pre-spawning)
// 在 Creep 寿命耗尽前 (e.g., ticksToLive < timeToSpawn + buffer) 开始孵化继任者
// 确保岗位无缝衔接
if (!creep.spawning && creep.ticksToLive < 100) {
    // 视为该 Creep 已不存在，触发孵化逻辑
    continue;
}
```

```javascript
// 动态 Body 计算 (Harvester)
const getBody = (capacity, role) => {
  if (role === "harvester") {
    if (capacity >= 1100)
      return [
        WORK,
        WORK,
        WORK,
        WORK,
        WORK,
        WORK,
        WORK,
        WORK,
        WORK,
        WORK,
        CARRY,
        MOVE,
      ];
    if (capacity >= 900)
      return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
    if (capacity >= 700)
      return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
    if (capacity >= 500) return [WORK, WORK, WORK, WORK, CARRY, MOVE];
    if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
    return [WORK, CARRY, MOVE];
  }
  // ... 其他角色
};
```
