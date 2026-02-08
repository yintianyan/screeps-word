'use strict';

var _ = require('lodash');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var ___namespace = /*#__PURE__*/_interopNamespaceDefault(_);

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
    clearTick: function () {
        this._tick = {};
    },
    /**
     * 获取或设置 tick 级缓存值
     * @param {string} key 唯一键
     * @param {Function} fetchFn 如果键缺失则执行的获取函数
     * @returns {any} 缓存值
     */
    getTick: function (key, fetchFn) {
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
    getHeap: function (key, fetchFn, ttl) {
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
    getCreepsByRole: function (room, role) {
        const key = `creeps_${room.name}`;
        const allCreeps = this.getTick(key, () => {
            // Group by role
            const groups = {};
            room.find(FIND_MY_CREEPS).forEach(c => {
                const r = c.memory.role || 'unknown';
                if (!groups[r])
                    groups[r] = [];
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
    getStructures: function (room, type) {
        const key = `structs_${room.name}_${type}`;
        return this.getTick(key, () => {
            return room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === type
            });
        });
    }
};

/**
 * 核心内核 (Core Kernel)
 *
 * 管理所有游戏模块的生命周期。
 * 职责：
 * 1. 初始化和关闭模块。
 * 2. 运行模块并处理错误 (try-catch)。
 * 3. 监控每个模块的 CPU 使用率。
 */
const Kernel = {
    modules: [],
    profiler: {},
    /**
     * 注册模块到内核
     * @param {string} name 模块名称
     * @param {Object} module 包含 run(room) 或 run() 方法的对象
     * @param {string} type 'room' (默认) 或 'global'
     */
    register: function (name, module, type = "room") {
        this.modules.push({ name, module, type });
    },
    /**
     * 主执行循环。在 main.js 中调用
     */
    run: function () {
        // 1. 系统维护
        Cache.clearTick(); // 重置 tick 缓存
        // 清理失效内存
        if (Game.time % 10 === 0) {
            for (const name in Memory.creeps) {
                if (!Game.creeps[name]) {
                    delete Memory.creeps[name];
                }
            }
        }
        // 2. 逐房间运行模块
        // 优先遍历房间，再遍历模块，以共享房间级缓存
        for (const name in Game.rooms) {
            const room = Game.rooms[name];
            // 如果需要，跳过非己方房间，但我们可能想要侦查它们
            if (!room.controller || !room.controller.my)
                continue;
            this.modules.forEach(({ name, module, type }) => {
                if (type === "global")
                    return; // 在房间循环中跳过全局模块
                const startCpu = Game.cpu.getUsed();
                try {
                    if (module.run) {
                        module.run(room);
                    }
                }
                catch (e) {
                    console.log(`[Kernel] 模块 ${name} 发生错误: ${e.stack}`);
                }
                const used = Game.cpu.getUsed() - startCpu;
                this.recordStats(name, used);
            });
        }
        // 3. 运行全局模块
        this.modules.forEach(({ name, module, type }) => {
            if (type !== "global")
                return;
            const startCpu = Game.cpu.getUsed();
            try {
                if (module.run) {
                    module.run();
                }
            }
            catch (e) {
                console.log(`[Kernel] 全局模块 ${name} 发生错误: ${e.stack}`);
            }
            const used = Game.cpu.getUsed() - startCpu;
            this.recordStats(name, used);
        });
    },
    recordStats: function (name, cpu) {
        if (!this.profiler[name]) {
            this.profiler[name] = { total: 0, count: 0, min: 999, max: 0 };
        }
        const stats = this.profiler[name];
        stats.total += cpu;
        stats.count++;
        stats.min = Math.min(stats.min, cpu);
        stats.max = Math.max(stats.max, cpu);
    },
    getReport: function () {
        let report = "=== Kernel Performance Report ===\n";
        for (const name in this.profiler) {
            const s = this.profiler[name];
            const avg = (s.total / s.count).toFixed(2);
            report += `${name}: Avg ${avg} | Max ${s.max.toFixed(2)}\n`;
        }
        return report;
    },
};

/**
 * 生命周期管理系统 (Lifecycle Management System)
 *
 * 职责：
 * 1. 监控 Creep 健康状态：检测 TTL < 10% (150 ticks) 的情况。
 * 2. 管理替换：将替换请求加入队列，并支持内存继承。
 * 3. 日志与历史：追踪孵化事件。
 * 4. 内存清理：清理无效的 Memory.creeps。
 */
const Lifecycle = {
    // 配置
    config: {
        thresholdRatio: 0.1, // 剩余寿命 10% 时触发替换
        checkInterval: 5, // 每 5 ticks 检查一次以节省 CPU
        historyLength: 50,
    },
    /**
     * 主运行循环
     */
    run: function () {
        if (Game.time % this.config.checkInterval !== 0)
            return;
        this.initMemory();
        this.monitorCreeps();
        this.cleanupMemory();
    },
    initMemory: function () {
        if (!Memory.lifecycle) {
            Memory.lifecycle = {
                requests: {}, // creepName -> { role, memory, priority }
                history: [],
                registry: {}, // creepName -> status (NORMAL, PRE_SPAWNING)
            };
        }
    },
    /**
     * 扫描所有 Creep 以检查是否需要替换
     */
    monitorCreeps: function () {
        const registry = Memory.lifecycle.registry;
        const requests = Memory.lifecycle.requests;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            // 如果已经在处理中，则跳过
            if (registry[name] === "PRE_SPAWNING")
                continue;
            if (creep.spawning)
                continue;
            const maxLife = 1500; // 标准 Creep 寿命
            const threshold = maxLife * this.config.thresholdRatio; // 150 ticks
            if (creep.ticksToLive < threshold) {
                // 触发替换
                console.log(`[Lifecycle] ⚠️ ${name} 濒死 (TTL: ${creep.ticksToLive}). 请求替换。`);
                registry[name] = "PRE_SPAWNING";
                // 创建孵化请求
                requests[name] = {
                    role: creep.memory.role,
                    baseMemory: JSON.parse(JSON.stringify(creep.memory)), // 深拷贝
                    priority: this.getPriority(creep.memory.role),
                    requestTime: Game.time,
                };
                // 记录日志
                this.logEvent(name, "WARNING", `TTL < ${threshold}, 已请求替换`);
            }
            else {
                registry[name] = "NORMAL";
            }
        }
    },
    /**
     * 根据角色确定优先级
     */
    getPriority: function (role) {
        const priorities = {
            harvester: 100,
            hauler: 90,
            upgrader: 50,
            builder: 10,
        };
        return priorities[role] || 1;
    },
    /**
     * 当替换者成功孵化时由 Spawner 调用
     */
    notifySpawn: function (oldCreepName, newCreepName) {
        if (Memory.lifecycle.requests[oldCreepName]) {
            delete Memory.lifecycle.requests[oldCreepName];
            this.logEvent(oldCreepName, "REPLACED", `替换者已孵化: ${newCreepName}`);
        }
    },
    /**
     * 清理无效内存
     */
    cleanupMemory: function () {
        const registry = Memory.lifecycle.registry;
        const requests = Memory.lifecycle.requests;
        // 1. Clean Registry
        for (const name in registry) {
            if (!Game.creeps[name]) {
                // Creep 已死亡
                if (requests[name]) {
                    // 如果请求仍存在，说明未能及时替换！
                    this.logEvent(name, "FAILURE", "Creep 在替换者孵化前已死亡");
                    delete requests[name];
                }
                delete registry[name];
            }
        }
        // 2. Clean Global Memory
        for (const name in Memory.creeps) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
                console.log(`[Lifecycle] 🗑️ 清理无效内存: ${name}`);
            }
        }
    },
    /**
     * 检查 Creep 是否计入人口限制
     * 如果 Creep 濒死且已请求替换，返回 FALSE
     * 这允许人口计数器为新 Creep "腾出空间"
     */
    isOperational: function (creep) {
        if (!Memory.lifecycle || !Memory.lifecycle.registry)
            return true;
        // 如果标记为 PRE_SPAWNING，它实际上不再计入，
        // 允许 Spawner 在不触及上限的情况下创建其替换者。
        if (Memory.lifecycle.registry[creep.name] === "PRE_SPAWNING") {
            return false;
        }
        return true;
    },
    /**
     * 获取待处理的孵化请求
     */
    getRequests: function () {
        return Memory.lifecycle ? Memory.lifecycle.requests : {};
    },
    // === API & 日志 ===
    logEvent: function (creepName, type, message) {
        const entry = {
            time: Game.time,
            creep: creepName,
            type: type,
            message: message,
        };
        Memory.lifecycle.history.unshift(entry);
        if (Memory.lifecycle.history.length > this.config.historyLength) {
            Memory.lifecycle.history.pop();
        }
    },
    getHistory: function () {
        return Memory.lifecycle ? Memory.lifecycle.history : [];
    },
    getWarningList: function () {
        const list = [];
        const registry = Memory.lifecycle ? Memory.lifecycle.registry : {};
        for (const name in registry) {
            if (registry[name] === "PRE_SPAWNING") {
                list.push({
                    name: name,
                    ttl: Game.creeps[name] ? Game.creeps[name].ticksToLive : 0,
                });
            }
        }
        return list;
    },
};

const priorityModule = {
    /**
     * 获取建筑类型的优先级
     * 数值越大优先级越高
     */
    getPriority: function (structureType) {
        switch (structureType) {
            case STRUCTURE_SPAWN: return 100; // 重生点最重要
            case STRUCTURE_TOWER: return 90; // 防御塔也很重要
            case STRUCTURE_EXTENSION: return 80;
            case STRUCTURE_CONTAINER: return 70;
            case STRUCTURE_STORAGE: return 60;
            case STRUCTURE_LINK: return 50;
            case STRUCTURE_EXTRACTOR: return 40;
            case STRUCTURE_LAB: return 40;
            case STRUCTURE_TERMINAL: return 40;
            case STRUCTURE_FACTORY: return 40;
            case STRUCTURE_OBSERVER: return 40;
            case STRUCTURE_POWER_SPAWN: return 40;
            case STRUCTURE_NUKER: return 40;
            case STRUCTURE_ROAD: return 10; // 路最后修
            case STRUCTURE_RAMPART: return 50; // 防御工事优于道路
            case STRUCTURE_WALL: return 15; // 墙壁优于道路
            default: return 5;
        }
    },
    /**
     * 比较两个建筑工地的优先级
     * 用于 sort 函数: sites.sort(priorityModule.compare)
     */
    compare: function (a, b) {
        const priorityA = priorityModule.getPriority(a.structureType);
        const priorityB = priorityModule.getPriority(b.structureType);
        if (priorityA !== priorityB) {
            return priorityB - priorityA; // 降序排列
        }
        // 如果优先级相同，比较完成度 (剩下的工程量越小越优先)
        const progressA = a.progress / a.progressTotal;
        const progressB = b.progress / b.progressTotal;
        return progressB - progressA;
    },
    /**
     * 获取最高优先级的工地
     * @param {Array<ConstructionSite>} sites
     * @param {RoomPosition} creepPos (可选) 如果提供，同一优先级下选择最近的
     */
    getBestTarget: function (sites, creepPos) {
        if (!sites || sites.length === 0)
            return null;
        // 1. 按优先级分组
        // 既然我们只是要找最好的，可以遍历一遍找到最高优先级
        let maxPriority = -1;
        let bestSites = [];
        sites.forEach(site => {
            const p = this.getPriority(site.structureType);
            if (p > maxPriority) {
                maxPriority = p;
                bestSites = [site];
            }
            else if (p === maxPriority) {
                bestSites.push(site);
            }
        });
        if (bestSites.length === 0)
            return null;
        // 2. 在同优先级下，优先 "集中火力"
        // 如果有已经开工的 (progress > 0)，优先修进度最快的，忽略距离
        // 这样可以避免大家雨露均沾，而是合力先修完一个
        const inProgress = bestSites.filter(s => s.progress > 0);
        if (inProgress.length > 0) {
            inProgress.sort((a, b) => (b.progress / b.progressTotal) - (a.progress / a.progressTotal));
            return inProgress[0];
        }
        // 3. 如果都没开工，再找最近的，避免舍近求远
        if (creepPos) {
            return creepPos.findClosestByPath(bestSites);
        }
        // 4. 如果没有位置信息，随便返回一个 (或者按 id 排序保证确定性)
        return bestSites[0];
    }
};

const TaskManager = {
    // === 任务难度阈值 (Thresholds) ===
    config: {
        // 建造难度 (progressTotal)
        construction: {
            LOW: 1000, // < 1000: 小工程 (Extensions)
            MEDIUM: 10000, // < 10000: 中等工程 (Containers)
            HIGH: 50000, // > 50000: 大工程 (Spawn, Storage)
        },
        // 维修难度 (hits to repair)
        repair: {
            LOW: 5000,
            MEDIUM: 20000,
            HIGH: 100000,
        },
        // 运输负载 (accumulated energy)
        transport: {
            LOW: 1000,
            MEDIUM: 3000,
            HIGH: 8000,
        },
    },
    /**
     * 分析房间内的任务负载
     * @param {Room} room
     */
    analyze: function (room) {
        const constructionLoad = this.getConstructionLoad(room);
        const repairLoad = this.getRepairLoad(room);
        const transportLoad = this.getTransportLoad(room);
        // 存储到 Heap 缓存或 Memory 中，供 Population 使用
        // 使用 Cache.getHeap 来存储分析结果，每 10 tick 更新一次
        // 但这里是 analyze 函数，应该是被调用的。
        // 我们返回结果。
        return {
            construction: constructionLoad,
            repair: repairLoad,
            transport: transportLoad,
        };
    },
    /**
     * 计算建造负载
     */
    getConstructionLoad: function (room) {
        const sites = Cache.getTick(`sites_${room.name}`, () => room.find(FIND_MY_CONSTRUCTION_SITES));
        let totalProgressNeeded = 0;
        let maxPriority = -1;
        let maxStructureType = null;
        sites.forEach((s) => {
            const needed = s.progressTotal - s.progress;
            totalProgressNeeded += needed;
            const p = priorityModule.getPriority(s.structureType);
            if (p > maxPriority) {
                maxPriority = p;
                maxStructureType = s.structureType;
            }
        });
        let difficulty = "NONE";
        if (totalProgressNeeded > 0) {
            if (totalProgressNeeded < this.config.construction.LOW)
                difficulty = "LOW";
            else if (totalProgressNeeded < this.config.construction.MEDIUM)
                difficulty = "MEDIUM";
            else
                difficulty = "HIGH";
        }
        return {
            total: totalProgressNeeded,
            difficulty: difficulty,
            primaryTarget: maxStructureType,
            count: sites.length,
        };
    },
    /**
     * 计算维修负载 (仅计算非墙类关键设施)
     */
    getRepairLoad: function (room) {
        // 仅扫描路、Container、Rampart (低血量)
        const targets = room.find(FIND_STRUCTURES, {
            filter: (s) => {
                if (s.structureType === STRUCTURE_WALL)
                    return false;
                if (s.structureType === STRUCTURE_RAMPART &&
                    s.hits > 10000)
                    return false;
                return s.hits < s.hitsMax * 0.8;
            },
        });
        let totalRepairNeeded = 0;
        targets.forEach((s) => {
            totalRepairNeeded += s.hitsMax - s.hits;
        });
        let difficulty = "NONE";
        if (totalRepairNeeded > 0) {
            if (totalRepairNeeded < this.config.repair.LOW)
                difficulty = "LOW";
            else if (totalRepairNeeded < this.config.repair.MEDIUM)
                difficulty = "MEDIUM";
            else
                difficulty = "HIGH";
        }
        return {
            total: totalRepairNeeded,
            difficulty: difficulty,
            count: targets.length,
        };
    },
    /**
     * 计算运输负载 (积压能量)
     */
    getTransportLoad: function (room) {
        // 统计 Container 和 Dropped Resources 的总能量
        const containers = Cache.getStructures(room, STRUCTURE_CONTAINER);
        let piledEnergy = 0;
        containers.forEach((c) => {
            piledEnergy += c.store[RESOURCE_ENERGY];
        });
        const dropped = Cache.getTick(`dropped_${room.name}`, () => room.find(FIND_DROPPED_RESOURCES));
        dropped.forEach((r) => {
            if (r.resourceType === RESOURCE_ENERGY) {
                piledEnergy += r.amount;
            }
        });
        // 减去 Storage 的能量 (那是终点，不是负载)
        // 但如果 Storage 满了，可能也算某种负载？暂不考虑。
        let difficulty = "NONE";
        if (piledEnergy > this.config.transport.HIGH)
            difficulty = "HIGH";
        else if (piledEnergy > this.config.transport.MEDIUM)
            difficulty = "MEDIUM";
        else if (piledEnergy > this.config.transport.LOW)
            difficulty = "LOW";
        return {
            total: piledEnergy,
            difficulty: difficulty,
        };
    },
};

const populationModule = {
    // === 配置区域 (Config) ===
    config: {
        // 角色基础配比
        ratios: {
            harvesterPerSource: 1, // 每个 Source 1 个 Harvester (定点挖掘)
            haulerBaseCount: 1, // 基础 Hauler 数量
        },
        // 角色上限
        limits: {
            builder: 3,
            upgrader: 3,
            hauler: 6,
        },
        // 能量等级阈值 (Hysteresis implemented in logic)
        thresholds: {
            low: 0.5,
            high: 0.8,
        },
        // 部件限制
        partLimits: {
            LOW: 3,
            MEDIUM: 6,
            HIGH: 12, // Increased slightly from 10 to allow better RCL3+ creeps
        },
    },
    /**
     * 标准内核模块接口
     */
    run: function (room) {
        // 每 5 tick 运行一次重新平衡
        if (Game.time % 5 === 0) {
            this.rebalanceHaulers(room);
            this.updateEnergyLevel(room);
        }
    },
    /**
     * 更新房间能量等级 (带滞后机制)
     */
    updateEnergyLevel: function (room) {
        if (!room.memory.energyLevel) {
            room.memory.energyLevel = "LOW";
        }
        const capacity = room.energyCapacityAvailable || 300;
        const available = room.energyAvailable;
        const percentage = available / capacity;
        const currentLevel = room.memory.energyLevel;
        // Critical check (Override)
        if (available < 300 && capacity >= 300) {
            room.memory.energyLevel = "CRITICAL";
            return;
        }
        let newLevel = currentLevel;
        // Hysteresis Buffers: +/- 0.05
        if (currentLevel === "CRITICAL") {
            if (available >= 300)
                newLevel = "LOW";
        }
        else if (currentLevel === "LOW") {
            if (percentage > this.config.thresholds.low + 0.05)
                newLevel = "MEDIUM";
        }
        else if (currentLevel === "MEDIUM") {
            if (percentage > this.config.thresholds.high + 0.05)
                newLevel = "HIGH";
            if (percentage < this.config.thresholds.low - 0.05)
                newLevel = "LOW";
        }
        else if (currentLevel === "HIGH") {
            if (percentage < this.config.thresholds.high - 0.05)
                newLevel = "MEDIUM";
        }
        if (newLevel !== currentLevel) {
            room.memory.energyLevel = newLevel;
            console.log(`[Energy] Room ${room.name} level changed: ${currentLevel} -> ${newLevel} (${(percentage * 100).toFixed(1)}%)`);
        }
    },
    getEnergyLevel: function (room) {
        return room.memory.energyLevel || "LOW";
    },
    /** @param {Room} room **/
    calculateTargets: function (room) {
        const targets = {
            harvester: 0,
            upgrader: 0,
            builder: 0,
            hauler: 0,
        };
        // 使用缓存获取 Source (堆缓存)
        const sources = Cache.getHeap(`sources_${room.name}`, () => room.find(FIND_SOURCES), 1000);
        // === 1. Harvester: 动态计算 ===
        let harvesterTarget = 0;
        sources.forEach((source) => {
            const spots = Cache.getHeap(`spots_${source.id}`, () => {
                let count = 0;
                const terrain = room.getTerrain();
                for (let x = -1; x <= 1; x++) {
                    for (let y = -1; y <= 1; y++) {
                        if (x === 0 && y === 0)
                            continue;
                        if (terrain.get(source.pos.x + x, source.pos.y + y) !==
                            TERRAIN_MASK_WALL) {
                            count++;
                        }
                    }
                }
                return count;
            }, 1000);
            let desired = 1;
            // 如果能量等级是 CRITICAL 或 LOW，且还有空位，允许更多 Harvester 快速恢复
            const level = this.getEnergyLevel(room);
            if ((level === "CRITICAL" || level === "LOW") && spots > 1) {
                // Check if we actually need more (e.g. creep size is small)
                desired = Math.min(spots, 2);
            }
            harvesterTarget += desired;
        });
        targets.harvester = harvesterTarget;
        // === 2. Energy Check for Builder/Upgrader ===
        // Check if we are in early game (RCL < 3)
        // const isEarlyGame = room.controller && room.controller.level < 3;
        const level = this.getEnergyLevel(room);
        // Get harvesters count for safety checks
        const harvesters = Cache.getCreepsByRole(room, "harvester").length;
        // Analyze Task Loads
        const tasks = TaskManager.analyze(room);
        // Default 0
        targets.builder = 0;
        targets.upgrader = 1;
        // --- Dynamic Builder Logic based on Task Difficulty ---
        if (tasks.construction.difficulty === "HIGH") {
            targets.builder = 3;
        }
        else if (tasks.construction.difficulty === "MEDIUM") {
            targets.builder = 2;
        }
        else if (tasks.construction.difficulty === "LOW") {
            targets.builder = 1;
        }
        else {
            // No construction -> Check repair load
            // If repair is HIGH, maybe spawn a builder (which also repairs)
            if (tasks.repair.difficulty === "HIGH")
                targets.builder = 1;
        }
        // Energy Constraint Override
        if (level === "CRITICAL") {
            targets.builder = 0;
            targets.upgrader = 0; // Stop upgrading in critical unless downgrade imminent
            if (room.controller && room.controller.ticksToDowngrade < 2000)
                targets.upgrader = 1;
        }
        else if (level === "LOW") {
            // In early game LOW, building extensions is risky if it drains spawn
            // Only build if we have at least 1 full harvester working?
            // Reduce builder count by 1 (min 0)
            targets.builder = Math.max(0, targets.builder - 1);
            // But if critical sites exist, keep at least 1
            if (tasks.construction.primaryTarget === STRUCTURE_EXTENSION ||
                tasks.construction.primaryTarget === STRUCTURE_SPAWN) {
                if (targets.builder === 0 && harvesters > 0)
                    targets.builder = 1;
            }
            targets.upgrader = 1;
        }
        else if (level === "MEDIUM") {
            // Allow calculated targets, but cap upgrader
            targets.upgrader = 2;
        }
        else if (level === "HIGH") {
            // Allow max
            targets.upgrader = 3;
            // If no construction, boost upgrader
            if (targets.builder === 0)
                targets.upgrader = 4;
        }
        // Limits
        targets.builder = Math.min(targets.builder, this.config.limits.builder);
        targets.upgrader = Math.min(targets.upgrader, this.config.limits.upgrader);
        // === 3. Hauler Calculation ===
        const haulerNeeds = this.getHaulerNeeds(room);
        targets.hauler = 0;
        for (const sourceId in haulerNeeds) {
            targets.hauler += haulerNeeds[sourceId];
        }
        targets.hauler = Math.min(targets.hauler, this.config.limits.hauler);
        // Safety for Hauler
        if (targets.harvester > 0 && targets.hauler < 1) {
            targets.hauler = 1;
        }
        if (tasks.construction.count === 0 && tasks.repair.count === 0) {
            targets.builder = 0;
        }
        // Limits
        targets.builder = Math.min(targets.builder, this.config.limits.builder);
        targets.upgrader = Math.min(targets.upgrader, this.config.limits.upgrader);
        // If upgrading, ensure enough haulers
        if (targets.upgrader > 1) ;
        return targets;
    },
    /**
     * 智能计算每个 Source 需要的 Hauler 数量
     */
    getHaulerNeeds: function (room) {
        const needs = {};
        const sources = Cache.getHeap(`sources_${room.name}`, () => room.find(FIND_SOURCES), 1000);
        let globalBoost = 0;
        const upgraders = Cache.getCreepsByRole(room, "upgrader").filter((c) => Lifecycle.isOperational(c));
        const avgIdle = upgraders.reduce((sum, c) => sum + (c.memory.idleTicks || 0), 0) /
            (upgraders.length || 1);
        if (avgIdle > 20) {
            globalBoost = 1;
        }
        const overrides = Memory.config && Memory.config.haulerOverrides
            ? Memory.config.haulerOverrides
            : {};
        sources.forEach((source) => {
            if (overrides[source.id] !== undefined) {
                needs[source.id] = overrides[source.id];
                return;
            }
            let count = this.config.ratios.haulerBaseCount;
            const allContainers = Cache.getStructures(room, STRUCTURE_CONTAINER);
            const container = allContainers.find((c) => c.pos.inRangeTo(source, 2));
            if (container) {
                const energy = container.store[RESOURCE_ENERGY];
                if (energy > 1500)
                    count += 2; // Aggressive hauling for high stockpile
                else if (energy > 800)
                    count += 1;
            }
            const allDropped = Cache.getTick(`dropped_${room.name}`, () => room.find(FIND_DROPPED_RESOURCES));
            const dropped = allDropped.filter((r) => r.resourceType === RESOURCE_ENERGY && r.pos.inRangeTo(source, 3));
            const droppedAmount = dropped.reduce((sum, r) => sum + r.amount, 0);
            if (droppedAmount > 500)
                count += 1;
            count += globalBoost;
            count = Math.min(count, 4); // Max 4 per source
            needs[source.id] = count;
        });
        return needs;
    },
    /**
     * 动态平衡搬运工分配
     */
    rebalanceHaulers: function (room) {
        const needs = this.getHaulerNeeds(room);
        const haulers = Cache.getCreepsByRole(room, "hauler").filter((c) => c.ticksToLive > 100 && Lifecycle.isOperational(c));
        const currentCounts = {};
        const surplus = [];
        const deficit = [];
        Object.keys(needs).forEach((id) => (currentCounts[id] = 0));
        haulers.forEach((c) => {
            if (c.memory.sourceId) {
                currentCounts[c.memory.sourceId] =
                    (currentCounts[c.memory.sourceId] || 0) + 1;
            }
        });
        for (const sourceId in needs) {
            const diff = (currentCounts[sourceId] || 0) - needs[sourceId];
            if (diff > 0) {
                const sourceHaulers = haulers.filter((c) => c.memory.sourceId === sourceId);
                for (let i = 0; i < diff; i++) {
                    if (sourceHaulers[i])
                        surplus.push(sourceHaulers[i]);
                }
            }
            else if (diff < 0) {
                deficit.push({ id: sourceId, amount: -diff });
            }
        }
        if (surplus.length > 0 && deficit.length > 0) {
            let surplusIndex = 0;
            for (const item of deficit) {
                for (let i = 0; i < item.amount; i++) {
                    if (surplusIndex >= surplus.length)
                        break;
                    const creep = surplus[surplusIndex++];
                    creep.memory.sourceId = item.id;
                    delete creep.memory.targetId;
                    creep.say("🔀 reassign");
                }
            }
        }
    },
    /**
     * 生成 Body (新版：基于能量等级)
     */
    getBody: function (room, role) {
        const level = this.getEnergyLevel(room);
        const availableEnergy = room.energyAvailable;
        const capacity = room.energyCapacityAvailable;
        // Analyze Task Loads (Cached)
        const tasks = TaskManager.analyze(room);
        // Determine max parts based on level
        let maxParts = this.config.partLimits[level] || 50;
        if (level === "CRITICAL")
            maxParts = 3;
        // --- Dynamic Body Constraints based on Tasks ---
        if (role === "builder") {
            if (tasks.construction.difficulty === "LOW" && tasks.repair.difficulty !== "HIGH") {
                maxParts = Math.min(maxParts, 6); // Cap small builders for small tasks
            }
        }
        if (role === "hauler") {
            if (tasks.transport.difficulty === "LOW") {
                maxParts = Math.min(maxParts, 8); // Don't build massive haulers if nothing to carry
            }
        }
        // Config for each role
        const configs = {
            harvester: {
                base: [WORK, CARRY, MOVE],
                grow: [WORK], // Harvester mainly needs WORK
                maxGrow: 5, // Max 5 extra WORKs (Total 6 WORK = 12 energy/tick, > source capacity)
            },
            hauler: {
                base: [CARRY, MOVE],
                grow: [CARRY, MOVE], // Keep 1:1 ratio
                maxGrow: 15,
            },
            upgrader: {
                base: [WORK, CARRY, MOVE],
                grow: [WORK, WORK, MOVE], // Slower move ratio for stationary
                maxGrow: 10,
            },
            builder: {
                base: [WORK, CARRY, MOVE],
                grow: [WORK, CARRY, MOVE], // Balanced
                maxGrow: 5,
            },
        };
        const config = configs[role];
        if (!config)
            return [WORK, CARRY, MOVE];
        // Start with base
        const body = [...config.base];
        let currentCost = this.calculateBodyCost(body);
        // Grow body
        let growCount = 0;
        const maxGrow = config.maxGrow || 50;
        // Special case for Harvester: Needs MOVE to reach source, then WORK
        // If level is High, maybe add more MOVEs?
        // For now, stick to simple growth.
        while (true) {
            // Check constraints
            if (body.length + config.grow.length > maxParts)
                break;
            if (growCount >= maxGrow)
                break;
            const growCost = this.calculateBodyCost(config.grow);
            if (currentCost + growCost > availableEnergy)
                break;
            if (currentCost + growCost > capacity)
                break; // Hard limit
            // Add parts
            config.grow.forEach((p) => body.push(p));
            currentCost += growCost;
            growCount++;
        }
        // Sort body parts (tough first, heal last - though we don't have them yet)
        // Standard Screeps order: TOUGH -> WORK/CARRY -> MOVE -> ATTACK/RANGED_ATTACK -> HEAL
        // Simple sort: WORK, CARRY, MOVE
        // Actually, for damage mitigation, MOVE last is sometimes bad if you need to run away, but standard is fine.
        // Let's just group them.
        const sortOrder = {
            [TOUGH]: 0,
            [WORK]: 1,
            [CARRY]: 2,
            [ATTACK]: 3,
            [RANGED_ATTACK]: 4,
            [HEAL]: 5,
            [CLAIM]: 6,
            [MOVE]: 7,
        };
        body.sort((a, b) => sortOrder[a] - sortOrder[b]);
        return body;
    },
    calculateBodyCost: function (body) {
        let cost = 0;
        body.forEach((part) => {
            cost += BODYPART_COST[part];
        });
        return cost;
    },
};

const structurePlanner = {
    _cache: {},
    run: function (room) {
        // 1. Analyze & Execute (Low Frequency)
        if (Game.time % 10 === 0 || !this._cache[room.name]) {
            const analysis = this.analyzeRoom(room);
            this._cache[room.name] = analysis;
            this.execute(room, analysis);
        }
        // 2. Visualize (High Frequency)
        const analysis = this._cache[room.name];
        if (analysis) {
            this.visualize(room, analysis);
        }
    },
    /**
     * 1. 空间分析模块
     */
    analyzeRoom: function (room) {
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        const sources = room.find(FIND_SOURCES);
        const controller = room.controller;
        if (!spawn || !controller)
            return null;
        // 计算资源点几何中心
        let sumX = 0, sumY = 0;
        sources.forEach((s) => {
            sumX += s.pos.x;
            sumY += s.pos.y;
        });
        const centerPos = new RoomPosition(Math.floor(sumX / sources.length), Math.floor(sumY / sources.length), room.name);
        // 计算 Spawn 到几何中心的距离
        const spawnToCenter = spawn.pos.getRangeTo(centerPos);
        // 计算 Spawn 到各资源点的平均距离
        let totalSpawnDist = 0;
        sources.forEach((s) => (totalSpawnDist += spawn.pos.getRangeTo(s)));
        const avgSpawnDist = totalSpawnDist / sources.length;
        // 计算控制器到最近资源点的距离
        let minControllerDist = 999;
        sources.forEach((s) => {
            const d = controller.pos.getRangeTo(s);
            if (d < minControllerDist)
                minControllerDist = d;
        });
        // 资源点分布跨度
        let maxSourceSpan = 0;
        for (let i = 0; i < sources.length; i++) {
            for (let j = i + 1; j < sources.length; j++) {
                const d = sources[i].pos.getRangeTo(sources[j]);
                if (d > maxSourceSpan)
                    maxSourceSpan = d;
            }
        }
        return {
            spawn,
            sources,
            controller,
            centerPos,
            spawnToCenter,
            avgSpawnDist,
            minControllerDist,
            maxSourceSpan,
            isSpawnCentral: spawnToCenter < 10 || spawnToCenter < avgSpawnDist * 0.5, // Spawn 位于中心区域
            isControllerIsolated: minControllerDist > 15, // 控制器比较偏远
        };
    },
    /**
     * 2. 建造决策与执行
     */
    execute: function (room, analysis) {
        if (!analysis)
            return;
        // 异常处理：资源不足暂停建造
        // 只有当有工地时才检查这个，或者在 createConstructionSite 前检查
        // 这里我们设定一个软阈值，如果房间能量极低 (<300)，暂缓规划新工地
        if (room.energyAvailable < 300 &&
            room.find(FIND_MY_CONSTRUCTION_SITES).length > 0) {
            return;
        }
        const rcl = room.controller.level;
        // === 阶段 1: 基础资源点容器 (RCL >= 2) ===
        if (rcl >= 2) {
            analysis.sources.forEach((source) => {
                this.planContainer(room, source.pos, 1, "SourceMining");
            });
            // 规划 Extension (RCL >= 2)
            this.planExtensions(room, analysis);
            // 规划道路 (低频)
            if (Game.time % 100 === 0) {
                this.planRoads(room, analysis);
            }
        }
        // === 阶段 2: 中转仓网络 & 塔 (RCL >= 3) ===
        if (rcl >= 3) {
            // 决策 1: Spawn 中转仓
            if (analysis.isSpawnCentral) {
                this.planContainer(room, analysis.spawn.pos, 2, "SpawnTransfer", analysis.centerPos);
            }
            // 决策 2: Controller 接收仓
            if (analysis.isControllerIsolated) {
                this.planContainer(room, analysis.controller.pos, 3, "ControllerReceiver", analysis.spawn.pos);
            }
            // 决策 3: 防御塔
            this.planTowers(room, analysis);
        }
        // === 阶段 3: 存储系统 (RCL >= 4) ===
        if (rcl >= 4) {
            this.planStorage(room, analysis);
        }
        // === 阶段 4: 链路系统 (RCL >= 5) ===
        if (rcl >= 5) {
            this.planLinks(room, analysis);
        }
        // === 阶段 5: 矿产采集 (RCL >= 6) ===
        if (rcl >= 6) {
            this.planExtractor(room);
        }
    },
    /**
     * 规划 Extension (棋盘格布局)
     * 根据 RCL 和 能量百分比 逐步建造
     */
    planExtensions: function (room, analysis) {
        const rcl = room.controller.level;
        const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] || 0;
        if (maxExtensions === 0)
            return;
        // 1. 统计现状
        const existing = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_EXTENSION,
        });
        const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType === STRUCTURE_EXTENSION,
        });
        const total = existing.length + sites.length;
        if (total >= maxExtensions)
            return; // 已达上限
        // 2. 逐步建造逻辑 (Gradual Build)
        // 只有当当前工地很少，且能量充足时，才规划新的
        // 防止一次性铺设太多工地导致能量被掏空
        if (sites.length > 0)
            return; // 每次只规划一个，建完再规划下一个
        // 能量阈值检查
        // 用户要求：根据能量百分比逐渐新建
        // 设定：能量 > 80% 容量时才允许扩建
        // (在低等级时 80% 可能太难，设个保底值)
        const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
        if (energyRatio < 0.8 && room.energyAvailable < 1000)
            return;
        // 3. 寻找位置 (围绕 Spawn 的棋盘格)
        // 棋盘格：(x + y) % 2 === 0 放 Extension，=== 1 放路/空地
        const center = analysis.spawn.pos;
        let bestPos = null;
        // 从内圈向外圈扫描
        // Range 2 (避开 Spawn 贴身) 到 10 (通常够了)
        for (let r = 2; r <= 15; r++) {
            for (let x = center.x - r; x <= center.x + r; x++) {
                for (let y = center.y - r; y <= center.y + r; y++) {
                    // 只检查边缘的一圈 (Ring)
                    if (Math.abs(x - center.x) !== r && Math.abs(y - center.y) !== r)
                        continue;
                    // 边界检查
                    if (x < 2 || x > 47 || y < 2 || y > 47)
                        continue;
                    // 棋盘格检查
                    if ((x + y) % 2 !== 0)
                        continue;
                    // 地形检查
                    const terrain = room.getTerrain().get(x, y);
                    if (terrain === TERRAIN_MASK_WALL)
                        continue;
                    const pos = new RoomPosition(x, y, room.name);
                    // 冲突检查 (建筑、工地、Source、Controller)
                    // 避开 Source 及其周围 1 格 (保留开采位)
                    if (pos.findInRange(FIND_SOURCES, 1).length > 0)
                        continue;
                    // 避开 Controller 及其周围 2 格 (保留升级位)
                    if (pos.inRangeTo(room.controller, 2))
                        continue;
                    // 避开已有建筑/工地
                    const structures = pos.lookFor(LOOK_STRUCTURES);
                    if (structures.length > 0)
                        continue; // 任何建筑都避开 (包括路，因为我们要造在空地上)
                    const existingSites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
                    if (existingSites.length > 0)
                        continue;
                    // 找到一个可用位置
                    bestPos = pos;
                    break;
                }
                if (bestPos)
                    break;
            }
            if (bestPos)
                break;
        }
        // 4. 执行
        if (bestPos) {
            console.log(`[Planner] 规划 Extension (${total + 1}/${maxExtensions}) @ ${bestPos.x},${bestPos.y} (Energy: ${(energyRatio * 100).toFixed(1)}%)`);
            room.createConstructionSite(bestPos, STRUCTURE_EXTENSION);
        }
    },
    /**
     * 规划防御塔
     */
    planTowers: function (room, analysis) {
        const rcl = room.controller.level;
        const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] || 0;
        if (maxTowers === 0)
            return;
        const existing = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER,
        });
        const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER,
        });
        if (existing.length + sites.length >= maxTowers)
            return;
        if (sites.length > 0)
            return; // 每次规划一个
        // 选址：Spawn 周围 3-5 格
        // 塔应该分散一点，覆盖全图，但主要保护 Spawn
        const center = analysis.spawn.pos;
        let bestPos = null;
        for (let r = 3; r <= 5; r++) {
            for (let x = center.x - r; x <= center.x + r; x++) {
                for (let y = center.y - r; y <= center.y + r; y++) {
                    if (Math.abs(x - center.x) !== r && Math.abs(y - center.y) !== r)
                        continue;
                    if (x < 2 || x > 47 || y < 2 || y > 47)
                        continue;
                    const pos = new RoomPosition(x, y, room.name);
                    if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL)
                        continue;
                    // 避开建筑和路
                    if (pos.lookFor(LOOK_STRUCTURES).length > 0)
                        continue;
                    if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0)
                        continue;
                    bestPos = pos;
                    break;
                }
                if (bestPos)
                    break;
            }
            if (bestPos)
                break;
        }
        if (bestPos) {
            console.log(`[Planner] 规划 Tower @ ${bestPos.x},${bestPos.y}`);
            room.createConstructionSite(bestPos, STRUCTURE_TOWER);
        }
    },
    /**
     * 规划 Storage (中央仓库)
     */
    planStorage: function (room, analysis) {
        if (room.storage ||
            room.find(FIND_MY_CONSTRUCTION_SITES, {
                filter: (s) => s.structureType === STRUCTURE_STORAGE,
            }).length > 0)
            return;
        // 选址：优先选几何中心 (centerPos) 附近的空地
        // 且最好靠近 Spawn (如果几何中心太远)
        let targetPos = analysis.centerPos;
        if (analysis.spawn.pos.getRangeTo(targetPos) > 15) {
            // 如果中心太远，折中一下，取 Spawn 和 Source 中心的中点
            const midX = Math.floor((analysis.spawn.pos.x + targetPos.x) / 2);
            const midY = Math.floor((analysis.spawn.pos.y + targetPos.y) / 2);
            targetPos = new RoomPosition(midX, midY, room.name);
        }
        const bestPos = this.findSpotNear(room, targetPos, 2);
        if (bestPos) {
            console.log(`[Planner] 规划 Storage @ ${bestPos.x},${bestPos.y}`);
            room.createConstructionSite(bestPos, STRUCTURE_STORAGE);
        }
    },
    /**
     * 规划 Links (传送链路)
     */
    planLinks: function (room, analysis) {
        const rcl = room.controller.level;
        const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][rcl] || 0;
        if (maxLinks === 0)
            return;
        const existing = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_LINK,
        });
        const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType === STRUCTURE_LINK,
        });
        if (existing.length + sites.length >= maxLinks)
            return;
        if (sites.length > 0)
            return;
        // 优先级 1: Storage Link (中央枢纽)
        if (room.storage) {
            const storageLink = room.storage.pos.findInRange(FIND_STRUCTURES, 2, {
                filter: (s) => s.structureType === STRUCTURE_LINK,
            })[0];
            const storageSite = room.storage.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, { filter: (s) => s.structureType === STRUCTURE_LINK })[0];
            if (!storageLink && !storageSite) {
                const pos = this.findSpotNear(room, room.storage.pos, 2);
                if (pos) {
                    room.createConstructionSite(pos, STRUCTURE_LINK);
                    return;
                }
            }
        }
        // 优先级 2: Controller Link (远程升级)
        if (analysis.isControllerIsolated) {
            const controllerLink = room.controller.pos.findInRange(FIND_STRUCTURES, 3, { filter: (s) => s.structureType === STRUCTURE_LINK })[0];
            const controllerSite = room.controller.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, { filter: (s) => s.structureType === STRUCTURE_LINK })[0];
            if (!controllerLink && !controllerSite) {
                const pos = this.findSpotNear(room, room.controller.pos, 3);
                if (pos) {
                    room.createConstructionSite(pos, STRUCTURE_LINK);
                    return;
                }
            }
        }
        // 优先级 3: Source Links (远程采集)
        for (const source of analysis.sources) {
            // 只有当 Source 离 Storage 较远 (>10) 时才配 Link
            if (room.storage && source.pos.getRangeTo(room.storage) < 10)
                continue;
            const sourceLink = source.pos.findInRange(FIND_STRUCTURES, 2, {
                filter: (s) => s.structureType === STRUCTURE_LINK,
            })[0];
            const sourceSite = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, {
                filter: (s) => s.structureType === STRUCTURE_LINK,
            })[0];
            if (!sourceLink && !sourceSite) {
                const pos = this.findSpotNear(room, source.pos, 2);
                if (pos) {
                    room.createConstructionSite(pos, STRUCTURE_LINK);
                    return;
                }
            }
        }
    },
    /**
     * 规划 Extractor (矿物采集)
     */
    planExtractor: function (room) {
        const minerals = room.find(FIND_MINERALS);
        if (minerals.length === 0)
            return;
        const mineral = minerals[0];
        const existing = mineral.pos
            .lookFor(LOOK_STRUCTURES)
            .find((s) => s.structureType === STRUCTURE_EXTRACTOR);
        const site = mineral.pos
            .lookFor(LOOK_CONSTRUCTION_SITES)
            .find((s) => s.structureType === STRUCTURE_EXTRACTOR);
        if (!existing && !site) {
            room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);
        }
    },
    /**
     * 规划道路 (Highways)
     */
    planRoads: function (room, analysis) {
        // 1. Spawn -> Sources
        analysis.sources.forEach((source) => {
            const path = analysis.spawn.pos.findPathTo(source, {
                ignoreCreeps: true,
                swampCost: 2,
            });
            this.buildHighway(room, path);
        });
        // 2. Spawn -> Controller
        const pathCtrl = analysis.spawn.pos.findPathTo(room.controller, {
            ignoreCreeps: true,
            swampCost: 2,
        });
        this.buildHighway(room, pathCtrl);
        // 3. Spawn -> Storage (如果存在)
        if (room.storage) {
            const pathToStorage = analysis.spawn.pos.findPathTo(room.storage, {
                ignoreCreeps: true,
                swampCost: 2,
            });
            this.buildHighway(room, pathToStorage);
        }
    },
    /**
     * 辅助：构建道路 (支持简易双车道)
     */
    buildHighway: function (room, path) {
        path.forEach((step, index) => {
            const pos = new RoomPosition(step.x, step.y, room.name);
            // 1. 主车道
            if (room.getTerrain().get(step.x, step.y) !== TERRAIN_MASK_WALL) {
                room.createConstructionSite(pos, STRUCTURE_ROAD);
            }
            // 2. 副车道 (可选：如果需要双车道)
            // 简单逻辑：计算法线方向偏移
            let nextStep = path[index + 1];
            let dx = 0, dy = 0;
            if (nextStep) {
                dx = nextStep.x - step.x;
                dy = nextStep.y - step.y;
            }
            else if (index > 0) {
                let prevStep = path[index - 1];
                dx = step.x - prevStep.x;
                dy = step.y - prevStep.y;
            }
            if (dx !== 0 || dy !== 0) {
                const sideX = step.x - dy;
                const sideY = step.y + dx;
                if (sideX > 1 && sideX < 48 && sideY > 1 && sideY < 48) {
                    if (room.getTerrain().get(sideX, sideY) !== TERRAIN_MASK_WALL) {
                        room.createConstructionSite(sideX, sideY, STRUCTURE_ROAD);
                    }
                }
            }
        });
    },
    /**
     * 辅助：在某位置附近找空位
     */
    findSpotNear: function (room, centerPos, range) {
        for (let x = centerPos.x - range; x <= centerPos.x + range; x++) {
            for (let y = centerPos.y - range; y <= centerPos.y + range; y++) {
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                const pos = new RoomPosition(x, y, room.name);
                if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL)
                    continue;
                if (pos.lookFor(LOOK_STRUCTURES).length > 0)
                    continue;
                if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0)
                    continue;
                if (pos.lookFor(LOOK_SOURCES).length > 0)
                    continue;
                if (pos.lookFor(LOOK_MINERALS).length > 0)
                    continue;
                return pos;
            }
        }
        return null;
    },
    /**
     * 通用容器规划器
     * @param {Room} room
     * @param {RoomPosition} centerPos 搜索中心
     * @param {number} range 搜索半径
     * @param {string} type 类型标识 (用于日志)
     * @param {RoomPosition} biasPos (可选) 偏向目标，选择靠近该目标的位置
     */
    planContainer: function (room, centerPos, range, type, biasPos) {
        // 1. 检查已有设施
        const existing = centerPos.findInRange(FIND_STRUCTURES, range, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        const sites = centerPos.findInRange(FIND_MY_CONSTRUCTION_SITES, range, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        if (existing.length > 0 || sites.length > 0)
            return; // 已存在
        // 2. 寻找最佳建造位
        // 扫描 range 范围内的所有非墙空地
        let bestPos = null;
        let minBiasDist = 999;
        for (let x = centerPos.x - range; x <= centerPos.x + range; x++) {
            for (let y = centerPos.y - range; y <= centerPos.y + range; y++) {
                // 排除中心点本身 (Source/Spawn/Controller 都是实体，不可重叠建造)
                if (x === centerPos.x && y === centerPos.y)
                    continue;
                const pos = new RoomPosition(x, y, room.name);
                const terrain = room.getTerrain().get(x, y);
                if (terrain === TERRAIN_MASK_WALL)
                    continue;
                // === 严格冲突检测 ===
                // 1. 检查资源点 (Source) - 绝对不可覆盖
                const sources = pos.lookFor(LOOK_SOURCES);
                if (sources.length > 0)
                    continue;
                // 2. 检查建筑占用 (除了路和 Rampart)
                const structures = pos.lookFor(LOOK_STRUCTURES);
                const isBlockedByStructure = structures.some((s) => s.structureType !== STRUCTURE_ROAD &&
                    s.structureType !== STRUCTURE_RAMPART);
                if (isBlockedByStructure)
                    continue;
                // 3. 检查工地占用 (除了路和 Rampart)
                const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
                const isBlockedBySite = sites.some((s) => s.structureType !== STRUCTURE_ROAD &&
                    s.structureType !== STRUCTURE_RAMPART);
                if (isBlockedBySite)
                    continue;
                // 评分逻辑
                // 如果有偏向目标 (biasPos)，选离它最近的
                // let score = 0;
                if (biasPos) {
                    const dist = pos.getRangeTo(biasPos);
                    if (dist < minBiasDist) {
                        minBiasDist = dist;
                        bestPos = pos;
                    }
                }
                else {
                    // 默认选开阔地 (周围空地多)
                    // 简化：直接选第一个能造的，或者距离中心 range 的位置
                    // 对于 Mining Container，通常选距离 1
                    if (type === "SourceMining" && pos.getRangeTo(centerPos) === 1) {
                        bestPos = pos; // 只要是 Range 1 就行
                        break;
                    }
                    if (!bestPos)
                        bestPos = pos;
                }
            }
            if (bestPos && type === "SourceMining")
                break;
        }
        // 3. 执行建造
        if (bestPos) {
            console.log(`[Planner] 规划建造 ${type} @ ${bestPos.x},${bestPos.y}`);
            room.createConstructionSite(bestPos.x, bestPos.y, STRUCTURE_CONTAINER);
        }
    },
    /**
     * 4. 报告与可视化
     */
    visualize: function (room, analysis) {
        if (!analysis)
            return;
        const visual = new RoomVisual(room.name);
        // 绘制几何中心
        visual.circle(analysis.centerPos, {
            fill: "transparent",
            radius: 0.5,
            stroke: "#00ffff",
        });
        visual.text("Target Center", analysis.centerPos.x, analysis.centerPos.y + 0.2, { color: "#00ffff", font: 0.3 });
        // 绘制连线
        analysis.sources.forEach((s) => {
            visual.line(analysis.spawn.pos, s.pos, {
                color: "#555555",
                lineStyle: "dashed",
            });
        });
        visual.line(analysis.spawn.pos, analysis.controller.pos, {
            color: "#555555",
            lineStyle: "dashed",
        });
        // 输出分析报告
        const x = 35;
        const y = 1;
        visual.text(`🏗️ Structure Planner Report`, x, y, {
            align: "left",
            color: "#ffffff",
        });
        visual.text(`Spawn Centrality: ${analysis.isSpawnCentral ? "YES" : "NO"} (Dist: ${analysis.spawnToCenter.toFixed(1)})`, x, y + 1, { align: "left", color: "#aaaaaa", font: 0.5 });
        visual.text(`Controller Isolated: ${analysis.isControllerIsolated ? "YES" : "NO"} (Dist: ${analysis.minControllerDist})`, x, y + 2, { align: "left", color: "#aaaaaa", font: 0.5 });
        visual.text(`Source Span: ${analysis.maxSourceSpan}`, x, y + 3, {
            align: "left",
            color: "#aaaaaa",
            font: 0.5,
        });
        // 预计效率提升 (模拟数据)
        const efficiency = analysis.isSpawnCentral ? "High (>50%)" : "Normal";
        visual.text(`Est. Efficiency Gain: ${efficiency}`, x, y + 4, {
            align: "left",
            color: "#00ff00",
            font: 0.5,
        });
    },
};

const towerModule = {
    run: function (room) {
        // 查找房间内的所有塔
        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER,
        });
        towers.forEach((tower) => {
            // 1. 攻击敌人 (最高优先级)
            const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            if (closestHostile) {
                tower.attack(closestHostile);
                return; // 攻击时不做其他事
            }
            // 2. 维修 (只有能量充足时才修，保留 50% 能量防守)
            // 在危机模式下，彻底禁止维修，节省每一滴能量用于孵化和防御
            const isCrisis = room.memory.energyState === "CRISIS";
            if (!isCrisis &&
                tower.store.getUsedCapacity(RESOURCE_ENERGY) >
                    tower.store.getCapacity(RESOURCE_ENERGY) * 0.5) {
                // 优先修路和容器 (损耗 > 20% 才修，避免频繁切换)
                const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return ((structure.structureType === STRUCTURE_ROAD ||
                            structure.structureType === STRUCTURE_CONTAINER) &&
                            structure.hits < structure.hitsMax * 0.8);
                    },
                });
                if (closestDamagedStructure) {
                    tower.repair(closestDamagedStructure);
                    return;
                }
                // 其次修墙 (Rampart/Wall) - 只修到 10k 血，避免耗光能量
                // const closestDamagedWall = ...
            }
            // 3. 治疗受伤的己方 Creep
            const closestDamagedCreep = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
                filter: (creep) => creep.hits < creep.hitsMax,
            });
            if (closestDamagedCreep) {
                tower.heal(closestDamagedCreep);
            }
        });
    },
};

