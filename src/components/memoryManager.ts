/**
 * 核心缓存模块 (Core Cache Module)
 * 
 * 提供两层缓存以优化 CPU 使用：
 * 1. TickCache (Tick 级缓存): 仅在当前 tick 有效，tick 结束自动清除。
 *    - 用途：room.find() 结果、Creep 计数、建筑列表。
 * 2. HeapCache (堆缓存): 跨 tick 有效 (全局作用域)。直到代码重载前一直存在。
 *    - 用途：路径矩阵 (Path matrices)、距离图、房间布局分析。
 */

const Cache = {
    // === 1. Tick 缓存 (主循环每 tick 重置) ===
    _tick: {},
    
    // 在每 tick 开始时调用
    clearTick: function() {
        this._tick = {};
    },

    /**
     * 获取或设置 tick 级缓存值
     * @param {string} key 唯一键
     * @param {Function} fetchFn 如果键缺失则执行的获取函数
     * @returns {any} 缓存值
     */
    getTick: function(key, fetchFn) {
        if (this._tick[key] === undefined) {
            this._tick[key] = fetchFn();
        }
        return this._tick[key];
    },

    // === 2. 堆缓存 (Heap Cache - 持久化于 Global) ===
    _heap: {},

    /**
     * 获取或设置堆级缓存值 (Heap)
     * @param {string} key 唯一键
     * @param {Function} fetchFn 如果键缺失则执行的获取函数
     * @param {number} ttl (可选) 存活时间 (tick 数)。如果为 0/undefined，则永久有效。
     * @returns {any} 缓存值
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
     * 专用：获取房间内指定角色的 Creeps (Tick 缓存)
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
     * 专用：获取房间内指定类型的建筑 (Tick 缓存)
     * @param {Room} room
     * @param {string} type STRUCTURE_* 常量
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

export default Cache;