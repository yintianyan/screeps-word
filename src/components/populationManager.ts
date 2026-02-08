
import Cache from "./memoryManager";
import Lifecycle from "./roomManager";
import TaskManager from "./taskManager";

// Define Energy Levels
type EnergyLevel = "CRITICAL" | "LOW" | "MEDIUM" | "HIGH";

const populationModule = {
  // === 配置区域 (Config) ===
  config: {
    // 角色基础配比
    ratios: {
      harvesterPerSource: 1, // 每个 Source 1 个 Harvester (定点挖掘)
      haulerBaseCount: 1, // 基础 Hauler 数量
    },
    // 角色上限
    limits: {
      builder: 3,
      upgrader: 3,
      hauler: 6,
    },
    // 能量等级阈值 (Hysteresis implemented in logic)
    thresholds: {
      low: 0.5,
      high: 0.8,
    },
    // 部件限制
    partLimits: {
      LOW: 3,
      MEDIUM: 6,
      HIGH: 12, // Increased slightly from 10 to allow better RCL3+ creeps
    },
  },

  /**
   * 标准内核模块接口
   */
  run: function (room: Room) {
    // 每 5 tick 运行一次重新平衡
    if (Game.time % 5 === 0) {
      this.rebalanceHaulers(room);
      this.updateEnergyLevel(room);
    }
  },

  /**
   * 更新房间能量等级 (带滞后机制)
   */
  updateEnergyLevel: function (room: Room) {
    if (!room.memory.energyLevel) {
      room.memory.energyLevel = "LOW";
    }

    const capacity = room.energyCapacityAvailable || 300;
    const available = room.energyAvailable;
    const percentage = available / capacity;
    const currentLevel = room.memory.energyLevel as EnergyLevel;

    // Critical check (Override based on Total Energy)
    // Calculate Total Usable Energy (Spawn + Ext + Storage + Containers + Dropped)
    const containers = Cache.getStructures(room, STRUCTURE_CONTAINER) as StructureContainer[];
    const containerEnergy = containers.reduce((sum, c) => sum + c.store[RESOURCE_ENERGY], 0);
    const storageEnergy = room.storage ? room.storage.store[RESOURCE_ENERGY] : 0;
    const dropped = Cache.getTick(`dropped_${room.name}`, () => room.find(FIND_DROPPED_RESOURCES));
    const droppedEnergy = dropped.reduce((sum, r) => sum + (r.resourceType === RESOURCE_ENERGY ? r.amount : 0), 0);
    
    const totalEnergy = available + containerEnergy + storageEnergy + droppedEnergy;
    room.memory.totalEnergy = totalEnergy; // Store for other modules

    // If total energy is less than what's needed for a basic recovery (e.g. 2 max creeps ~ 1000-2000), 
    // or if we literally can't spawn anything.
    if (available < 300 && capacity >= 300) {
      room.memory.energyLevel = "CRITICAL";
      return;
    }
    
    // If we have capacity but total energy is extremely low, we are in a resource crisis
    if (totalEnergy < 1000 && capacity >= 550) { // RCL 2+
         room.memory.energyLevel = "CRITICAL";
         return;
    }

    let newLevel = currentLevel;

    // Hysteresis Buffers: +/- 0.05
    if (currentLevel === "CRITICAL") {
      if (available >= 300) newLevel = "LOW";
    } else if (currentLevel === "LOW") {
      if (percentage > this.config.thresholds.low + 0.05) newLevel = "MEDIUM";
    } else if (currentLevel === "MEDIUM") {
      if (percentage > this.config.thresholds.high + 0.05) newLevel = "HIGH";
      if (percentage < this.config.thresholds.low - 0.05) newLevel = "LOW";
    } else if (currentLevel === "HIGH") {
      if (percentage < this.config.thresholds.high - 0.05) newLevel = "MEDIUM";
    }

    if (newLevel !== currentLevel) {
      room.memory.energyLevel = newLevel;
      console.log(
        `[Energy] Room ${room.name} level changed: ${currentLevel} -> ${newLevel} (${(percentage * 100).toFixed(1)}%)`,
      );
    }
  },

  getEnergyLevel: function (room: Room): EnergyLevel {
    return (room.memory.energyLevel as EnergyLevel) || "LOW";
  },

  /** @param {Room} room **/
  calculateTargets: function (room: Room) {
    const targets = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
    };

    // 使用缓存获取 Source (堆缓存)
    const sources = Cache.getHeap(
      `sources_${room.name}`,
      () => room.find(FIND_SOURCES),
      1000,
    );

    // === 1. Harvester: 动态计算 ===
    let harvesterTarget = 0;
    sources.forEach((source) => {
      const spots = Cache.getHeap(
        `spots_${source.id}`,
        () => {
          let count = 0;
          const terrain = room.getTerrain();
          for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
              if (x === 0 && y === 0) continue;
              if (
                terrain.get(source.pos.x + x, source.pos.y + y) !==
                TERRAIN_MASK_WALL
              ) {
                count++;
              }
            }
          }
          return count;
        },
        1000,
      );

      let desired = 1;

      // 如果能量等级是 CRITICAL 或 LOW，且还有空位，允许更多 Harvester 快速恢复
      const level = this.getEnergyLevel(room);
      if ((level === "CRITICAL" || level === "LOW") && spots > 1) {
        // Check if we actually need more (e.g. creep size is small)
        desired = Math.min(spots, 2);
      }

      harvesterTarget += desired;
    });
    targets.harvester = harvesterTarget;

    // === 2. Energy Check for Builder/Upgrader ===
    // Check if we are in early game (RCL < 3)
    // const isEarlyGame = room.controller && room.controller.level < 3;
    const level = this.getEnergyLevel(room);

    // Get harvesters count for safety checks
    const harvesters = Cache.getCreepsByRole(room, "harvester").length;
    
    // Analyze Task Loads
    const tasks = TaskManager.analyze(room);

    // Default 0
    targets.builder = 0;
    targets.upgrader = 1;

    // --- Dynamic Builder Logic based on Task Difficulty ---
    if (tasks.construction.difficulty === "HIGH") {
      targets.builder = 3;
    } else if (tasks.construction.difficulty === "MEDIUM") {
      targets.builder = 2;
    } else if (tasks.construction.difficulty === "LOW") {
      targets.builder = 1;
    } else {
      // No construction -> Check repair load
      // If repair is HIGH, maybe spawn a builder (which also repairs)
      if (tasks.repair.difficulty === "HIGH") targets.builder = 1;
    }

    // Energy Constraint Override
    if (level === "CRITICAL") {
      targets.builder = 0;
      targets.upgrader = 0; // Stop upgrading in critical unless downgrade imminent
      if (room.controller && room.controller.ticksToDowngrade < 2000)
        targets.upgrader = 1;
    } else if (level === "LOW") {
      // In early game LOW, building extensions is risky if it drains spawn
      // Only build if we have at least 1 full harvester working?
      // Reduce builder count by 1 (min 0)
      targets.builder = Math.max(0, targets.builder - 1);
      
      // But if critical sites exist, keep at least 1
      if (tasks.construction.primaryTarget === STRUCTURE_EXTENSION || 
          tasks.construction.primaryTarget === STRUCTURE_SPAWN) {
          if (targets.builder === 0 && harvesters > 0) targets.builder = 1;
      }
      
      targets.upgrader = 1;
    } else if (level === "MEDIUM") {
      // Allow calculated targets, but cap upgrader
      targets.upgrader = 2;
    } else if (level === "HIGH") {
      // Allow max
      targets.upgrader = 3;
      // If no construction, boost upgrader
      if (targets.builder === 0) targets.upgrader = 4;
    }

    // Limits
    targets.builder = Math.min(targets.builder, this.config.limits.builder);
    targets.upgrader = Math.min(targets.upgrader, this.config.limits.upgrader);
    
    // === 3. Hauler Calculation ===
    const haulerNeeds = this.getHaulerNeeds(room);
    targets.hauler = 0;
    for (const sourceId in haulerNeeds) {
      targets.hauler += haulerNeeds[sourceId];
    }
    targets.hauler = Math.min(targets.hauler, this.config.limits.hauler);

    // Safety for Hauler
    if (targets.harvester > 0 && targets.hauler < 1) {
      targets.hauler = 1;
    }
    if (tasks.construction.count === 0 && tasks.repair.count === 0) {
      targets.builder = 0;
    }

    // Limits
    targets.builder = Math.min(targets.builder, this.config.limits.builder);
    targets.upgrader = Math.min(targets.upgrader, this.config.limits.upgrader);

    // If upgrading, ensure enough haulers
    if (targets.upgrader > 1) {
      // Just a simple heuristic, ideally calculate throughput
    }

    return targets;
  },

  /**
   * 智能计算每个 Source 需要的 Hauler 数量
   */
  getHaulerNeeds: function (room: Room): Record<string, number> {
    const needs: Record<string, number> = {};
    const sources = Cache.getHeap(
      `sources_${room.name}`,
      () => room.find(FIND_SOURCES),
      1000,
    );

    let globalBoost = 0;
    const upgraders = Cache.getCreepsByRole(room, "upgrader").filter((c) =>
      Lifecycle.isOperational(c),
    );
    const avgIdle =
      upgraders.reduce((sum, c) => sum + (c.memory.idleTicks || 0), 0) /
      (upgraders.length || 1);
    if (avgIdle > 20) {
      globalBoost = 1;
    }

    const overrides =
      Memory.config && Memory.config.haulerOverrides
        ? Memory.config.haulerOverrides
        : {};

    sources.forEach((source) => {
      if (overrides[source.id] !== undefined) {
        needs[source.id] = overrides[source.id];
        return;
      }

      let count = this.config.ratios.haulerBaseCount;
      const allContainers = Cache.getStructures(room, STRUCTURE_CONTAINER);
      const container = allContainers.find((c) => c.pos.inRangeTo(source, 2));

      if (container) {
        const energy = container.store[RESOURCE_ENERGY];
        if (energy > 1500)
          count += 2; // Aggressive hauling for high stockpile
        else if (energy > 800) count += 1;
      }

      const allDropped = Cache.getTick(`dropped_${room.name}`, () =>
        room.find(FIND_DROPPED_RESOURCES),
      );
      const dropped = allDropped.filter(
        (r) => r.resourceType === RESOURCE_ENERGY && r.pos.inRangeTo(source, 3),
      );
      const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
      if (droppedAmount > 500) count += 1;

      count += globalBoost;
      count = Math.min(count, 4); // Max 4 per source
      needs[source.id] = count;
    });

    return needs;
  },

  /**
   * 动态平衡搬运工分配
   */
  rebalanceHaulers: function (room: Room) {
    const needs = this.getHaulerNeeds(room);
    const haulers = Cache.getCreepsByRole(room, "hauler").filter(
      (c) => c.ticksToLive > 100 && Lifecycle.isOperational(c),
    );

    const currentCounts: Record<string, number> = {};
    const surplus: Creep[] = [];
    const deficit: { id: string; amount: number }[] = [];

    Object.keys(needs).forEach((id) => (currentCounts[id] = 0));

    haulers.forEach((c) => {
      if (c.memory.sourceId) {
        currentCounts[c.memory.sourceId] =
          (currentCounts[c.memory.sourceId] || 0) + 1;
      }
    });

    for (const sourceId in needs) {
      const diff = (currentCounts[sourceId] || 0) - needs[sourceId];
      if (diff > 0) {
        const sourceHaulers = haulers.filter(
          (c) => c.memory.sourceId === sourceId,
        );
        for (let i = 0; i < diff; i++) {
          if (sourceHaulers[i]) surplus.push(sourceHaulers[i]);
        }
      } else if (diff < 0) {
        deficit.push({ id: sourceId, amount: -diff });
      }
    }

    if (surplus.length > 0 && deficit.length > 0) {
      let surplusIndex = 0;
      for (const item of deficit) {
        for (let i = 0; i < item.amount; i++) {
          if (surplusIndex >= surplus.length) break;
          const creep = surplus[surplusIndex++];
          creep.memory.sourceId = item.id;
          delete creep.memory.targetId;
          creep.say("🔀 reassign");
        }
      }
    }
  },

  /**
   * 生成 Body (新版：基于能量等级)
   */
  getBody: function (room: Room, role: string): BodyPartConstant[] {
    const level = this.getEnergyLevel(room);
    const availableEnergy = room.energyAvailable;
    const capacity = room.energyCapacityAvailable;

    // Analyze Task Loads (Cached)
    const tasks = TaskManager.analyze(room);

    // Determine max parts based on level
    let maxParts = this.config.partLimits[level] || 50;
    if (level === "CRITICAL") maxParts = 3;

    // --- Dynamic Body Constraints based on Tasks ---
    if (role === "builder") {
      if (tasks.construction.difficulty === "LOW" && tasks.repair.difficulty !== "HIGH") {
        maxParts = Math.min(maxParts, 6); // Cap small builders for small tasks
      }
    }
    if (role === "hauler") {
       if (tasks.transport.difficulty === "LOW") {
         maxParts = Math.min(maxParts, 8); // Don't build massive haulers if nothing to carry
       }
    }

    // Config for each role
    const configs: Record<
      string,
      {
        base: BodyPartConstant[];
        grow: BodyPartConstant[];
        maxGrow?: number;
      }
    > = {
      harvester: {
        base: [WORK, CARRY, MOVE],
        grow: [WORK], // Harvester mainly needs WORK
        maxGrow: 5, // Max 5 extra WORKs (Total 6 WORK = 12 energy/tick, > source capacity)
      },
      hauler: {
        base: [CARRY, MOVE],
        grow: [CARRY, MOVE], // Keep 1:1 ratio
        maxGrow: 15,
      },
      upgrader: {
        base: [WORK, CARRY, MOVE],
        grow: [WORK, WORK, MOVE], // Slower move ratio for stationary
        maxGrow: 10,
      },
      builder: {
        base: [WORK, CARRY, MOVE],
        grow: [WORK, CARRY, MOVE], // Balanced
        maxGrow: 5,
      },
    };

    const config = configs[role];
    if (!config) return [WORK, CARRY, MOVE];

    // Start with base
    const body = [...config.base];
    let currentCost = this.calculateBodyCost(body);

    // Grow body
    let growCount = 0;
    const maxGrow = config.maxGrow || 50;

    // Special case for Harvester: Needs MOVE to reach source, then WORK
    // If level is High, maybe add more MOVEs?
    // For now, stick to simple growth.

    while (true) {
      // Check constraints
      if (body.length + config.grow.length > maxParts) break;
      if (growCount >= maxGrow) break;

      const growCost = this.calculateBodyCost(config.grow);
      if (currentCost + growCost > availableEnergy) break;
      if (currentCost + growCost > capacity) break; // Hard limit

      // Add parts
      config.grow.forEach((p) => body.push(p));
      currentCost += growCost;
      growCount++;
    }

    // Sort body parts (tough first, heal last - though we don't have them yet)
    // Standard Screeps order: TOUGH -> WORK/CARRY -> MOVE -> ATTACK/RANGED_ATTACK -> HEAL
    // Simple sort: WORK, CARRY, MOVE
    // Actually, for damage mitigation, MOVE last is sometimes bad if you need to run away, but standard is fine.
    // Let's just group them.
    const sortOrder: Record<string, number> = {
      [TOUGH]: 0,
      [WORK]: 1,
      [CARRY]: 2,
      [ATTACK]: 3,
      [RANGED_ATTACK]: 4,
      [HEAL]: 5,
      [CLAIM]: 6,
      [MOVE]: 7,
    };
    body.sort((a, b) => sortOrder[a] - sortOrder[b]);

    return body;
  },

  calculateBodyCost: function (body: BodyPartConstant[]): number {
    let cost = 0;
    body.forEach((part) => {
      cost += BODYPART_COST[part];
    });
    return cost;
  },
};

export default populationModule;
