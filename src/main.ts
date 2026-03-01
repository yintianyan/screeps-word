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

    if (!Memory.kernel.processTable["links"]) {
      kernel.addProcess(new LinkNetworkProcess("links", "init", 55));
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
        if (room.controller?.my) recordRoomStats(room, 100);
      }
    }

    if (Game.cpu.bucket >= config.CPU.BUCKET_LIMIT) Dashboard.run();
  }
});
