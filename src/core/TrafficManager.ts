import { Cache } from "./Cache";

interface CostCache {
  matrix: CostMatrix;
  time: number;
}

export class TrafficManager {
  private static costs: { [roomName: string]: CostCache } = {};
  private static pushRequests: { pusher: Creep; target: Creep }[] = [];

  private static getBlockingPositions(roomName: string): Array<{ x: number; y: number }> {
    return Cache.getTick(`tm:blockers:${roomName}`, () => {
      const room = Game.rooms[roomName];
      if (!room) return [];
      const result: Array<{ x: number; y: number }> = [];
      const creeps = room.find(FIND_CREEPS);
      for (const c of creeps) result.push({ x: c.pos.x, y: c.pos.y });
      const powerCreeps = room.find(FIND_POWER_CREEPS);
      for (const c of powerCreeps) result.push({ x: c.pos.x, y: c.pos.y });
      return result;
    });
  }

  public static getCostMatrix(roomName: string, fresh = false): CostMatrix {
    if (
      !fresh &&
      this.costs[roomName] &&
      Game.time - this.costs[roomName].time < 100
    ) {
      return this.costs[roomName].matrix.clone();
    }

    const room = Game.rooms[roomName];
    if (!room) return new PathFinder.CostMatrix();

    const costs = new PathFinder.CostMatrix();

    room.find(FIND_STRUCTURES).forEach((s) => {
      if (s.structureType === STRUCTURE_ROAD) {
        costs.set(s.pos.x, s.pos.y, 1);
      } else if (s.structureType === STRUCTURE_CONTAINER) {
        costs.set(s.pos.x, s.pos.y, 2);
      } else if (
        s.structureType === STRUCTURE_RAMPART &&
        ((s as StructureRampart).my || (s as StructureRampart).isPublic)
      ) {
        costs.set(s.pos.x, s.pos.y, 2);
      } else {
        costs.set(s.pos.x, s.pos.y, 0xff);
      }
    });

    this.costs[roomName] = { matrix: costs, time: Game.time };
    return costs.clone();
  }

  public static getCallback(
    avoidCreeps = false,
  ): (roomName: string, costs: CostMatrix) => CostMatrix {
    return (roomName: string, _costs: CostMatrix): CostMatrix => {
      const costs = this.getCostMatrix(roomName).clone();
      
      if (avoidCreeps) {
        const blockers = this.getBlockingPositions(roomName);
        for (const p of blockers) costs.set(p.x, p.y, 0xff);
      }
      return costs;
    };
  }

  public static requestPush(pusher: Creep, target: Creep) {
    this.pushRequests.push({ pusher, target });
  }

  public static run() {
    const processed = new Set<string>();

    for (const { target } of this.pushRequests) {
        if (processed.has(target.id)) continue;
        if (target.fatigue > 0 || target.spawning) continue;
        
        const terrain = target.room.getTerrain();
        const spots: RoomPosition[] = [];
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = target.pos.x + dx;
                const y = target.pos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                
                const pos = new RoomPosition(x, y, target.room.name);
                
                const creeps = pos.lookFor(LOOK_CREEPS);
                if (creeps.length > 0) continue;
                
                const structures = pos.lookFor(LOOK_STRUCTURES);
                if (structures.some(s => 
                    s.structureType !== STRUCTURE_ROAD && 
                    s.structureType !== STRUCTURE_CONTAINER && 
                    (s.structureType !== STRUCTURE_RAMPART || !(s as StructureRampart).my)
                )) continue;

                spots.push(pos);
            }
        }
        
        if (spots.length > 0) {
            const spot = spots[Math.floor(Math.random() * spots.length)];
            target.move(target.pos.getDirectionTo(spot));
            processed.add(target.id);
        }
    }
    this.pushRequests = [];
  }
}
