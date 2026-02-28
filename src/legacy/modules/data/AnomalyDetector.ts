import { RoomSnapshot, ALERT_THRESHOLDS, Alert } from "../../types/stats";

export class AnomalyDetector {
  static check(snapshot: RoomSnapshot): Alert[] {
    const alerts: Alert[] = [];

    // 1. Energy Critical
    if (
      snapshot.energy.available < ALERT_THRESHOLDS.ENERGY_CRITICAL &&
      snapshot.energy.available < snapshot.energy.capacity * 0.3
    ) {
      alerts.push({
        id: `ENERGY_${snapshot.roomName}_${Game.time}`,
        timestamp: Game.time,
        severity: "CRITICAL",
        message: `Energy critical in ${snapshot.roomName}: ${snapshot.energy.available}`,
        roomName: snapshot.roomName,
        acknowledged: false,
      });
    }

    // 2. Threat Detected
    if (snapshot.threat.level >= 2) {
      alerts.push({
        id: `THREAT_${snapshot.roomName}_${Game.time}`,
        timestamp: Game.time,
        severity: "CRITICAL",
        message: `Hostiles detected in ${snapshot.roomName}! Count: ${snapshot.threat.hostiles}`,
        roomName: snapshot.roomName,
        acknowledged: false,
      });
      Game.notify(`Hostiles detected in ${snapshot.roomName}!`);
    }

    // 3. RCL Downgrade Warning
    // Note: Snapshot doesn't have ticksToDowngrade yet, need to add if critical.
    // For now, assume monitored elsewhere or add to snapshot.

    return alerts;
  }
}
