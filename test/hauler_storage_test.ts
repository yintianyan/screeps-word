import Hauler from "../src/modules/hauler/index";
import { MockCreep, MockRoom, MockStructure } from "./mocks";

export const testHaulerStorageLogic = () => {
  console.log("=== Testing Hauler Storage Logic ===");

  // Setup
  const room = new MockRoom("W1N1");
  const creep = new MockCreep("hauler1", "hauler", room);
  const hauler = new Hauler(creep as any);

  // Mock Storage
  const storage = new MockStructure(STRUCTURE_STORAGE, { x: 25, y: 25 });
  (storage as any).store = {
    getFreeCapacity: () => 100000,
    getUsedCapacity: () => 0,
    [RESOURCE_ENERGY]: 0,
  };
  room.storage = storage as any;
  room.structures.push(storage);

  // Mock Spawn (Full)
  const spawn = new MockStructure(STRUCTURE_SPAWN, { x: 20, y: 20 });
  (spawn as any).store = {
    getFreeCapacity: () => 0, // FULL
    getUsedCapacity: () => 300,
    [RESOURCE_ENERGY]: 300,
  };
  room.structures.push(spawn);
  (room as any).find = (type: any, opts: any) => {
    if (type === FIND_MY_STRUCTURES || type === FIND_STRUCTURES) {
      let res = room.structures;
      if (opts && opts.filter) res = res.filter(opts.filter);
      return res;
    }
    return [];
  };

  // Give Creep Energy
  creep.store[RESOURCE_ENERGY] = 50;
  (creep.memory as any).working = true;

  // Scenario 1: CRITICAL Mode, Spawn Full
  console.log("[Test] Scenario 1: CRITICAL Mode, Spawn Full");
  (room.memory as any).energyLevel = "CRITICAL";

  // Run Logic
  hauler.executeState();

  // Check Memory Target (Should be Storage, but currently fails)
  // The current logic doesn't set memory.targetId in executeState explicitly for fallback,
  // but it tries to transfer.
  // We can check if 'transfer' was called on Storage.
  // Since MockCreep.transfer isn't spying, we can check side effects or memory if set.
  // Actually, looking at Hauler code:
  // `if (bestCandidate) { this.memory.targetId = target.id; ... }`

  if ((creep.memory as any).targetId === (storage as any).id) {
    console.log(
      "PASS: Hauler targeted Storage in CRITICAL mode when Spawn is full.",
    );
  } else {
    console.log(
      `FAIL: Hauler did not target Storage. TargetID: ${(creep.memory as any).targetId}`,
    );
  }

  // Scenario 2: Normal Mode
  console.log("[Test] Scenario 2: LOW Mode, Spawn Full");
  (room.memory as any).energyLevel = "LOW";
  delete (creep.memory as any).targetId;

  hauler.executeState();

  if ((creep.memory as any).targetId === (storage as any).id) {
    console.log("PASS: Hauler targeted Storage in LOW mode.");
  } else {
    console.log(
      `FAIL: Hauler did not target Storage in LOW mode. TargetID: ${(creep.memory as any).targetId}`,
    );
  }
};
