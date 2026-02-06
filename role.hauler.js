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

    if (creep.memory.hauling) {
      // 1. 优先填充 Spawn 和 Extension
      let targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return (
            (structure.structureType == STRUCTURE_EXTENSION ||
              structure.structureType == STRUCTURE_SPAWN) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          );
        },
      });

      // 2. 如果都满了，填充 Tower (如果有)
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

      // 3. 还没有，就放 Storage (如果有)
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

      // 4. 如果还是没有，就填充 "非 Mining" 的 Container (例如 Controller Container 或 Spawn Container)
      // 注意：必须排除 Mining Container，否则会把能量运回 Source
      if (targets.length === 0) {
        targets = creep.room.find(FIND_STRUCTURES, {
          filter: (s) => {
            if (s.structureType !== STRUCTURE_CONTAINER) return false;
            if (s.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return false;

            // 排除 Source 附近的 Container (Mining Container)
            const nearbySource = s.pos.findInRange(FIND_SOURCES, 2);
            return nearbySource.length === 0;
          },
        });
      }

      if (targets.length > 0) {
        // 找最近的一个
        const closest = creep.pos.findClosestByPath(targets);
        if (creep.transfer(closest, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, closest, {
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
          // 这里只做一个粗略检查，避免依赖 main.js 的 counts 变量
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

        // 如果所有地方都满了，可以选择去升级控制器，或者在 Spawn 附近待命
        if (
          creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, creep.room.controller, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      }
    } else {
      // 寻找能量来源：掉落的资源 > 墓碑 > 废墟

      // 0. 优先从 Mining Container 取货 (如果有能量)
      // 必须是 Source 附近的 Container，或者是 Spawn 附近的 Container (如果是空的 Spawn 需要补充？暂时不考虑)
      const containers = creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 50 &&
          s.pos.findInRange(FIND_SOURCES, 2).length > 0, // 必须是 Mining Container
      });
      if (containers.length > 0) {
        const target = creep.pos.findClosestByPath(containers);
        if (creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 1. 掉落的资源
      const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (resource) => resource.resourceType == RESOURCE_ENERGY,
      });

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
