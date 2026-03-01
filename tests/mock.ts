
export const Game = {
  creeps: {},
  rooms: {},
  spawns: {},
  time: 12345,
  cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
  getObjectById: jest.fn(),
  notify: jest.fn(),
};

export const Memory = {
  creeps: {},
  rooms: {},
  spawns: {},
  flags: {},
};

global.Game = Game as any;
global.Memory = Memory as any;
global.Constants = {}; // Add screeps constants if needed
