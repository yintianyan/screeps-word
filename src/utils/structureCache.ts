// Heap Cache for Room Structures
// Reset every tick
const cache: {
  [roomName: string]: {
    tick: number;
    structures: {
      [type: string]: Structure[];
    };
    myStructures: {
      [type: string]: Structure[];
    };
    creeps: {
      [role: string]: Creep[];
    };
    constructionSites: ConstructionSite[];
    sources: Source[];
  };
} = {};

export default class StructureCache {
  static getStructures(
    room: Room,
    type: StructureConstant,
  ): Structure[] {
    this.ensureCache(room);
    if (!cache[room.name].structures[type]) {
      // Lazy load specific type?
      // Or just filter from all structures?
      // Finding ALL structures is expensive if we only need one type.
      // But finding specific type is fast.
      // Let's use room.find with filter, and cache it.
      cache[room.name].structures[type] = room.find(FIND_STRUCTURES, {
        filter: { structureType: type },
      });
    }
    return cache[room.name].structures[type];
  }

  static getMyStructures(
    room: Room,
    type: StructureConstant,
  ): Structure[] {
    this.ensureCache(room);
    if (!cache[room.name].myStructures[type]) {
      cache[room.name].myStructures[type] = room.find(FIND_MY_STRUCTURES, {
        filter: { structureType: type },
      });
    }
    return cache[room.name].myStructures[type];
  }
  
  static getCreeps(room: Room, role?: string): Creep[] {
      this.ensureCache(room);
      if (role) {
          if (!cache[room.name].creeps[role]) {
              cache[room.name].creeps[role] = room.find(FIND_MY_CREEPS, {
                  filter: (c) => c.memory.role === role
              });
          }
          return cache[room.name].creeps[role];
      }
      // All creeps (cached under 'all')
      if (!cache[room.name].creeps['all']) {
          cache[room.name].creeps['all'] = room.find(FIND_MY_CREEPS);
      }
      return cache[room.name].creeps['all'];
  }

  static getConstructionSites(room: Room): ConstructionSite[] {
    this.ensureCache(room);
    if (!cache[room.name].constructionSites) {
      cache[room.name].constructionSites = room.find(FIND_CONSTRUCTION_SITES);
    }
    return cache[room.name].constructionSites;
  }

  static getSources(room: Room): Source[] {
    this.ensureCache(room);
    if (!cache[room.name].sources) {
      cache[room.name].sources = room.find(FIND_SOURCES);
    }
    return cache[room.name].sources;
  }

  private static ensureCache(room: Room) {
    if (!cache[room.name] || cache[room.name].tick !== Game.time) {
      cache[room.name] = {
        tick: Game.time,
        structures: {},
        myStructures: {},
        creeps: {},
        constructionSites: null as any,
        sources: null as any,
      };
    }
  }
}
