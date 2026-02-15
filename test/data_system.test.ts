import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import { RoomCollector } from "../src/modules/data/RoomCollector";
import { AnomalyDetector } from "../src/modules/data/AnomalyDetector";
import { DataCenter } from "../src/centers/DataCenter";
import { RoomSnapshot } from "../src/types/stats";

// Mock Globals
(global as any).Game = {
  time: 1000,
  cpu: { bucket: 10000, getUsed: () => 10 },
  gcl: { level: 3 },
  gpl: { level: 0 },
  market: { credits: 1000 },
  notify: jest.fn(),
};
(global as any).Memory = {};
(global as any).FIND_MY_CREEPS = 1;
(global as any).FIND_MY_CONSTRUCTION_SITES = 2;
(global as any).FIND_HOSTILE_CREEPS = 3;
(global as any).ATTACK = "attack";
(global as any).RANGED_ATTACK = "ranged_attack";

describe("Data System", () => {
  let room: any;

  beforeEach(() => {
    (global as any).Memory = {};
    room = {
      name: "W45N3",
      energyAvailable: 500,
      energyCapacityAvailable: 1000,
      storage: { store: { energy: 10000 } },
      terminal: { store: { energy: 5000 } },
      controller: { level: 3, progress: 100, progressTotal: 10000 },
      find: jest.fn().mockReturnValue([]),
    };
  });

  test("RoomCollector should generate valid snapshot", () => {
    room.find.mockImplementation((type: number) => {
      if (type === 1) return [{ memory: { role: "harvester" } }]; // Creeps
      return [];
    });

    const snapshot = RoomCollector.run(room);

    expect(snapshot.roomName).toBe("W45N3");
    expect(snapshot.energy.available).toBe(500);
    expect(snapshot.census["harvester"]).toBe(1);
    expect(snapshot.threat.level).toBe(0);

    // Verify Memory storage
    expect((global as any).Memory.datastore.rooms["W45N3"]).toBeDefined();
  });

  test("AnomalyDetector should detect critical energy", () => {
    const snapshot: RoomSnapshot = {
      timestamp: 100,
      roomName: "W45N3",
      rcl: { level: 3, progress: 0, progressTotal: 0 },
      energy: { available: 50, capacity: 1000, storage: 0, terminal: 0 }, // 50 < 300
      resources: {} as any, // Cast to any to bypass strict type check for test
      census: {},
      construction: { sites: 0, progress: 0, progressTotal: 0 },
      threat: { level: 0, hostiles: 0 },
      cpu: { bucket: 10000, used: 10 },
    };

    const alerts = AnomalyDetector.check(snapshot);
    expect(alerts.length).toBe(1);
    expect(alerts[0].severity).toBe("CRITICAL");
    expect(alerts[0].message).toContain("Energy critical");
  });

  test("DataCenter should aggregate data and manage alerts", () => {
    DataCenter.init();
    (global as any).Memory.datastore.rooms["W1N1"] = {
      roomName: "W1N1",
      threat: { level: 2, hostiles: 1 }, // Hostile!
      energy: { available: 1000, capacity: 1000, storage: 0, terminal: 0 },
    };

    DataCenter.run();

    // Should generate threat alert
    const alerts = (global as any).Memory.datastore.alerts;
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].message).toContain("Hostiles detected");
  });
});
