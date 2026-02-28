import { Kernel } from "./core/Kernel";
import { InitProcess } from "./modules/InitProcess";
import { DefenseProcess } from "./modules/DefenseProcess";
import { DistributorProcess } from "./modules/energy/DistributorProcess";
import { LinkNetworkProcess } from "./modules/energy/LinkNetworkProcess";
import { RoomLogisticsProcess } from "./modules/RoomLogisticsProcess";
import { RoomPlannerProcess } from "./modules/RoomPlannerProcess";
import { RemoteMiningProcess } from "./modules/RemoteMiningProcess";
import { SpawnerProcess } from "./modules/SpawnerProcess";
import { ErrorMapper } from "./core/ErrorMapper";
import { recordCpuStats, recordRoomStats } from "./core/Stats";
import { gcCreepMemory, gcRoomStats } from "./core/MemoryGC";
import { Cache } from "./core/Cache";

let kernel: Kernel | null = null;

export const loop = ErrorMapper.wrapLoop(() => {
  const loopStart = Game.cpu.getUsed();
  try {
    Cache.clearTick();
    if (!Memory.kernel) kernel = null;
    if (!kernel) kernel = new Kernel();

    if (Game.time % 50 === 0) {
      gcCreepMemory();
      gcRoomStats(100);
    }

    if (!Memory.kernel.processTable["init"]) {
      const initProc = new InitProcess("init", "root", 100);
      kernel.addProcess(initProc);
    }

    if (!Memory.kernel.processTable["logistics"]) {
      kernel.addProcess(new RoomLogisticsProcess("logistics", "init", 80));
    }

    if (!Memory.kernel.processTable["spawner"]) {
      kernel.addProcess(new SpawnerProcess("spawner", "init", 90));
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

    if (!Memory.kernel.processTable["planner"]) {
      kernel.addProcess(new RoomPlannerProcess("planner", "init", 10));
    }

    if (!Memory.kernel.processTable["remote"]) {
      kernel.addProcess(new RemoteMiningProcess("remote", "init", 40));
    }

    kernel.run();
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

    if (Game.time % 5 === 0) {
      for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (room.controller?.my) recordRoomStats(room, 100);
      }
    }
  }
});