class StatsManager {
    static run(room) {
        this.analyzeCreepEfficiency(room);
        if (Game.time % 10 === 0) {
            this.recordRoomStats(room);
            this.cleanupHistory();
        }
    }
    static recordRoomStats(room) {
        if (!Memory.stats)
            Memory.stats = { rooms: {} };
        if (!Memory.stats.rooms[room.name])
            Memory.stats.rooms[room.name] = { history: [] };
        const stats = {
            energy: room.energyAvailable,
            energyCapacity: room.energyCapacityAvailable,
            creepCounts: this.getCreepCounts(room),
            cpu: Game.cpu.getUsed(),
            rcl: room.controller ? room.controller.level : 0,
            rclProgress: room.controller
                ? (room.controller.progress / room.controller.progressTotal) * 100
                : 0,
            storage: room.storage
                ? room.storage.store.getUsedCapacity(RESOURCE_ENERGY)
                : 0,
            enemyCount: room.find(FIND_HOSTILE_CREEPS).length,
        };
        // Store history (keep last 100 entries = 1000 ticks)
        const history = Memory.stats.rooms[room.name].history;
        history.push(Object.assign({ time: Game.time }, stats));
        if (history.length > 100)
            history.shift();
    }
    static getCreepCounts(room) {
        const counts = {};
        const creeps = room.find(FIND_MY_CREEPS);
        creeps.forEach((c) => {
            const role = c.memory.role || "unknown";
            counts[role] = (counts[role] || 0) + 1;
        });
        return counts;
    }
    static analyzeCreepEfficiency(room) {
        const creeps = room.find(FIND_MY_CREEPS);
        creeps.forEach((creep) => {
            if (!creep.memory.efficiency) {
                creep.memory.efficiency = {
                    workingTicks: 0,
                    idleTicks: 0,
                    totalTicks: 0,
                };
            }
            const eff = creep.memory.efficiency;
            eff.totalTicks++;
            // Heuristic for "working": not idle, not waiting
            // Better heuristic: if moving or fatigue or store not empty and not full...
            // Simplest: if store is changing or moving?
            // Let's stick to the simple one:
            // Working = (Has Energy) OR (Harvesting/Working)
            // Idle = (Empty & Not Moving)
            // If full or partially full, we assume it's doing something useful (carrying/working)
            // If empty, it should be moving to source.
            if (creep.store.getUsedCapacity() > 0) {
                eff.workingTicks++;
            }
            else {
                // Empty
                if (creep.fatigue > 0 || creep.memory._move) {
                    eff.workingTicks++; // Moving to source
                }
                else {
                    // Empty and not moving? Idle.
                    // Except Harvester sitting on source?
                    if (creep.memory.role === "harvester") {
                        // Harvester is working if it's near source?
                        // Simplified: Harvester is always working unless container full?
                        eff.workingTicks++;
                    }
                    else {
                        eff.idleTicks++;
                    }
                }
            }
        });
    }
    static cleanupHistory() {
        // Global cleanup if needed
    }
    static getTrend(roomName, key, window = 10) {
        var _a, _b;
        const history = ((_b = (_a = Memory.stats) === null || _a === void 0 ? void 0 : _a.rooms[roomName]) === null || _b === void 0 ? void 0 : _b.history) || [];
        if (history.length < 2)
            return 0;
        const end = history[history.length - 1][key];
        const start = history[Math.max(0, history.length - window)][key];
        return end - start;
    }
}

