import { GlobalDispatch } from "../ai/GlobalDispatch";

export default {
  run: function (creep: Creep) {
    const task = GlobalDispatch.getAssignedTask(creep);

    if (!task) {
      // Idle logic? Recycle?
      return;
    }

    const targetRoom = task.targetId; // For scout task, targetId IS the room name

    // 1. Check if we are in target room
    if (creep.room.name !== targetRoom) {
      // Move to room
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        visualizePathStyle: { stroke: "#ffffff" },
      });
      return;
    }

    // 2. We are in room -> Mission Complete
    // Just by being here, Game.rooms[targetRoom] becomes visible to the script
    // RemoteManager will see it next tick and generate mining tasks if needed

    // Move to controller to sign it? Or just hang out?
    // Move away from exit to avoid bouncing
    creep.moveTo(25, 25);

    // Optional: Mark task complete if we just needed a peek?
    // But usually we want scout to stay for visibility.
    // If RemoteManager sees vision, it might cancel scout task?
    // For now, Scout stays until it dies.
  },
};
