
import Harvester from "../modules/harvester/index";
import Hauler from "../modules/hauler/index";
import Upgrader from "../modules/upgrader/index";
import Builder from "../modules/builder/index";
import Logger from "../utils/logger";
import moveModule from "../utils/movement";

/**
 * 模块：Creeps (OOP Refactored)
 * 执行所有 Creep 的逻辑
 */
const creepsModule = {
  // 角色类映射
  roles: {
    harvester: Harvester,
    hauler: Hauler,
    upgrader: Upgrader,
    builder: Builder,
  } as any,

  // 作为全局模块运行
  run: function () {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.spawning) continue;

      // @ts-ignore
      const RoleClass = this.roles[creep.memory.role];
      if (RoleClass) {
        try {
          // 实例化并运行
          // 注意：频繁 new 可能会有微小的 GC 压力，但在 Screeps 中每 tick 都是全新的对象，所以这是标准做法
          const roleInstance = new RoleClass(creep);
          roleInstance.run();

          // 处理被动移动请求 (对穿)
          moveModule.handleRequests(creep);
        } catch (e: any) {
          // 防止日志刷屏，每 tick 每种角色只报错一次
          // @ts-ignore
          if (!Memory._logFlood || Memory._logFlood !== Game.time) {
            // @ts-ignore
            Memory._logFlood = Game.time;
            // @ts-ignore
            Logger.error(
              `Error in ${creep.name} (${(creep.memory as any).role}): ${e.stack}`,
              "Creeps",
            );
          }
        }
      }
    }
  },
};

export default creepsModule;