const monitorModule = {
    run: function (room) {
        if (!room)
            return;
        // Run stats collection
        StatsManager.run(room);
        // 1. 统计各角色数量和状态
        const creeps = room.find(FIND_MY_CREEPS);
        const stats = {
            harvester: { count: 0, idle: 0, total: 0 },
            upgrader: { count: 0, idle: 0, total: 0 },
            builder: { count: 0, idle: 0, total: 0 },
            hauler: { count: 0, idle: 0, total: 0 },
        };
        // 统计总能量
        // const totalEnergy = room.energyAvailable;
        // const capacity = room.energyCapacityAvailable;
        creeps.forEach((creep) => {
            const role = creep.memory.role;
            if (stats[role]) {
                stats[role].count++;
                stats[role].total++;
                if (creep.store.getUsedCapacity() === 0 && !creep.fatigue) ;
            }
        });
        // 2. 绘制可视化面板
        const visual = new RoomVisual(room.name);
        const x = 1;
        const y = 1;
        // 标题
        visual.text(`📊 殖民地监控 [${room.name}]`, x, y, {
            align: "left",
            font: 0.8,
            color: "#ffffff",
        });
        // 能量趋势 & 等级
        const energyTrend = StatsManager.getTrend(room.name, "energy");
        const energyLevel = populationModule.getEnergyLevel(room);
        // CPU 趋势
        const cpuTrend = StatsManager.getTrend(room.name, "cpu");
        visual.text(`CPU: ${Game.cpu.getUsed().toFixed(2)} (${cpuTrend > 0 ? "+" : ""}${cpuTrend.toFixed(2)})`, x, y + 1, {
            align: "left",
            font: 0.6,
            color: "#aaaaaa",
        });
        // 能量详情
        const energyColor = energyLevel === "CRITICAL"
            ? "#ff0000"
            : energyLevel === "LOW"
                ? "#ffff00"
                : "#00ff00";
        visual.text(`Energy: ${room.energyAvailable}/${room.energyCapacityAvailable} (${energyLevel}) ${energyTrend > 0 ? "↗" : "↘"}`, x, y + 1.8, {
            align: "left",
            font: 0.6,
            color: energyColor,
        });
        // Storage 详情 (如果存在)
        if (room.storage) {
            const store = room.storage.store[RESOURCE_ENERGY];
            const capacity = room.storage.store.getCapacity();
            visual.text(`Storage: ${(store / 1000).toFixed(1)}k / ${(capacity / 1000).toFixed(0)}k`, x, y + 2.6, {
                align: "left",
                font: 0.6,
                color: "#ffffff",
            });
        }
        // 控制器等级
        if (room.controller) {
            const progress = Math.floor((room.controller.progress / room.controller.progressTotal) * 100);
            const rowY = room.storage ? y + 3.4 : y + 2.6; // 动态调整行号
            visual.text(`等级: ${room.controller.level} (${progress}%)`, x, rowY, {
                align: "left",
                font: 0.6,
                color: "#aaaaaa",
            });
            visual.text(`降级倒计时: ${room.controller.ticksToDowngrade}`, x, rowY + 0.8, {
                align: "left",
                font: 0.5,
                color: room.controller.ticksToDowngrade < 4000 ? "#ff0000" : "#aaaaaa",
            });
        }
        // 角色列表
        let row = room.storage ? y + 5.0 : y + 4.2;
        const roles = ["harvester", "hauler", "upgrader", "builder"];
        roles.forEach((role) => {
            const info = stats[role];
            let color = "#ffffff";
            if (role === "harvester")
                color = "#ffaa00";
            if (role === "hauler")
                color = "#00ffff";
            if (role === "upgrader")
                color = "#ff00ff";
            if (role === "builder")
                color = "#ffff00";
            visual.text(`${role.toUpperCase()}:`, x, row, {
                align: "left",
                font: 0.6,
                color: color,
            });
            visual.text(`${info.count}`, x + 4, row, {
                align: "left",
                font: 0.6,
                color: "#ffffff",
            });
            row += 0.8;
        });
        // 效率监控 (Efficiency)
        row += 0.5;
        visual.text(`📈 效率监控:`, x, row, {
            align: "left",
            font: 0.7,
            color: "#ffffff",
        });
        row += 0.8;
        // Calculate average efficiency per role
        const roleEff = {};
        creeps.forEach((c) => {
            if (!c.memory.efficiency)
                return;
            const role = c.memory.role;
            if (!roleEff[role])
                roleEff[role] = { work: 0, total: 0 };
            roleEff[role].work += c.memory.efficiency.workingTicks;
            roleEff[role].total += c.memory.efficiency.totalTicks;
        });
        for (const r in roleEff) {
            const eff = roleEff[r];
            const percent = Math.floor((eff.work / eff.total) * 100);
            let color = "#00ff00";
            if (percent < 50)
                color = "#ffff00";
            if (percent < 20)
                color = "#ff0000";
            visual.text(`${r}: ${percent}%`, x, row, {
                align: "left",
                font: 0.5,
                color: color,
            });
            row += 0.6;
        }
        // 3. 矿源运输状态 (Transport Status)
        row += 1.0;
        visual.text(`🚚 运输线状态:`, x, row, {
            align: "left",
            font: 0.7,
            color: "#00ffff",
        });
        row += 0.8;
        const sources = room.find(FIND_SOURCES);
        const haulerNeeds = populationModule.getHaulerNeeds(room);
        const haulers = room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === "hauler",
        });
        // 统计当前每个 Source 的 Hauler 数量
        const currentCounts = {};
        haulers.forEach((c) => {
            if (c.memory.sourceId) {
                currentCounts[c.memory.sourceId] =
                    (currentCounts[c.memory.sourceId] || 0) + 1;
            }
        });
        sources.forEach((source) => {
            const container = source.pos.findInRange(FIND_STRUCTURES, 2, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER,
            })[0];
            const energy = container ? container.store[RESOURCE_ENERGY] : 0;
            const capacity = container ? container.store.getCapacity() : 0;
            const needed = haulerNeeds[source.id] || 0;
            const current = currentCounts[source.id] || 0;
            // 颜色逻辑：积压红，正常绿，无容器灰
            let color = "#00ff00";
            if (energy > 1800)
                color = "#ff0000";
            else if (energy > 1000)
                color = "#ffff00";
            if (!container)
                color = "#555555";
            visual.text(`源 ${source.id.substr(-4)}:`, x, row, {
                align: "left",
                font: 0.5,
                color: "#ffffff",
            });
            visual.text(`🔋 ${energy}/${capacity}`, x + 2.5, row, {
                align: "left",
                font: 0.5,
                color: color,
            });
            // 搬运工状态：当前/目标
            let haulerColor = "#ffffff";
            if (current < needed)
                haulerColor = "#ff0000"; // 缺人
            if (current > needed)
                haulerColor = "#00ffff"; // 富余
            visual.text(`🚚 ${current}/${needed}`, x + 6, row, {
                align: "left",
                font: 0.5,
                color: haulerColor,
            });
            row += 0.6;
        });
        // 4. 异常警告
        row += 0.5;
        if (stats.harvester.count === 0) {
            visual.text(`⚠️ 警告: 无采集者!`, x, row + 1, {
                align: "left",
                color: "#ff0000",
                font: 0.7,
            });
        }
        if (stats.hauler.count === 0 && stats.harvester.count > 0) {
            visual.text(`⚠️ 警告: 无搬运工!`, x, row + 2, {
                align: "left",
                color: "#ff0000",
                font: 0.7,
            });
        }
        // Enemy Warning
        const enemies = room.find(FIND_HOSTILE_CREEPS);
        if (enemies.length > 0) {
            visual.text(`⚔️ 入侵警告: ${enemies.length} 敌军!`, x, row + 3, {
                align: "left",
                color: "#ff0000",
                font: 0.8,
                backgroundColor: "#000000",
            });
        }
        // 检查长时间等待的 Creep (需要配合 Memory)
        creeps.forEach((creep) => {
            // 可视化请求状态
            if (creep.memory.requestingEnergy) {
                // 画一个黄色的圈表示正在请求
                visual.circle(creep.pos, {
                    fill: "transparent",
                    radius: 0.5,
                    stroke: "#ffff00",
                    strokeWidth: 0.15,
                    opacity: 0.5,
                });
                // 如果等待时间过长 (>5 ticks)，画红圈并显示感叹号
                if ((creep.memory.waitingTicks || 0) > 5) {
                    visual.circle(creep.pos, {
                        fill: "transparent",
                        radius: 0.7,
                        stroke: "#ff0000",
                        strokeWidth: 0.15,
                        opacity: 0.8,
                    });
                    visual.text(`!`, creep.pos.x, creep.pos.y + 0.2, {
                        color: "#ff0000",
                        font: 0.5,
                    });
                }
            }
            // 可视化 Hauler 的目标连线
            if (creep.memory.role === "hauler" &&
                creep.memory.hauling &&
                creep.memory.targetId) {
                const target = Game.getObjectById(creep.memory.targetId);
                if (target) {
                    // 如果目标是 Creep，画绿线
                    if (target instanceof Creep) {
                        visual.line(creep.pos, target.pos, {
                            color: "#00ff00",
                            width: 0.15,
                            lineStyle: "dashed",
                        });
                    }
                    else if (target instanceof Structure ||
                        target instanceof ConstructionSite) {
                        // 建筑画白线
                        visual.line(creep.pos, target.pos, {
                            color: "#ffffff",
                            width: 0.05,
                            opacity: 0.3,
                        });
                    }
                }
            }
            if (creep.store.getUsedCapacity() === 0) {
                // 如果空背包，记录等待时间
                if (!creep.memory.idleTicks)
                    creep.memory.idleTicks = 0;
                creep.memory.idleTicks++;
                // 如果等待超过 50 tick (且不是 harvester，harvester 挖矿也可能空背包如果直接转存)
                if (creep.memory.idleTicks > 50 && creep.memory.role !== "harvester") {
                    visual.text(`⏳`, creep.pos.x, creep.pos.y - 0.5, {
                        color: "#ff0000",
                        font: 0.5,
                    });
                }
            }
            else {
                creep.memory.idleTicks = 0;
            }
        });
    },
};

