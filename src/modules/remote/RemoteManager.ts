import { GlobalDispatch } from "../../ai/GlobalDispatch";
import { TaskPriority, TaskType } from "../../types/dispatch";
import Cache from "../../components/memoryManager";

export class RemoteManager {
  static run(room: Room) {
    // Only run if we have remotes or need to scout
    // 1. Discovery (Scout neighbors if RCL >= 2)
    if (room.controller && room.controller.level >= 2) {
      this.manageScouting(room);
    }

    // 2. Manage Remotes
    if (room.memory.remotes) {
      room.memory.remotes.forEach((remoteName) => {
        this.manageRemoteRoom(room, remoteName);
      });
    }
  }

  private static manageScouting(room: Room) {
    if (!room.memory.scout)
      room.memory.scout = { lastScan: 0, status: "pending" };

    // Scan every 1000 ticks or if pending
    if (Game.time - room.memory.scout.lastScan > 1000) {
      room.memory.scout.status = "pending";
    }

    if (room.memory.scout.status === "pending") {
      const exits = Game.map.describeExits(room.name);
      if (!exits) return;

      // Generate scout tasks for unknown rooms
      for (const dir in exits) {
        const targetRoom = exits[dir as any];
        // If we don't have memory of this room or it's old
        if (!Memory.rooms[targetRoom]) {
          GlobalDispatch.registerTask({
            id: `scout_${targetRoom}`,
            type: TaskType.SCOUT,
            priority: TaskPriority.LOW,
            targetId: targetRoom, // Target Room Name
            pos: new RoomPosition(25, 25, targetRoom), // Dummy pos
            requirements: { bodyParts: [MOVE] },
            creepsAssigned: [],
            maxCreeps: 1,
            validRoles: ["scout"],
            creationTime: Game.time,
          });
        }
      }
      room.memory.scout.lastScan = Game.time;
      room.memory.scout.status = "active"; // Tasks dispatched
    }
  }

  private static manageRemoteRoom(homeRoom: Room, remoteName: string) {
    const remoteRoom = Game.rooms[remoteName];

    // A. Vision Lost -> Scout
    if (!remoteRoom) {
      GlobalDispatch.registerTask({
        id: `scout_${remoteName}_vision`,
        type: TaskType.SCOUT,
        priority: TaskPriority.HIGH, // High priority to regain vision
        targetId: remoteName,
        pos: new RoomPosition(25, 25, remoteName),
        requirements: { bodyParts: [MOVE] },
        creepsAssigned: [],
        maxCreeps: 1,
        validRoles: ["scout"],
        creationTime: Game.time,
      });
      return;
    }

    // B. Vision Active -> Mine
    const sources = remoteRoom.find(FIND_SOURCES);
    sources.forEach((source) => {
      // 1. Dispatch Miner
      const minerTaskId = `remote_mine_${source.id}`;
      GlobalDispatch.registerTask({
        id: minerTaskId,
        type: TaskType.REMOTE_HARVEST,
        priority: TaskPriority.NORMAL,
        targetId: source.id,
        pos: source.pos,
        data: {
          sourceId: source.id,
          targetRoom: remoteName,
          homeRoom: homeRoom.name,
        },
        requirements: { bodyParts: [WORK, MOVE, CARRY] },
        creepsAssigned: [],
        maxCreeps: 1, // 1 Miner per source
        validRoles: ["remote_harvester"],
        creationTime: Game.time,
      });

      // 2. Dispatch Hauler (if energy piled up or container exists)
      // Simple logic: 1 Hauler per source for now.
      // Advanced: Calculate throughput.
      const haulerTaskId = `remote_haul_${source.id}`;
      GlobalDispatch.registerTask({
        id: haulerTaskId,
        type: TaskType.REMOTE_HAUL,
        priority: TaskPriority.NORMAL,
        targetId: source.id, // Haul from this source area
        pos: source.pos,
        data: {
          sourceId: source.id,
          targetRoom: remoteName,
          homeRoom: homeRoom.name,
        },
        requirements: { bodyParts: [CARRY, MOVE] },
        creepsAssigned: [],
        maxCreeps: 2, // Start with 2 haulers
        validRoles: ["remote_hauler"],
        creationTime: Game.time,
      });
    });
  }
}
