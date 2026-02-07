/**
 * Lifecycle Management System
 * 
 * Responsibilities:
 * 1. Monitor Creep Health: Detects when TTL < 10% (150 ticks).
 * 2. Manage Replacement: Queues replacement spawns with memory inheritance.
 * 3. Logging & History: Tracks spawn events.
 */
const Lifecycle = {
    // Configuration
    config: {
        thresholdRatio: 0.1, // 10% life remaining triggers replacement
        checkInterval: 5,    // Run checks every 5 ticks to save CPU
        historyLength: 50
    },

    /**
     * Main run loop
     */
    run: function() {
        if (Game.time % this.config.checkInterval !== 0) return;

        this.initMemory();
        this.monitorCreeps();
        this.cleanupMemory();
    },

    initMemory: function() {
        if (!Memory.lifecycle) {
            Memory.lifecycle = {
                requests: {}, // creepName -> { role, memory, priority }
                history: [],
                registry: {}  // creepName -> status (NORMAL, PRE_SPAWNING)
            };
        }
    },

    /**
     * Scans all creeps to check for replacement needs
     */
    monitorCreeps: function() {
        const registry = Memory.lifecycle.registry;
        const requests = Memory.lifecycle.requests;

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            
            // Skip if already being handled
            if (registry[name] === 'PRE_SPAWNING') continue;
            if (creep.spawning) continue;

            const maxLife = 1500; // Standard creep life
            const threshold = maxLife * this.config.thresholdRatio; // 150 ticks

            if (creep.ticksToLive < threshold) {
                // Trigger Replacement
                console.log(`[Lifecycle] ⚠️ ${name} is dying (TTL: ${creep.ticksToLive}). Requesting replacement.`);
                
                registry[name] = 'PRE_SPAWNING';
                
                // Create Spawn Request
                requests[name] = {
                    role: creep.memory.role,
                    baseMemory: JSON.parse(JSON.stringify(creep.memory)), // Deep copy
                    priority: this.getPriority(creep.memory.role),
                    requestTime: Game.time
                };

                // Log
                this.logEvent(name, 'WARNING', `TTL < ${threshold}, requested replacement`);
            } else {
                registry[name] = 'NORMAL';
            }
        }
    },

    /**
     * Determines priority based on role
     */
    getPriority: function(role) {
        const priorities = {
            'harvester': 100,
            'hauler': 90,
            'upgrader': 50,
            'builder': 10
        };
        return priorities[role] || 1;
    },

    /**
     * Called by Spawner when a replacement is successfully spawned
     */
    notifySpawn: function(oldCreepName, newCreepName) {
        if (Memory.lifecycle.requests[oldCreepName]) {
            delete Memory.lifecycle.requests[oldCreepName];
            this.logEvent(oldCreepName, 'REPLACED', `Replacement spawned: ${newCreepName}`);
        }
    },

    /**
     * Cleans up dead creeps from registry
     */
    cleanupMemory: function() {
        const registry = Memory.lifecycle.registry;
        const requests = Memory.lifecycle.requests;

        for (const name in registry) {
            if (!Game.creeps[name]) {
                // Creep is dead
                if (requests[name]) {
                    // If request still exists, it means we failed to replace in time!
                    this.logEvent(name, 'FAILURE', 'Creep died before replacement could be spawned');
                    delete requests[name];
                }
                delete registry[name];
            }
        }
    },

    /**
     * Check if a creep counts towards population limits
     * Returns FALSE if the creep is dying and has requested a replacement
     * This allows the population counter to "make room" for the new one
     */
    isOperational: function(creep) {
        if (!Memory.lifecycle || !Memory.lifecycle.registry) return true;
        
        // If it's marked as PRE_SPAWNING, it effectively doesn't count, 
        // allowing the Spawner to create its replacement without hitting the cap.
        if (Memory.lifecycle.registry[creep.name] === 'PRE_SPAWNING') {
            return false;
        }
        return true;
    },

    /**
     * Get pending spawn requests
     */
    getRequests: function() {
        return Memory.lifecycle ? Memory.lifecycle.requests : {};
    },

    // === API & Logging ===

    logEvent: function(creepName, type, message) {
        const entry = {
            time: Game.time,
            creep: creepName,
            type: type,
            message: message
        };
        Memory.lifecycle.history.unshift(entry);
        if (Memory.lifecycle.history.length > this.config.historyLength) {
            Memory.lifecycle.history.pop();
        }
    },

    getHistory: function() {
        return Memory.lifecycle ? Memory.lifecycle.history : [];
    },

    getWarningList: function() {
        const list = [];
        const registry = Memory.lifecycle ? Memory.lifecycle.registry : {};
        for (const name in registry) {
            if (registry[name] === 'PRE_SPAWNING') {
                list.push({
                    name: name,
                    ttl: Game.creeps[name] ? Game.creeps[name].ticksToLive : 0
                });
            }
        }
        return list;
    }
};

module.exports = Lifecycle;