/**
 * 模块：孵化器 (Spawner)
 * 处理所有 Creep 的孵化逻辑，包括生命周期替换和常规人口补充
 */
const spawnerModule = {
    run: function (room) {
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        if (!spawn || spawn.spawning) {
            // 可视化孵化状态
            if (spawn && spawn.spawning) {
                const spawningCreep = Game.creeps[spawn.spawning.name];
                spawn.room.visual.text("🛠️" + spawningCreep.memory.role, spawn.pos.x + 1, spawn.pos.y, { align: "left", opacity: 0.8 });
            }
            return;
        }
        // 1. 处理生命周期替换请求 (最高优先级)
        const lifecycleRequests = Lifecycle.getRequests();
        let bestRequest = null;
        let requestCreepName = null;
        for (const name in lifecycleRequests) {
            const req = lifecycleRequests[name];
            // 过滤请求：仅处理本房间的
            const dyingCreep = Game.creeps[name];
            if (dyingCreep && dyingCreep.room.name === room.name) {
                if (!bestRequest || req.priority > bestRequest.priority) {
                    bestRequest = req;
                    requestCreepName = name;
                }
            }
        }
        if (bestRequest) {
            // 使用新的动态 Body 生成逻辑
            const body = populationModule.getBody(room, bestRequest.role);
            const newName = bestRequest.role.charAt(0).toUpperCase() +
                bestRequest.role.slice(1) +
                Game.time;
            // 继承 Memory 但重置运作状态
            const newMemory = bestRequest.baseMemory;
            newMemory.predecessorId = requestCreepName; // 链接到旧 Creep
            delete newMemory.hauling; // 重置状态
            delete newMemory.upgrading;
            delete newMemory.building;
            delete newMemory._move; // 重置移动缓存
            const result = spawn.spawnCreep(body, newName, { memory: newMemory });
            if (result === OK) {
                console.log(`[Spawner] ♻️ 执行生命周期替换: ${requestCreepName} -> ${newName}`);
                Lifecycle.notifySpawn(requestCreepName, newName);
                return; // 本 tick 结束
            }
        }
        // 2. 标准人口检查
        const creeps = room.find(FIND_MY_CREEPS);
        const counts = {
            harvester: 0,
            upgrader: 0,
            builder: 0,
            hauler: 0,
        };
        creeps.forEach((c) => {
            // 使用 Lifecycle 判断该 Creep 是否计入"活跃人口"
            if (Lifecycle.isOperational(c)) {
                if (counts[c.memory.role] !== undefined) {
                    counts[c.memory.role]++;
                }
            }
        });
        const targets = populationModule.calculateTargets(room);
        // 紧急检查逻辑
        // 重新实现 main.js 中的“空置 Source”检查
        const sources = room.find(FIND_SOURCES);
        const harvesters = creeps.filter((c) => c.memory.role === "harvester");
        const sourceCounts = {};
        sources.forEach((s) => (sourceCounts[s.id] = 0));
        harvesters.forEach((c) => {
            if (c.memory.sourceId && Lifecycle.isOperational(c)) {
                sourceCounts[c.memory.sourceId]++;
            }
        });
        // 找到一个 Harvester 数量为 0 的 Source (目前目标是 1)
        let targetSource = sources.find((s) => sourceCounts[s.id] < 1);
        // === 孵化逻辑 ===
        // 优先顺序：Harvester -> Hauler -> Upgrader -> Builder
        // 此时不再需要手动计算 energyToUse，因为 getBody 会根据 Room 的 Energy Level 自动处理
        // 1. Harvester
        if (targetSource) {
            const body = populationModule.getBody(room, "harvester");
            const name = "Harvester" + Game.time;
            console.log(`[Spawner] 为 Source ${targetSource.id} 孵化 ${name}`);
            spawn.spawnCreep(body, name, {
                memory: { role: "harvester", sourceId: targetSource.id },
            });
            return;
        }
        // 紧急升级者 (Emergency Upgrader) - 防止降级
        if (counts.upgrader < 1 && room.controller.ticksToDowngrade < 4000) {
            spawn.spawnCreep(populationModule.getBody(room, "upgrader"), "Upgrader" + Game.time, {
                memory: { role: "upgrader" },
            });
            return;
        }
        // 2. Hauler
        if (counts.hauler < targets.hauler && counts.harvester > 0) {
            const needs = populationModule.getHaulerNeeds(room);
            const haulers = creeps.filter((c) => c.memory.role === "hauler");
            const haulerCounts = {};
            haulers.forEach((c) => {
                if (c.memory.sourceId)
                    haulerCounts[c.memory.sourceId] =
                        (haulerCounts[c.memory.sourceId] || 0) + 1;
            });
            let bestSourceId = null;
            let maxDeficit = -999;
            for (const id in needs) {
                const deficit = needs[id] - (haulerCounts[id] || 0);
                if (deficit > maxDeficit) {
                    maxDeficit = deficit;
                    bestSourceId = id;
                }
            }
            if (!bestSourceId)
                bestSourceId = sources[0].id;
            spawn.spawnCreep(populationModule.getBody(room, "hauler"), "Hauler" + Game.time, {
                memory: { role: "hauler", sourceId: bestSourceId },
            });
            return;
        }
        // 3. Upgrader
        if (counts.upgrader < targets.upgrader) {
            spawn.spawnCreep(populationModule.getBody(room, "upgrader"), "Upgrader" + Game.time, {
                memory: { role: "upgrader" },
            });
            return;
        }
        // 4. Builder
        if (counts.builder < targets.builder) {
            spawn.spawnCreep(populationModule.getBody(room, "builder"), "Builder" + Game.time, {
                memory: { role: "builder" },
            });
            return;
        }
    },
};

