/**
 * 智能移动模块 (PathFinder 重构版)
 *
 * 使用 PathFinder 替代 Creep.moveTo，提供更高性能和更可控的寻路逻辑。
 *
 * 特性：
 * 1. 显式路径缓存：将路径序列化为方向字符串存储，避免每 tick 序列化/反序列化 RoomPosition。
 * 2. 动态环境感知：集成 TrafficManager，根据拥堵情况动态调整 CostMatrix。
 * 3. 智能抗拥堵：
 *    - 自动检测卡住 (Stuck) 和震荡 (Oscillation)。
 *    - 拥堵时自动切换为“避让模式” (考虑 Creep 阻挡)。
 *    - 支持推挤 (Push) 机制疏通交通。
 * 4. 跨房间寻路：支持基于 RoutePlanner 的多房间寻路约束。
 */

import { TrafficManager } from "../../core/TrafficManager";
import { Cache } from "../../core/Cache";
import { getRouteRooms } from "../../core/RoutePlanner";
import StructureCache from "../../utils/structureCache";
import { Debug } from "../../core/Debug";

/**
 * 移动内存结构
 * 存储在 creep.memory._move 中
 */
type MoveMemory = {
  // 位置跟踪
  lastX?: number;
  lastY?: number;
  lastRoom?: string;

  // 震荡检测
  prevX?: number;
  prevY?: number;
  prevRoom?: string;

  // 状态计数
  stuckCount?: number;
  oscillateCount?: number;

  // 路径缓存
  path?: string; // 序列化的方向字符串 (例如 "1234...")
  dest?: { x: number; y: number; roomName: string }; // 当前路径的目的地

  // 拥堵控制
  congestionUntil?: number; // 拥堵模式持续时间

  // 调试
  lastStuckLog?: number;

  // 历史轨迹 (用于长周期循环检测)
  posHistory?: number[];
};

export type SmartMoveTarget = RoomPosition | { pos: RoomPosition };

export type SmartMoveOptions = {
  range?: number; // 到达目标的距离 (默认 1)
  reusePath?: number; // 路径复用 tick 数 (此处仅作为缓存失效参考，主要由 path 长度决定)
  avoidRoles?: string[]; // 需要避让的 Creep 角色列表
  ignoreCreeps?: boolean; // 是否忽略其他 Creep (默认 true，卡住时自动变为 false)
  maxOps?: number; // 寻路最大计算量
  flee?: boolean; // 是否是逃离模式 (PathFinder 不直接支持 flee，需反向目标)
};

// --- 辅助函数 ---

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

