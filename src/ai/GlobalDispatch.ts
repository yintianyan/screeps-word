
import { DispatchMemory, Task, TaskPriority, TaskType } from "../types/dispatch";

export class GlobalDispatch {
  
  static init() {
    if (!Memory.dispatch) {
      Memory.dispatch = {
        tasks: {},
        assignments: {},
        queues: {
          [TaskPriority.CRITICAL]: [],
          [TaskPriority.HIGH]: [],
          [TaskPriority.NORMAL]: [],
          [TaskPriority.LOW]: [],
          [TaskPriority.IDLE]: []
        }
      };
    }
  }

  static run(room: Room) {
    this.init();
    
    // 1. Cleanup invalid tasks/assignments
    this.cleanup();

    // 2. Match tasks to idle creeps
    this.dispatch(room);
  }

  static registerTask(task: Task) {
    this.init();
    if (Memory.dispatch.tasks[task.id]) return; // Already exists

    Memory.dispatch.tasks[task.id] = task;
    Memory.dispatch.queues[task.priority].push(task.id);
  }

  static getTask(taskId: string): Task | undefined {
    return Memory.dispatch?.tasks[taskId];
  }

  static getAssignedTask(creep: Creep): Task | undefined {
    const taskId = Memory.dispatch?.assignments[creep.id];
    if (!taskId) return undefined;
    return this.getTask(taskId);
  }

  static completeTask(taskId: string, creepId: string) {
    // Remove assignment
    if (Memory.dispatch.assignments[creepId] === taskId) {
      delete Memory.dispatch.assignments[creepId];
    }
    
    // Logic to remove task if fully completed?
    // For now, assume tasks are one-off or managed by Centers.
    // Ideally, Center checks if task is done.
    // Here we just unassign.
  }

  private static cleanup() {
    // Remove dead creeps from assignments
    for (const creepId in Memory.dispatch.assignments) {
      if (!Game.creeps[creepId]) {
        delete Memory.dispatch.assignments[creepId];
      }
    }
    // Remove tasks that have expired (optional)
  }

  private static dispatch(room: Room) {
    // Find idle creeps in this room
    const idleCreeps = room.find(FIND_MY_CREEPS, {
      filter: (c) => !Memory.dispatch.assignments[c.id] && !c.spawning
    });

    if (idleCreeps.length === 0) return;

    // Iterate priorities
    const priorities = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.NORMAL,
      TaskPriority.LOW,
      TaskPriority.IDLE
    ];

    for (const priority of priorities) {
      const queue = Memory.dispatch.queues[priority];
      if (queue.length === 0) continue;

      // Try to assign tasks in this queue
      // Simple FIFO for now, optimize with "Best Match" later
      for (let i = 0; i < queue.length; i++) {
        const taskId = queue[i];
        const task = Memory.dispatch.tasks[taskId];
        
        if (!task) {
          queue.splice(i, 1);
          i--;
          continue;
        }

        // Check if task needs more creeps
        if (task.creepsAssigned.length >= task.maxCreeps) continue;

        // Find best creep
        const bestCreep = this.findBestCreep(idleCreeps, task);
        if (bestCreep) {
          // Assign
          Memory.dispatch.assignments[bestCreep.id] = task.id;
          task.creepsAssigned.push(bestCreep.id);
          
          // Remove from idle list
          const index = idleCreeps.indexOf(bestCreep);
          idleCreeps.splice(index, 1);
          
          if (idleCreeps.length === 0) return;
        }
      }
    }
  }

  private static findBestCreep(creeps: Creep[], task: Task): Creep | null {
    // Filter by capability
    const candidates = creeps.filter(c => {
      // 1. Check Body Requirements
      if (task.requirements?.bodyParts) {
        const hasParts = task.requirements.bodyParts.every(part => c.getActiveBodyparts(part) > 0);
        if (!hasParts) return false;
      }
      // 2. Check Capacity
      if (task.requirements?.minCapacity) {
        if (c.store.getCapacity() < task.requirements.minCapacity) return false;
      }
      return true;
    });

    if (candidates.length === 0) return null;

    // Sort by distance (simple optimization)
    // In a real system, we'd cache paths or use Manhattan distance
    return task.pos ? candidates.sort((a, b) => 
      a.pos.getRangeTo(task.pos) - b.pos.getRangeTo(task.pos)
    )[0] : candidates[0];
  }
}
