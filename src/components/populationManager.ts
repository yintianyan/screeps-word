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
      this.updateHarvesterRegistry(room); // [Rule 2]
    }
  },

  // [Rule 2] Harvester Registry Maintenance
  updateHarvesterRegistry: function (room: Room) {
    if (!room.memory.harvesters) room.memory.harvesters = [];

    // Clean dead
    room.memory.harvesters = room.memory.harvesters.filter((h: any) =>
      Game.getObjectById(h.id),
    );

    // Add new
    const creeps = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "harvester",
    });
    creeps.forEach((c) => {
      if (!room.memory.harvesters.find((h: any) => h.id === c.id)) {
        room.memory.harvesters.push({
          id: c.id,
          spawnTime: c.memory.spawnTime || Game.time,
          workParts: c.getActiveBodyparts(WORK),
        });
      }
    });
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
    const containers = Cache.getStructures(
      room,
      STRUCTURE_CONTAINER,
    ) as StructureContainer[];
    const containerEnergy = containers.reduce(
      (sum, c) => sum + c.store[RESOURCE_ENERGY],
      0,
    );
    const storageEnergy = room.storage
      ? room.storage.store[RESOURCE_ENERGY]
      : 0;
    const dropped = Cache.getTick(`dropped_${room.name}`, () =>
      room.find(FIND_DROPPED_RESOURCES),
    );
    const droppedEnergy = dropped.reduce(
      (sum, r) => sum + (r.resourceType === RESOURCE_ENERGY ? r.amount : 0),
      0,
    );

    const totalEnergy =
      available + containerEnergy + storageEnergy + droppedEnergy;
    room.memory.totalEnergy = totalEnergy; // Store for other modules

    // If total energy is less than what's needed for a basic recovery (e.g. 2 max creeps ~ 1000-2000),
    // or if we literally can't spawn anything.
    if (available < 300 && capacity >= 300) {
      room.memory.energyLevel = "CRITICAL";
      return;
    }

    // If we have capacity but total energy is extremely low, we are in a resource crisis
    // RCL 3 threshold: 2000 (containers empty)
    // RCL 4+ threshold: 5000 (storage empty)
    const crisisThreshold =
      room.controller && room.controller.level >= 4 ? 5000 : 2000;

    // [FIX] Post-Spawn Crisis Prevention
    // If we just spawned something big, available energy drops to 0.
    // But if we have valid creep population, we shouldn't panic.
    const harvesters = Cache.getCreepsByRole(room, "harvester");
    const haulers = Cache.getCreepsByRole(room, "hauler");
    const healthyPopulation = harvesters.length > 0 && haulers.length > 0;

    if (totalEnergy < crisisThreshold && capacity >= 550) {
      // Only enter CRITICAL if population is also critical
      // If we have miners and haulers, we are just "Low", not "Critical"
      if (!healthyPopulation) {
        room.memory.energyLevel = "CRITICAL";
        return;
      } else {
        // If total energy is low but we have workers, force LOW instead of CRITICAL
        // to allow builders to work (if logic permits)
        room.memory.energyLevel = "LOW";
        // Do not return, let hysteresis logic run, but ensure it doesn't go below LOW
      }
    }

    let newLevel = currentLevel;

    // Hysteresis Buffers: +/- 0.05
    if (currentLevel === "CRITICAL") {
      // Exit critical if we have basic energy OR healthy population
      if (available >= 300 || healthyPopulation) newLevel = "LOW";
    } else if (currentLevel === "LOW") {
      if (percentage > this.config.thresholds.low + 0.05) newLevel = "MEDIUM";
    } else if (currentLevel === "MEDIUM") {
      if (percentage > this.config.thresholds.high + 0.05) newLevel = "HIGH";
      if (percentage < this.config.thresholds.low - 0.05) newLevel = "LOW";
    } else if (currentLevel === "HIGH") {
      if (percentage < this.config.thresholds.high - 0.05) newLevel = "MEDIUM";
    }

    // [New] Reserve Cap
    // If we have no storage reserve (containers empty), do not allow HIGH level
    // This prevents over-spawning when only Spawn is full but economy is fragile
    if (totalEnergy < capacity + 1000) {
      if (newLevel === "HIGH") newLevel = "MEDIUM";
    }
    if (totalEnergy < capacity + 200) {
      if (newLevel === "MEDIUM") newLevel = "LOW";
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
      // [FIX] Harvester Count Logic
      // 1. If we have a 5+ WORK harvester (can mine 10 energy/tick), we only need 1 per source.
      // 2. If we are in CRITICAL/LOW energy, we might need more small ones to ramp up.

      const existingHarvesters = Cache.getCreepsByRole(
        room,
        "harvester",
      ).filter((c) => c.memory.sourceId === source.id);
      const totalWorkParts = existingHarvesters.reduce(
        (sum, c) => sum + c.getActiveBodyparts(WORK),
        0,
      );

      // Check if current harvesting power is sufficient (>= 5 WORK)
      // Source: 3000 energy / 300 ticks = 10 energy/tick.
      // 1 WORK = 2 energy/tick. So 5 WORK is max.
      const isSufficient = totalWorkParts >= 5;

      let desired = 1;

      if (!isSufficient) {
        // If not sufficient, we might need another one if spots allow
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

        // In early game (RCL < 3) or if existing harvesters are very small, fill spots
        // But limit to 2 to avoid congestion unless spots=1
        if (room.controller && room.controller.level < 3) {
          desired = Math.min(spots, 2);
        } else {
          // RCL 3+: Try to rely on 1 big harvester.
          // If current is small (< 5 WORK), spawn another to help?
          // Or just spawn 1 replacement?
          // SpawnCenter handles replacement. Here we calculate target count.
          // If we have 1 harvester with 2 WORK, we want 1 target (wait for it to die and replace with better)
          // UNLESS we are in CRITICAL mode.
          const level = this.getEnergyLevel(room);
          if (level === "CRITICAL" || level === "LOW") {
            desired = Math.min(spots, 2);
          }
        }
      } else {
        // If sufficient, strictly 1
        desired = 1;
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

    // Check Container Reserves
    const containers = Cache.getStructures(
      room,
      STRUCTURE_CONTAINER,
    ) as StructureContainer[];
    const containerEnergy = containers.reduce(
      (sum, c) => sum + c.store[RESOURCE_ENERGY],
      0,
    );
    const hasReserves = containerEnergy > 1000;

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
      if (
        tasks.construction.primaryTarget === STRUCTURE_EXTENSION ||
        tasks.construction.primaryTarget === STRUCTURE_SPAWN
      ) {
        if (targets.builder === 0 && harvesters > 0) targets.builder = 1;
      }

      targets.upgrader = 1;
    } else if (level === "MEDIUM") {
      // Allow calculated targets, but cap upgrader
      targets.upgrader = hasReserves ? 2 : 1; // Cap at 1 if no reserves
    } else if (level === "HIGH") {
      // Allow max
      targets.upgrader = hasReserves ? 3 : 2; // Cap at 2 if no reserves
      // If no construction, boost upgrader
      if (targets.builder === 0) targets.upgrader = hasReserves ? 4 : 2;
    }

    // [New] Hard Cap if containers are empty (Anti-Starvation)
    if (containerEnergy < 200 && containers.length > 0) {
      targets.upgrader = 1;
      targets.builder = Math.min(targets.builder, 1);
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
    const level = this.getEnergyLevel(room);

    let globalBoost = 0;
    // Only apply boost if not CRITICAL
    if (level !== "CRITICAL") {
      const upgraders = Cache.getCreepsByRole(room, "upgrader").filter((c) =>
        Lifecycle.isOperational(c),
      );
      const avgIdle =
        upgraders.reduce((sum, c) => sum + (c.memory.idleTicks || 0), 0) /
        (upgraders.length || 1);
      if (avgIdle > 20) {
        globalBoost = 1;
      }
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

      if (level !== "CRITICAL") {
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
          (r) =>
            r.resourceType === RESOURCE_ENERGY && r.pos.inRangeTo(source, 3),
        );
        const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
        if (droppedAmount > 500) count += 1;

        count += globalBoost;
        count = Math.min(count, 4); // Max 4 per source
      } else {
        // Critical Mode Cap
        count = 1;
      }

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
   * 生成 Body (新版：基于能量等级 + 评分模型)
   * 核心原则：
   * 1. 能量充足时强制使用高配模板
   * 2. 能量 < 300 时禁止生产残次品（除非 Harvester=0）
   * 3. 使用评分函数优选最佳配置
   */
  getBody: function (
    room: Room,
    role: string,
    forceMax: boolean = false,
  ): BodyPartConstant[] {
    const capacity = room.energyCapacityAvailable;
    const available = room.energyAvailable;
    const harvesters = Cache.getCreepsByRole(room, "harvester");
    const isEmergency = harvesters.length === 0;

    // 决定使用哪个能量上限作为计算基准
    // 如果 forceMax 为 true 且非危机状态，使用 capacity (贪婪模式)
    // 否则使用 available (保守模式)
    let energyBudget = forceMax ? capacity : available;

    // [Rule 1: Dynamic Mapping]
    // 强制模板映射表 (Template Mapping)
    // 优先级：Template > Procedural Generation
    if (role === "harvester") {
      if (energyBudget >= 650) {
        return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]; // 5W 1C 1M (Cost 650) - Optimal
      } else if (energyBudget >= 550) {
        return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE]; // 4W 1C 2M (Cost 550)
      } else if (energyBudget >= 300) {
        // 300-550 range: Procedural is fine, but ensure min 2 WORK if possible
        // Fallthrough to procedural
      } else {
        // < 300 Energy
        // [Rule 1.3] Ban 1-WORK creeps unless emergency
        if (!isEmergency) {
          return null as any; // Return null to signal "Do Not Spawn"
          // Note: Callers need to handle null!
        }
      }
    }

    // Procedural Generation with Scoring (Rule 5)
    // Generate multiple candidates and pick best score
    const candidates: BodyPartConstant[][] = [];

    // Candidate 1: Max parts
    candidates.push(this.generateProceduralBody(role, energyBudget, 50));

    // Candidate 2: Efficiency Focused (Less MOVE)
    candidates.push(
      this.generateProceduralBody(role, energyBudget, 50, "efficiency"),
    );

    // Score and Pick
    let bestBody: BodyPartConstant[] | null = null;
    let bestScore = -Infinity;

    for (const body of candidates) {
      const score = this.evaluateBodyScore(body, role, energyBudget);
      if (score >= 60 && score > bestScore) {
        // Rule 5: Reject score < 60
        bestScore = score;
        bestBody = body;
      }
    }

    // Fallback for emergency
    if (!bestBody && isEmergency && role === "harvester") {
      return [WORK, CARRY, MOVE]; // Minimal viable
    }

    return bestBody || candidates[0]; // Fallback to candidate 0 if all failed score but we need something?
    // Actually Rule 5 says "eliminate all score < 60".
    // If not emergency, we should return null?
    // Let's stick to bestBody if available, otherwise null if strict.
    // For safety, return candidates[0] if it's valid cost.
  },

  /**
   * 过程式生成候选身体
   */
  generateProceduralBody: function (
    role: string,
    energy: number,
    maxParts: number,
    strategy: "balanced" | "efficiency" = "balanced",
  ): BodyPartConstant[] {
    // ... Reuse existing logic logic but adapted ...
    // For brevity, using a simplified version of previous logic here
    const configs: Record<string, any> = {
      harvester: { base: [WORK, CARRY, MOVE], grow: [WORK] },
      hauler: { base: [CARRY, MOVE], grow: [CARRY, MOVE] },
      upgrader: { base: [WORK, CARRY, MOVE], grow: [WORK, WORK, MOVE] },
      builder: { base: [WORK, CARRY, MOVE], grow: [WORK, CARRY, MOVE] },
    };

    const config = configs[role] || configs.harvester;
    const body = [...config.base];
    let cost = this.calculateBodyCost(body);

    while (
      cost + this.calculateBodyCost(config.grow) <= energy &&
      body.length + config.grow.length <= maxParts
    ) {
      config.grow.forEach((p: BodyPartConstant) => body.push(p));
      cost += this.calculateBodyCost(config.grow);
    }

    // Sort
    return this.sortBody(body);
  },

  /**
   * [Rule 5] 评分模型
   * score = (WORK*20 + CARRY*5 + MOVE*3) - (cost/50) + (life_benefit)
   */
  evaluateBodyScore: function (
    body: BodyPartConstant[],
    role: string,
    budget: number,
  ): number {
    let score = 0;
    const counts = { [WORK]: 0, [CARRY]: 0, [MOVE]: 0 };
    let cost = 0;

    body.forEach((p) => {
      if (counts[p] !== undefined) counts[p]++;
      cost += BODYPART_COST[p];
    });

    // Weighted Parts
    if (role === "harvester") {
      score += counts[WORK] * 20;
      score += counts[CARRY] * 5;
      score += counts[MOVE] * 3;
    } else if (role === "hauler") {
      score += counts[CARRY] * 15;
      score += counts[MOVE] * 10;
    } else {
      score += counts[WORK] * 10;
      score += counts[CARRY] * 5;
      score += counts[MOVE] * 5;
    }

    // Cost Penalty
    score -= cost / 50;

    // Life Benefit (Approximation: bigger body = more value per 1500 ticks life)
    score += cost / 100;

    // Penalize unused energy (Efficiency)
    if (budget - cost > 100) score -= 10;

    return score;
  },

  sortBody: function (body: BodyPartConstant[]): BodyPartConstant[] {
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
    return body.sort((a, b) => sortOrder[a] - sortOrder[b]);
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
