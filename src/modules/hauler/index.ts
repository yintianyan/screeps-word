import Role from "../../ai/role";
import Brain from "../../ai/decision";

export default class Hauler extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  checkState() {
    if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
      this.memory.working = false; // Go to Collect
      this.creep.say("🔄 collect");
    }
    if (!this.memory.working && this.creep.store.getFreeCapacity() === 0) {
      this.memory.working = true; // Go to Deliver
      this.creep.say("🚚 deliver");
    }

    // Opportunistic Pickup: If moving to collect/deliver and see dropped energy on/near position
    const dropped = this.creep.pos.lookFor(LOOK_RESOURCES)[0];
    if (dropped && dropped.resourceType === RESOURCE_ENERGY) {
      this.creep.pickup(dropped);
    }
  }

  executeState() {
    if (this.memory.working) {
      // === DELIVER STATE ===
      // Use Brain to find best delivery target
      // (Assuming Brain is available globally or we instantiate it temporarily)
      // Since Brain is stateful per tick, ideally it should be managed by Main.
      // For now, let's just create a temporary one or fallback to simple find

      // Note: In a real efficient system, Brain should be passed in or singleton.
      // Here we just use the logic directly or instantiate light version.
      const brain = new Brain(this.creep.room);
      brain.analyze();
      brain.generateTasks();

      const task = brain.getBestTask(this.creep);
      const energyLevel = this.creep.room.memory.energyLevel || "LOW";

      // 0. CRITICAL OVERRIDE: Strict Spawn/Extension Priority
      // If energy is CRITICAL, we ignore everything else until Spawn/Extensions are full.
      if (energyLevel === "CRITICAL") {
        const extensions = this.creep.room.find(FIND_MY_STRUCTURES, {
          filter: (s) =>
            (s.structureType === STRUCTURE_SPAWN ||
              s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        if (extensions.length > 0) {
          const target = this.creep.pos.findClosestByPath(extensions);
          if (target) {
            if (
              this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
            ) {
              this.move(target, {
                visualizePathStyle: { stroke: "#ffffff", strokeWidth: 0.5 },
              });
            }
            return;
          }
        }
      }

      // 1. High Priority: Spawn / Extension (From Brain)
      if (task && task.type === "transfer_spawn") {
        const target = Game.getObjectById(task.targetId as Id<any>);
        if (target) {
          const result = this.creep.transfer(target, RESOURCE_ENERGY);
          if (result === ERR_NOT_IN_RANGE) {
            this.move(target as Structure | { pos: RoomPosition }, {
              visualizePathStyle: { stroke: "#ffffff" },
            });
          }
          return;
        }
      }

      // 2. Medium Priority: Towers (Defense/Repair)
      // Only fill towers if NOT in CRITICAL mode (unless tower is empty/danger)
      if (energyLevel !== "CRITICAL") {
        const towers = this.creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            s.structureType === STRUCTURE_TOWER &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 100,
        });
        if (towers.length > 0) {
          const target = this.creep.pos.findClosestByPath(towers);
          if (target) {
            if (
              this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
            ) {
              this.move(target, { visualizePathStyle: { stroke: "#ff0000" } });
            }
            return;
          }
        }
      }

      // 2.1 [NEW] Active Delivery to Upgraders (Low Energy)
      // Only deliver if Upgrader is working and running low
      // DISABLE in CRITICAL mode
      if (energyLevel !== "CRITICAL") {
        const needyUpgraders = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) =>
            c.memory.role === "upgrader" &&
            c.memory.working &&
            c.store.getFreeCapacity(RESOURCE_ENERGY) >
              c.store.getCapacity() * 0.5 &&
            !c.pos.inRangeTo(this.creep.room.controller, 1), // Don't block controller spot? Actually fine.
        });

        if (needyUpgraders.length > 0) {
          const target = this.creep.pos.findClosestByPath(needyUpgraders);
          if (target) {
            if (
              this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
            ) {
              this.move(target, {
                visualizePathStyle: { stroke: "#00ff00", opacity: 0.5 },
              });
            }
            return;
          }
        }
      }

      // 2.2 [NEW] Active Delivery to Builders (Critical Projects)
      // Check if any builder is requesting energy or is working on critical site
      const needyBuilders = this.creep.room.find(FIND_MY_CREEPS, {
        filter: (c) =>
          c.memory.role === "builder" &&
          (c.memory.working || c.memory.requestingEnergy) &&
          c.store[RESOURCE_ENERGY] < c.store.getCapacity() * 0.3,
      });

      if (needyBuilders.length > 0) {
        const target = this.creep.pos.findClosestByPath(needyBuilders);
        if (target) {
          if (
            this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            this.move(target, {
              visualizePathStyle: { stroke: "#ffff00", opacity: 0.5 },
            });
          }
          return;
        }
      }

      // 3. User Request: Controller Container & Spawn Container
      // Find containers that are NOT near sources (Sink Containers)
      const sources = this.creep.room.find(FIND_SOURCES);
      const sinkContainers = this.creep.room.find(FIND_STRUCTURES, {
        filter: (s) => {
          if (s.structureType !== STRUCTURE_CONTAINER) return false;
          if (s.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return false;

          // Filter out Source Containers (Range <= 2)
          // Optimization: Cache this check or assume naming convention?
          // For now, geometry check.
          for (const source of sources) {
            if (s.pos.inRangeTo(source, 2)) return false;
          }

          // Check if near Controller (Range 3) or Spawn (Range 3)
          const nearController =
            this.creep.room.controller &&
            s.pos.inRangeTo(this.creep.room.controller, 3);
          const nearSpawn = s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0;

          return nearController || nearSpawn;
        },
      });

      if (sinkContainers.length > 0) {
        const target = this.creep.pos.findClosestByPath(sinkContainers);
        if (target) {
          if (
            this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            this.move(target, { visualizePathStyle: { stroke: "#00ffff" } });
          }
          return;
        }
      }

      // 4. Fallback: Storage
      if (this.creep.room.storage) {
        if (
          this.creep.transfer(this.creep.room.storage, RESOURCE_ENERGY) ===
          ERR_NOT_IN_RANGE
        ) {
          this.move(this.creep.room.storage);
        }
      }
    } else {
      // === COLLECT STATE ===
      // 1. Dropped Resources
      const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      if (dropped) {
        if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // 2. Containers (Source Containers Only)
      // Prioritize containers with most energy
      const sources = this.creep.room.find(FIND_SOURCES);
      const containers = this.creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 100 &&
          // Only collect from Source Containers
          sources.some((source) => s.pos.inRangeTo(source, 3)),
      });

      const container = this.creep.pos.findClosestByPath(containers);

      if (container) {
        if (
          this.creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          this.move(container, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // 3. Fallback: Help Harvest if Source has piles (handled by dropped logic)
      // or Wait near Source (parking)
      if (!dropped && !container) {
        // Move to a parking spot near source to avoid blocking spawn
        // Ideally, read sourceId from memory
        if (this.memory.sourceId) {
          const source = Game.getObjectById(this.memory.sourceId as Id<Source>);
          if (source && !this.creep.pos.inRangeTo(source, 3)) {
            this.move(source);
          }
        }
      }
    }
  }
}
