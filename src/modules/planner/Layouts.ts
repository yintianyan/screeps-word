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
  const template: LayoutTemplate = {
    buildings: {
      [STRUCTURE_EXTENSION]: [],
      [STRUCTURE_ROAD]: [],
    },
  };

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

  for (let ti = 0; ti < coreTypes.length; ti++) {
    const type = coreTypes[ti];
    const coords = atlas.buildings[type];
    if (!coords) continue;
    template.buildings[type] = [...coords];
    for (let ci = 0; ci < coords.length; ci++) {
      const c = coords[ci];
      reserved.add(`${c.x},${c.y}`);
    }
  }

  const queue: { x: number; y: number; dist: number }[] = [{ x: 0, y: 0, dist: 0 }];
  const visited = new Set<string>(["0,0"]);
  const extensions: { x: number; y: number }[] = [];
  const roads: { x: number; y: number }[] = [];

  const coreRoads = atlas.buildings[STRUCTURE_ROAD] || [];
  for (let ri = 0; ri < coreRoads.length; ri++) {
    const r = coreRoads[ri];
    if (Math.abs(r.x) <= 6 && Math.abs(r.y) <= 6) {
      roads.push(r);
      reserved.add(`${r.x},${r.y}`);
      const key = `${r.x},${r.y}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ x: r.x, y: r.y, dist: Math.abs(r.x) + Math.abs(r.y) });
      }
    }
  }

  for (let ti = 0; ti < coreTypes.length; ti++) {
    const type = coreTypes[ti];
    const coords = template.buildings[type];
    if (!coords) continue;
    for (let ci = 0; ci < coords.length; ci++) {
      const c = coords[ci];
      const key = `${c.x},${c.y}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ x: c.x, y: c.y, dist: Math.abs(c.x) + Math.abs(c.y) });
      }
    }
  }

  let extensionCount = 0;
  const MAX_EXTENSIONS = 60;
  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  let qi = 0;
  while (qi < queue.length && extensionCount < MAX_EXTENSIONS) {
    const curr = queue[qi++];

    for (let ni = 0; ni < neighbors.length; ni++) {
      const n = { x: curr.x + neighbors[ni].dx, y: curr.y + neighbors[ni].dy };
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const absX = anchor.x + n.x;
      const absY = anchor.y + n.y;

      if (absX < 2 || absX > 47 || absY < 2 || absY > 47) continue;
      if (getTerrainAt(room, absX, absY) === TERRAIN_MASK_WALL) continue;
      if (reserved.has(key)) continue;

      const isEven = (n.x + n.y) % 2 === 0;

      if (!isEven) {
        extensions.push(n);
        extensionCount++;
        queue.push({ x: n.x, y: n.y, dist: curr.dist + 1 });
      } else {
        roads.push(n);
        queue.push({ x: n.x, y: n.y, dist: curr.dist + 1 });
      }
    }
  }

  extensions.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));
  roads.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));

  template.buildings[STRUCTURE_EXTENSION] = extensions;
  
  const uniqueRoads = new Set<string>();
  const finalRoads: { x: number; y: number }[] = [];
  for (let ri = 0; ri < roads.length; ri++) {
    const r = roads[ri];
    const k = `${r.x},${r.y}`;
    if (!uniqueRoads.has(k)) {
      uniqueRoads.add(k);
      finalRoads.push(r);
    }
  }
  template.buildings[STRUCTURE_ROAD] = finalRoads;

  template.buildings[STRUCTURE_LINK] = template.buildings[STRUCTURE_LINK] || [];
  const linkPosSet = new Set<string>();
  const linkCoords = template.buildings[STRUCTURE_LINK];
  for (let li = 0; li < linkCoords.length; li++) {
    const l = linkCoords[li];
    linkPosSet.add(`${l.x},${l.y}`);
  }

  if (room.controller) {
    const cPos = room.controller.pos;
    const candidates: { x: number; y: number }[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
          const absX = cPos.x + dx;
          const absY = cPos.y + dy;
          if (getTerrainAt(room, absX, absY) !== TERRAIN_MASK_WALL) {
            candidates.push({ x: absX - anchor.x, y: absY - anchor.y });
          }
        }
      }
    }
    candidates.sort((a, b) => Math.abs(b.x) + Math.abs(b.y) - (Math.abs(a.x) + Math.abs(a.y)));
    if (candidates.length > 0) {
      const best = candidates[0];
      const k = `${best.x},${best.y}`;
      if (!linkPosSet.has(k)) {
        template.buildings[STRUCTURE_LINK].push(best);
        linkPosSet.add(k);
      }
    }
  }

  const sources = room.find(FIND_SOURCES);
  for (let si = 0; si < sources.length; si++) {
    const sPos = sources[si].pos;
    const candidates: { x: number; y: number }[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
          const absX = sPos.x + dx;
          const absY = sPos.y + dy;
          if (getTerrainAt(room, absX, absY) !== TERRAIN_MASK_WALL) {
            candidates.push({ x: absX - anchor.x, y: absY - anchor.y });
          }
        }
      }
    }
    candidates.sort((a, b) => Math.abs(b.x) + Math.abs(b.y) - (Math.abs(a.x) + Math.abs(a.y)));
    if (candidates.length > 0) {
      const best = candidates[0];
      const k = `${best.x},${best.y}`;
      if (!linkPosSet.has(k)) {
        template.buildings[STRUCTURE_LINK].push(best);
        linkPosSet.add(k);
      }
    }
  }

  template.buildings[STRUCTURE_RAMPART] = [];
  const rampartSet = new Set<string>();

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
    STRUCTURE_LINK,
  ];

  for (let ti = 0; ti < protectTypes.length; ti++) {
    const type = protectTypes[ti];
    const coords = template.buildings[type];
    if (!coords) continue;
    for (let ci = 0; ci < coords.length; ci++) {
      const c = coords[ci];
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
    const cached = autoLayoutCache[room.name];

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

  const buildingTypes = Object.keys(tpl.buildings);
  for (let bi = 0; bi < buildingTypes.length; bi++) {
    const type = buildingTypes[bi];
    const structType = type as BuildableStructureConstant;
    let limit = CONTROLLER_STRUCTURES[structType][rcl] ?? 0;
    if (structType === STRUCTURE_ROAD) limit = 2500;

    const coords = tpl.buildings[type];
    if (!coords) continue;

    const maxLen = Math.min(limit, coords.length);
    for (let i = 0; i < maxLen; i++) {
      out.push({ type: structType, dx: coords[i].x, dy: coords[i].y });
    }
  }

  return out;
}

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
      { x: 0, y: -3 },
      { x: 0, y: 3 },
      { x: -3, y: 0 },
      { x: 3, y: 0 },
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
    [STRUCTURE_LINK]: [{ x: -1, y: 0 }],
    [STRUCTURE_TERMINAL]: [{ x: 1, y: 0 }],
  },
};

