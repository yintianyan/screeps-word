import { RoomSnapshot } from "../../types/stats";

export class RoomCollector {
  static run(room: Room): RoomSnapshot {
    const snapshot = this.collect(room);
    // Push to global DataCenter (via Memory for now)
    if (!Memory.datastore)
      Memory.datastore = {
        rooms: {},
        global: {} as any,
        history: {},
        alerts: [],
      };
    Memory.datastore.rooms[room.name] = snapshot;

    // Optional: Keep history
    if (!Memory.datastore.history[room.name])
      Memory.datastore.history[room.name] = [];
    const history = Memory.datastore.history[room.name];
    if (Game.time % 100 === 0) {
      // Record history every 100 ticks
      history.push(snapshot);
      if (history.length > 50) history.shift();
    }

    return snapshot;
  }

  private static collect(room: Room): RoomSnapshot {
    // 1. Census
    const census: Record<string, number> = {};
    room.find(FIND_MY_CREEPS).forEach((c) => {
      census[c.memory.role] = (census[c.memory.role] || 0) + 1;
    });

    // 2. Resources
    const resources: Record<string, number> = {};
    if (room.storage) {
      for (const r in room.storage.store) {
        resources[r] = room.storage.store[r as ResourceConstant];
      }
    }
    if (room.terminal) {
      for (const r in room.terminal.store) {
        resources[r] =
          (resources[r] || 0) + room.terminal.store[r as ResourceConstant];
      }
    }

    // 3. Construction
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    const construction = {
      sites: sites.length,
      progress: sites.reduce((sum, s) => sum + s.progress, 0),
      progressTotal: sites.reduce((sum, s) => sum + s.progressTotal, 0),
    };

    // 4. Threat
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    let threatLevel = 0;
    if (hostiles.length > 0) {
      threatLevel = 1; // Scout
      if (
        hostiles.some(
          (c) =>
            c.getActiveBodyparts(ATTACK) > 0 ||
            c.getActiveBodyparts(RANGED_ATTACK) > 0,
        )
      ) {
        threatLevel = 2; // Invader
      }
      if (hostiles.some((c) => c.owner.username !== "Invader")) {
        threatLevel = 3; // Player
      }
    }

    return {
      timestamp: Game.time,
      roomName: room.name,
      rcl: {
        level: room.controller?.level || 0,
        progress: room.controller?.progress || 0,
        progressTotal: room.controller?.progressTotal || 0,
      },
      energy: {
        available: room.energyAvailable,
        capacity: room.energyCapacityAvailable,
        storage: room.storage?.store.energy || 0,
        terminal: room.terminal?.store.energy || 0,
      },
      resources,
      census,
      construction,
      threat: {
        level: threatLevel,
        hostiles: hostiles.length,
        owner: hostiles[0]?.owner.username,
      },
      cpu: {
        bucket: Game.cpu.bucket,
        used: Game.cpu.getUsed(), // Snapshot at collection time
      },
    };
  }
}
