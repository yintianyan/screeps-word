import { RoomSnapshot } from "../types/stats";

export class Dashboard {
  static run(room: Room) {
    if (!Memory.datastore?.rooms[room.name]) return;

    const snapshot = Memory.datastore.rooms[room.name];
    this.drawHUD(room, snapshot);
  }

  private static drawHUD(room: Room, data: RoomSnapshot) {
    const visual = new RoomVisual(room.name);
    const x = 40;
    const y = 2;

    // Background
    visual.rect(x - 0.5, y - 1, 10, 15, { fill: "#000000", opacity: 0.5 });

    // Title
    visual.text(`📊 ${room.name} Stats`, x, y, {
      align: "left",
      font: 0.8,
      color: "#ffffff",
    });

    // RCL
    const progress = (
      (data.rcl.progress / data.rcl.progressTotal) *
      100
    ).toFixed(1);
    visual.text(`RCL: ${data.rcl.level} (${progress}%)`, x, y + 1.2, {
      align: "left",
      font: 0.6,
      color: "#aaaaaa",
    });

    // Energy
    const energyPercent = (
      (data.energy.available / data.energy.capacity) *
      100
    ).toFixed(0);
    const storageK = (data.energy.storage / 1000).toFixed(0);
    visual.text(`Energy: ${energyPercent}% [${storageK}k]`, x, y + 2.2, {
      align: "left",
      font: 0.6,
      color: "#ffff00",
    });

    // Census
    let row = y + 3.5;
    visual.text(`Population:`, x, row, {
      align: "left",
      font: 0.6,
      color: "#ffffff",
    });
    row += 0.8;
    for (const role in data.census) {
      visual.text(`${role}: ${data.census[role]}`, x + 0.5, row, {
        align: "left",
        font: 0.5,
        color: "#cccccc",
      });
      row += 0.6;
    }

    // Threat
    if (data.threat.level > 0) {
      visual.text(
        `⚠️ THREAT: ${data.threat.hostiles} (${data.threat.owner || "Invader"})`,
        x,
        row + 1,
        { align: "left", font: 0.7, color: "#ff0000" },
      );
    }
  }
}
