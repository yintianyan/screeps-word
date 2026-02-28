import { config } from "../../config";
import { LayoutName, plannedStructuresForRcl } from "./Layouts";

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
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return null;
  return { x: spawn.pos.x, y: spawn.pos.y };
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

function placeOne(
  room: Room,
  type: BuildableStructureConstant,
  x: number,
  y: number,
): boolean {
  const result = room.createConstructionSite(x, y, type);
  return result === OK;
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
    if (!room.memory.planner.layout)
      room.memory.planner.layout = getLayoutName(room);

    const layout = getLayoutName(room);
    const rcl = room.controller.level;
    const plan = plannedStructuresForRcl(layout, rcl);

    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    if (existingSites >= 5) return;

    let placed = 0;
    const maxPerTick = 2;

    for (const item of plan) {
      if (placed >= maxPerTick) break;
      const x = anchor.x + item.dx;
      const y = anchor.y + item.dy;
      if (!canPlace(room, x, y, item.type)) continue;
      if (placeOne(room, item.type, x, y)) placed++;
    }
  }
}
