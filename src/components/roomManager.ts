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
    if (Game.time % this.config.checkInterval !== 0) return;

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
      if (registry[name] === "PRE_SPAWNING") continue;
      if (creep.spawning) continue;

      const maxLife = 1500; // 标准 Creep 寿命
      const threshold = maxLife * this.config.thresholdRatio; // 150 ticks

      if (creep.ticksToLive < threshold) {
        // 触发替换
        console.log(
          `[Lifecycle] ⚠️ ${name} 濒死 (TTL: ${creep.ticksToLive}). 请求替换。`,
        );

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
      } else {
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
    if (!Memory.lifecycle || !Memory.lifecycle.registry) return true;

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

export default Lifecycle;
