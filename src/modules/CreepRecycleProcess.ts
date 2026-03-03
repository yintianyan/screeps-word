import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { RecycleTask } from "../tasks/RecycleTask";
import { Debug } from "../core/Debug";

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

/**
 * Creep 回收进程
 * 
 * 负责识别并回收不再需要的 Creep，以节省 CPU 和回收能量。
 * 
 * 回收策略：
 * 1. 退休 (Retire): Creep 寿命即将结束 (TTL < 80) 且未处于工作状态。
 * 2. 冗余 (Redundant): 某种角色的数量超过了当前需求 (例如从 recover 模式切换回 economy 模式后多余的 Worker)。
 * 3. 排除列表：Miner, Defender, Remote Creep 等通常不回收。
 */
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

      const spawn = creep.pos.findClosestByRange(spawns) ?? spawns[0];
      const pid = `task_recycle_${creep.name}`;

      const existingTaskPid = creep.memory.taskId;
      if (existingTaskPid && existingTaskPid !== pid) {
        const existingType = this.kernel.getProcessType(existingTaskPid);
        const urgent = retire || ttl <= 20;
        if (existingType && !urgent) {
          Debug.event(
            "recycle_deferred",
            {
              reason: retire ? "retire" : "ttl",
              ttl,
              role,
              roleCount,
              existingTaskPid,
              existingType,
              intendedTaskPid: pid,
            },
            { creep: creep.name, room: creep.room.name, pid },
          );
          continue;
        }

        this.kernel.killProcess(existingTaskPid);
        delete creep.memory.taskId;
        delete creep.memory.targetId;
      }

      if (!Memory.kernel?.processTable?.[pid]) {
        this.kernel.addProcess(new RecycleTask(pid, this.pid, 95));
      }
      const taskMem = this.kernel.getProcessMemory(pid);
      taskMem.creepName = creep.name;
      taskMem.targetId = spawn.id;

      creep.memory.taskId = pid;
      Debug.event(
        "recycle_assigned",
        {
          reason: retire ? "retire" : "ttl",
          ttl,
          role,
          roleCount,
          prevTaskPid: existingTaskPid,
          spawnId: spawn.id,
          mode,
        },
        { creep: creep.name, room: creep.room.name, pid },
      );
    }
  }
}

processRegistry.register(CreepRecycleProcess, "CreepRecycleProcess");
