---
name: "creep-system"
description: "Comprehensive Creep management system covering population planning, body part generation, and operational protocols. Invoke when optimizing Creep logic, adjusting spawn priorities, or debugging role behaviors."
---

# Creep System & Population Management

This skill consolidates the logic for Creep population planning, body part generation, and operational protocols. It serves as the single source of truth for Creep management.

## 1. Core Philosophy (核心理念)

- **One Role, One Job (专人专职)**: Each Creep has a defined role and strict task adherence.
- **Stationary Work (定点工作)**: Harvesters/Upgraders should minimize movement to save CPU.
- **Demand-Driven (按需生产)**: Population targets are dynamic based on room economy (RCL, Energy, Construction Load).
- **Priority First (优先级优先)**: Survival roles (Harvester, Hauler) prioritize over consumption roles (Upgrader, Builder).

## 2. Population Planning (人口规划)

Calculated in `components/populationManager.ts`.

### Target Calculation (目标计算)

- **Harvester**: 1 per Source. Critical priority.
- **Hauler**: 1 per Source base. Adds +1/2 based on Transport Load, Container accumulation, or dropped resources.
- **Upgrader**: 1 base. Increases to 3-4 if energy is high and no construction. Decreases if construction is heavy.
- **Builder**: 0 base. Spawns 1-3 based on Construction/Repair Load.

### Spawn Priority (孵化优先级)

1. **Harvester (0 -> 1)**: Critical survival.
2. **Hauler (0 -> 1)**: Critical logistics.
3. **Harvester (Fill)**: Saturation.
4. **Hauler (Fill)**: Logistics saturation.
5. **Upgrader (Emergency)**: Prevent controller downgrade.
6. **Builder (Critical)**: Spawn/Extension construction.
7. **Upgrader/Builder (Standard)**: Surplus energy usage.

## 3. Body Part Generation (身体部件生成)

Dynamic body generation based on `energyCapacityAvailable` (Standard) or `energyAvailable` (Emergency).

- **Harvester**: Max WORK (up to 10), Min MOVE/CARRY.
- **Hauler**: CARRY:MOVE ratio 1:1 or 2:1. No WORK.
- **Upgrader**: Max WORK, Min MOVE/CARRY.
- **Builder**: Balanced WORK/CARRY/MOVE.

## 4. Operational Protocols (运行守则)

### Harvester
- **Position**: Stationary at Source/Container.
- **Task**: Harvest -> Transfer to Container/Link.
- **Constraint**: No long-distance transport.

### Hauler
- **Position**: Mobile.
- **Task**: Pick up (Dropped > Container) -> Deliver (Spawn > Tower > Upgrader/Builder > Storage).
- **Active Delivery**: Delivers directly to working Creeps (Upgrader/Builder) if they need energy.

### Upgrader
- **Position**: Stationary at Controller/Link.
- **Task**: Upgrade Controller.
- **Source**: Link > Container > Dropped. Request energy if empty.

### Builder
- **Position**: Mobile/Stationary at Construction Site.
- **Task**: Build (Spawn > Tower > Extension > Road > Wall).
- **Source**: Container > Dropped. Request energy if empty.

## 5. Implementation Guidelines

- **State Machine**: Use `memory.working` boolean to toggle gathering/working states.
- **Visuals**: Use `creep.say()` for state visualization.
- **Cpu Optimization**: Use `reusePath` for movement and cache paths.

## 6. Code Snippets (代码片段)

### Pre-spawning (提前孵化)
```javascript
// 在 Creep 寿命耗尽前 (e.g., ticksToLive < timeToSpawn + buffer) 开始孵化继任者
if (!creep.spawning && creep.ticksToLive < 100) {
    // 视为该 Creep 已不存在，触发孵化逻辑
    continue;
}
```

### Dynamic Body Calculation (动态 Body 计算)
```javascript
const getBody = (capacity, role) => {
  if (role === "harvester") {
    if (capacity >= 1100) return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]; // 10 WORK
    if (capacity >= 900) return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]; // 8 WORK
    if (capacity >= 700) return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]; // 6 WORK
    if (capacity >= 500) return [WORK, WORK, WORK, WORK, CARRY, MOVE]; // 4 WORK
    if (capacity >= 300) return [WORK, WORK, CARRY, MOVE]; // 2 WORK
    return [WORK, CARRY, MOVE];
  }
  // ... other roles
};
```
