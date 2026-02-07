const moveModule = require("module.move");
const priorityModule = require("module.priority");

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

      // 目标挖掘位置
      let harvestPos = null;

      // 1. 优先考虑 Container 位置
      if (container) {
        // 检查 Container 上是否有人
        const creepsOnContainer = container.pos.lookFor(LOOK_CREEPS);

        // 如果没人，或者就是我自己，或者那个位置的人马上就要死了（这里简单判断没人或自己）
        if (
          creepsOnContainer.length === 0 ||
          creepsOnContainer[0].name === creep.name
        ) {
          harvestPos = container.pos;
        }
      }

      // 2. 如果 Container 被占用（或者没有 Container），找 Source 旁边其他空位
      if (!harvestPos) {
        // 如果我已经站在 Source 旁边了，就不用动了
        if (creep.pos.isNearTo(source)) {
          harvestPos = creep.pos;
        } else {
          // 否则找一个可用的空位
          // 这里简单地走向 Source，module.move 会自动处理路径，找一个能到的 Range 1
          harvestPos = source.pos;
        }
      }

      if (harvestPos) {
        // 如果目标是 Source 本身（说明是要去 Range 1 的位置），且不在范围内
        if (harvestPos.isEqualTo(source.pos)) {
          if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, source, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        }
        // 如果目标是具体坐标（Container）
        else {
          if (!creep.pos.isEqualTo(harvestPos)) {
            moveModule.smartMove(creep, harvestPos, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          } else {
            // === 到了位置，开始干活 ===

            // 1. 优先把能量存入附近的 Container (如果满了且有 Container)
            // 这解决了 "采集后并没有将资源存放在 container" 的问题
            if (creep.store.getFreeCapacity() === 0) {
              // 找 Range 1 内的 Container (不管是脚下的还是旁边的)
              const nearbyContainer = creep.pos.findInRange(
                FIND_STRUCTURES,
                1,
                {
                  filter: (s) =>
                    s.structureType === STRUCTURE_CONTAINER &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
                },
              )[0];

              if (nearbyContainer) {
                creep.transfer(nearbyContainer, RESOURCE_ENERGY);
                creep.say("📦 store");
                return; // 这一 tick 做了 transfer，就不能 harvest 了
              }
            }

            // 2. 否则继续挖矿
            // 如果背包满了还在挖，说明是 Drop Mining
            if (creep.store.getFreeCapacity() === 0) {
              creep.say("⬇️ drop");
            }
            creep.harvest(source);
          }
        }
      }

      // 顺手把能量给身边的 Hauler (如果正好贴着)
      // 只有当背包快满时才做，避免每 tick 都尝试
      if (creep.store.getFreeCapacity() < 10) {
        const nearbyHauler = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
          filter: (c) =>
            c.memory.role === "hauler" && c.store.getFreeCapacity() > 0,
        })[0];
        if (nearbyHauler) {
          creep.transfer(nearbyHauler, RESOURCE_ENERGY);
        }

        // === 智能建造逻辑 (Intelligent Building) ===
        // 只有当有能量且不需要立刻给Hauler时才考虑
        // 1. 检查是否需要自我维护 (Container Under Feet)
        if (container && container.hits < container.hitsMax * 0.8) {
          creep.repair(container);
          creep.say("🔧 fix");
        }
        // 2. 检查是否有附近的工地 (Range 3)
        // 适用于：早期修路、重建Container、紧急维修
        else {
          const nearbySites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 3);
          if (nearbySites.length > 0) {
            // 使用 priorityModule 获取最佳目标
            const target = priorityModule.getBestTarget(nearbySites, creep.pos);
            if (target) {
              creep.build(target);
              creep.say("🚧 build");
            }
          }
        }
      }
    } else {
      // === 传统模式 (Carry Mining) ===
      // 没有 Hauler，自己挖自己运
      if (creep.store.getFreeCapacity() > 0) {
        // 还有空位，去挖矿
        if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, source, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
      } else {
        // 满了，去送货
        // === 智能决策：送货还是建造？ ===

        // 条件1: 早期游戏 (RCL <= 3) 且 Spawn 满了
        // 条件2: 没有专业 Builder
        // 条件3: 工地数量很少 (Harvester 顺手就能做)

        const rcl = creep.room.controller.level;
        const builders = creep.room.find(FIND_MY_CREEPS, {
          filter: (c) => c.memory.role === "builder",
        });
        const sites = creep.room.find(FIND_CONSTRUCTION_SITES);

        // 优先填充 Spawn/Extension
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
          // Spawn 满了，考虑去建造
          let shouldBuild = false;

          if (sites.length > 0) {
            if (rcl <= 3) shouldBuild = true; // 早期全员基建
            if (builders.length === 0) shouldBuild = true; // 没 Builder，只能我来
            if (sites.length <= 3) shouldBuild = true; // 工地少，顺手做了
          }

          if (shouldBuild) {
            // 使用 priorityModule 获取最佳目标
            const target = priorityModule.getBestTarget(sites, creep.pos);
            if (creep.build(target) == ERR_NOT_IN_RANGE) {
              moveModule.smartMove(creep, target, {
                visualizePathStyle: { stroke: "#ffffff" },
              });
            }
            return;
          }

          // 如果不建造，再考虑其他
          // 1. 检查是否需要孵化 (Wait near Spawn)
          const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
          const populationModule = require("module.population");
          const currentTargets = populationModule.calculateTargets(creep.room);
          const currentCreeps = creep.room.find(FIND_MY_CREEPS);

          let needsSpawning = false;
          if (spawn && spawn.spawning) {
            needsSpawning = true;
          } else {
            const totalTarget = Object.values(currentTargets).reduce(
              (a, b) => a + b,
              0,
            );
            if (currentCreeps.length < totalTarget) {
              needsSpawning = true;
            }
          }

          if (needsSpawning && spawn) {
            if (!creep.pos.inRangeTo(spawn, 3)) {
              moveModule.smartMove(creep, spawn, {
                range: 3,
                visualizePathStyle: { stroke: "#00ffff" },
              });
            }
            return;
          }

          // 2. 否则去升级控制器
          if (
            creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE
          ) {
            moveModule.smartMove(creep, creep.room.controller, {
              visualizePathStyle: { stroke: "#ffffff" },
            });
          }
        }
      }
    }
  },
};

module.exports = roleHarvester;
