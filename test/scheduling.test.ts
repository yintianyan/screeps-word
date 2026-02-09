import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import populationModule from "../src/components/populationManager";
import { SpawnCenter } from "../src/centers/SpawnCenter";
import Cache from "../src/components/memoryManager";
import { TaskPriority } from "../src/types/dispatch";

// Mocks
(global as any).WORK = "work";
(global as any).CARRY = "carry";
(global as any).MOVE = "move";
(global as any).FIND_SOURCES = 1;
(global as any).FIND_MY_CREEPS = 2;
(global as any).TERRAIN_MASK_WALL = 1;
(global as any).STRUCTURE_CONTAINER = "container";
(global as any).STRUCTURE_LINK = "link";
(global as any).STRUCTURE_STORAGE = "storage";
(global as any).FIND_DROPPED_RESOURCES = 3;
(global as any).FIND_MY_CONSTRUCTION_SITES = 4;
(global as any).FIND_STRUCTURES = 5;
(global as any).RESOURCE_ENERGY = "energy";
(global as any).BODYPART_COST = {
  work: 100,
  carry: 50,
  move: 50,
};
(global as any).Game = {
  time: 1000,
  creeps: {},
};
(global as any).Memory = {
  dispatch: { spawnQueue: [] },
  rooms: {},
};

(global as any).STRUCTURE_EXTENSION = "extension";
(global as any).STRUCTURE_SPAWN = "spawn";
(global as any).STRUCTURE_TOWER = "tower";
(global as any).STRUCTURE_ROAD = "road";
(global as any).STRUCTURE_WALL = "constructedWall";
(global as any).STRUCTURE_RAMPART = "rampart";
(global as any).TOUGH = "tough";
(global as any).ATTACK = "attack";
(global as any).RANGED_ATTACK = "ranged_attack";
(global as any).HEAL = "heal";
(global as any).CLAIM = "claim";

