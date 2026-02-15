import Kernel from "./ai/kernel";
import populationModule from "./components/populationManager";
import structurePlanner from "./modules/builder/structurePlanner";
import towerModule from "./modules/defender/tower";
import linkManager from "./components/linkManager";
import monitorModule from "./components/monitor";
import spawnerModule from "./components/spawnManager";
import creepsModule from "./components/creepManager";
import trafficModule from "./components/trafficManager";
import Lifecycle from "./components/roomManager";
import brainModule from "./ai/brainModule";

// [NEW] Dispatch System Modules
import { SupremeCommand } from "./ai/SupremeCommand";
import { EconomyCenter } from "./centers/EconomyCenter";
import { DefenseCenter } from "./centers/DefenseCenter";
import { SpawnCenter } from "./centers/SpawnCenter"; // [NEW]
import { GlobalDispatch } from "./ai/GlobalDispatch";
import { DataCenter } from "./centers/DataCenter";
import { RoomCollector } from "./modules/data/RoomCollector";
import { Dashboard } from "./visuals/Dashboard";
import { RemoteManager } from "./modules/remote/RemoteManager";
import scout from "./roles/scout";
import remoteHarvester from "./roles/remoteHarvester";
import remoteHauler from "./roles/remoteHauler";
import remoteReserver from "./roles/remoteReserver";
import remoteDefender from "./roles/remoteDefender";

// === 注册模块 ===

// 0. 大脑决策 - 房间级别 (最优先)
Kernel.register("brain", brainModule);
Kernel.register("supreme", SupremeCommand); // [NEW] Strategic AI

// 0.5 调度中心 (任务生成)
Kernel.register("economy", EconomyCenter); // [NEW]
Kernel.register("defense", DefenseCenter); // [NEW]
Kernel.register("spawn_center", SpawnCenter); // [NEW] Spawn Planning
Kernel.register("dispatch", GlobalDispatch); // [NEW] Task Assignment (Room Level)
Kernel.register("datacenter", DataCenter, "global"); // [NEW] Data Center

// 1. 核心逻辑 (人口 & 孵化) - 房间级别
Kernel.register("population", populationModule); // 仅计算
Kernel.register("lifecycle", Lifecycle); // 生命周期监控
Kernel.register("spawner", spawnerModule); // 孵化执行

// 2. 规划与建造 - 房间级别
Kernel.register("planner", structurePlanner);
Kernel.register("collector", RoomCollector); // [NEW] Data Collector
Kernel.register("dashboard", Dashboard); // [NEW] Visualization
Kernel.register("remote", RemoteManager); // [NEW] Remote Mining

// 3. 防御与监控 - 房间级别
Kernel.register("tower", towerModule);
Kernel.register("link", linkManager); // [NEW] Link Management
Kernel.register("monitor", monitorModule);
Kernel.register("traffic", trafficModule);

// 4. 全局逻辑 - 全局级别
// 注册新角色到 creepsModule
creepsModule.register("scout", scout);
creepsModule.register("remote_harvester", remoteHarvester);
creepsModule.register("remote_hauler", remoteHauler);
creepsModule.register("remote_reserver", remoteReserver);
creepsModule.register("remote_defender", remoteDefender);
Kernel.register("creeps", creepsModule, "global");

import taskCleanup from "./utils/taskCleanup";

// 主循环
export const loop = () => {
  // [One-off] Cleanup Tasks if requested
  if (Game.flags['cleanup']) {
      taskCleanup.run();
      Game.flags['cleanup'].remove();
  }

  // 1. 内存清理与初始化
  // ...

  // 2. 运行内核
  Kernel.run();
};
