const moveModule = require("module.move");

const roleUpgrader = {
  /** @param {Creep} creep **/
  run: function (creep) {
    if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] == 0) {
      creep.memory.upgrading = false;
      creep.say("🔄 harvest");
    }
    if (!creep.memory.upgrading && creep.store.getFreeCapacity() == 0) {
      creep.memory.upgrading = true;
      creep.say("⚡ upgrade");
    }

    if (creep.memory.upgrading) {
      if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
        moveModule.smartMove(creep, creep.room.controller, {
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    } else {
      // 1. 优先从 Controller Container 取能量 (距离 Controller Range 3 以内的 Container)
      const controllerContainer = creep.room.controller.pos.findInRange(
        FIND_STRUCTURES,
        3,
        {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
        },
      )[0];

      if (controllerContainer) {
        if (
          creep.withdraw(controllerContainer, RESOURCE_ENERGY) ==
          ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, controllerContainer, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 2. 其次从 Storage 取能量
      if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
        if (
          creep.withdraw(creep.room.storage, RESOURCE_ENERGY) ==
          ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, creep.room.storage, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 3. 再次从任意有能量的 Container 取能量
      const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      });
      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, container, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 4. 捡地上的能量
      const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY,
      });
      if (dropped) {
        if (creep.pickup(dropped) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, dropped, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 5. 只有在没有任何 Harvester 的紧急情况下，才允许自己去挖矿
      const harvesters = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "harvester",
      });
      if (harvesters.length === 0) {
        if (!creep.memory.sourceId) {
          const sources = creep.room.find(FIND_SOURCES);
          if (sources.length > 0) {
            const hash = creep.name
              .split("")
              .reduce((sum, char) => sum + char.charCodeAt(0), 0);
            const source = sources[hash % sources.length];
            creep.memory.sourceId = source.id;
          }
        }
        const source = Game.getObjectById(creep.memory.sourceId);
        if (source) {
          if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, source, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        } else {
          delete creep.memory.sourceId;
        }
      } else {
        // 有 Harvester 但没能量取，就待命，不要去堵路
        // 可以选择往 Spawn 靠拢，或者就在原地
      }
    }
  },
};

module.exports = roleUpgrader;
