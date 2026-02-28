import { GlobalDispatch } from "../../ai/GlobalDispatch";

export default {
  run: function (creep: Creep) {
    const task = GlobalDispatch.getAssignedTask(creep);

    if (!task) {
      // Idle logic? Recycle?
      return;
    }

    const targetRoom = task.targetId; // For scout task, targetId IS the room name

    // 1. Check if we are in target room
    // Use targetRoom directly if not in it, or if on exit
    if (
      creep.room.name !== targetRoom ||
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49
    ) {
      // Move to room
      // Use findRoute for inter-room pathfinding if simple moveTo fails
      const exitDir = Game.map.findExit(creep.room, targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
      
      if (exit && creep.room.name !== targetRoom) {
          creep.moveTo(exit, { visualizePathStyle: { stroke: "#ffffff" }, reusePath: 20 });
      } else {
          // In room or on exit, move to center
          creep.moveTo(new RoomPosition(25, 25, targetRoom), {
            visualizePathStyle: { stroke: "#ffffff" },
            reusePath: 20,
          });
      }
      return;
    }

    // 2. We are in room -> Mission Complete
    // Just by being here, Game.rooms[targetRoom] becomes visible to the script
    // RemoteManager will see it next tick and generate mining tasks if needed

    // Move to controller to sign it? Or just hang out?
    // Move away from exit to avoid bouncing
    if (
      creep.pos.x <= 2 ||
      creep.pos.x >= 47 ||
      creep.pos.y <= 2 ||
      creep.pos.y >= 47
    ) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom));
    }

    // Optional: Mark task complete if we just needed a peek?
    // But usually we want scout to stay for visibility.
    // If RemoteManager sees vision, it might cancel scout task?
    // For now, Scout stays until it dies.
  },
};
