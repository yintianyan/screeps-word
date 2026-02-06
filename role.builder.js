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
      const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
      if (targets.length) {
        if (creep.build(targets[0]) == ERR_NOT_IN_RANGE) {
          creep.moveTo(targets[0], {
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
