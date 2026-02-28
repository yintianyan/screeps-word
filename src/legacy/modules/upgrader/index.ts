import Role from "../../ai/role";

export default class Upgrader extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  checkState() {
    if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
      this.memory.working = false;
      this.creep.say("🔄 gather");
    }
    if (!this.memory.working) {
      // Switch to working if full OR has enough energy (>50%) to do meaningful work
      // This prevents waiting forever if Hauler only delivers partial load
      if (
        this.creep.store.getFreeCapacity() === 0 ||
        this.creep.store.getUsedCapacity() >
          this.creep.store.getCapacity() * 0.5
      ) {
        this.memory.working = true;
        this.creep.say("⚡ work");
      }
    }
  }

  executeState() {
    if (this.memory.working) {
      // === UPGRADE ===
      // Clear request flag when working
      if (this.memory.requestingEnergy) delete this.memory.requestingEnergy;

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
      const dropped = this.creep.pos.findClosestByRange(
        FIND_DROPPED_RESOURCES,
        {
          filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
        },
      );
      if (dropped) {
        if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // [LOGISTICS PROTOCOL]
      // Level 3 Consumer: Active Support
      // Logic:
      // 1. Check Link (ControllerLink) - Preferred Source
      // 2. Check Storage/Container - Secondary Source
      // 3. Request Delivery - If no static source available

      // 1. Link (if available and near controller)
      if (this.creep.room.controller) {
        const link = this.creep.room.controller.pos.findInRange(
          FIND_STRUCTURES,
          3,
          {
            filter: (s) =>
              s.structureType === STRUCTURE_LINK &&
              s.store[RESOURCE_ENERGY] > 0,
          },
        )[0];
        if (link) {
          if (this.creep.withdraw(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            this.move(link);
          }
          return;
        }
      }

      // [ACTIVE DELIVERY CHECK]
      // Pre-fetch: If energy < 50%, start requesting early
      const energyRatio =
        this.creep.store.getUsedCapacity() / this.creep.store.getCapacity();
      const needsEnergy = energyRatio < 0.5;

      // If we are waiting for delivery (requestingEnergy), DO NOT move to source immediately.
      // Stay put or move to meeting point.
      // Check if there are active Haulers in the room
      const haulers = this.creep.room.find(FIND_MY_CREEPS, {
        filter: (c) =>
          c.memory.role === "hauler" && c.ticksToLive && c.ticksToLive > 50,
      });
      const hasActiveHaulers = haulers.length > 0;

      // 2. Storage / Container
      // In CRITICAL mode, do NOT withdraw from containers (save for Spawn)
      const energyLevel = this.creep.room.memory.energyLevel;
      const canWithdraw = energyLevel !== "CRITICAL";

      let target = null;
      if (canWithdraw) {
        const containers = this.creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            (s.structureType === STRUCTURE_CONTAINER ||
              s.structureType === STRUCTURE_STORAGE) &&
            (s as StructureContainer | StructureStorage).store[
              RESOURCE_ENERGY
            ] > 0,
        });

        if (containers.length > 0) {
          const richContainers = containers.filter(
            (s) => (s as StructureContainer).store[RESOURCE_ENERGY] > 500,
          );
          const candidatePool =
            richContainers.length > 0 ? richContainers : containers;
          target = this.creep.pos.findClosestByRange(candidatePool);
        }
      }

      // [NEW] If haulers exist, strictly avoid sources and rely on delivery/containers
      // Only go to source if NO haulers and NO containers
      const shouldWait = hasActiveHaulers && !target && needsEnergy;

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

        // Don't spam say, only on status change or low frequency
        if (Game.time % 5 === 0) this.creep.say("📡 help");

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

          // [FIX] Don't chase Hauler. Go to work spot and wait.
          // Hauler has Active Delivery task to come to us.
          const controller = this.creep.room.controller;
          if (controller && !this.creep.pos.inRangeTo(controller, 3)) {
            this.move(controller, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
            this.creep.say("📡 waiting");
          } else {
            // Already at work spot, just wait
            this.creep.say("📡 ready");
          }
        } else {
          // Just wait. Don't go to source if haulers exist but are busy.
          this.memory.waitTicks = (this.memory.waitTicks || 0) + 1;
          this.creep.say(`⏳ ${this.memory.waitTicks}`);

          // Timeout fallback only if wait is EXTREME (> 300 ticks)
          if (this.memory.waitTicks > 300) {
            const source = this.creep.pos.findClosestByRange(FIND_SOURCES);
            if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
              this.move(source);
            }
          }
        }
      } else {
        // No haulers, no containers -> Go to source
        const source = this.creep.pos.findClosestByRange(FIND_SOURCES);
        if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
          this.move(source);
        }
      }
    }
  }
}
