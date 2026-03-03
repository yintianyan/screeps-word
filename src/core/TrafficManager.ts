import { Cache } from "./Cache";

interface CostCache {
  matrix: CostMatrix;
  time: number;
}

/**
 * 交通管理器
 * 
 * 负责处理 Creep 之间的避让和推挤 (Pushing)。
 * 
 * 主要功能：
 * 1. 维护房间的基础 CostMatrix (地形 + 道路 + 结构)。
 * 2. 处理 Creep 的推挤请求：当一个 Creep 挡路时，尝试将其推到旁边的空闲位置。
 * 3. 提供 CostMatrix 回调，用于 PathFinder。
 */
export class TrafficManager {
  // 缓存房间的 CostMatrix，有效期 100 tick
  private static costs: { [roomName: string]: CostCache } = {};
  // 待处理的推挤请求队列
  private static pushRequests: { pusher: Creep; target: Creep }[] = [];
  // 记录 Creep 最近被推挤的时间，防止短时间内反复被推
  private static recentPushUntil: { [targetId: string]: number } = {};

  /**
   * 获取阻挡者位置 (所有 Creep 和 PowerCreep)
   * 用于在寻路时避让所有 Creep
   */
  private static getBlockingPositions(roomName: string): Array<{ x: number; y: number }> {
    return Cache.getTick(`tm:blockers:${roomName}`, () => {
      const room = Game.rooms[roomName];
      if (!room) return [];
      const result: Array<{ x: number; y: number }> = [];
      const creeps = room.find(FIND_CREEPS);
      for (const c of creeps) result.push({ x: c.pos.x, y: c.pos.y });
      const powerCreeps = room.find(FIND_POWER_CREEPS);
      for (const c of powerCreeps) result.push({ x: c.pos.x, y: c.pos.y });
      return result;
    });
  }

  /**
   * 获取房间的基础 CostMatrix
   * 包含地形、道路(1)、容器(2)和 Rampart(2) 的成本。
   * 其他不可行走结构设为 0xff。
   */
  public static getCostMatrix(roomName: string, fresh = false): CostMatrix {
    if (
      !fresh &&
      this.costs[roomName] &&
      Game.time - this.costs[roomName].time < 100
    ) {
      return this.costs[roomName].matrix.clone();
    }

    const room = Game.rooms[roomName];
    if (!room) return new PathFinder.CostMatrix();

    const costs = new PathFinder.CostMatrix();

    room.find(FIND_STRUCTURES).forEach((s) => {
      if (s.structureType === STRUCTURE_ROAD) {
        costs.set(s.pos.x, s.pos.y, 1);
      } else if (s.structureType === STRUCTURE_CONTAINER) {
        costs.set(s.pos.x, s.pos.y, 2);
      } else if (
        s.structureType === STRUCTURE_RAMPART &&
        ((s as StructureRampart).my || (s as StructureRampart).isPublic)
      ) {
        costs.set(s.pos.x, s.pos.y, 2);
      } else {
        costs.set(s.pos.x, s.pos.y, 0xff);
      }
    });

    this.costs[roomName] = { matrix: costs, time: Game.time };
    return costs.clone();
  }

  public static getCallback(
    avoidCreeps = false,
  ): (roomName: string, costs: CostMatrix) => CostMatrix {
    return (roomName: string, _costs: CostMatrix): CostMatrix => {
      const costs = this.getCostMatrix(roomName).clone();
      
      if (avoidCreeps) {
        const blockers = this.getBlockingPositions(roomName);
        for (const p of blockers) costs.set(p.x, p.y, 0xff);
      }
      return costs;
    };
  }

  /**
   * 提交推挤请求
   * 
   * 当 Creep A 想走到 Creep B 的位置时调用。
   * 如果 Creep B 最近刚被推过 (冷却中)，则忽略请求。
   */
  public static requestPush(pusher: Creep, target: Creep) {
    const until = this.recentPushUntil[target.id];
    if (typeof until === "number" && until >= Game.time) return;
    this.pushRequests.push({ pusher, target });
  }

  /**
   * 处理所有推挤请求 (在 tick 结尾调用)
   * 
   * 逻辑：
   * 1. 遍历请求队列。
   * 2. 为目标 Creep 寻找一个旁边的空闲位置 (Road/Container/Rampart 优先)。
   * 3. 优先选择“远离推挤者”的位置，避免推到推挤者的路径上。
   * 4. 移动目标 Creep，并设置临时避让内存 (防止它立刻走回原位)。
   */
  public static run() {
    const processed = new Set<string>();
    for (const id in this.recentPushUntil) {
      if (this.recentPushUntil[id] < Game.time) delete this.recentPushUntil[id];
    }

    for (const { pusher, target } of this.pushRequests) {
        if (processed.has(target.id)) continue;
        if (target.fatigue > 0 || target.spawning) continue;
        
        const terrain = target.room.getTerrain();
        const spots: RoomPosition[] = [];
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = target.pos.x + dx;
                const y = target.pos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                
                const pos = new RoomPosition(x, y, target.room.name);
                
                const creeps = pos.lookFor(LOOK_CREEPS);
                if (creeps.length > 0) continue;
                
                const structures = pos.lookFor(LOOK_STRUCTURES);
                if (structures.some(s => 
                    s.structureType !== STRUCTURE_ROAD && 
                    s.structureType !== STRUCTURE_CONTAINER && 
                    (s.structureType !== STRUCTURE_RAMPART || !(s as StructureRampart).my)
                )) continue;

                spots.push(pos);
            }
        }
        
        if (spots.length > 0) {
            spots.sort((a, b) => {
              const da = a.getRangeTo(pusher.pos);
              const db = b.getRangeTo(pusher.pos);
              return db - da;
            });
            const spot = spots[0];
            const mem = target.memory as unknown as {
              _traffic?: {
                avoidX?: number;
                avoidY?: number;
                avoidRoom?: string;
                avoidUntil?: number;
              };
            };
            if (!mem._traffic) mem._traffic = {};
            mem._traffic.avoidX = target.pos.x;
            mem._traffic.avoidY = target.pos.y;
            mem._traffic.avoidRoom = target.room.name;
            mem._traffic.avoidUntil = Game.time + 3;
            target.move(target.pos.getDirectionTo(spot));
            this.recentPushUntil[target.id] = Game.time + 2;
            processed.add(target.id);
        }
    }
    this.pushRequests = [];
  }
}
