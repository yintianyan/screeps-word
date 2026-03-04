export type LayoutName = "stamp" | "bunker" | "atlas" | "auto";

export type LayoutTemplate = {
  buildings: Record<string, { x: number; y: number }[]>;
};

const autoLayoutCache: Record<
  string,
  { anchor: string; template: LayoutTemplate; time: number }
> = {};

function getTerrainAt(room: Room, x: number, y: number): number {
  return room.getTerrain().get(x, y);
}

function generateAutoLayout(
  room: Room,
  anchor: { x: number; y: number },
): LayoutTemplate {
  // 1. 复用 Atlas 的核心建筑 (除 Extension/Road)
  const template: LayoutTemplate = {
    buildings: {
      [STRUCTURE_EXTENSION]: [],
      [STRUCTURE_ROAD]: [],
    },
  };

  // 复制核心建筑并标记占用
  const reserved = new Set<string>();
  const coreTypes = [
    STRUCTURE_SPAWN,
    STRUCTURE_STORAGE,
    STRUCTURE_TERMINAL,
    STRUCTURE_LINK,
    STRUCTURE_TOWER,
    STRUCTURE_LAB,
    STRUCTURE_FACTORY,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_NUKER,
    STRUCTURE_OBSERVER,
  ];

  for (const type of coreTypes) {
    const coords = atlas.buildings[type] || [];
    template.buildings[type] = [...coords];
    for (const c of coords) {
      reserved.add(`${c.x},${c.y}`);
    }
  }

  // 2. 泛洪填充 Extension 和 Road
  // 使用 BFS
  const queue: { x: number; y: number; dist: number }[] = [
    { x: 0, y: 0, dist: 0 },
  ];
  const visited = new Set<string>(["0,0"]);
  const extensions: { x: number; y: number }[] = [];
  const roads: { x: number; y: number }[] = [];

  // 核心区预留道路 (Atlas 核心区的路)
  const coreRoads = atlas.buildings[STRUCTURE_ROAD] || [];
  for (const r of coreRoads) {
    // 只保留核心范围内的路 (比如距离中心 <= 6)
    if (Math.abs(r.x) <= 6 && Math.abs(r.y) <= 6) {
      roads.push(r);
      reserved.add(`${r.x},${r.y}`);
      // 将核心路加入 BFS 起点
      if (!visited.has(`${r.x},${r.y}`)) {
        visited.add(`${r.x},${r.y}`);
        queue.push({ x: r.x, y: r.y, dist: Math.abs(r.x) + Math.abs(r.y) });
      }
    }
  }

  // 添加核心建筑周边作为起点
  for (const type of coreTypes) {
    const coords = template.buildings[type] || [];
    for (const c of coords) {
      if (!visited.has(`${c.x},${c.y}`)) {
        visited.add(`${c.x},${c.y}`);
        queue.push({ x: c.x, y: c.y, dist: Math.abs(c.x) + Math.abs(c.y) });
      }
    }
  }

  let extensionCount = 0;
  const MAX_EXTENSIONS = 60;

  while (queue.length > 0 && extensionCount < MAX_EXTENSIONS) {
    const curr = queue.shift()!;

    // 检查四周
    const neighbors = [
      { x: curr.x + 1, y: curr.y },
      { x: curr.x - 1, y: curr.y },
      { x: curr.x, y: curr.y + 1 },
      { x: curr.x, y: curr.y - 1 },
    ];

    for (const n of neighbors) {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      // 绝对坐标检查地形
      const absX = anchor.x + n.x;
      const absY = anchor.y + n.y;

      if (absX < 2 || absX > 47 || absY < 2 || absY > 47) continue;
      if (getTerrainAt(room, absX, absY) === TERRAIN_MASK_WALL) continue;

      // 检查是否被核心建筑占用
      if (reserved.has(key)) continue;

      // 棋盘格逻辑
      // (0,0) 是偶数。
      // 如果 (x+y) 是偶数 -> 路
      // 如果 (x+y) 是奇数 -> Extension
      const isEven = (n.x + n.y) % 2 === 0;

      if (!isEven) {
        // Extension 位
        extensions.push(n);
        extensionCount++;
        // Extension 也是通路的一部分（Creep可以走），但为了 BFS 扩散，我们主要靠路
        // 这里把 Extension 也加入队列，允许“穿过”Extension 继续找
        queue.push({ x: n.x, y: n.y, dist: curr.dist + 1 });
      } else {
        // Road 位
        roads.push(n);
        queue.push({ x: n.x, y: n.y, dist: curr.dist + 1 });
      }
    }
  }

  // 按照距离排序，保证建造顺序由内而外
  extensions.sort(
    (a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)),
  );
  roads.sort(
    (a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)),
  );

  template.buildings[STRUCTURE_EXTENSION] = extensions;
  // 合并核心路和新生成的路
  const uniqueRoads = new Set<string>();
  const finalRoads = [];
  for (const r of [...roads]) {
    // 核心路已经在 roads 里了(如果有的话)
    const k = `${r.x},${r.y}`;
    if (!uniqueRoads.has(k)) {
      uniqueRoads.add(k);
      finalRoads.push(r);
    }
  }
  template.buildings[STRUCTURE_ROAD] = finalRoads;

  // 3. 动态添加 Links (Sources & Controller)
  template.buildings[STRUCTURE_LINK] = template.buildings[STRUCTURE_LINK] || [];
  const linkPosSet = new Set<string>();
  template.buildings[STRUCTURE_LINK].forEach((l) =>
    linkPosSet.add(`${l.x},${l.y}`),
  );

  // Controller Link
  if (room.controller) {
    const cPos = room.controller.pos;
    // Find a spot range 2 from controller, not wall
    const candidates = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
          // range 2
          const absX = cPos.x + dx;
          const absY = cPos.y + dy;
          if (getTerrainAt(room, absX, absY) !== TERRAIN_MASK_WALL) {
            candidates.push({ x: absX - anchor.x, y: absY - anchor.y });
          }
        }
      }
    }
    // Sort by dist to anchor (Descending to put link behind source, avoiding roads)
    candidates.sort(
      (a, b) => Math.abs(b.x) + Math.abs(b.y) - (Math.abs(a.x) + Math.abs(a.y)),
    );
    if (candidates.length > 0) {
      const best = candidates[0];
      const k = `${best.x},${best.y}`;
      if (!linkPosSet.has(k)) {
        template.buildings[STRUCTURE_LINK].push(best);
        linkPosSet.add(k);
      }
    }
  }

  // Source Links
  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    const sPos = source.pos;
    const candidates = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
          // range 2
          const absX = sPos.x + dx;
          const absY = sPos.y + dy;
          if (getTerrainAt(room, absX, absY) !== TERRAIN_MASK_WALL) {
            candidates.push({ x: absX - anchor.x, y: absY - anchor.y });
          }
        }
      }
    }
    // Sort by dist to anchor (Descending to put link behind source, avoiding roads)
    candidates.sort(
      (a, b) => Math.abs(b.x) + Math.abs(b.y) - (Math.abs(a.x) + Math.abs(a.y)),
    );
    if (candidates.length > 0) {
      const best = candidates[0];
      const k = `${best.x},${best.y}`;
      if (!linkPosSet.has(k)) {
        template.buildings[STRUCTURE_LINK].push(best);
        linkPosSet.add(k);
      }
    }
  }

  // 4. 自动防御：为核心建筑添加 Rampart
  template.buildings[STRUCTURE_RAMPART] = [];
  const rampartSet = new Set<string>();

  // Protect Core Structures + Controller Link
  const protectTypes = [
    STRUCTURE_SPAWN,
    STRUCTURE_STORAGE,
    STRUCTURE_TERMINAL,
    STRUCTURE_TOWER,
    STRUCTURE_LAB,
    STRUCTURE_FACTORY,
    STRUCTURE_NUKER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_OBSERVER,
    STRUCTURE_LINK, // Include all links (Hub + Source + Controller)
  ];

  for (const type of protectTypes) {
    const coords = template.buildings[type] || [];
    for (const c of coords) {
      const k = `${c.x},${c.y}`;
      if (!rampartSet.has(k)) {
        template.buildings[STRUCTURE_RAMPART].push(c);
        rampartSet.add(k);
      }
    }
  }

  return template;
}

