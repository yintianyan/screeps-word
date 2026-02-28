
// Emergency Task Cleanup Tool
// Clears task queue to fix overflow issues (2475+ tasks)
// Run this once via console or main.ts

export const emergencyCleanup = {
    run: function() {
        if (!Memory.dispatch) return;
        
        const before = Object.keys(Memory.dispatch.tasks || {}).length;
        console.log(`[EmergencyCleanup] Starting purge. Current tasks: ${before}`);
        
        // 1. Wipe everything
        Memory.dispatch.tasks = {};
        Memory.dispatch.assignments = {};
        Memory.dispatch.queues = {
            0: [], 1: [], 2: [], 3: [], 4: [], 5: []
        };
        
        // 2. Reset Config to new defaults (to pick up reduced TTL)
        // Explicitly delete so GlobalDispatch.init() re-creates it
        delete Memory.config.taskManager;
        
        console.log(`[EmergencyCleanup] Purge complete. Tasks reset to 0.`);
    }
};

export default emergencyCleanup;
