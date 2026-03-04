import { config } from "../../config";
import type { LayoutName } from "./Layouts";
import { getPlannedStructures } from "./Layouts";
import { findCoreAnchor } from "./DistanceTransform";
import StructureCache from "../../utils/structureCache";

type Anchor = { x: number; y: number };
type DynamicPlan = {
  roads: Set<string>;
  noBuild: Set<string>;
};

const BUILD_PRIORITY: Record<string, number> = {
  [STRUCTURE_SPAWN]: 100,
  [STRUCTURE_EXTENSION]: 90,
  [STRUCTURE_TOWER]: 80,
  [STRUCTURE_LINK]: 70,
  [STRUCTURE_LAB]: 60,
  [STRUCTURE_TERMINAL]: 60,
  [STRUCTURE_STORAGE]: 60,
  [STRUCTURE_NUKER]: 50,
  [STRUCTURE_OBSERVER]: 50,
  [STRUCTURE_POWER_SPAWN]: 50,
  [STRUCTURE_FACTORY]: 50,
  [STRUCTURE_CONTAINER]: 40,
  [STRUCTURE_EXTRACTOR]: 40,
  [STRUCTURE_ROAD]: 20,
  [STRUCTURE_RAMPART]: 10,
  [STRUCTURE_WALL]: 10,
};

const MAX_CONSTRUCTION_SITES = 3;

function isInsideRoom(x: number, y: number): boolean {
  return x >= 2 && x <= 47 && y >= 2 && y <= 47;
}

function getLayoutName(room: Room): LayoutName {
  const name = room.memory.planner?.layout;
  if (name === "stamp" || name === "bunker" || name === "atlas" || name === "auto")
    return name;
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

function keyOf(x: number, y: number): string {
  return `${x}:${y}`;
}

function buildBaseMatrix(room: Room): CostMatrix {
  const matrix = new PathFinder.CostMatrix();
  const terrain = room.getTerrain();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        matrix.set(x, y, 255);
      }
    }
  }
  const structures = StructureCache.getAllStructures(room);
  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    if (
      s.structureType === STRUCTURE_ROAD ||
      s.structureType === STRUCTURE_RAMPART ||
      s.structureType === STRUCTURE_CONTAINER
    ) {
      if (s.structureType === STRUCTURE_ROAD) matrix.set(s.pos.x, s.pos.y, 1);
      continue;
    }
    matrix.set(s.pos.x, s.pos.y, 255);
  }
  return matrix;
}

function computeDynamicPlan(room: Room, anchor: Anchor): DynamicPlan {
  const planner = room.memory.planner;
  const cached = planner?.dynamic;
  if (
    cached &&
    cached.anchor.x === anchor.x &&
    cached.anchor.y === anchor.y &&
    Game.time - cached.lastUpdate < config.LAYOUT.DYNAMIC_INTERVAL
  ) {
    return {
      roads: new Set(cached.roads),
      noBuild: new Set(cached.noBuild),
    };
  }

  const roads = new Set<string>();
  const hub = new RoomPosition(anchor.x, anchor.y, room.name);
  const targets: RoomPosition[] = [];
  if (room.controller) targets.push(room.controller.pos);
  const sources = room.find(FIND_SOURCES);
  for (let i = 0; i < sources.length; i++) {
    targets.push(sources[i].pos);
  }

  const matrix = buildBaseMatrix(room);
  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const res = PathFinder.search(
      hub,
      { pos: target, range: 1 },
      {
        plainCost: 2,
        swampCost: 8,
        maxOps: 3000,
        roomCallback: () => matrix,
      },
    );
    for (let pi = 0; pi < res.path.length; pi++) {
      const pos = res.path[pi];
      if (!isInsideRoom(pos.x, pos.y)) continue;
      roads.add(keyOf(pos.x, pos.y));
    }
  }

  const noBuild = new Set<string>(roads);
  room.memory.planner = room.memory.planner ?? { layout: getLayoutName(room) };
  room.memory.planner.dynamic = {
    lastUpdate: Game.time,
    anchor: { x: anchor.x, y: anchor.y },
    roads: [...roads],
    noBuild: [...noBuild],
  };
  return { roads, noBuild };
}

