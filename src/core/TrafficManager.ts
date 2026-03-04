import { Cache } from "./Cache";

interface CostCache {
  matrix: CostMatrix;
  time: number;
}

type TrafficRoomTelemetry = {
  stuckSamples: number;
  severeStuckSamples: number;
  oscillateSamples: number;
  noPathCount: number;
  pushRequests: number;
  pushSuccess: number;
  pushFallbackSuccess: number;
  yieldMoves: number;
  maxStuck: number;
  maxOscillate: number;
  lastStuckPos?: string;
  lastStuckCreep?: string;
  lastTargetPos?: string;
};

type TrafficTelemetry = {
  time: number;
  moveSamples: number;
  stuckSamples: number;
  severeStuckSamples: number;
  oscillateSamples: number;
  noPathCount: number;
  pushRequests: number;
  pushSuccess: number;
  pushFallbackSuccess: number;
  yieldMoves: number;
  rooms: Record<string, TrafficRoomTelemetry>;
};

type MoveSample = {
  creep: Creep;
  stuck: number;
  oscillate: number;
  result: ScreepsReturnCode;
  targetPos?: RoomPosition;
};

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
  private static costs: { [roomName: string]: CostCache } = {};
  private static callbackCosts: { [key: string]: CostCache } = {};
  private static pushRequests: { pusher: Creep; target: Creep }[] = [];
  private static pushRequestKeys = new Set<string>();
  private static recentPushUntil: { [targetId: string]: number } = {};
  private static telemetry: TrafficTelemetry | undefined;
  private static readonly HEAT_DECAY_STEP = 5;
  private static readonly HEAT_DECAY_AMOUNT = 1;
  private static readonly HEAT_MAX = 60;
  private static readonly ROLE_PRIORITY: Record<string, number> = {
    distributor: 100,
    hauler: 95,
    remoteHauler: 92,
    miner: 80,
    remoteHarvester: 78,
    reserver: 75,
    defender: 74,
    keeperKiller: 74,
    keeperHealer: 72,
    worker: 50,
    upgrader: 45,
    scout: 35,
  };

  private static createRoomTelemetry(): TrafficRoomTelemetry {
    return {
      stuckSamples: 0,
      severeStuckSamples: 0,
      oscillateSamples: 0,
      noPathCount: 0,
      pushRequests: 0,
      pushSuccess: 0,
      pushFallbackSuccess: 0,
      yieldMoves: 0,
      maxStuck: 0,
      maxOscillate: 0,
    };
  }

  private static createTelemetry(): TrafficTelemetry {
    return {
      time: Game.time,
      moveSamples: 0,
      stuckSamples: 0,
      severeStuckSamples: 0,
      oscillateSamples: 0,
      noPathCount: 0,
      pushRequests: 0,
      pushSuccess: 0,
      pushFallbackSuccess: 0,
      yieldMoves: 0,
      rooms: {},
    };
  }

  private static ensureTelemetry(): TrafficTelemetry {
    if (!this.telemetry || this.telemetry.time !== Game.time) {
      this.telemetry = this.createTelemetry();
    }
    return this.telemetry;
  }

  private static roomTelemetry(roomName: string): TrafficRoomTelemetry {
    const telemetry = this.ensureTelemetry();
    if (!telemetry.rooms[roomName]) {
      telemetry.rooms[roomName] = this.createRoomTelemetry();
    }
    return telemetry.rooms[roomName];
  }

  public static recordMoveSample(sample: MoveSample): void {
    const telemetry = this.ensureTelemetry();
    const roomName = sample.creep.room.name;
    const room = this.roomTelemetry(roomName);
    telemetry.moveSamples += 1;
    if (sample.stuck > 0) {
      telemetry.stuckSamples += 1;
      room.stuckSamples += 1;
      room.maxStuck = Math.max(room.maxStuck, sample.stuck);
      room.lastStuckPos = `${sample.creep.pos.x}:${sample.creep.pos.y}`;
      room.lastStuckCreep = sample.creep.name;
      if (sample.stuck >= 5) {
        telemetry.severeStuckSamples += 1;
        room.severeStuckSamples += 1;
      }
    }
    if (sample.oscillate > 0) {
      telemetry.oscillateSamples += 1;
      room.oscillateSamples += 1;
      room.maxOscillate = Math.max(room.maxOscillate, sample.oscillate);
    }
    if (sample.result === ERR_NO_PATH) {
      telemetry.noPathCount += 1;
      room.noPathCount += 1;
    }
    if (sample.targetPos) {
      room.lastTargetPos = `${sample.targetPos.roomName}:${sample.targetPos.x}:${sample.targetPos.y}`;
    }
  }

  public static getTelemetrySnapshot(): TrafficTelemetry {
    const telemetry = this.ensureTelemetry();
    const rooms: Record<string, TrafficRoomTelemetry> = {};
    for (const roomName in telemetry.rooms) {
      rooms[roomName] = { ...telemetry.rooms[roomName] };
    }
    return {
      ...telemetry,
      rooms,
    };
  }

  private static parseHeatKey(key: string): { x: number; y: number } | null {
    const parts = key.split(":");
    if (parts.length !== 2) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 49 || y < 0 || y > 49) return null;
    return { x, y };
  }

  private static applyHeat(roomName: string, costs: CostMatrix): CostMatrix {
    const room = Game.rooms[roomName];
    if (!room) return costs;
    const traffic = room.memory.traffic;
    if (!traffic?.heat) return costs;

    if (!traffic.lastPrune || Game.time - traffic.lastPrune >= 25) {
      for (const key in traffic.heat) {
        const cell = traffic.heat[key];
        const elapsed = Game.time - cell.updatedAt;
        const decay =
          Math.floor(elapsed / this.HEAT_DECAY_STEP) * this.HEAT_DECAY_AMOUNT;
        const next = cell.value - decay;
        if (next <= 0) {
          delete traffic.heat[key];
          continue;
        }
        cell.value = next;
        cell.updatedAt = Game.time;
      }
      traffic.lastPrune = Game.time;
    }

    for (const key in traffic.heat) {
      const pos = this.parseHeatKey(key);
      if (!pos) continue;
      const current = costs.get(pos.x, pos.y);
      if (current >= 0xff) continue;
      const heat = Math.min(20, traffic.heat[key].value);
      costs.set(pos.x, pos.y, Math.min(0xfe, current + heat));
    }

    return costs;
  }

  public static recordCongestion(pos: RoomPosition, amount = 3): void {
    const room = Game.rooms[pos.roomName];
    if (!room) return;
    room.memory.traffic = room.memory.traffic ?? {};
    room.memory.traffic.heat = room.memory.traffic.heat ?? {};
    const key = `${pos.x}:${pos.y}`;
    const current = room.memory.traffic.heat[key];
    if (!current) {
      room.memory.traffic.heat[key] = {
        value: Math.min(this.HEAT_MAX, amount),
        updatedAt: Game.time,
      };
      return;
    }
    current.value = Math.min(this.HEAT_MAX, current.value + amount);
    current.updatedAt = Game.time;
  }

  /**
   * 获取阻挡者位置 (所有 Creep 和 PowerCreep)
   * 用于在寻路时避让所有 Creep
   */
  private static getBlockingPositions(
    roomName: string,
  ): Array<{ x: number; y: number }> {
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
  public static getCostMatrix(
    roomName: string,
    fresh = false,
    clone = true,
  ): CostMatrix {
    if (
      !fresh &&
      this.costs[roomName] &&
      Game.time - this.costs[roomName].time < 100
    ) {
      return clone
        ? this.costs[roomName].matrix.clone()
        : this.costs[roomName].matrix;
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

    const terrain = room.getTerrain();
    for (let x = 1; x <= 48; x++) {
      for (let y = 1; y <= 48; y++) {
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const current = costs.get(x, y);
        if (current !== 0) continue;
        let penalty = 0;
        if (x <= 1 || x >= 48 || y <= 1 || y >= 48) penalty += 4;
        let nearWall = false;
        for (let dx = -1; dx <= 1 && !nearWall; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            if (terrain.get(x + dx, y + dy) === TERRAIN_MASK_WALL) {
              nearWall = true;
              break;
            }
          }
        }
        if (nearWall) penalty += 2;
        if (penalty > 0) costs.set(x, y, Math.min(0xfe, current + penalty));
      }
    }

    this.costs[roomName] = { matrix: costs, time: Game.time };
    return clone ? costs.clone() : costs;
  }

  public static getCallback(
    avoidCreeps = false,
  ): (roomName: string, costs: CostMatrix) => CostMatrix {
    return (roomName: string, _costs: CostMatrix): CostMatrix => {
      const cacheKey = `${roomName}:${avoidCreeps ? 1 : 0}`;
      const hit = this.callbackCosts[cacheKey];
      if (hit && hit.time === Game.time) return hit.matrix.clone();

      const costs = this.getCostMatrix(roomName, false, false).clone();
      if (avoidCreeps) {
        const blockers = this.getBlockingPositions(roomName);
        for (const p of blockers) costs.set(p.x, p.y, 0xff);
      }
      this.applyHeat(roomName, costs);
      this.callbackCosts[cacheKey] = { matrix: costs, time: Game.time };
      return costs.clone();
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
    const reqKey = `${Game.time}:${pusher.id}:${target.id}`;
    if (this.pushRequestKeys.has(reqKey)) return;
    this.pushRequestKeys.add(reqKey);
    this.pushRequests.push({ pusher, target });
    const telemetry = this.ensureTelemetry();
    telemetry.pushRequests += 1;
    this.roomTelemetry(pusher.room.name).pushRequests += 1;
  }

  private static isWalkableAndFree(pos: RoomPosition): boolean {
    const terrain = Game.map.getRoomTerrain(pos.roomName);
    if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;
    const creeps = pos.lookFor(LOOK_CREEPS);
    if (creeps.length > 0) return false;
    const powerCreeps = pos.lookFor(LOOK_POWER_CREEPS);
    if (powerCreeps.length > 0) return false;
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
      return false;
    return true;
  }

  private static getPosAtDirection(
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

  private static getRolePriority(role: string | undefined): number {
    if (!role) return 50;
    return this.ROLE_PRIORITY[role] ?? 50;
  }

  private static countPassableNeighbors(pos: RoomPosition): number {
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
        if (this.isWalkableAndFree(new RoomPosition(x, y, pos.roomName)))
          count++;
      }
    }
    return count;
  }

  private static isSingleLaneConflict(pusher: Creep, target: Creep): boolean {
    const p = this.countPassableNeighbors(pusher.pos);
    const t = this.countPassableNeighbors(target.pos);
    return p <= 2 || t <= 2;
  }

  private static applyTrafficAvoidMark(creep: Creep): void {
    const mem = creep.memory as unknown as {
      _traffic?: {
        avoidX?: number;
        avoidY?: number;
        avoidRoom?: string;
        avoidUntil?: number;
      };
    };
    if (!mem._traffic) mem._traffic = {};
    mem._traffic.avoidX = creep.pos.x;
    mem._traffic.avoidY = creep.pos.y;
    mem._traffic.avoidRoom = creep.room.name;
    mem._traffic.avoidUntil = Game.time + 3;
  }

  private static tryYield(ceder: Creep, other: Creep): boolean {
    const backDir = other.pos.getDirectionTo(ceder.pos);
    const backPos = this.getPosAtDirection(ceder.pos, backDir);
    if (backPos && this.isWalkableAndFree(backPos)) {
      this.applyTrafficAvoidMark(ceder);
      ceder.move(backDir);
      this.recentPushUntil[ceder.id] = Game.time + 2;
      const telemetry = this.ensureTelemetry();
      telemetry.yieldMoves += 1;
      this.roomTelemetry(ceder.room.name).yieldMoves += 1;
      return true;
    }
    return false;
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
      if (processed.has(pusher.id)) continue;

      const pusherPriority = this.getRolePriority(pusher.memory.role);
      const targetPriority = this.getRolePriority(target.memory.role);
      if (
        this.isSingleLaneConflict(pusher, target) &&
        pusherPriority < targetPriority
      ) {
        if (this.tryYield(pusher, target)) {
          processed.add(pusher.id);
          continue;
        }
      }

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
        spots.sort((a, b) => {
          const da = a.getRangeTo(pusher.pos);
          const db = b.getRangeTo(pusher.pos);
          return db - da;
        });
        const spot = spots[0];
        this.applyTrafficAvoidMark(target);
        target.move(target.pos.getDirectionTo(spot));
        this.recentPushUntil[target.id] = Game.time + 2;
        processed.add(target.id);
        const telemetry = this.ensureTelemetry();
        telemetry.pushSuccess += 1;
        this.roomTelemetry(target.room.name).pushSuccess += 1;
      } else {
        const awayDir = pusher.pos.getDirectionTo(target.pos);
        const fallback = this.getPosAtDirection(target.pos, awayDir);
        if (fallback && this.isWalkableAndFree(fallback)) {
          this.applyTrafficAvoidMark(target);
          target.move(awayDir);
          this.recentPushUntil[target.id] = Game.time + 2;
          processed.add(target.id);
          const telemetry = this.ensureTelemetry();
          telemetry.pushSuccess += 1;
          telemetry.pushFallbackSuccess += 1;
          const room = this.roomTelemetry(target.room.name);
          room.pushSuccess += 1;
          room.pushFallbackSuccess += 1;
        } else if (
          this.isSingleLaneConflict(pusher, target) &&
          pusherPriority < targetPriority
        ) {
          if (this.tryYield(pusher, target)) {
            processed.add(pusher.id);
          }
        }
      }
    }
    this.pushRequests = [];
    this.pushRequestKeys.clear();
  }
}
