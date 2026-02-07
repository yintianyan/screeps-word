/**
 * Unit Test Runner
 * Executes tests against the modules
 */

const { MockRoom, MockCreep, MockStructure, setupGlobal } = require('./mocks');
setupGlobal();

const populationModule = require('../module.population');
const Cache = require('../core.cache');

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

    console.log("\nAll Tests Passed!");
}

function testCache() {
    console.log("\n[Test] Core Cache");
    Cache.clearTick();
    
    let calls = 0;
    const fetcher = () => { calls++; return "value"; };
    
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
    room.sources.push({ id: 's1', pos: { x: 10, y: 10 } });
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
    const source = { id: 's1', pos: { inRangeTo: () => true } };
    room.sources.push(source);
    room.creeps.push(new MockCreep("h1", "harvester", room));
    room.creeps.push(new MockCreep("ha1", "hauler", room));
    
    // Mock Container with Backlog
    const container = new MockStructure('container', source.pos, 2000);
    // We need to inject this into the room.find mock or cache
    // Since our mock is simple, we might need to adjust populationModule to be testable
    // or mock Cache.getStructures
    
    // Override Cache for this test
    const originalGetStructures = Cache.getStructures;
    Cache.getStructures = () => [container];

    const targets = populationModule.calculateTargets(room);
    
    // Expect: 2 Harvesters (User req), increased Haulers due to backlog
    assert(targets.harvester === 2, "Should have 2 harvesters per source");
    assert(targets.hauler >= 2, "Should increase haulers due to backlog > 1800");

    // Restore
    Cache.getStructures = originalGetStructures;
}

// Run
try {
    runTests();
} catch (e) {
    console.error(e.message);
    process.exit(1);
}