import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import populationModule from '../src/components/populationManager';
import Cache from '../src/components/memoryManager';

// Mock game objects
(global as any).Game = {
  time: 100,
  creeps: {}
};

(global as any).WORK = 'work';
(global as any).CARRY = 'carry';
(global as any).MOVE = 'move';
(global as any).FIND_SOURCES = 105;
(global as any).TERRAIN_MASK_WALL = 1;
(global as any).STRUCTURE_CONTAINER = 'container';
(global as any).STRUCTURE_STORAGE = 'storage';
(global as any).RESOURCE_ENERGY = 'energy';
(global as any).FIND_STRUCTURES = 107;
(global as any).FIND_DROPPED_RESOURCES = 106;
(global as any).FIND_MY_CONSTRUCTION_SITES = 111;
(global as any).FIND_MY_STRUCTURES = 108;
(global as any).STRUCTURE_SPAWN = 'spawn';
(global as any).STRUCTURE_EXTENSION = 'extension';
(global as any).STRUCTURE_TOWER = 'tower';
(global as any).STRUCTURE_ROAD = 'road';
(global as any).STRUCTURE_WALL = 'constructedWall';
(global as any).STRUCTURE_RAMPART = 'rampart';

(global as any).STRUCTURE_LINK = 'link';
(global as any).STRUCTURE_EXTRACTOR = 'extractor';
(global as any).STRUCTURE_LAB = 'lab';
(global as any).STRUCTURE_TERMINAL = 'terminal';
(global as any).STRUCTURE_OBSERVER = 'observer';
(global as any).STRUCTURE_NUKER = 'nuker';
(global as any).STRUCTURE_POWER_SPAWN = 'powerSpawn';
(global as any).STRUCTURE_FACTORY = 'factory';
(global as any).Memory = {
  config: {},
  lifecycle: { registry: {} }
};

describe('Harvester Logic', () => {
  let room: any;
  let source: any;

  beforeEach(() => {
    source = { id: 'source1', pos: { x: 10, y: 10 } };
    room = {
      name: 'W1N1',
      find: jest.fn().mockReturnValue([source]),
      getTerrain: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue(0) // Plain
      }),
      memory: { energyLevel: 'HIGH' },
      controller: { level: 3 },
      storage: { store: { energy: 10000 } },
      energyAvailable: 500
    };
    
    // Reset Cache
    Cache.getCreepsByRole = jest.fn().mockReturnValue([]);
    Cache.getHeap = jest.fn((key: any, factory: any) => factory());
    Cache.getStructures = jest.fn().mockReturnValue([]);
  });

  test('should spawn 1 harvester if no harvesters exist', () => {
    Cache.getCreepsByRole = jest.fn().mockReturnValue([]);
    const targets = populationModule.calculateTargets(room);
    expect(targets.harvester).toBe(1);
  });

  test('should NOT spawn more harvesters if existing one has >= 5 WORK parts', () => {
    const bigHarvester = {
      memory: { role: 'harvester', sourceId: 'source1' },
      getActiveBodyparts: jest.fn().mockReturnValue(5)
    };
    Cache.getCreepsByRole = jest.fn().mockReturnValue([bigHarvester]);

    const targets = populationModule.calculateTargets(room);
    expect(targets.harvester).toBe(1); // Target matches current, so no new spawn
  });

  test('should spawn extra harvester if existing one is small (< 5 WORK) and in early game', () => {
    const smallHarvester = {
      memory: { role: 'harvester', sourceId: 'source1' },
      getActiveBodyparts: jest.fn().mockReturnValue(2)
    };
    Cache.getCreepsByRole = jest.fn().mockReturnValue([smallHarvester]);
    room.controller.level = 2; // Early game

    const targets = populationModule.calculateTargets(room);
    // Should allow more than 1 to fill spots (mock terrain returns plain everywhere, so many spots)
    // Code caps at 2
    expect(targets.harvester).toBe(2);
  });

  test('should NOT spawn extra harvester if existing one is small but room is stable (RCL 3+)', () => {
    const smallHarvester = {
      memory: { role: 'harvester', sourceId: 'source1' },
      getActiveBodyparts: jest.fn().mockReturnValue(2)
    };
    Cache.getCreepsByRole = jest.fn().mockReturnValue([smallHarvester]);
    room.controller.level = 3;
    room.memory.energyLevel = 'HIGH';

    const targets = populationModule.calculateTargets(room);
    expect(targets.harvester).toBe(1); // Wait for replacement
  });
});