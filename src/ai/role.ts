import moveModule from "../utils/movement";
import { GlobalDispatch } from "./GlobalDispatch";
import { Task } from "../types/dispatch";

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
    if (!this.creep.pos.inRangeTo(pos, task.type === 'HARVEST' || task.type === 'ATTACK' ? 1 : 3)) {
        this.move(pos);
        // Continue to try action if in range (e.g. range 3 for build/repair/upgrade)
    }

    // Action Execution
    let result: number = OK;
    switch (task.type) {
        case 'HARVEST':
            if (target instanceof Source || target instanceof Mineral) {
                result = this.creep.harvest(target as Source);
            }
            break;
        case 'TRANSFER':
            if (target instanceof Structure || target instanceof Creep) {
                result = this.creep.transfer(target as AnyCreep | Structure, task.data?.resource || RESOURCE_ENERGY);
            }
            break;
        case 'PICKUP':
            if (target instanceof Resource) {
                result = this.creep.pickup(target);
            } else if (target instanceof Structure) { // Withdraw from container
                 result = this.creep.withdraw(target as Structure, task.data?.resource || RESOURCE_ENERGY);
            }
            break;
        case 'BUILD':
            if (target instanceof ConstructionSite) {
                result = this.creep.build(target);
            }
            break;
        case 'REPAIR':
            if (target instanceof Structure) {
                result = this.creep.repair(target);
            }
            break;
        case 'UPGRADE':
            if (target instanceof StructureController) {
                result = this.creep.upgradeController(target);
            }
            break;
        case 'ATTACK':
            if (target instanceof Creep || target instanceof Structure) {
                result = this.creep.attack(target as AnyCreep | Structure);
            }
            break;
        case 'HEAL':
            if (target instanceof Creep) {
                result = this.creep.heal(target);
            }
            break;
    }

    if (result === ERR_NOT_IN_RANGE) {
        this.move(pos);
    } else if (result !== OK && result !== ERR_TIRED) {
        // Log error or finish task if done
        if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_INVALID_TARGET) {
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
