import Cache from "./memoryManager";

const linkManager = {
  run: function (room: Room) {
    const links = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    }) as StructureLink[];

    if (links.length < 2) return;

    const sourceLinks: StructureLink[] = [];
    let controllerLink: StructureLink | null = null;
    let storageLink: StructureLink | null = null;

    const sources = room.find(FIND_SOURCES);

    links.forEach((link) => {
      // Check Source Proximity
      if (sources.some((s) => s.pos.inRangeTo(link, 2))) {
        sourceLinks.push(link);
      }

      // Check Controller Proximity
      if (room.controller && link.pos.inRangeTo(room.controller, 3)) {
        controllerLink = link;
      }

      // Check Storage Proximity
      if (room.storage && link.pos.inRangeTo(room.storage, 2)) {
        storageLink = link;
      }
    });

    // 1. Source Links Transfer Logic
    sourceLinks.forEach((sourceLink) => {
      if (sourceLink.cooldown > 0) return;
      if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return; // Empty

      // Priority 1: Controller Link (if empty and distinct)
      // Only fill if Controller Link is significantly empty to avoid small transfers?
      // Link capacity is 800.
      if (
        controllerLink &&
        controllerLink.id !== sourceLink.id &&
        controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 100 // Can accept a chunk
      ) {
        sourceLink.transferEnergy(controllerLink);
        return;
      }

      // Priority 2: Storage Link (if distinct)
      // Dump everything else to Storage
      if (
        storageLink &&
        storageLink.id !== sourceLink.id &&
        storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 100
      ) {
        sourceLink.transferEnergy(storageLink);
        return;
      }
    });

    // 2. Storage Link -> Controller Link Logic
    // If Controller Link is low (< 400) and Storage Link has energy, push to it.
    // This ensures Upgraders always have energy even if Source Links are busy or empty.
    if (
      storageLink &&
      controllerLink &&
      storageLink.id !== controllerLink.id &&
      storageLink.cooldown === 0 &&
      storageLink.store.getUsedCapacity(RESOURCE_ENERGY) >= 400 && // Has enough to send
      controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400 // Controller needs it
    ) {
      // Also check if room storage has energy, we don't want to drain the link if it's the only buffer?
      // Actually, if it's in the link, it's meant to be moved.
      storageLink.transferEnergy(controllerLink);
    }
  },
};

export default linkManager;
