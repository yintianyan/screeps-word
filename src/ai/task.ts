import config from "../config/constants";

export default class Task {
  id: string;
  type: string;
  targetId: string;
  basePriority: number;
  data: any;

  /**
   * @param {string} type
   * @param {string} targetId
   * @param {number} priority
   * @param {Object} [data]
   */
  constructor(
    type: string,
    targetId: string,
    priority = config.PRIORITY.LOW,
    data = {},
  ) {
    this.id = `${type}_${targetId}_${Game.time}`;
    this.type = type;
    this.targetId = targetId;
    this.basePriority = priority;
    this.data = data;
  }

  /**
   * Calculate dynamic score for a specific creep
   * @param {Creep} creep
   * @returns {number}
   */
  getScore(creep: Creep): number {
    const target = Game.getObjectById(this.targetId as Id<any>);
    if (!target) return -1; // Invalid target

    let score = this.basePriority;

    // 1. Distance factor (Closer is better)
    // @ts-ignore
    const distance = creep.pos.getRangeTo(target);
    score -= distance * 2;

    // 2. Room Needs (e.g., Emergency mode)
    if (creep.room.energyAvailable < 300 && this.type === "transfer_spawn") {
      score += 1000; // Emergency boost
    }

    // 3. Creep Capability (Body parts)
    // Example: Prefer creeps with more WORK parts for building
    if (this.type === "build" && creep.getActiveBodyparts(WORK) > 0) {
      score += creep.getActiveBodyparts(WORK) * 5;
    }

    return score;
  }

  /**
   * Check if task is valid
   * @returns {boolean}
   */
  isValid(): boolean {
    const target = Game.getObjectById(this.targetId as Id<any>);
    if (!target) return false;

    // Example specific checks
    if (this.type === "transfer") {
      const store = (target as any).store as StoreDefinition;
      if (store && store.getFreeCapacity(RESOURCE_ENERGY) === 0) return false;
    }
    // @ts-ignore
    if (this.type === "harvest" && target.energy === 0) return false;

    return true;
  }
}