/**
 * 智能交通控制系统 (Intelligent Traffic Control System)
 *
 * 1. 拥堵监控：追踪 Creep 移动并识别卡住的 Creep。
 * 2. 动态 CostMatrix：增加拥堵地块的通行成本，强制寻路算法重算路径。
 * 3. 可视化：显示交通热力图（绿色=畅通，红色=拥堵）。
 */
const TrafficManager = {
    // 配置
    config: {
        stuckThreshold: 2, // 判定为卡住的等待 tick 数
        congestionCost: 50, // 拥堵地块增加的 Cost
        visualize: true,
    },
    /**
     * 每 tick 运行以更新交通数据
     * @param {Room} room
     */
    run: function (room) {
        if (Game.time % 1 !== 0)
            return; // 实时更新
        // 初始化车道矩阵 (懒加载)
        if (!room._laneMatrices) {
            this.generateLaneMatrices(room);
        }
        // 1. 监控与可视化
        if (this.config.visualize) {
            this.visualizeTraffic(room);
        }
    },
    /**
     * 生成房间的静态车道偏好矩阵
     * "左进右出" (Left-Hand Traffic) 规则:
     * - 垂直道路: 左车道 (x) = 向上/北, 右车道 (x+1) = 向下/南
     * - 水平道路: 上车道 (y) = 向左/西, 下车道 (y+1) = 向右/东
     * @param {Room} room
     */
    generateLaneMatrices: function (room) {
        // 为 4 个方向创建 4 个矩阵
        // 1: Top, 3: Right, 5: Bottom, 7: Left (Screeps 常量)
        const matrices = {
            [TOP]: new PathFinder.CostMatrix(),
            [BOTTOM]: new PathFinder.CostMatrix(),
            [LEFT]: new PathFinder.CostMatrix(),
            [RIGHT]: new PathFinder.CostMatrix(),
        };
        const terrain = room.getTerrain();
        // 扫描所有道路 (建筑)
        // 注意：依赖已建成的道路。对于规划中的道路，可能需要查看工地。
        const roads = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_ROAD,
        });
        roads.forEach((road) => {
            const x = road.pos.x;
            const y = road.pos.y;
            // 1. 检查垂直双车道 (x+1 或 x-1 有路)
            const hasRight = room
                .lookForAt(LOOK_STRUCTURES, x + 1, y)
                .some((s) => s.structureType === STRUCTURE_ROAD) ||
                terrain.get(x + 1, y) === TERRAIN_MASK_WALL; // 墙壁视为"对面"? 不。
            const hasLeft = room
                .lookForAt(LOOK_STRUCTURES, x - 1, y)
                .some((s) => s.structureType === STRUCTURE_ROAD);
            // 规则: 左 (x) = 上, 右 (x+1) = 下
            if (hasRight && !hasLeft) {
                // 这是左车道
                // 偏好: 利于向上 (Top), 不利于向下 (Bottom)
                matrices[TOP].set(x, y, 1); // 优先
                matrices[BOTTOM].set(x, y, 5); // 惩罚
            }
            else if (hasLeft && !hasRight) {
                // 这是右车道
                // 偏好: 利于向下 (Bottom), 不利于向上 (Top)
                matrices[BOTTOM].set(x, y, 1);
                matrices[TOP].set(x, y, 5);
            }
            // 2. 检查水平双车道 (y+1 或 y-1 有路)
            const hasBottom = room
                .lookForAt(LOOK_STRUCTURES, x, y + 1)
                .some((s) => s.structureType === STRUCTURE_ROAD);
            const hasTop = room
                .lookForAt(LOOK_STRUCTURES, x, y - 1)
                .some((s) => s.structureType === STRUCTURE_ROAD);
            // 规则: 上 (y) = 左 (西), 下 (y+1) = 右 (东)
            if (hasBottom && !hasTop) {
                // 这是上车道
                // 偏好: 利于向左 (West), 不利于向右 (East)
                matrices[LEFT].set(x, y, 1);
                matrices[RIGHT].set(x, y, 5);
            }
            else if (hasTop && !hasBottom) {
                // 这是下车道
                // 偏好: 利于向右 (East), 不利于向左 (West)
                matrices[RIGHT].set(x, y, 1);
                matrices[LEFT].set(x, y, 5);
            }
        });
        room._laneMatrices = matrices;
        // 缓存过期：每 1000 ticks 清除或建筑完成后清除？
        // 目前让其在 Heap 中持久化。Global 重置时会清除。
    },
    /**
     * 获取特定避让矩阵（标记特定角色为不可通行）
     * 用于“反拥挤”逻辑（例如 Hauler 绕过 Upgrader）
     * @param {Room} room
     * @param {string[]} rolesToAvoid 要避让的角色名称数组
     * @param {CostMatrix} [existingMatrix]
     */
    getAvoidanceMatrix: function (room, rolesToAvoid, existingMatrix) {
        const costMatrix = existingMatrix || new PathFinder.CostMatrix();
        const creeps = room.find(FIND_CREEPS);
        creeps.forEach((creep) => {
            // 特定角色避让 (硬阻挡)
            if (creep.my &&
                creep.memory.role &&
                rolesToAvoid.includes(creep.memory.role)) {
                costMatrix.set(creep.pos.x, creep.pos.y, 255); // 不可通行
            }
        });
        return costMatrix;
    },
    /**
     * 将车道偏好应用到现有矩阵
     * @param {Room} room
     * @param {number} direction
     * @param {CostMatrix} matrix
     */
    applyLanePreference: function (room, direction, matrix) {
        if (!room._laneMatrices)
            this.generateLaneMatrices(room);
        const laneMatrix = room._laneMatrices[direction];
        if (!laneMatrix)
            return;
        for (let y = 0; y < 50; y++) {
            for (let x = 0; x < 50; x++) {
                const laneCost = laneMatrix.get(x, y);
                if (laneCost > 0) {
                    const currentCost = matrix.get(x, y);
                    // 只有在当前位置没有被设为硬阻挡时才应用偏好
                    if (currentCost < 100) {
                        matrix.set(x, y, Math.max(currentCost, laneCost));
                    }
                }
            }
        }
    },
    /**
     * 更新并返回包含交通状况的 CostMatrix
     * 根据 Creep 的空闲时间 (idleTicks) 动态调整成本
     * @param {Room} room
     * @param {CostMatrix} [existingMatrix] 可选的现有矩阵
     * @returns {CostMatrix}
     */
    getTrafficMatrix: function (room, existingMatrix) {
        const costs = existingMatrix || new PathFinder.CostMatrix();
        const creeps = room.find(FIND_CREEPS);
        const powerCreeps = room.find(FIND_POWER_CREEPS);
        const allCreeps = creeps.concat(powerCreeps);
        allCreeps.forEach((c) => {
            // 正在移动的 Creep 成本较低，静止的成本较高
            let cost = 20; // 默认轻微避让，引导走空地
            const idleTicks = (c.memory && c.memory._move && c.memory._move.stuckCount) ||
                (c.memory && c.memory.idleTicks) ||
                0;
            if (idleTicks > 10) {
                cost = 250; // 严重阻塞：几乎避开
            }
            else if (idleTicks > 5) {
                cost = 150; // 中度阻塞
            }
            else if (idleTicks > 2) {
                cost = 80; // 轻微阻塞
            }
            // 如果是当前 Creep 正在寻路，不要把自己设为障碍 (虽然通常不会在目标位置)
            // 但这里不知道谁是寻路者，所以统一处理
            const current = costs.get(c.pos.x, c.pos.y);
            if (cost > current) {
                costs.set(c.pos.x, c.pos.y, cost);
            }
        });
        return costs;
    },
    /**
     * 可视化交通状态
     * @param {Room} room
     */
    visualizeTraffic: function (room) {
        const visual = new RoomVisual(room.name);
        const creeps = room.find(FIND_MY_CREEPS);
        creeps.forEach((creep) => {
            if (creep.memory.idleTicks > 2) {
                // 卡住/闲置: 红圈
                visual.circle(creep.pos, {
                    fill: "transparent",
                    radius: 0.4,
                    stroke: "#ff0000",
                });
            }
        });
    },
    /**
     * 追踪空闲时间的辅助函数
     */
    trackCreep: function (creep) {
        if (!creep.memory._lastPos) {
            creep.memory._lastPos = { x: creep.pos.x, y: creep.pos.y };
            creep.memory.idleTicks = 0;
        }
        else {
            if (creep.pos.x === creep.memory._lastPos.x &&
                creep.pos.y === creep.memory._lastPos.y) {
                creep.memory.idleTicks = (creep.memory.idleTicks || 0) + 1;
            }
            else {
                creep.memory.idleTicks = 0;
                creep.memory._lastPos = { x: creep.pos.x, y: creep.pos.y };
            }
        }
        // 检查并处理移动请求 (由其他 Creep 发起)
        if (creep.memory._moveRequest &&
            creep.memory._moveRequest.tick === Game.time) ;
    },
    /**
     * 外部请求某个 Creep 让位
     * @param {Creep} targetCreep 被请求的 Creep
     * @param {number} direction 建议移动的方向 (通常是请求者想要进入的方向)
     */
    requestMove: function (targetCreep, direction) {
        if (!targetCreep || !targetCreep.my)
            return;
        targetCreep.memory._moveRequest = {
            tick: Game.time,
            dir: direction,
        };
    },
};

