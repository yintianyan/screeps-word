import Role from "../../ai/role";
import priorityModule from "../../config/priority";

export default class Builder extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  executeState() {
    // 0. Energy Crisis Check
    // If energy is extremely low, builders should pause to conserve energy
    // Unless they are building a critical structure (Spawn)
    const room = this.creep.room;
    const isCrisis =
      room.energyAvailable < 300 && !room.storage?.store[RESOURCE_ENERGY];

    // Check if we are building something critical
    let isCriticalTask = false;
    // @ts-ignore
    if (this.memory.working) {
      // Use priority module to find the best target
      const sites = this.creep.room.find(FIND_CONSTRUCTION_SITES);
      const bestSite = priorityModule.getBestTarget(sites, this.creep.pos);
      
      if (
        bestSite &&
        (bestSite.structureType === STRUCTURE_SPAWN ||
          bestSite.structureType === STRUCTURE_EXTENSION ||
          bestSite.structureType === STRUCTURE_TOWER)
      ) {
        isCriticalTask = true;
      }
    }

    if (isCrisis && !isCriticalTask) {
      // Sleep logic
      this.creep.say("💤 crisis");
      // Park off road to avoid blocking traffic
      // (Assuming moveModule is available via global or import, but Role base class has move wrapper)
      // Here we just use a simple random move if on road, or stay still.
      // Ideally use moveModule.parkOffRoad(this.creep);
      // But for now, just don't do anything consuming.
      return;
    }

    // @ts-ignore
    if (this.memory.working) {
      // === WORK ===
      // 1. Critical Repairs (Hits < 10%)
      const critical = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          s.hits < s.hitsMax * 0.1 && s.structureType !== STRUCTURE_WALL,
      });

      if (critical) {
        if (this.creep.repair(critical) === ERR_NOT_IN_RANGE) {
          this.move(critical, { visualizePathStyle: { stroke: "#ff0000" } });
        }
        return;
      }

      // 2. Build Construction Sites
      // Use priority logic instead of distance
      const sites = this.creep.room.find(FIND_CONSTRUCTION_SITES);
      const site = priorityModule.getBestTarget(sites, this.creep.pos);
      
      if (site) {
        if (this.creep.build(site) === ERR_NOT_IN_RANGE) {
          this.move(site, { visualizePathStyle: { stroke: "#ffffff" } });
        }
        return;
      }

      // 3. Maintenance (Roads/Containers < 80%)
      const maintenance = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_ROAD ||
            s.structureType === STRUCTURE_CONTAINER) &&
          s.hits < s.hitsMax * 0.8,
      });

      if (maintenance) {
        if (this.creep.repair(maintenance) === ERR_NOT_IN_RANGE) {
          this.move(maintenance, { visualizePathStyle: { stroke: "#00ff00" } });
        }
        return;
      }

      // 4. Nothing to do? Upgrade
      if (
        this.creep.upgradeController(
          this.creep.room.controller as StructureController,
        ) === ERR_NOT_IN_RANGE
      ) {
        // @ts-ignore
        this.move(this.creep.room.controller);
      }
    } else {
      // === GATHER ===
      // 0. Dropped Resources (High Priority for fast recovery)
      const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      if (dropped) {
        if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // 1. Containers/Storage
      const target = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          // @ts-ignore
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (target) {
        // Clear request flag if we found a target
        // @ts-ignore
        if (this.memory.requestingEnergy) delete this.memory.requestingEnergy;

        if (this.creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(target, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      } else {
        // === REQUEST DELIVERY ===
        // If no container nearby, signal Haulers
        // @ts-ignore
        this.memory.requestingEnergy = true;
        this.creep.say("📡 help");
        
        // Harvest fallback (only if desperate or early game)
        const source = this.creep.pos.findClosestByPath(FIND_SOURCES);
        if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
          this.move(source);
        }
      }
    }
  }
}
