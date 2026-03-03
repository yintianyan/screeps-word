/**
 * 清理无效的 Creep 内存
 *
 * 遍历 Memory.creeps，删除 Game.creeps 中不存在的 Creep 内存。
 * 通常在主循环开始时调用。
 */
export function gcCreepMemory(): void {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }
}

function inferRoleFromName(name: string): string | null {
  const prefix = name.split("_")[0] ?? "";
  if (prefix === "W") return "worker";
  if (prefix === "M") return "miner";
  if (prefix === "H") return "hauler";
  if (prefix === "DI") return "distributor";
  if (prefix === "D") return "defender";
  if (prefix === "S") return "scout";
  return null;
}

export function ensureCreepMemoryDefaults(): void {
  for (const creepName in Game.creeps) {
    const creep = Game.creeps[creepName];
    const mem = creep.memory as unknown as {
      role?: unknown;
      room?: unknown;
      working?: unknown;
      homeRoom?: unknown;
    };

    const role =
      typeof mem.role === "string" && mem.role.length > 0 ? mem.role : null;
    const inferred = inferRoleFromName(creep.name);
    const nextRole = role ?? inferred ?? "worker";
    if (role !== nextRole) mem.role = nextRole;

    if (typeof mem.room !== "string" || mem.room.length === 0)
      mem.room = creep.room.name;

    if (typeof mem.working !== "boolean") mem.working = false;

    if (typeof mem.homeRoom !== "string" || mem.homeRoom.length === 0) {
      if (creep.room.controller?.my) mem.homeRoom = creep.room.name;
    }
  }
}

/**
 * 清理过期的房间统计历史
 *
 * 防止 Memory.stats 无限增长。
 *
 * @param maxHistory 保留的最大历史记录条数
 */
export function gcRoomStats(maxHistory = 5): void {
  if (!Memory.stats) return;
  for (const roomName in Memory.stats.rooms) {
    const history = Memory.stats.rooms[roomName].history;
    if (history.length > maxHistory)
      history.splice(0, history.length - maxHistory);
  }
}
