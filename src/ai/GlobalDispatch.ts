import {
  Task,
  TaskPriority,
  TaskType,
  SpawnTask,
  TaskStatus,
} from "../types/dispatch";

// [Config] Default Lifecycle Configuration
const DEFAULT_CONFIG = {
  maxQueueLength: 10000,
  maxRetry: 3,
  ttl: {
    completed: 300, // 5 mins (at 1 tick/sec? No, Screeps tick is variable. Let's assume tick count.)
    // Requirement says "5 minutes". In Screeps, 1 tick ~ 3s roughly? No, usually faster.
    // Let's assume standard 3s/tick for estimation or just use Tick Count.
    // 5 mins = 300 seconds. If tick = 3s, that's 100 ticks.
    // If tick = 1s, that's 300 ticks.
    // Let's use 500 ticks as a safe default for "5 minutes".
    failed: 500,
    pending: 1000, // 10 minutes ~ 1000 ticks? No, 10 mins is long.
  },
  cleanupInterval: 30, // 30 seconds ~ 10-15 ticks? Let's say 30 ticks.
};

export class GlobalDispatch {
  private static lastCleanupTick = -1;

  static init() {
    if (!Memory.dispatch) {
      Memory.dispatch = {
        tasks: {},
        assignments: {},
        queues: {
          [TaskPriority.CRITICAL]: [],
          [TaskPriority.HIGH]: [],
          [TaskPriority.MEDIUM]: [],
          [TaskPriority.NORMAL]: [],
          [TaskPriority.LOW]: [],
          [TaskPriority.IDLE]: [],
        },
        spawnQueue: [],
      };
    }
    
    // Config Init
    if (!Memory.config) Memory.config = {};
    if (!Memory.config.taskManager) {
        Memory.config.taskManager = DEFAULT_CONFIG;
    }

    // [FIX] Ensure all queues exist
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

  static run(room?: Room) {
    try {
      this.init();

      // 1. Cleanup invalid tasks/assignments
      // Run cleanup periodically
      if (
        Game.time % (Memory.config.taskManager.cleanupInterval || 30) === 0 &&
        this.lastCleanupTick !== Game.time
      ) {
        this.lastCleanupTick = Game.time;
        this.cleanup();
      }

      // 2. Match tasks to idle creeps
      if (room) {
        this.dispatch(room);
        return;
      }

      for (const roomName in Game.rooms) {
        const r = Game.rooms[roomName];
        if (!r.controller || !r.controller.my) continue;
        this.dispatch(r);
      }
    } catch (error) {
      const roomName = room?.name ? room.name : "GLOBAL";
      console.log(`Error in GlobalDispatch.run for room ${roomName}: ${error}`);
      if (error instanceof Error && error.stack) {
        console.log(error.stack);
      }
    }
  }

  static registerTask(task: Task) {
    this.init();
    
    // Check Limits
    const currentLength = Object.keys(Memory.dispatch.tasks).length;
    const limit = Memory.config.taskManager.maxQueueLength || 10000;
    if (currentLength >= limit) {
        console.log(`[TaskPool] Queue Limit Reached (${currentLength}/${limit}). Triggering forced cleanup.`);
        this.cleanup(true); // Force cleanup
        // If still full, reject? Or just push anyway and hope cleanup worked.
        // For robustness, we might reject low priority tasks here.
        if (Object.keys(Memory.dispatch.tasks).length >= limit) {
             console.log(`[TaskPool] Dropping task ${task.id} due to overflow.`);
             return;
        }
    }

    if (Memory.dispatch.tasks[task.id]) return; // Already exists

    // Initialize Lifecycle Fields
    task.status = TaskStatus.PENDING;
    task.creationTime = Game.time;
    task.lastUpdateTime = Game.time;
    task.retries = 0;
    task.errors = [];
    
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
  
  static markTaskFailed(taskId: string, error: string) {
      const task = this.getTask(taskId);
      if (!task) return;
      
      task.status = TaskStatus.FAILED;
      task.lastUpdateTime = Game.time;
      if (!task.errors) task.errors = [];
      task.errors.push(error);
      task.retries = (task.retries || 0) + 1;
      
      const maxRetries = Memory.config.taskManager.maxRetry || 3;
      
      if (task.retries > maxRetries) {
          console.log(`[TaskPool] Task ${taskId} failed max retries (${task.retries}). Removing.`);
          this.deleteTask(taskId); // Remove completely or move to Dead Letter Queue?
          // Requirement says "Force remove from pool"
      } else {
          // Reset to PENDING to retry? Or keep as FAILED until processed?
          // If we assume a FAILED task needs manual intervention or re-dispatch:
          // A "FAILED" task in queue might not be picked up if dispatch filters by status.
          // Let's set it back to PENDING for retry, but keep the counter.
          console.log(`[TaskPool] Task ${taskId} failed (Retry ${task.retries}/${maxRetries}). Re-queueing.`);
          task.status = TaskStatus.PENDING;
          // Ensure it's in the queue
          const queue = Memory.dispatch.queues[task.priority];
          if (!queue.includes(taskId)) queue.push(taskId);
      }
  }

  static getTask(taskId: string): Task | undefined {
    return Memory.dispatch?.tasks[taskId];
  }
  
  // ...

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
      // Mark Running if assigned?
      // Actually completeTask implies "A creep finished its part".
      
      if (!task.creepsAssigned) task.creepsAssigned = [];
      const idx = task.creepsAssigned.indexOf(creepId);
      if (idx > -1) {
        task.creepsAssigned.splice(idx, 1);
      }
      
      task.lastUpdateTime = Game.time;

      const autoRemoveTypes = [
        TaskType.PICKUP,
        TaskType.DELIVER,
        TaskType.BUILD,
        TaskType.REPAIR,
        TaskType.SCOUT,
        TaskType.TRANSFER,
      ];

      if (task.autoRemove || autoRemoveTypes.includes(task.type)) {
        if (task.creepsAssigned.length === 0) {
          task.status = TaskStatus.COMPLETED; // Mark completed
          // If we want to keep history for a bit (TTL), don't delete immediately.
          // But original logic was "deleteTask".
          // Requirement says "Delete immediately if TTL exceeded".
          // But if we delete NOW, we lose history.
          // Requirement 2: "completed... > TTL... delete".
          // So we should NOT delete here, just mark completed.
          // However, for high throughput, keeping completed tasks is expensive memory-wise.
          // Let's keep them for a short TTL (defined in config).
          
          // Remove from Queue (so it's not dispatched again)
           const queue = Memory.dispatch.queues[task.priority];
           const qIdx = queue.indexOf(taskId);
           if (qIdx > -1) queue.splice(qIdx, 1);
           
           // If TTL is very short or 0, delete now.
           // For now, let's just leave it in `tasks` map with COMPLETED status.
           // Cleanup will handle it.
        }
      }
    }
  }

