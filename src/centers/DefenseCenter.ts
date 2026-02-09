
import { GlobalDispatch } from "../ai/GlobalDispatch";
import { TaskPriority } from "../types/dispatch";

export class DefenseCenter {
  static run(room: Room) {
    if (Game.time % 5 !== 0) return; // Run frequently

    this.generateDefenseTasks(room);
    this.generateRepairTasks(room);
  }

  private static generateDefenseTasks(room: Room) {
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      // Create a high priority defense task for each hostile group or leader
      // Simplification: Target closest hostile
      const target = hostiles[0];
      const taskId = `DEFEND_${room.name}_${Game.time}`; // Unique per tick/invasion
      
      GlobalDispatch.registerTask({
        id: taskId,
        type: 'ATTACK',
        priority: TaskPriority.CRITICAL,
        targetId: target.id,
        pos: target.pos,
        maxCreeps: 5,
        creepsAssigned: [],
        requirements: {
          bodyParts: [ATTACK, RANGED_ATTACK]
        },
        creationTime: Game.time,
        data: {}
      });
    }
  }

  private static generateRepairTasks(room: Room) {
    // 1. Critical Repairs (Walls < 1000, Ramparts < 1000)
    const critical = room.find(FIND_STRUCTURES, {
      filter: s => (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) && s.hits < 1000
    });

    critical.forEach(s => {
      GlobalDispatch.registerTask({
        id: `REPAIR_CRIT_${s.id}`,
        type: 'REPAIR',
        priority: TaskPriority.CRITICAL,
        targetId: s.id,
        pos: s.pos,
        maxCreeps: 1,
        creepsAssigned: [],
        requirements: { bodyParts: [WORK, CARRY] },
        creationTime: Game.time,
        data: {}
      });
    });

    // 2. Maintenance (Roads/Containers < 80%)
    if (Game.time % 20 === 0) { // Less frequent
        const maintenance = room.find(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) && s.hits < s.hitsMax * 0.8
        });
        
        maintenance.forEach(s => {
            GlobalDispatch.registerTask({
                id: `REPAIR_${s.id}`,
                type: 'REPAIR',
                priority: TaskPriority.LOW,
                targetId: s.id,
                pos: s.pos,
                maxCreeps: 1,
                creepsAssigned: [],
                requirements: { bodyParts: [WORK, CARRY] },
                creationTime: Game.time,
                data: {}
            });
        });
    }
  }
}
