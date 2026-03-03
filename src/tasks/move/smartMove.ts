/**
 * 智能移动模块
 * 
 * 封装了 Creep.moveTo，增加了以下功能：
 * 1. 卡住检测 (Stuck Detection)：如果 Creep 在同一位置停留过久，自动触发重寻路。
 * 2. 震荡检测 (Oscillation Detection)：如果 Creep 在两个位置之间反复横跳，强制重寻路并增加避让成本。
 * 3. 动态寻路参数：根据卡住状态动态调整 reusePath 和 maxOps。
 * 4. 交通协调 (Traffic Control)：集成 TrafficManager，支持推挤 (Push) 和避让 (Avoid)。
 */

import { TrafficManager } from "../../core/TrafficManager";
import { Cache } from "../../core/Cache";
import StructureCache from "../../utils/structureCache";
import { Debug } from "../../core/Debug";

/**
 * 移动内存结构
 * 存储在 creep.memory._move 中
 */
type MoveMemory = {
  lastX?: number;        // 上一 tick 的 X 坐标
  lastY?: number;        // 上一 tick 的 Y 坐标
  prevX?: number;        // 上上一 tick 的 X 坐标 (用于震荡检测)
  prevY?: number;        // 上上一 tick 的 Y 坐标 (用于震荡检测)
  stuckCount?: number;   // 连续卡住的 tick 数
  oscillateCount?: number; // 震荡计数 (在两个位置反复横跳的次数)
  path?: string;         // 当前路径序列化字符串
  lastStuckLog?: number; // 上次记录卡住日志的时间
};

export type SmartMoveTarget = RoomPosition | { pos: RoomPosition };

export type SmartMoveOptions = {
  range?: number;        // 到达目标的距离 (默认 1)
  reusePath?: number;    // 路径复用 tick 数 (默认 20，卡住时自动降低)
  avoidRoles?: string[]; // 需要避让的 Creep 角色列表
  ignoreCreeps?: boolean;// 是否忽略其他 Creep (默认 true，卡住时自动变为 false)
  maxOps?: number;       // 寻路最大计算量 (默认 2000，卡住时自动增加)
};

function getTerrainCosts(role: string | undefined): { plainCost: number; swampCost: number } {
  if (role === "hauler" || role === "distributor") {
    return { plainCost: 4, swampCost: 12 };
  }
  if (role === "worker" || role === "upgrader") {
    return { plainCost: 3, swampCost: 10 };
  }
  return { plainCost: 2, swampCost: 10 };
}

function getDefaultAvoidRoles(role: string | undefined): string[] {
  if (role === "worker" || role === "upgrader") {
    return ["distributor", "hauler", "remoteHauler"];
  }
  if (role === "miner") {
    return ["distributor", "hauler"];
  }
  return [];
}

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

/**
 * 更新卡住和震荡状态
 * 
 * 逻辑：
 * 1. 如果位置没变且疲劳值为 0 -> stuckCount + 1
 * 2. 如果位置变了 -> stuckCount - 1 (缓慢衰减，而不是直接清零，防止偶发移动掩盖拥堵)
 * 3. 如果当前位置等于上上个位置 (A -> B -> A) -> oscillateCount + 1
 */