export function getPlannedStructures(
  room: Room,
  rcl: number,
  layout: LayoutName,
  anchor: { x: number; y: number },
): PlannedStructure[] {
  let tpl: LayoutTemplate;

  if (layout === "auto") {
    const cacheKey = `${room.name}:${anchor.x},${anchor.y}`;
    const cached = autoLayoutCache[room.name];

    // 缓存有效性：Anchor 没变且不超过 1000 tick (避免地形变化? 地形通常不变，主要是为了清理内存)
    // 实际上地形不变，只要 Anchor 不变，layout 就不变。
    if (cached && cached.anchor === `${anchor.x},${anchor.y}`) {
      tpl = cached.template;
    } else {
      tpl = generateAutoLayout(room, anchor);
      autoLayoutCache[room.name] = {
        anchor: `${anchor.x},${anchor.y}`,
        template: tpl,
        time: Game.time,
      };
    }
  } else {
    tpl = Layouts[layout];
  }

  const out: PlannedStructure[] = [];

  for (const type in tpl.buildings) {
    const structType = type as BuildableStructureConstant;
    let limit = CONTROLLER_STRUCTURES[structType][rcl] ?? 0;
    if (structType === STRUCTURE_ROAD) limit = 2500; // Auto layout may generate many roads

    const coords = tpl.buildings[type];
    if (!coords) continue;

    for (let i = 0; i < Math.min(limit, coords.length); i++) {
      out.push({ type: structType, dx: coords[i].x, dy: coords[i].y });
    }
  }

  return out;
}

