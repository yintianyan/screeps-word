const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleHauler = require("role.hauler");

/**
 * 模块：Creeps
 * 执行所有 Creep 的逻辑
 */
const creepsModule = {
  // 作为全局模块运行
  run: function () {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.spawning) continue;

      try {
        if (creep.memory.role == "harvester") {
          roleHarvester.run(creep);
        } else if (creep.memory.role == "upgrader") {
          roleUpgrader.run(creep);
        } else if (creep.memory.role == "builder") {
          roleBuilder.run(creep);
        } else if (creep.memory.role == "hauler") {
          roleHauler.run(creep);
        }
      } catch (e) {
        // 防止日志刷屏，每 tick 每种角色只报错一次
        if (!Memory._logFlood || Memory._logFlood !== Game.time) {
          Memory._logFlood = Game.time;
          console.log(
            `[Creep] Error in ${creep.name} (${creep.memory.role}): ${e.stack}`,
          );
        }
      }
    }
  },
};

module.exports = creepsModule;
