import { GlobalDispatch } from "../ai/GlobalDispatch";
import { Task, TaskPriority, TaskType } from "../types/dispatch";
import priorityModule from "../config/priority";
import Cache from "../components/memoryManager";
import { EnergyManager, CrisisLevel } from "../components/EnergyManager";

export class EconomyCenter {
  static run(room: Room) {
    if (Game.time % 10 !== 0) return; // Run every 10 ticks

    this.generateHarvestTasks(room);
    this.generateTransportTasks(room);
    this.generateActiveDeliveryTasks(room); // [NEW]
    this.generateBuildTasks(room);
    this.generateUpgradeTasks(room);
  }

  private static generateHarvestTasks(room: Room) {
    const sources = room.find(FIND_SOURCES);
    sources.forEach((source) => {
      const taskId = `HARVEST_${source.id}`;
      // Basic task: Harvest energy
      // [FIX] Harvester Count Logic
      // Check if we already have a powerful harvester on this source
      const existingHarvesters = Cache.getCreepsByRole(
        room,
        "harvester",
      ).filter((c) => c.memory.sourceId === source.id);
      const totalWorkParts = existingHarvesters.reduce(
        (sum, c) => sum + c.getActiveBodyparts(WORK),
        0,
      );

      // If we have enough work parts (>=5), we only need 1 creep slot.
      // Otherwise, we might allow more if spots are available (handled by PopulationManager, but task also needs to allow it)
      // Actually, Task.maxCreeps should match PopulationManager.calculateTargets desired count?
      // Or simply: Task maxCreeps is the capacity of the task.
      // If spots > 1, we can have multiple harvesters.
      // BUT if 1 harvester is enough, we shouldn't assign 2.

      let maxCreeps = 1;
      // Allow more if total work is low (e.g. < 5) AND spots are available
      // But we need to check spots again here? Or just trust GlobalDispatch?
      // GlobalDispatch assigns based on maxCreeps.

      if (totalWorkParts < 5) {
        // If current work is insufficient, allow more creeps (up to spots)
        // We can't easily get spots here without recalculating or caching.
        // Let's assume max 2 for recovery if work is low.
        // However, if we set maxCreeps=2, Dispatch might assign a second one even if PopulationManager says we only need 1 (because target is met).
        // Wait, Dispatch only assigns existing creeps.
        // PopulationManager handles spawning.
        // So if PopulationManager says "we need 2 harvesters", it spawns 2.
        // Dispatch needs to allow 2 people to work on the task.

        // So:
        // 1. If we have 5+ WORK, maxCreeps = 1.
        // 2. If we have < 5 WORK, maxCreeps = spots (or 2+).

        // Let's use a safe upper bound.
        // If we restrict maxCreeps to 1, but we spawned 2 small ones, the second one will be idle!
        // So maxCreeps MUST be >= current population count for this source.
        maxCreeps = Math.max(1, existingHarvesters.length);

        // Also allow room for a new one if needed?
        // If existing < target, we need to allow more assignments.
        // But Dispatch assigns *idle* creeps.
        // If we spawned a new one, it will be idle.
        // So maxCreeps should be at least target count.

        // Simplified:
        // Just set maxCreeps to available spots.
        // The constraint is in SP-AWNING (PopulationManager).
        // If we only spawn 1, only 1 will be assigned.
        // If we spawn 2, 2 will be assigned.
        // This avoids the "idle harvester" problem.

        // Getting spots count:
        const terrain = room.getTerrain();
        let spots = 0;
        for (let x = -1; x <= 1; x++) {
          for (let y = -1; y <= 1; y++) {
            if (x === 0 && y === 0) continue;
            if (
              terrain.get(source.pos.x + x, source.pos.y + y) !==
              TERRAIN_MASK_WALL
            ) {
              spots++;
            }
          }
        }
        maxCreeps = spots;
      } else {
        // If we have 5+ WORK, we strictly only want 1 active miner.
        // But if we are replacing it (Lifecycle), we might have 2 briefly?
        // Lifecycle replacement creates a new creep. The old one is still working.
        // We want the new one to take over.
        // If maxCreeps=1, new one can't assign until old one dies or unassigns.
        // This is fine. Old one works until death.
        maxCreeps = 1;
      }

      GlobalDispatch.registerTask({
        id: taskId,
        type: TaskType.HARVEST,
        priority: TaskPriority.NORMAL,
        targetId: source.id,
        pos: source.pos,
        maxCreeps: maxCreeps, // Dynamic limit
        creepsAssigned: [], // Managed by Dispatch
        requirements: {
          bodyParts: [WORK],
        },
        validRoles: ["harvester"],
        sticky: true, // [NEW] Harvesters should stay on task
        estimatedDuration: 1500, // Effectively infinite
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY },
      });
    });
  }

  private static generateTransportTasks(room: Room) {
    // 1. From Containers to Spawn/Extension/Storage
    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];

    containers.forEach((container) => {
      // Predictive Analysis
      const energy = container.store[RESOURCE_ENERGY];
      const capacity = container.store.getCapacity();
      const fillRate = 10; // Assume 10/tick from a 5-WORK miner
      const ticksToFull = (capacity - energy) / fillRate;

      // [Optimization] Dynamic Priority based on Energy Amount
      let priority = TaskPriority.LOW;
      if (energy > 1500)
        priority = TaskPriority.HIGH; // Almost full -> Urgent
      else if (energy > 1000) priority = TaskPriority.NORMAL; // Good amount
      // < 1000 remains LOW

      // Early dispatch if filling up fast
      if (ticksToFull < 50 && energy > 500) {
        priority = Math.min(priority, TaskPriority.HIGH); // Boost priority
      }

      if (energy < 100 && ticksToFull > 100) return; // Don't bother yet

      const taskId = `TRANS_${container.id}`;
      GlobalDispatch.registerTask({
        id: taskId,
        type: TaskType.PICKUP, // Or TRANSFER logic
        priority: priority,
        targetId: container.id,
        pos: container.pos,
        maxCreeps: energy > 1500 ? 3 : 1, // Allow more haulers for rich containers
        creepsAssigned: [],
        requirements: {
          bodyParts: [CARRY],
          minCapacity: 50,
        },
        validRoles: ["hauler"],
        estimatedDuration: 50,
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY, amount: energy }, // [NEW] Pass amount for sorting
      });
    });

    // ... (Dropped Resources logic) ...
    const dropped = room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 100,
    });

    dropped.forEach((res) => {
      const taskId = `PICKUP_${res.id}`;
      GlobalDispatch.registerTask({
        id: taskId,
        type: TaskType.PICKUP,
        priority: TaskPriority.HIGH,
        validRoles: ["hauler"],
        targetId: res.id,
        pos: res.pos,
        maxCreeps: 1,
        creepsAssigned: [],
        requirements: {
          bodyParts: [CARRY],
        },
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY, amount: res.amount },
      });
    });
  }

  // [NEW] Active Delivery Logic
  // Generate tasks for Haulers to deliver energy to Upgraders/Builders
  private static generateActiveDeliveryTasks(room: Room) {
    // Only run if we have surplus energy (avoid starving Spawn)
    // [FIX] Relax constraints. If room has decent energy (300+), active delivery is fine.
    // Especially if workers are asking for it.
    // If we are in CRITICAL, we might still want to deliver to Builder if it's fixing critical structure.
    if (
      room.energyAvailable < 300 &&
      room.energyAvailable < room.energyCapacityAvailable * 0.5
    )
      return;

    // Find hungry workers
    const workers = room.find(FIND_MY_CREEPS, {
      filter: (c) =>
        (c.memory.role === "upgrader" || c.memory.role === "builder") &&
        c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        (c.memory.working || c.memory.requestingEnergy), // Feed if working OR requesting
    });

    workers.forEach((worker) => {
      // Check if worker is low on energy
      // [FIX] If requestingEnergy flag is set, ALWAYS deliver regardless of ratio
      // Otherwise use ratio.
      const isRequesting = worker.memory.requestingEnergy;
      const energyRatio =
        worker.store.getUsedCapacity(RESOURCE_ENERGY) /
        worker.store.getCapacity(RESOURCE_ENERGY);

      if (!isRequesting && energyRatio > 0.5) return; // Still has enough

      const taskId = `DELIVER_${worker.id}`;

      // Priority logic
      // Upgrader near downgrade: CRITICAL
      // Builder on critical structure: HIGH
      // Requesting Energy: HIGH (User interaction)
      let priority = TaskPriority.NORMAL;

      if (isRequesting) priority = TaskPriority.HIGH;

      if (
        worker.memory.role === "upgrader" &&
        room.controller.ticksToDowngrade < 4000
      )
        priority = TaskPriority.HIGH;

      GlobalDispatch.registerTask({
        id: taskId,
        type: TaskType.TRANSFER, // Hauler transfers TO worker
        priority: priority,
        targetId: worker.id,
        pos: worker.pos,
        maxCreeps: 1,
        creepsAssigned: [],
        requirements: {
          bodyParts: [CARRY],
        },
        validRoles: ["hauler"],
        estimatedDuration: 20,
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY },
      });
    });
  }

  private static generateBuildTasks(room: Room) {
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    const level = EnergyManager.getLevel(room);
    const budget = EnergyManager.getBudget(room, "builder");

    // In CRITICAL or HIGH crisis, restrict road building unless rich
    const canBuildRoads = level <= CrisisLevel.MEDIUM;

    sites.forEach((site) => {
      // Skip non-critical construction in critical energy mode
      if (level === CrisisLevel.CRITICAL) {
        if (
          site.structureType !== STRUCTURE_SPAWN &&
          site.structureType !== STRUCTURE_EXTENSION &&
          site.structureType !== STRUCTURE_TOWER &&
          site.structureType !== STRUCTURE_CONTAINER &&
          site.structureType !== STRUCTURE_STORAGE
        ) {
          return;
        }
      }

      // Skip roads if not rich enough
      if (site.structureType === STRUCTURE_ROAD && !canBuildRoads) {
        return;
      }

      const taskId = `BUILD_${site.id}`;
      // Determine priority based on structure type
      let priority = TaskPriority.NORMAL;
      let maxCreeps = 3;

      if (
        site.structureType === STRUCTURE_SPAWN ||
        site.structureType === STRUCTURE_EXTENSION ||
        site.structureType === STRUCTURE_TOWER // [Recovery] Towers are critical
      ) {
        priority = TaskPriority.HIGH;
        maxCreeps = 5;
      } else if (
        site.structureType === STRUCTURE_CONTAINER ||
        site.structureType === STRUCTURE_STORAGE
      ) {
        priority = TaskPriority.HIGH; // [Recovery] Logistics are critical
        maxCreeps = 3;
      } else if (
        site.structureType === STRUCTURE_RAMPART ||
        site.structureType === STRUCTURE_WALL
      ) {
        priority = TaskPriority.LOW;
        maxCreeps = level >= CrisisLevel.HIGH ? 1 : 2; // Limit wall building when saving energy
      } else if (site.structureType === STRUCTURE_ROAD) {
        priority = TaskPriority.LOW;
        maxCreeps = 1;
      }

      // Apply Budget Cap (Soft cap per task, but also affects total builder count in population)
      if (budget === 0 && priority !== TaskPriority.HIGH) {
        // If budget is 0, only allow high priority tasks (spawn/ext)
        return;
      }

      GlobalDispatch.registerTask({
        id: taskId,
        type: TaskType.BUILD,
        priority: priority,
        targetId: site.id,
        pos: site.pos,
        maxCreeps: maxCreeps,
        creepsAssigned: [],
        requirements: {
          bodyParts: [WORK, CARRY],
        },
        validRoles: ["builder", "repairer"],
        estimatedDuration: Math.min(site.progressTotal - site.progress, 500), // Estimate based on remaining work
        creationTime: Game.time,
        data: {},
      });
    });
  }

  private static generateUpgradeTasks(room: Room) {
    if (!room.controller) return;

    const taskId = `UPGRADE_${room.name}`;
    const level = EnergyManager.getLevel(room);

    // Default: Normal upgrade
    let priority = TaskPriority.NORMAL;
    let maxCreeps = 3; // Default
    let sticky = true;

    // Logic:
    // 1. If downgrading soon -> CRITICAL, ignore energy limits
    if (room.controller.ticksToDowngrade < 4000) {
      priority = TaskPriority.CRITICAL;
      maxCreeps = 1; // Just one to save it
    }
    // 2. Crisis Logic
    else if (level === CrisisLevel.CRITICAL) {
      // In critical, only upgrade if downgrade is imminent (handled above)
      // Otherwise, return (no task)
      return;
    } else if (level === CrisisLevel.HIGH) {
      priority = TaskPriority.LOW;
      maxCreeps = 1;
      sticky = false;
    } else if (level === CrisisLevel.MEDIUM) {
      maxCreeps = 2;
    } else {
      // LOW or NONE
      maxCreeps = 5; // Boost
    }

    // Override maxCreeps using Budget (convert budget to creep count roughly)
    // EnergyManager returns Budget in "Work Parts" or similar abstract unit?
    // Actually in config it's just a number. Let's interpret it as max creeps for simplicity in Task context.
    // Or we can say Budget = Max Creeps.
    const budget = EnergyManager.getBudget(room, "upgrader");
    // If budget is in WORK parts (e.g. 50), and creep has 5 WORK, then count = 10.
    // But config says: 1-5 range mostly. So let's treat it as Max Creeps count for now or Work Parts limit?
    // Looking at config: RCL 8 Budget NONE = 15. A creep can have 15 WORK. So it's WORK parts?
    // Wait, RCL 8 Budget NONE = 15 (Work parts per tick?).
    // RCL 1 Budget NONE = 5.
    // Let's assume the budget is "Number of Work Parts".
    // Since we don't know creep size here easily, let's map it to creep count heuristically.
    // 1 Creep ~= 5 WORK (RCL 3+).
    // So maxCreeps = Math.ceil(budget / 5).

    // For simplicity, let's just use the budget number as a scaler for maxCreeps.
    // If budget is small (<= 5), maxCreeps = 1.
    // If budget is large, maxCreeps = budget / 5.

    // Actually, let's just use the previous logic for maxCreeps but cap it.

    GlobalDispatch.registerTask({
      id: taskId,
      type: TaskType.UPGRADE,
      priority: priority,
      targetId: room.controller.id,
      pos: room.controller.pos,
      maxCreeps: maxCreeps, // Configurable
      creepsAssigned: [],
      requirements: {
        bodyParts: [WORK, CARRY],
      },
      validRoles: ["upgrader"],
      sticky: sticky,
      creationTime: Game.time,
      data: {},
    });
  }
}