const extensionOffsets: { x: number; y: number }[] = [];
for (let x = -4; x <= 4; x++) {
  for (let y = -4; y <= 4; y++) {
    if (x === 0 && y === 0) continue;
    if (Math.abs(x) + Math.abs(y) <= 1) continue;
    if ((x + y) % 2 !== 0) {
      extensionOffsets.push({ x, y });
    }
  }
}
extensionOffsets.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));

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
    [STRUCTURE_ROAD]: [],
  },
};

const bunkerRoads: { x: number; y: number }[] = [];
for (let x = -5; x <= 5; x++) {
  for (let y = -5; y <= 5; y++) {
    if (Math.abs(x) <= 1 && Math.abs(y) <= 1) continue;
    if ((x + y) % 2 === 0) {
      bunkerRoads.push({ x, y });
    }
  }
}

const bunkerNonRoadSet = new Set<string>();
const bunkerBuildingTypes = Object.keys(bunker.buildings);
for (let bi = 0; bi < bunkerBuildingTypes.length; bi++) {
  const t = bunkerBuildingTypes[bi] as BuildableStructureConstant;
  if (t === STRUCTURE_ROAD) continue;
  const coords = bunker.buildings[t];
  if (!coords) continue;
  for (let ci = 0; ci < coords.length; ci++) {
    bunkerNonRoadSet.add(`${coords[ci].x},${coords[ci].y}`);
  }
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
for (let ri = 0; ri < atlasRoadRaw.length; ri++) {
  const c = atlasRoadRaw[ri];
  const k = `${c.x},${c.y}`;
  if (atlasRoadSeen.has(k)) continue;
  atlasRoadSeen.add(k);
  atlasRoads.push(c);
}
const atlasNonRoad = new Set<string>();
const atlasBuildingTypes = Object.keys(atlas.buildings);
for (let bi = 0; bi < atlasBuildingTypes.length; bi++) {
  const t = atlasBuildingTypes[bi] as BuildableStructureConstant;
  if (t === STRUCTURE_ROAD || t === STRUCTURE_EXTENSION) continue;
  const coords = atlas.buildings[t];
  if (!coords) continue;
  for (let ci = 0; ci < coords.length; ci++) {
    atlasNonRoad.add(`${coords[ci].x},${coords[ci].y}`);
  }
}
atlas.buildings[STRUCTURE_ROAD] = atlasRoads.filter(
  (c) => !atlasNonRoad.has(`${c.x},${c.y}`),
);

const atlasReserved = new Set<string>();
for (let bi = 0; bi < atlasBuildingTypes.length; bi++) {
  const t = atlasBuildingTypes[bi] as BuildableStructureConstant;
  if (t === STRUCTURE_EXTENSION) continue;
  const coords = atlas.buildings[t];
  if (!coords) continue;
  for (let ci = 0; ci < coords.length; ci++) {
    atlasReserved.add(`${coords[ci].x},${coords[ci].y}`);
  }
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
atlasExtensions.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));
atlas.buildings[STRUCTURE_EXTENSION] = atlasExtensions;

function buildStampExtensions(): { x: number; y: number }[] {
  const reserved = new Set<string>();
  const core = [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -4 },
    { x: 0, y: 4 },
    { x: -4, y: 0 },
  ];
  for (let ci = 0; ci < core.length; ci++) {
    reserved.add(`${core[ci].x},${core[ci].y}`);
  }
  const towerCoords = stamp.buildings[STRUCTURE_TOWER] || [];
  for (let ti = 0; ti < towerCoords.length; ti++) {
    reserved.add(`${towerCoords[ti].x},${towerCoords[ti].y}`);
  }
  const roadCoords = stamp.buildings[STRUCTURE_ROAD] || [];
  for (let ri = 0; ri < roadCoords.length; ri++) {
    reserved.add(`${roadCoords[ri].x},${roadCoords[ri].y}`);
  }

  const out: { x: number; y: number }[] = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      if (x === 0 && y === 0) continue;
      if (Math.abs(x) + Math.abs(y) <= 1) continue;
      if ((x + y) % 2 === 0) continue;
      if (reserved.has(`${x},${y}`)) continue;
      out.push({ x, y });
    }
  }
  out.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));
  return out;
}

stamp.buildings[STRUCTURE_EXTENSION] = buildStampExtensions();

export const Layouts: Record<LayoutName, LayoutTemplate> = {
  stamp,
  bunker,
  atlas,
  auto: atlas,
};

export type PlannedStructure = {
  type: BuildableStructureConstant;
  dx: number;
  dy: number;
};