function getTerrainCosts(role: string | undefined): {
  plainCost: number;
  swampCost: number;
} {
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

/**
 * 将 PathFinder 找到的 RoomPosition 路径转换为方向字符串
 */
function pathPositionsToDirectionString(
  origin: RoomPosition,
  path: RoomPosition[],
): string {
  let result = "";
  let curr = origin;
  for (const next of path) {
    const dir = curr.getDirectionTo(next);
    result += dir;
    curr = next;
  }
  return result;
}

/**
 * 根据方向获取下一个坐标
 */
function getPositionAtDirection(
  pos: RoomPosition,
  direction: DirectionConstant,
): RoomPosition | null {
  const dx = [0, 0, 1, 1, 1, 0, -1, -1, -1][direction];
  const dy = [0, -1, -1, 0, 1, 1, 1, 0, -1][direction];
  const x = pos.x + dx;
  const y = pos.y + dy;

  if (x < 0 || x > 49 || y < 0 || y > 49) return null;
  return new RoomPosition(x, y, pos.roomName);
}

/**
 * 更新卡住和震荡状态
 */
function updateStuck(creep: Creep, mem: MoveMemory): number {
  const moved = mem.lastX !== creep.pos.x || mem.lastY !== creep.pos.y;

  // 维护位置历史 (最近 5 tick)
  if (!mem.posHistory) mem.posHistory = [];

  // 如果切换了房间，清空历史，防止坐标混淆
  if (mem.lastRoom && mem.lastRoom !== creep.pos.roomName) {
    mem.posHistory = [];
  }

  const packed = (creep.pos.x << 6) | creep.pos.y;

  // 如果移动了，检查是否进入环路
  if (moved) {
    if (mem.posHistory.includes(packed)) {
      mem.oscillateCount = (mem.oscillateCount ?? 0) + 1;
    } else if ((mem.oscillateCount ?? 0) > 0) {
      mem.oscillateCount = (mem.oscillateCount ?? 0) - 1;
    }
  }

  // 更新历史队列
  mem.posHistory.push(packed);
  if (mem.posHistory.length > 5) mem.posHistory.shift();

  if (
    mem.lastX === creep.pos.x &&
    mem.lastY === creep.pos.y &&
    creep.fatigue === 0
  ) {
    mem.stuckCount = (mem.stuckCount ?? 0) + 1;
  } else {
    if ((mem.stuckCount ?? 0) > 0) mem.stuckCount = (mem.stuckCount ?? 0) - 1;
    mem.prevRoom = mem.lastRoom;
    mem.prevX = mem.lastX;
    mem.prevY = mem.lastY;
    mem.lastRoom = creep.pos.roomName;
    mem.lastX = creep.pos.x;
    mem.lastY = creep.pos.y;
  }
  return mem.stuckCount ?? 0;
}

function requestLocalPush(creep: Creep, targetPos: RoomPosition | null): void {
  if (!targetPos) return;
  const dir = creep.pos.getDirectionTo(targetPos);
  const nextPos = getPositionAtDirection(creep.pos, dir);
  if (!nextPos) return;
  const blockers = nextPos.lookFor(LOOK_CREEPS);
  const obstacle = blockers.find((c) => c.my && c.id !== creep.id);
  if (obstacle) {
    TrafficManager.requestPush(creep, obstacle);
  }
}

// --- 主函数 ---

export function smartMove(
  creep: Creep,
  target: SmartMoveTarget,
  opts: SmartMoveOptions = {},
): ScreepsReturnCode {
  const mem = getMoveMemory(creep);
  const targetPos = getPos(target);
  const range = opts.range ?? 1;

  // 1. 状态更新
  const stuck = updateStuck(creep, mem);
  const oscillate = mem.oscillateCount ?? 0;

  // 2. 目标检查：如果目标变了，清空路径
  if (
    !mem.dest ||
    mem.dest.x !== targetPos.x ||
    mem.dest.y !== targetPos.y ||
    mem.dest.roomName !== targetPos.roomName
  ) {
    mem.path = undefined;
    mem.dest = { x: targetPos.x, y: targetPos.y, roomName: targetPos.roomName };
  }

  // 3. 拥堵模式判断 (滞回)
  if (stuck >= 2 || oscillate >= 1) {
    mem.congestionUntil = Game.time + 15;
  }
  const isCongested =
    (mem.congestionUntil && mem.congestionUntil > Game.time) ||
    stuck >= 2 ||
    oscillate >= 1;

  // 4. 寻路必要性检查
  let needRepath = false;

  if (!mem.path || mem.path.length === 0) {
    needRepath = true; // 无路径
  } else {
    // 检查路径首位是否匹配当前位置 (验证路径有效性)
    // 注意：PathFinder 的路径不包含起点，所以 mem.path[0] 是第一步的方向
    // 如果我们偏离了路径，也需要重寻
    // 这里简单处理：如果尝试移动但没动(stuck)，或者 oscillate，都视为需要重寻
    if (isCongested) {
      needRepath = true;
    }
  }

  // 5. 到达检查
  if (creep.pos.inRangeTo(targetPos, range)) {
    return OK;
  }

  // 6. 执行寻路 (如果需要)
  if (needRepath) {
    const role = creep.memory.role;
    const terrainCosts = getTerrainCosts(role);
    const avoidRoles = opts.avoidRoles ?? getDefaultAvoidRoles(role);
    const ignoreCreeps = isCongested ? false : (opts.ignoreCreeps ?? true);

    // 基础回调
    const trafficCallback = TrafficManager.getCallback(!ignoreCreeps);

    // 组合回调 (处理 oscillate 惩罚、角色避让等)
    const roomCallback = (roomName: string): CostMatrix | boolean => {
      // 路由限制
      let routeRooms: string[] | undefined;
      if (creep.room.name !== targetPos.roomName) {
        routeRooms = getRouteRooms(creep.room.name, targetPos.roomName, {
          avoidSK: true,
          preferHighway: true,
        });
        if (
          routeRooms.length > 0 &&
          !routeRooms.includes(roomName) &&
          roomName !== creep.room.name &&
          roomName !== targetPos.roomName
        ) {
          return false; // 不在路由上的房间直接跳过
        }
      }

      // 获取基础矩阵
      let costs = trafficCallback(roomName, new PathFinder.CostMatrix());

      // 额外处理：当前房间的震荡惩罚
      if (roomName === creep.room.name) {
        // 震荡位置惩罚
        if (oscillate >= 1 && mem.posHistory) {
          for (const packed of mem.posHistory) {
            const x = packed >> 6;
            const y = packed & 0x3f;
            const cur = costs.get(x, y);
            if (cur < 0xff) costs.set(x, y, Math.min(0xfe, Math.max(cur, 20)));
          }
        }

        // 角色避让
        if (avoidRoles.length > 0) {
          const creeps = StructureCache.getCreeps(Game.rooms[roomName]);
          for (const c of creeps) {
            if (avoidRoles.includes(c.memory.role))
              costs.set(c.pos.x, c.pos.y, 0xff);
          }
        }
      }

      return costs;
    };

    const ret = PathFinder.search(
      creep.pos,
      { pos: targetPos, range },
      {
        plainCost: terrainCosts.plainCost,
        swampCost: terrainCosts.swampCost,
        roomCallback,
        maxOps: opts.maxOps ?? (isCongested ? 4000 : 2000),
        maxRooms: 16,
      },
    );

    if (ret.incomplete && ret.path.length === 0) {
      // 寻路彻底失败
      mem.path = undefined;
    } else {
      // 序列化路径
      mem.path = pathPositionsToDirectionString(creep.pos, ret.path);
    }
  }

  // 7. 执行移动
  let moveResult: ScreepsReturnCode = OK;

  if (mem.path && mem.path.length > 0) {
    const direction = parseInt(mem.path[0], 10) as DirectionConstant;
    moveResult = creep.move(direction);

    if (moveResult === OK) {
      mem.path = mem.path.slice(1); // 移除已走的一步

      // 尝试推挤
      if (isCongested || stuck > 0) {
        const nextPos = getPositionAtDirection(creep.pos, direction);
        if (nextPos) requestLocalPush(creep, nextPos);
      }
    }
  } else {
    moveResult = ERR_NO_PATH;
  }

  // 8. 统计与日志
  TrafficManager.recordMoveSample({
    creep,
    stuck,
    oscillate,
    result: moveResult,
    targetPos,
  });

  // 9. 绝境脱困 (Random Move)
  if (moveResult === ERR_NO_PATH && stuck >= 5) {
    const spots: RoomPosition[] = [];
    const terrain = creep.room.getTerrain();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = creep.pos.x + dx;
        const y = creep.pos.y + dy;
        if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

        const pos = new RoomPosition(x, y, creep.room.name);
        if (pos.lookFor(LOOK_CREEPS).length > 0) continue;
        if (
          pos
            .lookFor(LOOK_STRUCTURES)
            .some(
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
      let bestSpot = spots[0];
      if (targetPos) {
        spots.sort((a, b) => a.getRangeTo(targetPos) - b.getRangeTo(targetPos));
        const candidates = spots.slice(0, 3);
        bestSpot = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        bestSpot = spots[Math.floor(Math.random() * spots.length)];
      }
      creep.move(creep.pos.getDirectionTo(bestSpot));
      return OK;
    }
  }

  return moveResult;
}
