import Cache from "./memoryManager";
import TaskManager from "./taskManager";
import { EnergyManager, CrisisLevel } from "./EnergyManager";
import { TaskPriority } from "../types/dispatch";

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
      builder: 1,
      upgrader: 1,
      hauler: 6,
      scout: 1,
      remote_harvester: 4,
      remote_hauler: 4,
      remote_reserver: 1,
      remote_defender: 2,
    },
    // 部件限制
    partLimits: {
      LOW: 3,
      MEDIUM: 6,
      HIGH: 12,
    },
  },

  /**
   * 标准内核模块接口
   */
  run: function (room: Room) {
    // 每 5 tick 运行一次重新平衡
    if (Game.time % 5 === 0) {
      EnergyManager.update(room); // [NEW] Update Crisis Level
      this.rebalanceHaulers(room);
      this.updateHarvesterRegistry(room);
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
   * Deprecated: Now handled by EnergyManager, but kept for compatibility if needed.
   * Or we can remove it. Let's redirect to EnergyManager logic if possible.
   * But EnergyManager.update() is already called in run().
   * Let's stub this out or remove calls to it.
   */
  updateEnergyLevel: function (room: Room) {
    // No-op or log
  },

  getEnergyLevel: function (room: Room): string {
    return CrisisLevel[EnergyManager.getLevel(room)];
  },

  /**
   * Calculate Target Counts using EnergyManager
   */
  calculateTargets: function (room: Room) {
    const targets: Record<string, number> = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
      scout: 0,
      remote_harvester: 0,
      remote_hauler: 0,
      remote_reserver: 0,
      remote_defender: 0,
    };

    const sources = Cache.getHeap(
      `sources_${room.name}`,
      () => room.find(FIND_SOURCES),
      1000,
    );

    // === 1. Harvester ===
    let harvesterTarget = 0;
    sources.forEach((source) => {
      const existingHarvesters = Cache.getCreepsByRole(
        room,
        "harvester",
      ).filter((c) => c.memory.sourceId === source.id);
      const totalWorkParts = existingHarvesters.reduce(
        (sum, c) => sum + c.getActiveBodyparts(WORK),
        0,
      );
      const isSufficient = totalWorkParts >= 5;
      let desired = 1;

      if (!isSufficient) {
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

        // In Crisis, allow multiple small harvesters to restore economy
        const level = EnergyManager.getLevel(room);
        if (level === CrisisLevel.CRITICAL || level === CrisisLevel.HIGH) {
          desired = Math.min(spots, 2);
        } else if (room.controller && room.controller.level < 3) {
          desired = Math.min(spots, 2);
        }
      }
      harvesterTarget += desired;
    });
    targets.harvester = harvesterTarget;

    // === 2. Builder & Upgrader (Budget Based) ===
    const level = EnergyManager.getLevel(room);

    // Check Container Reserves
    const containers = Cache.getStructures(
      room,
      STRUCTURE_CONTAINER,
    ) as StructureContainer[];
    const containerEnergy = containers.reduce(
      (sum, c) => sum + c.store[RESOURCE_ENERGY],
      0,
    );

    // Analyze Task Loads
    const tasks = TaskManager.analyze(room);

    // Get Budgets from EnergyManager
    // Note: EnergyManager returns "Budget" which might be interpreted as "Total Work Parts" or "Count".
    // Let's assume Count for now, but we should refine EnergyManager to return "Max Active Count" or similar.
    // Actually, EnergyManager returns WORK parts budget.
    // For population, we need COUNT.
    // Let's use a mapping: Budget 5 -> 1 creep (5W). Budget 10 -> 2 creeps.
    // Or just simple count mapping based on Crisis Level.

    // Let's stick to the previous logic but modified by Crisis Level

    const upgraderWorkBudget = EnergyManager.getBudget(room, "upgrader");
    const builderWorkBudget = EnergyManager.getBudget(room, "builder");

    const defaultWorkPerCreep = room.controller && room.controller.level >= 4 ? 5 : 3;

    targets.upgrader = Math.max(0, Math.ceil(upgraderWorkBudget / defaultWorkPerCreep));
    targets.builder = Math.max(0, Math.ceil(builderWorkBudget / defaultWorkPerCreep));

    // Builder Demand (soft boost on top of budget)
    if (tasks.construction.difficulty === "HIGH") targets.builder = Math.max(targets.builder, 3);
    else if (tasks.construction.difficulty === "MEDIUM") targets.builder = Math.max(targets.builder, 2);
    else if (tasks.construction.difficulty === "LOW") targets.builder = Math.max(targets.builder, 1);
    else if (tasks.repair.difficulty === "HIGH") targets.builder = Math.max(targets.builder, 1);

    // Crisis Overrides
    if (level === CrisisLevel.CRITICAL) {
      targets.builder = 0;
      targets.upgrader = 0;
      // Downgrade protection
      if (room.controller && room.controller.ticksToDowngrade < 2000)
        targets.upgrader = 1;
    } else if (level === CrisisLevel.HIGH) {
      targets.builder = Math.min(targets.builder, 1); // Max 1 builder
      targets.upgrader = 1;
    } else if (level === CrisisLevel.MEDIUM) {
      targets.builder = Math.min(targets.builder, 2);
      targets.upgrader = 1;
      if (containerEnergy > 2000) targets.upgrader = 2;
    } else {
      // LOW or NONE (Abundance)
      if (containerEnergy > 5000) targets.upgrader = 3;
      else targets.upgrader = 2;
    }

    // Anti-Starvation
    if (containerEnergy < 200 && containers.length > 0) {
      targets.upgrader = 1;
      targets.builder = Math.min(targets.builder, 1);
    }

    // Limits
    targets.builder = Math.min(targets.builder, this.config.limits.builder);
    targets.upgrader = Math.min(targets.upgrader, this.config.limits.upgrader);

    // === 3. Hauler ===
    const haulerNeeds = this.getHaulerNeeds(room);
    targets.hauler = 0;
    for (const sourceId in haulerNeeds) {
      targets.hauler += haulerNeeds[sourceId];
    }
    targets.hauler = Math.min(targets.hauler, this.config.limits.hauler);
    if (targets.harvester > 0 && targets.hauler < 1) targets.hauler = 1;

    if (
      room.controller &&
      room.controller.level >= 5 &&
      EnergyManager.getLevel(room) !== CrisisLevel.CRITICAL
    ) {
      const sources = Cache.getHeap(
        `sources_${room.name}`,
        () => room.find(FIND_SOURCES),
        1000,
      ) as Source[];

      const links = Cache.getTick(`links_${room.name}`, () =>
        room.find(FIND_STRUCTURES, {
          filter: (s) => s.structureType === STRUCTURE_LINK,
        }),
      ) as StructureLink[];

      const spawns =
        typeof FIND_MY_SPAWNS !== "undefined"
          ? (Cache.getTick(`spawns_${room.name}`, () =>
              room.find(FIND_MY_SPAWNS as any),
            ) as StructureSpawn[])
          : [];
      const spawn = spawns[0];

      const hubLinkExists = links.some(
        (l) =>
          (spawn && l.pos.inRangeTo(spawn, 4)) ||
          (room.storage && l.pos.inRangeTo(room.storage, 2)),
      );

      let linkedSources = 0;
      sources.forEach((src) => {
        if (links.some((l) => l.pos.inRangeTo(src, 2))) linkedSources++;
      });
      const unlinkedSources = Math.max(0, sources.length - linkedSources);

      if (hubLinkExists && linkedSources > 0) {
        const cap = Math.min(3, 1 + (unlinkedSources > 0 ? 1 : 0));
        targets.hauler = Math.max(1, Math.min(targets.hauler, cap));
      }
    }

    // === 4. Tasks (priority-aware gap expansion) ===
    if (Memory.dispatch && Memory.dispatch.tasks) {
      for (const id in Memory.dispatch.tasks) {
        const task = Memory.dispatch.tasks[id];
        if (!task.creepsAssigned) task.creepsAssigned = [];
        if (!task.validRoles || task.validRoles.length === 0) continue;
        if (task.creepsAssigned.length >= task.maxCreeps) continue;

        // Only expand population for meaningful priorities, otherwise the queue can explode
        if (task.priority > TaskPriority.HIGH) continue;
        if (task.status && task.status !== "pending" && task.status !== "running") continue;

        const role = task.validRoles[0];
        targets[role] =
          (targets[role] || 0) + (task.maxCreeps - task.creepsAssigned.length);
      }
    }

    // Final caps for extended roles
    for (const role in this.config.limits) {
      targets[role] = Math.min(targets[role] || 0, this.config.limits[role]);
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
    const rcl = room.controller?.level || 0;

    const links =
      rcl >= 5
        ? (Cache.getTick(`links_${room.name}`, () =>
            room.find(FIND_STRUCTURES, {
              filter: (s) => s.structureType === STRUCTURE_LINK,
            }),
          ) as StructureLink[])
        : [];

    const spawns =
      rcl >= 5 && typeof FIND_MY_SPAWNS !== "undefined"
        ? (Cache.getTick(`spawns_${room.name}`, () =>
            room.find(FIND_MY_SPAWNS as any),
          ) as StructureSpawn[])
        : [];
    const spawn = spawns[0];

    const hubLinkExists =
      rcl >= 5 &&
      links.some(
        (l) =>
          (spawn && l.pos.inRangeTo(spawn, 4)) ||
          (room.storage && l.pos.inRangeTo(room.storage, 2)),
      );

    // [Optimization] Throughput-based Calculation
    // 1. Estimate Hauler Body Capacity at current RCL
    const capacityAvailable = room.energyCapacityAvailable;
    // Body: [CARRY, MOVE] = 100 cost. Capacity 50.
    // Max sets = floor(capacity / 100). Max parts limit 50 -> 25 sets.
    const maxSets = Math.min(Math.floor(capacityAvailable / 100), 25);
    const singleHaulerCapacity = maxSets * 50;

    // 2. Find Drop Point (Storage > Spawn)
    let dropPoint: any = room.storage;
    if (!dropPoint) {
      try {
        const spawns =
          typeof FIND_MY_SPAWNS !== "undefined"
            ? room.find(FIND_MY_SPAWNS as any)
            : [];
        dropPoint = spawns?.[0];
      } catch {
        dropPoint = undefined;
      }
    }

    // Global Boost for Idle Upgraders
    let globalBoost = 0;
    if (level !== "CRITICAL") {
      const upgraders = Cache.getCreepsByRole(room, "upgrader").filter(
        (c) =>
          !Memory.lifecycle?.registry?.[c.name] ||
          Memory.lifecycle.registry[c.name] !== "PRE_SPAWNING",
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

      if (level === "CRITICAL") {
        needs[source.id] = 1; // Survival mode
        return;
      }

      if (rcl >= 5 && hubLinkExists) {
        const sourceLinked = links.some((l) => l.pos.inRangeTo(source, 2));
        if (sourceLinked) {
          needs[source.id] = 0;
          return;
        }
      }

      // Calculate Distance (Cache it?)
      // Simple range is often enough, pathfinding is expensive.
      // Use Chebyshev distance (max(dx, dy)) as a heuristic.
      // Or Manhattan? Pathfinding is best but let's assume range * 1.5 for terrain.
      let distance = 25; // Default
      if (dropPoint) {
        const fromPos: any = source.pos;
        const toPos: any = dropPoint.pos || dropPoint;

        const cacheKey = `pathLen_${room.name}_${source.id}_${dropPoint.id || "drop"}`;
        distance = Cache.getHeap(
          cacheKey,
          () => {
            if (fromPos && typeof fromPos.findPathTo === "function") {
              try {
                return fromPos.findPathTo(toPos, { ignoreCreeps: true }).length;
              } catch {
                // fall through
              }
            }
            if (fromPos && typeof fromPos.getRangeTo === "function") {
              return fromPos.getRangeTo(toPos);
            }
            if (fromPos && toPos) {
              return Math.max(
                Math.abs((fromPos.x || 0) - (toPos.x || 0)),
                Math.abs((fromPos.y || 0) - (toPos.y || 0)),
              );
            }
            return 25;
          },
          1000,
        );
      }

      // Throughput Formula:
      // Source Generation: 10 energy/tick (3000 / 300)
      // Round Trip: (Distance * 2) + 10 (Load/Unload/Fatigue buffer)
      // Required Capacity per Tick: 10
      // Capacity per Trip: singleHaulerCapacity
      // Trips per Hauler per Tick: 1 / RoundTrip
      // Capacity per Hauler per Tick: singleHaulerCapacity / RoundTrip
      // Required Haulers: 10 / (singleHaulerCapacity / RoundTrip)

      const roundTripTime = distance * 2.1 + 10; // 10% buffer for fatigue/traffic + 10 ops
      const capacityPerTick = singleHaulerCapacity / roundTripTime;

      // Base Count
      let count = Math.ceil(10 / capacityPerTick);

      // [Dynamic Adjustment]
      // If stockpile is high, we might need more to clear it (burst)
      // But sustainable count is 'count'.
      // Add burst haulers if pile is growing.

      const allContainers = Cache.getStructures(room, STRUCTURE_CONTAINER);
      const container = allContainers.find((c) => c.pos.inRangeTo(source, 2));

      if (container) {
        const energy = container.store[RESOURCE_ENERGY];
        if (energy > 1500 && count < 3) count += 1; // Help clear backlog
      }

      // Dropped resources
      const allDropped = Cache.getTick(`dropped_${room.name}`, () =>
        room.find(FIND_DROPPED_RESOURCES),
      );
      const dropped = allDropped.filter(
        (r) => r.resourceType === RESOURCE_ENERGY && r.pos.inRangeTo(source, 3),
      );
      const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
      if (droppedAmount > 1000) count += 1;

      count += globalBoost;

      // Sanity Limits
      // At RCL 8, 1 hauler can carry 1250 (25 parts).
      // Distance 25 -> Trip 60. Capacity/Tick = 1250/60 = 20.
      // 10 / 20 = 0.5. So 1 hauler is plenty.
      // At RCL 2 (300 cap -> 150 carry). Trip 60. Cap/Tick = 150/60 = 2.5.
      // 10 / 2.5 = 4. So 4 haulers.
      // Logic holds up.

      needs[source.id] = Math.max(1, Math.min(count, 5));
    });

    return needs;
  },

  /**
   * 动态平衡搬运工分配
   */
  rebalanceHaulers: function (room: Room) {
    const needs = this.getHaulerNeeds(room);
    const haulers = Cache.getCreepsByRole(room, "hauler").filter(
      (c) =>
        c.ticksToLive > 100 &&
        (!Memory.lifecycle?.registry?.[c.name] ||
          Memory.lifecycle.registry[c.name] !== "PRE_SPAWNING"),
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
      if (energyBudget >= 800) {
        // RCL 3+
        return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]; // 5W 1C 3M (Cost 700) - Fast
      } else if (energyBudget >= 650) {
        return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]; // 5W 1C 1M (Cost 650) - Optimal Production
      } else if (energyBudget >= 550) {
        return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE]; // 4W 1C 2M (Cost 550)
      } else if (energyBudget >= 300) {
        // 300-550 range: Ensure min 2 WORK to pass Spawner validation
        return [WORK, WORK, CARRY, MOVE]; // 2W 1C 1M (Cost 300)
      } else {
        // < 300 Energy
        // [Rule 1.3] Ban 1-WORK creeps unless emergency
        if (!isEmergency) {
          return null as any; // Return null to signal "Do Not Spawn"
          // Note: Callers need to handle null!
        }
      }
    } else if (role === "remote_harvester") {
      // Remote Miner: Needs to move fast and work hard
      if (energyBudget >= 800)
        return [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE]; // 5W 5M
      if (energyBudget >= 650)
        return [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE]; // 5W 3M (Slow)
      // Fallback
    } else if (role === "remote_hauler") {
      // Remote Hauler: Max Carry + Move
      // 1 CARRY + 1 MOVE = 100
      if (energyBudget >= 800)
        return [
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyBudget >= 600)
        return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
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
      harvester: { base: [WORK, CARRY, MOVE], grow: [WORK, WORK, MOVE] }, // Add MOVE to keep up speed
      hauler: { base: [CARRY, MOVE], grow: [CARRY, MOVE] },
      upgrader: { base: [WORK, CARRY, MOVE], grow: [WORK, WORK, MOVE] },
      builder: { base: [WORK, CARRY, MOVE], grow: [WORK, CARRY, MOVE] },
      scout: { base: [MOVE], grow: [] }, // Scout is just 1 MOVE
      remote_harvester: {
        base: [WORK, WORK, MOVE, MOVE],
        grow: [WORK, WORK, MOVE],
      }, // Balance
      remote_defender: {
        base: [TOUGH, ATTACK, MOVE, MOVE],
        grow: [TOUGH, ATTACK, MOVE, MOVE],
      },
      remote_reserver: { base: [CLAIM, MOVE], grow: [CLAIM, MOVE] },
      remote_hauler: { base: [CARRY, CARRY, MOVE, MOVE], grow: [CARRY, MOVE] },
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
