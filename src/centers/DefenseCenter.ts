import { GlobalDispatch } from "../ai/GlobalDispatch";
import { TaskPriority, TaskType } from "../types/dispatch";
import { EnergyManager, CrisisLevel } from "../components/EnergyManager";

export class DefenseCenter {
  static run(room: Room) {
    // 0. Auto-SafeMode Check
    this.checkSafeMode(room);

    // 1. Hostile Response
    if (Game.time % 2 === 0) { // Check frequently
        this.generateDefenseTasks(room);
    }

    // 2. Rampart Management (Auto-create ramparts on critical structures)
    if (Game.time % 100 === 0) {
        this.manageRamparts(room);
    }
    
    // 3. Repairs
    if (Game.time % 10 === 0) {
        this.generateRepairTasks(room);
    }
  }

  private static checkSafeMode(room: Room) {
      if (!room.controller || !room.controller.my) return;
      if (room.controller.safeMode) return; // Already active
      if (room.controller.safeModeCooldown) return; // Cooldown
      if (room.controller.safeModeAvailable === 0) return; // No charges

      // Trigger if enemy damaged critical structures or spawn/controller is threatened
      // Threat Check: Enemy within 3 range of Spawn/Storage/Controller
      const criticalStructs = [
          ...room.find(FIND_MY_SPAWNS),
          room.storage,
          room.controller
      ].filter(s => s) as Structure[];
      
      const hostiles = room.find(FIND_HOSTILE_CREEPS, {
          filter: c => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0 || c.getActiveBodyparts(WORK) > 0 // Dismantler
      });

      if (hostiles.length === 0) return;

      for (const struct of criticalStructs) {
          if (struct.pos.findInRange(hostiles, 3).length > 0) {
              console.log(`[DEFENSE] 🚨 SAFE MODE TRIGGERED in ${room.name}! Enemy near ${struct.structureType}`);
              room.controller.activateSafeMode();
              Game.notify(`[DEFENSE] Safe Mode activated in ${room.name} due to enemy threat!`);
              return;
          }
      }
  }

  private static manageRamparts(room: Room) {
      if (!room.controller || room.controller.level < 3) return; // Ramparts available at RCL 2, but let's wait a bit
      
      // Critical structures that MUST have ramparts
      const criticalStructures = [
          ...room.find(FIND_MY_SPAWNS),
          room.storage,
          room.terminal,
          ...room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER })
      ].filter(s => s) as Structure[];

      criticalStructures.forEach(s => {
          // Check if rampart exists
          const rampart = s.pos.lookFor(LOOK_STRUCTURES).find(str => str.structureType === STRUCTURE_RAMPART);
          if (!rampart) {
              // Check construction site
              const site = s.pos.lookFor(LOOK_CONSTRUCTION_SITES).find(site => site.structureType === STRUCTURE_RAMPART);
              if (!site) {
                  s.pos.createConstructionSite(STRUCTURE_RAMPART);
              }
          }
      });
  }

  private static generateDefenseTasks(room: Room) {
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      // Logic:
      // 1. Identify threats (Invaders vs Players vs Scouts)
      // 2. Group enemies? For now, target closest/weakest.
      
      // Filter out allies if ally list exists (TODO)
      
      // Target Selection: Healers > Attackers > Others
      const healers = hostiles.filter(c => c.getActiveBodyparts(HEAL) > 0);
      const attackers = hostiles.filter(c => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0);
      
      let target = healers[0] || attackers[0] || hostiles[0];
      
      // If we have towers, they handle small threats.
      // But if invaders are strong, we need Defenders.
      // Or if Invader Core exists.
      
      const taskId = `DEFEND_${room.name}_${target.id}`; // Stable ID for same target

      if (!GlobalDispatch.getTask(taskId)) {
          GlobalDispatch.registerTask({
            id: taskId,
            type: TaskType.ATTACK,
            priority: TaskPriority.CRITICAL,
            targetId: target.id,
            pos: target.pos,
            maxCreeps: 3, // Group up
            creepsAssigned: [],
            requirements: {
              bodyParts: [ATTACK, MOVE], // Melee defenders
            },
            validRoles: ['defender', 'melee_defender'],
            creationTime: Game.time,
            autoRemove: true, // Auto remove if target dies (task handling logic needed)
          });
      }
    }
  }

  private static generateRepairTasks(room: Room) {
    // 1. Critical Repairs (Walls < 1000, Ramparts < 1000)
    // ... (Keep existing logic but optimized)
    const critical = room.find(FIND_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_WALL ||
          s.structureType === STRUCTURE_RAMPART) &&
        s.hits < 2000, // Increased threshold slightly
    });

    critical.forEach((s) => {
      const taskId = `REPAIR_CRIT_${s.id}`;
      if (!GlobalDispatch.getTask(taskId)) {
          GlobalDispatch.registerTask({
            id: taskId,
            type: TaskType.REPAIR,
            priority: TaskPriority.CRITICAL,
            targetId: s.id,
            pos: s.pos,
            maxCreeps: 1,
            creepsAssigned: [],
            requirements: { bodyParts: [WORK, CARRY] },
            creationTime: Game.time,
            autoRemove: true
          });
      }
    });

    // 2. Maintenance (Roads/Containers < 80%)
    if (Game.time % 50 === 0) { // Less frequent
      const maintenance = room.find(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_ROAD ||
            s.structureType === STRUCTURE_CONTAINER) &&
          s.hits < s.hitsMax * 0.7, // Lower threshold to avoid spam
      });

      maintenance.forEach((s) => {
        const taskId = `REPAIR_${s.id}`;
        if (!GlobalDispatch.getTask(taskId)) {
            GlobalDispatch.registerTask({
              id: taskId,
              type: TaskType.REPAIR,
              priority: TaskPriority.LOW,
              targetId: s.id,
              pos: s.pos,
              maxCreeps: 1,
              creepsAssigned: [],
              requirements: { bodyParts: [WORK, CARRY] },
              creationTime: Game.time,
              autoRemove: true
            });
        }
      });
    }
  }
}
