import { DataCenter } from "../../centers/DataCenter";

export class ThreatDetector {
  /**
   * Checks for threats in the current room.
   * Updates memory and triggers alerts.
   * Returns true if a significant threat is present.
   */
  static scan(room: Room): boolean {
    const hostiles = room.find(FIND_HOSTILE_CREEPS);

    // 1. Filter Combat Hostiles
    const combatHostiles = hostiles.filter(
      (c) =>
        c.getActiveBodyparts(ATTACK) > 0 ||
        c.getActiveBodyparts(RANGED_ATTACK) > 0 ||
        c.getActiveBodyparts(HEAL) > 0 ||
        c.getActiveBodyparts(CLAIM) > 0,
    );

    const hostileStructures = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_TOWER ||
        s.structureType === STRUCTURE_SPAWN,
    });

    const threatLevel = combatHostiles.length + hostileStructures.length;

    // 2. Update Memory
    if (!room.memory.remote) {
      // Note: This assumes ThreatDetector runs on remote rooms primarily.
      // If running on owned rooms, structure is different.
      // But for now, we assume this is called by RemoteManager or Remote Creeps.
      // Safe to check if 'remote' key exists or create it?
      // Actually, for remote rooms, memory is usually in Memory.rooms[home].remote[target].
      // But Creeps only access `room.memory`.
      // Wait, remote rooms might not have persistent memory if no one claims them?
      // `room.memory` is Memory.rooms[room.name].
      // We should store threat data in Memory.rooms[room.name] directly for the creep to access easily.
    }

    // Let's store threat info in room.memory.threat
    if (threatLevel > 0) {
      room.memory.threat = {
        level: Math.min(threatLevel, 5),
        lastSeen: Game.time,
        hostiles: threatLevel,
      };

      // Alert (Throttled)
      if (Game.time % 50 === 0) {
        console.log(
          `[Defense] ⚔️ Threat detected in ${room.name}: Level ${threatLevel}`,
        );
        Game.notify(`Invasion in ${room.name}! Level ${threatLevel}`);
      }
      return true;
    } else {
      // Decay threat
      if (room.memory.threat) {
        if (Game.time - room.memory.threat.lastSeen > 100) {
          delete room.memory.threat;
        }
      }
      return false;
    }
  }

  /**
   * Should the creep flee?
   */
  static shouldFlee(creep: Creep): boolean {
    // Check Room Threat
    const roomThreat = creep.room.memory.threat;
    if (!roomThreat) return false;

    // Check Health
    if (creep.hits < creep.hitsMax * 0.7) return true;

    // Check Proximity (Optional: if threat is very close)
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const dangerous = hostiles.find(
      (h) =>
        h.pos.inRangeTo(creep, 5) &&
        (h.getActiveBodyparts(ATTACK) > 0 ||
          h.getActiveBodyparts(RANGED_ATTACK) > 0),
    );

    return !!dangerous;
  }
}
