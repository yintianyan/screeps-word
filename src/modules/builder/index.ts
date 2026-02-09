import Role from "../../ai/role";
import priorityModule from "../../config/priority";

export default class Builder extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  executeState() {
    // 0. Energy Crisis Check
    // Use the central energy level from populationManager
    const energyLevel = this.creep.room.memory.energyLevel;
    const isCrisis = energyLevel === "CRITICAL";

    // Check if we are building something critical
    let isCriticalTask = false;
    if (this.memory.working) {
      // Use priority module to find the best target
      const sites = this.creep.room.find(FIND_CONSTRUCTION_SITES);
      const bestSite = priorityModule.getBestTarget(sites, this.creep.pos);

      if (bestSite) {
        // [NEW] Tag the work type
        this.memory.targetStructType = bestSite.structureType;

        if (
          bestSite.structureType === STRUCTURE_SPAWN ||
          bestSite.structureType === STRUCTURE_EXTENSION ||
          bestSite.structureType === STRUCTURE_TOWER
        ) {
          isCriticalTask = true;
        }

        // [NEW] Early Request Logic
        // If critical task and energy < 30%, request delivery immediately
        if (
          isCriticalTask &&
          this.creep.store[RESOURCE_ENERGY] <
            this.creep.store.getCapacity() * 0.3
        ) {
          this.memory.requestingEnergy = true;
          this.memory.priorityRequest = true;
          this.creep.say("📡 urgent");
        } else if (this.creep.store.getFreeCapacity() === 0) {
          // Clear flags if full
          delete this.memory.requestingEnergy;
          delete this.memory.priorityRequest;
        }
      } else {
        delete this.memory.targetStructType;
      }
    } else {
      // Not working (Gathering), clear priority if not empty (safety)
      // Actually, if gathering, we keep requestingEnergy if we set it.
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

    if (this.memory.working) {
      // === WORK ===
      // 1. Critical Repairs (Hits < 10% for non-walls, or < 1000 for walls/ramparts)
      const critical = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => {
          if (
            s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART
          ) {
            return s.hits < 1000;
          }
          return s.hits < s.hitsMax * 0.1;
        },
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

      // 4. Wall Fortification (Up to 50k)
      // Only do this if we have decent energy in the room to avoid stalling upgrade completely
      // But builder usually spawns when there is construction. If no construction,
      // it falls through here.
      const wallToFortify = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART) &&
          s.hits < 50000,
      });

      if (wallToFortify) {
        if (this.creep.repair(wallToFortify) === ERR_NOT_IN_RANGE) {
          this.move(wallToFortify, {
            visualizePathStyle: { stroke: "#0000ff" },
          });
        }
        return;
      }

      // 5. Nothing to do? Upgrade
      if (
        this.creep.upgradeController(
          this.creep.room.controller as StructureController,
        ) === ERR_NOT_IN_RANGE
      ) {
        this.move(this.creep.room.controller as StructureController);
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
          (s as StructureContainer | StructureStorage).store[RESOURCE_ENERGY] >
            0,
      });

      if (target) {
        // Clear request flag if we found a target
        if (this.memory.requestingEnergy) delete this.memory.requestingEnergy;

        if (this.creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(target, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      } else {
        // === REQUEST DELIVERY ===
        // If no container nearby, signal Haulers
        this.memory.requestingEnergy = true;
        this.creep.say("📡 help");

        // Optimize: Move towards the nearest Hauler with energy to meet halfway

        // 1. Check if any Hauler has targeted ME directly (True Love)
        const myHauler = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) =>
            c.memory.role === "hauler" && c.memory.targetId === this.creep.id,
        })[0];

        let targetHauler = myHauler;

        // 2. If no dedicated hauler, find closest one with energy (Fallback)
        if (!targetHauler) {
          targetHauler = this.creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) =>
              c.memory.role === "hauler" && c.store[RESOURCE_ENERGY] > 0,
          });
        }

        if (targetHauler) {
          // Found a hauler, reset wait
          this.memory.waitTicks = 0;

          // Only move if not in range to transfer (Range 1)
          // Stop moving if range is 1 to avoid dancing
          const range = this.creep.pos.getRangeTo(targetHauler);
          if (range > 1) {
            this.move(targetHauler, {
              visualizePathStyle: {
                stroke: "#00ff00",
                lineStyle: "dashed",
                opacity: 0.5,
              },
            });
            this.creep.say(myHauler ? "😍 meeting" : "🏃 chasing");
          }
        } else {
          // Harvest fallback (only if desperate or early game)
          // Only if NO haulers exist or are dead OR we have waited too long
          const haulersExist =
            this.creep.room.find(FIND_MY_CREEPS, {
              filter: (c) => c.memory.role === "hauler",
            }).length > 0;
          const waitTicks = this.memory.waitTicks || 0;
          const timeout = waitTicks > 50;

          if (!haulersExist || timeout) {
            if (timeout) this.creep.say("😤 timeout");

            const source = this.creep.pos.findClosestByPath(FIND_SOURCES);
            if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
              this.move(source);
            }
          } else {
            // Wait for hauler (idle)
            this.memory.waitTicks = waitTicks + 1;
            this.creep.say(`⏳ ${this.memory.waitTicks}`);
          }
        }
      }
    }
  }
}