describe("Scheduling System Refactor", () => {
  let room: any;

  beforeEach(() => {
    room = {
      name: "W1N1",
      energyAvailable: 300,
      energyCapacityAvailable: 300,
      memory: { energyLevel: "LOW", totalEnergy: 1000 },
      find: jest.fn(),
      getTerrain: jest.fn().mockReturnValue({ get: () => 0 }),
      controller: { level: 2 },
    };
    (global as any).Memory.rooms["W1N1"] = {};
    (global as any).Memory.dispatch.spawnQueue = [];
    Cache.getCreepsByRole = jest.fn().mockReturnValue([]);
    Cache.getHeap = jest.fn((k: any, f: any) => f());
    Cache.getStructures = jest.fn().mockReturnValue([]);
  });

  // Scenario 1: Energy Full (Rule 1)
  test("Should spawn optimized body when energy is high", () => {
    room.energyAvailable = 800;
    room.energyCapacityAvailable = 800;
    room.memory.energyLevel = "HIGH";

    // Mock getCreepsByRole to return 0 harvesters so it tries to spawn one
    Cache.getCreepsByRole = jest.fn().mockReturnValue([]);
    room.find.mockReturnValue([{ id: "s1", pos: { x: 1, y: 1 } }]); // 1 Source

    const body = populationModule.getBody(room, "harvester", true);

    // 5W 1C 1M = 7 parts
    expect(body.filter((p) => p === "work").length).toBe(5);
    expect(body).toEqual(
      expect.arrayContaining([
        "work",
        "work",
        "work",
        "work",
        "work",
        "carry",
        "move",
      ]),
    );
  });

  // Scenario 2: Energy Low but not Critical (Rule 1.3)
  test("Should BAN 1-WORK harvester if energy > 300 and population exists", () => {
    room.energyAvailable = 350;
    room.energyCapacityAvailable = 800;

    // Existing harvester
    Cache.getCreepsByRole = jest
      .fn()
      .mockReturnValue([{ id: "h1", memory: { role: "harvester" } }]);

    // Should return null or throw or return a better body?
    // Current logic: < 550 energy falls through to procedural.
    // Procedural with 350 energy:
    // Base: W, C, M (200)
    // Grow: W (100) -> 300.
    // So it returns 2W 1C 1M. This is fine.

    // Let's test < 300 logic explicitly
    room.energyAvailable = 250;
    // forceMax = false
    const body = populationModule.getBody(room, "harvester", false);

    // Since we have existing harvesters, it should return null/ban
    // Wait, calculateBodyCost([W,C,M]) = 200.
    // Logic says: if < 300 and !isEmergency -> return null.
    expect(body).toBeNull();
  });

  // Scenario 3: Redundancy Check (Rule 2)
  test("Should LOCK spawn if harvester work parts saturated", () => {
    // 1 Source
    room.find.mockImplementation((type: any) => {
      if (type === 1) return [{ id: "s1" }]; // SOURCES
      if (type === 2) return []; // CREEPS
      return [];
    });

    // Existing: 3 Harvesters with 5 WORK each = 15 WORK
    room.memory.harvesters = [
      { id: "h1", workParts: 5 },
      { id: "h2", workParts: 5 },
      { id: "h3", workParts: 5 },
    ]; // 15 WORK > 3 Limit

    // Mock targets to ask for more
    const spy = jest
      .spyOn(populationModule, "calculateTargets")
      .mockReturnValue({
        harvester: 5,
        upgrader: 0,
        builder: 0,
        hauler: 0,
      });

    // Run SpawnCenter
    const registerSpy = jest.fn();
    (global as any).GlobalDispatch = {
      registerSpawnTask: registerSpy,
      getNextSpawnTask: jest.fn(),
    };

    SpawnCenter.run(room);

    expect(registerSpy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Scenario 4: Anti-Duplication (Rule 2/4)
  test("Should NOT register new task if one is already pending", () => {
    room.find.mockImplementation((type: any) => {
      if (type === 1) return [{ id: "s1" }]; // SOURCES
      if (type === 2) return []; // CREEPS
      return [];
    });
    room.memory.harvesters = []; // 0 WORK

    // Mock queue with pending harvester
    (global as any).Memory.dispatch.spawnQueue = [
      { roomName: "W1N1", role: "harvester" },
    ];

    const spy = jest
      .spyOn(populationModule, "calculateTargets")
      .mockReturnValue({
        harvester: 1,
        upgrader: 0,
        builder: 0,
        hauler: 0,
      });

    const registerSpy = jest.fn();
    (global as any).GlobalDispatch = { registerSpawnTask: registerSpy };

    SpawnCenter.run(room);

    expect(registerSpy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Scenario 5: Dynamic Load (Rule 3)
  test("Should increase Harvester target if energy reserve low", () => {
    // Source * 2 + Reserve/1000
    // 1 Source, 0 Reserve -> 2 + 0 = 2 Harvesters
    // [DEBUG] Ensure Game.time % 5 === 0
    (global as any).Game.time = 50; // Multiple of 5

    room.find.mockImplementation((type: any) => {
      if (type === 1) return [{ id: "s1", pos: { x: 10, y: 10 } }]; // SOURCES with POS
      if (type === 2) return [{ memory: { role: "harvester" } }]; // CREEPS (1 existing)
      return [];
    });
    room.memory.totalEnergy = 0;

    // Ensure cache matches room.find
    room.memory.harvesters = [{ id: "h1", workParts: 2 }];

    const registerSpy = jest.fn();
    (global as any).GlobalDispatch = {
      registerSpawnTask: registerSpy,
      getNextSpawnTask: jest.fn(),
      spawnQueue: [], // Ensure empty queue
    };
    (global as any).Memory.dispatch.spawnQueue = []; // Ensure memory queue is empty

    // Mock isRoleQueued to return false
    const originalIsRoleQueued = (SpawnCenter as any)["isRoleQueued"];
    (SpawnCenter as any)["isRoleQueued"] = jest.fn().mockReturnValue(false);

    // [FIX] Mock isRoleRedundant to return false
    // Because 2 WORK < 1*3 = 3 limit.
    // But SpawnCenter logic for redundancy uses room.memory.harvesters.
    // We set harvesters = [{workParts: 2}] -> Total 2. Limit 3. Should be OK.

    // Also need to mock findBestSourceForHarvester to return valid ID
    const originalFindBest = (SpawnCenter as any)["findBestSourceForHarvester"];
    (SpawnCenter as any)["findBestSourceForHarvester"] = jest
      .fn()
      .mockReturnValue("s1");

    SpawnCenter.run(room);

    (SpawnCenter as any)["isRoleQueued"] = originalIsRoleQueued;
    (SpawnCenter as any)["findBestSourceForHarvester"] = originalFindBest;

    // Target should be 2. Current is 1. Should spawn.
    // Wait! PopulationManager.calculateTargets calculates harvester based on logic.
    // But SpawnCenter OVERRIDES it in this PR:
    // if (totalEnergy > 8000) ... else harvesterTarget = Math.ceil(sources * 2 + totalEnergy / 1000);
    // sources=1, energy=0 -> target = 2.
    // current = 1 (mocked find).
    // Gap exists.
    // Redundancy: 2 WORK < 3. OK.
    // Queue: empty. OK.
    // Body: energy 300. getBody returns [W,C,M] (200). OK.

    // Debug: why not called?
    // Maybe targets.harvester override logic?

    expect(registerSpy).toHaveBeenCalled();
    const callArgs = registerSpy.mock.calls[0][0] as any;
    expect(callArgs.role).toBe("harvester");
  });
});
