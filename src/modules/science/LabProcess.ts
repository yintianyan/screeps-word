import { Process } from "../../core/Process";
import { processRegistry } from "../../core/ProcessRegistry";
import { config } from "../../config";

// Simple Lab Management
// We assume a standard setup: 2 input labs, rest output labs.
// This requires manual configuration or auto-detection.
// For now, we auto-detect based on flags or memory.
// Let's use memory: room.memory.labs = { inputs: [id1, id2], outputs: [id3...] }

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my && room.controller.level >= 6) rooms.push(room);
  }
  return rooms;
}

/**
 * 实验室管理进程
 * 
 * 负责管理房间内的 Lab 反应。
 * 
 * 假设：
 * 标准布局为 2 个输入 Lab，其余为输出 Lab。
 * 需要在 Memory 中配置 labs 对象。
 * 
 * 功能：
 * 1. 自动检测 Lab 角色 (Input/Output)。
 * 2. 执行合成反应 (Run Reaction)。
 * 3. (未来) 自动调度资源填充和回收。
 */
export class LabProcess extends Process {
  public run(): void {
    if (Game.time % 10 !== 0) return;

    for (const room of getMyRooms()) {
        this.runRoom(room);
    }
  }

  private runRoom(room: Room): void {
      const labs = room.find(FIND_MY_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_LAB
      }) as StructureLab[];
      
      if (labs.length < 3) return; // Need at least 3 labs for reaction

      // Auto-configure if not set
      if (!room.memory.labs) {
          // Naive: first 2 are inputs
          room.memory.labs = {
              inputs: [labs[0].id, labs[1].id],
              outputs: labs.slice(2).map(l => l.id),
              reaction: null // Current target reaction
          };
      }
      
      const mem = room.memory.labs;
      const inputs = mem.inputs.map(id => Game.getObjectById(id as Id<StructureLab>)).filter(l => l) as StructureLab[];
      const outputs = mem.outputs.map(id => Game.getObjectById(id as Id<StructureLab>)).filter(l => l) as StructureLab[];

      if (inputs.length < 2) return;

      // Reaction Logic
      // If we have a target reaction, run it
      if (mem.reaction) {
          const reaction = mem.reaction as ResourceConstant;
          // Check if inputs have ingredients
          // For simplicity, we assume creeps (Distributor) load them.
          // LabProcess just runs reaction.
          
          for (const output of outputs) {
              if (output.cooldown > 0) continue;
              // Run reaction
              // We need to know which input labs to use.
              // Just use the two inputs.
              const result = output.runReaction(inputs[0], inputs[1]);
              if (result === OK) {
                  // success
              }
          }
      }
      
      // Boost Logic (Placeholder)
      // Check for creeps needing boost nearby?
  }
}

processRegistry.register(LabProcess, "LabProcess");
