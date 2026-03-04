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

  const queue = new Int16Array(50 * 50 * 2);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        dist[idx(x, y)] = 0;
        queue[tail++] = x;
        queue[tail++] = y;
      }
    }
  }

  const dirs = [-1, 0, 1, 0, 0, -1, 0, 1];

  while (head < tail) {
    const x = queue[head++];
    const y = queue[head++];
    const d = dist[idx(x, y)];
    const nd = d + 1;
    if (nd >= 255) continue;

    for (let di = 0; di < 8; di += 2) {
      const nx = x + dirs[di];
      const ny = y + dirs[di + 1];
      if (!inBounds(nx, ny)) continue;
      const i = idx(nx, ny);
      if (dist[i] <= nd) continue;
      dist[i] = nd;
      queue[tail++] = nx;
      queue[tail++] = ny;
    }
  }

  return dist;
}

function computeDistancesToExit(room: Room): Uint8Array {
  const terrain = room.getTerrain();
  const dist = new Uint8Array(50 * 50);
  dist.fill(255);

  const queue = new Int16Array(50 * 50 * 2);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < 50; i++) {
    const edges = [
      { x: i, y: 0 },
      { x: i, y: 49 },
      { x: 0, y: i },
      { x: 49, y: i },
    ];
    for (let ei = 0; ei < edges.length; ei++) {
      const p = edges[ei];
      if (terrain.get(p.x, p.y) === TERRAIN_MASK_WALL) continue;
      const j = idx(p.x, p.y);
      if (dist[j] === 0) continue;
      dist[j] = 0;
      queue[tail++] = p.x;
      queue[tail++] = p.y;
    }
  }

  const dirs = [-1, 0, 1, 0, 0, -1, 0, 1];

  while (head < tail) {
    const x = queue[head++];
    const y = queue[head++];
    const d = dist[idx(x, y)];
    const nd = d + 1;
    if (nd >= 255) continue;

    for (let di = 0; di < 8; di += 2) {
      const nx = x + dirs[di];
      const ny = y + dirs[di + 1];
      if (!inBounds(nx, ny)) continue;
      if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
      const i = idx(nx, ny);
      if (dist[i] <= nd) continue;
      dist[i] = nd;
      queue[tail++] = nx;
      queue[tail++] = ny;
    }
  }

  return dist;
}

function scoreAnchor(
  room: Room,
  x: number,
  y: number,
  wall: Uint8Array,
  exit: Uint8Array,
): number {
  const controller = room.controller;
  const dc = controller
    ? Math.abs(controller.pos.x - x) + Math.abs(controller.pos.y - y)
    : 25;
  const dw = wall[idx(x, y)];
  const de = exit[idx(x, y)];
  const sw = Math.min(dw, 10);
  const se = Math.min(de, 10);
  return sw * 5 + se * 3 - Math.floor(dc / 3);
}

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
      if (dw < 6 || de < 4) continue;

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
