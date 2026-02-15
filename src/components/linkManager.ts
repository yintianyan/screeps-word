import Cache from "./memoryManager";
import { GlobalDispatch } from "../ai/GlobalDispatch";
import { TaskPriority, TaskType } from "../types/dispatch";

const linkManager = {
  run: function (room: Room) {
    const links = Cache.getTick(`links_${room.name}`, () =>
      room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
      }),
    ) as StructureLink[];

    if (links.length < 2) return;

    const sourceLinks: StructureLink[] = [];
    let controllerLink: StructureLink | null = null;
    let hubLink: StructureLink | null = null;

    const sources = Cache.getTick(`sources_${room.name}`, () =>
      room.find(FIND_SOURCES),
    ) as Source[];
    const spawns = Cache.getTick(`spawns_${room.name}`, () => room.find(FIND_MY_SPAWNS)) as StructureSpawn[];
    const spawn = spawns[0];

    links.forEach((link) => {
      if (sources.some((s) => s.pos.inRangeTo(link, 2))) {
        sourceLinks.push(link);
      }

      if (room.controller && link.pos.inRangeTo(room.controller, 3)) {
        controllerLink = link;
      }

      if (
        (spawn && link.pos.inRangeTo(spawn, 3)) ||
        (room.storage && link.pos.inRangeTo(room.storage, 2))
      ) {
        hubLink = link;
      }
    });

    const controllerDesired =
      room.controller && room.controller.ticksToDowngrade < 4000 ? 600 : 400;
    const hubDesired = 400;
    const controllerNeed = controllerLink
      ? Math.max(0, controllerDesired - controllerLink.store[RESOURCE_ENERGY])
      : 0;
    const hubNeed = hubLink
      ? Math.max(0, hubDesired - hubLink.store[RESOURCE_ENERGY])
      : 0;

    if (controllerLink && controllerNeed >= 200) {
      const taskId = `LINK_FILL_${room.name}_${controllerLink.id}`;
      if (!GlobalDispatch.getTask(taskId)) {
        GlobalDispatch.registerTask({
          id: taskId,
          type: TaskType.TRANSFER,
          priority:
            room.controller && room.controller.ticksToDowngrade < 4000
              ? TaskPriority.CRITICAL
              : TaskPriority.HIGH,
          targetId: controllerLink.id,
          pos: controllerLink.pos,
          maxCreeps: 1,
          creepsAssigned: [],
          requirements: { bodyParts: [CARRY], minCapacity: 50 },
          validRoles: ["hauler"],
          estimatedDuration: 20,
          creationTime: Game.time,
          autoRemove: true,
          data: { resource: RESOURCE_ENERGY },
        } as any);
      }
    }

    if (hubLink && hubNeed >= 200) {
      const taskId = `LINK_FILL_${room.name}_${hubLink.id}`;
      if (!GlobalDispatch.getTask(taskId)) {
        GlobalDispatch.registerTask({
          id: taskId,
          type: TaskType.TRANSFER,
          priority: TaskPriority.MEDIUM,
          targetId: hubLink.id,
          pos: hubLink.pos,
          maxCreeps: 1,
          creepsAssigned: [],
          requirements: { bodyParts: [CARRY], minCapacity: 50 },
          validRoles: ["hauler"],
          estimatedDuration: 20,
          creationTime: Game.time,
          autoRemove: true,
          data: { resource: RESOURCE_ENERGY },
        } as any);
      }
    }

    const receivers: { link: StructureLink; need: number }[] = [];
    if (controllerLink) {
      receivers.push({
        link: controllerLink,
        need: Math.max(0, controllerDesired - controllerLink.store[RESOURCE_ENERGY]),
      });
    }
    if (hubLink && (!controllerLink || hubLink.id !== controllerLink.id)) {
      receivers.push({
        link: hubLink,
        need: Math.max(0, hubDesired - hubLink.store[RESOURCE_ENERGY]),
      });
    }

    receivers.sort((a, b) => b.need - a.need);
    const receiver = receivers.find((r) => r.need >= 100 && r.link.store.getFreeCapacity(RESOURCE_ENERGY) >= 100);

    if (receiver) {
      const donors = links
        .filter((l) => l.cooldown === 0 && l.store[RESOURCE_ENERGY] >= 200 && l.id !== receiver.link.id)
        .sort((a, b) => b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY]);

      const donor = donors[0];
      if (donor) {
        const amount = Math.min(
          donor.store[RESOURCE_ENERGY],
          receiver.link.store.getFreeCapacity(RESOURCE_ENERGY),
        );
        const res = donor.transferEnergy(receiver.link, amount);
        if (res !== OK) {
          if (!room.memory.linkManager) room.memory.linkManager = {};
          room.memory.linkManager.lastError = { time: Game.time, code: res };
        }
      }
      return;
    }

    const idleReceiver = hubLink && (!controllerLink || hubLink.id !== controllerLink.id) ? hubLink : controllerLink;
    if (idleReceiver) {
      const donor = sourceLinks
        .filter((l) => l.cooldown === 0 && l.store[RESOURCE_ENERGY] >= 400 && l.id !== idleReceiver.id)
        .sort((a, b) => b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY])[0];
      if (donor && idleReceiver.store.getFreeCapacity(RESOURCE_ENERGY) >= 200) {
        const amount = Math.min(donor.store[RESOURCE_ENERGY], idleReceiver.store.getFreeCapacity(RESOURCE_ENERGY));
        const res = donor.transferEnergy(idleReceiver, amount);
        if (res !== OK) {
          if (!room.memory.linkManager) room.memory.linkManager = {};
          room.memory.linkManager.lastError = { time: Game.time, code: res };
        }
      }
    }
  },
};

export default linkManager;