// Simple Stamp Layout (Center is Storage/Link)
// + = Road, E = Extension, T = Tower, S = Spawn, L = Link, O = Storage, M = Terminal
//
//   E E E E E
//   E T E T E
//   E E O E E
//   E L S M E
//   E E E E E
//
// This is just a conceptual example. We'll implement a compact diamond stamp.

const stamp: LayoutTemplate = {
  buildings: {
    [STRUCTURE_EXTENSION]: [],
    [STRUCTURE_TOWER]: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: -2, y: -2 },
      { x: 2, y: -2 },
    ],
    [STRUCTURE_ROAD]: [
      // Diamond shape roads around center
      // Cross
      { x: 0, y: -3 },
      { x: 0, y: 3 },
      { x: -3, y: 0 },
      { x: 3, y: 0 },
      // Diagonals
      { x: -1, y: -3 },
      { x: 1, y: -3 },
      { x: -3, y: -1 },
      { x: 3, y: -1 },
      { x: -3, y: 1 },
      { x: 3, y: 1 },
      { x: -1, y: 3 },
      { x: 1, y: 3 },
    ],
    [STRUCTURE_STORAGE]: [{ x: 0, y: 0 }],
    [STRUCTURE_SPAWN]: [
      { x: 0, y: -4 },
      { x: 0, y: 4 },
      { x: -4, y: 0 },
    ],
    [STRUCTURE_LINK]: [{ x: -1, y: 0 }], // Near storage
    [STRUCTURE_TERMINAL]: [{ x: 1, y: 0 }], // Near storage
  },
};

// Generate full list for 60 extensions
const extensionOffsets = [];
for (let x = -4; x <= 4; x++) {
  for (let y = -4; y <= 4; y++) {
    if (x === 0 && y === 0) continue;
    if (Math.abs(x) + Math.abs(y) <= 1) continue; // Reserved for core
    if ((x + y) % 2 !== 0) {
      // Checkerboard pattern
      extensionOffsets.push({ x, y });
    }
  }
}
// Sort by distance to center
extensionOffsets.sort(
  (a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)),
);

