const Kernel = require("core.kernel");
const populationModule = require("module.population");
const structurePlanner = require("module.structurePlanner");
const autoBuilder = require("module.autoBuilder");
const towerModule = require("module.tower");
const monitorModule = require("module.monitor");
const spawnerModule = require("module.spawner");
const creepsModule = require("module.creeps");

// === Register Modules ===

// 1. Core Logic (Population & Spawning) - Room Level
Kernel.register("population", populationModule); // Calculation only
Kernel.register("spawner", spawnerModule); // Spawning execution

// 2. Planning & Building - Room Level
Kernel.register("planner", structurePlanner);
Kernel.register("builder", autoBuilder);

// 3. Defense & Monitoring - Room Level
Kernel.register("tower", towerModule);
Kernel.register("monitor", monitorModule);

// 4. Global Logic - Global Level
Kernel.register("creeps", creepsModule, "global");

module.exports.loop = function () {
  // Run the Kernel
  Kernel.run();

  // Optional: Log Kernel Stats periodically
  if (Game.time % 20 === 0) {
    // console.log(Kernel.getReport());
  }
};
