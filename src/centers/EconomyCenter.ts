
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
    sources.forEach(source => {
      const taskId = `HARVEST_${source.id}`;
      // Basic task: Harvest energy
      GlobalDispatch.registerTask({
        id: taskId,
        type: 'HARVEST',
        priority: TaskPriority.NORMAL,
        targetId: source.id,
        pos: source.pos,
        maxCreeps: 1, // Usually 1 per source if static mining
        creepsAssigned: [], // Managed by Dispatch
        requirements: {
          bodyParts: [WORK]
        },
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY }
      });
    });
  }

  private static generateTransportTasks(room: Room) {
    // 1. From Containers to Spawn/Extension/Storage
    const containers = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 100
    });

    containers.forEach(container => {
      const taskId = `TRANS_${container.id}`;
      GlobalDispatch.registerTask({
        id: taskId,
        type: 'PICKUP', // Or TRANSFER logic
        priority: TaskPriority.HIGH,
        targetId: container.id,
        pos: container.pos,
        maxCreeps: 2,
        creepsAssigned: [],
        requirements: {
            bodyParts: [CARRY],
            minCapacity: 50
        },
        creationTime: Game.time,
        data: { resource: RESOURCE_ENERGY }
      });
    });

    // 2. Dropped Resources
    const dropped = room.find(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 100
    });
    
    dropped.forEach(res => {
        const taskId = `PICKUP_${res.id}`;
        GlobalDispatch.registerTask({
            id: taskId,
            type: 'PICKUP',
            priority: TaskPriority.HIGH,
            targetId: res.id,
            pos: res.pos,
            maxCreeps: 1,
            creepsAssigned: [],
            requirements: {
                bodyParts: [CARRY]
            },
            creationTime: Game.time,
            data: { resource: RESOURCE_ENERGY }
        });
    });
  }

  private static generateBuildTasks(room: Room) {
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    sites.forEach(site => {
        const taskId = `BUILD_${site.id}`;
        // Determine priority based on structure type
        let priority = TaskPriority.NORMAL;
        if (site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_EXTENSION) {
            priority = TaskPriority.HIGH;
        }

        GlobalDispatch.registerTask({
            id: taskId,
            type: 'BUILD',
            priority: priority,
            targetId: site.id,
            pos: site.pos,
            maxCreeps: 3,
            creepsAssigned: [],
            requirements: {
                bodyParts: [WORK, CARRY]
            },
            creationTime: Game.time,
            data: {}
        });
    });
  }

  private static generateUpgradeTasks(room: Room) {
    if (!room.controller) return;
    
    const taskId = `UPGRADE_${room.name}`;
    // Always need upgrading
    GlobalDispatch.registerTask({
        id: taskId,
        type: 'UPGRADE',
        priority: TaskPriority.NORMAL,
        targetId: room.controller.id,
        pos: room.controller.pos,
        maxCreeps: 5, // Configurable
        creepsAssigned: [],
        requirements: {
            bodyParts: [WORK, CARRY]
        },
        creationTime: Game.time,
        data: {}
    });
  }
}
