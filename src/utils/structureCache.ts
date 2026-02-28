import { Cache } from "../core/Cache";

export default class StructureCache {
  static getStructures(
    room: Room,
    type: StructureConstant,
  ): Structure[] {
    return Cache.getTick(`sc:structures:${room.name}:${type}`, () =>
      room.find(FIND_STRUCTURES, { filter: { structureType: type } }),
    );
  }

  static getMyStructures(
    room: Room,
    type: StructureConstant,
  ): Structure[] {
    return Cache.getTick(`sc:myStructures:${room.name}:${type}`, () =>
      room.find(FIND_MY_STRUCTURES, { filter: { structureType: type } }),
    );
  }
  
  static getCreeps(room: Room, role?: string): Creep[] {
    const all = Cache.getTick(`sc:creeps:${room.name}:all`, () =>
      room.find(FIND_MY_CREEPS),
    );
    if (!role) return all;
    return Cache.getTick(`sc:creeps:${room.name}:role:${role}`, () =>
      all.filter((c) => c.memory.role === role),
    );
  }

  static getConstructionSites(room: Room): ConstructionSite[] {
    return Cache.getTick(`sc:sites:${room.name}`, () =>
      room.find(FIND_CONSTRUCTION_SITES),
    );
  }

  static getSources(room: Room): Source[] {
    return Cache.getTick(`sc:sources:${room.name}`, () => room.find(FIND_SOURCES));
  }
}
