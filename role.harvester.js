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
          // 否则找一个可用的空位 (Range 1)
          // 不再简单地走向 Source (这会导致叠罗汉)，而是显式寻找周围的空地
          const area = creep.room.lookForAtArea(
            LOOK_TERRAIN,
            source.pos.y - 1,
            source.pos.x - 1,
            source.pos.y + 1,
            source.pos.x + 1,
            true,
          );

          let bestSpot = null;
          for (const spot of area) {
            if (spot.terrain === "wall") continue;
            const pos = new RoomPosition(spot.x, spot.y, creep.room.name);
            // 检查是否有 creep (除了自己)
            const creepsHere = pos.lookFor(LOOK_CREEPS);
            if (creepsHere.length === 0 || creepsHere[0].name === creep.name) {
              bestSpot = pos;
              break; // 找到一个就行
            }
          }

          if (bestSpot) {
            harvestPos = bestSpot;
          } else {
            // 如果实在没空位了，就只好排队（或者走向 Source 挤一挤）
            harvestPos = source.pos;
          }
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
        // 如果目标是具体坐标（Container 或 空地）
        else {
          if (!creep.pos.isEqualTo(harvestPos)) {
            moveModule.smartMove(creep, harvestPos, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          } else {
            // === 到了位置，开始干活 (动作互斥：一 tick 只做一件事) ===
            // 确保真的在范围内（防止 smartMove 还没到）
            if (!creep.pos.isNearTo(source)) {
              return; // 还没到
            }

            // 1. 优先把能量存入附近的 Container (如果满了且有 Container)
            if (creep.store.getFreeCapacity() === 0) {
              // 优化查找逻辑：
              // 1. 先看之前找到的 container 变量（通常是脚下的或者最近的）
              let targetContainer = container;

              // 2. 如果那个 container 不可用（满了或不在范围内），再搜一下周围
              if (
                !targetContainer ||
                !creep.pos.inRangeTo(targetContainer, 1) ||
                targetContainer.store.getFreeCapacity(RESOURCE_ENERGY) === 0
              ) {
                targetContainer = creep.pos.findInRange(FIND_STRUCTURES, 1, {
                  filter: (s) =>
                    s.structureType === STRUCTURE_CONTAINER &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
                })[0];
              }

              if (targetContainer) {
                // 只有当 Container 真的没满时才存
                if (
                  targetContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                ) {
                  creep.transfer(targetContainer, RESOURCE_ENERGY);
                  creep.say("📦 store");
                  return; // 存货完成，结束本 tick
                }
              }
            }

            // 2. 顺手把能量给身边的 Hauler (如果正好贴着，且自己快满了)
            if (creep.store.getFreeCapacity() < 10) {
              const nearbyHauler = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
                filter: (c) =>
                  c.memory.role === "hauler" && c.store.getFreeCapacity() > 0,
              })[0];
              if (nearbyHauler) {
                creep.transfer(nearbyHauler, RESOURCE_ENERGY);
                return; // 给货完成，结束本 tick
              }
            }

            // 3. 检查是否需要自我维护 (Container Under Feet)
            // 只有当有能量时才修
            if (
              container &&
              container.hits < container.hitsMax * 0.8 &&
              creep.store[RESOURCE_ENERGY] > 0
            ) {
              creep.repair(container);
              creep.say("🔧 fix");
              return; // 维修完成，结束本 tick
            }

            // 4. 检查是否需要建造 (仅当背包满了，或者周围有非常紧急的工地)
            // 这里我们设定为：只有背包满了，作为 Drop Mining 的替代方案，才去建造
            // 这样既利用了溢出能量，又不会在背包不满时影响挖矿效率
            if (creep.store.getFreeCapacity() === 0) {
              const nearbySites = creep.pos.findInRange(
                FIND_CONSTRUCTION_SITES,
                3,
              );
              if (nearbySites.length > 0) {
                const target = priorityModule.getBestTarget(
                  nearbySites,
                  creep.pos,
                );
                if (target) {
                  creep.build(target);
                  creep.say("🚧 build");
                  return; // 建造完成，结束本 tick
                }
              }
            }

            // 5. 最后：挖矿
            // 如果背包满了，且没存掉、没给 Hauler、没修、没建，那就只能 Drop Mining 了
            if (creep.store.getFreeCapacity() === 0) {
              creep.say("⬇️ drop");
            }
            creep.harvest(source);
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
