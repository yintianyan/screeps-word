import { config } from "../../config";
import type { LayoutName } from "./Layouts";
import { plannedStructuresForRcl } from "./Layouts";
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
  
  // Allow roads on ramparts and ramparts on anything
  if (type === STRUCTURE_RAMPART) {
      if (structures.some(s => s.structureType === STRUCTURE_WALL)) return false;
      return true;
  }
  if (type === STRUCTURE_ROAD) {
      if (structures.some(s => s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_ROAD)) return false;
      // Roads can coexist with road (redundant) and rampart
      return true;
  }

  // For other structures, must be empty or road/rampart
  if (structures.length > 0) {
      // If there's a road/rampart, we can place some things on top?
      // Generally no, unless it's a road site on a road.
      // But here we check if we can place a NEW structure.
      // If there is a road, we can place rampart.
      // If there is a rampart, we can place anything.
      const blocker = structures.find(s => s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_ROAD);
      if (blocker) return false;
  }

  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.length > 0) return false;

  return true;
}

function placeOne(
  room: Room,
  type: BuildableStructureConstant,
  x: number,
  y: number,
): boolean {
  // Check if structure already exists
  const pos = new RoomPosition(x, y, room.name);
  const structures = pos.lookFor(LOOK_STRUCTURES);
  if (structures.some(s => s.structureType === type)) return false;
  
  // Check if site exists
  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.some(s => s.structureType === type)) return false;

  const result = room.createConstructionSite(x, y, type);
  return result === OK;
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
    // canPlace check logic for road is: terrain not wall, no other blocking structures
    // placeOne handles existence check
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
    const layoutName = getLayoutName(room);

    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    if (existingSites >= 10) return;

    let placed = 0;
    const maxPerTick = 3;
    
    // 1. Core Layout Structures
    const planned = plannedStructuresForRcl(layoutName, rcl);
    
    for (const p of planned) {
        if (placed >= maxPerTick) break;
        const x = anchor.x + p.dx;
        const y = anchor.y + p.dy;
        
        if (canPlace(room, x, y, p.type)) {
            if (placeOne(room, p.type, x, y)) placed++;
        }
    }
    
    // 2. Roads to Sources / Controller (if budget left)
    if (rcl >= 3 && placed < maxPerTick) {
      const hub = new RoomPosition(anchor.x, anchor.y, room.name);
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
