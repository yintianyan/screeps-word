import { GlobalDispatch } from "../ai/GlobalDispatch";
import { Task, TaskPriority, TaskType } from "../types/dispatch";
import priorityModule from "../config/priority";

export class EconomyCenter {
  static run(room: Room) {
    if (Game.time % 10 !== 0) return; // Run every 10 ticks

    this.generateHarvestTasks(room);
    this.generateTransportTasks(room);
    this.generateBuildTasks(room);
    this.generateUpgradeTasks(room);
  }

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
    sites.forEach((site) => {
      const taskId = `BUILD_${site.id}`;
      // Determine priority based on structure type
      let priority = TaskPriority.NORMAL;
      if (
        site.structureType === STRUCTURE_SPAWN ||
        site.structureType === STRUCTURE_EXTENSION
      ) {
        priority = TaskPriority.HIGH;
      }

      GlobalDispatch.registerTask({
        id: taskId,
        type: "BUILD",
        priority: priority,
        targetId: site.id,
        pos: site.pos,
        maxCreeps: 3,
        creepsAssigned: [],
        requirements: {
          bodyParts: [WORK, CARRY],
        },
        creationTime: Game.time,
        data: {},
      });
    });
  }

  private static generateUpgradeTasks(room: Room) {
    if (!room.controller) return;

    const taskId = `UPGRADE_${room.name}`;
    // Always need upgrading
    GlobalDispatch.registerTask({
      id: taskId,
      type: "UPGRADE",
      priority: TaskPriority.NORMAL,
      targetId: room.controller.id,
      pos: room.controller.pos,
      maxCreeps: 5, // Configurable
      creepsAssigned: [],
      requirements: {
        bodyParts: [WORK, CARRY],
      },
      creationTime: Game.time,
      data: {},
    });
  }
}
