const roleHarvester = {
  /** @param {Creep} creep **/
  run: function (creep) {
    if (creep.store.getFreeCapacity() > 0) {
      // 如果没有分配 sourceId，则寻找并分配
      if (!creep.memory.sourceId) {
        const sources = creep.room.find(FIND_SOURCES);
        if (sources.length > 0) {
          // 简单的分配策略：根据 creep 名字哈希分配，确保均匀
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
        // 如果找不到 source (可能是 id 变了或者视野问题)，清除 memory 让它重新找
        delete creep.memory.sourceId;
      }
    } else {
      const targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return (
            (structure.structureType == STRUCTURE_EXTENSION ||
              structure.structureType == STRUCTURE_SPAWN) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          );
        },
      });
      if (targets.length > 0) {
        if (creep.transfer(targets[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(targets[0], {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        // 如果 Spawn 满了，就在 Spawn 附近待命，避免挡路
        // 或者可以暂时去升级控制器（可选）
        if (
          creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(creep.room.controller, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      }
    }
  },
};

module.exports = roleHarvester;
