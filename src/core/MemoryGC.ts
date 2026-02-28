export function gcCreepMemory(): void {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }
}

export function gcRoomStats(maxHistory = 100): void {
  if (!Memory.stats) return;
  for (const roomName in Memory.stats.rooms) {
    const history = Memory.stats.rooms[roomName].history;
    if (history.length > maxHistory)
      history.splice(0, history.length - maxHistory);
  }
}
