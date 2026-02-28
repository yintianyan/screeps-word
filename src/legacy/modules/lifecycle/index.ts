import PopulationManager from "./populationManager";
import BodyFactory from "./BodyFactory";
import config from "../../config/constants";
import StructureCache from "../../utils/structureCache";

/**
 * Lifecycle Management System
 * Refactored to separate concerns:
 * - Monitoring: Lifecycle.ts
 * - Targets: PopulationManager.ts
 * - Fabrication: BodyFactory.ts
 */
const Lifecycle = {
  // Config
  config: {
    thresholdRatio: 0.1, // 150 ticks
    checkInterval: 5,
    historyLength: 50,
  },

  /**
   * Main Loop
   */
  run: function (room: Room) {
    if (Game.time % this.config.checkInterval !== 0) return;

    this.initMemory();
    this.monitorCreeps(room);
    this.processSpawnQueue(room); // New: Centralized Spawn Execution
    this.cleanupMemory();
  },

  initMemory: function () {
    if (!Memory.lifecycle) {
      Memory.lifecycle = {
        requests: {}, // creepName -> request
        history: [],
        registry: {}, // creepName -> status
      };
    }
  },

  /**
   * Monitor Creeps for TTL and Population Control
   */
  monitorCreeps: function (room: Room) {
    const registry = Memory.lifecycle.registry;
    const requests = Memory.lifecycle.requests;

    // 1. Get Targets
    const targets = PopulationManager.calculateTargets(room);

    // 2. Count Current Population (Active + Spawning)
    const counts: Record<string, number> = {};
    const roomCreeps = StructureCache.getCreeps(room);
    
    // Initialize counts
    for(const role in targets) counts[role] = 0;

    roomCreeps.forEach((c) => {
      // Don't count pre-spawning (dying) creeps towards the cap
      // UNLESS they are still healthy.
      // Actually, if we mark them PRE_SPAWNING, we spawn a replacement.
      // So the "Active" count should technically include the replacement (which might be in spawn queue or spawning).
      // Let's count LIVING creeps that are NOT pre-spawning.
      if (registry[c.name] !== "PRE_SPAWNING") {
          counts[c.memory.role] = (counts[c.memory.role] || 0) + 1;
      }
    });
    
    // Also count pending requests in Spawn Queue
    // (We need to check Memory.dispatch.spawnQueue or similar if we have one)
    // Here we use `requests` as the queue.
    for (const name in requests) {
        const req = requests[name];
        counts[req.role] = (counts[req.role] || 0) + 1;
    }

    // 3. Check Each Creep
    for (const creep of roomCreeps) {
      const name = creep.name;
      if (registry[name] === "PRE_SPAWNING") continue;
      if (creep.spawning) continue;

      const threshold = 1500 * this.config.thresholdRatio;

      if (creep.ticksToLive && creep.ticksToLive < threshold) {
        // Renewal Check? (Not implemented, usually waste of energy)
        
        // Replacement Check
        const role = creep.memory.role;
        const target = targets[role] || 0;
        
        // If we have enough (or too many) active + pending, don't replace.
        // We already counted this creep as "Active" above.
        // If we mark it PRE_SPAWNING, count goes down by 1.
        // If (Count - 1) < Target, we need replacement.
        
        if ((counts[role] || 0) > target) {
             // Overpopulated. Let it die.
             console.log(`[Lifecycle] 🍂 ${name} (${role}) retiring naturally.`);
             registry[name] = "PRE_SPAWNING";
             continue;
        }

        // Request Replacement
        console.log(`[Lifecycle] ♻️ ${name} (${role}) requesting replacement.`);
        registry[name] = "PRE_SPAWNING";
        
        // Create Request
        requests[name] = {
            role: role,
            baseMemory: JSON.parse(JSON.stringify(creep.memory)),
            priority: this.getPriority(role),
            requestTime: Game.time
        };
        // Update count to prevent double request if loop continues (unlikely)
        counts[role]++;
      }
    }
    
    // 4. Missing Creep Check (Emergency / Initial Spawn)
    // If we are below target and NO creep exists (and no request pending), request one.
    for (const role in targets) {
        const target = targets[role];
        const current = counts[role] || 0;
        if (current < target) {
            // Need more!
            // Generate a unique ID for the request
            const reqId = `init_${role}_${Game.time}_${Math.random()}`;
            requests[reqId] = {
                role: role,
                baseMemory: { role: role, working: false, room: room.name },
                priority: this.getPriority(role),
                requestTime: Game.time
            };
            counts[role]++;
            console.log(`[Lifecycle] 🐣 Requesting new ${role} (Target ${target}, Current ${current})`);
        }
    }
  },

  getPriority: function (role: string): number {
    // const p = config.PRIORITY; // Removed unused var
    switch (role) {
      case "harvester": return 100; // Critical
      case "hauler": return 90;
      case "upgrader": return 50; // Logic fixed
      case "builder": return 40;
      case "scout": return 10;
      default: return 1;
    }
  },

  /**
   * Process Spawn Queue and Execute Spawning
   */
  processSpawnQueue: function (room: Room) {
      const spawns = StructureCache.getMyStructures(room, STRUCTURE_SPAWN) as StructureSpawn[];
      const freeSpawns = spawns.filter(s => !s.spawning);
      
      if (freeSpawns.length === 0) return;

      const requests = Memory.lifecycle.requests;
      const list = Object.keys(requests).map(k => ({id: k, ...requests[k]}));
      
      if (list.length === 0) return;

      // Sort by Priority (Desc) -> Time (Asc)
      list.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return a.requestTime - b.requestTime;
      });

      // Try to spawn top requests
      for (const spawn of freeSpawns) {
          if (list.length === 0) break;
          const req = list[0];
          
          // Body Generation
          const body = BodyFactory.generate(req.role, room.energyAvailable, room.energyCapacityAvailable);
          
          if (!body || body.length === 0) { // Check for empty body
              // Can't spawn yet (e.g. waiting for energy)
              // If critical (Harvester), we might have already returned a cheap body.
              // If null, it means we really can't spawn anything useful.
              // Wait for next tick.
              // [Throttled Log]
              if (Game.time % 5 === 0) console.log(`[Lifecycle] 🛑 Waiting for energy to spawn ${req.role}`);
              continue; 
          }
          
          // Name Generation
          const name = `${config.ROLE_PREFIX[req.role] || req.role}_${Game.time}`;
          
          // Execute Spawn
          const result = spawn.spawnCreep(body, name, {
              memory: req.baseMemory
          });
          
          if (result === OK) {
              console.log(`[Lifecycle] 🚀 Spawning ${name} (${req.role}) at ${spawn.name}`);
              // Remove request
              delete requests[req.id];
              list.shift();
              
              // Log
              this.logEvent(name, "SPAWN", `Spawned with ${body.length} parts`);
          } else {
              // Error (e.g. ERR_NOT_ENOUGH_ENERGY)
              // If critical, we should have used available energy. 
              // BodyFactory logic handles this (uses available if emergency).
              // So if we fail here, it's weird.
          }
      }
  },

  cleanupMemory: function () {
    const registry = Memory.lifecycle.registry;
    // const requests = Memory.lifecycle.requests; // Removed unused var

    for (const name in registry) {
      if (!Game.creeps[name]) {
        delete registry[name];
      }
    }

    // Global Creep Memory Cleanup
    for (const name in Memory.creeps) {
      if (!Game.creeps[name]) {
        delete Memory.creeps[name];
        // Throttled log
        if (Game.time % 10 === 0) console.log(`[Lifecycle] 🧹 Clearing memory for deceased creep: ${name}`);
      }
    }
  },

  logEvent: function (creepName: string, type: string, message: string) {
    const entry = {
      time: Game.time,
      creep: creepName,
      type: type,
      message: message,
    };
    Memory.lifecycle.history.unshift(entry);
    if (Memory.lifecycle.history.length > this.config.historyLength) {
      Memory.lifecycle.history.pop();
    }
  }
};

export default Lifecycle;
