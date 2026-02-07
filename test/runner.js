/**
 * Unit Test Runner
 * Executes tests against the modules
 */

const {
  MockRoom,
  MockCreep,
  MockStructure,
  MockRoomPosition,
  setupGlobal,
} = require("./mocks");
setupGlobal();

// Modules
const populationModule = require("../module.population");
const Cache = require("../core.cache");
const Lifecycle = require("../module.lifecycle");
const TrafficManager = require("../module.traffic");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

function runTests() {
  console.log("=== Running Unit Tests ===");

  // Test 1: Cache functionality
  testCache();

  // Test 2: Population Logic (Basic)
  testPopulationBasic();

  // Test 3: Population Logic (High Load)
  testPopulationHighLoad();

  // Test 4: Lifecycle Logic
  testLifecycle();

  // Test 5: Path Avoidance Logic
  testPathAvoidance();

  console.log("\nAll Tests Passed!");
}

function testPathAvoidance() {
  console.log("\n[Test] Path Avoidance Logic");
  const room = new MockRoom("E1N1");
  const hauler = new MockCreep("hauler1", "hauler", room);
  const upgrader = new MockCreep("upgrader1", "upgrader", room);

  hauler.pos = new MockRoomPosition(10, 10, "E1N1");
  upgrader.pos = new MockRoomPosition(11, 10, "E1N1");

  room.creeps.push(hauler);
  room.creeps.push(upgrader);

  // Test getAvoidanceMatrix
  // Should mark Upgrader as obstacle
  const matrix = TrafficManager.getAvoidanceMatrix(room, ["upgrader"]);

  // Check Upgrader position (11, 10)
  const cost = matrix.get(11, 10);
  assert(cost === 255, "Upgrader position should be unwalkable (255)");

  // Check Hauler position (10, 10)
  const costH = matrix.get(10, 10);
  assert(costH !== 255, "Hauler position should not be blocked");
  assert(costH === 10, "Other creeps should have default traffic cost");
}

function testCache() {
  console.log("\n[Test] Core Cache");
  Cache.clearTick();

  let calls = 0;
  const fetcher = () => {
    calls++;
    return "value";
  };

  // First call should execute fetcher
  const v1 = Cache.getTick("test", fetcher);
  assert(v1 === "value", "Cache returns value");
  assert(calls === 1, "Fetcher called once");

  // Second call should return cached
  const v2 = Cache.getTick("test", fetcher);
  assert(calls === 1, "Fetcher not called again");

  // Clear tick
  Cache.clearTick();
  Cache.getTick("test", fetcher);
  assert(calls === 2, "Fetcher called after clear");
}

function testPopulationBasic() {
  console.log("\n[Test] Population Basic");
  Cache.clearTick();
  const room = new MockRoom("E1N1");

  // Setup: 1 Source, 0 Creeps
  room.sources.push({ id: "s1", pos: { x: 10, y: 10 } });
  room.energyAvailable = 300;
  room.energyCapacityAvailable = 300;

  const targets = populationModule.calculateTargets(room);
  console.log("Targets:", JSON.stringify(targets));

  // Expect: 1 Harvester (Emergency Mode)
  assert(targets.harvester === 1, "Should spawn 1 harvester when no creeps");
  // With 1 harvester, we enforce at least 1 hauler + 1 reserve for upgrader = 2
  assert(targets.hauler >= 1, "Should enforce at least 1 hauler");
}

function testPopulationHighLoad() {
  console.log("\n[Test] Population High Load");
  Cache.clearTick();
  const room = new MockRoom("E1N1");

  // Setup: 1 Source, 1 Harvester, 1 Hauler
  const source = { id: "s1", pos: { inRangeTo: () => true } };
  room.sources.push(source);
  room.creeps.push(new MockCreep("h1", "harvester", room));
  room.creeps.push(new MockCreep("ha1", "hauler", room));

  // Mock Container with Backlog
  const container = new MockStructure("container", source.pos, 2000);
  // We need to inject this into the room.find mock or cache
  // Since our mock is simple, we might need to adjust populationModule to be testable
  // or mock Cache.getStructures

  // Override Cache for this test
  const originalGetStructures = Cache.getStructures;
  Cache.getStructures = () => [container];

  const targets = populationModule.calculateTargets(room);

  // Expect: 1 Harvester (per Source)
  assert(targets.harvester === 1, "Should have 1 harvester per source");
  // Expect: Increased Haulers due to backlog
  assert(targets.hauler >= 2, "Should increase haulers due to backlog > 1800");

  // Restore
  Cache.getStructures = originalGetStructures;
}

function testLifecycle() {
  console.log("\n[Test] Lifecycle Management");
  Lifecycle.initMemory();
  const room = new MockRoom("E1N1");

  // 1. Test Monitor
  // Create a dying creep
  const dyingCreep = new MockCreep("dying_harvester", "harvester", room);
  dyingCreep.ticksToLive = 140; // < 150 (10%)

  // Mock Game.creeps
  global.Game.creeps = { dying_harvester: dyingCreep };

  // Run Monitor
  Lifecycle.monitorCreeps();

  // Check Registry
  assert(
    Memory.lifecycle.registry["dying_harvester"] === "PRE_SPAWNING",
    "Dying creep should be marked PRE_SPAWNING",
  );

  // Check Request
  assert(
    Memory.lifecycle.requests["dying_harvester"] !== undefined,
    "Should create spawn request",
  );
  assert(
    Memory.lifecycle.requests["dying_harvester"].role === "harvester",
    "Request role should match",
  );

  // 2. Test Operational Check
  const isOp = Lifecycle.isOperational(dyingCreep);
  assert(isOp === false, "PRE_SPAWNING creep should not be operational");

  // 3. Test Spawn Notification
  Lifecycle.notifySpawn("dying_harvester", "new_harvester");
  assert(
    Memory.lifecycle.requests["dying_harvester"] === undefined,
    "Request should be cleared after spawn",
  );

  // 4. Test Cleanup
  delete global.Game.creeps["dying_harvester"]; // Creep dies
  Lifecycle.cleanupMemory();
  assert(
    Memory.lifecycle.registry["dying_harvester"] === undefined,
    "Dead creep should be removed from registry",
  );
}

// Run
try {
  runTests();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
