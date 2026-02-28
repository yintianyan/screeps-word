import moveModule from "../utils/movement";
import { GlobalDispatch } from "./GlobalDispatch";
import { Task, TaskType } from "../types/dispatch";
import StructureCache from "../utils/structureCache";

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
    const target = Game.getObjectById(
      task.targetId as Id<any>,
    ) as RoomObject | null;

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
          if (result === ERR_FULL) {
            const sourcePos = (target as any).pos;

            // Optimization: Use StructureCache instead of findInRange
            // Links are rare, Containers are few.
            const links = StructureCache.getStructures(
              this.creep.room,
              STRUCTURE_LINK,
            ) as StructureLink[];
            const containers = StructureCache.getStructures(
              this.creep.room,
              STRUCTURE_CONTAINER,
            ) as StructureContainer[];

            const link = links.find(
              (l) =>
                l.pos.inRangeTo(sourcePos, 2) &&
                l.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            );
            const container = containers.find(
              (c) =>
                c.pos.inRangeTo(sourcePos, 1) &&
                c.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            );

            const nearFullContainer =
              container &&
              container.store.getFreeCapacity(RESOURCE_ENERGY) <
                this.creep.store.getUsedCapacity(RESOURCE_ENERGY);

            if (
              link &&
              (nearFullContainer || this.creep.pos.inRangeTo(link, 1))
            ) {
              const tr = this.creep.transfer(link, RESOURCE_ENERGY);
              if (tr === ERR_NOT_IN_RANGE) this.move(link);
              return;
            }

            if (container) {
              const tr = this.creep.transfer(container, RESOURCE_ENERGY);
              if (tr === ERR_NOT_IN_RANGE) this.move(container);
              return;
            }

            if (link) {
              const tr = this.creep.transfer(link, RESOURCE_ENERGY);
              if (tr === ERR_NOT_IN_RANGE) this.move(link);
              return;
            }

            this.creep.drop(RESOURCE_ENERGY);
            return;
          }
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
          // [FIX] Handle partial withdraw if target has less than capacity
          // But creep.withdraw() handles amount automatically (takes min).
          
          result = this.creep.withdraw(
            target as Structure,
            task.data?.resource || RESOURCE_ENERGY,
          );
        }
        // Check if done
        // [FIX] Don't complete task just because we got "OK".
        // We might not be full yet.
        // Task is "PICKUP", implies "Get Energy".
        // If we are FULL, then task is done.
        // If target is EMPTY, then task is done (failed/partial).
        
        if (result === OK) {
             // We successfully withdrew SOME amount.
             // If we are full, complete.
             if (this.creep.store.getFreeCapacity() === 0) {
                 GlobalDispatch.completeTask(task.id, this.creep.id);
             } else {
                 // We are NOT full.
                 // Check if target is empty?
                 // withdraw returns OK if transfer was scheduled.
                 // We need to check target store in NEXT tick ideally, or assume if we asked for more than it had, it's empty.
                 // Simpler: If target is a Structure, and it has energy left, keep task?
                 // But multiple haulers might target same structure.
                 // If this is a SHARED task (maxCreeps > 1), we should keep it open.
                 // If it's a dedicated task, maybe we want to fill up?
                 
                 // PROBLEM: "Multiple haulers go to same source... first one takes... others return".
                 // If task is "PICKUP from Container A", maxCreeps=3.
                 // Creep A arrives, withdraws. Result=OK.
                 // Creep A is full -> completes task for ITSELF (removes from creepsAssigned).
                 // Creep B arrives. Container still has energy?
                 
                 // If `completeTask` removes task for EVERYONE, that's the bug.
                 // `GlobalDispatch.completeTask` removes `creepId` from `creepsAssigned`.
                 // Only if `creepsAssigned.length === 0` AND autoRemove is true, it marks task COMPLETED.
                 
                 // So if MaxCreeps=3, Creep A finishes, Creep B should continue.
                 // UNLESS Creep A's withdrawal made Container empty.
                 // Then Creep B arrives, withdraws -> ERR_NOT_ENOUGH_RESOURCES -> Task Failed/Completed.
                 
                 // The user says "Others return". Why?
                 // Maybe because Creep A marked task as COMPLETED for everyone?
                 // GlobalDispatch.completeTask logic:
                 // if (task.creepsAssigned.length === 0) task.status = COMPLETED;
                 // So it only completes if NO ONE is assigned.
                 
                 // Wait, maybe the logic "Result=OK -> Complete" is premature?
                 // If I just took 50 energy and I have space for 500, I should STAY and take more?
                 // If target has more.
                 
                 if (target instanceof Structure) {
                     const store = (target as AnyStoreStructure).store;
                     const resource = task.data?.resource || RESOURCE_ENERGY;
                     // We just withdrew. The amount is deducted next tick.
                     // Current store value is "before withdraw".
                     // If store > capacity, we probably took a full load.
                     // If we are not full, we should try again next tick?
                     // BUT `withdraw` can only be called once per tick.
                     // So we wait for next tick.
                     // We do NOT call completeTask.
                     // UNLESS we are full.
                     
                     // So: If result === OK, and NOT FULL, do NOT complete task.
                     // Let loop continue next tick.
                     return; 
                 }
             }
        }
        else if (result === ERR_FULL) {
             GlobalDispatch.completeTask(task.id, this.creep.id);
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
      if (Game.time % 5 === 0) this.creep.say("🔄 gather");
    }
    if (!this.memory.working && this.creep.store.getFreeCapacity() === 0) {
      this.memory.working = true;
      if (Game.time % 5 === 0) this.creep.say("⚡ work");
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
