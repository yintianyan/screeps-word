const moveModule = require("module.move");

const roleBuilder = {
  /** @param {Creep} creep **/
  run: function (creep) {
    if (creep.memory.building && creep.store[RESOURCE_ENERGY] == 0) {
      creep.memory.building = false;
      creep.say("🔄 harvest");
    }
    if (!creep.memory.building && creep.store.getFreeCapacity() == 0) {
      creep.memory.building = true;
      creep.say("🚧 build");
    }

    if (creep.memory.building) {
      // 1. 优先维修：如果路上有损坏严重的建筑（耐久 < 50%），优先维修
      // 特别是 Container 和 Road
      const repairTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (object) =>
          (object.structureType === STRUCTURE_CONTAINER ||
            object.structureType === STRUCTURE_ROAD) &&
          object.hits < object.hitsMax * 0.5,
      });

      // 按损坏程度排序，优先修最烂的
      repairTargets.sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax);

      if (repairTargets.length > 0) {
        if (creep.repair(repairTargets[0]) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, repairTargets[0], {
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
        return; // 如果在维修，就不去建造了
      }

      // 2. 其次建造
      const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
      if (targets.length) {
        // 优先建造 Container (关键！确保矿区和Controller附近的Container被优先建造)
        // 其次 Extension
        const containers = targets.filter(s => s.structureType === STRUCTURE_CONTAINER);
        const extensions = targets.filter(s => s.structureType === STRUCTURE_EXTENSION);
        
        let target = null;
        if (containers.length > 0) {
            target = creep.pos.findClosestByPath(containers);
        } else if (extensions.length > 0) {
            target = creep.pos.findClosestByPath(extensions);
        } else {
            target = targets[0]; // 其他建筑 (Road, Tower, etc.)
        }

        if (creep.build(target) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        // 如果没有建筑工地，去升级控制器，避免闲置
        if (
          creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, creep.room.controller, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      }
    } else {
      // 1. 优先从 Storage 取能量
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

      // 2. 其次从任意有能量的 Container 取能量
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

      // 3. 捡地上的能量
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

      // 4. 只有在没有任何 Harvester 的紧急情况下，才允许自己去挖矿
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
        // 待命
      }
    }
  },
};

module.exports = roleBuilder;
