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

    // Initialize lane matrices if not present (Lazy Load)
    if (!room._laneMatrices) {
      this.generateLaneMatrices(room);
    }

    // 1. Monitoring & Visualization
    if (this.config.visualize) {
      this.visualizeTraffic(room);
    }
  },

  /**
   * Generate static lane preference matrices for the room
   * "Left-Hand Traffic" Rule:
   * - Vertical: Left Lane (x) = Up/North, Right Lane (x+1) = Down/South
   * - Horizontal: Top Lane (y) = Left/West, Bottom Lane (y+1) = Right/East
   * @param {Room} room
   */
  generateLaneMatrices: function (room) {
    // We create 4 matrices for 4 directions
    // 1: Top, 3: Right, 5: Bottom, 7: Left (Screeps Constants)
    const matrices = {
      [TOP]: new PathFinder.CostMatrix(),
      [BOTTOM]: new PathFinder.CostMatrix(),
      [LEFT]: new PathFinder.CostMatrix(),
      [RIGHT]: new PathFinder.CostMatrix(),
    };

    const terrain = room.getTerrain();
    // Scan all roads (structures)
    // Note: This relies on built roads. For planned roads, we might need to look at sites.
    const roads = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_ROAD,
    });

    roads.forEach((road) => {
      const x = road.pos.x;
      const y = road.pos.y;

      // 1. Check for Vertical Double Lane (Road at x+1 or x-1)
      const hasRight =
        room
          .lookForAt(LOOK_STRUCTURES, x + 1, y)
          .some((s) => s.structureType === STRUCTURE_ROAD) ||
        terrain.get(x + 1, y) === TERRAIN_MASK_WALL; // Treat wall as "other side"? No.
      const hasLeft = room
        .lookForAt(LOOK_STRUCTURES, x - 1, y)
        .some((s) => s.structureType === STRUCTURE_ROAD);

      // Rule: Left (x) = Up, Right (x+1) = Down
      if (hasRight && !hasLeft) {
        // This is the Left Lane of a pair
        // Bias: Good for UP (Top), Bad for DOWN (Bottom)
        matrices[TOP].set(x, y, 1); // Prefer
        matrices[BOTTOM].set(x, y, 5); // Penalize
      } else if (hasLeft && !hasRight) {
        // This is the Right Lane of a pair
        // Bias: Good for DOWN (Bottom), Bad for UP (Top)
        matrices[BOTTOM].set(x, y, 1);
        matrices[TOP].set(x, y, 5);
      }

      // 2. Check for Horizontal Double Lane (Road at y+1 or y-1)
      const hasBottom = room
        .lookForAt(LOOK_STRUCTURES, x, y + 1)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      const hasTop = room
        .lookForAt(LOOK_STRUCTURES, x, y - 1)
        .some((s) => s.structureType === STRUCTURE_ROAD);

      // Rule: Top (y) = Left (West), Bottom (y+1) = Right (East)
      if (hasBottom && !hasTop) {
        // This is the Top Lane
        // Bias: Good for LEFT (West), Bad for RIGHT (East)
        matrices[LEFT].set(x, y, 1);
        matrices[RIGHT].set(x, y, 5);
      } else if (hasTop && !hasBottom) {
        // This is the Bottom Lane
        // Bias: Good for RIGHT (East), Bad for LEFT (West)
        matrices[RIGHT].set(x, y, 1);
        matrices[LEFT].set(x, y, 5);
      }
    });

    room._laneMatrices = matrices;
    // Cache expiry: clear every 1000 ticks or on construction finish?
    // For now, let it persist in Heap. Heap is cleared on global reset.
  },

  /**
   * Get a matrix that specifically avoids certain roles (marks them as unwalkable)
   * Used for "Anti-Crowd" logic (e.g., Hauler bypassing Upgraders)
   * @param {Room} room
   * @param {string[]} rolesToAvoid Array of role names
   */
  getAvoidanceMatrix: function (room, rolesToAvoid) {
    const costMatrix = new PathFinder.CostMatrix();
    const creeps = room.find(FIND_CREEPS);

    creeps.forEach((creep) => {
      // 1. General Traffic Cost (Soft Avoidance)
      // Penalize all creeps slightly to prefer empty tiles
      costMatrix.set(creep.pos.x, creep.pos.y, 10);

      // 2. Specific Role Avoidance (Hard Block)
      if (
        creep.my &&
        creep.memory.role &&
        rolesToAvoid.includes(creep.memory.role)
      ) {
        costMatrix.set(creep.pos.x, creep.pos.y, 255); // Unwalkable
      }
    });

    return costMatrix;
  },

  /**
   * Get the directional lane matrix
   * @param {Room} room
   * @param {number} direction TOP/BOTTOM/LEFT/RIGHT
   */
  getLaneMatrix: function (room, direction) {
    if (!room._laneMatrices) this.generateLaneMatrices(room);
    return room._laneMatrices[direction];
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
