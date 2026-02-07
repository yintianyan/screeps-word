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
      if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
        moveModule.smartMove(creep, creep.room.controller, {
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    } else {
      // === 严格的定点工作模式 ===
      // Upgrader 不再四处寻找能量，而是只从 Controller 附近的 Container 取货
      // 如果没有，就原地等待 Hauler 喂养

      // 1. 优先从 Controller Container 取能量 (距离 Controller Range 3 以内的 Container)
      const controllerContainer = creep.room.controller.pos.findInRange(
        FIND_STRUCTURES,
        3,
        {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
        },
      )[0];

      if (controllerContainer) {
        if (
          creep.withdraw(controllerContainer, RESOURCE_ENERGY) ==
          ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, controllerContainer, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 2. 如果没有 Container 或 Container 没货，检查是否有 Link (RCL 5+)
      // const controllerLink = ... (待实现)

      // 3. 如果都没有，原地等待 Hauler 喂养
      // 为了让 Hauler 知道我们需要喂养，我们可以设置一个标志位或者仅仅依靠 store == 0
      // 只要我们离 Controller 很近，Hauler 就会根据逻辑来喂我们

      if (!creep.pos.inRangeTo(creep.room.controller, 3)) {
        // 如果离得太远，先走到 Controller 旁边待命
        moveModule.smartMove(creep, creep.room.controller, {
          visualizePathStyle: { stroke: "#ffffff" },
        });
      } else {
        // 到了位置，原地等待
        creep.say("🙏 wait");
        // 可以在这里做一个简单的动画或者记录等待时间
      }
    }
  },
};

module.exports = roleUpgrader;
