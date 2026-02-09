import Role from "../../ai/role";

export default class Upgrader extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  executeState() {
    if (this.memory.working) {
      // === UPGRADE ===
      if (
        this.creep.upgradeController(
          this.creep.room.controller as StructureController,
        ) === ERR_NOT_IN_RANGE
      ) {
        this.move(this.creep.room.controller as StructureController, {
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    } else {
      // === GATHER ===
      // 0. Dropped Resources (High Priority)
      const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      if (dropped) {
        if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // [ACTIVE DELIVERY CHECK]
      // If we are waiting for delivery (requestingEnergy), DO NOT move to source immediately.
      // Stay put or move to meeting point.
      // Check if there are active Haulers in the room
      const haulers = this.creep.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === "hauler" && c.ticksToLive > 50,
      });
      const hasActiveHaulers = haulers.length > 0;

      // 1. Link (if available and near controller)
      // 2. Storage
      // 3. Container
      // 4. Source (last resort, usually avoided)

      // In CRITICAL mode, do NOT withdraw from containers (save for Spawn)
      const energyLevel = this.creep.room.memory.energyLevel;
      const canWithdraw = energyLevel !== "CRITICAL";

      let target = null;
      if (canWithdraw) {
        // [Optimization] Prioritize Container with most energy, not just closest
        // Find all containers with energy
        const containers = this.creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            (s.structureType === STRUCTURE_CONTAINER ||
              s.structureType === STRUCTURE_STORAGE) &&
            (s as StructureContainer | StructureStorage).store[
              RESOURCE_ENERGY
            ] > 0,
        });

        if (containers.length > 0) {
          // Sort by amount / distance ratio?
          // Or just filter out low ones unless closest is the only one
          // Let's pick the one with > 500 energy first
          const richContainers = containers.filter(
            (s) => (s as StructureContainer).store[RESOURCE_ENERGY] > 500,
          );

          const candidatePool =
            richContainers.length > 0 ? richContainers : containers;
          target = this.creep.pos.findClosestByPath(candidatePool);
        }
      }

      // [NEW] If haulers exist, strictly avoid sources and rely on delivery/containers
      // Only go to source if NO haulers and NO containers
      const shouldWait = hasActiveHaulers && !target;

      if (target) {
        // Clear request flag if we found a target
        if (this.memory.requestingEnergy) delete this.memory.requestingEnergy;

        if (this.creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(target, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      } else if (shouldWait) {
        // === REQUEST DELIVERY ===
        // If no container nearby, signal Haulers
        this.memory.requestingEnergy = true;
        this.creep.say("📡 help");

        // Optimize: Move towards the nearest Hauler with energy to meet halfway
        // ... (Existing logic to find hauler) ...
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
          // Just wait. Don't go to source if haulers exist but are busy.
          this.memory.waitTicks = (this.memory.waitTicks || 0) + 1;
          this.creep.say(`⏳ ${this.memory.waitTicks}`);

          // Timeout fallback only if wait is EXTREME (> 150 ticks)
          if (this.memory.waitTicks > 150) {
            const source = this.creep.pos.findClosestByPath(FIND_SOURCES);
            if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
              this.move(source);
            }
          }
        }
      } else {
        // No haulers, no containers -> Go to source
        const source = this.creep.pos.findClosestByPath(FIND_SOURCES);
        if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
          this.move(source);
        }
      }
    }
  }
}
