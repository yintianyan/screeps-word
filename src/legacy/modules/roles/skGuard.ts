import { GlobalDispatch } from "../../ai/GlobalDispatch";
import { TaskStatus } from "../../types/dispatch";

export default {
  run: function (creep: Creep) {
    // 1. Get Task
    const task = GlobalDispatch.getAssignedTask(creep);
    if (!task || !task.data) return;

    const { targetRoom, lairId } = task.data;
    const lair = Game.getObjectById(lairId as Id<StructureKeeperLair>);

    // 2. Move to Room
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        visualizePathStyle: { stroke: "#ff0000" },
        reusePath: 50,
      });
      return;
    }

    // 3. Combat Logic
    if (!lair) return; // Should not happen if visible

    // Find Keeper
    const keeper = lair.pos.findInRange(FIND_HOSTILE_CREEPS, 5, {
        filter: c => c.owner.username === 'Source Keeper'
    })[0];

    // Heal Self
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    if (keeper) {
        // Attack
        const range = creep.pos.getRangeTo(keeper);
        if (range > 1) {
            creep.moveTo(keeper, { visualizePathStyle: { stroke: "#ff0000" } });
        } else {
            creep.attack(keeper);
            // Move with keeper to stay on top/close?
            creep.move(creep.pos.getDirectionTo(keeper)); 
        }
        
        // Ranged Attack if possible? (Body has ATTACK)
    } else {
        // Wait by Lair
        // Ideally stand on the spot where Keeper spawns?
        // Keeper spawns at Lair pos? No, nearby?
        // Usually Lair pos is walkable? No, Lair is structure.
        // Stand range 1.
        if (!creep.pos.inRangeTo(lair, 1)) {
            creep.moveTo(lair, { range: 1 });
        }
        
        // Pre-spawn notification?
        if (lair.ticksToSpawn && lair.ticksToSpawn < 10) {
            creep.say(`Spawn ${lair.ticksToSpawn}`);
        }
    }
  }
};
