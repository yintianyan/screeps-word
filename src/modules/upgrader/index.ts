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

      // 1. Link (if available and near controller)
      // 2. Storage
      // 3. Container
      // 4. Source (last resort, usually avoided)

      // In CRITICAL mode, do NOT withdraw from containers (save for Spawn)
      const energyLevel = this.creep.room.memory.energyLevel;
      const canWithdraw = energyLevel !== "CRITICAL";

      let target = null;
      if (canWithdraw) {
        target = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: (s) =>
            (s.structureType === STRUCTURE_CONTAINER ||
                s.structureType === STRUCTURE_STORAGE) &&
            (s as StructureContainer | StructureStorage).store[RESOURCE_ENERGY] > 0,
        });
      }

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
        
        // While waiting, try to harvest if very desperate or early game
        if (this.creep.room.energyAvailable < 300 || !this.creep.room.storage) {
             const source = this.creep.pos.findClosestByPath(FIND_SOURCES);
             if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
               this.move(source);
             }
        }
      }
    }
  }
}
