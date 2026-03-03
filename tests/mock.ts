
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

const g = global as any;
g.Game = Game as any;
g.Memory = Memory as any;
g.Constants = {};