const moveModule = {
    /**
     * 智能移动逻辑
     * 默认忽略 Creep 碰撞（走 Road），卡住时才考虑 Creep（绕路）
     * 集成 TrafficManager 实现动态车道选择
     * @param {Creep} creep
     * @param {RoomPosition|Structure} target
     * @param {object} opts
     */
    smartMove: function (creep, target, opts = {}) {
        // 标记已执行移动逻辑
        creep._moveExecuted = true;
        // 0. 交通流量监测 (汇报位置状态)
        TrafficManager.trackCreep(creep);
        // 初始化记忆
        if (!creep.memory._move)
            creep.memory._move = {};
        // 检查是否卡住
        if (creep.pos.x === creep.memory._move.lastX &&
            creep.pos.y === creep.memory._move.lastY &&
            creep.fatigue === 0) {
            creep.memory._move.stuckCount = (creep.memory._move.stuckCount || 0) + 1;
        }
        else {
            // 优化：不立即清零，而是缓慢减少，防止路径震荡
            if (creep.memory._move.stuckCount > 0) {
                creep.memory._move.stuckCount--;
            }
            creep.memory._move.lastX = creep.pos.x;
            creep.memory._move.lastY = creep.pos.y;
        }
        const stuckCount = creep.memory._move.stuckCount;
        // 默认配置
        let moveOpts = Object.assign({
            visualizePathStyle: { stroke: "#ffffff", lineStyle: "dashed" },
            reusePath: 20, // 增加复用
            ignoreCreeps: true, // 默认忽略
            range: 1,
            // 添加 CostCallback 实现车道偏好
            costCallback: function (roomName, costMatrix) {
                if (roomName !== creep.room.name)
                    return;
                // 1. 基础道路与地形成本 (确保 PathFinder 知道道路的存在)
                // 只有在没有使用 TrafficManager 的静态矩阵时才需要手动设置
                // 这里我们通常直接在 TrafficManager 的方法里叠加
                // 2. 角色避让 (例如避开正在升级的 Upgrader)
                if (opts.avoidRoles && opts.avoidRoles.length > 0) {
                    TrafficManager.getAvoidanceMatrix(creep.room, opts.avoidRoles, costMatrix);
                }
                // 3. 动态拥堵避让 (根据 stuckCount 逐渐增加对 Creep 的感知)
                if (stuckCount >= 5) {
                    TrafficManager.getTrafficMatrix(creep.room, costMatrix);
                }
                // 4. 车道偏好 (仅在未严重卡住时使用)
                if (stuckCount < 8) {
                    let direction = 0;
                    // @ts-ignore
                    const dx = target.pos
                        ? // @ts-ignore
                            target.pos.x - creep.pos.x
                        : // @ts-ignore
                            target.x - creep.pos.x;
                    // @ts-ignore
                    const dy = target.pos
                        ? // @ts-ignore
                            target.pos.y - creep.pos.y
                        : // @ts-ignore
                            target.y - creep.pos.y;
                    if (Math.abs(dy) > Math.abs(dx)) {
                        direction = dy < 0 ? TOP : BOTTOM;
                    }
                    else {
                        direction = dx < 0 ? LEFT : RIGHT;
                    }
                    if (direction) {
                        TrafficManager.applyLanePreference(creep.room, direction, costMatrix);
                    }
                }
                return costMatrix;
            },
        }, opts);
        // === 阶段处理 (State Machine) ===
        // 阶段 1: 等待 (1-2 ticks)
        // 保持 ignoreCreeps: true，给对方一点时间移开
        if (stuckCount > 0 && stuckCount < 3) {
            creep.say("⏳ " + stuckCount);
            // 继续使用 moveTo，依靠 reusePath
        }
        // 阶段 2: 尝试交换/请求让位 (3-5 ticks)
        if (stuckCount >= 3 && stuckCount <= 5) {
            moveOpts.reusePath = 0; // 强制重算
            moveOpts.visualizePathStyle = { stroke: "#ffff00", lineStyle: "dotted" };
            const path = creep.pos.findPathTo(target, {
                ignoreCreeps: true,
                range: moveOpts.range,
                maxRooms: 1,
            });
            if (path.length > 0) {
                const nextStep = path[0];
                const obstacle = creep.room.lookForAt(LOOK_CREEPS, nextStep.x, nextStep.y)[0];
                if (obstacle && obstacle.my) {
                    // 发起交换请求
                    TrafficManager.requestMove(obstacle, creep.pos.getDirectionTo(obstacle));
                    creep.say("🤝 swap?");
                    if (stuckCount === 3)
                        console.log(`[Move] ${creep.name} requesting swap from ${obstacle.name} at ${obstacle.pos}`);
                    // 尝试对穿
                    if (obstacle.fatigue === 0) {
                        creep.move(creep.pos.getDirectionTo(obstacle));
                        // 注意：我们不直接命令对方 move，而是让对方在自己的 smartMove 中响应
                        return;
                    }
                }
            }
        }
        // 阶段 3: 强制绕路 (6-10 ticks)
        if (stuckCount >= 6 && stuckCount <= 10) {
            moveOpts.ignoreCreeps = false; // 寻路时考虑 Creep 碰撞
            moveOpts.reusePath = 0;
            moveOpts.maxOps = 2000; // 增加寻路上限
            moveOpts.visualizePathStyle = { stroke: "#ff8800", lineStyle: "solid" };
            creep.say("🛡️ detour");
        }
        // 阶段 4: 紧急避让/恐慌 (> 10 ticks)
        if (stuckCount > 10) {
            creep.say("😖 panic");
            if (stuckCount === 11)
                console.log(`[Move] ${creep.name} entered PANIC mode at ${creep.pos} (stuck for ${stuckCount} ticks)`);
            // 检查周围是否有非道路的空位可以暂时“停靠”
            const terrain = creep.room.getTerrain();
            const possiblePos = [];
            for (let i = 1; i <= 8; i++) {
                const pos = this.getPositionInDirection(creep.pos, i);
                if (!pos || pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48)
                    continue;
                if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL)
                    continue;
                if (pos.lookFor(LOOK_CREEPS).length > 0)
                    continue;
                if (pos
                    .lookFor(LOOK_STRUCTURES)
                    // @ts-ignore
                    .some((s) => OBSTACLE_OBJECT_TYPES.includes(s.structureType)))
                    continue;
                // 评分逻辑：
                // 1. 离目标不要太远 (权重 10)
                // 2. 必须离开道路 (权重 20)
                // 3. 避免再次进入狭窄通道 (检查周围空位数量)
                // @ts-ignore
                let score = (20 - pos.getRangeTo(target)) * 1;
                const isOnRoad = pos
                    .lookFor(LOOK_STRUCTURES)
                    .some((s) => s.structureType === STRUCTURE_ROAD);
                if (!isOnRoad)
                    score += 50;
                // 检查周围空位
                let freeSpaces = 0;
                for (let j = 1; j <= 8; j++) {
                    const nearPos = this.getPositionInDirection(pos, j);
                    if (nearPos &&
                        terrain.get(nearPos.x, nearPos.y) !== TERRAIN_MASK_WALL)
                        freeSpaces++;
                }
                score += freeSpaces * 5;
                possiblePos.push({ pos, score });
            }
            if (possiblePos.length > 0) {
                // @ts-ignore
                const best = ___namespace.max(possiblePos, (p) => p.score);
                // 如果当前位置分值已经很高（不在路上），则原地等待
                const currentIsOnRoad = this.isOnRoad(creep);
                // @ts-ignore
                if (!currentIsOnRoad && best.score < 60) {
                    creep.say("💤 parking");
                    return;
                }
                // @ts-ignore
                creep.move(creep.pos.getDirectionTo(best.pos));
                return;
            }
        }
        // === 正常移动执行 ===
        const result = creep.moveTo(target, moveOpts);
        // === 响应同伴请求 (后置处理) ===
        // 如果本 tick 移动失败，或者没有移动意图，尝试响应之前的请求
        const moveRequest = creep.memory._moveRequest;
        if (result !== OK &&
            result !== ERR_TIRED &&
            moveRequest &&
            moveRequest.tick === Game.time) {
            const dir = moveRequest.dir;
            // 反向移动实现对穿
            // 注意：这里的 dir 是请求者相对于我的方向，所以我要移向请求者
            // 但其实更简单的做法是直接移向请求者的位置
            const oppositeDir = ((dir + 3) % 8) + 1;
            // @ts-ignore
            creep.move(oppositeDir);
            creep.say("🔄 OK");
            console.log(`[Move] ${creep.name} responding to move request (direction: ${oppositeDir})`);
            return OK; // 标记已处理
        }
        if (result === ERR_NO_PATH) {
            // 如果完全找不到路，且已经卡住
            if (stuckCount > 5) {
                creep.say("🚫 trapped");
                // 尝试向反方向退一步，腾出空间
                // @ts-ignore
                const dirToTarget = creep.pos.getDirectionTo(target);
                const oppositeDir = ((dirToTarget + 3) % 8) + 1;
                // @ts-ignore
                creep.move(oppositeDir);
            }
        }
        return result;
    },
    /**
     * 辅助方法：获取给定方向的新位置
     */
    getPositionInDirection: function (pos, direction) {
        const offsets = {
            [TOP]: [0, -1],
            [TOP_RIGHT]: [1, -1],
            [RIGHT]: [1, 0],
            [BOTTOM_RIGHT]: [1, 1],
            [BOTTOM]: [0, 1],
            [BOTTOM_LEFT]: [-1, 1],
            [LEFT]: [-1, 0],
            [TOP_LEFT]: [-1, -1],
        };
        const offset = offsets[direction];
        if (!offset)
            return null;
        const x = pos.x + offset[0];
        const y = pos.y + offset[1];
        if (x < 0 || x > 49 || y < 0 || y > 49)
            return null;
        return new RoomPosition(x, y, pos.roomName);
    },
    /**
     * 检查 Creep 是否站在道路上
     * @param {Creep} creep
     * @returns {boolean}
     */
    isOnRoad: function (creep) {
        return creep.pos
            .lookFor(LOOK_STRUCTURES)
            .some((s) => s.structureType === STRUCTURE_ROAD);
    },
    /**
     * 移出道路到随机的相邻可行走地块
     * 如果提供锚点，则保持在锚点范围内
     * @param {Creep} creep
     * @param {RoomPosition|Object} anchor (可选) 要保持在其附近的目标
     * @param {number} range (可选) 离锚点的最大范围
     */
    parkOffRoad: function (creep, anchor = null, range = 1) {
        if (creep._moveExecuted)
            return;
        if (!this.isOnRoad(creep))
            return; // 已经在非道路上
        // 寻找有效位置
        const terrain = creep.room.getTerrain();
        const adjacent = [];
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                if (x === 0 && y === 0)
                    continue;
                const targetX = creep.pos.x + x;
                const targetY = creep.pos.y + y;
                // 边界检查
                if (targetX < 1 || targetX > 48 || targetY < 1 || targetY > 48)
                    continue;
                const pos = new RoomPosition(targetX, targetY, creep.room.name);
                // 检查地形 (墙壁)
                if (terrain.get(targetX, targetY) === TERRAIN_MASK_WALL)
                    continue;
                // 检查建筑 (路或障碍物)
                const structures = pos.lookFor(LOOK_STRUCTURES);
                // 避开道路
                if (structures.some((s) => s.structureType === STRUCTURE_ROAD))
                    continue;
                // 避开障碍物
                if (structures.some((s) => s.structureType !== STRUCTURE_CONTAINER &&
                    s.structureType !== STRUCTURE_RAMPART &&
                    // @ts-ignore
                    ((typeof OBSTACLE_OBJECT_TYPES !== "undefined" &&
                        // @ts-ignore
                        OBSTACLE_OBJECT_TYPES.includes(s.structureType)) ||
                        s.structureType === "constructedWall")))
                    continue;
                // 检查 Creeps
                if (pos.lookFor(LOOK_CREEPS).length > 0)
                    continue;
                // 检查锚点范围
                if (anchor && !pos.inRangeTo(anchor, range))
                    continue;
                adjacent.push(pos);
            }
        }
        if (adjacent.length > 0) {
            // 随机选择或选择第一个
            const target = adjacent[Math.floor(Math.random() * adjacent.length)];
            creep.move(creep.pos.getDirectionTo(target));
            creep._moveExecuted = true;
            creep.say("🚷 park");
        }
    },
    /**
     * 处理来自其他 Creep 的移动请求 (对穿/避让)
     * 应在 Role 逻辑结束后调用，确保那些没有调用 smartMove 的 Creep (如正在挖矿/工作的) 也能响应请求
     * @param {Creep} creep
     */
    handleRequests: function (creep) {
        // 如果本 tick 已经执行过移动逻辑 (smartMove)，则跳过 (smartMove 内部会处理)
        if (creep._moveExecuted)
            return;
        const moveRequest = creep.memory._moveRequest;
        if (moveRequest && moveRequest.tick === Game.time) {
            // 检查疲劳值
            if (creep.fatigue > 0)
                return;
            const dir = moveRequest.dir;
            // 反向移动实现对穿
            // dir 是请求者相对于我的方向 (例如请求者在 TOP，dir=1)
            // 我需要移向请求者，即 move(1)
            // 等等，requestMove 的参数 dir 是 requestMove(target, direction)
            // 在 TrafficManager.requestMove 中: target.memory._moveRequest = { dir: direction, tick: Game.time }
            // 这里的 direction 是 "move direction of the requester".
            // 如果 requester 想往 TOP 走，direction 是 TOP (1).
            // requester 在我的 BOTTOM.
            // 我在 requester 的 TOP.
            // requester 想去 TOP (我的位置).
            // 我应该去哪里？
            // 为了对穿，我应该去 requester 的位置 (BOTTOM).
            // 所以我应该去 opposite direction of requester's move direction.
            // 如果 requester move TOP (1), 我应该 move BOTTOM (5).
            // 让我们确认 TrafficManager.requestMove 的调用:
            // smartMove: TrafficManager.requestMove(obstacle, creep.pos.getDirectionTo(obstacle));
            // 这里的第二个参数是 "direction to obstacle".
            // 如果 obstacle 在 TOP. direction 是 TOP.
            // obstacle 收到 { dir: TOP }.
            // obstacle 需要移向我 (BOTTOM).
            // opposite of TOP is BOTTOM.
            // 所以:
            const oppositeDir = ((dir + 3) % 8) + 1;
            // @ts-ignore
            creep.move(oppositeDir);
            creep.say("🔄 yield");
            creep._moveExecuted = true;
        }
    },
};

