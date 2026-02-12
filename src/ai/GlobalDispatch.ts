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
          [TaskPriority.MEDIUM]: [], // [NEW] Added MEDIUM
          [TaskPriority.NORMAL]: [],
          [TaskPriority.LOW]: [],
          [TaskPriority.IDLE]: [],
        },
        spawnQueue: [],
      };
    }
    // [FIX] Ensure all queues exist (Migration for existing memory)
    if (Memory.dispatch && Memory.dispatch.queues) {
      if (!Memory.dispatch.queues[TaskPriority.MEDIUM]) {
        Memory.dispatch.queues[TaskPriority.MEDIUM] = [];
      }
    }
    // General safety check for all priorities
    if (Memory.dispatch && Memory.dispatch.queues) {
      const priorities = [
        TaskPriority.CRITICAL,
        TaskPriority.HIGH,
        TaskPriority.MEDIUM,
        TaskPriority.NORMAL,
        TaskPriority.LOW,
        TaskPriority.IDLE,
      ];
      priorities.forEach((p) => {
        if (!Memory.dispatch.queues[p]) Memory.dispatch.queues[p] = [];
      });
    }

    if (!Memory.dispatch.spawnQueue) {
      Memory.dispatch.spawnQueue = [];
    }
  }

  static run(room: Room) {
    try {
      this.init();

      // 1. Cleanup invalid tasks/assignments
      this.cleanup();

      // 2. Match tasks to idle creeps
      this.dispatch(room);
    } catch (error) {
      console.log(
        `Error in GlobalDispatch.run for room ${room.name}: ${error}`,
      );
      if (error instanceof Error && error.stack) {
        console.log(error.stack);
      }
    }
  }

  static registerTask(task: Task) {
    this.init();
    if (Memory.dispatch.tasks[task.id]) return; // Already exists

    if (!task.creepsAssigned) task.creepsAssigned = [];
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

  static deleteTask(taskId: string) {
    if (!Memory.dispatch || !Memory.dispatch.tasks) return;

    const task = Memory.dispatch.tasks[taskId];
    if (!task) return;

    // Remove from tasks map
    delete Memory.dispatch.tasks[taskId];

    // Remove from queue
    const queue = Memory.dispatch.queues[task.priority];
    if (queue) {
      const idx = queue.indexOf(taskId);
      if (idx > -1) {
        queue.splice(idx, 1);
      }
    }
  }

  static completeTask(taskId: string, creepId: string) {
    // Remove assignment
    if (
      Memory.dispatch &&
      Memory.dispatch.assignments &&
      Memory.dispatch.assignments[creepId] === taskId
    ) {
      delete Memory.dispatch.assignments[creepId];
    }

    // Update task assignment list
    const task = this.getTask(taskId);
    if (task) {
      if (!task.creepsAssigned) task.creepsAssigned = [];
      const idx = task.creepsAssigned.indexOf(creepId);
      if (idx > -1) {
        task.creepsAssigned.splice(idx, 1);
      }

      // [NEW] Auto-delete task if configured or one-off type
      const autoRemoveTypes = [
        TaskType.PICKUP,
        TaskType.DELIVER,
        TaskType.BUILD,
        TaskType.REPAIR,
        TaskType.SCOUT,
        TaskType.TRANSFER,
      ];

      if (task.autoRemove || autoRemoveTypes.includes(task.type)) {
        // Only delete if no other creeps are assigned (or maybe even if they are?)
        // Usually these are 1-creep tasks. If multiple, we wait for all?
        // Let's assume autoRemove means "when ONE creep finishes it, it's done"
        // OR "when ALL assigned creeps finish"?
        // For PICKUP/DELIVER, usually one creep completes the specific amount.
        // For BUILD, it might take multiple trips.
        // Let's rely on explicit `autoRemove` flag or specific logic.

        // For now, if it's a "one-off" task and no creeps left assigned, delete it.
        if (task.creepsAssigned.length === 0) {
          this.deleteTask(taskId);
        }
      }
    }
  }

  private static cleanup() {
    if (!Memory.dispatch || !Memory.dispatch.assignments) return;

    // Remove dead creeps from assignments
    for (const creepId in Memory.dispatch.assignments) {
      if (!Game.creeps[creepId]) {
        // Safe task cleanup
        const taskId = Memory.dispatch.assignments[creepId];
        if (taskId) {
          this.completeTask(taskId, creepId);
        } else {
          delete Memory.dispatch.assignments[creepId];
        }
      }
    }
    // Remove tasks that have expired (optional)
  }

  private static dispatch(room: Room) {
    if (
      !Memory.dispatch ||
      !Memory.dispatch.assignments ||
      !Memory.dispatch.queues
    )
      return;

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
      TaskPriority.MEDIUM, // [NEW] Added MEDIUM
      TaskPriority.NORMAL,
      TaskPriority.LOW,
      TaskPriority.IDLE,
    ];

    for (const priority of priorities) {
      const queue = Memory.dispatch.queues[priority] || [];
      if (queue.length === 0) continue;

      // [Optimization] Sort tasks within the same priority!
      // This is crucial. If we have multiple HIGH priority pickup tasks,
      // we want the one with MORE energy to be processed first.

      // Let's sort the queue based on data.amount if available (descending)
      // Only sort if it's likely to be a transport queue (HIGH/NORMAL)
      if (priority === TaskPriority.HIGH || priority === TaskPriority.NORMAL) {
        queue.sort((idA, idB) => {
          const taskA = Memory.dispatch.tasks[idA];
          const taskB = Memory.dispatch.tasks[idB];
          const amountA = taskA?.data?.amount || 0;
          const amountB = taskB?.data?.amount || 0;
          return amountB - amountA; // Descending
        });
      }

      // Try to assign tasks in this queue
      for (let i = 0; i < queue.length; i++) {
        const taskId = queue[i];
        if (!Memory.dispatch.tasks) {
          queue.splice(i, 1);
          i--;
          continue;
        }
        const task = Memory.dispatch.tasks[taskId];

        // Cleanup invalid tasks
        if (!task) {
          queue.splice(i, 1);
          i--;
          continue;
        }

        // Check if task needs more creeps
        if (!task.creepsAssigned) task.creepsAssigned = [];
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

    // Sort by Score (Distance + Role Match + Energy Weight)
    return candidates.sort((a, b) => {
      // 1. Role Match (Primary)
      const roleMatchA = task.validRoles?.includes(a.memory.role) ? 100 : 0;
      const roleMatchB = task.validRoles?.includes(b.memory.role) ? 100 : 0;

      // 2. Distance Score (Lower is better)
      const distA = a.pos.getRangeTo(task.pos);
      const distB = b.pos.getRangeTo(task.pos);
      const distScoreA = Math.max(0, 50 - distA); // 50 points for distance 0
      const distScoreB = Math.max(0, 50 - distB);

      return roleMatchB + distScoreB - (roleMatchA + distScoreA);
    })[0];
  }
}
