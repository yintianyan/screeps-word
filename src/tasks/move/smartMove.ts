import { TrafficManager } from "../../core/TrafficManager";
import { Cache } from "../../core/Cache";
import StructureCache from "../../utils/structureCache";

type MoveMemory = {
  lastX?: number;
  lastY?: number;
  stuckCount?: number;
  path?: string;
};

export type SmartMoveTarget = RoomPosition | { pos: RoomPosition };

export type SmartMoveOptions = {
  range?: number;
  reusePath?: number;
  avoidRoles?: string[];
  ignoreCreeps?: boolean;
  maxOps?: number;
};

function getPos(target: SmartMoveTarget): RoomPosition {
  return target instanceof RoomPosition ? target : target.pos;
}

function getMoveMemory(creep: Creep): MoveMemory {
  const mem = creep.memory._move as MoveMemory | undefined;
  if (!mem) {
    const next: MoveMemory = {};
    creep.memory._move = next;
    return next;
  }
  return mem;
}

function updateStuck(creep: Creep, mem: MoveMemory): number {
  if (mem.lastX === creep.pos.x && mem.lastY === creep.pos.y && creep.fatigue === 0) {
    mem.stuckCount = (mem.stuckCount ?? 0) + 1;
  } else {
    if ((mem.stuckCount ?? 0) > 0) mem.stuckCount = (mem.stuckCount ?? 0) - 1;
    mem.lastX = creep.pos.x;
    mem.lastY = creep.pos.y;
  }
  return mem.stuckCount ?? 0;
}

function getPositionAtDirection(pos: RoomPosition, direction: DirectionConstant): RoomPosition | null {
    const dx = [0, 0, 1, 1, 1, 0, -1, -1, -1][direction];
    const dy = [0, -1, -1, 0, 1, 1, 1, 0, -1][direction];
    const x = pos.x + dx;
    const y = pos.y + dy;
    
    if (x < 0 || x > 49 || y < 0 || y > 49) return null;
    return new RoomPosition(x, y, pos.roomName);
}

export function smartMove(
  creep: Creep,
  target: SmartMoveTarget,
  opts: SmartMoveOptions = {},
): ScreepsReturnCode {
  const mem = getMoveMemory(creep);
  const stuck = updateStuck(creep, mem);
  const range = opts.range ?? 1;

  const baseIgnoreCreeps = opts.ignoreCreeps ?? true;
  const ignoreCreeps = stuck >= 3 ? false : baseIgnoreCreeps;
  
  const reusePath = stuck >= 3 ? 5 : (opts.reusePath ?? 20);
  const maxOps = opts.maxOps ?? (stuck >= 3 ? 2500 : 2000);

  const avoidRoles = opts.avoidRoles ?? [];
  
  const trafficCallback = TrafficManager.getCallback(stuck >= 3);

  const costCallback = (roomName: string, costs: CostMatrix): CostMatrix => {
    const resultMatrix = trafficCallback(roomName, costs);

    if (avoidRoles.length > 0) {
      const key = `sm:avoid:${roomName}:${avoidRoles.join(",")}`;
      const positions = Cache.getTick(key, () => {
        const room = Game.rooms[roomName];
        if (!room) return [] as Array<{ x: number; y: number }>;
        const creeps = StructureCache.getCreeps(room);
        const result: Array<{ x: number; y: number }> = [];
        for (const c of creeps) {
          if (!avoidRoles.includes(c.memory.role)) continue;
          result.push({ x: c.pos.x, y: c.pos.y });
        }
        return result;
      });
      for (const p of positions) resultMatrix.set(p.x, p.y, 0xff);
    }
    
    return resultMatrix;
  };

  const r = creep.moveTo(getPos(target), {
    range,
    reusePath,
    ignoreCreeps,
    maxOps,
    plainCost: 2,
    swampCost: 10,
    costCallback,
  });

  if (r === OK && stuck > 0 && stuck < 3) {
      const path = mem.path;
      
      if (typeof path === "string" && path.length > 0) {
          const dir = parseInt(path[0], 10) as DirectionConstant;
          if (!isNaN(dir)) {
              const nextPos = getPositionAtDirection(creep.pos, dir);
              if (nextPos) {
                  const creeps = nextPos.lookFor(LOOK_CREEPS);
                  const obstacle = creeps.find(c => c.my);
                  if (obstacle) {
                      TrafficManager.requestPush(creep, obstacle);
                  }
              }
          }
      }
  }

  if (r === ERR_NO_PATH && stuck >= 5) {
    const pos = getPos(target);
    const dirToTarget = creep.pos.getDirectionTo(pos);
    const opposite = (((dirToTarget + 3) % 8) + 1) as DirectionConstant;
    creep.move(opposite);
    return OK;
  }

  return r;
}