/**
 * @typedef {Object} Task
 * @property {string} id - Unique task ID
 * @property {string} type - Task type (e.g., 'harvest', 'build')
 * @property {string} targetId - Target game object ID
 * @property {number} priority - Calculated priority score
 * @property {Object} [data] - Additional data
 */
class Role {
    /**
     * @param {Creep} creep
     */
    constructor(creep) {
        this.creep = creep;
        this.memory = creep.memory;
    }
    /**
     * Main execution loop
     */
    run() {
        if (this.creep.spawning)
            return;
        try {
            // 1. Check state transitions
            this.checkState();
            // 2. Execute current state logic
            this.executeState();
        }
        catch (e) {
            console.log(`[Role] Error in ${this.creep.name}: ${e.stack}`);
        }
    }
    /**
     * Check and switch states (to be overridden)
     */
    checkState() {
        // Default implementation: Toggle working state
        // @ts-ignore
        if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
            // @ts-ignore
            this.memory.working = false;
            this.creep.say("🔄 gather");
        }
        // @ts-ignore
        if (!this.memory.working && this.creep.store.getFreeCapacity() === 0) {
            // @ts-ignore
            this.memory.working = true;
            this.creep.say("⚡ work");
        }
    }
    /**
     * Execute logic based on state (to be overridden)
     */
    executeState() {
        // Abstract method
    }
    /**
     * Wrapper for smart move
     * @param {RoomPosition|{pos: RoomPosition}} target
     * @param {Object} opts
     */
    move(target, opts = {}) {
        // @ts-ignore
        return moveModule.smartMove(this.creep, target, opts);
    }
}

class Harvester extends Role {
    constructor(creep) {
        super(creep);
    }
    executeState() {
        // 0. Initialize Source
        // @ts-ignore
        if (!this.memory.sourceId) {
            this.assignSource();
        }
        // @ts-ignore
        const source = Game.getObjectById(this.memory.sourceId);
        if (!source)
            return;
        // 1. Harvest
        if (this.creep.store.getFreeCapacity() > 0) {
            if (this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
                this.move(source, { visualizePathStyle: { stroke: "#ffaa00" } });
            }
        }
        else {
            // 2. Transfer (Full)
            // Check for Link/Container nearby
            const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                    // @ts-ignore
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            })[0];
            if (container) {
                if (this.creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.move(container);
                }
            }
            else {
                // Fallback: Drop mining or wait for Hauler
                // Or if emergency (no haulers), deliver to Spawn
                const haulers = this.creep.room.find(FIND_MY_CREEPS, {
                    // @ts-ignore
                    filter: (c) => c.memory.role === "hauler",
                });
                if (haulers.length === 0) {
                    // Self-deliver logic
                    const spawn = this.creep.pos.findClosestByPath(FIND_MY_SPAWNS);
                    if (spawn &&
                        this.creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.move(spawn);
                    }
                }
                else {
                    // Drop Mining
                    // Just stay there, energy drops automatically when full and harvesting
                    // But explicit drop can help logic clarity
                    this.creep.drop(RESOURCE_ENERGY);
                }
            }
        }
    }
    assignSource() {
        const sources = this.creep.room.find(FIND_SOURCES);
        // Simple random assignment for now, or use population module's logic
        // Ideally this should be passed from Spawner
        // @ts-ignore
        this.memory.sourceId =
            sources[Math.floor(Math.random() * sources.length)].id;
    }
}

/**
 * Game Configuration
 * 集中管理游戏参数
 */
var config = {
    // 角色身体部件配置
    BODY_PARTS: {
        harvester: [WORK, WORK, CARRY, MOVE],
        hauler: [CARRY, CARRY, MOVE, MOVE],
        upgrader: [WORK, CARRY, MOVE],
        builder: [WORK, CARRY, MOVE],
        defender: [ATTACK, ATTACK, MOVE, MOVE],
    },
    // 任务优先级基础分
    PRIORITY: {
        EMERGENCY: 1000,
        HIGH: 100,
        MEDIUM: 50,
        LOW: 10}};

class Task {
    /**
     * @param {string} type
     * @param {string} targetId
     * @param {number} priority
     * @param {Object} [data]
     */
    constructor(type, targetId, priority = config.PRIORITY.LOW, data = {}) {
        this.id = `${type}_${targetId}_${Game.time}`;
        this.type = type;
        this.targetId = targetId;
        this.basePriority = priority;
        this.data = data;
    }
    /**
     * Calculate dynamic score for a specific creep
     * @param {Creep} creep
     * @returns {number}
     */
    getScore(creep) {
        const target = Game.getObjectById(this.targetId);
        if (!target)
            return -1; // Invalid target
        let score = this.basePriority;
        // 1. Distance factor (Closer is better)
        // @ts-ignore
        const distance = creep.pos.getRangeTo(target);
        score -= distance * 2;
        // 2. Room Needs (e.g., Emergency mode)
        if (creep.room.energyAvailable < 300 && this.type === "transfer_spawn") {
            score += 1000; // Emergency boost
        }
        // 3. Creep Capability (Body parts)
        // Example: Prefer creeps with more WORK parts for building
        if (this.type === "build" && creep.getActiveBodyparts(WORK) > 0) {
            score += creep.getActiveBodyparts(WORK) * 5;
        }
        return score;
    }
    /**
     * Check if task is valid
     * @returns {boolean}
     */
    isValid() {
        const target = Game.getObjectById(this.targetId);
        if (!target)
            return false;
        // Example specific checks
        if (this.type === "transfer") {
            const store = target.store;
            if (store && store.getFreeCapacity(RESOURCE_ENERGY) === 0)
                return false;
        }
        // @ts-ignore
        if (this.type === "harvest" && target.energy === 0)
            return false;
        return true;
    }
}

