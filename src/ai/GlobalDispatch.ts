import {
  DispatchMemory,
  Task,
  TaskPriority,
  TaskType,
  SpawnTask,
} from "../types/dispatch";

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
          [TaskPriority.IDLE]: [],
        },
        spawnQueue: [],
      };
    }
    if (!Memory.dispatch.spawnQueue) {
      Memory.dispatch.spawnQueue = [];
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

  static registerSpawnTask(task: SpawnTask) {
    this.init();
    // Check if duplicate request exists? (Optional)
    // For now, simple push
    Memory.dispatch.spawnQueue.push(task);
    // Sort by priority (Ascending because 0 is CRITICAL)
    Memory.dispatch.spawnQueue.sort((a, b) => a.priority - b.priority);
  }

  static getNextSpawnTask(roomName: string): SpawnTask | undefined {
    if (!Memory.dispatch?.spawnQueue) return undefined;

    const queue = Memory.dispatch.spawnQueue;
    const index = queue.findIndex((t) => t.roomName === roomName);

    if (index >= 0) {
      const task = queue[index];
      // Remove from queue immediately?
      // Or wait for executor to confirm?
      // For simplicity: remove it now. Executor MUST spawn or re-queue.
      queue.splice(index, 1);
      return task;
    }
    return undefined;
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
    // [Optimization] Only dispatch to idle creeps OR creeps with low priority tasks if CRITICAL task exists
    const idleCreeps = room.find(FIND_MY_CREEPS, {
      filter: (c) => !Memory.dispatch.assignments[c.id] && !c.spawning,
    });

    if (idleCreeps.length === 0) return;

    // Iterate priorities
    const priorities = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.NORMAL,
      TaskPriority.LOW,
      TaskPriority.IDLE,
    ];

    for (const priority of priorities) {
      const queue = Memory.dispatch.queues[priority];
      if (queue.length === 0) continue;

      // Try to assign tasks in this queue
      for (let i = 0; i < queue.length; i++) {
        const taskId = queue[i];
        const task = Memory.dispatch.tasks[taskId];

        // Cleanup invalid tasks
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
    const candidates = creeps.filter((c) => {
      // 0. Check Role Preference
      if (task.validRoles && task.validRoles.length > 0) {
        if (!task.validRoles.includes(c.memory.role)) return false;
      }

      // 1. Check Body Requirements
      if (task.requirements?.bodyParts) {
        const hasParts = task.requirements.bodyParts.every(
          (part) => c.getActiveBodyparts(part) > 0,
        );
        if (!hasParts) return false;
      }

      // 2. Check Capacity
      if (task.requirements?.minCapacity) {
        if (c.store.getCapacity() < task.requirements.minCapacity) return false;
      }

      // 3. Check Lifespan (Predictive)
      if (task.estimatedDuration && c.ticksToLive) {
        // Need at least enough life to reach target + do task
        const range = c.pos.getRangeTo(task.pos);
        if (c.ticksToLive < range + task.estimatedDuration) return false;
      }

      return true;
    });

    if (candidates.length === 0) return null;

    // Sort by Score (Distance + Role Match)
    return candidates.sort((a, b) => {
      // Prefer closer creeps
      const distA = a.pos.getRangeTo(task.pos);
      const distB = b.pos.getRangeTo(task.pos);

      // Prefer role match
      const roleMatchA = task.validRoles?.includes(a.memory.role) ? -10 : 0;
      const roleMatchB = task.validRoles?.includes(b.memory.role) ? -10 : 0;

      return distA + roleMatchA - (distB + roleMatchB);
    })[0];
  }
}
