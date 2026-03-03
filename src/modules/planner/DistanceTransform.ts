/**
 * 距离变换算法 (Distance Transform)
 * 
 * 用于计算地图上每个点到最近墙壁或出口的距离。
 * 
 * 用途：
 * 1. 寻找开阔地带作为基地核心 (Anchor)。
 * 2. 评估防御塔的覆盖范围。
 * 
 * 实现：
 * 使用切比雪夫距离 (Chebyshev distance) 进行两遍扫描 (Two-pass algorithm) 或 BFS。
 * 这里实现了一个基于 BFS 的变种。
 */

type Pos = { x: number; y: number };

type CacheEntry = {
  tick: number;
  anchor: Pos | null;
};

const cache: Record<string, CacheEntry> = {};

function idx(x: number, y: number): number {
  return y * 50 + x;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x <= 49 && y >= 0 && y <= 49;
}

function computeDistancesToWall(room: Room): Uint8Array {
  const terrain = room.getTerrain();
  const dist = new Uint8Array(50 * 50);
  dist.fill(255);

  const qx: number[] = [];
  const qy: number[] = [];

  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        dist[idx(x, y)] = 0;
        qx.push(x);
        qy.push(y);
      }
    }
  }

  for (let qi = 0; qi < qx.length; qi++) {
    const x = qx[qi];
    const y = qy[qi];
    const d = dist[idx(x, y)];
    const nd = d + 1;
    if (nd >= 255) continue;

    const n = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const p of n) {
      if (!inBounds(p.x, p.y)) continue;
      const i = idx(p.x, p.y);
      if (dist[i] <= nd) continue;
      dist[i] = nd;
      qx.push(p.x);
      qy.push(p.y);
    }
  }

  return dist;
}

function computeDistancesToExit(room: Room): Uint8Array {
  const terrain = room.getTerrain();
  const dist = new Uint8Array(50 * 50);
  dist.fill(255);

  const qx: number[] = [];
  const qy: number[] = [];

  for (let i = 0; i < 50; i++) {
    const edge: Pos[] = [
      { x: i, y: 0 },
      { x: i, y: 49 },
      { x: 0, y: i },
      { x: 49, y: i },
    ];
    for (const p of edge) {
      if (terrain.get(p.x, p.y) === TERRAIN_MASK_WALL) continue;
      const j = idx(p.x, p.y);
      if (dist[j] === 0) continue;
      dist[j] = 0;
      qx.push(p.x);
      qy.push(p.y);
    }
  }

  for (let qi = 0; qi < qx.length; qi++) {
    const x = qx[qi];
    const y = qy[qi];
    const d = dist[idx(x, y)];
    const nd = d + 1;
    if (nd >= 255) continue;

    const n = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const p of n) {
      if (!inBounds(p.x, p.y)) continue;
      if (terrain.get(p.x, p.y) === TERRAIN_MASK_WALL) continue;
      const i = idx(p.x, p.y);
      if (dist[i] <= nd) continue;
      dist[i] = nd;
      qx.push(p.x);
      qy.push(p.y);
    }
  }

  return dist;
}

function scoreAnchor(room: Room, x: number, y: number, wall: Uint8Array, exit: Uint8Array): number {
  const controller = room.controller;
  const dc =
    controller ? Math.abs(controller.pos.x - x) + Math.abs(controller.pos.y - y) : 25;
  const dw = wall[idx(x, y)];
  const de = exit[idx(x, y)];
  const sw = Math.min(dw, 10);
  const se = Math.min(de, 10);
  return sw * 5 + se * 3 - Math.floor(dc / 3);
}

/**
 * 寻找核心锚点
 * 
 * 结合墙壁距离和出口距离，评分选择最适合作为基地中心的位置。
 * 偏好：远离墙壁，远离出口，靠近 Controller。
 * 
 * @param room 目标房间
 * @param ttl 缓存有效期 (默认 2000 tick)
 */
export function findCoreAnchor(room: Room, ttl = 2000): Pos | null {
  const cached = cache[room.name];
  if (cached && Game.time - cached.tick < ttl) return cached.anchor;

  const terrain = room.getTerrain();
  const wall = computeDistancesToWall(room);
  const exit = computeDistancesToExit(room);

  let best: Pos | null = null;
  let bestScore = -999999;

  for (let y = 2; y <= 47; y++) {
    for (let x = 2; x <= 47; x++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      const dw = wall[idx(x, y)];
      const de = exit[idx(x, y)];
      if (dw < 2 || de < 3) continue;

      const score = scoreAnchor(room, x, y, wall, exit);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }

  cache[room.name] = { tick: Game.time, anchor: best };
  return best;
}
