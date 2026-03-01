import { TaskProcess } from "./TaskProcess";
import { smartMove } from "./move/smartMove";
import { processRegistry } from "../core/ProcessRegistry";

export class MoveTask extends TaskProcess {
  protected isValid(): boolean {
    return !!this.creep;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const data = this.data as unknown as {
      targetRoom?: string;
      targetPos?: { x: number; y: number; roomName: string };
      range?: number;
      x?: number;
      y?: number;
    };
    const targetRoom = data.targetRoom;
    const targetPos = data.targetPos;

    if (targetPos) {
        const pos = new RoomPosition(targetPos.x, targetPos.y, targetPos.roomName);
        if (creep.pos.inRangeTo(pos, data.range ?? 1)) {
            this.complete();
            return;
        }
        smartMove(creep, pos, { reusePath: 20, range: data.range ?? 1 });
    } else if (targetRoom) {
        if (creep.room.name === targetRoom) {
            const x = data.x ?? 25;
            const y = data.y ?? 25;
            // If just "move to room", we are done when we enter.
            // But we might want to move away from exit.
            if (creep.pos.x > 2 && creep.pos.x < 47 && creep.pos.y > 2 && creep.pos.y < 47) {
                 this.complete();
                 return;
            }
            smartMove(creep, new RoomPosition(x, y, targetRoom), { reusePath: 20, range: 20 });
        } else {
            // Move to room
            const dir = creep.room.findExitTo(targetRoom);
            if (dir !== ERR_NO_PATH && dir !== ERR_INVALID_ARGS) {
                const exit = creep.pos.findClosestByRange(dir as ExitConstant);
                if (exit) smartMove(creep, exit, { reusePath: 20, range: 1 });
            }
        }
    } else {
        this.fail("noTarget");
    }
  }
}

processRegistry.register(MoveTask, "MoveTask");
