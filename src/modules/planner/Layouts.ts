export type LayoutName = "stamp" | "bunker";

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
    [STRUCTURE_EXTENSION]: [
      // Inner Ring
      { x: -1, y: -2 },
      { x: 0, y: -2 },
      { x: 1, y: -2 },
      { x: -2, y: -1 },
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 2, y: -1 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -2, y: 1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: -1, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      // Outer Ring parts
      { x: -3, y: -2 },
      { x: 3, y: -2 },
      { x: -3, y: 2 },
      { x: 3, y: 2 },
      { x: -2, y: -3 },
      { x: 2, y: -3 },
      { x: -2, y: 3 },
      { x: 2, y: 3 },
      // ... fill up to 60 extensions
    ],
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
      { x: 0, y: 0 }, // Center access? No, center is Storage
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
bunker.buildings[STRUCTURE_ROAD] = bunkerRoads;

export const Layouts: Record<LayoutName, LayoutTemplate> = {
  stamp,
  bunker,
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
