import { GlobalDispatch } from "../../ai/GlobalDispatch";
import remoteHauler from "./remoteHauler"; // Reuse base logic? 
// Actually remoteHauler export is object with run.
// We can wrap it.

export default {
  run: function (creep: Creep) {
    // 1. Safety Check
    const hostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 5, {
        filter: c => c.owner.username === 'Source Keeper' || c.owner.username === 'Invader'
    });
    
    if (hostiles.length > 0) {
        // Check if Guard is handling it
        const guard = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: c => c.memory.role === 'sk_guard'
        });
        
        // If no guard or guard far away, flee
        if (!guard || guard.pos.getRangeTo(hostiles[0]) > 3) {
             const fleePath = PathFinder.search(creep.pos, { pos: hostiles[0].pos, range: 6 }, {
                flee: true,
                roomCallback: (roomName) => {
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

    // 2. Run Standard Logic
    remoteHauler.run(creep);
  }
};
