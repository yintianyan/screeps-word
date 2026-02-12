import { GlobalDispatch } from "../../ai/GlobalDispatch";
import { TaskPriority, TaskType } from "../../types/dispatch";
import Cache from "../../components/memoryManager";

export class RemoteManager {
  static run(room: Room) {
    // [Optimization] CPU Bucket Check
    if (Game.cpu.bucket < 500) {
      if (Game.time % 100 === 0)
        console.log(
          `[RemoteManager] Low CPU, skipping remote management for ${room.name}`,
        );
      return;
    }

    // Debug log
    if (Game.time % 20 === 0)
      console.log(
        `[RemoteManager] Running for ${room.name} (RCL: ${room.controller?.level})`,
      );

    // Only run if we have remotes or need to scout
    // 1. Discovery (Scout neighbors if RCL >= 2)
    if (room.controller && room.controller.level >= 2) {
      this.manageScouting(room);
    }

    // 2. Manage Remotes
    if (room.memory.remotes) {
      // [Optimization] Concurrency Control - Process 1 remote per tick per room to spread load?
      // Or just process all. With 5 remotes, it's fine.
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
          const taskId = `scout_${targetRoom}`;
          // Register only if not exists
          if (!GlobalDispatch.getTask(taskId)) {
            GlobalDispatch.registerTask({
              id: taskId,
              type: TaskType.SCOUT,
              priority: TaskPriority.LOW,
              targetId: targetRoom, // Target Room Name
              pos: new RoomPosition(25, 25, targetRoom), // Dummy pos
              requirements: { bodyParts: [MOVE] },
              creepsAssigned: [],
              maxCreeps: 1,
              validRoles: ["scout"],
              creationTime: Game.time,
              autoRemove: true, // [Optimization] Auto-delete when done
            });
          }
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
      const scoutId = `scout_${remoteName}_vision`;
      if (!GlobalDispatch.getTask(scoutId)) {
        GlobalDispatch.registerTask({
          id: scoutId,
          type: TaskType.SCOUT,
          priority: TaskPriority.HIGH, // High priority to regain vision
          targetId: remoteName,
          pos: new RoomPosition(25, 25, remoteName),
          requirements: { bodyParts: [MOVE] },
          creepsAssigned: [],
          maxCreeps: 1,
          validRoles: ["scout"],
          creationTime: Game.time,
          autoRemove: true,
        });
      }
      return;
    }

    // B. Vision Active -> Mine & Defend

    // [Optimization] Cache Sources in Memory to avoid find() every tick
    // (Although we have vision now, so find() is cheap, but memory is persistent)
    if (!remoteRoom.memory.sources) {
      remoteRoom.memory.sources = remoteRoom.find(FIND_SOURCES).map((s) => ({
        id: s.id,
        pos: s.pos,
      }));
    }

    // 0. Defense
    const hostiles = remoteRoom.find(FIND_HOSTILE_CREEPS, {
      filter: (c) =>
        c.getActiveBodyparts(ATTACK) > 0 ||
        c.getActiveBodyparts(RANGED_ATTACK) > 0,
    });
    if (hostiles.length > 0) {
      const defendId = `remote_defend_${remoteName}`;
      // Refresh task if needed
      if (!GlobalDispatch.getTask(defendId)) {
        GlobalDispatch.registerTask({
          id: defendId,
          type: TaskType.REMOTE_DEFEND,
          priority: TaskPriority.CRITICAL,
          targetId: hostiles[0].id,
          pos: hostiles[0].pos,
          data: { targetRoom: remoteName, homeRoom: homeRoom.name },
          requirements: { bodyParts: [TOUGH, ATTACK, MOVE, MOVE] },
          creepsAssigned: [],
          maxCreeps: Math.min(hostiles.length, 3),
          validRoles: ["remote_defender"],
          creationTime: Game.time,
          autoRemove: true, // Defend task is done when enemies are gone (handled by creep logic usually, but queue cleanup helps)
        });
      }
    }

    // 0.5 Reservation
    if (
      remoteRoom.controller &&
      !remoteRoom.controller.owner &&
      (!remoteRoom.controller.reservation ||
        remoteRoom.controller.reservation.ticksToEnd < 1000)
    ) {
      const reserveId = `remote_reserve_${remoteName}`;
      if (!GlobalDispatch.getTask(reserveId)) {
        GlobalDispatch.registerTask({
          id: reserveId,
          type: TaskType.REMOTE_RESERVE,
          priority: TaskPriority.HIGH,
          targetId: remoteRoom.controller.id,
          pos: remoteRoom.controller.pos,
          data: { targetRoom: remoteName, homeRoom: homeRoom.name },
          requirements: { bodyParts: [CLAIM, MOVE] },
          creepsAssigned: [],
          maxCreeps: 1,
          validRoles: ["remote_reserver"],
          creationTime: Game.time,
          // Reserve tasks are continuous, don't autoRemove
        });
      }
    }

    // 1. Dispatch Miner & Hauler
    // Iterate cached sources
    remoteRoom.memory.sources?.forEach((sourceData: any) => {
      const sourceId = sourceData.id;
      const sourcePos = new RoomPosition(
        sourceData.pos.x,
        sourceData.pos.y,
        sourceData.pos.roomName,
      );

      // Miner Task
      const minerTaskId = `remote_mine_${sourceId}`;
      const existingMinerTask = GlobalDispatch.getTask(minerTaskId);

      // [Optimization] Stale Task Recovery
      if (existingMinerTask) {
        if (
          existingMinerTask.creepsAssigned.length === 0 &&
          Game.time - existingMinerTask.creationTime > 2000
        ) {
          console.log(
            `[RemoteManager] Resetting stale miner task ${minerTaskId}`,
          );
          GlobalDispatch.deleteTask(minerTaskId);
        }
      }

      if (!GlobalDispatch.getTask(minerTaskId)) {
        GlobalDispatch.registerTask({
          id: minerTaskId,
          type: TaskType.REMOTE_HARVEST,
          priority: TaskPriority.NORMAL,
          targetId: sourceId,
          pos: sourcePos,
          data: {
            sourceId: sourceId,
            targetRoom: remoteName,
            homeRoom: homeRoom.name,
          },
          requirements: { bodyParts: [WORK, MOVE, CARRY] },
          creepsAssigned: [],
          maxCreeps: 1, // 1 Miner per source
          validRoles: ["remote_harvester"],
          creationTime: Game.time,
        });
      }

      // Hauler Task
      // [Optimization] Calculate throughput requirement
      // Distance estimation
      const distance =
        Game.map.getRoomLinearDistance(homeRoom.name, remoteName) * 50;
      // Rough estimate, can be improved with pathfinder cache

      const haulerTaskId = `remote_haul_${sourceId}`;
      const existingHaulTask = GlobalDispatch.getTask(haulerTaskId);

      // Adjust maxCreeps based on piled energy
      let maxHaulers = 2;
      // If we have vision, check pile
      const sourceObj = Game.getObjectById(sourceId as Id<Source>);
      if (sourceObj) {
        const pile = sourceObj.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
          filter: (r) => r.resourceType === RESOURCE_ENERGY,
        });
        const pileAmount = pile.reduce((sum, r) => sum + r.amount, 0);
        if (pileAmount > 1000) maxHaulers = 3;
        if (pileAmount > 2000) maxHaulers = 4;
      }

      if (!existingHaulTask) {
        GlobalDispatch.registerTask({
          id: haulerTaskId,
          type: TaskType.REMOTE_HAUL,
          priority: TaskPriority.NORMAL,
          targetId: sourceId,
          pos: sourcePos,
          data: {
            sourceId: sourceId,
            targetRoom: remoteName,
            homeRoom: homeRoom.name,
          },
          requirements: { bodyParts: [CARRY, MOVE] },
          creepsAssigned: [],
          maxCreeps: maxHaulers,
          validRoles: ["remote_hauler"],
          creationTime: Game.time,
        });
      } else {
        // Dynamic update of maxCreeps?
        // Direct modification of memory task is risky but GlobalDispatch reads reference
        if (existingHaulTask.maxCreeps !== maxHaulers) {
          existingHaulTask.maxCreeps = maxHaulers;
        }
      }
    });
  }
}
