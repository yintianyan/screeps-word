import { EnergyManager, CrisisLevel } from "../src/components/EnergyManager";

export const testEnergyManager = () => {
  // Mock Room
  const mockRoom = {
    name: "TEST_ROOM",
    controller: {
      level: 4,
      ticksToDowngrade: 10000,
    },
    storage: {
      store: {
        [RESOURCE_ENERGY]: 0,
      },
    },
    energyAvailable: 0,
    memory: { energyManager: {} },
    find: () => [], // No sources/creeps for now
  } as any;

  console.log("=== Testing EnergyManager (RCL 4) ===");

  // Case 1: Critical (0 Energy)
  mockRoom.energyAvailable = 0;
  mockRoom.storage.store[RESOURCE_ENERGY] = 0;
  EnergyManager.update(mockRoom);
  let level = EnergyManager.getLevel(mockRoom);
  console.log(`Energy: 0 -> Level: ${CrisisLevel[level]} (Expected: CRITICAL)`);
  if (level !== CrisisLevel.CRITICAL) console.log("FAIL: Should be CRITICAL");

  // Case 2: Low (2500 Energy) - Threshold is 2000 for Critical
  mockRoom.storage.store[RESOURCE_ENERGY] = 2500;
  EnergyManager.update(mockRoom);
  level = EnergyManager.getLevel(mockRoom);
  console.log(
    `Energy: 2500 -> Level: ${CrisisLevel[level]} (Expected: MEDIUM or HIGH depending on config)`,
  );
  // Config RCL 4: Min 10000. 2500 is < 30% (3000). So HIGH.
  if (level !== CrisisLevel.HIGH)
    console.log(`FAIL: Should be HIGH (got ${CrisisLevel[level]})`);

  // Case 3: Safe (15000 Energy) - Min 10000
  mockRoom.storage.store[RESOURCE_ENERGY] = 15000;
  EnergyManager.update(mockRoom);
  level = EnergyManager.getLevel(mockRoom);
  console.log(`Energy: 15000 -> Level: ${CrisisLevel[level]} (Expected: NONE)`);
  if (level !== CrisisLevel.NONE)
    console.log(`FAIL: Should be NONE (got ${CrisisLevel[level]})`);

  // Case 4: Budget Check
  const upgraderBudget = EnergyManager.getBudget(mockRoom, "upgrader");
  console.log(`RCL 4 Safe Upgrader Budget: ${upgraderBudget} (Expected: 20)`);
  if (upgraderBudget !== 20) console.log("FAIL: Budget mismatch");

  console.log("=== Test Complete ===");
};
