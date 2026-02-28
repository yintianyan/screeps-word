import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";

function bodyCost(body: BodyPartConstant[]): number {
  let cost = 0;
  for (const part of body) cost += BODYPART_COST[part];
  return cost;
}

function buildWorkerBody(energyCapacity: number): BodyPartConstant[] {
  const unit: BodyPartConstant[] = [WORK, CARRY, MOVE];
  const unitCost = bodyCost(unit);
  const maxParts = 15;

  const body: BodyPartConstant[] = [];
  while (
    body.length + unit.length <= maxParts &&
    bodyCost(body) + unitCost <= energyCapacity
  ) {
    body.push(...unit);
  }

  return body.length > 0 ? body : [WORK, CARRY, MOVE];
}

function desiredWorkerCount(room: Room): number {
  const rcl = room.controller?.level ?? 0;
  if (rcl <= 1) return 2;
  if (rcl <= 2) return 4;
  if (rcl <= 3) return 6;
  return 8;
}

export class SpawnerProcess extends Process {
  public run(): void {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller?.my) continue;

      const creeps = room.find(FIND_MY_CREEPS);
      const workerCount = creeps.filter(
        (c) => c.getActiveBodyparts(WORK) > 0,
      ).length;
      const target = desiredWorkerCount(room);
      if (workerCount >= target) continue;

      const spawns = room.find(FIND_MY_SPAWNS);
      const spawn = spawns.find((s) => !s.spawning);
      if (!spawn) continue;

      const body = buildWorkerBody(room.energyCapacityAvailable);
      const cost = bodyCost(body);
      if (room.energyAvailable < cost) continue;

      const name = `W_${room.name}_${Game.time}`;
      spawn.spawnCreep(body, name, {
        memory: { role: "worker", room: room.name, working: false },
      });
    }
  }
}

processRegistry.register(SpawnerProcess, "SpawnerProcess");
