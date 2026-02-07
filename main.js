const Kernel = require("core.kernel");
const populationModule = require("module.population");
const structurePlanner = require("module.structurePlanner");
const autoBuilder = require("module.autoBuilder");
const towerModule = require("module.tower");
const monitorModule = require("module.monitor");
const spawnerModule = require("module.spawner");
const creepsModule = require("module.creeps");
const trafficModule = require("module.traffic");
const Lifecycle = require("module.lifecycle");

// === 注册模块 ===

// 1. 核心逻辑 (人口 & 孵化) - 房间级别
Kernel.register("population", populationModule); // 仅计算
Kernel.register("lifecycle", Lifecycle); // 生命周期监控
Kernel.register("spawner", spawnerModule); // 孵化执行

// 2. 规划与建造 - 房间级别
Kernel.register("planner", structurePlanner);
Kernel.register("builder", autoBuilder);

// 3. 防御与监控 - 房间级别
Kernel.register("tower", towerModule);
Kernel.register("monitor", monitorModule);
Kernel.register("traffic", trafficModule);

// 4. 全局逻辑 - 全局级别
Kernel.register("creeps", creepsModule, "global");

module.exports.loop = function () {
  // 运行内核
  Kernel.run();

  // 可选：定期打印内核统计报告
  if (Game.time % 20 === 0) {
    // console.log(Kernel.getReport());
  }
};
