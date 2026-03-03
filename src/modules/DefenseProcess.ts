import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { runTowers } from "./Tower";
import StructureCache from "../utils/structureCache";
import { AttackTask } from "../tasks/AttackTask";
import { RangedAttackTask } from "../tasks/RangedAttackTask";
import { MoveTask } from "../tasks/MoveTask";

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function updateDefenseState(room: Room, hostiles: Creep[], towers: StructureTower[]): void {
  const towerEnergy = towers.reduce(
    (sum, t) => sum + t.store.getUsedCapacity(RESOURCE_ENERGY),
    0,
  );

  const defenders = StructureCache.getCreeps(room, "defender").filter(
    (c) => c.memory.homeRoom === room.name,
  ).length;

  const canFight =
    (towers.length > 0 && towerEnergy >= 300) ||
    (towers.length === 0 && defenders > 0);

  if (hostiles.length > 0) room.memory.defenseLastHostile = Game.time;
  room.memory.defense = { hostiles: hostiles.length, lastSeen: Game.time, canFight };
}

/**
 * 防御进程
 * 
 * 负责房间的防御工作。
 * 
 * 主要职责：
 * 1. 监控敌对 Creep。
 * 2. 控制 Tower 攻击、治疗和维修 (通过 runTowers)。
 * 3. 调度 Defender Creep 进行防御。
 * 4. 在需要时孵化 Defender (虽然代码中主要是调度现有 Defender)。
 */
export class DefenseProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      const towers = StructureCache.getMyStructures(
        room,
        STRUCTURE_TOWER,
      ) as StructureTower[];

      updateDefenseState(room, hostiles, towers);
      runTowers(room);
      this.runDefenders(room, hostiles, towers);
    }
  }

  private runDefenders(room: Room, hostiles: Creep[], towers: StructureTower[]): void {
    const keeper = hostiles.find((c) => c.owner?.username === "Source Keeper") ?? null;
    const target = keeper ?? hostiles[0] ?? null;
    const hasTower = towers.length > 0;
    
    const defenders = StructureCache.getCreeps(room, "defender").filter(
      (c) => c.memory.homeRoom === room.name,
    );

    for (const creep of defenders) {
        if (creep.memory.taskId) {
            const taskPid = creep.memory.taskId;
            const taskMem = this.kernel.getProcessMemory(taskPid);
            
            if (keeper && !hasTower) {
                if (taskMem.type !== "MoveTask") {
                     this.kernel.killProcess(taskPid);
                     delete creep.memory.taskId;
                } else {
                     continue;
                }
            } 
            else if (target) {
                if (taskMem.type !== "AttackTask" && taskMem.type !== "RangedAttackTask") {
                     this.kernel.killProcess(taskPid);
                     delete creep.memory.taskId;
                } else {
                     if (taskMem.targetId !== target.id) {
                          this.kernel.killProcess(taskPid);
                          delete creep.memory.taskId;
                     } else {
                          continue;
                     }
                }
            } 
            else {
                if (taskMem.type !== "MoveTask") {
                    this.kernel.killProcess(taskPid);
                    delete creep.memory.taskId;
                } else {
                    continue;
                }
            }
        }
        
        if (keeper && !hasTower) {
            const spawn = (StructureCache.getMyStructures(
              room,
              STRUCTURE_SPAWN,
            ) as StructureSpawn[])[0];
            if (spawn) {
                this.spawnTask(creep, "MoveTask", { targetPos: { x: spawn.pos.x, y: spawn.pos.y, roomName: room.name }, range: 2 }, 95);
            }
        } else if (target) {
             if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
                 this.spawnTask(creep, "RangedAttackTask", { targetId: target.id }, 95);
             } else {
                 this.spawnTask(creep, "AttackTask", { targetId: target.id }, 95);
             }
        } else {
            const spawn = (StructureCache.getMyStructures(
              room,
              STRUCTURE_SPAWN,
            ) as StructureSpawn[])[0];
            if (spawn && !creep.pos.inRangeTo(spawn, 5)) {
                this.spawnTask(creep, "MoveTask", { targetPos: { x: spawn.pos.x, y: spawn.pos.y, roomName: room.name }, range: 5 }, 40);
            }
        }
    }
  }

  private spawnTask(
    creep: Creep,
    type: "AttackTask" | "RangedAttackTask" | "MoveTask",
    data: Record<string, unknown>,
    priority: number,
  ): void {
      const pid = `task_${creep.name}_${Game.time}_${Math.floor(Math.random()*1000)}`;
      let process: Process | undefined;
      
      switch (type) {
          case "AttackTask": process = new AttackTask(pid, this.pid, priority); break;
          case "RangedAttackTask": process = new RangedAttackTask(pid, this.pid, priority); break;
          case "MoveTask": process = new MoveTask(pid, this.pid, priority); break;
      }

      if (process) {
          this.kernel.addProcess(process);
          const mem = this.kernel.getProcessMemory(pid);
          mem.creepName = creep.name;
          mem.type = type; 
          Object.assign(mem, data);
          creep.memory.taskId = pid;
      }
  }
}

processRegistry.register(DefenseProcess, "DefenseProcess");
