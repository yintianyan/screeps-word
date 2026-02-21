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
    // [FIX] Don't wait for 100% full. If we have > 90% or plenty of energy (e.g. > 400), go deliver.
    // Especially if capacity is large.
    if (!this.memory.working) {
      const free = this.creep.store.getFreeCapacity();
      const used = this.creep.store.getUsedCapacity();
      // If full or mostly full (free < 50 which is 1 part)
      // Or if we have a decent load (> 400) and no nearby pile?
      if (free === 0 || (free < 50 && used > 0)) {
        this.memory.working = true;
        this.creep.say("🚚 deliver");
      }
    }

    // Opportunistic Pickup: If moving to collect/deliver and see dropped energy on/near position
    const dropped = this.creep.pos.lookFor(LOOK_RESOURCES)[0];
    if (dropped && dropped.resourceType === RESOURCE_ENERGY) {
      this.creep.pickup(dropped);
    }
    const tombstone = this.creep.pos.lookFor(LOOK_TOMBSTONES)[0];
    if (tombstone && tombstone.store[RESOURCE_ENERGY] > 0) {
      this.creep.withdraw(tombstone, RESOURCE_ENERGY);
    }
    const ruin = this.creep.pos.lookFor(LOOK_RUINS)[0];
    if (ruin && ruin.store[RESOURCE_ENERGY] > 0) {
      this.creep.withdraw(ruin, RESOURCE_ENERGY);
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
    if (this.memory.working) {
      // === DELIVER STATE ===
      const brain = Brain.getInstance(this.creep.room);
      const task = brain.getBestTask(this.creep);

      if (task) {
        const target = Game.getObjectById(task.targetId as Id<any>);
        if (target) {
          this.memory.targetId = target.id;
          if (
            this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            this.move(target, { visualizePathStyle: { stroke: "#ffffff" } });
          }
          return;
        }
      }
    } else {
      // === COLLECT STATE ===
      // 0. Receiver Link (Near Storage)
      const receiverLink = this.creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_LINK &&
          s.store[RESOURCE_ENERGY] > 0 &&
          ((this.creep.room.controller && s.pos.inRangeTo(this.creep.room.controller, 4)) ||
            s.pos.findInRange(FIND_MY_SPAWNS, 4).length > 0),
      })[0] as StructureLink | undefined;
      if (receiverLink) {
        if (this.creep.withdraw(receiverLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(receiverLink);
        }
        return;
      }

      // 0.5 Tombstones & Ruins
      const tombstone = this.creep.pos.findClosestByRange(FIND_TOMBSTONES, {
        filter: (t) => t.store[RESOURCE_ENERGY] > 50,
      });
      if (tombstone) {
        if (
          this.creep.withdraw(tombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          this.move(tombstone);
        }
        return;
      }
      const ruin = this.creep.pos.findClosestByRange(FIND_RUINS, {
        filter: (r) => r.store[RESOURCE_ENERGY] > 50,
      });
      if (ruin) {
        if (this.creep.withdraw(ruin, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(ruin);
        }
        return;
      }

      // 1. Dropped Resources
      const dropped = this.creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
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

      const container = this.creep.pos.findClosestByRange(containers);

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
