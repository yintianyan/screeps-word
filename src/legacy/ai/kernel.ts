import Cache from "../components/memoryManager";
import { profiler } from "../utils/profiler";

/**
 * 核心内核 (Core Kernel)
 *
 * 管理所有游戏模块的生命周期。
 * 职责：
 * 1. 初始化和关闭模块。
 * 2. 运行模块并处理错误 (try-catch)。
 * 3. 监控每个模块的 CPU 使用率。
 * 4. 熔断机制：当模块连续出错时暂停执行。
 */

interface ModuleStats {
  errorCount: number;
  lastErrorTick: number;
  disabledUntil: number;
}

interface IModule {
  run(room?: Room): void;
}

interface KernelModule {
  name: string;
  module: IModule;
  type: string;
}

const Kernel = {
  modules: [] as KernelModule[],
  moduleStats: {} as Record<string, ModuleStats>,

  // 熔断配置
  CIRCUIT_BREAKER_THRESHOLD: 5, // 连续错误次数
  CIRCUIT_BREAKER_COOLDOWN: 50, // 冷却 Tick 数

  /**
   * 注册模块到内核
   * @param {string} name 模块名称
   * @param {Object} module 包含 run(room) 或 run() 方法的对象
   * @param {string} type 'room' (默认) 或 'global'
   */
  register: function (name: string, module: IModule, type = "room") {
    this.modules.push({ name, module, type });
    if (!this.moduleStats[name]) {
      this.moduleStats[name] = {
        errorCount: 0,
        lastErrorTick: 0,
        disabledUntil: 0,
      };
    }
  },

  /**
   * 主执行循环。在 main.js 中调用
   */
  run: function () {
    // 1. 系统维护
    Cache.clearTick(); // 重置 tick 缓存

    // 重置 Profiler 数据（如果启用）
    if (profiler.isEnabled() && Game.time % 10 === 0) {
      // 每 10 tick 重置一次，避免内存无限增长，或者可以选择不重置以累积数据
      // 这里选择不自动重置，由用户手动重置或在 console 获取
    }

    // 2. 逐房间运行模块
    // 优先遍历房间，再遍历模块，以共享房间级缓存
    for (const name in Game.rooms) {
      const room = Game.rooms[name];

      // 如果需要，跳过非己方房间，但我们可能想要侦查它们
      if (!room.controller || !room.controller.my) continue;

      this.modules.forEach(({ name: moduleName, module, type }) => {
        if (type === "global") return; // 在房间循环中跳过全局模块

        if (this.isModuleDisabled(moduleName)) return;

        const startCpu = Game.cpu.getUsed();
        try {
          if (module.run) {
            module.run(room);
          }
          // 成功执行，重置错误计数
          if (this.moduleStats[moduleName].errorCount > 0) {
            this.moduleStats[moduleName].errorCount = 0;
          }
        } catch (e: any) {
          this.handleError(moduleName, e);
        }
        const used = Game.cpu.getUsed() - startCpu;
        profiler.record(`Module:${moduleName}`, used);
      });
    }

    // 3. 运行全局模块
    this.modules.forEach(({ name: moduleName, module, type }) => {
      if (type !== "global") return;

      if (this.isModuleDisabled(moduleName)) return;

      const startCpu = Game.cpu.getUsed();
      try {
        if (module.run) {
          module.run();
        }
        if (this.moduleStats[moduleName].errorCount > 0) {
          this.moduleStats[moduleName].errorCount = 0;
        }
      } catch (e: any) {
        this.handleError(moduleName, e);
      }
      const used = Game.cpu.getUsed() - startCpu;
      profiler.record(`Module:${moduleName}`, used);
    });
  },

  isModuleDisabled(name: string): boolean {
    const stats = this.moduleStats[name];
    if (stats.disabledUntil > Game.time) {
      return true;
    }
    return false;
  },

  handleError(name: string, e: any) {
    const stats = this.moduleStats[name];
    stats.errorCount++;
    stats.lastErrorTick = Game.time;

    console.log(`[Kernel] 模块 ${name} 发生错误: ${e.stack}`);

    if (stats.errorCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      stats.disabledUntil = Game.time + this.CIRCUIT_BREAKER_COOLDOWN;
      stats.errorCount = 0; // 重置计数，等待冷却后重试
      console.log(
        `[Kernel] 熔断机制触发：模块 ${name} 已暂停执行 ${this.CIRCUIT_BREAKER_COOLDOWN} ticks。`,
      );
      Game.notify(
        `[Kernel] 熔断机制触发：模块 ${name} 已暂停执行 ${this.CIRCUIT_BREAKER_COOLDOWN} ticks。错误: ${e.message}`,
      );
    }
  },

  getReport: function () {
    return profiler.toString();
  },
};

export default Kernel;
