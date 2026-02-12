import moveModule from "../utils/movement";
import { GlobalDispatch } from "./GlobalDispatch";
import { Task, TaskType } from "../types/dispatch";

/**
 * @typedef {Object} Task
 * @property {string} id - Unique task ID
 * @property {string} type - Task type (e.g., 'harvest', 'build')
 * @property {string} targetId - Target game object ID
 * @property {number} priority - Calculated priority score
 * @property {Object} [data] - Additional data
 */

export default class Role {
  creep: Creep;
  memory: CreepMemory;

  /**
   * @param {Creep} creep
   */
  constructor(creep: Creep) {
    this.creep = creep;
    this.memory = creep.memory;
  }

  /**
   * Main execution loop
   */
  run() {
    if (this.creep.spawning) return;

    try {
      // 0. Check for Dispatched Task
      const task = GlobalDispatch.getAssignedTask(this.creep);
      if (task) {
        this.runTask(task);
        return;
      }

      // 1. Check state transitions (Legacy)
      this.checkState();

      // 2. Execute current state logic (Legacy)
      this.executeState();
    } catch (e: any) {
      console.log(`[Role] Error in ${this.creep.name}: ${e.stack}`);
    }
  }

  /**
   * Execute assigned task
   */
  runTask(task: Task) {
    const target = Game.getObjectById(task.targetId) as any;

    // Validation
    if (!target && !task.pos) {
      console.log(`[Role] Task ${task.id} invalid target`);
      GlobalDispatch.completeTask(task.id, this.creep.id); // Abort
      return;
    }

    const pos = target ? target.pos : task.pos;

    // Movement
    if (
      !this.creep.pos.inRangeTo(
        pos,
        task.type === TaskType.HARVEST || task.type === TaskType.ATTACK ? 1 : 3,
      )
    ) {
      this.move(pos);
      // Continue to try action if in range (e.g. range 3 for build/repair/upgrade)
    }

    // Action Execution
    let result: number = OK;
    switch (task.type) {
      case TaskType.HARVEST:
        if (target instanceof Source || target instanceof Mineral) {
          result = this.creep.harvest(target as Source);
          // Sticky Task: Do not complete even if full (handled by link/container)
          // Only if no capacity and no link nearby?
          // For now, let Harvester be simple.
        }
        break;
      case TaskType.HAUL:
      case TaskType.TRANSFER:
        if (target instanceof Structure || target instanceof Creep) {
          result = this.creep.transfer(
            target as AnyCreep | Structure,
            task.data?.resource || RESOURCE_ENERGY,
          );
        }
        if (result === OK || result === ERR_FULL) {
          // Job done if empty or target full
          const targetStruct = target as AnyStoreStructure;
          if (
            this.creep.store.getUsedCapacity() === 0 ||
            (targetStruct.store &&
              targetStruct.store.getFreeCapacity(
                task.data?.resource || RESOURCE_ENERGY,
              ) === 0)
          ) {
            GlobalDispatch.completeTask(task.id, this.creep.id);
          }
        }
        break;
      case TaskType.PICKUP:
        if (target instanceof Resource) {
          result = this.creep.pickup(target);
        } else if (target instanceof Structure) {
          // Withdraw from container
          result = this.creep.withdraw(
            target as Structure,
            task.data?.resource || RESOURCE_ENERGY,
          );
        }
        // Check if done
        if (result === OK || result === ERR_FULL) {
          if (this.creep.store.getFreeCapacity() === 0) {
            GlobalDispatch.completeTask(task.id, this.creep.id);
            // [PREDICTIVE] Auto-assign a TRANSFER task?
            // Ideally Dispatch should see an idle full creep and assign transfer.
          }
        }
        break;
      case TaskType.BUILD:
        if (target instanceof ConstructionSite) {
          result = this.creep.build(target);
        }
        if (this.creep.store.getUsedCapacity() === 0) {
          // Keep task but need refill.
          // For now, simple logic: drop task to refill
          GlobalDispatch.completeTask(task.id, this.creep.id);
        }
        break;
      case TaskType.REPAIR:
        if (target instanceof Structure) {
          result = this.creep.repair(target);
        }
        if (
          this.creep.store.getUsedCapacity() === 0 ||
          (target as Structure).hits === (target as Structure).hitsMax
        ) {
          GlobalDispatch.completeTask(task.id, this.creep.id);
        }
        break;
      case TaskType.UPGRADE:
        if (target instanceof StructureController) {
          result = this.creep.upgradeController(target);
        }
        if (this.creep.store.getUsedCapacity() === 0) {
          // For upgrader, we might want to keep task and just say "Needs Energy"
          // But for dispatch simplicity, drop task -> Refill -> Reassign Upgrade
          GlobalDispatch.completeTask(task.id, this.creep.id);
        }
        break;
      case TaskType.ATTACK:
        if (target instanceof Creep || target instanceof Structure) {
          result = this.creep.attack(target as AnyCreep | Structure);
        }
        break;
      case TaskType.HEAL:
        if (target instanceof Creep) {
          result = this.creep.heal(target);
        }
        break;
    }

    if (result === ERR_NOT_IN_RANGE) {
      this.move(pos);
    } else if (result !== OK && result !== ERR_TIRED) {
      // Log error or finish task if done
      if (
        result === ERR_FULL ||
        result === ERR_NOT_ENOUGH_RESOURCES ||
        result === ERR_INVALID_TARGET
      ) {
        GlobalDispatch.completeTask(task.id, this.creep.id);
      }
    }
  }

  /**
   * Check and switch states (to be overridden)
   */
  checkState() {
    // Default implementation: Toggle working state
    if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
      this.memory.working = false;
      this.creep.say("🔄 gather");
    }
    if (!this.memory.working && this.creep.store.getFreeCapacity() === 0) {
      this.memory.working = true;
      this.creep.say("⚡ work");
    }
  }

  /**
   * Execute logic based on state (to be overridden)
   */
  executeState() {
    // Abstract method
  }

  /**
   * Wrapper for smart move
   * @param {RoomPosition|{pos: RoomPosition}|Structure} target
   * @param {Object} opts
   */
  move(target: RoomPosition | { pos: RoomPosition } | Structure, opts = {}) {
    return moveModule.smartMove(this.creep, target, opts);
  }
}
