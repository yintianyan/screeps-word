import { TrafficManager } from "../../core/TrafficManager";

type MoveMemory = {
  lastX?: number;
  lastY?: number;
  stuckCount?: number;
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
      const room = Game.rooms[roomName];
      if (room) {
        const avoid = room.find(FIND_MY_CREEPS, {
          filter: (c) => avoidRoles.includes(c.memory.role),
        });
        for (const c of avoid) resultMatrix.set(c.pos.x, c.pos.y, 0xff);
      }
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

  if (r === ERR_NO_PATH && stuck >= 5) {
    const pos = getPos(target);
    const dirToTarget = creep.pos.getDirectionTo(pos);
    const opposite = (((dirToTarget + 3) % 8) + 1) as DirectionConstant;
    creep.move(opposite);
    return OK;
  }

  return r;
}