const bunker: LayoutTemplate = {
  buildings: {
    [STRUCTURE_STORAGE]: [{ x: 0, y: 0 }],
    [STRUCTURE_TERMINAL]: [{ x: -1, y: 0 }],
    [STRUCTURE_LINK]: [{ x: 1, y: 0 }],
    [STRUCTURE_SPAWN]: [
      { x: 0, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
    ],
    [STRUCTURE_TOWER]: [
      { x: 0, y: -2 },
      { x: 0, y: 2 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -1, y: -1 },
      { x: 1, y: -1 },
    ],
    [STRUCTURE_EXTENSION]: extensionOffsets,
    [STRUCTURE_ROAD]: [], // We will fill roads dynamically or pattern based
  },
};

// Fill roads for bunker (checkerboard complement)
const bunkerRoads = [];
for (let x = -5; x <= 5; x++) {
  for (let y = -5; y <= 5; y++) {
    // Core area logic specific
    if (Math.abs(x) <= 1 && Math.abs(y) <= 1) continue;
    if ((x + y) % 2 === 0) {
      bunkerRoads.push({ x, y });
    }
  }
}

const bunkerNonRoadSet = new Set();
for (const type in bunker.buildings) {
  const t = type as BuildableStructureConstant;
  if (t === STRUCTURE_ROAD) continue;
  const coords = bunker.buildings[type] || [];
  for (const c of coords) bunkerNonRoadSet.add(`${c.x},${c.y}`);
}
bunker.buildings[STRUCTURE_ROAD] = bunkerRoads.filter(
  (c) => !bunkerNonRoadSet.has(`${c.x},${c.y}`),
);

const atlas: LayoutTemplate = {
  buildings: {
    [STRUCTURE_STORAGE]: [{ x: 0, y: 0 }],
    [STRUCTURE_TERMINAL]: [{ x: -1, y: 0 }],
    [STRUCTURE_LINK]: [{ x: 1, y: 0 }],
    [STRUCTURE_FACTORY]: [{ x: 0, y: 1 }],
    [STRUCTURE_POWER_SPAWN]: [{ x: 0, y: -1 }],
    [STRUCTURE_OBSERVER]: [{ x: 2, y: -2 }],
    [STRUCTURE_NUKER]: [{ x: -2, y: -2 }],
    [STRUCTURE_SPAWN]: [
      { x: 0, y: 2 },
      { x: -2, y: 1 },
      { x: 2, y: 1 },
    ],
    [STRUCTURE_TOWER]: [
      { x: -3, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: -3 },
    ],
    [STRUCTURE_LAB]: [
      { x: -3, y: -5 },
      { x: -2, y: -5 },
      { x: -1, y: -5 },
      { x: 0, y: -5 },
      { x: 1, y: -5 },
      { x: -2, y: -4 },
      { x: -1, y: -4 },
      { x: 0, y: -4 },
      { x: 1, y: -4 },
      { x: 2, y: -4 },
    ],
    [STRUCTURE_EXTENSION]: [],
    [STRUCTURE_ROAD]: [],
  },
};

const atlasRoadRaw: { x: number; y: number }[] = [];
for (let x = -8; x <= 8; x++) {
  atlasRoadRaw.push({ x, y: 0 });
  atlasRoadRaw.push({ x, y: 4 });
  atlasRoadRaw.push({ x, y: -4 });
}
for (let y = -8; y <= 8; y++) {
  atlasRoadRaw.push({ x: 0, y });
  atlasRoadRaw.push({ x: 4, y });
  atlasRoadRaw.push({ x: -4, y });
}
for (let d = -6; d <= 6; d++) {
  atlasRoadRaw.push({ x: d, y: d });
  atlasRoadRaw.push({ x: d, y: -d });
}
const atlasRoadSeen = new Set<string>();
const atlasRoads: { x: number; y: number }[] = [];
for (const c of atlasRoadRaw) {
  const k = `${c.x},${c.y}`;
  if (atlasRoadSeen.has(k)) continue;
  atlasRoadSeen.add(k);
  atlasRoads.push(c);
}
const atlasNonRoad = new Set<string>();
for (const type in atlas.buildings) {
  const t = type as BuildableStructureConstant;
  if (t === STRUCTURE_ROAD || t === STRUCTURE_EXTENSION) continue;
  const coords = atlas.buildings[type] || [];
  for (const c of coords) atlasNonRoad.add(`${c.x},${c.y}`);
}
atlas.buildings[STRUCTURE_ROAD] = atlasRoads.filter(
  (c) => !atlasNonRoad.has(`${c.x},${c.y}`),
);

const atlasReserved = new Set<string>();
for (const type in atlas.buildings) {
  const t = type as BuildableStructureConstant;
  if (t === STRUCTURE_EXTENSION) continue;
  const coords = atlas.buildings[type] || [];
  for (const c of coords) atlasReserved.add(`${c.x},${c.y}`);
}
const atlasExtensions: { x: number; y: number }[] = [];
for (let x = -9; x <= 9; x++) {
  for (let y = -9; y <= 9; y++) {
    if (Math.abs(x) + Math.abs(y) <= 2) continue;
    if ((x + y) % 2 === 0) continue;
    if (atlasReserved.has(`${x},${y}`)) continue;
    atlasExtensions.push({ x, y });
  }
}
atlasExtensions.sort(
  (a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)),
);
atlas.buildings[STRUCTURE_EXTENSION] = atlasExtensions;

function buildStampExtensions() {
  const reserved = new Set();
  const core = [
    { x: 0, y: 0 }, // storage
    { x: -1, y: 0 }, // link
    { x: 1, y: 0 }, // terminal
    { x: 0, y: -4 }, // spawn
    { x: 0, y: 4 }, // spawn
    { x: -4, y: 0 }, // spawn
  ];
  for (const c of core) reserved.add(`${c.x},${c.y}`);
  for (const c of stamp.buildings[STRUCTURE_TOWER] || [])
    reserved.add(`${c.x},${c.y}`);
  for (const c of stamp.buildings[STRUCTURE_ROAD] || [])
    reserved.add(`${c.x},${c.y}`);

  const out = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      if (x === 0 && y === 0) continue;
      if (Math.abs(x) + Math.abs(y) <= 1) continue;
      if ((x + y) % 2 === 0) continue;
      if (reserved.has(`${x},${y}`)) continue;
      out.push({ x, y });
    }
  }
  out.sort(
    (a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)),
  );
  return out;
}

stamp.buildings[STRUCTURE_EXTENSION] = buildStampExtensions();

export const Layouts: Record<LayoutName, LayoutTemplate> = {
  stamp,
  bunker,
  atlas,
  auto: atlas, // Placeholder, dynamic generation is handled in getPlannedStructures
};

export type PlannedStructure = {
  type: BuildableStructureConstant;
  dx: number;
  dy: number;
};
