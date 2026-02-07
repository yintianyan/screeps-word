const moveModule = require("module.move");
const priorityModule = require("module.priority");

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
      // === 1. 紧急维修 (Critical Repair) ===
      // 只有当建筑濒临损坏时，才强制优先维修
      // Container < 20% (50k/250k)
      // Road < 20% (1k/5k)
      const criticalTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (object) =>
          (object.structureType === STRUCTURE_CONTAINER &&
            object.hits < object.hitsMax * 0.2) ||
          (object.structureType === STRUCTURE_ROAD &&
            object.hits < object.hitsMax * 0.2),
      });

      if (criticalTargets.length > 0) {
        // 优先修 Container
        criticalTargets.sort((a, b) => {
          if (
            a.structureType === STRUCTURE_CONTAINER &&
            b.structureType !== STRUCTURE_CONTAINER
          )
            return -1;
          if (
            a.structureType !== STRUCTURE_CONTAINER &&
            b.structureType === STRUCTURE_CONTAINER
          )
            return 1;
          return a.hits - b.hits; // 血量绝对值少的优先
        });

        const target = criticalTargets[0];
        creep.say("🔧 critical");
        console.log(
          `[Builder] ${creep.name} performing CRITICAL REPAIR on ${target.structureType} at ${target.pos} (Hits: ${target.hits}/${target.hitsMax})`,
        );

        if (creep.repair(target) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
        return; // 紧急任务，必须先做
      }

      // === 2. 建造任务 (Construction) ===
      const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
      if (targets.length) {
        // 使用 priorityModule 获取最佳目标
        const target = priorityModule.getBestTarget(targets, creep.pos);

        if (target) {
          creep.say("🔨 build");
          // console.log(`[Builder] ${creep.name} building ${target.structureType} at ${target.pos}`);
          if (creep.build(target) == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, target, {
              visualizePathStyle: { stroke: "#ffffff" },
            });
          }
        }
        return; // 有工地就造，不进行后续的“闲时维修”
      }

      // === 3. 闲时维修 (Maintenance Repair) ===
      // 如果没有工地，把路和 Container 补满
      // Container < 80%
      // Road < 80%
      const maintenanceTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (object) =>
          (object.structureType === STRUCTURE_CONTAINER ||
            object.structureType === STRUCTURE_ROAD) &&
          object.hits < object.hitsMax * 0.8,
      });

      if (maintenanceTargets.length > 0) {
        maintenanceTargets.sort(
          (a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax,
        );
        const target = maintenanceTargets[0];
        creep.say("🔧 repair");

        if (creep.repair(target) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        return;
      }

      // === 4. 升级控制器 (Upgrade) ===
      // 没事干了，去升级
      if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
        moveModule.smartMove(creep, creep.room.controller, {
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    } else {
      // === 严格的定点/区域工作模式 ===
      // Builder 应该优先从工地附近的 Container/Storage 取货
      // 如果没有，就原地等待 Hauler 喂养 (通过 say "wait")

      // 1. 优先从 Storage 取能量 (如果距离合适)
      if (
        creep.room.storage &&
        creep.room.storage.store[RESOURCE_ENERGY] > 0 &&
        creep.pos.inRangeTo(creep.room.storage, 5)
      ) {
        // 清除标志
        delete creep.memory.requestingEnergy;
        delete creep.memory.waitingTicks;

        const result = creep.withdraw(creep.room.storage, RESOURCE_ENERGY);
        if (result == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, creep.room.storage, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 2. 其次从 *附近* (Range 3) 的 Container 取能量
      // 不再跑遍全图找 Container
      const nearbyContainer = creep.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      })[0];

      if (nearbyContainer) {
        delete creep.memory.requestingEnergy;
        delete creep.memory.waitingTicks;

        const result = creep.withdraw(nearbyContainer, RESOURCE_ENERGY);
        if (result == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, nearbyContainer, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 3. 捡 *附近* (Range 3) 地上的能量
      const dropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY,
      })[0];

      if (dropped) {
        delete creep.memory.requestingEnergy;
        delete creep.memory.waitingTicks;

        if (creep.pickup(dropped) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, dropped, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 3.5 紧急/便利取能：如果在 Spawn/Extension 附近 (Range 5)，且有能量，允许取用
      // 限制：必须保证 Spawn 有足够的能量进行正常孵化 (例如保留 300 能量)
      const nearbySpawnOrExt = creep.pos.findInRange(FIND_STRUCTURES, 5, {
        filter: (s) =>
          (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION) &&
          s.store[RESOURCE_ENERGY] > 0,
      })[0];

      // 只有当房间能量充足时才从 Spawn/Extension 取能
      if (nearbySpawnOrExt && creep.room.energyAvailable > 300) {
        delete creep.memory.requestingEnergy;
        delete creep.memory.waitingTicks;

        if (
          creep.withdraw(nearbySpawnOrExt, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, nearbySpawnOrExt, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 4. 如果都找不到...

      // === 优化：如果有能量（哪怕没满），既然找不到补给，就先去干活，别傻等 ===
      if (creep.store[RESOURCE_ENERGY] > 0) {
        creep.memory.building = true;
        delete creep.memory.requestingEnergy;
        delete creep.memory.waitingTicks;
        creep.say("🚧 work");
        return;
      }

      // 5. 真的没能量了，请求喂养
      // 激活请求协议
      creep.memory.requestingEnergy = true;
      creep.memory.waitingTicks = (creep.memory.waitingTicks || 0) + 1;

      creep.say("🙏 wait " + creep.memory.waitingTicks);
      // 可以在这里寻找最近的 Construction Site 靠近，以免离得太远
      // ...
    }
  },
};

module.exports = roleBuilder;
