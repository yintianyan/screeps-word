
import { GlobalDispatch } from "../src/ai/GlobalDispatch";
import { Task, TaskPriority, TaskStatus, TaskType } from "../src/types/dispatch";

// Mock Game object
const mockGame = {
    time: 0,
    creeps: {},
    cpu: {
        getUsed: () => 0
    }
};
(global as any).Game = mockGame;
(global as any).Memory = {};

export const testTaskLifecycle = () => {
    console.log("=== Testing Task Lifecycle Management ===");

    // 1. Setup
    Memory.dispatch = undefined;
    Memory.config = {
        taskManager: {
            maxQueueLength: 5, // Small limit for testing
            maxRetry: 2,
            ttl: {
                completed: 10,
                failed: 10,
                pending: 20
            },
            cleanupInterval: 5
        }
    };
    GlobalDispatch.init();
    
    // 2. Test Registration & Limits
    console.log("[Test] Registration & Limits");
    for (let i = 0; i < 7; i++) {
        GlobalDispatch.registerTask({
            id: `task_${i}`,
            type: TaskType.HAUL,
            priority: TaskPriority.NORMAL,
            targetId: `target_${i}`,
            pos: { x: 25, y: 25, roomName: 'W1N1' } as RoomPosition,
            creepsAssigned: [],
            maxCreeps: 1,
            creationTime: Game.time,
            status: TaskStatus.PENDING,
            lastUpdateTime: Game.time
        } as Task);
    }
    
    // Check if limit enforced (5 tasks max, maybe 6 if forced cleanup didn't remove fresh ones)
    // In my logic, I force cleanup if >= limit.
    // Since all are fresh (time=0), pending TTL=20. None should be removed by TTL.
    // But Force Prune might remove some.
    const count = Object.keys(Memory.dispatch.tasks).length;
    console.log(`Tasks count: ${count} (Limit 5)`);
    // Expected: 5 or 6 depending on logic details. My logic accepts the 6th then cleans.
    
    // 3. Test Status Transitions & Assignment
    console.log("[Test] Assignment & Status");
    const task = Memory.dispatch.tasks['task_0'];
    if (task.status === TaskStatus.PENDING) console.log("PASS: Initial status PENDING");
    else console.log(`FAIL: Initial status ${task.status}`);
    
    // Mock a room and creep
    const mockRoom = {
        name: 'W1N1',
        find: () => [{
            id: 'creep_1',
            memory: { role: 'hauler' },
            pos: { getRangeTo: () => 1 },
            getActiveBodyparts: () => 1,
            store: { getCapacity: () => 100 },
            ticksToLive: 1500
        }]
    } as any;
    
    // Dispatch
    GlobalDispatch.run(mockRoom);
    if (task.status === TaskStatus.RUNNING) console.log("PASS: Status -> RUNNING after assignment");
    else console.log(`FAIL: Status ${task.status} after assignment`);
    
    // 4. Test Completion & TTL
    console.log("[Test] Completion & TTL");
    // Mark task_0 as autoRemove
    task.autoRemove = true;
    GlobalDispatch.completeTask(task.id, 'creep_1');
    
    if (task.status === TaskStatus.COMPLETED) console.log("PASS: Status -> COMPLETED");
    else console.log(`FAIL: Status ${task.status} after complete`);
    
    // Advance time to trigger TTL
    Game.time = 15; // > 10 (completed TTL)
    
    // Run cleanup manually (or via run)
    // cleanupInterval is 5. 15 % 5 == 0.
    GlobalDispatch.run(mockRoom);
    
    if (!Memory.dispatch.tasks['task_0']) console.log("PASS: Task removed after TTL");
    else console.log("FAIL: Task task_0 still exists");
    
    // 5. Test Failure & Retries
    console.log("[Test] Failure & Retries");
    const task1 = Memory.dispatch.tasks['task_1']; // Should exist
    if (task1) {
        GlobalDispatch.markTaskFailed(task1.id, "Path blocked");
        if (task1.status === TaskStatus.PENDING && task1.retries === 1) console.log("PASS: Task retry 1 (PENDING)");
        else console.log(`FAIL: Task status ${task1.status}, retries ${task1.retries}`);
        
        GlobalDispatch.markTaskFailed(task1.id, "Path blocked");
        GlobalDispatch.markTaskFailed(task1.id, "Path blocked"); 
        // 3rd retry (max 2) -> Should remove
        
        if (!Memory.dispatch.tasks['task_1']) console.log("PASS: Task removed after max retries");
        else console.log("FAIL: Task task_1 still exists");
    } else {
        console.log("SKIP: task_1 missing");
    }
    
    // 6. Test Expiration
    console.log("[Test] Expiration");
    const task2 = Memory.dispatch.tasks['task_2'];
    if (task2) {
        Game.time = 50; // > 20 (pending TTL) + creation time 0
        GlobalDispatch.run(mockRoom);
        
        if (!Memory.dispatch.tasks['task_2']) console.log("PASS: Pending task expired and removed");
        else console.log(`FAIL: Task task_2 state ${Memory.dispatch.tasks['task_2'].status}`);
    }

    console.log("=== Test Complete ===");
};
