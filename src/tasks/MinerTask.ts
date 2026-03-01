import { TaskProcess } from "./TaskProcess";
import { processRegistry } from "../core/ProcessRegistry";
import { smartMove } from "./move/smartMove";

export class MinerTask extends TaskProcess {
  protected isValid(): boolean {
    return !!this.creep;
  }

  protected execute(): void {
    const creep = this.creep;
    if (!creep) return;

    const room = creep.room;
    const sourceId = this.data.sourceId || creep.memory.sourceId;
    if (!sourceId) return; // Should be in memory

    const source = Game.getObjectById(sourceId as Id<Source>);
    if (!source) return;

    // Logic from runMiner
    const plan = room.memory.mining?.[source.id];
    const cp = plan?.containerPos;
    
    if (cp) {
        const at = creep.pos.x === cp.x && creep.pos.y === cp.y;
        if (!at) {
            smartMove(creep, new RoomPosition(cp.x, cp.y, room.name), {
                reusePath: 20,
                range: 0,
            });
            return;
        }
    } else {
        // No container planned yet? Just go to source
        if (!creep.pos.inRangeTo(source, 1)) {
            smartMove(creep, source, { reusePath: 20, range: 1 });
            return;
        }
    }

    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        // Link
        const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_LINK && (s as StructureLink).store.getFreeCapacity(RESOURCE_ENERGY) > 0
        })[0] as StructureLink | undefined;
        
        if (link) {
            creep.transfer(link, RESOURCE_ENERGY);
            return;
        }

        // Container
        const containerHere = creep.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer | undefined;
        if (containerHere && containerHere.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            // Repair if needed?
            if (containerHere.hits < containerHere.hitsMax) {
                creep.repair(containerHere);
                return;
            }
            creep.transfer(containerHere, RESOURCE_ENERGY);
            return;
        }
        
        // Construction Site (Container)
        const site = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES).find(s => s.structureType === STRUCTURE_CONTAINER);
        if (site) {
            creep.build(site);
            return;
        }

        // Drop
        // Only drop if we have excess energy to avoid decay if container is full? 
        // Or just harvest and drop.
        // Actually, if container is full, we shouldn't drop, we should wait?
        // But runMiner logic says drop.
        // If container is full, dropping piles up energy on ground (decay).
        // Better to repair container or idle.
        if (containerHere && containerHere.hits < containerHere.hitsMax) {
             creep.repair(containerHere);
             return;
        }
        
        // If no link/container space, just drop (standard mining)
        // But only if we are not ON a full container (which we handled above)
        // If container is full, we are blocked.
        // If we drop, it goes to ground on top of container.
    }

    creep.harvest(source);
  }
}

processRegistry.register(MinerTask, "MinerTask");
