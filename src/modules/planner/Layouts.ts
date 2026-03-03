export type LayoutName = "stamp" | "bunker" | "atlas";

export type LayoutTemplate = {
  buildings: Record<string, { x: number; y: number }[]>;
};

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
};

export type PlannedStructure = {
  type: BuildableStructureConstant;
  dx: number;
  dy: number;
};

export function plannedStructuresForRcl(
  layout: LayoutName,
  rcl: number,
): PlannedStructure[] {
  const tpl = Layouts[layout];
  const out: PlannedStructure[] = [];

  for (const type in tpl.buildings) {
    const structType = type as BuildableStructureConstant;
    // Get limit for this RCL
    // Note: CONTROLLER_STRUCTURES is global constant
    let limit = CONTROLLER_STRUCTURES[structType][rcl] ?? 0;
    if (structType === STRUCTURE_ROAD) limit = 200; // Arbitrary high limit for roads

    const coords = tpl.buildings[type];
    if (!coords) continue;

    for (let i = 0; i < Math.min(limit, coords.length); i++) {
      out.push({ type: structType, dx: coords[i].x, dy: coords[i].y });
    }
  }

  return out;
}
