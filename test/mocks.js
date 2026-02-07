/**
 * Mocks for Screeps Game Objects
 * Simulates the game environment for unit testing
 */

const MockRoom = class {
  constructor(name) {
    this.name = name;
    this.energyAvailable = 0;
    this.energyCapacityAvailable = 0;
    this.controller = { my: true, level: 1, ticksToDowngrade: 10000 };
    this.storage = { store: { energy: 0 } };
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
    if (type === "FIND_MY_CREEPS") {
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
    this.pos = { x: 25, y: 25, inRangeTo: () => false };
    this.ticksToLive = 1500;
  }
};

const MockStructure = class {
  constructor(type, pos, storeEnergy = 0) {
    this.structureType = type;
    this.pos = pos || { x: 10, y: 10, inRangeTo: () => false };
    this.store = { energy: storeEnergy };
  }
};

module.exports = {
  MockRoom,
  MockCreep,
  MockStructure,
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
    global.FIND_STRUCTURES = "FIND_STRUCTURES";
    global.FIND_CONSTRUCTION_SITES = "FIND_CONSTRUCTION_SITES";
    global.FIND_DROPPED_RESOURCES = "FIND_DROPPED_RESOURCES";
    global.STRUCTURE_CONTAINER = "container";
    global.STRUCTURE_EXTENSION = "extension";
    global.STRUCTURE_SPAWN = "spawn";
    global.STRUCTURE_TOWER = "tower";
    global.STRUCTURE_STORAGE = "storage";
    global.RESOURCE_ENERGY = "energy";
  },
};
