interface CostCache {
  matrix: CostMatrix;
  time: number;
}

export class TrafficManager {
  private static costs: { [roomName: string]: CostCache } = {};

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
      } else if (
        s.structureType !== STRUCTURE_RAMPART ||
        !(s as StructureRampart).my && !(s as StructureRampart).isPublic
      ) {
        costs.set(s.pos.x, s.pos.y, 0xff);
      }
    });

    room.find(FIND_CONSTRUCTION_SITES).forEach((s) => {
      if (s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART) {
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
        const room = Game.rooms[roomName];
        if (room) {
           room.find(FIND_CREEPS).forEach(c => {
             costs.set(c.pos.x, c.pos.y, 0xff);
           });
           room.find(FIND_POWER_CREEPS).forEach(c => {
             costs.set(c.pos.x, c.pos.y, 0xff);
           });
        }
      }
      return costs;
    };
  }
}
