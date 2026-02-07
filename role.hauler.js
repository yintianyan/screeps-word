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

    // === 防死锁逻辑 (Anti-Deadlock) ===
    // 如果正在去取货 (!hauling)，但是身上有能量，且被堵住了
    if (!creep.memory.hauling && creep.store[RESOURCE_ENERGY] > 0) {
      // 检查是否被堵 (位置未变)
      if (
        creep.memory.lastPos &&
        creep.pos.x === creep.memory.lastPos.x &&
        creep.pos.y === creep.memory.lastPos.y
      ) {
        creep.memory.stuckCount = (creep.memory.stuckCount || 0) + 1;
      } else {
        creep.memory.stuckCount = 0;
        creep.memory.lastPos = creep.pos;
      }

      // 如果堵了 3 tick，且身上有货，直接切换去送货
      // "挤不进去就不取了，先把身上的送走"
      if (creep.memory.stuckCount > 3) {
        creep.memory.hauling = true;
        creep.memory.stuckCount = 0;
        delete creep.memory.targetId; // 清除可能锁定的取货目标
        creep.say("😒 give up");
        console.log(
          `[Hauler] ${creep.name} stuck while fetching, switching to hauling (Energy: ${creep.store[RESOURCE_ENERGY]})`,
        );
      }
    } else {
      // 如果在动或者没能量，重置计数
      creep.memory.stuckCount = 0;
      creep.memory.lastPos = creep.pos;
    }

    if (creep.memory.hauling) {
      // === 送货模式 ===

      // 0. 预判逻辑：统计所有其他搬运工的送货目标和携带量
      // 用于防止多个搬运工同时前往同一个只需少量能量的目标
      const incomingEnergy = {};
      const otherHaulers = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) =>
          c.memory.role === "hauler" &&
          c.memory.hauling &&
          c.id !== creep.id &&
          c.memory.targetId,
      });

      otherHaulers.forEach((h) => {
        incomingEnergy[h.memory.targetId] =
          (incomingEnergy[h.memory.targetId] || 0) + h.store[RESOURCE_ENERGY];
      });

      // 目标锁定逻辑：一旦选定目标，就存入 memory.targetId，直到送完或者目标无效
      let target = null;

      // 1. 尝试从 memory 获取已锁定的目标
      if (creep.memory.targetId) {
        target = Game.getObjectById(creep.memory.targetId);

        // 验证目标是否有效
        let isValid = false;
        if (target) {
          const freeCapacity = target.store
            ? target.store.getFreeCapacity(RESOURCE_ENERGY)
            : 0;

          // 基本有效性检查：必须还有空位
          if (freeCapacity > 0) {
            isValid = true;

            // 进阶检查：是否被其他人填满？
            // 如果 (其他人正在运送的量) >= (目标剩余空间)，则认为目标已饱和，我应该放弃
            const othersIncoming = incomingEnergy[target.id] || 0;
            if (othersIncoming >= freeCapacity) {
              console.log(
                `[Hauler] ${creep.name} switching from ${target.structureType || "target"} #${target.id}: Saturated by others (Incoming: ${othersIncoming} >= Free: ${freeCapacity})`,
              );
              isValid = false; // 标记为无效，触发重新寻找
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

        // 辅助函数：过滤掉已饱和的目标
        const filterSaturated = (structure) => {
          const free = structure.store.getFreeCapacity(RESOURCE_ENERGY);
          if (free <= 0) return false;

          const incoming = incomingEnergy[structure.id] || 0;
          // 如果 (已有运送量) >= (剩余容量)，则跳过
          return incoming < free;
        };

        // 优先级 1: Spawn / Extension
        targets = creep.room.find(FIND_STRUCTURES, {
          filter: (structure) => {
            return (
              (structure.structureType == STRUCTURE_EXTENSION ||
                structure.structureType == STRUCTURE_SPAWN) &&
              filterSaturated(structure)
            );
          },
        });

        // 优先级 2: Tower
        if (targets.length === 0) {
          targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
              return (
                structure.structureType == STRUCTURE_TOWER &&
                filterSaturated(structure)
              );
            },
          });
        }

        // 优先级 2.5: 喂养 Creeps (Upgrader/Builder)
        if (targets.length === 0) {
          const hungryCreeps = creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => {
              // 只要请求标志为 true，且未被满足
              return c.memory.requestingEnergy && filterSaturated(c);
            },
          });

          if (hungryCreeps.length > 0) {
            // 优先喂 Builder > Upgrader (按用户新需求)
            // 且优先满足等待时间过长 (>5 ticks) 的
            targets = hungryCreeps.sort((a, b) => {
              // 1. 强制共享检测
              const forceA = (a.memory.waitingTicks || 0) > 5;
              const forceB = (b.memory.waitingTicks || 0) > 5;
              if (forceA !== forceB) return forceA ? -1 : 1;

              // 2. 角色优先级
              const rolePriority = { builder: 2, upgrader: 1 };
              const priorityA = rolePriority[a.memory.role] || 0;
              const priorityB = rolePriority[b.memory.role] || 0;
              if (priorityA !== priorityB) return priorityB - priorityA;

              // 3. 等待时间
              return (
                (b.memory.waitingTicks || 0) - (a.memory.waitingTicks || 0)
              );
            });
            // 这里不需要 filter，sort 后 targets[0] 就是最好的，findClosestByPath 会再基于距离筛选
            // 但为了让 findClosestByPath 有效，我们可能需要保留数组
          }
        }

        // 优先级 3: Spawn Container
        if (targets.length === 0) {
          const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
          if (spawn) {
            const spawnContainers = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
              filter: (s) =>
                s.structureType === STRUCTURE_CONTAINER && filterSaturated(s),
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
                filterSaturated(structure)
              );
            },
          });
        }

        // 优先级 5: Controller Container
        if (targets.length === 0 && creep.room.controller) {
          targets = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 4, {
            filter: (s) =>
              s.structureType === STRUCTURE_CONTAINER && filterSaturated(s),
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
        // === 智能重定向逻辑 ===
        // 在尝试传输前，先检查目标是否已满 (对于 Structure)
        // 如果已满，立即扫描周围 3 格内是否有请求能量的 Creep
        let redirected = false;

        if (
          target.structureType &&
          target.store.getFreeCapacity(RESOURCE_ENERGY) === 0
        ) {
          // 目标已满！
          const nearbyRequestingCreeps = creep.pos.findInRange(
            FIND_MY_CREEPS,
            3,
            {
              filter: (c) => c.memory.requestingEnergy,
            },
          );

          if (nearbyRequestingCreeps.length > 0) {
            // 按优先级排序：Builder > Upgrader > Other
            // 且优先满足等待时间最长的 (waitingTicks)
            const bestCreep = nearbyRequestingCreeps.sort((a, b) => {
              const rolePriority = { builder: 2, upgrader: 1 };
              const priorityA = rolePriority[a.memory.role] || 0;
              const priorityB = rolePriority[b.memory.role] || 0;

              if (priorityA !== priorityB) return priorityB - priorityA; // 高优先
              return (
                (b.memory.waitingTicks || 0) - (a.memory.waitingTicks || 0)
              ); // 长等待优先
            })[0];

            if (bestCreep) {
              console.log(
                `${creep.name} redirected energy from full ${target.structureType} to ${bestCreep.name} (${bestCreep.memory.role})`,
              );
              creep.transfer(bestCreep, RESOURCE_ENERGY);
              // 可选：更新 targetId 以便下一 tick 继续喂它（如果还有货）
              // creep.memory.targetId = bestCreep.id;
              redirected = true;
            }
          }
        }

        if (!redirected) {
          const result = creep.transfer(target, RESOURCE_ENERGY);
          if (result == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, target, {
              visualizePathStyle: { stroke: "#ffffff" },
            });
          } else if (result == ERR_FULL) {
            // 如果返回 ERR_FULL (虽然上面预判了，但多加一层保险)
            // 清除目标，让下一 tick 重新寻找
            delete creep.memory.targetId;
          }
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
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
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

      // === 绑定 Container 的特殊逻辑：死等直到满 ===
      // 如果目标是绑定的 Container，即使空了也要去，并且一直在那等到自己满
      if (
        targetContainer &&
        creep.memory.sourceId &&
        targetContainer.pos.inRangeTo(
          Game.getObjectById(creep.memory.sourceId),
          2,
        )
      ) {
        // 尝试取货
        if (targetContainer.store[RESOURCE_ENERGY] > 0) {
          const withdrawResult = creep.withdraw(
            targetContainer,
            RESOURCE_ENERGY,
          );
          if (withdrawResult == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, targetContainer, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          } else if (withdrawResult == OK) {
            // 取货成功，如果还没满，下一 tick 继续
            // 如果满了，下个 tick 的状态切换逻辑会把它切成 hauling
          }
        } else {
          // 没货，但也要过去守着
          if (!creep.pos.inRangeTo(targetContainer, 1)) {
            moveModule.smartMove(creep, targetContainer, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          } else {
            creep.say("⏳ waiting");
          }
        }

        // 同时尝试捡脚下的掉落资源 (Range 1 范围内)
        const dropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
          filter: (r) => r.resourceType === RESOURCE_ENERGY,
        });
        if (dropped.length > 0) {
          creep.pickup(dropped[0]);
        }

        // === 提前离开逻辑 ===
        // 如果 Container 空了（或几乎空了），且自己身上已经有不少能量 (>50%)，
        // 不要死等，直接去送货。这能缓解拥堵，并提高周转率。
        const containerEnergy = targetContainer.store[RESOURCE_ENERGY];
        const myEnergy = creep.store[RESOURCE_ENERGY];
        const myCapacity = creep.store.getCapacity(RESOURCE_ENERGY);

        if (containerEnergy < 50 && myEnergy > myCapacity * 0.5) {
          creep.memory.hauling = true;
          creep.say("🏃 early");
          return;
        }

        return; // 强制留在这里，直到状态切换（满载）
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
