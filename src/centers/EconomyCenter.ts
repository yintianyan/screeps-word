import { GlobalDispatch } from "../ai/GlobalDispatch";
import { Task, TaskPriority, TaskType } from "../types/dispatch";
import priorityModule from "../config/priority";
import Cache from "../components/memoryManager";

export class EconomyCenter {
  static run(room: Room) {
    if (Game.time % 10 !== 0) return; // Run every 10 ticks

    this.generateHarvestTasks(room);
    this.generateTransportTasks(room);
    this.generateBuildTasks(room);
    this.generateUpgradeTasks(room);
  }

  // ... (generateHarvestTasks and generateTransportTasks remain unchanged) ...

  private static generateHarvestTasks(room: Room) {
    const sources = room.find(FIND_SOURCES);
    sources.forEach((source) => {
      const taskId = `HARVEST_${source.id}`;
      // Basic task: Harvest energy
      GlobalDispatch.registerTask({
        id: taskId,
        type: "HARVEST",
        priority: TaskPriority.NORMAL,
        targetId: source.id,
        pos: source.pos,
        maxCreeps: 1, // Usually 1 per source if static mining
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

      let priority = TaskPriority.LOW;
      if (energy > 1500) priority = TaskPriority.HIGH;
      else if (energy > 800) priority = TaskPriority.NORMAL;

      // Early dispatch if filling up fast
      if (ticksToFull < 50 && energy > 500) {
        priority = Math.min(priority, TaskPriority.HIGH); // Boost priority
      }

      if (energy < 100 && ticksToFull > 100) return; // Don't bother yet

      const taskId = `TRANS_${container.id}`;
      GlobalDispatch.registerTask({
        id: taskId,
        type: "PICKUP", // Or TRANSFER logic
        priority: priority,
        targetId: container.id,
        pos: container.pos,
        maxCreeps: energy > 1500 ? 2 : 1,
        creepsAssigned: [],
        requirements: {
          bodyParts: [CARRY],
          minCapacity: 50,
        },
        validRoles: ["hauler"],
        estimatedDuration: 50,
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY },
      });
    });

    // 2. Dropped Resources
    const dropped = room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 100,
    });

    dropped.forEach((res) => {
      const taskId = `PICKUP_${res.id}`;
      GlobalDispatch.registerTask({
        id: taskId,
        type: "PICKUP",
        priority: TaskPriority.HIGH,
        targetId: res.id,
        pos: res.pos,
        maxCreeps: 1,
        creepsAssigned: [],
        requirements: {
          bodyParts: [CARRY],
        },
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY },
      });
    });
  }

  private static generateBuildTasks(room: Room) {
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);

    // [Reserve Logic]
    // Calculate total energy (Spawn + Containers)
    const containers = Cache.getStructures(
      room,
      STRUCTURE_CONTAINER,
    ) as StructureContainer[];
    const containerEnergy = containers.reduce(
      (sum, c) => sum + c.store[RESOURCE_ENERGY],
      0,
    );
    const storedEnergy =
      (room.storage
        ? room.storage.store[RESOURCE_ENERGY]
        : room.energyAvailable) + containerEnergy;

    // Adjusted Thresholds for RCL 3
    // Critical: Less than 1000 total reserve (Spawn is ~500-800)
    const isCriticalEnergy = storedEnergy < 1000;
    // Reserve Mode: If no storage, treat low container level as reserve mode
    // RCL 3 cap is ~2000 per container * 2 = 4000.
    const isReserveMode =
      (room.storage && storedEnergy < 50000) ||
      (!room.storage && storedEnergy < 2000);

    // [NEW] Road Construction Threshold
    // Only build roads if we have significant surplus (e.g. > 80% full containers or Storage)
    const canBuildRoads =
      (room.storage && storedEnergy > 50000) ||
      (!room.storage && storedEnergy > 3000);

    sites.forEach((site) => {
      // Skip non-critical construction in critical energy mode
      if (isCriticalEnergy) {
        if (
          site.structureType !== STRUCTURE_SPAWN &&
          site.structureType !== STRUCTURE_EXTENSION &&
          site.structureType !== STRUCTURE_TOWER &&
          site.structureType !== STRUCTURE_CONTAINER
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
        maxCreeps = isReserveMode ? 1 : 2; // Limit wall building when saving energy
      } else if (site.structureType === STRUCTURE_ROAD) {
        priority = TaskPriority.LOW;
        maxCreeps = 1;
      }

      GlobalDispatch.registerTask({
        id: taskId,
        type: "BUILD",
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

    // [Reserve Logic]
    // Calculate total energy (Spawn + Containers)
    const containers = Cache.getStructures(
      room,
      STRUCTURE_CONTAINER,
    ) as StructureContainer[];
    const containerEnergy = containers.reduce(
      (sum, c) => sum + c.store[RESOURCE_ENERGY],
      0,
    );
    const storedEnergy =
      (room.storage
        ? room.storage.store[RESOURCE_ENERGY]
        : room.energyAvailable) + containerEnergy;

    // Adjusted Thresholds
    const isEmergency = storedEnergy < 1000; // Very low
    const isReserveMode =
      (room.storage && storedEnergy < 50000) ||
      (!room.storage && storedEnergy < 2000);

    // Default: Normal upgrade
    let priority = TaskPriority.NORMAL;
    let maxCreeps = 3;
    let sticky = true;

    // Logic:
    // 1. If downgrading soon -> CRITICAL, ignore energy limits
    if (room.controller.ticksToDowngrade < 4000) {
      priority = TaskPriority.CRITICAL;
      maxCreeps = 1; // Just one to save it
    }
    // 2. If Emergency (<1k total) -> Stop upgrading unless downgrading
    else if (isEmergency) {
      return;
    }
    // 3. If Reserve Mode -> Limit to 1 upgrader, Lower Priority
    else if (isReserveMode) {
      priority = TaskPriority.LOW;
      maxCreeps = 1;
      sticky = false; // Allow reassignment to better tasks
    }
    // 4. If Rich (>100k or full containers) -> Boost
    else if (storedEnergy > 100000 || (!room.storage && storedEnergy > 3500)) {
      maxCreeps = 5;
    }

    GlobalDispatch.registerTask({
      id: taskId,
      type: "UPGRADE",
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
