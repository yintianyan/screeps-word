
import Cache from "../components/memoryManager";

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
  modules: [] as any[],
  profiler: {} as any,

  /**
   * 注册模块到内核
   * @param {string} name 模块名称
   * @param {Object} module 包含 run(room) 或 run() 方法的对象
   * @param {string} type 'room' (默认) 或 'global'
   */
  register: function (name: string, module: any, type = "room") {
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
      if (!room.controller || !room.controller.my) continue;

      this.modules.forEach(({ name, module, type }) => {
        if (type === "global") return; // 在房间循环中跳过全局模块

        const startCpu = Game.cpu.getUsed();
        try {
          if (module.run) {
            module.run(room);
          }
        } catch (e: any) {
          console.log(`[Kernel] 模块 ${name} 发生错误: ${e.stack}`);
        }
        const used = Game.cpu.getUsed() - startCpu;
        this.recordStats(name, used);
      });
    }

    // 3. 运行全局模块
    this.modules.forEach(({ name, module, type }) => {
      if (type !== "global") return;

      const startCpu = Game.cpu.getUsed();
      try {
        if (module.run) {
          module.run();
        }
      } catch (e: any) {
        console.log(`[Kernel] 全局模块 ${name} 发生错误: ${e.stack}`);
      }
      const used = Game.cpu.getUsed() - startCpu;
      this.recordStats(name, used);
    });
  },

  recordStats: function (name: string, cpu: number) {
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

export default Kernel;
