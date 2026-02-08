import moveModule from "../utils/movement";

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
      // 1. Check state transitions
      this.checkState();

      // 2. Execute current state logic
      this.executeState();
    } catch (e: any) {
      console.log(`[Role] Error in ${this.creep.name}: ${e.stack}`);
    }
  }

  /**
   * Check and switch states (to be overridden)
   */
  checkState() {
    // Default implementation: Toggle working state
    // @ts-ignore
    if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
      // @ts-ignore
      this.memory.working = false;
      this.creep.say("🔄 gather");
    }
    // @ts-ignore
    if (!this.memory.working && this.creep.store.getFreeCapacity() === 0) {
      // @ts-ignore
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
   * @param {RoomPosition|{pos: RoomPosition}} target
   * @param {Object} opts
   */
  move(target: RoomPosition | { pos: RoomPosition }, opts = {}) {
    // @ts-ignore
    return moveModule.smartMove(this.creep, target, opts);
  }
}
