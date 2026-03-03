import { Cache } from "../core/Cache";

/**
 * 结构缓存工具
 * 
 * 封装了 room.find，使用 Tick Cache 缓存查找结果。
 * 避免同一 tick 内多次调用 room.find 造成的 CPU 浪费。
 */
export default class StructureCache {
  /**
   * 获取房间内的所有指定类型结构 (FIND_STRUCTURES)
   */
  static getStructures(
    room: Room,
    type: StructureConstant,
  ): Structure[] {
    return Cache.getTick(`sc:structures:${room.name}:${type}`, () =>
      room.find(FIND_STRUCTURES, { filter: { structureType: type } }),
    );
  }

  /**
   * 获取房间内我拥有的指定类型结构 (FIND_MY_STRUCTURES)
   */
  static getMyStructures(
    room: Room,
    type: StructureConstant,
  ): Structure[] {
    return Cache.getTick(`sc:myStructures:${room.name}:${type}`, () =>
      room.find(FIND_MY_STRUCTURES, { filter: { structureType: type } }),
    );
  }
  
  /**
   * 获取房间内的 Creep
   * 
   * @param role (可选) 过滤指定角色的 Creep
   */
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
