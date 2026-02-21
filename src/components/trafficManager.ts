import StructureCache from "../utils/structureCache";
import Cache from "./memoryManager"; // [NEW] Import Cache

const TrafficManager = {
  config: {
    stuckThreshold: 2,
    congestionCost: 50,
    visualize: true,
  },

  run: function (room: Room) {
    if (this.config.visualize && Game.time % 10 === 0) {
      this.visualizeTraffic(room);
    }
    if (!room._laneMatrices) {
      this.generateLaneMatrices(room);
    }
    // [REMOVED] No longer needs per-tick logic here. Caching handles it.
  },

  generateLaneMatrices: function (room: Room) {
    const matrices = {
      [TOP]: new PathFinder.CostMatrix(),
      [BOTTOM]: new PathFinder.CostMatrix(),
      [LEFT]: new PathFinder.CostMatrix(),
      [RIGHT]: new PathFinder.CostMatrix(),
    };
    const terrain = room.getTerrain();
    const roads = StructureCache.getStructures(room, STRUCTURE_ROAD);

    roads.forEach((road) => {
      const x = road.pos.x;
      const y = road.pos.y;
      const hasRight = room.lookForAt(LOOK_STRUCTURES, x + 1, y).some((s) => s.structureType === STRUCTURE_ROAD);
      const hasLeft = room.lookForAt(LOOK_STRUCTURES, x - 1, y).some((s) => s.structureType === STRUCTURE_ROAD);

      if (hasRight && !hasLeft) {
        matrices[TOP].set(x, y, 1);
        matrices[BOTTOM].set(x, y, 5);
      } else if (hasLeft && !hasRight) {
        matrices[BOTTOM].set(x, y, 1);
        matrices[TOP].set(x, y, 5);
      }

      const hasBottom = room.lookForAt(LOOK_STRUCTURES, x, y + 1).some((s) => s.structureType === STRUCTURE_ROAD);
      const hasTop = room.lookForAt(LOOK_STRUCTURES, x, y - 1).some((s) => s.structureType === STRUCTURE_ROAD);

      if (hasBottom && !hasTop) {
        matrices[LEFT].set(x, y, 1);
        matrices[RIGHT].set(x, y, 5);
      } else if (hasTop && !hasBottom) {
        matrices[RIGHT].set(x, y, 1);
        matrices[LEFT].set(x, y, 5);
      }
    });
    room._laneMatrices = matrices;
  },

  getAvoidanceMatrix: function (room, rolesToAvoid, existingMatrix) {
    const costMatrix = existingMatrix || new PathFinder.CostMatrix();
    const creeps = StructureCache.getCreeps(room);
    creeps.forEach((creep) => {
      if (creep.my && creep.memory.role && rolesToAvoid.includes(creep.memory.role)) {
        costMatrix.set(creep.pos.x, creep.pos.y, 255);
      }
    });
    return costMatrix;
  },

  applyLanePreference: function (room, direction, matrix) {
    if (!room._laneMatrices) this.generateLaneMatrices(room);
    const laneMatrix = room._laneMatrices[direction];
    if (!laneMatrix) return;

    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        const laneCost = laneMatrix.get(x, y);
        if (laneCost > 0) {
          const currentCost = matrix.get(x, y);
          if (currentCost < 100) {
            matrix.set(x, y, Math.max(currentCost, laneCost));
          }
        }
      }
    }
  },

  /**
   * [OPTIMIZED] 更新并返回包含交通状况的 CostMatrix
   * - Caches the matrix per room per tick.
   * - Reads creep idle status from tick cache instead of Memory.
   */
  getTrafficMatrix: function (room, existingMatrix) {
    // [NEW] Check for cached matrix first
    const cacheKey = `${room.name}_trafficMatrix`;
    let costs = Cache.get(cacheKey);
    if (costs) {
      // If a matrix already exists, clone it before returning
      // to prevent modification of the cached version.
      return costs.clone();
    }
    
    costs = existingMatrix ? existingMatrix.clone() : new PathFinder.CostMatrix();

    const allCreeps = StructureCache.getCreeps(room);

    allCreeps.forEach((c) => {
      let cost = 20;

      // [NEW] Read idle ticks from global cache (managed by creepManager)
      const idleTicks = global.tickCache.idleTicks[c.name] || 0;

      if (idleTicks > 10) {
        cost = 250;
      } else if (idleTicks > 5) {
        cost = 150;
      } else if (idleTicks > 2) {
        cost = 80;
      }

      const current = costs.get(c.pos.x, c.pos.y);
      if (cost > current) {
        costs.set(c.pos.x, c.pos.y, cost);
      }
    });

    // [NEW] Store the generated matrix in the cache for this tick
    Cache.set(cacheKey, costs);

    return costs.clone(); // Return a clone to be safe
  },

  visualizeTraffic: function (room) {
    const visual = new RoomVisual(room.name);
    const creeps = StructureCache.getCreeps(room);

    creeps.forEach((creep) => {
      // [NEW] Read from global cache
      const idleTicks = global.tickCache.idleTicks[creep.name] || 0;
      if (idleTicks > 2) {
        visual.circle(creep.pos, {
          fill: "transparent",
          radius: 0.4,
          stroke: "#ff0000",
        });
      }
    });
  },

  // [REMOVED] trackCreep is no longer needed here. Its logic will be moved to creepManager.

  requestMove: function (targetCreep, direction) {
    if (!targetCreep || !targetCreep.my) return;
    // This now needs to be handled by the creep's own logic, perhaps by setting a flag in memory
    // or a global cache that the creep checks at the start of its turn.
    // For now, we leave it as a direct memory manipulation, but ideally this would change.
    targetCreep.memory._moveRequest = {
      tick: Game.time,
      dir: direction,
    };
  },
};

export default TrafficManager;
