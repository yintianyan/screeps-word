import { TaskProcess } from "./TaskProcess";
import { smartMove } from "./move/smartMove";
import { processRegistry } from "../core/ProcessRegistry";
import { getRouteRooms } from "../core/RoutePlanner";

/**
 * 移动任务
 *
 * 控制 Creep 移动到指定房间或位置。
 * 集成了 RoutePlanner 进行跨房间寻路。
 */
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
      // 移动到精确坐标
      const pos = new RoomPosition(
        targetPos.x,
        targetPos.y,
        targetPos.roomName,
      );
      if (creep.pos.inRangeTo(pos, data.range ?? 1)) {
        this.complete();
        return;
      }
      smartMove(creep, pos, { reusePath: 20, range: data.range ?? 1 });
    } else if (targetRoom) {
      if (creep.room.name === targetRoom) {
        // 已到达目标房间
        const x = data.x ?? 25;
        const y = data.y ?? 25;
        // 如果只是“去房间”，进入房间且离开出口区即算完成
        if (
          creep.pos.x > 2 &&
          creep.pos.x < 47 &&
          creep.pos.y > 2 &&
          creep.pos.y < 47
        ) {
          this.complete();
          return;
        }
        // 移动到房间内的指定位置 (默认为中心)
        smartMove(creep, new RoomPosition(x, y, targetRoom), {
          reusePath: 20,
          range: 20,
        });
      } else {
        // 跨房间移动：使用 RoutePlanner 规划路径
        const rooms = getRouteRooms(creep.room.name, targetRoom, {
          avoidSK: true,
          preferHighway: true,
        });
        const nextRoom = rooms.length >= 2 ? rooms[1] : targetRoom;
        const dir = creep.room.findExitTo(nextRoom);
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
