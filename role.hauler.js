const moveModule = require("module.move");

const roleHauler = {
  /** @param {Creep} creep **/
  run: function (creep) {
    // 状态切换
    if (creep.memory.hauling && creep.store[RESOURCE_ENERGY] == 0) {
      creep.memory.hauling = false;
      creep.say("🔄 collect");
    }
    if (!creep.memory.hauling && creep.store.getFreeCapacity() == 0) {
      creep.memory.hauling = true;
      creep.say("🚚 haul");
    }

    // === 紧急填充逻辑 ===
    // 如果 Spawn/Extension 没满，且自己身上有能量（哪怕没满），强制切换到送货模式
    // 避免看着 Spawn 饿死而自己还在捡垃圾
    if (!creep.memory.hauling && creep.store[RESOURCE_ENERGY] > 0) {
      if (creep.room.energyAvailable < creep.room.energyCapacityAvailable) {
        creep.memory.hauling = true;
        creep.say("🚨 rescue");
      }
    }

    if (creep.memory.hauling) {
      // === 送货模式 ===
      // 目标锁定逻辑：一旦选定目标，就存入 memory.targetId，直到送完或者目标无效

      let target = null;

      // 1. 尝试从 memory 获取已锁定的目标
      if (creep.memory.targetId) {
        target = Game.getObjectById(creep.memory.targetId);

        // 验证目标是否有效
        let isValid = false;
        if (target) {
          // 如果是建筑
          if (target.store) {
            // 只要还有空间就视为有效，哪怕只能放 1 点能量
            // 注意：如果目标是 Spawn/Extension，我们希望尽量填满
            if (target.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
              isValid = true;
            }
          }
          // 如果是 Creep (Upgrader/Builder)
          else if (target.store) {
            // Creep 也有 store
            if (target.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
              isValid = true;
            }
          }
        }

        if (!isValid) {
          delete creep.memory.targetId;
          target = null;
        }
      }

      // 2. 如果没有目标 (或已失效)，重新寻找
      if (!target) {
        let targets = [];

        // 优先级 1: Spawn / Extension
        targets = creep.room.find(FIND_STRUCTURES, {
          filter: (structure) => {
            return (
              (structure.structureType == STRUCTURE_EXTENSION ||
                structure.structureType == STRUCTURE_SPAWN) &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            );
          },
        });

        // 优先级 2: Tower
        if (targets.length === 0) {
          targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
              return (
                structure.structureType == STRUCTURE_TOWER &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
              );
            },
          });
        }

        // 优先级 2.5: 喂养 Creeps (Upgrader/Builder)
        if (targets.length === 0) {
          const hungryCreeps = creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => {
              return (
                (c.memory.role === "upgrader" || c.memory.role === "builder") &&
                c.store[RESOURCE_ENERGY] < c.store.getCapacity() * 0.2
              ); // 低于 20%
            },
          });

          if (hungryCreeps.length > 0) {
            // 优先喂 Upgrader
            const hungryUpgraders = hungryCreeps.filter(
              (c) => c.memory.role === "upgrader",
            );
            if (hungryUpgraders.length > 0) {
              targets = hungryUpgraders;
            } else {
              targets = hungryCreeps;
            }
          }
        }

        // 优先级 3: Spawn Container
        if (targets.length === 0) {
          const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
          if (spawn) {
            const spawnContainers = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
              filter: (s) =>
                s.structureType === STRUCTURE_CONTAINER &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            });
            if (spawnContainers.length > 0) {
              targets = spawnContainers;
            }
          }
        }

        // 优先级 4: Storage
        if (targets.length === 0) {
          targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
              return (
                structure.structureType == STRUCTURE_STORAGE &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
              );
            },
          });
        }

        // 优先级 5: Controller Container
        if (targets.length === 0 && creep.room.controller) {
          targets = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 4, {
            filter: (s) =>
              s.structureType === STRUCTURE_CONTAINER &&
              s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
          });
        }

        // 选择最近的目标并锁定
        if (targets.length > 0) {
          target = creep.pos.findClosestByPath(targets);
          if (target) {
            creep.memory.targetId = target.id;
          }
        }
      }

      // 3. 执行送货
      if (target) {
        const result = creep.transfer(target, RESOURCE_ENERGY);
        if (result == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        } else if (result == OK) {
          // 传输成功
          // 检查目标是否满了，或者自己是否空了
          // 注意：transfer 是瞬间发生的，但 store 的更新要到下一 tick
          // 这里我们不做预测，依靠下一 tick 的 isValid 检查来清除 targetId
          // 如果自己空了，状态机会在下一 tick 自动切换到 collecting
        }
      } else {
        // 如果真的没有任何地方可送 (且背包有货)
        // 检查是否需要孵化待命... (保留原有逻辑)

        // ... (原有待命逻辑)
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        // ... (略，保持原有逻辑或简化)
        if (spawn) {
          if (!creep.pos.inRangeTo(spawn, 3)) {
            moveModule.smartMove(creep, spawn);
          }
        }
      }
    } else {
      // 寻找能量来源：掉落的资源 > 墓碑 > 废墟

      // 0. 优先从 Mining Container 取货 (如果有能量)
      // 必须是 Source 附近的 Container，或者是 Spawn 附近的 Container (如果是空的 Spawn 需要补充？暂时不考虑)

      // 如果分配了 Source ID，优先去该 Source 附近的 Container
      let targetContainer = null;
      if (creep.memory.sourceId) {
        const source = Game.getObjectById(creep.memory.sourceId);
        if (source) {
          const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: (s) =>
              s.structureType === STRUCTURE_CONTAINER &&
              s.store[RESOURCE_ENERGY] > 50,
          });
          if (containers.length > 0) {
            targetContainer = containers[0];
          }
        }
      }

      // 如果没有分配 Source ID 或者分配的 Source 附近没有 Container，则找任意 Mining Container
      if (!targetContainer) {
        const containers = creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 50 &&
            s.pos.findInRange(FIND_SOURCES, 2).length > 0, // 必须是 Mining Container
        });
        if (containers.length > 0) {
          targetContainer = creep.pos.findClosestByPath(containers);
        }
      }

      // === 紧急取货逻辑 ===
      // 如果 Spawn 没满，且 Mining Container 没货，允许从 Storage 或 General Container 取货
      if (
        !targetContainer &&
        creep.room.energyAvailable < creep.room.energyCapacityAvailable
      ) {
        // 找 Storage
        if (
          creep.room.storage &&
          creep.room.storage.store[RESOURCE_ENERGY] > 0
        ) {
          // 只有当 Storage 能量充足或者非常紧急时才取
          if (
            creep.room.storage.store[RESOURCE_ENERGY] > 500 ||
            creep.room.energyAvailable < 300
          ) {
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
        }

        // 找 General Container (非 Mining)
        const generalContainers = creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 50 &&
            s.pos.findInRange(FIND_SOURCES, 2).length === 0,
        });
        if (generalContainers.length > 0) {
          targetContainer = creep.pos.findClosestByPath(generalContainers);
        }
      }

      if (targetContainer) {
        if (
          creep.withdraw(targetContainer, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, targetContainer, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 1. 掉落的资源 (优先捡自己 Source 附近的)
      let droppedResources = [];
      if (creep.memory.sourceId) {
        const source = Game.getObjectById(creep.memory.sourceId);
        if (source) {
          droppedResources = source.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
            filter: (resource) => resource.resourceType == RESOURCE_ENERGY,
          });
        }
      }

      if (droppedResources.length === 0) {
        droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
          filter: (resource) => resource.resourceType == RESOURCE_ENERGY,
        });
      }

      if (droppedResources.length > 0) {
        const target = creep.pos.findClosestByPath(droppedResources);
        if (creep.pickup(target) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 2. 墓碑 (死掉的 creep)
      const tombstones = creep.room.find(FIND_TOMBSTONES, {
        filter: (tombstone) => tombstone.store[RESOURCE_ENERGY] > 0,
      });
      if (tombstones.length > 0) {
        const target = creep.pos.findClosestByPath(tombstones);
        if (creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 3. 如果有 Container (容器)，也可以从 Container 取 (以后扩展)
      // const containers = ...

      // 如果实在没事干，可以尝试去 source 旁边捡漏（或者这里可以扩展为去 Container 取货）
      const sources = creep.room.find(FIND_SOURCES);
      const source = sources[0]; // 简单去第一个 source 附近碰运气
      if (!creep.pos.inRangeTo(source, 3)) {
        moveModule.smartMove(creep, source);
      }
    }
  },
};

module.exports = roleHauler;
