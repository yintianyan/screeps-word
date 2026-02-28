import { GlobalDispatch } from "../../ai/GlobalDispatch";
import { TaskStatus } from "../../types/dispatch";

export default {
  run: function (creep: Creep) {
    const task = GlobalDispatch.getAssignedTask(creep);
    if (!task || !task.data) return;

    const { targetRoom, sourceId, homeRoom } = task.data;

    // 1. Flee Logic
    // Check for Keepers
    const keeper = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: c => c.owner.username === 'Source Keeper'
    });
    
    if (keeper && creep.pos.getRangeTo(keeper) <= 4) {
        // Danger!
        // Check if Guard is handling it
        const guard = keeper.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: c => c.memory.role === 'sk_guard'
        });
        
        if (!guard || guard.pos.getRangeTo(keeper) > 2) {
            // No guard or guard far away -> FLEE
            const fleePath = PathFinder.search(creep.pos, { pos: keeper.pos, range: 6 }, {
                flee: true,
                roomCallback: (roomName) => {
                     // Default cost matrix
                     return new PathFinder.CostMatrix();
                }
            });
            if (fleePath.path.length > 0) {
                creep.moveByPath(fleePath.path);
                creep.say("😱 Flee");
                return;
            }
        }
    }

    // 2. Move to Room
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        visualizePathStyle: { stroke: "#ffff00" },
        reusePath: 50,
      });
      return;
    }

    // 3. Mining Logic
    const source = Game.getObjectById(sourceId as Id<Source>);
    if (source) {
        // Container Logic (Stand on container)
        const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        })[0];
        
        if (container && !creep.pos.isEqualTo(container.pos)) {
            creep.moveTo(container);
        } else if (!creep.pos.inRangeTo(source, 1)) {
            creep.moveTo(source);
        }
        
        if (creep.harvest(source) === ERR_NOT_ENOUGH_RESOURCES) {
            // Source empty?
            if (source.ticksToRegeneration > 0) {
                creep.say(`Sleep ${source.ticksToRegeneration}`);
            }
        }
    } else {
        // Source not visible? Move to stored pos
        if (task.pos) {
            creep.moveTo(new RoomPosition(task.pos.x, task.pos.y, task.pos.roomName));
        }
    }
  }
};
