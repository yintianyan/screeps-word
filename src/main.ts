import { Kernel } from "./core/Kernel";
import { InitProcess } from "./modules/InitProcess";
import { DefenseProcess } from "./modules/DefenseProcess";
import { DistributorProcess } from "./modules/energy/DistributorProcess";
import { LinkNetworkProcess } from "./modules/energy/LinkNetworkProcess";
import { RoomLogisticsProcess } from "./modules/RoomLogisticsProcess";
import { RoomPlannerProcess } from "./modules/RoomPlannerProcess";
import { RemoteMiningProcess } from "./modules/RemoteMiningProcess";
import { SpawnerProcess } from "./modules/SpawnerProcess";
import { MiningProcess } from "./modules/MiningProcess";
import { RoomStateProcess } from "./modules/RoomStateProcess";
import { CreepRecycleProcess } from "./modules/CreepRecycleProcess";
import { TerminalProcess } from "./modules/TerminalProcess";
import { LabProcess } from "./modules/science/LabProcess";
import { PowerProcess } from "./modules/science/PowerProcess";
import { ErrorMapper } from "./core/ErrorMapper";
import { recordCpuStats, recordRoomStats } from "./core/Stats";
import {
  ensureCreepMemoryDefaults,
  gcCreepMemory,
  gcRoomStats,
} from "./core/MemoryGC";
import { Cache } from "./core/Cache";
import { TrafficManager } from "./core/TrafficManager";
import { Dashboard } from "./core/Dashboard";
import { config } from "./config";

let kernel: Kernel | null = null;

/**
 * 游戏主循环 (Game Loop)
 *
 * Screeps 每一 tick 都会执行此函数。
 *
 * 主要流程：
 * 1. 初始化/恢复 Kernel。
 * 2. 周期性执行垃圾回收 (GC)。
 * 3. 注册系统级进程 (System Processes) - 如果尚未运行。
 *    - init: 初始化
 *    - logistics: 房间物流
 *    - state: 房间状态监控
 *    - spawner: 孵化管理
 *    - mining: 挖矿管理
 *    - recycle: Creep 回收
 *    - defense: 防御系统
 *    - distributor: 高级物流分发
 *    - links: Link 网络管理
 * 4. 注册非关键进程 (在 CPU 充足时)。
 *    - planner: 房间布局规划
 *    - remote: 外矿管理
 *    - terminal: 终端管理
 *    - labs: 实验室管理
 *    - power: Power 处理
 * 5. 运行 Kernel 和 TrafficManager。
 * 6. 记录统计数据 (Stats) 和运行 Dashboard。
 */
export const loop = ErrorMapper.wrapLoop(() => {
  const loopStart = Game.cpu.getUsed();
  try {
    Cache.clearTick();
    const lowBucket = Game.cpu.bucket < config.CPU.BUCKET_LIMIT;
    if (!Memory.kernel) kernel = null;
    if (!kernel) kernel = new Kernel();

    if (!lowBucket && Game.time % 50 === 0) {
      gcCreepMemory();
      gcRoomStats(100);
    }

    ensureCreepMemoryDefaults();

    if (!Memory.kernel.processTable["init"]) {
      const initProc = new InitProcess("init", "root", 100);
      kernel.addProcess(initProc);
    }

    if (!Memory.kernel.processTable["logistics"]) {
      kernel.addProcess(new RoomLogisticsProcess("logistics", "init", 80));
    }

    if (!Memory.kernel.processTable["state"]) {
      kernel.addProcess(new RoomStateProcess("state", "init", 91));
    }

    if (!Memory.kernel.processTable["spawner"]) {
      kernel.addProcess(new SpawnerProcess("spawner", "init", 90));
    }

    if (!Memory.kernel.processTable["mining"]) {
      kernel.addProcess(new MiningProcess("mining", "init", 85));
    }

    if (!Memory.kernel.processTable["recycle"]) {
      kernel.addProcess(new CreepRecycleProcess("recycle", "init", 88));
    }

    if (!Memory.kernel.processTable["defense"]) {
      kernel.addProcess(new DefenseProcess("defense", "init", 70));
    }

    if (!Memory.kernel.processTable["distributor"]) {
      kernel.addProcess(new DistributorProcess("distributor", "init", 65));
    }

    const linksProc = Memory.kernel.processTable["links"];
    if (!linksProc) {
      kernel.addProcess(new LinkNetworkProcess("links", "init", 86));
    } else if (linksProc.priority !== 86) {
      kernel.killProcess("links");
      kernel.addProcess(new LinkNetworkProcess("links", "init", 86));
    }

    if (!lowBucket) {
      if (!Memory.kernel.processTable["planner"]) {
        kernel.addProcess(new RoomPlannerProcess("planner", "init", 10));
      }

      if (!Memory.kernel.processTable["remote"]) {
        kernel.addProcess(new RemoteMiningProcess("remote", "init", 40));
      }

      if (!Memory.kernel.processTable["terminal"]) {
        kernel.addProcess(new TerminalProcess("terminal", "init", 30));
      }

      if (!Memory.kernel.processTable["labs"]) {
        kernel.addProcess(new LabProcess("labs", "init", 25));
      }

      if (!Memory.kernel.processTable["power"]) {
        kernel.addProcess(new PowerProcess("power", "init", 20));
      }
    }

    kernel.run();
    TrafficManager.run();
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? (e.stack ?? e.message) : `NonError: ${String(e)}`;
    console.log(`[KERNEL PANIC] ${msg}`);
  } finally {
    const loopEnd = Game.cpu.getUsed();
    recordCpuStats({
      bucket: Game.cpu.bucket,
      used: loopEnd,
      limit: Game.cpu.limit,
      scheduler: loopEnd - loopStart,
    });

    if (Game.cpu.bucket >= config.CPU.BUCKET_LIMIT && Game.time % 5 === 0) {
      for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (room.controller?.my) recordRoomStats(room, 5); // Reduce history to 5 to save Memory parsing CPU
      }
    }

    if (Game.cpu.bucket >= config.CPU.BUCKET_LIMIT) Dashboard.run();
  }
});
