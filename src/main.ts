import { Kernel } from "./core/Kernel";
import { InitProcess } from "./modules/InitProcess";
import { RoomLogisticsProcess } from "./modules/RoomLogisticsProcess";
import { RoomPlannerProcess } from "./modules/RoomPlannerProcess";
import { SpawnerProcess } from "./modules/SpawnerProcess";
import { ErrorMapper } from "./core/ErrorMapper";
import { recordCpuStats, recordRoomStats } from "./core/Stats";
import { gcCreepMemory, gcRoomStats } from "./core/MemoryGC";

let kernel: Kernel | null = null;

export const loop = ErrorMapper.wrapLoop(() => {
  if (!Memory.kernel) kernel = null;
  if (!kernel) kernel = new Kernel();

  if (Game.time % 50 === 0) {
    gcCreepMemory();
    gcRoomStats(100);
  }

  if (!Memory.kernel.processTable["init"]) {
    console.log("[Main] Initializing Kernel...");
    const initProc = new InitProcess("init", "root", 100);
    kernel.addProcess(initProc);
  }

  if (!Memory.kernel.processTable["logistics"]) {
    kernel.addProcess(new RoomLogisticsProcess("logistics", "init", 80));
  }

  if (!Memory.kernel.processTable["spawner"]) {
    kernel.addProcess(new SpawnerProcess("spawner", "init", 90));
  }

  if (!Memory.kernel.processTable["planner"]) {
    kernel.addProcess(new RoomPlannerProcess("planner", "init", 10));
  }

  const start = Game.cpu.getUsed();
  kernel.run();
  const end = Game.cpu.getUsed();

  recordCpuStats({
    bucket: Game.cpu.bucket,
    used: end,
    limit: Game.cpu.limit,
    scheduler: end - start,
  });

  if (Game.time % 5 === 0) {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (room.controller?.my) recordRoomStats(room, 100);
    }
  }
});