class Brain {
    constructor(room) {
        this.energyState = "NORMAL";
        this.room = room;
        // Task pool (cached per tick via heap or memory)
        this.tasks = [];
    }
    /**
     * Main Brain Loop
     */
    run() {
        // 1. Analyze Room State
        this.analyze();
        // 2. Generate Tasks
        this.generateTasks();
    }
    analyze() {
        this.energyState = this.room.energyAvailable < 300 ? "EMERGENCY" : "NORMAL";
        // More analysis...
    }
    generateTasks() {
        this.tasks = []; // Reset tasks for this tick
        // 1. Spawn/Extension filling (High Priority)
        const energyStructures = this.room.find(FIND_STRUCTURES, {
            filter: (s) => (s.structureType === STRUCTURE_SPAWN ||
                s.structureType === STRUCTURE_EXTENSION) &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        energyStructures.forEach((s) => {
            const priority = this.energyState === "EMERGENCY"
                ? config.PRIORITY.EMERGENCY
                : config.PRIORITY.HIGH;
            this.tasks.push(new Task("transfer_spawn", s.id, priority));
        });
        // 2. Construction Sites
        const sites = this.room.find(FIND_CONSTRUCTION_SITES);
        sites.forEach((s) => {
            this.tasks.push(new Task("build", s.id, config.PRIORITY.MEDIUM));
        });
        // 3. Upgrading
        if (this.room.controller) {
            this.tasks.push(new Task("upgrade", this.room.controller.id, config.PRIORITY.LOW));
        }
        // Add more task generators...
    }
    /**
     * Get the best task for a creep
     * @param {Creep} creep
     * @returns {Task|null}
     */
    getBestTask(creep) {
        let bestTask = null;
        let maxScore = -Infinity;
        this.tasks.forEach((task) => {
            if (!task.isValid())
                return;
            const score = task.getScore(creep);
            if (score > maxScore) {
                maxScore = score;
                bestTask = task;
            }
        });
        return bestTask;
    }
}

class Hauler extends Role {
    constructor(creep) {
        super(creep);
    }
    checkState() {
        // @ts-ignore
        if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
            // @ts-ignore
            this.memory.working = false; // Go to Collect
            this.creep.say("🔄 collect");
        }
        // @ts-ignore
        if (!this.memory.working && this.creep.store.getFreeCapacity() === 0) {
            // @ts-ignore
            this.memory.working = true; // Go to Deliver
            this.creep.say("🚚 deliver");
        }
        // Opportunistic Pickup: If moving to collect/deliver and see dropped energy on/near position
        const dropped = this.creep.pos.lookFor(LOOK_RESOURCES)[0];
        if (dropped && dropped.resourceType === RESOURCE_ENERGY) {
            this.creep.pickup(dropped);
        }
    }
    executeState() {
        // @ts-ignore
        if (this.memory.working) {
            // === DELIVER STATE ===
            // Use Brain to find best delivery target
            // (Assuming Brain is available globally or we instantiate it temporarily)
            // Since Brain is stateful per tick, ideally it should be managed by Main.
            // For now, let's just create a temporary one or fallback to simple find
            // Note: In a real efficient system, Brain should be passed in or singleton.
            // Here we just use the logic directly or instantiate light version.
            const brain = new Brain(this.creep.room);
            brain.analyze();
            brain.generateTasks();
            const task = brain.getBestTask(this.creep);
            // 1. High Priority: Spawn / Extension (From Brain)
            if (task && task.type === "transfer_spawn") {
                const target = Game.getObjectById(task.targetId);
                if (target) {
                    // @ts-ignore
                    const result = this.creep.transfer(target, RESOURCE_ENERGY);
                    if (result === ERR_NOT_IN_RANGE) {
                        // @ts-ignore
                        this.move(target, { visualizePathStyle: { stroke: "#ffffff" } });
                    }
                    return;
                }
            }
            // 2. Medium Priority: Towers (Defense/Repair)
            const towers = this.creep.room.find(FIND_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_TOWER &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 100,
            });
            if (towers.length > 0) {
                const target = this.creep.pos.findClosestByPath(towers);
                if (target) {
                    if (this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.move(target, { visualizePathStyle: { stroke: "#ff0000" } });
                    }
                    return;
                }
            }
            // 2.1 [NEW] Active Delivery to Upgraders (Low Energy)
            // Only deliver if Upgrader is working and running low
            const needyUpgraders = this.creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role === "upgrader" &&
                    c.memory.working &&
                    c.store.getFreeCapacity(RESOURCE_ENERGY) > c.store.getCapacity() * 0.5 &&
                    !c.pos.inRangeTo(this.creep.room.controller, 1) // Don't block controller spot? Actually fine.
            });
            if (needyUpgraders.length > 0) {
                const target = this.creep.pos.findClosestByPath(needyUpgraders);
                if (target) {
                    if (this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.move(target, { visualizePathStyle: { stroke: "#00ff00", opacity: 0.5 } });
                    }
                    return;
                }
            }
            // 2.2 [NEW] Active Delivery to Builders (Critical Projects)
            // Check if any builder is requesting energy or is working on critical site
            const needyBuilders = this.creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role === "builder" &&
                    (c.memory.working || c.memory.requestingEnergy) &&
                    c.store[RESOURCE_ENERGY] < c.store.getCapacity() * 0.3
            });
            if (needyBuilders.length > 0) {
                const target = this.creep.pos.findClosestByPath(needyBuilders);
                if (target) {
                    if (this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.move(target, { visualizePathStyle: { stroke: "#ffff00", opacity: 0.5 } });
                    }
                    return;
                }
            }
            // 3. User Request: Controller Container & Spawn Container
            // Find containers that are NOT near sources (Sink Containers)
            const sources = this.creep.room.find(FIND_SOURCES);
            const sinkContainers = this.creep.room.find(FIND_STRUCTURES, {
                filter: (s) => {
                    if (s.structureType !== STRUCTURE_CONTAINER)
                        return false;
                    if (s.store.getFreeCapacity(RESOURCE_ENERGY) === 0)
                        return false;
                    // Filter out Source Containers (Range <= 2)
                    // Optimization: Cache this check or assume naming convention?
                    // For now, geometry check.
                    for (const source of sources) {
                        if (s.pos.inRangeTo(source, 2))
                            return false;
                    }
                    // Check if near Controller (Range 3) or Spawn (Range 3)
                    const nearController = this.creep.room.controller &&
                        s.pos.inRangeTo(this.creep.room.controller, 3);
                    const nearSpawn = s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0;
                    return nearController || nearSpawn;
                },
            });
            if (sinkContainers.length > 0) {
                const target = this.creep.pos.findClosestByPath(sinkContainers);
                if (target) {
                    if (this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.move(target, { visualizePathStyle: { stroke: "#00ffff" } });
                    }
                    return;
                }
            }
            // 4. Fallback: Storage
            if (this.creep.room.storage) {
                if (this.creep.transfer(this.creep.room.storage, RESOURCE_ENERGY) ===
                    ERR_NOT_IN_RANGE) {
                    this.move(this.creep.room.storage);
                }
            }
        }
        else {
            // === COLLECT STATE ===
            // 1. Dropped Resources
            const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
            });
            if (dropped) {
                if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
                    this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
                }
                return;
            }
            // 2. Containers (Source Containers Only)
            // Prioritize containers with most energy
            const sources = this.creep.room.find(FIND_SOURCES);
            const containers = this.creep.room.find(FIND_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                    s.store[RESOURCE_ENERGY] > 100 &&
                    // Only collect from Source Containers
                    sources.some((source) => s.pos.inRangeTo(source, 3)),
            });
            const container = this.creep.pos.findClosestByPath(containers);
            if (container) {
                if (this.creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.move(container, { visualizePathStyle: { stroke: "#ffaa00" } });
                }
                return;
            }
            // 3. Fallback: Help Harvest if Source has piles (handled by dropped logic)
            // or Wait near Source (parking)
            if (!dropped && !container) {
                // Move to a parking spot near source to avoid blocking spawn
                // Ideally, read sourceId from memory
                // @ts-ignore
                if (this.memory.sourceId) {
                    // @ts-ignore
                    const source = Game.getObjectById(this.memory.sourceId);
                    // @ts-ignore
                    if (source && !this.creep.pos.inRangeTo(source, 3)) {
                        // @ts-ignore
                        this.move(source);
                    }
                }
            }
        }
    }
}

class Upgrader extends Role {
    constructor(creep) {
        super(creep);
    }
    executeState() {
        // @ts-ignore
        if (this.memory.working) {
            // === UPGRADE ===
            if (this.creep.upgradeController(this.creep.room.controller) === ERR_NOT_IN_RANGE) {
                // @ts-ignore
                this.move(this.creep.room.controller, {
                    visualizePathStyle: { stroke: "#ffffff" },
                });
            }
        }
        else {
            // === GATHER ===
            // 0. Dropped Resources (High Priority)
            const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
            });
            if (dropped) {
                if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
                    this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
                }
                return;
            }
            // 1. Link (if available and near controller)
            // 2. Storage
            // 3. Container
            // 4. Source (last resort, usually avoided)
            const target = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (s) => (s.structureType === STRUCTURE_CONTAINER ||
                    s.structureType === STRUCTURE_STORAGE) &&
                    // @ts-ignore
                    s.store[RESOURCE_ENERGY] > 0,
            });
            if (target) {
                // Clear request flag if we found a target
                // @ts-ignore
                if (this.memory.requestingEnergy)
                    delete this.memory.requestingEnergy;
                if (this.creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.move(target, { visualizePathStyle: { stroke: "#ffaa00" } });
                }
            }
            else {
                // === REQUEST DELIVERY ===
                // If no container nearby, signal Haulers
                // @ts-ignore
                this.memory.requestingEnergy = true;
                this.creep.say("📡 help");
                // While waiting, try to harvest if very desperate or early game
                if (this.creep.room.energyAvailable < 300 || !this.creep.room.storage) {
                    const source = this.creep.pos.findClosestByPath(FIND_SOURCES);
                    if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
                        this.move(source);
                    }
                }
            }
        }
    }
}

class Builder extends Role {
    constructor(creep) {
        super(creep);
    }
    executeState() {
        var _a;
        // 0. Energy Crisis Check
        // If energy is extremely low, builders should pause to conserve energy
        // Unless they are building a critical structure (Spawn)
        const room = this.creep.room;
        const isCrisis = room.energyAvailable < 300 && !((_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]);
        // Check if we are building something critical
        let isCriticalTask = false;
        // @ts-ignore
        if (this.memory.working) {
            // Use priority module to find the best target
            const sites = this.creep.room.find(FIND_CONSTRUCTION_SITES);
            const bestSite = priorityModule.getBestTarget(sites, this.creep.pos);
            if (bestSite &&
                (bestSite.structureType === STRUCTURE_SPAWN ||
                    bestSite.structureType === STRUCTURE_EXTENSION ||
                    bestSite.structureType === STRUCTURE_TOWER)) {
                isCriticalTask = true;
            }
        }
        if (isCrisis && !isCriticalTask) {
            // Sleep logic
            this.creep.say("💤 crisis");
            // Park off road to avoid blocking traffic
            // (Assuming moveModule is available via global or import, but Role base class has move wrapper)
            // Here we just use a simple random move if on road, or stay still.
            // Ideally use moveModule.parkOffRoad(this.creep);
            // But for now, just don't do anything consuming.
            return;
        }
        // @ts-ignore
        if (this.memory.working) {
            // === WORK ===
            // 1. Critical Repairs (Hits < 10%)
            const critical = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (s) => s.hits < s.hitsMax * 0.1 && s.structureType !== STRUCTURE_WALL,
            });
            if (critical) {
                if (this.creep.repair(critical) === ERR_NOT_IN_RANGE) {
                    this.move(critical, { visualizePathStyle: { stroke: "#ff0000" } });
                }
                return;
            }
            // 2. Build Construction Sites
            // Use priority logic instead of distance
            const sites = this.creep.room.find(FIND_CONSTRUCTION_SITES);
            const site = priorityModule.getBestTarget(sites, this.creep.pos);
            if (site) {
                if (this.creep.build(site) === ERR_NOT_IN_RANGE) {
                    this.move(site, { visualizePathStyle: { stroke: "#ffffff" } });
                }
                return;
            }
            // 3. Maintenance (Roads/Containers < 80%)
            const maintenance = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (s) => (s.structureType === STRUCTURE_ROAD ||
                    s.structureType === STRUCTURE_CONTAINER) &&
                    s.hits < s.hitsMax * 0.8,
            });
            if (maintenance) {
                if (this.creep.repair(maintenance) === ERR_NOT_IN_RANGE) {
                    this.move(maintenance, { visualizePathStyle: { stroke: "#00ff00" } });
                }
                return;
            }
            // 4. Nothing to do? Upgrade
            if (this.creep.upgradeController(this.creep.room.controller) === ERR_NOT_IN_RANGE) {
                // @ts-ignore
                this.move(this.creep.room.controller);
            }
        }
        else {
            // === GATHER ===
            // 0. Dropped Resources (High Priority for fast recovery)
            const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
            });
            if (dropped) {
                if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
                    this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
                }
                return;
            }
            // 1. Containers/Storage
            const target = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (s) => (s.structureType === STRUCTURE_CONTAINER ||
                    s.structureType === STRUCTURE_STORAGE) &&
                    // @ts-ignore
                    s.store[RESOURCE_ENERGY] > 0,
            });
            if (target) {
                // Clear request flag if we found a target
                // @ts-ignore
                if (this.memory.requestingEnergy)
                    delete this.memory.requestingEnergy;
                if (this.creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.move(target, { visualizePathStyle: { stroke: "#ffaa00" } });
                }
            }
            else {
                // === REQUEST DELIVERY ===
                // If no container nearby, signal Haulers
                // @ts-ignore
                this.memory.requestingEnergy = true;
                this.creep.say("📡 help");
                // Harvest fallback (only if desperate or early game)
                const source = this.creep.pos.findClosestByPath(FIND_SOURCES);
                if (source && this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    this.move(source);
                }
            }
        }
    }
}

const Logger = {
    log: (message, module = "System") => {
        console.log(`[${module}] ${message}`);
    },
    error: (message, module = "System") => {
        console.log(`<span style="color:red">[${module}] ERROR: ${message}</span>`);
    },
    highlight: (message) => {
        console.log(`<span style="color:cyan">${message}</span>`);
    },
};

/**
 * 模块：Creeps (OOP Refactored)
 * 执行所有 Creep 的逻辑
 */
const creepsModule = {
    // 角色类映射
    roles: {
        harvester: Harvester,
        hauler: Hauler,
        upgrader: Upgrader,
        builder: Builder,
    },
    // 作为全局模块运行
    run: function () {
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.spawning)
                continue;
            // @ts-ignore
            const RoleClass = this.roles[creep.memory.role];
            if (RoleClass) {
                try {
                    // 实例化并运行
                    // 注意：频繁 new 可能会有微小的 GC 压力，但在 Screeps 中每 tick 都是全新的对象，所以这是标准做法
                    const roleInstance = new RoleClass(creep);
                    roleInstance.run();
                    // 处理被动移动请求 (对穿)
                    moveModule.handleRequests(creep);
                }
                catch (e) {
                    // 防止日志刷屏，每 tick 每种角色只报错一次
                    // @ts-ignore
                    if (!Memory._logFlood || Memory._logFlood !== Game.time) {
                        // @ts-ignore
                        Memory._logFlood = Game.time;
                        // @ts-ignore
                        Logger.error(`Error in ${creep.name} (${creep.memory.role}): ${e.stack}`, "Creeps");
                    }
                }
            }
        }
    },
};

const brainModule = {
    run: function (room) {
        // 实例化 Brain 并运行决策逻辑
        // Brain 的状态通常不需要持久化到 Memory，因为它每 tick 重新计算最优解
        const brain = new Brain(room);
        brain.run();
    },
};

// === 注册模块 ===
// 0. 大脑决策 - 房间级别 (最优先)
Kernel.register("brain", brainModule);
// 1. 核心逻辑 (人口 & 孵化) - 房间级别
Kernel.register("population", populationModule); // 仅计算
Kernel.register("lifecycle", Lifecycle); // 生命周期监控
Kernel.register("spawner", spawnerModule); // 孵化执行
// 2. 规划与建造 - 房间级别
Kernel.register("planner", structurePlanner);
// 3. 防御与监控 - 房间级别
Kernel.register("tower", towerModule);
Kernel.register("monitor", monitorModule);
Kernel.register("traffic", TrafficManager);
// 4. 全局逻辑 - 全局级别
Kernel.register("creeps", creepsModule, "global");
const loop = function () {
    // 运行内核
    Kernel.run();
    // 可选：定期打印内核统计报告
    if (Game.time % 20 === 0) ;
};

exports.loop = loop;
//# sourceMappingURL=main.js.map
