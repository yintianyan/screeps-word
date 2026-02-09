import { GlobalDispatch } from "../ai/GlobalDispatch";

export default {
  run: function (creep: Creep) {
    const task = GlobalDispatch.getAssignedTask(creep);
    if (!task || !task.data) return;

    const { targetRoom, sourceId } = task.data;

    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom));
      return;
    }

    const source = Game.getObjectById(sourceId as Id<Source>);
    if (!source) return; // Should not happen if visible

    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source);
    } else {
      // Harvested. If we have carry parts, we might need to drop or transfer?
      // Basic Remote Harvester: Just harvest and drop (or fill container if built).
      // If we have a container, sit on it.
      const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      })[0];

      if (container) {
        if (!creep.pos.isEqualTo(container.pos)) {
          creep.moveTo(container);
        }
      }
    }
  },
};
