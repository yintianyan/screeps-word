/**
 * Core Cache Module
 * 
 * Provides two layers of caching to optimize CPU usage:
 * 1. TickCache: Valid only for the current tick. Cleared automatically.
 *    - Used for: room.find() results, creep counts, structure lists.
 * 2. HeapCache: Valid across ticks (in global scope). Persistent until code reload.
 *    - Used for: Path matrices, distance maps, room layout analysis.
 */

const Cache = {
    // === 1. Tick Cache (Reset every tick in main loop) ===
    _tick: {},
    
    // Call this at the start of every tick
    clearTick: function() {
        this._tick = {};
    },

    /**
     * Get or set a tick-scoped value
     * @param {string} key Unique key
     * @param {Function} fetchFn Function to execute if key is missing
     * @returns {any} Cached value
     */
    getTick: function(key, fetchFn) {
        if (this._tick[key] === undefined) {
            this._tick[key] = fetchFn();
        }
        return this._tick[key];
    },

    // === 2. Heap Cache (Persistent in global) ===
    _heap: {},

    /**
     * Get or set a heap-scoped value
     * @param {string} key Unique key
     * @param {Function} fetchFn Function to execute if key is missing
     * @param {number} ttl (Optional) Time to live in ticks. If 0/undefined, lives forever.
     * @returns {any} Cached value
     */
    getHeap: function(key, fetchFn, ttl) {
        const now = Game.time;
        const entry = this._heap[key];

        if (entry === undefined || (entry.expire && entry.expire < now)) {
            const data = fetchFn();
            this._heap[key] = {
                data: data,
                expire: ttl ? now + ttl : null
            };
            return data;
        }
        return entry.data;
    },

    /**
     * Specialized: Get creeps by role in a room (Tick Cached)
     * @param {Room} room
     * @param {string} role
     */
    getCreepsByRole: function(room, role) {
        const key = `creeps_${room.name}`;
        const allCreeps = this.getTick(key, () => {
            // Group by role
            const groups = {};
            room.find(FIND_MY_CREEPS).forEach(c => {
                const r = c.memory.role || 'unknown';
                if (!groups[r]) groups[r] = [];
                groups[r].push(c);
            });
            return groups;
        });
        return allCreeps[role] || [];
    },

    /**
     * Specialized: Get structures by type in a room (Tick Cached)
     * @param {Room} room
     * @param {string} type STRUCTURE_* constant
     */
    getStructures: function(room, type) {
        const key = `structs_${room.name}_${type}`;
        return this.getTick(key, () => {
            return room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === type
            });
        });
    }
};

module.exports = Cache;