  private static cleanup(force: boolean = false) {
    if (!Memory.dispatch || !Memory.dispatch.assignments) return;

    const start = Game.cpu.getUsed();
    const config = Memory.config.taskManager;
    const now = Game.time;
    
    let counts = { pending: 0, running: 0, completed: 0, failed: 0, expired: 0 };
    let deleted = 0;
    const initialSize = Object.keys(Memory.dispatch.tasks).length;

    // 1. Assignment Cleanup (Dead Creeps)
    for (const creepId in Memory.dispatch.assignments) {
      if (!Game.creeps[creepId]) {
        const taskId = Memory.dispatch.assignments[creepId];
        if (taskId) {
          // If creep died, task might have failed?
          // Or just release assignment.
          this.completeTask(taskId, creepId); // Release
          // Optionally mark task as failed if it was critical?
        } else {
          delete Memory.dispatch.assignments[creepId];
        }
      }
    }

    // 2. Task Pool Cleanup
    const tasks = Memory.dispatch.tasks;
    const ids = Object.keys(tasks);
    
    // Limits
    const limit = config.maxQueueLength || 10000;
    const needsForcePrune = force || ids.length > limit;

    for (const id of ids) {
        const task = tasks[id];
        
        // Update Status Count
        if (task.status) counts[task.status] = (counts[task.status] || 0) + 1;
        else counts['pending']++; // Default

        let shouldDelete = false;

        // A. TTL Check
        if (task.status === TaskStatus.COMPLETED) {
            if (now - task.lastUpdateTime > (config.ttl.completed || 300)) shouldDelete = true;
        } else if (task.status === TaskStatus.FAILED) {
            if (now - task.lastUpdateTime > (config.ttl.failed || 500)) shouldDelete = true;
        } else if (task.status === TaskStatus.PENDING || task.status === undefined) {
             // Max Wait Time
             if (now - task.creationTime > (config.ttl.pending || 1500)) {
                 task.status = TaskStatus.EXPIRED;
                 shouldDelete = true; // Mark expired then delete? Or keep for a bit?
                 // Requirement: "Mark expired AND delete" (implied delete soon or immediately?)
                 // "Mark as expired and delete" usually means log it then delete.
             }
        }
        
        // B. Force Prune Strategy (if over limit)
        if (!shouldDelete && needsForcePrune) {
            // Prioritize removing Expired > Failed > Completed > Pending (Oldest)
            // This loop is simple iteration, tough to prioritize globally without sort.
            // But we can be aggressive on "Old" tasks.
            if (task.status === TaskStatus.EXPIRED || task.status === TaskStatus.FAILED || task.status === TaskStatus.COMPLETED) {
                shouldDelete = true;
            } else if (now - task.creationTime > 2000) {
                // Very old pending
                shouldDelete = true;
            }
        }

        if (shouldDelete) {
            this.deleteTask(id);
            deleted++;
        }
    }

    // 3. Observability Log
    const end = Game.cpu.getUsed();
    console.log(`[TaskPool] Cleanup: Initial=${initialSize} | Deleted=${deleted} | Remaining=${initialSize - deleted} | Time=${(end - start).toFixed(2)}ms`);
    console.log(`[TaskPool] Stats: Pending=${counts.pending} Run=${counts.running} Done=${counts.completed} Fail=${counts.failed}`);
  }

