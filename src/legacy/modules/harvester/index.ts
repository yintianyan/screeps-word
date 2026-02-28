import Role from "../../ai/role";

export default class Harvester extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  executeState() {
    // 0. Initialize Source
    if (!this.memory.sourceId) {
      this.assignSource();
    }

    const source = Game.getObjectById(this.memory.sourceId as Id<Source>);
    if (!source) return;

    // 1. Harvest
    if (this.creep.store.getFreeCapacity() > 0) {
      if (this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
        this.move(source, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    } else {
      // 2. Transfer (Full)
      // Check for Link/Container nearby
      const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      })[0];

      // [Optimization] Check for SourceLink (Static Mining)
      // Range 2 allows for slightly misplaced links, but ideally Range 1
      const link = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) =>
          s.structureType === STRUCTURE_LINK &&
          (s as StructureLink).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      })[0];

      // Priority: Link > Container > Drop
      // But if container is almost full, prioritize Link heavily to avoid clogging
      const containerNearFull =
        container &&
        (container as StructureContainer).store.getFreeCapacity(
          RESOURCE_ENERGY,
        ) < this.creep.store.getUsedCapacity(RESOURCE_ENERGY);

      // Link Transfer Logic
      if (link && (containerNearFull || this.creep.pos.inRangeTo(link, 1))) {
        // Only transfer if link is close enough (Range 1)
        // If Range 2, we might need to move?
        // Harvester should be static.
        // Assume Link is placed accessible.
        if (this.creep.transfer(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
           // Don't move if we are already at source!
           // Only move if we are not in range of source?
           // Actually, static miner stays at container pos.
           // If link is reachable, good. If not, don't break static pos.
           // Unless we can move 1 step, transfer, and move back? Too complex.
           // Just ignore if out of range.
        } else {
            return; // Transferred successfully
        }
      }

      if (container) {
        if (this.creep.pos.isEqualTo(container.pos)) {
             // We are standing on it, just drop (it goes into container)
             // Or explicit transfer to be safe
             this.creep.transfer(container, RESOURCE_ENERGY);
        } else {
             // Not standing on container? Move to it?
             // Static miner should be ON the container.
             // If we are harvesting but not on container, we should move there.
             // But 'executeState' handles harvest/transfer.
             // Let's assume movement is handled in 'Harvest' phase (move to source).
             // Here we just transfer.
             if (this.creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                 this.move(container);
             }
        }
      } else if (link) {
        if (this.creep.transfer(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(link); // Only move if no container
        }
      } else {
        // Fallback: Drop mining or wait for Hauler
        // [MODIFIED] Harvester should NOT call for Hauler.
        // Logic: Just drop it. Hauler logic handles pickup.
        // Exception: If critical emergency (no haulers), deliver to Spawn
        const haulers = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) => c.memory.role === "hauler",
        });
        
        // Only deliver if strictly 0 haulers exist AND room is in crisis
        if (haulers.length === 0 && this.creep.room.energyAvailable < 300) {
          // Self-deliver logic
          const spawn = this.creep.pos.findClosestByPath(FIND_MY_SPAWNS);
          if (spawn) {
              if(this.creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.move(spawn);
              }
              return;
          }
        }
        
        // Default: Drop Mining
        // Explicit drop to clear carry for next harvest
        this.creep.drop(RESOURCE_ENERGY);
      }
    }
  }

  assignSource() {
    const sources = this.creep.room.find(FIND_SOURCES);
    const harvesters = this.creep.room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "harvester" && c.id !== this.creep.id,
    });

    // Count existing assignments
    const assignments: Record<string, number> = {};
    sources.forEach((s) => (assignments[s.id] = 0));
    harvesters.forEach((c) => {
      if (c.memory.sourceId) {
        assignments[c.memory.sourceId] =
          (assignments[c.memory.sourceId] || 0) + 1;
      }
    });

    // Find source with minimum assignments
    let bestSource = sources[0];
    let minCount = Infinity;

    for (const source of sources) {
      const count = assignments[source.id];
      if (count < minCount) {
        minCount = count;
        bestSource = source;
      }
    }

    if (bestSource) {
      this.memory.sourceId = bestSource.id;
    }
  }
}
