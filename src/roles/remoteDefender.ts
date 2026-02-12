import { GlobalDispatch } from "../ai/GlobalDispatch";

export default {
  run: function (creep: Creep) {
    const task = GlobalDispatch.getAssignedTask(creep);
    if (!task || !task.data) return;

    const { targetRoom } = task.data;

    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom));
      return;
    }

    const target = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (target) {
      if (creep.attack(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
      }
    }
  },
};
