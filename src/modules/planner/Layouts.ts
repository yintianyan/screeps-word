export type LayoutName = "stamp" | "bunker";

export type PlannedStructure = {
  type: BuildableStructureConstant;
  dx: number;
  dy: number;
};

export type LayoutTemplate = {
  extensions: ReadonlyArray<{ dx: number; dy: number }>;
  towers: ReadonlyArray<{ dx: number; dy: number }>;
};

const stamp: LayoutTemplate = {
  extensions: [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 },
    { dx: 2, dy: 0 },
    { dx: -2, dy: 0 },
    { dx: 0, dy: 2 },
    { dx: 0, dy: -2 },
    { dx: 2, dy: 1 },
    { dx: 2, dy: -1 },
    { dx: -2, dy: 1 },
    { dx: -2, dy: -1 },
    { dx: 1, dy: 2 },
    { dx: -1, dy: 2 },
    { dx: 1, dy: -2 },
    { dx: -1, dy: -2 },
    { dx: 2, dy: 2 },
    { dx: 2, dy: -2 },
    { dx: -2, dy: 2 },
    { dx: -2, dy: -2 },
    { dx: 3, dy: 0 },
    { dx: -3, dy: 0 },
    { dx: 0, dy: 3 },
    { dx: 0, dy: -3 },
  ],
  towers: [
    { dx: 3, dy: 1 },
    { dx: 3, dy: -1 },
    { dx: -3, dy: 1 },
  ],
};

const bunker: LayoutTemplate = {
  extensions: stamp.extensions,
  towers: stamp.towers,
};

export const Layouts: Record<LayoutName, LayoutTemplate> = {
  stamp,
  bunker,
};

export function plannedStructuresForRcl(
  layout: LayoutName,
  rcl: number,
): PlannedStructure[] {
  const tpl = Layouts[layout];

  const extLimit = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;
  const towerLimit = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] ?? 0;

  const out: PlannedStructure[] = [];

  for (let i = 0; i < Math.min(extLimit, tpl.extensions.length); i++) {
    const p = tpl.extensions[i];
    out.push({ type: STRUCTURE_EXTENSION, dx: p.dx, dy: p.dy });
  }

  for (let i = 0; i < Math.min(towerLimit, tpl.towers.length); i++) {
    const p = tpl.towers[i];
    out.push({ type: STRUCTURE_TOWER, dx: p.dx, dy: p.dy });
  }

  return out;
}
