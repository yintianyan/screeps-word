import { config } from "../../config";
import type { LayoutName } from "./Layouts";
import { plannedStructuresForRcl } from "./Layouts";
import { findCoreAnchor } from "./DistanceTransform";

type Anchor = { x: number; y: number };
type DynamicPlan = {
  roads: Set<string>;
  noBuild: Set<string>;
};

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

function keyOf(x: number, y: number): string {
  return `${x}:${y}`;
}

function parseKey(key: string): { x: number; y: number } | null {
  const parts = key.split(":");
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
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
  const structures = room.find(FIND_STRUCTURES);
  for (const s of structures) {
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
  for (const s of sources) targets.push(s.pos);

  const matrix = buildBaseMatrix(room);
  for (const target of targets) {
    const res = PathFinder.search(hub, { pos: target, range: 1 }, {
      plainCost: 2,
      swampCost: 8,
      maxOps: 3000,
      roomCallback: () => matrix,
    });
    for (const pos of res.path) {
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
  room: Room,
  x: number,
  y: number,
  type: BuildableStructureConstant,
  noBuild: Set<string>,
): boolean {
  if (!isInsideRoom(x, y)) return false;
  if (type !== STRUCTURE_ROAD && noBuild.has(keyOf(x, y))) return false;
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

  const pos = new RoomPosition(x, y, room.name);
  const structures = pos.lookFor(LOOK_STRUCTURES);

  // Allow roads on ramparts and ramparts on anything
  if (type === STRUCTURE_RAMPART) {
    if (structures.some((s) => s.structureType === STRUCTURE_WALL))
      return false;
    return true;
  }
  if (type === STRUCTURE_ROAD) {
    if (
      structures.some(
        (s) =>
          s.structureType !== STRUCTURE_RAMPART &&
          s.structureType !== STRUCTURE_ROAD,
      )
    )
      return false;
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
    if (structures.some((s) => s.structureType === STRUCTURE_ROAD))
      return false;
    const blocker = structures.find(
      (s) =>
        s.structureType !== STRUCTURE_RAMPART &&
        s.structureType !== STRUCTURE_ROAD,
    );
    if (blocker) return false;
  }

  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.length > 0) {
    if (sites.every((s) => s.structureType === STRUCTURE_ROAD)) return true;
    return false;
  }

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
  if (structures.some((s) => s.structureType === type)) return false;

  // Check if site exists
  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.some((s) => s.structureType === type)) return false;
  if (sites.length > 0) {
    if (
      type !== STRUCTURE_ROAD &&
      sites.every((s) => s.structureType === STRUCTURE_ROAD)
    ) {
      const creeps = room.find(FIND_MY_CREEPS);
      for (const s of sites) {
        if (
          s.progress > 0 ||
          creeps.some((c) => (c.memory as any).targetId === s.id)
        ) {
          return false;
        }
      }
      for (const s of sites) s.remove();
    } else {
      return false;
    }
  }

  const result = room.createConstructionSite(x, y, type);
  return result === OK;
}

function placeDynamicRoads(
  room: Room,
  anchor: Anchor,
  roads: Set<string>,
  budget: number,
): number {
  if (budget <= 0 || roads.size === 0) return 0;
  const ordered = [...roads]
    .map((k) => parseKey(k))
    .filter((p): p is { x: number; y: number } => p != null)
    .sort(
      (a, b) =>
        Math.abs(a.x - anchor.x) +
          Math.abs(a.y - anchor.y) -
        (Math.abs(b.x - anchor.x) + Math.abs(b.y - anchor.y)),
    );
  let placed = 0;
  for (const p of ordered) {
    if (placed >= budget) break;
    if (placeOne(room, STRUCTURE_ROAD, p.x, p.y)) placed++;
  }
  return placed;
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

/**
 * 建筑规划执行器
 *
 * 负责在房间内实际放置工地 (ConstructionSite)。
 *
 * 核心逻辑：
 * 1. 确定房间布局锚点 (Anchor)。
 * 2. 获取当前 RCL 允许的建筑列表。
 * 3. 检查现有建筑和工地。
 * 4. 按照布局模板放置新的工地。
 * 5. 动态规划道路 (连接 Hub 到 Source/Controller)。
 * 6. 自动清理阻挡发展的旧道路。
 */
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

    const allSites = room.find(FIND_MY_CONSTRUCTION_SITES);
    const roadSites = allSites.filter(
      (s) => s.structureType === STRUCTURE_ROAD,
    );
    const nonRoadSites = allSites.length - roadSites.length;
    if (nonRoadSites >= 10) return;

    let placed = 0;
    const maxPerTick = 3;

    // 1. Core Layout Structures
    const planned = plannedStructuresForRcl(layoutName, rcl);

    const extBuilt = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_EXTENSION,
    }).length;
    const extDesired = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;
    const towerBuilt = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }).length;
    const towerDesired = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] ?? 0;
    const allowRoads = extBuilt >= extDesired && towerBuilt >= towerDesired;

    if (!allowRoads && allSites.length >= 90 && roadSites.length > 0) {
      const toRemove = Math.min(roadSites.length, allSites.length - 80);
      const creeps = room.find(FIND_MY_CREEPS);
      let removed = 0;
      for (let i = 0; i < roadSites.length && removed < toRemove; i++) {
        const s = roadSites[i];
        if (
          s.progress > 0 ||
          creeps.some((c) => (c.memory as any).targetId === s.id)
        )
          continue;
        s.remove();
        removed++;
      }
    }

    for (const p of planned) {
      if (placed >= maxPerTick) break;
      if (p.type === STRUCTURE_ROAD && !allowRoads) continue;
      const x = anchor.x + p.dx;
      const y = anchor.y + p.dy;

      if (canPlace(room, x, y, p.type, dynamicPlan.noBuild)) {
        if (placeOne(room, p.type, x, y)) placed++;
      }
    }

    // 2. Roads to Sources / Controller (if budget left)
    if (allowRoads && rcl >= 3 && placed < maxPerTick && nonRoadSites < 8) {
      const hub = new RoomPosition(anchor.x, anchor.y, room.name);
      const roadBudget = maxPerTick - placed;
      let roadPlaced = 0;

      roadPlaced += placeDynamicRoads(
        room,
        anchor,
        dynamicPlan.roads,
        roadBudget - roadPlaced,
      );

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
