
// Utility to cleanup tasks from memory
module.exports = {
    run: function() {
        if (!Memory.dispatch) return;
        
        console.log(`[Cleanup] Starting cleanup. Tasks: ${Object.keys(Memory.dispatch.tasks).length}`);
        
        // 1. Reset Tasks
        Memory.dispatch.tasks = {};
        Memory.dispatch.assignments = {};
        
        // 2. Reset Queues
        Memory.dispatch.queues = {
            0: [], 1: [], 2: [], 3: [], 4: [], 5: []
        };
        
        console.log(`[Cleanup] Complete. Tasks: ${Object.keys(Memory.dispatch.tasks).length}`);
    }
};
