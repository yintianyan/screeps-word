const moveModule = require("module.move");

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
        // 尝试寻找该 source 附近的 Container
        const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        const container = containers.length > 0 ? containers[0] : null;

        // 如果有 Container，就站在 Container 上挖
        if (container) {
          if (!creep.pos.isEqualTo(container.pos)) {
            moveModule.smartMove(creep, container, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          } else {
            creep.harvest(source);
          }
        } else {
          // 没有 Container，就正常走过去挖
          if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, source, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        }
      } else {
        // 如果找不到 source (可能是 id 变了或者视野问题)，清除 memory 让它重新找
        delete creep.memory.sourceId;
      }
    } else {
      // 优先把能量传给附近的 Hauler
      const nearbyHauler = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (c) =>
          c.memory.role === "hauler" && c.store.getFreeCapacity() > 0,
      })[0];

      if (nearbyHauler) {
        creep.transfer(nearbyHauler, RESOURCE_ENERGY);
        return;
      }

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
          moveModule.smartMove(creep, targets[0], {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        // 检查 Spawn 是否正在孵化，或者是否需要孵化（人口不足）
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        const populationModule = require('module.population');
        const currentTargets = populationModule.calculateTargets(creep.room);
        const currentCreeps = creep.room.find(FIND_MY_CREEPS);
        
        let needsSpawning = false;
        if (spawn && spawn.spawning) {
            needsSpawning = true;
        } else {
            // 简单估算：如果现有 Creep 总数 < 目标总数，说明可能需要孵化
            const totalTarget = Object.values(currentTargets).reduce((a, b) => a + b, 0);
            if (currentCreeps.length < totalTarget) {
                needsSpawning = true;
            }
        }

        if (needsSpawning && spawn) {
            // 如果需要孵化，就在 Spawn 附近待命 (距离 3 格，避免堵路)
            if (!creep.pos.inRangeTo(spawn, 3)) {
                moveModule.smartMove(creep, spawn, {range: 3, visualizePathStyle: {stroke: '#00ffff'}});
            }
            return; // 待命，不做其他事
        }

        // 如果 Spawn 满了，就在 Spawn 附近待命，避免挡路
        // 或者可以暂时去升级控制器（可选）
        if (
          creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, creep.room.controller, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      }
    }
  },
};

module.exports = roleHarvester;
