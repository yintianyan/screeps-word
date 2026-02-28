import {
  Task,
  TaskPriority,
  TaskType,
  SpawnTask,
  TaskStatus,
} from "../types/dispatch";
import StructureCache from "../utils/structureCache";
import { profiler } from "../utils/profiler";


// [Config] Default Lifecycle Configuration
const DEFAULT_CONFIG = {
  maxQueueLength: 2000, // Reduced from 10000 to prevent CPU overflow
  maxRetry: 3,
  ttl: {
    completed: 10, // Shorten history to 10 ticks (was 300)
    failed: 100,   // Shorten failed retention (was 500)
    pending: 500,  // Shorten pending timeout (was 1000)
  },
  cleanupInterval: 10, // More frequent cleanup (was 30)
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
        const startCleanup = Game.cpu.getUsed();
        this.lastCleanupTick = Game.time;
        this.cleanup();
        profiler.record("GlobalDispatch.cleanup", Game.cpu.getUsed() - startCleanup);
      }

      // 2. Match tasks to idle creeps
    const startDispatch = Game.cpu.getUsed();
    
    // [FIX] If no room provided, we still need to process queues.
    // The previous logic split dispatch by room if room provided, 
    // BUT the queues are GLOBAL (Memory.dispatch.queues).
    // So iterating by room and calling dispatch(room) MULTIPLE TIMES
    // causes the same global queues to be processed multiple times per tick.
    // This is inefficient but not fatal, as we splice tasks out.
    // However, findBestCreep uses room-specific creeps.
    // If we call dispatch(room), we only match tasks to creeps IN THAT ROOM.
    
    // PROBLEM: Tasks in queue might be for Room A, but we are processing Room B.
    // findBestCreep filters by range/room implicitly?
    // Task.pos has roomName.
    // We should filter tasks by room?
    
    // Current dispatch() iterates the WHOLE queue for EACH room.
    // Inside the loop: `const task = Memory.dispatch.tasks[taskId];`
    // We need to check `if (task.pos.roomName !== room.name) continue;`
    // Otherwise we might assign a creep in Room A to a task in Room B (cross-room).
    // If that's intended (remote mining), it's fine.
    // But for efficiency, maybe we should check range.
    
    if (room) {
      this.dispatch(room);
      profiler.record("GlobalDispatch.dispatch", Game.cpu.getUsed() - startDispatch);
      return;
    }

    for (const roomName in Game.rooms) {
      const r = Game.rooms[roomName];
      if (!r.controller || !r.controller.my) continue;
      this.dispatch(r);
    }
      profiler.record("GlobalDispatch.dispatch", Game.cpu.getUsed() - startDispatch);
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
        // ... (Limit logic)
    }

    const existing = Memory.dispatch.tasks[task.id];
    if (existing) {
        // [FIX] If task exists but is finished/stale, RESET it.
        // This allows reusing the same ID immediately without waiting for TTL cleanup.
        // Vital for high-frequency tasks like Transport/Harvest.
        if (existing.status === TaskStatus.COMPLETED || 
            existing.status === TaskStatus.FAILED || 
            existing.status === TaskStatus.EXPIRED) {
            
            // Reset fields
            existing.status = TaskStatus.PENDING;
            existing.creationTime = Game.time;
            existing.lastUpdateTime = Game.time;
            existing.retries = 0;
            existing.errors = [];
            // Merge data/requirements if changed? Usually static for same ID.
            // But amount might change.
            if (task.data) existing.data = { ...existing.data, ...task.data };
            
            // Re-queue
            const queue = Memory.dispatch.queues[existing.priority];
            if (!queue.includes(existing.id)) queue.push(existing.id);
            
            // console.log(`[TaskPool] Reactivated task ${task.id}`);
        }
        return; 
    }

    // Initialize Lifecycle Fields
    // [FIX] Don't overwrite status if reactivating? 
    // Wait, the 'existing' check above handles reactivation.
    // If we are here, it's a new task (or overwrite of non-stale task?)
    // Actually, if memory exists but we passed the 'existing' check (e.g. running?), we might overwrite.
    // But 'if (Memory.dispatch.tasks[task.id])' returns early if active.
    
    // Ensure queues exist
    if (!Memory.dispatch.queues[task.priority]) Memory.dispatch.queues[task.priority] = [];
    
    task.status = TaskStatus.PENDING;
    task.creationTime = Game.time;
    task.lastUpdateTime = Game.time;
    task.retries = 0;
    task.errors = [];
    
    if (!task.creepsAssigned) task.creepsAssigned = [];
    Memory.dispatch.tasks[task.id] = task;
    
    // [FIX] Check if already in queue to avoid duplicates
    const queue = Memory.dispatch.queues[task.priority];
    if (!queue.includes(task.id)) {
        queue.push(task.id);
    }
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

    // OPTIMIZATION: Use StructureCache to find idle creeps instead of room.find
    // [FIX] StructureCache.getCreeps(room) only returns creeps IN THE ROOM.
    // Remote creeps (Scout, RemoteHauler) might be in another room but belong to this room's logic.
    // We should filter Game.creeps by memory.room === room.name to find ALL creeps belonging to this room,
    // regardless of their current physical location.
    
    // const allCreeps = StructureCache.getCreeps(room); 
    const allCreeps = Object.values(Game.creeps).filter(c => c.memory.room === room.name);

    const idleCreeps = allCreeps.filter(
      (c) => !Memory.dispatch.assignments[c.id] && !c.spawning
    );

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

      // [Optimization] Clone queue to safely modify it during iteration
      // (Though we are modifying queue in place via splice, iterating backwards or careful index management is needed)
      // Current loop is `i=0`, but we splice `i` and `i--`. This is correct.
      
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
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.EXPIRED) {
         queue.splice(i, 1);
         i--;
         continue;
    }

    // [FIX] Distance check for local tasks
    // If task is in room A, but creep is in room B?
    // Dispatch iterates by room. But queue is global.
    // If we are processing room "W1N1", we iterate ALL tasks.
    // We must check if task.pos.roomName matches room.name.
    // Otherwise we might assign a W1N1 creep to a W5N5 task (distance 200).
    // EXCEPT for remote tasks.
    // Task type could indicate remote? Or we check range.
    
    if (task.pos.roomName !== room.name) {
        // [FIX] Allow Remote Tasks
        const remoteTypes = [
            TaskType.REMOTE_HARVEST,
            TaskType.REMOTE_HAUL,
            TaskType.REMOTE_RESERVE,
            TaskType.REMOTE_DEFEND,
            TaskType.SCOUT
        ];
        
        if (!remoteTypes.includes(task.type)) {
            continue;
        } else {
            // For remote tasks, we need to ensure the creep is either in the home room OR in the target room
            // If the task target is room B, and creep is in room C (another remote), we might want to avoid?
            // Actually, if creep is in home room (A), it can go to B.
            // If creep is in B, it can work in B.
            // Dispatch is called per room. 'room' here is the room we are running dispatch for (usually Home Room).
            // Creeps in 'idleCreeps' belong to 'room' (via StructureCache.getCreeps(room)).
            // But wait, StructureCache.getCreeps(room) returns creeps OWNED by the room (memory.room?), or physically in the room?
            // Usually Game.creeps filter by memory.room or simple iteration.
            
            // If StructureCache.getCreeps uses room.find(FIND_MY_CREEPS), it returns creeps physically in the room.
            // If a Scout is in the remote room, it won't be found by room.find(FIND_MY_CREEPS) of Home Room!
            // So Dispatch running for Home Room won't see the Scout in Remote Room.
            // Result: Scout finishes moving, becomes idle in Remote Room.
            // Dispatch runs for Home Room. Scout is NOT in idleCreeps.
            // Dispatch runs for Remote Room? No, we only run dispatch for My Rooms (with controller).
            
            // FIX: We need to include creeps that belong to this room but are currently remote.
            // StructureCache.getCreeps needs to be smarter or we filter Game.creeps globally.
        }
    }

    if (!task.creepsAssigned) task.creepsAssigned = [];
    if (task.creepsAssigned.length >= task.maxCreeps) {
         continue;
    }

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

      // [NEW] Capacity Check based on Task Type
      const resourceType = task.data?.resource || RESOURCE_ENERGY;

      // Group 1: Need Free Capacity (Pickup, Harvest)
      const needFreeCapacity = [
        TaskType.PICKUP,
        TaskType.HARVEST,
        TaskType.REMOTE_HARVEST,
        TaskType.SK_MINE,
      ];
      if (needFreeCapacity.includes(task.type)) {
        if (c.store.getFreeCapacity(resourceType) === 0) return false;
      }

      // Group 2: Need Used Capacity (Transfer, Build, Repair, Upgrade)
      const needUsedCapacity = [
        TaskType.TRANSFER,
        TaskType.DELIVER,
        TaskType.BUILD,
        TaskType.REPAIR,
        TaskType.UPGRADE,
        TaskType.HAUL,
        TaskType.REMOTE_HAUL,
        TaskType.SK_HAUL,
      ];
      if (needUsedCapacity.includes(task.type)) {
        if (c.store.getUsedCapacity(resourceType) === 0) return false;
      }

      if (task.estimatedDuration && c.ticksToLive) {
        const range = c.pos.getRangeTo(task.pos);
        if (c.ticksToLive < range + task.estimatedDuration) return false;
      }
      return true;
    });

    if (candidates.length === 0) return null;

    // Optimization: O(n) scan instead of O(n log n) sort
    let bestCreep: Creep | null = null;
    let maxScore = -Infinity;

    for (const c of candidates) {
        const roleMatch = task.validRoles?.includes(c.memory.role) ? 100 : 0;
        const dist = c.pos.getRangeTo(task.pos);
        const distScore = Math.max(0, 50 - dist);
        const score = roleMatch + distScore;
        
        if (score > maxScore) {
            maxScore = score;
            bestCreep = c;
        }
    }
    
    return bestCreep;
  }
}
