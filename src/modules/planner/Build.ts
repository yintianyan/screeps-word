import { config } from "../../config";
import { LayoutName } from "./Layouts";
import { findCoreAnchor } from "./DistanceTransform";

type Anchor = { x: number; y: number };

function isInsideRoom(x: number, y: number): boolean {
  return x >= 2 && x <= 47 && y >= 2 && y <= 47;
}

function getLayoutName(room: Room): LayoutName {
  const name = room.memory.planner?.layout;
  if (name === "stamp" || name === "bunker") return name;
  return config.LAYOUT.DEFAULT;
}

function getAnchor(room: Room): Anchor | null {
  const mem = room.memory.planner?.anchor;
  if (mem && typeof mem.x === "number" && typeof mem.y === "number") return mem;
  const found = findCoreAnchor(room);
  if (found) return found;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  return spawn ? { x: spawn.pos.x, y: spawn.pos.y } : null;
}

function canPlace(
  room: Room,
  x: number,
  y: number,
  type: BuildableStructureConstant,
): boolean {
  if (!isInsideRoom(x, y)) return false;
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

  const pos = new RoomPosition(x, y, room.name);
  const structures = pos.lookFor(LOOK_STRUCTURES);
  if (structures.length > 0) return false;

  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.length > 0) return false;

  if (type === STRUCTURE_TOWER || type === STRUCTURE_EXTENSION) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (spawn && spawn.pos.x === x && spawn.pos.y === y) return false;
  }

  return true;
}

function canPlaceRoad(room: Room, x: number, y: number): boolean {
  if (!isInsideRoom(x, y)) return false;
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

  const pos = new RoomPosition(x, y, room.name);
  const structures = pos.lookFor(LOOK_STRUCTURES);
  if (structures.some((s) => s.structureType !== STRUCTURE_ROAD)) return false;

  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.length > 0) return false;

  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (spawn && spawn.pos.x === x && spawn.pos.y === y) return false;
  if (
    room.controller &&
    room.controller.pos.x === x &&
    room.controller.pos.y === y
  )
    return false;

  return true;
}

function placeOne(
  room: Room,
  type: BuildableStructureConstant,
  x: number,
  y: number,
): boolean {
  const result = room.createConstructionSite(x, y, type);
  return result === OK;
}

function countPlanned(room: Room, type: StructureConstant): number {
  const built = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === type,
  }).length;
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: (s) => s.structureType === type,
  }).length;
  return built + sites;
}

function findNearestFreeAround(
  room: Room,
  anchor: Anchor,
  type: BuildableStructureConstant,
  maxRange: number,
): Anchor | null {
  for (let r = 0; r <= maxRange; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const dy = r - Math.abs(dx);
      const candidates = [
        { x: anchor.x + dx, y: anchor.y + dy },
        { x: anchor.x + dx, y: anchor.y - dy },
      ];
      for (const p of candidates) {
        if (canPlace(room, p.x, p.y, type)) return p;
      }
    }
  }
  return null;
}

function extensionFloodFill(
  room: Room,
  anchor: Anchor,
  limit: number,
): Anchor[] {
  const terrain = room.getTerrain();
  const visited = new Uint8Array(50 * 50);
  const out: Anchor[] = [];

  const qx: number[] = [anchor.x];
  const qy: number[] = [anchor.y];
  visited[anchor.y * 50 + anchor.x] = 1;

  for (let qi = 0; qi < qx.length; qi++) {
    if (out.length >= limit) break;
    const x = qx[qi];
    const y = qy[qi];

    const n = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const p of n) {
      if (!isInsideRoom(p.x, p.y)) continue;
      const i = p.y * 50 + p.x;
      if (visited[i] === 1) continue;
      visited[i] = 1;
      if (terrain.get(p.x, p.y) !== TERRAIN_MASK_WALL) {
        qx.push(p.x);
        qy.push(p.y);
      }
    }

    if (canPlace(room, x, y, STRUCTURE_EXTENSION)) out.push({ x, y });
  }

  return out;
}

function planRoad(
  room: Room,
  from: RoomPosition,
  to: RoomPosition,
  budget: number,
): number {
  if (budget <= 0) return 0;

  const res = PathFinder.search(
    from,
    { pos: to, range: 1 },
    { plainCost: 2, swampCost: 10, maxOps: 2000 },
  );

  let placed = 0;
  for (const pos of res.path) {
    if (placed >= budget) break;
    if (!canPlaceRoad(room, pos.x, pos.y)) continue;
    if (placeOne(room, STRUCTURE_ROAD, pos.x, pos.y)) placed++;
  }
  return placed;
}

export class Build {
  public static run(room: Room): void {
    if (!room.controller?.my) return;
    if (Game.cpu.bucket < config.CPU.BUCKET_LIMIT) return;

    const anchor = getAnchor(room);
    if (!anchor) return;

    if (!room.memory.planner)
      room.memory.planner = { layout: getLayoutName(room) };
    if (!room.memory.planner.anchor) room.memory.planner.anchor = anchor;
    const rcl = room.controller.level;

    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    if (existingSites >= 10) return;

    let placed = 0;
    const maxPerTick = 3;

    const storageLimit = CONTROLLER_STRUCTURES[STRUCTURE_STORAGE][rcl] ?? 0;
    if (
      storageLimit > 0 &&
      countPlanned(room, STRUCTURE_STORAGE) < storageLimit
    ) {
      const pos = canPlace(room, anchor.x, anchor.y, STRUCTURE_STORAGE)
        ? anchor
        : findNearestFreeAround(room, anchor, STRUCTURE_STORAGE, 6);
      if (pos && placed < maxPerTick) {
        if (placeOne(room, STRUCTURE_STORAGE, pos.x, pos.y)) placed++;
      }
    }

    const towerLimit = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] ?? 0;
    if (towerLimit > 0 && countPlanned(room, STRUCTURE_TOWER) < towerLimit) {
      const pos = findNearestFreeAround(room, anchor, STRUCTURE_TOWER, 6);
      if (pos && placed < maxPerTick) {
        if (placeOne(room, STRUCTURE_TOWER, pos.x, pos.y)) placed++;
      }
    }

    const extensionLimit = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;
    const extPlanned = countPlanned(room, STRUCTURE_EXTENSION);
    const extNeeded = Math.max(0, extensionLimit - extPlanned);
    if (extNeeded > 0 && placed < maxPerTick) {
      const candidates = extensionFloodFill(room, anchor, extNeeded);
      for (const p of candidates) {
        if (placed >= maxPerTick) break;
        if (placeOne(room, STRUCTURE_EXTENSION, p.x, p.y)) placed++;
      }
    }

    if (rcl >= 3 && placed < maxPerTick) {
      const spawn = room.find(FIND_MY_SPAWNS)[0];
      const hub = spawn
        ? spawn.pos
        : new RoomPosition(anchor.x, anchor.y, room.name);
      const roadBudget = maxPerTick - placed;
      let roadPlaced = 0;

      if (room.controller && roadPlaced < roadBudget) {
        roadPlaced += planRoad(
          room,
          hub,
          room.controller.pos,
          roadBudget - roadPlaced,
        );
      }

      const sources = room.find(FIND_SOURCES);
      for (const source of sources) {
        if (roadPlaced >= roadBudget) break;
        roadPlaced += planRoad(room, hub, source.pos, roadBudget - roadPlaced);
      }
    }
  }
}
