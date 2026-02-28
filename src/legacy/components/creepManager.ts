import Harvester from "../modules/harvester/index";
import Hauler from "../modules/hauler/index";
import Upgrader from "../modules/upgrader/index";
import Builder from "../modules/builder/index";
import Scout from "../modules/roles/scout";
import RemoteHarvester from "../modules/roles/remoteHarvester";
import RemoteHauler from "../modules/roles/remoteHauler";
import RemoteReserver from "../modules/roles/remoteReserver";
import RemoteDefender from "../modules/roles/remoteDefender";
import SKGuard from "../modules/roles/skGuard";
import SKMiner from "../modules/roles/skMiner";
import SKHauler from "../modules/roles/skHauler";
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
    scout: Scout,
    remote_harvester: RemoteHarvester,
    remote_hauler: RemoteHauler,
    remote_reserver: RemoteReserver,
    remote_defender: RemoteDefender,
    sk_guard: SKGuard,
    sk_miner: SKMiner,
    sk_hauler: SKHauler,
  } as any,

  // 注册新角色
  register: function (roleName: string, roleClass: any) {
    this.roles[roleName] = roleClass;
  },

  // 作为全局模块运行
  run: function () {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.spawning) continue;

      // @ts-ignore
      const RoleDefinition = this.roles[creep.memory.role];
      if (RoleDefinition) {
        try {
          // Check if RoleDefinition is a class constructor or a simple object with run()
          // Class constructor is a function
          if (typeof RoleDefinition === "function") {
            // It's a class (OOP style)
            const roleInstance = new RoleDefinition(creep);
            roleInstance.run();
          } else if (typeof RoleDefinition.run === "function") {
            // It's a simple object (Functional style)
            RoleDefinition.run(creep);
          } else {
            // @ts-ignore
            if (!Memory._logFlood || Memory._logFlood !== Game.time) {
              console.log(
                `[Creeps] Warning: Invalid role definition for ${creep.memory.role}`,
              );
            }
          }

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
