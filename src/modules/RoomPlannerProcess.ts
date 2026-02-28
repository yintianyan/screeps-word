import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { Build } from "./planner/Build";

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
