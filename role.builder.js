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
          creep.moveTo(repairTargets[0], {
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
        return; // 如果在维修，就不去建造了
      }

      // 2. 其次建造
      const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
      if (targets.length) {
        // 优先建造 Extension 和 Container
        const criticalTargets = targets.filter(
          (s) =>
            s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_CONTAINER,
        );
        const target =
          criticalTargets.length > 0 ? criticalTargets[0] : targets[0];

        if (creep.build(target) == ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        // 如果没有建筑工地，去升级控制器，避免闲置
        if (
          creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(creep.room.controller, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      }
    } else {
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
          creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      } else {
        delete creep.memory.sourceId;
      }
    }
  },
};

module.exports = roleBuilder;
