const moveModule = require("module.move");

const roleUpgrader = {
  /** @param {Creep} creep **/
  run: function (creep) {
    // === 危机模式检查 (Crisis Mode Check) ===
    // 如果房间处于能源危机，且 Controller 并不危险，停止工作以节省能源
    if (
      creep.room.memory.energyState === "CRISIS" &&
      creep.room.controller.ticksToDowngrade > 4000
    ) {
      creep.say("🚫 crisis");
      // 找个不碍事的地方呆着
      moveModule.parkOffRoad(creep);
      return;
    }

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

      // === 能量区间控制 (Energy Interval Control) ===
      // 只有当 Storage 能量充足时，才允许全力升级
      // 否则应该节约能量 (例如每 5 ticks 升级一次？或者只修不升？)
      // 但为了防止降级，我们至少保证最低限度的运作。
      // 此处主要依赖 Population 模块控制数量，但已存在的 Upgrader 也可以自我节制。

      let shouldUpgrade = true;
      if (creep.room.storage) {
        const storedPct =
          creep.room.storage.store[RESOURCE_ENERGY] /
          creep.room.storage.store.getCapacity(RESOURCE_ENERGY);
        if (storedPct < 0.3 && creep.room.controller.ticksToDowngrade > 4000) {
          // 极低能量且无降级风险：降低工作频率 (例如 50% 概率摸鱼)
          // 或者更直接：如果 bucket 低，或者单纯为了省能量
          if (Game.time % 2 !== 0) shouldUpgrade = false;
          creep.say("📉 saving");
        }
      }

      if (shouldUpgrade) {
        const controller = creep.room.controller;
        creep.upgradeController(controller);

        const range = creep.pos.getRangeTo(controller);
        // 尝试靠近控制器 (Range 1)，但如果在工作范围内 (Range <= 3) 且已经卡住，则原地定居避免反复 Swap
        if (range > 1) {
          const stuck = creep.memory._move ? creep.memory._move.stuckCount : 0;
          if (range > 3 || stuck < 2) {
            moveModule.smartMove(creep, controller, {
              range: 1,
              visualizePathStyle: { stroke: "#ffffff" },
            });
          } else {
            creep.say("🛑 settle");
            // 虽然停下了，但如果踩在路上，还是得挪挪窝
            moveModule.parkOffRoad(creep, controller, 3);
          }
        } else {
          // 已经到达 Range 1 (最佳位置)，检查是否踩在路上
          moveModule.parkOffRoad(creep, controller, 1);
        }
      }
    } else {
      // 1. 寻找最近的 Container 或 Storage
      // 优先从 Container/Storage 取货，不再死守 Controller 旁边，而是就近提取

      // === 能量区间控制 (Energy Interval Control) ===
      // 如果能量 < 30%，只允许从 Storage 取非常少量的能量 (或者只捡垃圾)
      // 但为了简单，我们限制它只在 Container/Storage 比较富裕时才取

      const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          s.store[RESOURCE_ENERGY] > 0 &&
          // 新增限制：如果该容器能量过低 (<300)，且房间整体缺能，就不要去抢搬运工的货了
          (s.store[RESOURCE_ENERGY] > 300 || creep.room.energyAvailable > 500),
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
        moveModule.parkOffRoad(creep, creep.room.controller, 3);
      }
    }
  },
};

module.exports = roleUpgrader;
