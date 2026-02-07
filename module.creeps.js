const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleHauler = require("role.hauler");

/**
 * Module: Creeps
 * Executes logic for all creeps
 */
const creepsModule = {
  // Run as a Global Module
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
        console.log(
          `[Creep] Error in ${creep.name} (${creep.memory.role}): ${e.stack}`,
        );
      }
    }
  },
};

module.exports = creepsModule;
