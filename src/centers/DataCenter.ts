import { DataStore, RoomSnapshot } from "../types/stats";
import { AnomalyDetector } from "../modules/data/AnomalyDetector";

export class DataCenter {
  static init() {
    if (!Memory.datastore) {
      Memory.datastore = {
        rooms: {},
        global: {
          gcl: 0,
          gpl: 0,
          credits: 0,
          cpu: 0,
        },
        history: {},
        alerts: [],
      };
    }
  }

  static run() {
    this.init();

    // 1. Update Global Stats
    this.updateGlobalStats();

    // 2. Aggregate Cross-Room Data (Every 10 ticks)
    if (Game.time % 10 === 0) {
      this.analyzeData();
    }

    // 3. Prune Alerts
    if (Game.time % 100 === 0) {
      Memory.datastore.alerts = Memory.datastore.alerts.filter(
        (a) => Game.time - a.timestamp < 10000,
      );
    }
  }

  private static updateGlobalStats() {
    const ds = Memory.datastore;
    ds.global.gcl = Game.gcl.level;
    ds.global.gpl = Game.gpl.level;
    ds.global.credits = Game.market.credits;
    ds.global.cpu = Game.cpu.bucket;
  }

  private static analyzeData() {
    const alerts = Memory.datastore.alerts;

    Object.values(Memory.datastore.rooms).forEach((snapshot) => {
      // Run Anomaly Detection
      const newAlerts = AnomalyDetector.check(snapshot);
      if (newAlerts.length > 0) {
        newAlerts.forEach((a) => alerts.push(a));
        console.log(
          `[DataCenter] 🚨 Alerts generated for ${snapshot.roomName}`,
        );
      }
    });

    // Example: Find rooms with surplus energy
    const surplusRooms = Object.values(Memory.datastore.rooms).filter(
      (r) => r.energy.storage > 500000,
    );
  }
}
