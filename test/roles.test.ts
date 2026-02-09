import { describe, expect, test, jest } from '@jest/globals';
import Upgrader from '../src/modules/upgrader/index';
import Builder from '../src/modules/builder/index';

jest.mock('../src/utils/movement', () => ({
  smartMove: jest.fn(),
  parkOffRoad: jest.fn()
}));

// Mocks
const mockCreep = (role: string, storeEnergy: number, capacity: number, memory: any = {}) => {
  return {
    memory: { role, ...memory },
    store: {
      [RESOURCE_ENERGY]: storeEnergy,
      getFreeCapacity: jest.fn(() => capacity - storeEnergy),
      getUsedCapacity: jest.fn(() => storeEnergy),
      getCapacity: jest.fn(() => capacity)
    },
    say: jest.fn(),
    room: {
        memory: { energyLevel: 'HIGH' },
        controller: { pos: { x: 25, y: 25 } },
        find: jest.fn().mockReturnValue([]) // Default no haulers
    },
    pos: {
        findClosestByPath: jest.fn(),
        getRangeTo: jest.fn()
    },
    upgradeController: jest.fn(),
    withdraw: jest.fn(),
    pickup: jest.fn()
  } as any;
};

(global as any).RESOURCE_ENERGY = 'energy';
(global as any).FIND_DROPPED_RESOURCES = 1;
(global as any).FIND_MY_CREEPS = 2;
(global as any).FIND_STRUCTURES = 3;
(global as any).STRUCTURE_CONTAINER = 'container';
(global as any).STRUCTURE_STORAGE = 'storage';
(global as any).ERR_NOT_IN_RANGE = -9;

describe('Role State Logic', () => {
  
  test('Upgrader should switch to working if energy > 50%', () => {
    const creep = mockCreep('upgrader', 30, 50, { working: false });
    const upgrader = new Upgrader(creep);
    
    // 30/50 = 60% > 50%
    upgrader.checkState();
    
    expect(creep.memory.working).toBe(true);
    expect(creep.say).toHaveBeenCalledWith("⚡ work");
  });

  test('Upgrader should NOT switch to working if energy < 50%', () => {
    const creep = mockCreep('upgrader', 20, 50, { working: false });
    const upgrader = new Upgrader(creep);
    
    // 20/50 = 40% < 50%
    upgrader.checkState();
    
    expect(creep.memory.working).toBe(false);
  });

  test('Builder should switch to working if energy > 50%', () => {
    const creep = mockCreep('builder', 30, 50, { working: false });
    const builder = new Builder(creep);
    
    builder.checkState();
    
    expect(creep.memory.working).toBe(true);
  });
});
