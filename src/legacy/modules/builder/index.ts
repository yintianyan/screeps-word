import Role from "../../ai/role";
import StructureCache from "../../utils/structureCache";
import Brain from "../../ai/decision"; // Use Brain for tasks

export default class Builder extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  checkState() {
    if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
      this.memory.working = false;
      // Removed redundant say
    }
    if (!this.memory.working) {
      if (
        this.creep.store.getFreeCapacity() === 0 ||
        this.creep.store.getUsedCapacity() >
          this.creep.store.getCapacity() * 0.5
      ) {
        this.memory.working = true;
        // Removed redundant say
      }
    }
  }

  executeState() {
    const energyLevel = this.creep.room.memory.energyLevel;
    const isCrisis = energyLevel === "CRITICAL";

    // Check Brain Task first (e.g. Build)
    let isCriticalTask = false;
    let brainTaskTarget = null;

    if (this.memory.working) {
      // Optimization: Only check brain if we don't have a target or target is invalid
      // Or check every tick? Brain is cached now so cheap.
      const brain = Brain.getInstance(this.creep.room);
      const task = brain.getBestTask(this.creep);
      if (task) {
        const target = Game.getObjectById(task.targetId as Id<ConstructionSite>);
        if (target) {
          brainTaskTarget = target;
          // Tag critical
          if (
            target.structureType === STRUCTURE_SPAWN ||
            target.structureType === STRUCTURE_EXTENSION ||
            target.structureType === STRUCTURE_TOWER
          ) {
            isCriticalTask = true;
            this.memory.targetStructType = target.structureType;
          }
        }
      }

      // Priority Request Logic
      // Check once per 5 ticks to save CPU
      if (Game.time % 5 === 0) {
          if (
            isCriticalTask &&
            this.creep.store[RESOURCE_ENERGY] < this.creep.store.getCapacity() * 0.3
          ) {
            this.memory.requestingEnergy = true;
            this.memory.priorityRequest = true;
            this.creep.say("📡"); // Shorten say
          } else if (this.creep.store.getFreeCapacity() === 0) {
            delete this.memory.requestingEnergy;
            delete this.memory.priorityRequest;
          }
      }
    }

    if (isCrisis && !isCriticalTask) {
      if (this.creep.store[RESOURCE_ENERGY] === 0) {
        // this.creep.say("💤"); // Remove spam
        return;
      }
    }

    if (this.memory.working) {
      // === WORK ===
      
      // 0. Brain Task (Construction)
      if (brainTaskTarget) {
          if (this.creep.build(brainTaskTarget) === ERR_NOT_IN_RANGE) {
              this.move(brainTaskTarget, { visualizePathStyle: { stroke: "#ffffff" } });
          }
          return;
      }

      // 1. Critical Repairs
      // Use StructureCache + findClosestByRange
      const walls = StructureCache.getStructures(this.creep.room, STRUCTURE_WALL);
      const ramparts = StructureCache.getStructures(this.creep.room, STRUCTURE_RAMPART);
      // Combine and filter
      const criticalCandidates = [...walls, ...ramparts].filter(s => s.hits < 1000);
      
      // Also check other structures < 10%
      // Note: This might be heavy if we iterate ALL structures.
      // Let's stick to Road/Container for general repair, and Critical for others.
      // But critical repair logic usually implies "prevent decay".
      
      let target = this.creep.pos.findClosestByRange(criticalCandidates);
      
      if (target) {
        if (this.creep.repair(target) === ERR_NOT_IN_RANGE) {
          this.move(target, { visualizePathStyle: { stroke: "#ff0000" } });
        }
        return;
      }

      // 2. Build (Fallback if Brain didn't give task, though Brain should cover this)
      // Skip if Brain is working correctly.

      // 3. Maintenance (Roads/Containers < 80%)
      const roads = StructureCache.getStructures(this.creep.room, STRUCTURE_ROAD);
      const containers = StructureCache.getStructures(this.creep.room, STRUCTURE_CONTAINER);
      const maintenanceCandidates = [...roads, ...containers].filter(s => s.hits < s.hitsMax * 0.8);
      
      target = this.creep.pos.findClosestByRange(maintenanceCandidates);

      if (target) {
        if (this.creep.repair(target) === ERR_NOT_IN_RANGE) {
          this.move(target, { visualizePathStyle: { stroke: "#00ff00" } });
        }
        return;
      }

      // 4. Wall Fortification
      const fortifyCandidates = [...walls, ...ramparts].filter(s => s.hits < 50000);
      target = this.creep.pos.findClosestByRange(fortifyCandidates);

      if (target) {
        if (this.creep.repair(target) === ERR_NOT_IN_RANGE) {
          this.move(target, { visualizePathStyle: { stroke: "#0000ff" } });
        }
        return;
      }

      // 5. Upgrade
      if (
        this.creep.upgradeController(
          this.creep.room.controller as StructureController,
        ) === ERR_NOT_IN_RANGE
      ) {
        this.move(this.creep.room.controller as StructureController);
      }
    } else {
      // === GATHER ===
      // 0. Dropped Resources
      const dropped = this.creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      if (dropped) {
        if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // [ACTIVE DELIVERY CHECK]
      // Pre-fetch: If energy < 50%, start requesting early
      const energyRatio = this.creep.store.getUsedCapacity() / this.creep.store.getCapacity();
      const needsEnergy = energyRatio < 0.5;

      // 1. Containers/Storage
      const containers = StructureCache.getStructures(this.creep.room, STRUCTURE_CONTAINER) as StructureContainer[];
      const storage = this.creep.room.storage;
      
      const candidates = containers.filter(s => s.store[RESOURCE_ENERGY] > 0);
      if (storage && storage.store[RESOURCE_ENERGY] > 0) candidates.push(storage as any);
      
      const target = this.creep.pos.findClosestByRange(candidates);

      // Active Delivery Logic
      const haulers = StructureCache.getCreeps(this.creep.room, "hauler");
      const hasActiveHaulers = haulers.some(c => c.ticksToLive && c.ticksToLive > 50);
      
      // [LOGISTICS PROTOCOL] Builder Deadlock Prevention
      // Rule: If energy = 0 and no supply, MUST NOT block source.
      // Rule: Timeout 50 ticks (CRITICAL) or 300 ticks (NORMAL).
      // Priority Request: If targetStructType is SPAWN/EXTENSION/TOWER and energy < 30%.
      
      const criticalBuild = this.memory.targetStructType === STRUCTURE_SPAWN || 
                            this.memory.targetStructType === STRUCTURE_EXTENSION ||
                            this.memory.targetStructType === STRUCTURE_TOWER;
                            
      if (criticalBuild && energyRatio < 0.3) {
          this.memory.priorityRequest = true; // Signal Haulers for Level 1.5 Priority
      } else if (energyRatio > 0.8) {
          delete this.memory.priorityRequest; // Clear flag
      }

      // [FIX] Wait logic update:
      // Wait if: 
      // 1. We are empty (or nearly empty)
      // 2. We have active haulers
      // 3. We are NOT timing out
      
      // [FIX-2] Check if we actually HAVE a task.
      // If we are builder but NO construction site, we shouldn't wait for energy.
      // We should check Brain task or local targets.
      // If no brainTaskTarget (from checkState), then we are effectively idle or doing fallback repair/upgrade.
      // If doing fallback (repair/upgrade), we should probably fetch energy ourselves unless critical.
      // BUT if we are "Waiting", we might not have set brainTaskTarget yet because we are in GATHER state.
      // Let's re-check Brain task here to be sure we have work to do.
      
      let hasWork = false;
      const brain = Brain.getInstance(this.creep.room);
      const task = brain.getBestTask(this.creep);
      if (task) hasWork = true;
      else {
          // Check for fallback work (repair/upgrade)
          // If no construction sites, we might upgrade.
          // In that case, we should probably fetch energy ourselves to avoid blocking haulers who are busy with extensions?
          // Or should we still request?
          // If we are upgrading, we act like Upgrader. Upgraders request energy if Link/Container not available.
          // Let's be consistent: If we have work, we request.
          // Fallback work (Repair/Upgrade) counts as work.
          hasWork = true; 
      }

      const isEmpty = this.creep.store[RESOURCE_ENERGY] === 0;
      
      if (isEmpty && hasActiveHaulers && hasWork) {
          this.memory.requestingEnergy = true;
          this.memory.waitTicks = (this.memory.waitTicks || 0) + 1;
          
          if (Game.time % 5 === 0) this.creep.say("📡 help");
          
          const timeoutLimit = 50; // Short timeout to prevent deadlock
          
          if (this.memory.waitTicks > timeoutLimit) {
              // Fallback to self-harvest
              this.creep.say("😤 timeout");
              delete this.memory.requestingEnergy;
              this.memory.waitTicks = 0; // Reset
              
              const sources = StructureCache.getSources(this.creep.room);
              const source = this.creep.pos.findClosestByRange(sources);
              if (source) {
                 if(this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    this.move(source);
                 }
                 return;
              }
          }
          
          // Wait near construction site if possible (range 3)
          if (brainTaskTarget && !this.creep.pos.inRangeTo(brainTaskTarget, 3)) {
               this.move(brainTaskTarget, { range: 3 });
          }
          return; // Stop here, don't try to harvest
      } else {
          // Clear request if not empty
          if (!isEmpty) {
              delete this.memory.requestingEnergy;
              this.memory.waitTicks = 0;
          }
      }

      // Fallback Gather (if no haulers or timeout handled above)
      if (target) {
        if (this.creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(target, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      } else {
        // Go to source
        const sources = StructureCache.getSources(this.creep.room);
        const source = this.creep.pos.findClosestByRange(sources);
        if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
          this.move(source);
        }
      }
    }
  }
}
