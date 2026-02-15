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
      let target: Structure | null = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      });

      if (!target) {
          target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (s) =>
              s.structureType === STRUCTURE_TOWER &&
              s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
          });
      }

      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
            (s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0 ||
              (creep.room.controller && s.pos.inRangeTo(creep.room.controller, 3))),
        });
      }

      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { reusePath: 10 });
        }
      }
    }
  },
};
