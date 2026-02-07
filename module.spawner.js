const populationModule = require("module.population");

/**
 * Module: Spawner
 * Handles all spawning logic
 */
const spawnerModule = {
    run: function(room) {
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        if (!spawn || spawn.spawning) {
            // Visualize spawning status
            if (spawn && spawn.spawning) {
                const spawningCreep = Game.creeps[spawn.spawning.name];
                spawn.room.visual.text(
                    "🛠️" + spawningCreep.memory.role,
                    spawn.pos.x + 1,
                    spawn.pos.y,
                    { align: "left", opacity: 0.8 }
                );
            }
            return;
        }

        // Count creeps (Using Cache would be better, but main.js used manual count)
        // Let's rely on populationModule.calculateTargets which uses Cache internally now
        
        // We need current counts to compare with targets
        // Let's implement a quick count using Game.creeps (global) or room.find
        const creeps = room.find(FIND_MY_CREEPS);
        const counts = {
            harvester: 0,
            upgrader: 0,
            builder: 0,
            hauler: 0
        };
        
        creeps.forEach(c => {
             // Pre-spawning check
             if (!c.spawning && c.ticksToLive < 100) return;
             if (counts[c.memory.role] !== undefined) {
                 counts[c.memory.role]++;
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
            const harvesters = creeps.filter(c => c.memory.role === 'harvester');
            const sourceCounts = {};
            sources.forEach(s => sourceCounts[s.id] = 0);
            harvesters.forEach(c => {
                if (c.memory.sourceId && (c.ticksToLive > 100 || c.spawning)) {
                    sourceCounts[c.memory.sourceId]++;
                }
            });
            
            let targetSource = sources.find(s => sourceCounts[s.id] < 2); // Hardcoded 2 per source
            let hasEmpty = sources.some(s => sourceCounts[s.id] === 0);
            
            const energyToUse = (counts.harvester === 0 || hasEmpty) 
                ? energyAvailable 
                : energyCapacity;

            if (targetSource) {
                const body = this.getBody(energyToUse, 'harvester');
                const name = 'Harvester' + Game.time;
                console.log(`[Spawner] Spawning ${name} for Source ${targetSource.id}`);
                spawn.spawnCreep(body, name, {
                    memory: { role: 'harvester', sourceId: targetSource.id }
                });
                return;
            }
        }
        
        // Emergency Upgrader
        if (counts.upgrader < 1 && room.controller.ticksToDowngrade < 4000) {
            spawn.spawnCreep(this.getBody(energyAvailable, 'upgrader'), 'Upgrader' + Game.time, {
                memory: { role: 'upgrader' }
            });
            return;
        }

        // Hauler
        if (counts.hauler < targets.hauler && counts.harvester > 0) {
            // Smart Source Assignment for Hauler
            const needs = populationModule.getHaulerNeeds(room);
            const haulers = creeps.filter(c => c.memory.role === 'hauler');
            const haulerCounts = {};
            haulers.forEach(c => {
                if (c.memory.sourceId) haulerCounts[c.memory.sourceId] = (haulerCounts[c.memory.sourceId] || 0) + 1;
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

            spawn.spawnCreep(this.getBody(energyAvailable, 'hauler'), 'Hauler' + Game.time, {
                memory: { role: 'hauler', sourceId: bestSourceId }
            });
            return;
        }

        // Upgrader
        if (counts.upgrader < targets.upgrader) {
            spawn.spawnCreep(this.getBody(energyCapacity, 'upgrader'), 'Upgrader' + Game.time, {
                memory: { role: 'upgrader' }
            });
            return;
        }

        // Builder
        if (counts.builder < targets.builder) {
            spawn.spawnCreep(this.getBody(energyCapacity, 'builder'), 'Builder' + Game.time, {
                memory: { role: 'builder' }
            });
            return;
        }
    },

    getBody: function(capacity, role) {
        // Copied from main.js logic
        if (role === "hauler") {
            if (capacity >= 300) return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
            return [CARRY, CARRY, MOVE];
        }
        if (role === "harvester") {
            if (capacity >= 1100) return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
            if (capacity >= 900) return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
            if (capacity >= 700) return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
            if (capacity >= 600) return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
            if (capacity >= 500) return [WORK, WORK, WORK, WORK, CARRY, MOVE];
            if (capacity >= 400) return [WORK, WORK, WORK, CARRY, MOVE];
            if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
            return [WORK, CARRY, MOVE];
        }
        if (role === "upgrader") {
            let isSuper = (capacity >= 800); // Simplified check
            if (isSuper && capacity >= 800) return [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
            if (capacity >= 550) return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE];
            if (capacity >= 300) return [WORK, WORK, CARRY, MOVE];
            return [WORK, CARRY, MOVE];
        }
        if (role === "builder") {
            if (capacity >= 550) return [WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
            if (capacity >= 300) return [WORK, CARRY, CARRY, MOVE, MOVE];
            return [WORK, CARRY, MOVE];
        }
        return [WORK, CARRY, MOVE];
    }
};

module.exports = spawnerModule;