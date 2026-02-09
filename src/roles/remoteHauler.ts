import { GlobalDispatch } from "../ai/GlobalDispatch";

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
      const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES);
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
            creep.moveTo(container);
          }
          return;
        }
      }

      // Idle near source if waiting for miner
      if (source) {
        if (!creep.pos.inRangeTo(source, 3)) {
          creep.moveTo(source);
        }
      }
    } else {
      // DELIVER STATE
      if (creep.room.name !== homeRoom) {
        creep.moveTo(new RoomPosition(25, 25, homeRoom));
        return;
      }

      // Deposit to Storage -> Extension -> Spawn
      const targets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => {
          return (
            (s.structureType === STRUCTURE_STORAGE ||
              s.structureType === STRUCTURE_EXTENSION ||
              s.structureType === STRUCTURE_SPAWN) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          );
        },
      });

      // Prioritize: Extension/Spawn > Storage
      targets.sort((a, b) => {
        const priorityA =
          a.structureType === STRUCTURE_EXTENSION ||
          a.structureType === STRUCTURE_SPAWN
            ? 10
            : 0;
        const priorityB =
          b.structureType === STRUCTURE_EXTENSION ||
          b.structureType === STRUCTURE_SPAWN
            ? 10
            : 0;
        return priorityB - priorityA;
      });

      if (targets.length > 0) {
        if (creep.transfer(targets[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targets[0]);
        }
      }
    }
  },
};