  private static dispatch(room: Room) {
    // ... (Keep existing dispatch logic but check status)
    if (!Memory.dispatch || !Memory.dispatch.assignments || !Memory.dispatch.queues) return;

    const idleCreeps = room.find(FIND_MY_CREEPS, {
      filter: (c) => !Memory.dispatch.assignments[c.id] && !c.spawning,
    });

    if (idleCreeps.length === 0) return;

    const priorities = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.MEDIUM,
      TaskPriority.NORMAL,
      TaskPriority.LOW,
      TaskPriority.IDLE,
    ];

    for (const priority of priorities) {
      const queue = Memory.dispatch.queues[priority] || [];
      if (queue.length === 0) continue;

      // Sort logic ... (Keep existing)
      if (priority === TaskPriority.HIGH || priority === TaskPriority.NORMAL) {
        queue.sort((idA, idB) => {
          const taskA = Memory.dispatch.tasks[idA];
          const taskB = Memory.dispatch.tasks[idB];
          const amountA = taskA?.data?.amount || 0;
          const amountB = taskB?.data?.amount || 0;
          return amountB - amountA; 
        });
      }

      for (let i = 0; i < queue.length; i++) {
        const taskId = queue[i];
        if (!Memory.dispatch.tasks) {
           queue.splice(i, 1); i--; continue;
        }
        const task = Memory.dispatch.tasks[taskId];

        if (!task) {
          queue.splice(i, 1);
          i--;
          continue;
        }
        
        // [NEW] Skip if not PENDING (e.g. Completed but waiting cleanup)
        // Actually, running tasks might need more creeps?
        // If status is COMPLETED or FAILED or EXPIRED, remove from queue
        if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.EXPIRED) {
             queue.splice(i, 1);
             i--;
             continue;
        }

        if (!task.creepsAssigned) task.creepsAssigned = [];
        if (task.creepsAssigned.length >= task.maxCreeps) continue;

        const bestCreep = this.findBestCreep(idleCreeps, task);
        if (bestCreep) {
          Memory.dispatch.assignments[bestCreep.id] = task.id;
          task.creepsAssigned.push(bestCreep.id);
          
          // Update Status
          if (task.status === TaskStatus.PENDING) {
              task.status = TaskStatus.RUNNING;
              task.lastUpdateTime = Game.time;
          }

          const index = idleCreeps.indexOf(bestCreep);
          idleCreeps.splice(index, 1);

          if (idleCreeps.length === 0) return;
        }
      }
    }
  }

  // ... (findBestCreep remains same)
  private static findBestCreep(creeps: Creep[], task: Task): Creep | null {
     // ... (Copy existing implementation from Read result)
    const candidates = creeps.filter((c) => {
      if (task.validRoles && task.validRoles.length > 0) {
        if (!task.validRoles.includes(c.memory.role)) return false;
      }
      if (task.requirements?.bodyParts) {
        const hasParts = task.requirements.bodyParts.every(
          (part) => c.getActiveBodyparts(part) > 0,
        );
        if (!hasParts) return false;
      }
      if (task.requirements?.minCapacity) {
        if (c.store.getCapacity() < task.requirements.minCapacity) return false;
      }
      if (task.estimatedDuration && c.ticksToLive) {
        const range = c.pos.getRangeTo(task.pos);
        if (c.ticksToLive < range + task.estimatedDuration) return false;
      }
      return true;
    });

    if (candidates.length === 0) return null;

    return candidates.sort((a, b) => {
      const roleMatchA = task.validRoles?.includes(a.memory.role) ? 100 : 0;
      const roleMatchB = task.validRoles?.includes(b.memory.role) ? 100 : 0;
      const distA = a.pos.getRangeTo(task.pos);
      const distB = b.pos.getRangeTo(task.pos);
      const distScoreA = Math.max(0, 50 - distA); 
      const distScoreB = Math.max(0, 50 - distB);
      return roleMatchB + distScoreB - (roleMatchA + distScoreA);
    })[0];
  }
}
