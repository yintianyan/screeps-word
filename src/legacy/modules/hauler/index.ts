import Role from "../../ai/role";
import Brain from "../../ai/decision";

export default class Hauler extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  checkState() {
    // [FIX] Force working=true if Full
    if (this.creep.store.getFreeCapacity() === 0) {
        this.memory.working = true;
        this.creep.say("🚚 deliver");
    }

    if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
      this.memory.working = false; // Go to Collect
      this.creep.say("🔄 collect");
    }
    // [FIX] Don't wait for 100% full. If we have > 90% or plenty of energy (e.g. > 400), go deliver.
    // Especially if capacity is large.
    // But don't switch if we are still picking up (e.g. from a rich source).
    // Unless we are FULL.
    
    if (!this.memory.working) {
      const free = this.creep.store.getFreeCapacity();
      const used = this.creep.store.getUsedCapacity();
      const ratio = used / this.creep.store.getCapacity();
      
      // If FULL, switch. (Already handled above, but kept for logic flow if needed)
      if (free === 0) {
          this.memory.working = true;
          this.creep.say("🚚 deliver");
      } 
      // If MOSTLY FULL (>80%) AND we are IDLE (no task assigned), switch.
      // But Role.run() checks task FIRST. So if we are here, we have no task.
      // So yes, if we have no task and > 80%, deliver.
      else if (ratio > 0.8) {
          this.memory.working = true;
          this.creep.say("🚚 deliver");
      }
      // If SOME energy (>50%) AND no task AND no local resources?
      // Wait, executeState() handles "no local resources".
      // If we are in executeState (Collect) and find nothing, we idle.
      // So we should switch to deliver ONLY if we can't collect more?
      // Let's rely on `executeState` to switch if it finds nothing.
      // REMOVED the aggressive ratio > 0.5 switch here to prevent premature return.
    }

    // Opportunistic Pickup: If moving to collect/deliver and see dropped energy on/near position
    const dropped = this.creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 20
    })[0];
    
    if (dropped) {
        // If we are right on top, pickup is free (in terms of movement).
        // If we are next to it, we might need to move, which interrupts main task?
        // But if we are passing by, range 1 pickup is allowed.
        // Actually pickup() range is 1.
        if(this.creep.pickup(dropped) === OK) {
            this.creep.say("⚡ yoink");
        }
    }
    
    // Tombstone/Ruin pickup
    const tombstone = this.creep.pos.findInRange(FIND_TOMBSTONES, 1, {
        filter: (t) => t.store[RESOURCE_ENERGY] > 0
    })[0];
    if (tombstone) {
        if(this.creep.withdraw(tombstone, RESOURCE_ENERGY) === OK) {
             this.creep.say("⚰️ loot");
        }
    }
  }

  // Helper for opportunistic transfer
  private checkOpportunisticTransfer() {
    // Only if we have energy
    if (this.creep.store[RESOURCE_ENERGY] > 0) {
      const neighbors = this.creep.pos.findInRange(FIND_MY_CREEPS, 1);
      for (const neighbor of neighbors) {
        if (neighbor.id === this.creep.id) continue;
        // Only feed Upgraders/Builders who need energy
        if (
          (neighbor.memory.role === "upgrader" ||
            neighbor.memory.role === "builder") &&
          neighbor.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        ) {
          this.creep.transfer(neighbor, RESOURCE_ENERGY);
          this.creep.say("🤝 pass");
          break; // One transfer per tick
        }
      }
    }
  }

  // Override move to include opportunistic transfer during task execution
  move(target: RoomPosition | { pos: RoomPosition } | Structure, opts = {}) {
    this.checkOpportunisticTransfer();
    return super.move(target, opts);
  }

  executeState() {
    // [CRITICAL FIX] If GlobalDispatch assigned a task, Role.run() would have executed it and returned.
    // If we are here, it means NO DISPATCH TASK was found/assigned.
    // So we must rely on FALLBACK logic (Logistics Protocol).
    
    // First, sync state with inventory reality
    // [FIX] Hauler running without energy? 
    // If store == 0, FORCE Collect.
    if (this.creep.store[RESOURCE_ENERGY] === 0) {
        this.memory.working = false;
    } 
    // If Full, FORCE Deliver.
    else if (this.creep.store.getFreeCapacity() === 0) {
        this.memory.working = true;
    }
    
    // [FIX] Movement Logic
    // If we are IDLE (no task), we should NOT move randomly.
    // The previous code had `this.move(target)` which is fine.
    // But if no target found, we should stay put (idle) or move to parking?
    // "Hauler without energy running around" -> Likely stuck in a loop trying to go to a target that is invalid or switching states rapidly?
    // Or maybe "move(target)" is called but target is null? No, we check `if (bestTarget)`.
    
    // Check if we are stuck in a loop of "Deliver" -> "Collect" -> "Deliver" without doing anything?
    // We added the checkState logic to prevent premature switching.
    
    // What if we are in Collect mode, but no energy found?
    // We fall through to "Idle".
    
    // What if we are in Deliver mode (working=true) but have no energy?
    // The first check above fixes that.
    
    // What if we are in Deliver mode, have energy, but no target?
    // We fall through to Upgrader dump.
    
    if (this.memory.working) {
      // === DELIVER STATE (Fallback) ===
      
      // [Logistics Protocol Implementation]
      // 1. Scan targets
      const spawn = this.creep.room.find(FIND_MY_SPAWNS).filter(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
      const extensions = this.creep.room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0});
      const towers = this.creep.room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 200}); // Fill if < 800
      
      // Upgraders/Builders requesting
      const requesters = this.creep.room.find(FIND_MY_CREEPS, {
          filter: c => (c.memory.role === 'upgrader' || c.memory.role === 'builder') && 
                       (c.memory.requestingEnergy || (c.memory.role === 'upgrader' && c.store[RESOURCE_ENERGY] < 50))
      });
      
      // Storage
      const storage = this.creep.room.storage;
      
      // Score Targets
      // Priority: Spawn/Ext (200) > PriorityBuilder (150) > Tower (120) > Upgrader (100) > Storage (10)
      // [UPDATE] Prioritize Requesting Builders (150) over Upgraders (100)
      
      let bestTarget = null;
      let maxScore = -Infinity;
      
      const rate = (target: RoomObject, baseScore: number) => {
          const dist = this.creep.pos.getRangeTo(target);
          const score = baseScore - (dist * 0.5); // Distance penalty
          if (score > maxScore) {
              maxScore = score;
              bestTarget = target;
          }
      };
      
      spawn.forEach(s => rate(s, 200));
      extensions.forEach(s => rate(s, 200));
      requesters.forEach(c => {
          if (c.memory.priorityRequest) rate(c, 160); // Critical Build
          else if (c.memory.requestingEnergy) rate(c, 150); // Standard Request
          else if (c.memory.role === 'upgrader') rate(c, 100);
          else rate(c, 80);
      });
      towers.forEach(t => rate(t, 120));
      
      // [FIX] Always include Storage as a valid target (score 10) if store.getFreeCapacity() > 0
      if (storage && storage.store.getFreeCapacity() > 0) {
          rate(storage, 10);
      }
      
      if (bestTarget) {
          if (this.creep.transfer(bestTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
              this.move(bestTarget, { visualizePathStyle: { stroke: "#ffffff" } });
          }
          return;
      } else {
          console.log(`[Hauler] ${this.creep.name} - No target found in DELIVER state! Store: ${this.creep.store[RESOURCE_ENERGY]}`);
      }
      
      // Fallback: If nothing needs energy but we are full?
      // Just wait or go to parking?
      // Or dump to Upgrader anyway?
      // [FIX] Only dump to Upgrader if they have capacity AND we have no other target.
      // BUT if we are "waiting to unload", we shouldn't swarm the upgrader unless we intend to transfer.
      // If we are far away, we move. If we are close, we transfer.
      // If Upgrader is full, we shouldn't move there.
      
      // [NEW] Prioritize feeding Builders even if they didn't request?
      // Builders often run out and start moving to source.
      // If we see a Builder with < 50% energy, feed them proactively.
      
      const builders = this.creep.room.find(FIND_MY_CREEPS, {filter: c => c.memory.role === 'builder' && c.store.getFreeCapacity(RESOURCE_ENERGY) > 0});
      const hungryBuilder = this.creep.pos.findClosestByRange(builders);
      
      if (hungryBuilder) {
          if (this.creep.transfer(hungryBuilder, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
              this.move(hungryBuilder);
          }
          return;
      }

      const upgrader = this.creep.room.find(FIND_MY_CREEPS, {filter: c => c.memory.role === 'upgrader'})[0];
      if (upgrader && upgrader.store.getFreeCapacity() > 0) {
           // Only go if Upgrader actually needs energy (e.g. < 50%) OR if we have absolutely nothing else to do.
           // If Upgrader has > 90% energy, don't swarm them.
           if (upgrader.store.getUsedCapacity() < upgrader.store.getCapacity() * 0.9) {
               if (this.creep.transfer(upgrader, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                   this.move(upgrader);
               }
               return;
           }
      }
      
      // If we are here, we have energy but no valid target.
      // Go to Storage/Container/Spawn parking area?
      // Or just idle.
      this.creep.say("💤 wait");

    } else {
      // === COLLECT STATE (Fallback) ===
      
      // 2. Score Targets based on Yield
      let bestTarget = null;
      let maxScore = -Infinity;
      
      const rate = (target: RoomObject, amount: number) => {
          const dist = this.creep.pos.getRangeTo(target);
          // Score = Amount / (Distance + 5) 
          const score = amount / (dist + 5);
          if (score > maxScore) {
              maxScore = score;
              bestTarget = target;
          }
      };
      
      // Check Links (Source Links overflow?)
      const links = this.creep.room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_LINK && s.store[RESOURCE_ENERGY] > 0}) as StructureLink[];
      
      const linkMem = this.creep.room.memory.links || {};
      const hubId = linkMem.hub;
      const sourceIds = linkMem.source || [];
      const controllerId = linkMem.controller;

      links.forEach(l => {
          // [FIX] Link Logic
          // 1. Hub Link: Pick up if > 400 or if Spawn needs energy.
          // 2. Source Link: Pick up ONLY if overflowing (> 750).
          // 3. Controller Link: Pick up ONLY if overflowing (> 750).
          
          let valid = false;
          const spawnNeeds = this.creep.room.energyAvailable < this.creep.room.energyCapacityAvailable;
          
          if (l.id === hubId) {
              if (l.store[RESOURCE_ENERGY] >= 400 || (spawnNeeds && l.store[RESOURCE_ENERGY] > 0)) {
                  valid = true;
                  // High priority for Hub Link
                  rate(l, l.store[RESOURCE_ENERGY] * 2); 
                  return;
              }
          } else if (sourceIds.includes(l.id)) {
               if (l.store[RESOURCE_ENERGY] >= 750) {
                   valid = true;
                   // Lower priority than Hub
                   rate(l, l.store[RESOURCE_ENERGY]); 
                   return;
               }
          } else if (l.id === controllerId) {
               if (l.store[RESOURCE_ENERGY] >= 750) {
                   valid = true;
                   rate(l, l.store[RESOURCE_ENERGY]);
                   return;
               }
          } else {
               // Unknown Link (maybe new or not categorized yet)
               // Treat as normal source
               if (l.store[RESOURCE_ENERGY] > 0) {
                   valid = true;
                   rate(l, l.store[RESOURCE_ENERGY]);
               }
          }
      });

      // Check Containers
      const containers = this.creep.room.find(FIND_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 100
      }) as StructureContainer[];
      containers.forEach(c => rate(c, c.store[RESOURCE_ENERGY]));
      
      // Dropped
      const dropped = this.creep.pos.findInRange(FIND_DROPPED_RESOURCES, 20, {
          filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50
      });
      dropped.forEach(d => rate(d, d.amount * 1.5)); 
      
      if (bestTarget) {
          if (bestTarget instanceof StructureLink || bestTarget instanceof StructureContainer) {
               if (this.creep.withdraw(bestTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                   this.move(bestTarget);
               }
          } else if (bestTarget instanceof Resource) {
               if (this.creep.pickup(bestTarget) === ERR_NOT_IN_RANGE) {
                   this.move(bestTarget);
               }
          }
          return;
      }
      
      // [FIX] If no targets found, and we are empty, go to parking?
      // Or stay put.
      // Do NOT move to Storage unless we plan to withdraw.
      
      // Storage (Last resort for refilling Spawns?)
      const spawnNeeds = this.creep.room.energyAvailable < this.creep.room.energyCapacityAvailable;
      if (spawnNeeds && this.creep.room.storage && this.creep.room.storage.store[RESOURCE_ENERGY] > 0) {
           if (this.creep.withdraw(this.creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
               this.move(this.creep.room.storage);
           }
           return;
      }
      
      // Idle
      this.creep.say("💤 idle");
      // Optional: Move to parking spot to avoid blocking roads?
      // But stay near sources?
    }
  }
}
