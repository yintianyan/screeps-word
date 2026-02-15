import { describe, expect, test, jest } from "@jest/globals";
import populationModule from "../src/components/populationManager";
import Cache from "../src/components/memoryManager";

describe("Hauler suppression with links", () => {
  test("should reduce hauler needs when hub link + source link exist (RCL5+)", () => {
    (global as any).Memory = { config: {} };
    (global as any).FIND_SOURCES = 1;
    (global as any).FIND_STRUCTURES = 2;
    (global as any).FIND_MY_SPAWNS = 3;
    (global as any).FIND_MY_CONSTRUCTION_SITES = 4;
    (global as any).FIND_DROPPED_RESOURCES = 5;
    (global as any).STRUCTURE_LINK = "link";
    (global as any).STRUCTURE_CONTAINER = "container";
    (global as any).STRUCTURE_WALL = "constructedWall";
    (global as any).STRUCTURE_RAMPART = "rampart";
    (global as any).RESOURCE_ENERGY = "energy";
    (global as any).TERRAIN_MASK_WALL = 1;

    const source: any = {
      id: "s1",
      pos: { x: 10, y: 10, inRangeTo: (obj: any, r: number) => obj.pos && r >= 2 },
    };

    const spawn: any = { id: "sp1", pos: { x: 25, y: 25, inRangeTo: () => true } };

    const sourceLink: any = {
      id: "l_source",
      structureType: "link",
      pos: { inRangeTo: (t: any, r: number) => t.id === "s1" && r >= 2 },
    };

    const hubLink: any = {
      id: "l_hub",
      structureType: "link",
      pos: { inRangeTo: (t: any, r: number) => t.id === "sp1" && r >= 4 },
    };

    const room: any = {
      name: "W1N1",
      controller: { level: 5 },
      energyAvailable: 800,
      energyCapacityAvailable: 800,
      memory: { energyManager: { level: 0 } },
      storage: undefined,
      getTerrain: () => ({ get: () => 0 }),
      find: jest.fn((type: any, opts?: any) => {
        if (type === 1) return [source];
        if (type === 2) return [sourceLink, hubLink].filter((s) => opts.filter(s));
        if (type === 3) return [spawn];
        return [];
      }),
    };

    Cache.getHeap = jest.fn((k: any, f: any) => f());
    Cache.getTick = jest.fn((k: any, f: any) => f());
    Cache.getStructures = jest.fn().mockReturnValue([]);
    Cache.getCreepsByRole = jest.fn().mockReturnValue([]);

    const needs = populationModule.getHaulerNeeds(room);
    expect(needs["s1"]).toBe(0);

    const targets = populationModule.calculateTargets(room);
    expect(targets.hauler).toBeGreaterThanOrEqual(1);
    expect(targets.hauler).toBeLessThanOrEqual(3);
  });
});
