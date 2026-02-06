const moveModule = require("module.move");

const roleHarvester = {
  /** @param {Creep} creep **/
  run: function (creep) {
    // 0. 初始化/分配 Source
    if (!creep.memory.sourceId) {
      const sources = creep.room.find(FIND_SOURCES);
      const harvesters = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "harvester" && c.memory.sourceId,
      });

      const counts = {};
      sources.forEach((s) => (counts[s.id] = 0));
      harvesters.forEach((c) => {
        if (counts[c.memory.sourceId] !== undefined) {
          counts[c.memory.sourceId]++;
        }
      });

      let bestSource = sources[0];
      let minCount = 999;

      sources.forEach((s) => {
        if (counts[s.id] < minCount) {
          minCount = counts[s.id];
          bestSource = s;
        }
      });

      creep.memory.sourceId = bestSource.id;
    }

    const source = Game.getObjectById(creep.memory.sourceId);
    if (!source) {
        delete creep.memory.sourceId; // Source 不存在（没视野？），重置
        return;
    }

    // 1. 检查模式：是否有 Hauler
    const haulers = creep.room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "hauler",
    });

    if (haulers.length > 0) {
        // === 静态挖掘模式 (Static Mining) ===
        // 目标：始终待在 Source/Container 旁边，不停地 harvest()
        // 即使背包满了，harvest() 也会导致能量掉落在地上或进入 Container

        // 尝试寻找该 source 附近的 Container
        const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        const container = containers.length > 0 ? containers[0] : null;

        if (container) {
            // 如果有 Container，必须站在 Container 上
            if (!creep.pos.isEqualTo(container.pos)) {
                moveModule.smartMove(creep, container, { visualizePathStyle: { stroke: "#ffaa00" } });
            } else {
                creep.harvest(source);
            }
        } else {
            // 如果没有 Container，站在 Source 旁边即可
            if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
                moveModule.smartMove(creep, source, { visualizePathStyle: { stroke: "#ffaa00" } });
            }
        }
        
        // 顺手把能量给身边的 Hauler (如果正好贴着)
        // 只有当背包快满时才做，避免每 tick 都尝试
        if (creep.store.getFreeCapacity() < 10) {
             const nearbyHauler = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
                filter: (c) => c.memory.role === "hauler" && c.store.getFreeCapacity() > 0,
             })[0];
             if (nearbyHauler) {
                 creep.transfer(nearbyHauler, RESOURCE_ENERGY);
             }
        }
        
    } else {
        // === 传统模式 (Carry Mining) ===
        // 没有 Hauler，自己挖自己运
        if (creep.store.getFreeCapacity() > 0) {
            // 还有空位，去挖矿
            if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
                moveModule.smartMove(creep, source, { visualizePathStyle: { stroke: "#ffaa00" } });
            }
        } else {
            // 满了，去送货
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
                    moveModule.smartMove(creep, targets[0], { visualizePathStyle: { stroke: "#ffffff" } });
                }
            } else {
                // 如果都满了
                // 1. 检查是否需要孵化 (Wait near Spawn)
                const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                const populationModule = require("module.population");
                const currentTargets = populationModule.calculateTargets(creep.room);
                const currentCreeps = creep.room.find(FIND_MY_CREEPS);
                
                let needsSpawning = false;
                if (spawn && spawn.spawning) {
                    needsSpawning = true;
                } else {
                    const totalTarget = Object.values(currentTargets).reduce((a, b) => a + b, 0);
                    if (currentCreeps.length < totalTarget) {
                        needsSpawning = true;
                    }
                }

                if (needsSpawning && spawn) {
                    if (!creep.pos.inRangeTo(spawn, 3)) {
                        moveModule.smartMove(creep, spawn, { range: 3, visualizePathStyle: { stroke: "#00ffff" } });
                    }
                    return;
                }

                // 2. 否则去升级控制器
                if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                    moveModule.smartMove(creep, creep.room.controller, { visualizePathStyle: { stroke: "#ffffff" } });
                }
            }
        }
    }
  },
};

module.exports = roleHarvester;
