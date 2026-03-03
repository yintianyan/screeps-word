import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { Build } from "./planner/Build";

/**
 * 房间规划进程
 * 
 * 负责自动规划房间内的建筑布局。
 * 这是一个入口进程，实际规划逻辑委托给 `Build.run(room)`。
 * 
 * 触发时机：
 * 通常在 RCL 升级或特定 tick 间隔运行。
 */
export class RoomPlannerProcess extends Process {
  constructor(pid: string, parentPID: string, priority = 50) {
    super(pid, parentPID, priority);
  }

  public run(): void {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller?.my) continue;
      Build.run(room);
    }
  }
}

processRegistry.register(RoomPlannerProcess, "RoomPlannerProcess");
