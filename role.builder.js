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
      // 1. 优先维修：如果路上有损坏严重的建筑（耐久 < 50%），优先维修
      // 特别是 Container 和 Road
      const repairTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (object) =>
          (object.structureType === STRUCTURE_CONTAINER ||
            object.structureType === STRUCTURE_ROAD) &&
          object.hits < object.hitsMax * 0.5,
      });

      // 按损坏程度排序，优先修最烂的
      // 关键修改：按照 "Container优先 > 损坏比例" 的规则排序
      repairTargets.sort((a, b) => {
        // 如果一个是 Container，另一个不是，Container 优先
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

        // 否则按损坏比例排序
        return a.hits / a.hitsMax - b.hits / b.hitsMax;
      });

      if (repairTargets.length > 0) {
        if (creep.repair(repairTargets[0]) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, repairTargets[0], {
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
        return; // 如果在维修，就不去建造了
      }

      // 2. 其次建造
      const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
      if (targets.length) {
        // 使用 priorityModule 获取最佳目标
        const target = priorityModule.getBestTarget(targets, creep.pos);

        if (creep.build(target) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        // 如果没有建筑工地，去升级控制器，避免闲置
        if (
          creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, creep.room.controller, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
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

        if (
          creep.withdraw(nearbyContainer, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE
        ) {
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
          (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
          s.store[RESOURCE_ENERGY] > 0
      })[0];
      
      // 只有当房间能量充足时才从 Spawn/Extension 取能
      if (nearbySpawnOrExt && creep.room.energyAvailable > 300) {
          delete creep.memory.requestingEnergy;
          delete creep.memory.waitingTicks;
          
          if (creep.withdraw(nearbySpawnOrExt, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
              moveModule.smartMove(creep, nearbySpawnOrExt, { visualizePathStyle: { stroke: "#ffaa00" } });
          }
          return;
      }

      // 4. 如果都找不到，请求喂养
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
