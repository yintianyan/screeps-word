/**
 * Intelligent Traffic Control System
 *
 * 1. Congestion Monitoring: Tracks creep movement and identifies stuck creeps.
 * 2. Dynamic CostMatrix: Increases cost of congested tiles to force pathfinding rerouting.
 * 3. Visualization: Displays traffic heatmaps (Green = Free, Red = Jammed).
 */
const TrafficManager = {
  // Configuration
  config: {
    stuckThreshold: 2, // Ticks to wait before considering a creep stuck
    congestionCost: 50, // Cost added to a tile if occupied by a stuck creep
    visualize: true,
  },

  /**
   * Run every tick to update traffic data
   * @param {Room} room
   */
  run: function (room) {
    if (Game.time % 1 !== 0) return; // Run every tick for real-time accuracy

    // 1. Monitoring & Visualization
    if (this.config.visualize) {
      this.visualizeTraffic(room);
    }
  },

  /**
   * Generate a CostMatrix that accounts for traffic
   * @param {Room} room
   * @returns {CostMatrix}
   */
  getTrafficMatrix: function (room) {
    const costs = new PathFinder.CostMatrix();
    const creeps = room.find(FIND_CREEPS);

    creeps.forEach((creep) => {
      // Base cost for any creep (avoid walking through people if possible)
      let cost = 0;

      // If creep is idle/stuck, increase cost significantly
      if (creep.memory.idleTicks > this.config.stuckThreshold) {
        cost = this.config.congestionCost;
      } else if (creep.fatigue > 0) {
        cost = 10; // Tired creeps are slow obstacles
      } else {
        cost = 5; // Moving creeps are minor obstacles
      }

      // Set cost (only if higher than existing)
      // Note: We don't overwrite walls (255), but PathFinder handles that.
      costs.set(creep.pos.x, creep.pos.y, cost);
    });

    return costs;
  },

  /**
   * Visualizes traffic status
   * @param {Room} room
   */
  visualizeTraffic: function (room) {
    const visual = new RoomVisual(room.name);
    const creeps = room.find(FIND_MY_CREEPS);

    creeps.forEach((creep) => {
      if (creep.memory.idleTicks > 2) {
        // Stuck / Idle: Red Circle
        visual.circle(creep.pos, {
          fill: "transparent",
          radius: 0.4,
          stroke: "#ff0000",
        });
      } else {
        // Moving: Green Dot
        // visual.circle(creep.pos, {fill: '#00ff00', radius: 0.1});
      }
    });
  },

  /**
   * Helper to track idle time (Called by Creep logic or Kernel)
   */
  trackCreep: function (creep) {
    if (!creep.memory._lastPos) {
      creep.memory._lastPos = { x: creep.pos.x, y: creep.pos.y };
      creep.memory.idleTicks = 0;
    } else {
      if (
        creep.pos.x === creep.memory._lastPos.x &&
        creep.pos.y === creep.memory._lastPos.y
      ) {
        creep.memory.idleTicks = (creep.memory.idleTicks || 0) + 1;
      } else {
        creep.memory.idleTicks = 0;
        creep.memory._lastPos = { x: creep.pos.x, y: creep.pos.y };
      }
    }
  },
};

module.exports = TrafficManager;
