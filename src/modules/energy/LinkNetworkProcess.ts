import { Process } from "../../core/Process";
import { processRegistry } from "../../core/ProcessRegistry";

type LinkIds = { source: string[]; hub: string | null; controller: string | null };

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function isInsideRoom(x: number, y: number): boolean {
  return x >= 2 && x <= 47 && y >= 2 && y <= 47;
}

function pickBuildPosNear(
  room: Room,
  anchor: RoomPosition,
  range: number,
): { x: number; y: number } | null {
  const terrain = room.getTerrain();
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (!isInsideRoom(x, y)) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      const pos = new RoomPosition(x, y, room.name);
      const structures = pos.lookFor(LOOK_STRUCTURES);
      if (structures.length > 0) continue;
      const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
      if (sites.length > 0) continue;
      return { x, y };
    }
  }
  return null;
}

function ensureLinkSites(room: Room): void {
  const rcl = room.controller?.level ?? 0;
  if (rcl < 5) return;
  if (
    room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    }).length > 0
  )
    return;

  const lastPlan = room.memory.links?.lastPlan;
  if (lastPlan != null && Game.time - lastPlan < 200) return;
  room.memory.links = room.memory.links ?? {};
  room.memory.links.lastPlan = Game.time;

  const links = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_LINK,
  }) as StructureLink[];

  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    const has = links.some((l) => l.pos.inRangeTo(source.pos, 2));
    if (!has) {
      const p = pickBuildPosNear(room, source.pos, 2);
      if (p) {
        room.createConstructionSite(p.x, p.y, STRUCTURE_LINK);
        return;
      }
    }
  }

  const controller = room.controller;
  if (controller) {
    const has = links.some((l) => l.pos.inRangeTo(controller.pos, 3));
    if (!has) {
      const p = pickBuildPosNear(room, controller.pos, 3);
      if (p) {
        room.createConstructionSite(p.x, p.y, STRUCTURE_LINK);
        return;
      }
    }
  }

  const storage = room.storage;
  const spawns = room.find(FIND_MY_SPAWNS);
  const hubAnchor = storage?.pos ?? spawns[0]?.pos ?? null;
  if (hubAnchor) {
    const has =
      (storage && links.some((l) => l.pos.inRangeTo(storage.pos, 2))) ||
      (spawns.length > 0 &&
        links.some((l) => spawns.some((s) => l.pos.inRangeTo(s.pos, 3))));
    if (!has) {
      const p = pickBuildPosNear(room, hubAnchor, storage ? 2 : 3);
      if (p) {
        room.createConstructionSite(p.x, p.y, STRUCTURE_LINK);
      }
    }
  }
}

function categorizeLinks(room: Room, links: StructureLink[]): LinkIds {
  const source: string[] = [];
  let hub: string | null = null;
  let controller: string | null = null;

  const sources = room.find(FIND_SOURCES);
  const storage = room.storage;
  const controllerObj = room.controller;
  const spawns = room.find(FIND_MY_SPAWNS);

  for (const link of links) {
    if (sources.some((s) => s.pos.inRangeTo(link.pos, 2))) {
      source.push(link.id);
      continue;
    }
    if (controllerObj && link.pos.inRangeTo(controllerObj.pos, 3)) {
      controller = link.id;
      continue;
    }
    if (
      (storage && link.pos.inRangeTo(storage.pos, 2)) ||
      spawns.some((s) => link.pos.inRangeTo(s.pos, 3))
    ) {
      hub = link.id;
    }
  }

  return { source, hub, controller };
}

function getLinkObjects(room: Room): {
  source: StructureLink[];
  hub: StructureLink | null;
  controller: StructureLink | null;
} {
  const mem = room.memory.links;
  if (!mem || !mem.lastScan || Game.time - mem.lastScan > 100) {
    const links = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    }) as StructureLink[];
    const ids = categorizeLinks(room, links);
    room.memory.links = room.memory.links ?? {};
    room.memory.links.source = ids.source;
    room.memory.links.hub = ids.hub ?? undefined;
    room.memory.links.controller = ids.controller ?? undefined;
    room.memory.links.lastScan = Game.time;
  }

  const source = (room.memory.links?.source ?? [])
    .map((id) => Game.getObjectById(id as Id<StructureLink>))
    .filter((l): l is StructureLink => l instanceof StructureLink);
  const hubId = room.memory.links?.hub;
  const controllerId = room.memory.links?.controller;
  const hub = hubId
    ? (Game.getObjectById(hubId as Id<StructureLink>) as StructureLink | null)
    : null;
  const controller = controllerId
    ? (Game.getObjectById(controllerId as Id<StructureLink>) as StructureLink | null)
    : null;

  return { source, hub, controller };
}

function runTransfers(
  source: StructureLink[],
  hub: StructureLink | null,
  controller: StructureLink | null,
): void {
  const controllerWant = 600;
  const hubWant = 400;

  for (const s of source) {
    if (s.cooldown > 0) continue;
    if (s.store.getUsedCapacity(RESOURCE_ENERGY) < 400) continue;

    if (
      controller &&
      controller.store.getUsedCapacity(RESOURCE_ENERGY) < controllerWant
    ) {
      s.transferEnergy(controller);
      continue;
    }
    if (hub && hub.store.getUsedCapacity(RESOURCE_ENERGY) < hubWant) {
      s.transferEnergy(hub);
      continue;
    }
  }

  if (
    hub &&
    controller &&
    hub.cooldown === 0 &&
    hub.store.getUsedCapacity(RESOURCE_ENERGY) > 600 &&
    controller.store.getUsedCapacity(RESOURCE_ENERGY) < 400
  ) {
    hub.transferEnergy(controller);
  }
}

export class LinkNetworkProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      ensureLinkSites(room);
      const rcl = room.controller?.level ?? 0;
      if (rcl < 5) continue;
      const { source, hub, controller } = getLinkObjects(room);
      if (source.length + (hub ? 1 : 0) + (controller ? 1 : 0) < 2) continue;
      runTransfers(source, hub, controller);
    }
  }
}

processRegistry.register(LinkNetworkProcess, "LinkNetworkProcess");
