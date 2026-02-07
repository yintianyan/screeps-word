/**
 * Mocks for Screeps Game Objects
 * Simulates the game environment for unit testing
 */

const MockRoomPosition = class {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }

  inRangeTo(target, range) {
    const pos = target.pos || target;
    if (pos.roomName && pos.roomName !== this.roomName) return false;
    return (
      Math.abs(pos.x - this.x) <= range && Math.abs(pos.y - this.y) <= range
    );
  }

  getRangeTo(target) {
    const pos = target.pos || target;
    return Math.max(Math.abs(pos.x - this.x), Math.abs(pos.y - this.y));
  }
};

const MockRoom = class {
  constructor(name) {
    this.name = name;
    this.energyAvailable = 0;
    this.energyCapacityAvailable = 0;
    this.controller = {
      my: true,
      level: 1,
      ticksToDowngrade: 10000,
      pos: new MockRoomPosition(25, 25, name),
    };
    this.storage = {
      structureType: "storage",
      store: {
        energy: 0,
        [global.RESOURCE_ENERGY]: 0,
        getCapacity: () => 1000000,
        getFreeCapacity: () => 1000000,
      },
      pos: new MockRoomPosition(20, 20, name),
    };
    this.memory = {};

    // Data stores
    this.sources = [];
    this.creeps = [];
    this.structures = [];
    this.sites = [];
    this.dropped = [];
  }

  find(type, opts) {
    // Simple mock implementation
    if (type === "FIND_SOURCES") return this.sources;
    if (type === "FIND_MY_CREEPS" || type === "FIND_CREEPS") {
      if (opts && opts.filter) return this.creeps.filter(opts.filter);
      return this.creeps;
    }
    if (type === "FIND_STRUCTURES") {
      if (opts && opts.filter) return this.structures.filter(opts.filter);
      return this.structures;
    }
    if (type === "FIND_CONSTRUCTION_SITES") return this.sites;
    if (type === "FIND_DROPPED_RESOURCES") return this.dropped;
    return [];
  }
};

const MockCreep = class {
  constructor(name, role, room) {
    this.name = name;
    this.room = room;
    this.memory = { role: role, idleTicks: 0 };
    this.store = { energy: 0 };
    this.pos = new MockRoomPosition(25, 25, room.name);
    this.ticksToLive = 1500;
    this.my = true; // Default to my creep
  }
};

const MockStructure = class {
  constructor(type, pos, storeEnergy = 0) {
    this.structureType = type;
    this.pos = pos || new MockRoomPosition(10, 10, "E1N1");
    this.store = {
      energy: storeEnergy,
      [global.RESOURCE_ENERGY]: storeEnergy,
      getCapacity: (res) => 2000,
      getFreeCapacity: (res) => 2000 - storeEnergy,
    };
  }
};

// Mock PathFinder
const MockCostMatrix = class {
  constructor() {
    this._bits = new Uint8Array(2500);
  }
  set(x, y, val) {
    this._bits[y * 50 + x] = val;
  }
  get(x, y) {
    return this._bits[y * 50 + x];
  }
};

module.exports = {
  MockRoom,
  MockCreep,
  MockStructure,
  MockRoomPosition,
  setupGlobal: () => {
    global.Game = {
      time: 100,
      rooms: {},
      creeps: {},
      cpu: { getUsed: () => 0 },
    };
    global.Memory = { creeps: {}, config: {} };
    global.FIND_SOURCES = "FIND_SOURCES";
    global.FIND_MY_CREEPS = "FIND_MY_CREEPS";
    global.FIND_CREEPS = "FIND_CREEPS";
    global.FIND_STRUCTURES = "FIND_STRUCTURES";
    global.FIND_CONSTRUCTION_SITES = "FIND_CONSTRUCTION_SITES";
    global.FIND_DROPPED_RESOURCES = "FIND_DROPPED_RESOURCES";
    global.STRUCTURE_CONTAINER = "container";
    global.STRUCTURE_EXTENSION = "extension";
    global.STRUCTURE_SPAWN = "spawn";
    global.STRUCTURE_TOWER = "tower";
    global.STRUCTURE_STORAGE = "storage";
    global.RESOURCE_ENERGY = "energy";

    global.PathFinder = {
      CostMatrix: MockCostMatrix,
    };
  },
};
