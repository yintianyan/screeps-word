const Cache = require('core.cache');

/**
 * Core Kernel
 * 
 * Manages the lifecycle of all game modules.
 * Responsibilities:
 * 1. Initialize and shutdown modules.
 * 2. Run modules with error handling (try-catch).
 * 3. Monitor CPU usage per module.
 */
const Kernel = {
    modules: [],
    profiler: {},

    /**
     * Register a module to the kernel
     * @param {string} name 
     * @param {Object} module Object with run(room) or run() method
     * @param {string} type 'room' (default) or 'global'
     */
    register: function(name, module, type = 'room') {
        this.modules.push({ name, module, type });
    },

    /**
     * Main execution loop. Call this in main.js
     */
    run: function() {
        // 1. System Maintenance
        Cache.clearTick(); // Reset tick cache
        
        // Clear dead memory
        if (Game.time % 10 === 0) {
            for (const name in Memory.creeps) {
                if (!Game.creeps[name]) {
                    delete Memory.creeps[name];
                }
            }
        }

        // 2. Run Modules for Each Room
        // We iterate rooms first, then modules, to share room-level cache
        for (const name in Game.rooms) {
            const room = Game.rooms[name];
            
            // Skip unowned rooms if necessary, but we might want to scout them
            if (!room.controller || !room.controller.my) continue;

            this.modules.forEach(({ name, module, type }) => {
                if (type === 'global') return; // Skip global modules in room loop

                const startCpu = Game.cpu.getUsed();
                try {
                    if (module.run) {
                        module.run(room);
                    }
                } catch (e) {
                    console.log(`[Kernel] Error in module ${name}: ${e.stack}`);
                }
                const used = Game.cpu.getUsed() - startCpu;
                this.recordStats(name, used);
            });
        }

        // 3. Run Global Modules
        this.modules.forEach(({ name, module, type }) => {
            if (type !== 'global') return;

            const startCpu = Game.cpu.getUsed();
            try {
                if (module.run) {
                    module.run();
                }
            } catch (e) {
                console.log(`[Kernel] Error in global module ${name}: ${e.stack}`);
            }
            const used = Game.cpu.getUsed() - startCpu;
            this.recordStats(name, used);
        });
    },

    recordStats: function(name, cpu) {
        if (!this.profiler[name]) {
            this.profiler[name] = { total: 0, count: 0, min: 999, max: 0 };
        }
        const stats = this.profiler[name];
        stats.total += cpu;
        stats.count++;
        stats.min = Math.min(stats.min, cpu);
        stats.max = Math.max(stats.max, cpu);
    },

    getReport: function() {
        let report = "=== Kernel Performance Report ===\n";
        for (const name in this.profiler) {
            const s = this.profiler[name];
            const avg = (s.total / s.count).toFixed(2);
            report += `${name}: Avg ${avg} | Max ${s.max.toFixed(2)}\n`;
        }
        return report;
    }
};

module.exports = Kernel;