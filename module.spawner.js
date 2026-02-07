const populationModule = require("module.population");
const Lifecycle = require("module.lifecycle");

/**
 * Module: Spawner
 * Handles all spawning logic
 */
const spawnerModule = {
  run: function (room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) {
      // Visualize spawning status
      if (spawn && spawn.spawning) {
        const spawningCreep = Game.creeps[spawn.spawning.name];
        spawn.room.visual.text(
          "🛠️" + spawningCreep.memory.role,
          spawn.pos.x + 1,
          spawn.pos.y,
          { align: "left", opacity: 0.8 },
        );
      }
      return;
    }

    // 1. Process Lifecycle Replacement Requests (Highest Priority)
    const lifecycleRequests = Lifecycle.getRequests();
    let bestRequest = null;
    let requestCreepName = null;

    for (const name in lifecycleRequests) {
      const req = lifecycleRequests[name];
      // Filter requests for this room only? (Assuming global memory, need to check creep room)
      // Ideally we check if the dying creep belongs to this room
      const dyingCreep = Game.creeps[name];
      if (dyingCreep && dyingCreep.room.name === room.name) {
        if (!bestRequest || req.priority > bestRequest.priority) {
          bestRequest = req;
          requestCreepName = name;
        }
      }
    }

    if (bestRequest) {
      const energyAvailable = room.energyAvailable;
      const energyCapacity = room.energyCapacityAvailable;

      // Determine energy budget (Emergency if harvester)
      // Use Lifecycle.isOperational to properly detect if we are effectively out of harvesters
      const operationalHarvesters = room.find(FIND_MY_CREEPS, {
        filter: (c) =>
          c.memory.role === "harvester" && Lifecycle.isOperational(c),
      });
      const isEmergency =
        bestRequest.role === "harvester" && operationalHarvesters.length <= 1;
      const energyToUse = isEmergency ? energyAvailable : energyCapacity;

      const body = this.getBody(energyToUse, bestRequest.role);
      const newName =
        bestRequest.role.charAt(0).toUpperCase() +
        bestRequest.role.slice(1) +
        Game.time;

      // Inherit memory but reset operational state
      const newMemory = bestRequest.baseMemory;
      newMemory.predecessorId = requestCreepName; // Link to old creep
      delete newMemory.hauling; // Reset state
      delete newMemory.upgrading;
      delete newMemory.building;
      delete newMemory._move; // Reset move cache

      const result = spawn.spawnCreep(body, newName, { memory: newMemory });

      if (result === OK) {
        console.log(
          `[Spawner] ♻️ Executing Lifecycle Replacement: ${requestCreepName} -> ${newName}`,
        );
        Lifecycle.notifySpawn(requestCreepName, newName);
        return; // Done for this tick
      }
    }

    // 2. Standard Population Check
    // Count creeps using Lifecycle.isOperational to avoid double counting replacing creeps
    const creeps = room.find(FIND_MY_CREEPS);
    const counts = {
      harvester: 0,
      upgrader: 0,
      builder: 0,
      hauler: 0,
    };

    creeps.forEach((c) => {
      // Use Lifecycle to determine if this creep counts as "Active"
      if (Lifecycle.isOperational(c)) {
        if (counts[c.memory.role] !== undefined) {
          counts[c.memory.role]++;
        }
      }
    });

    const targets = populationModule.calculateTargets(room);

    // Spawn Logic
    const energyAvailable = room.energyAvailable;
    const energyCapacity = room.energyCapacityAvailable;

    // Emergency check logic for energyToUse
    // If 0 harvesters or empty source, use available energy
    let hasEmptySource = false;
    // ... (This logic is duplicated from main.js, let's simplify)
    // Actually, main.js logic for 'energyToUse' was specific to Harvester

    if (counts.harvester < targets.harvester) {
      // Determine energy to use
      // If any source has 0 harvesters, use current energy
      // We need to check per source distribution again?
      // module.population.calculateTargets does not return per-source distribution
      // But main.js did check it.
      // For now, let's assume if global count < target, we check emergency

      // Re-implement the "Empty Source" check from main.js
      const sources = room.find(FIND_SOURCES);
      const harvesters = creeps.filter((c) => c.memory.role === "harvester");
      const sourceCounts = {};
      sources.forEach((s) => (sourceCounts[s.id] = 0));

      // Count using Lifecycle.isOperational
      harvesters.forEach((c) => {
        if (c.memory.sourceId && Lifecycle.isOperational(c)) {
          sourceCounts[c.memory.sourceId]++;
        }
      });

      // Find a source with 0 harvesters (Target is 1 now)
      let targetSource = sources.find((s) => sourceCounts[s.id] < 1);
      let hasEmpty = sources.some((s) => sourceCounts[s.id] === 0);

      const energyToUse =
        counts.harvester === 0 || hasEmpty ? energyAvailable : energyCapacity;

      if (targetSource) {
        const body = this.getBody(energyToUse, "harvester");
        const name = "Harvester" + Game.time;
        console.log(`[Spawner] Spawning ${name} for Source ${targetSource.id}`);
        spawn.spawnCreep(body, name, {
          memory: { role: "harvester", sourceId: targetSource.id },
        });
        return;
      }
    }

    // Emergency Upgrader
    if (counts.upgrader < 1 && room.controller.ticksToDowngrade < 4000) {
      spawn.spawnCreep(
        this.getBody(energyAvailable, "upgrader"),
        "Upgrader" + Game.time,
        {
          memory: { role: "upgrader" },
        },
      );
      return;
    }

    // Hauler
    if (counts.hauler < targets.hauler && counts.harvester > 0) {
      // Smart Source Assignment for Hauler
      const needs = populationModule.getHaulerNeeds(room);
      const haulers = creeps.filter((c) => c.memory.role === "hauler");
      const haulerCounts = {};
      haulers.forEach((c) => {
        if (c.memory.sourceId)
          haulerCounts[c.memory.sourceId] =
            (haulerCounts[c.memory.sourceId] || 0) + 1;
      });

      let bestSourceId = null;
      let maxDeficit = -999;
      for (const id in needs) {
        const deficit = needs[id] - (haulerCounts[id] || 0);
        if (deficit > maxDeficit) {
          maxDeficit = deficit;
          bestSourceId = id;
        }
      }
      if (!bestSourceId) bestSourceId = sources[0].id;

      spawn.spawnCreep(
        this.getBody(energyAvailable, "hauler"),
        "Hauler" + Game.time,
        {
          memory: { role: "hauler", sourceId: bestSourceId },
        },
      );
      return;
    }

    // Upgrader
    if (counts.upgrader < targets.upgrader) {
      spawn.spawnCreep(
        this.getBody(energyCapacity, "upgrader"),
        "Upgrader" + Game.time,
        {
          memory: { role: "upgrader" },
        },
      );
      return;
    }

    // Builder
    if (counts.builder < targets.builder) {
      spawn.spawnCreep(
        this.getBody(energyCapacity, "builder"),
        "Builder" + Game.time,
        {
          memory: { role: "builder" },
        },
      );
      return;
    }
  },

  getBody: function (capacity, role) {
    // Copied from main.js logic
    if (role === "hauler") {
      if (capacity >= 300) return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
      return [CARRY, CARRY, MOVE];
    }
    if (role === "harvester") {
      if (capacity >= 1100)
        return [
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          CARRY,
          MOVE,
        ];
      if (capacity >= 900)
        return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 700)
        return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 600) return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 500) return [WORK, WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 400) return [WORK, WORK, WORK, CARRY, MOVE];
      if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
      return [WORK, CARRY, MOVE];
    }
    if (role === "upgrader") {
      let isSuper = capacity >= 800; // Simplified check
      if (isSuper && capacity >= 800)
        return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
      if (capacity >= 550) return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE];
      if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
      return [WORK, CARRY, MOVE];
    }
    if (role === "builder") {
      if (capacity >= 550)
        return [WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
      if (capacity >= 300) return [WORK, CARRY, CARRY, MOVE, MOVE];
      return [WORK, CARRY, MOVE];
    }
    return [WORK, CARRY, MOVE];
  },
};

module.exports = spawnerModule;
