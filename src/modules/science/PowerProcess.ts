import { Process } from "../../core/Process";
import { processRegistry } from "../../core/ProcessRegistry";

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my && room.controller.level === 8) rooms.push(room);
  }
  return rooms;
}

/**
 * Power 处理进程
 *
 * 负责管理 PowerSpawn 的运作。
 *
 * 功能：
 * 1. 检测 PowerSpawn 状态。
 * 2. 当有足够 Power 和 Energy 时，执行 processPower。
 */
export class PowerProcess extends Process {
  public run(): void {
    if (Game.time % 10 !== 0) return;

    for (const room of getMyRooms()) {
      this.runRoom(room);
    }
  }

  private runRoom(room: Room): void {
    const ps = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_POWER_SPAWN,
    })[0] as StructurePowerSpawn | undefined;

    if (!ps) return;

    if (
      ps.store.getUsedCapacity(RESOURCE_POWER) > 0 &&
      ps.store.getUsedCapacity(RESOURCE_ENERGY) >= 50
    ) {
      ps.processPower();
    }
  }
}

processRegistry.register(PowerProcess, "PowerProcess");
