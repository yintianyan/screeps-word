import { GlobalDispatch } from "../../ai/GlobalDispatch";

import StructureCache from "../../utils/structureCache";

export default {
  run: function (creep: Creep) {
    const task = GlobalDispatch.getAssignedTask(creep);
    if (!task || !task.data) return;

    const { targetRoom, homeRoom, sourceId } = task.data;

    if (creep.store.getFreeCapacity() > 0) {
      // GATHER STATE
      if (creep.room.name !== targetRoom) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom));
        return;
      }

      // Find energy
      // 1. Dropped
      const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES);
      if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          creep.moveTo(dropped);
        }
        return;
      }

      // 2. Container
      const source = Game.getObjectById(sourceId as Id<Source>);
      if (source) {
        const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
        })[0] as StructureContainer;

        if (container) {
          if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 10 });
          }
          return;
        }
      }

      // Idle near source if waiting for miner
      if (source) {
        if (!creep.pos.inRangeTo(source, 3)) {
          creep.moveTo(source, { reusePath: 10 });
        }
      }
    } else {
      // DELIVER STATE
      if (creep.room.name !== homeRoom) {
        creep.moveTo(new RoomPosition(25, 25, homeRoom), { reusePath: 50 });
        return;
      }

      // Deposit to Spawn/Extension first, then Storage
      // [Optimization] Use StructureCache
      const spawns = StructureCache.getMyStructures(
        creep.room,
        STRUCTURE_SPAWN,
      ) as StructureSpawn[];
      const extensions = StructureCache.getMyStructures(
        creep.room,
        STRUCTURE_EXTENSION,
      ) as StructureExtension[];

      const targets = [...spawns, ...extensions].filter(
        (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );

      let target: Structure | null | undefined =
        creep.pos.findClosestByRange(targets);

      if (!target) {
        const towers = StructureCache.getMyStructures(
          creep.room,
          STRUCTURE_TOWER,
        ) as StructureTower[];
        const towerTargets = towers.filter(
          (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        );
        target = creep.pos.findClosestByRange(towerTargets);
      }

      if (!target) {
        target = creep.room.storage;
      }

      if (!target) {
        // Find containers near spawn/controller
        const containers = StructureCache.getStructures(
          creep.room,
          STRUCTURE_CONTAINER,
        ) as StructureContainer[];
        const validContainers = containers.filter(
          (s) =>
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
            (s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0 ||
              (creep.room.controller &&
                s.pos.inRangeTo(creep.room.controller, 3))),
        );
        target = creep.pos.findClosestByRange(validContainers);
      }

      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { reusePath: 10 });
        }
      }
    }
  },
};
