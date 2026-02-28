function getHostileTarget(room: Room): Creep | null {
  return room.find(FIND_HOSTILE_CREEPS)[0] ?? null;
}

function getHealTarget(room: Room): Creep | null {
  const injured = room.find(FIND_MY_CREEPS, { filter: (c) => c.hits < c.hitsMax });
  return injured[0] ?? null;
}

function getUrgentRepair(room: Room): Structure | null {
  const targets = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
      s.hits < 1000,
  });
  return targets[0] ?? null;
}

function getMaintenanceRepair(room: Room): Structure | null {
  const targets = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART &&
      s.hits < s.hitsMax,
  });
  targets.sort((a, b) => a.hits - b.hits);
  return targets[0] ?? null;
}

export function runTowers(room: Room): void {
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];

  if (towers.length === 0) return;

  const hostile = getHostileTarget(room);
  if (hostile) {
    for (const tower of towers) tower.attack(hostile);
    return;
  }

  const heal = getHealTarget(room);
  if (heal) {
    for (const tower of towers) tower.heal(heal);
    return;
  }

  const urgent = getUrgentRepair(room);
  if (urgent) {
    for (const tower of towers) {
      if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 300) continue;
      tower.repair(urgent);
    }
    return;
  }

  const maintenance = getMaintenanceRepair(room);
  if (maintenance) {
    for (const tower of towers) {
      if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 500) continue;
      tower.repair(maintenance);
    }
  }
}