function updateStuck(creep: Creep, mem: MoveMemory): number {
  const moved = mem.lastX !== creep.pos.x || mem.lastY !== creep.pos.y;
  if (
    moved &&
    mem.prevX === creep.pos.x &&
    mem.prevY === creep.pos.y &&
    mem.lastX !== undefined &&
    mem.lastY !== undefined
  ) {
    mem.oscillateCount = (mem.oscillateCount ?? 0) + 1;
  } else if ((mem.oscillateCount ?? 0) > 0) {
    mem.oscillateCount = (mem.oscillateCount ?? 0) - 1;
  }

  if (mem.lastX === creep.pos.x && mem.lastY === creep.pos.y && creep.fatigue === 0) {
    mem.stuckCount = (mem.stuckCount ?? 0) + 1;
  } else {
    if ((mem.stuckCount ?? 0) > 0) mem.stuckCount = (mem.stuckCount ?? 0) - 1;
    mem.prevX = mem.lastX;
    mem.prevY = mem.lastY;
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

function requestLocalPush(creep: Creep, targetPos: RoomPosition): void {
  const dir = creep.pos.getDirectionTo(targetPos);
  const nextPos = getPositionAtDirection(creep.pos, dir);
  if (!nextPos) return;
  const blockers = nextPos.lookFor(LOOK_CREEPS);
  const obstacle = blockers.find((c) => c.my && c.id !== creep.id);
  if (obstacle) {
    TrafficManager.requestPush(creep, obstacle);
  }
}

/**
 * 执行智能移动
 * 
 * @param creep 要移动的 Creep
 * @param target 目标位置或对象
 * @param opts 移动选项
 */
export function smartMove(
  creep: Creep,
  target: SmartMoveTarget,
  opts: SmartMoveOptions = {},
): ScreepsReturnCode {
  const mem = getMoveMemory(creep);
  const stuck = updateStuck(creep, mem);
  const oscillate = mem.oscillateCount ?? 0;
  const range = opts.range ?? 1;
  const role = creep.memory.role;
  const terrainCosts = getTerrainCosts(role);
  const targetPos = getPos(target);

  // 策略调整：如果卡住或震荡，强制不忽略 Creep，让寻路算法看到挡路的人
  const baseIgnoreCreeps = opts.ignoreCreeps ?? true;
  const ignoreCreeps = stuck >= 3 || oscillate >= 3 ? false : baseIgnoreCreeps;
  const trafficCallback = TrafficManager.getCallback(!ignoreCreeps);

  // 卡住日志记录 (每 50 tick 最多一次)
  if (stuck >= 5) {
    const last = typeof mem.lastStuckLog === "number" ? mem.lastStuckLog : -999999;
    if (Game.time - last >= 50) {
      mem.lastStuckLog = Game.time;
      const pos = getPos(target);
      Debug.event(
        "move_stuck",
        {
          stuck,
          range,
          taskId: (creep.memory as any).taskId,
          targetId: (creep.memory as any).targetId,
          to: { room: pos.roomName, x: pos.x, y: pos.y },
          path0: typeof mem.path === "string" && mem.path.length > 0 ? mem.path[0] : "",
        },
        { creep: creep.name, room: creep.room.name },
      );
    }
  }
  if (stuck >= 3 || oscillate >= 3) {
    TrafficManager.recordCongestion(creep.pos, stuck >= 5 ? 6 : 3);
    requestLocalPush(creep, targetPos);
  }
  
  // 震荡严重时清空路径，强制重算
  if (oscillate >= 4) mem.path = undefined;

  // 动态调整寻路参数：卡住时减少复用，增加计算量
  const reusePath = stuck >= 3 || oscillate >= 3 ? 3 : (opts.reusePath ?? 20);
  const maxOps = opts.maxOps ?? (stuck >= 3 || oscillate >= 3 ? 3000 : 2000);

  const avoidRoles = opts.avoidRoles ?? getDefaultAvoidRoles(role);

  // 构建 CostMatrix 回调
  const costCallback = (roomName: string, costs: CostMatrix): CostMatrix => {
    // 1. 获取基础交通成本 (包含地形和静态结构)
    const resultMatrix = trafficCallback(roomName, costs);
    
    // 2. 应用临时避让 (被推挤后的 Creep 短时间内不应该回到原位)
    const tmem = (creep.memory as unknown as {
      _traffic?: {
        avoidX?: number;
        avoidY?: number;
        avoidRoom?: string;
        avoidUntil?: number;
      };
    })._traffic;
    if (
      tmem &&
      tmem.avoidRoom === roomName &&
      typeof tmem.avoidX === "number" &&
      typeof tmem.avoidY === "number" &&
      typeof tmem.avoidUntil === "number" &&
      tmem.avoidUntil >= Game.time
    ) {
      resultMatrix.set(tmem.avoidX, tmem.avoidY, 0xff);
    }

    // 3. 应用角色避让 (例如 worker 避让 harvester)
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

  const r = creep.moveTo(targetPos, {
    range,
    reusePath,
    ignoreCreeps,
    maxOps,
    plainCost: terrainCosts.plainCost,
    swampCost: terrainCosts.swampCost,
    costCallback,
  });

  if (r === OK && stuck > 0 && stuck < 3 && oscillate < 2) {
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
  if ((r === ERR_NO_PATH || r === ERR_TIRED) && stuck >= 2) {
    requestLocalPush(creep, targetPos);
  }

  if (r === ERR_NO_PATH && stuck >= 5) {
    const terrain = creep.room.getTerrain();
    const spots: RoomPosition[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = creep.pos.x + dx;
        const y = creep.pos.y + dy;
        if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const pos = new RoomPosition(x, y, creep.room.name);
        const structures = pos.lookFor(LOOK_STRUCTURES);
        if (
          structures.some(
            (s) =>
              s.structureType !== STRUCTURE_ROAD &&
              s.structureType !== STRUCTURE_CONTAINER &&
              (s.structureType !== STRUCTURE_RAMPART ||
                !(s as StructureRampart).my),
          )
        )
          continue;
        spots.push(pos);
      }
    }
    if (spots.length > 0) {
      const spot = spots[Math.floor(Math.random() * spots.length)];
      creep.move(creep.pos.getDirectionTo(spot));
      return OK;
    }
  }

  return r;
}
