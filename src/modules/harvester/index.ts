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

      const link = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) =>
          s.structureType === STRUCTURE_LINK &&
          (s as StructureLink).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      })[0];

      const containerNearFull =
        container &&
        (container as StructureContainer).store.getFreeCapacity(
          RESOURCE_ENERGY,
        ) < this.creep.store.getUsedCapacity(RESOURCE_ENERGY);

      if (link && (containerNearFull || this.creep.pos.inRangeTo(link, 1))) {
        if (this.creep.transfer(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(link);
        }
        return;
      }

      if (container) {
        if (
          this.creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          this.move(container);
        }
      } else if (link) {
        if (this.creep.transfer(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(link);
        }
      } else {
        // Fallback: Drop mining or wait for Hauler
        // Or if emergency (no haulers), deliver to Spawn
        const haulers = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) => c.memory.role === "hauler",
        });
        if (haulers.length === 0) {
          // Self-deliver logic
          const spawn = this.creep.pos.findClosestByPath(FIND_MY_SPAWNS);
          if (
            spawn &&
            this.creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            this.move(spawn);
          }
        } else {
          // Drop Mining
          // Just stay there, energy drops automatically when full and harvesting
          // But explicit drop can help logic clarity
          this.creep.drop(RESOURCE_ENERGY);
        }
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
