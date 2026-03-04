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

// 优先级定义 (数值越高越优先)
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

// 并发工地限制 (按阶段规划的核心：不要一次性铺太多)
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
  structureMap: Map<string, StructureConstant[]>,
): boolean {
  if (!isInsideRoom(x, y)) return false;
  
  // 检查是否在保留区域 (除了路)
  if (type !== STRUCTURE_ROAD && noBuild.has(keyOf(x, y))) return false;
  
  // 检查地形
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

  // 检查现有建筑冲突
  const existing = structureMap.get(keyOf(x, y)) || [];
  
  if (type === STRUCTURE_RAMPART) {
    // Rampart 不能建在 Wall 上，其他都可以
    return !existing.includes(STRUCTURE_WALL);
  }
  
  if (type === STRUCTURE_ROAD) {
    // Road 不能建在非 Road/Rampart/Container 的建筑上 (通常)
    // 但其实 Road 可以和大多数 walkable 建筑共存，除了 Wall/Spawn/Extension 等阻挡物
    // 简单起见，如果已经有非路非 Rampart 的东西，且它是阻挡的，就不能建路 (虽然 creep 能走)
    // 实际上 Screeps 允许 Road 建在任何地方，除了 Wall?
    // 稳妥起见，如果已有 Road，返回 false (不需要再建)
    if (existing.includes(STRUCTURE_ROAD)) return false;
    if (existing.includes(STRUCTURE_WALL)) return false;
    return true;
  }

  // 其他建筑 (Extension, Spawn, etc.)
  if (existing.length > 0) {
    // 如果只有 Road/Rampart，可以建
    const blockers = existing.filter(t => t !== STRUCTURE_ROAD && t !== STRUCTURE_RAMPART);
    if (blockers.length > 0) return false;
  }

  return true;
}

export class Build {
  public static run(room: Room): void {
    if (!room.controller?.my) return;
    if (Game.cpu.bucket < config.CPU.BUCKET_LIMIT) return;

    const anchor = getAnchor(room);
    if (!anchor) return;

    // 初始化内存
    if (!room.memory.planner)
      room.memory.planner = { layout: getLayoutName(room) };
    if (!room.memory.planner.anchor) room.memory.planner.anchor = anchor;

    const rcl = room.controller.level;
    const layoutName = getLayoutName(room);
    
    // 1. 获取动态规划数据 (路网与保留区)
    const dynamicPlan = computeDynamicPlan(room, anchor);

    // 2. 收集所有已存在的建筑和工地，构建快速查询表
    const structureMap = new Map<string, StructureConstant[]>();
    StructureCache.getAllStructures(room).forEach((s) => {
      const k = keyOf(s.pos.x, s.pos.y);
      const list = structureMap.get(k) || [];
      list.push(s.structureType);
      structureMap.set(k, list);
    });

    const siteMap = new Map<string, StructureConstant[]>();
    const mySites = StructureCache.getConstructionSites(room).filter(
      (s) => s.my,
    );
    mySites.forEach((s) => {
      const k = keyOf(s.pos.x, s.pos.y);
      const list = siteMap.get(k) || [];
      list.push(s.structureType);
      siteMap.set(k, list);
    });

    // 3. 统计当前活跃工地数量
    let activeSitesCount = mySites.length;
    if (activeSitesCount >= MAX_CONSTRUCTION_SITES) return; // 达到并发限制，跳过规划

    // 4. 生成所有候选任务
    type BuildTask = {
      type: BuildableStructureConstant;
      x: number;
      y: number;
      priority: number;
      dist: number;
    };
    const candidates: BuildTask[] = [];

    // 4.1 静态布局任务
    const planned = getPlannedStructures(room, rcl, layoutName, anchor);
    
    // [Fix] 过滤掉已经存在的建筑 (虽然 placeOne 里也会查，但在这里过滤可以减少无效任务进入队列，提高效率)
    // 同时，确保我们不会因为 limit 限制而漏掉低级建筑的修补 (例如 RCL5 时，Extension 被拆了，需要重建)
    // plannedStructuresForRcl 返回的是当前 RCL 应有的所有建筑列表，所以只要遍历这个列表，
    // 缺啥补啥，就能保证建筑被“规划完”。
    
    for (const p of planned) {
      const x = anchor.x + p.dx;
      const y = anchor.y + p.dy;
      
      // 快速检查：如果该位置已有同类型建筑，则无需加入候选队列
      const k = keyOf(x, y);
      const existing = structureMap.get(k);
      if (existing && existing.includes(p.type)) continue;
      
      candidates.push({
        type: p.type,
        x,
        y,
        priority: BUILD_PRIORITY[p.type] ?? 0,
        dist: Math.abs(p.dx) + Math.abs(p.dy) // 曼哈顿距离作为次要排序
      });
    }

    // 4.2 动态道路任务
    for (const roadKey of dynamicPlan.roads) {
      const parts = roadKey.split(":");
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      candidates.push({
        type: STRUCTURE_ROAD,
        x,
        y,
        priority: BUILD_PRIORITY[STRUCTURE_ROAD] ?? 0,
        dist: Math.abs(x - anchor.x) + Math.abs(y - anchor.y)
      });
    }

    // 5. 排序候选任务 (优先级降序 -> 距离升序)
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.dist - b.dist;
    });

    // 6. 遍历并发布任务 (直到填满并发额度)
    for (const task of candidates) {
      if (activeSitesCount >= MAX_CONSTRUCTION_SITES) break;

      const k = keyOf(task.x, task.y);
      
      // 检查是否已建
      const existingStructs = structureMap.get(k);
      if (existingStructs && existingStructs.includes(task.type)) continue;

      // 检查是否已有工地
      const existingSites = siteMap.get(k);
      if (existingSites && existingSites.includes(task.type)) {
        // 已经是活跃工地，跳过
        continue; 
      }

      // 检查是否可建
      if (canPlace(room, task.x, task.y, task.type, dynamicPlan.noBuild, structureMap)) {
        const result = room.createConstructionSite(task.x, task.y, task.type);
        if (result === OK) {
          activeSitesCount++;
          // 更新缓存，防止同 tick 重复发布 (虽然 activeSitesCount 限制了)
          const list = siteMap.get(k) || [];
          list.push(task.type);
          siteMap.set(k, list);
        }
      }
    }
  }
}
