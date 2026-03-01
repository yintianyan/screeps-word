import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { RecycleTask } from "../tasks/RecycleTask";

type Role = string;

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function getHomeRoomName(creep: Creep): string | null {
  const home = (creep.memory as unknown as Record<string, unknown>).homeRoom;
  if (typeof home === "string" && home.length > 0) return home;
  if (creep.room.controller?.my) return creep.room.name;
  return null;
}

export class CreepRecycleProcess extends Process {
  public run(): void {
    if (Game.time % 5 !== 0) return;

    const spawnsByRoom: Record<string, StructureSpawn[]> = {};
    for (const room of getMyRooms()) {
      const spawns = room.find(FIND_MY_SPAWNS);
      if (spawns.length > 0) spawnsByRoom[room.name] = spawns;
    }

    const countByHomeRole: Record<string, Record<Role, number>> = {};
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const home = getHomeRoomName(creep);
      if (!home) continue;
      const role = String(
        (creep.memory as unknown as Record<string, unknown>).role ?? "",
      );
      if (!countByHomeRole[home]) countByHomeRole[home] = {};
      countByHomeRole[home][role] = (countByHomeRole[home][role] ?? 0) + 1;
    }

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.spawning) continue;

      const ttl = creep.ticksToLive;
      if (ttl == null) continue;

      const mem = creep.memory as unknown as Record<string, unknown>;
      const role = String(mem.role ?? "");
      const retire = mem.retire === true;

      const home = getHomeRoomName(creep);
      if (!home) continue;
      if (creep.room.name !== home) continue;

      const spawns = spawnsByRoom[home];
      if (!spawns || spawns.length === 0) continue;

      if (!retire && ttl > 80) continue;

      if (
        role === "miner" ||
        role === "defender" ||
        role === "remoteHarvester" ||
        role === "remoteHauler" ||
        role === "reserver"
      ) {
        continue;
      }

      if (role !== "scout" && creep.store.getUsedCapacity() > 0) continue;

      const roleCount = countByHomeRole[home]?.[role] ?? 0;
      if (roleCount <= 1) continue;

      const mode = (Game.rooms[home]?.memory as Record<string, any>)?.strategy
        ?.mode;
      if (mode === "recover" && role === "worker" && roleCount <= 2) continue;

      if (creep.memory.taskId) {
        const taskPid = creep.memory.taskId;
        if (Memory.kernel?.processTable?.[taskPid]) {
          this.kernel.killProcess(taskPid);
        }
        delete creep.memory.taskId;
        delete creep.memory.targetId;
      }

      const spawn = creep.pos.findClosestByRange(spawns) ?? spawns[0];
      const pid = `task_recycle_${creep.name}`;
      if (!Memory.kernel?.processTable?.[pid]) {
        this.kernel.addProcess(new RecycleTask(pid, this.pid, 95));
      }
      const taskMem = this.kernel.getProcessMemory(pid);
      taskMem.creepName = creep.name;
      taskMem.targetId = spawn.id;

      creep.memory.taskId = pid;
    }
  }
}

processRegistry.register(CreepRecycleProcess, "CreepRecycleProcess");
