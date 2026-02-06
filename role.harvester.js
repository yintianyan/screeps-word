const moveModule = require("module.move");

const roleHarvester = {
  /** @param {Creep} creep **/
  run: function (creep) {
    if (creep.store.getFreeCapacity() > 0) {
      // 如果没有分配 sourceId，则寻找并分配
      if (!creep.memory.sourceId) {
        const sources = creep.room.find(FIND_SOURCES);
        // 智能分配：统计每个 source 目前有多少个 Harvester
        // 优先分配给人数最少的 Source
        const harvesters = creep.room.find(FIND_MY_CREEPS, {
          filter: (c) => c.memory.role === "harvester" && c.memory.sourceId,
        });

        // 统计
        const counts = {};
        sources.forEach((s) => (counts[s.id] = 0));
        harvesters.forEach((c) => {
          if (counts[c.memory.sourceId] !== undefined) {
            counts[c.memory.sourceId]++;
          }
        });

        // 找最少的
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
      // 检查是否有 Hauler 存在
      const haulers = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "hauler",
      });

      if (haulers.length > 0) {
        // 如果有搬运工，Harvester 应当变为“静态挖掘者”
        // 只要还没死，就继续挖，不用管背包满没满
        // 多余的能量会自动掉落在地上 (Drop Mining) 或进入 Container

        // 尝试把能量给旁边的 Hauler/Link/Container
        // 优先给附近的 Hauler
        const nearbyHauler = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
          filter: (c) =>
            c.memory.role === "hauler" && c.store.getFreeCapacity() > 0,
        })[0];

        if (nearbyHauler) {
          creep.transfer(nearbyHauler, RESOURCE_ENERGY);
        } else {
          // 如果脚下有 Container，自动会进去；如果没有，就 Drop
          // 显式 Drop 也是一种选择，但满背包继续 harvest 会自动 drop
          // 为了防止它走动，这里直接 return，继续下一 tick 的 harvest
          // 但是 role 逻辑是 if(free > 0) harvest else transfer
          // 所以我们需要强制它回到 harvest 状态
          // 或者直接在这里 drop

          // 检查脚下的 Container
          const container = creep.pos
            .lookFor(LOOK_STRUCTURES)
            .find((s) => s.structureType === STRUCTURE_CONTAINER);
          if (
            container &&
            container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          ) {
            // 自动进入 container，无需操作，或者显式 repair?
          } else {
            // 没地方放了，也找不到人，就扔地上
            // 但不需要显式 drop，只要不去执行下面的 move 逻辑就行
          }
        }

        // 关键：不要执行下面的移动送货逻辑！
        // 除非没有任何 Hauler
        return;
      }

      // 下面是“无搬运工模式”的逻辑：自己送货
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
        const populationModule = require("module.population");
        const currentTargets = populationModule.calculateTargets(creep.room);
        const currentCreeps = creep.room.find(FIND_MY_CREEPS);

        let needsSpawning = false;
        if (spawn && spawn.spawning) {
          needsSpawning = true;
        } else {
          // 简单估算：如果现有 Creep 总数 < 目标总数，说明可能需要孵化
          const totalTarget = Object.values(currentTargets).reduce(
            (a, b) => a + b,
            0,
          );
          if (currentCreeps.length < totalTarget) {
            needsSpawning = true;
          }
        }

        if (needsSpawning && spawn) {
          // 如果需要孵化，就在 Spawn 附近待命 (距离 3 格，避免堵路)
          if (!creep.pos.inRangeTo(spawn, 3)) {
            moveModule.smartMove(creep, spawn, {
              range: 3,
              visualizePathStyle: { stroke: "#00ffff" },
            });
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
