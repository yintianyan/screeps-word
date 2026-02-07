const moveModule = require("module.move");

const roleUpgrader = {
  /** @param {Creep} creep **/
  run: function (creep) {
    if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] == 0) {
      creep.memory.upgrading = false;
      creep.say("🔄 harvest");
    }
    if (!creep.memory.upgrading && creep.store.getFreeCapacity() == 0) {
      creep.memory.upgrading = true;
      creep.say("⚡ upgrade");
    }

    if (creep.memory.upgrading) {
      // 工作状态：清除请求标志
      delete creep.memory.requestingEnergy;
      delete creep.memory.waitingTicks;

      if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
        moveModule.smartMove(creep, creep.room.controller, {
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    } else {
      // 1. 寻找最近的 Container 或 Storage
      // 优先从 Container/Storage 取货，不再死守 Controller 旁边，而是就近提取
      const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (target) {
        // 找到了目标，清除请求
        delete creep.memory.requestingEnergy;
        delete creep.memory.waitingTicks;

        if (creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 2. 如果没有 Container 或 Container 没货，检查是否有 Link (RCL 5+)
      // const controllerLink = ... (待实现)

      // 3. 如果都没有，原地等待 Hauler 喂养
      // 激活请求协议
      creep.memory.requestingEnergy = true;
      creep.memory.waitingTicks = (creep.memory.waitingTicks || 0) + 1;

      if (!creep.pos.inRangeTo(creep.room.controller, 3)) {
        // 如果离得太远，先走到 Controller 旁边待命
        moveModule.smartMove(creep, creep.room.controller, {
          visualizePathStyle: { stroke: "#ffffff" },
        });
      } else {
        // 到了位置，原地等待
        creep.say("🙏 wait " + creep.memory.waitingTicks);
        // 可以在这里做一个简单的动画或者记录等待时间
      }
    }
  },
};

module.exports = roleUpgrader;