function canPlace(
  x: number,
  y: number,
  type: BuildableStructureConstant,
  noBuild: Set<string>,
  terrain: RoomTerrain,
  existing: StructureConstant[] | undefined,
): boolean {
  if (!isInsideRoom(x, y)) return false;
  
  if (type !== STRUCTURE_ROAD && noBuild.has(keyOf(x, y))) return false;
  
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

  if (!existing || existing.length === 0) return true;
  
  if (type === STRUCTURE_RAMPART) {
    return !existing.includes(STRUCTURE_WALL);
  }
  
  if (type === STRUCTURE_ROAD) {
    if (existing.includes(STRUCTURE_ROAD)) return false;
    if (existing.includes(STRUCTURE_WALL)) return false;
    return true;
  }

  for (let i = 0; i < existing.length; i++) {
    const t = existing[i];
    if (t !== STRUCTURE_ROAD && t !== STRUCTURE_RAMPART) return false;
  }
  return true;
}

type BuildTask = {
  type: BuildableStructureConstant;
  x: number;
  y: number;
  priority: number;
  dist: number;
};

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
    const dynamicPlan = computeDynamicPlan(room, anchor);
    const terrain = room.getTerrain();

    const structureMap = new Map<string, StructureConstant[]>();
    const structures = StructureCache.getAllStructures(room);
    for (let i = 0; i < structures.length; i++) {
      const s = structures[i];
      const k = keyOf(s.pos.x, s.pos.y);
      const list = structureMap.get(k);
      if (list) {
        list.push(s.structureType);
      } else {
        structureMap.set(k, [s.structureType]);
      }
    }

    const siteMap = new Map<string, StructureConstant[]>();
    const mySites = StructureCache.getConstructionSites(room).filter((s) => s.my);
    for (let i = 0; i < mySites.length; i++) {
      const s = mySites[i];
      const k = keyOf(s.pos.x, s.pos.y);
      const list = siteMap.get(k);
      if (list) {
        list.push(s.structureType);
      } else {
        siteMap.set(k, [s.structureType]);
      }
    }

    let activeSitesCount = mySites.length;
    if (activeSitesCount >= MAX_CONSTRUCTION_SITES) return;

    const candidates: BuildTask[] = [];

    const planned = getPlannedStructures(room, rcl, layoutName, anchor);
    for (let i = 0; i < planned.length; i++) {
      const p = planned[i];
      const x = anchor.x + p.dx;
      const y = anchor.y + p.dy;
      const k = keyOf(x, y);
      const existing = structureMap.get(k);
      if (existing && existing.includes(p.type)) continue;
      
      candidates.push({
        type: p.type,
        x,
        y,
        priority: BUILD_PRIORITY[p.type] ?? 0,
        dist: Math.abs(p.dx) + Math.abs(p.dy)
      });
    }

    const roadKeys = [...dynamicPlan.roads];
    for (let i = 0; i < roadKeys.length; i++) {
      const roadKey = roadKeys[i];
      const colonIdx = roadKey.indexOf(":");
      const x = Number(roadKey.substring(0, colonIdx));
      const y = Number(roadKey.substring(colonIdx + 1));
      candidates.push({
        type: STRUCTURE_ROAD,
        x,
        y,
        priority: BUILD_PRIORITY[STRUCTURE_ROAD] ?? 0,
        dist: Math.abs(x - anchor.x) + Math.abs(y - anchor.y)
      });
    }

    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.dist - b.dist;
    });

    for (let ci = 0; ci < candidates.length; ci++) {
      if (activeSitesCount >= MAX_CONSTRUCTION_SITES) break;

      const task = candidates[ci];
      const k = keyOf(task.x, task.y);
      
      const existingStructs = structureMap.get(k);
      if (existingStructs && existingStructs.includes(task.type)) continue;

      const existingSites = siteMap.get(k);
      if (existingSites && existingSites.includes(task.type)) continue;

      if (canPlace(task.x, task.y, task.type, dynamicPlan.noBuild, terrain, existingStructs)) {
        const result = room.createConstructionSite(task.x, task.y, task.type);
        if (result === OK) {
          activeSitesCount++;
          const list = siteMap.get(k);
          if (list) {
            list.push(task.type);
          } else {
            siteMap.set(k, [task.type]);
          }
        }
      }
    }
  }
}
