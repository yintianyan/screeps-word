import { Cache } from "./Cache";

type ReservationEntry = {
  slots: number;
  assigned: Record<string, true>;
};

type ReservationBook = Record<string, ReservationEntry>;

function ensureEntry(
  book: ReservationBook,
  targetId: string,
): ReservationEntry {
  const existing = book[targetId];
  if (existing) return existing;
  const next: ReservationEntry = { slots: 1, assigned: {} };
  book[targetId] = next;
  return next;
}

function seedFromCreepMemory(book: ReservationBook): void {
  for (const creep of Object.values(Game.creeps)) {
    const targetId = creep.memory.targetId;
    const taskId = creep.memory.taskId;
    if (typeof targetId !== "string" || targetId.length === 0) continue;
    if (typeof taskId !== "string" || taskId.length === 0) continue;
    const entry = ensureEntry(book, targetId);
    entry.assigned[creep.name] = true;
  }
}

function getBook(): ReservationBook {
  return Cache.getTick("reservation:book", () => {
    const book: ReservationBook = {};
    seedFromCreepMemory(book);
    return book;
  });
}

/**
 * 获取目标的当前预订数
 *
 * @param targetId 目标 ID
 */
export function reservedCount(targetId: string): number {
  const entry = getBook()[targetId];
  if (!entry) return 0;
  return Object.keys(entry.assigned).length;
}

/**
 * 尝试预订目标
 *
 * 用于防止多个 Creep 同时抢占同一个资源（如 Source, Container）。
 *
 * @param targetId 目标 ID
 * @param creepName Creep 名称
 * @param slots 最大允许的预订数 (例如 Source 最多允许 3 个 Miner)
 * @returns 是否预订成功
 */
export function tryReserve(
  targetId: string,
  creepName: string,
  slots: number,
): boolean {
  const book = getBook();
  const entry = ensureEntry(book, targetId);
  // 动态更新最大槽位数
  entry.slots = Math.max(entry.slots, Math.max(1, slots));

  // 如果已经预订过，直接成功
  if (entry.assigned[creepName]) return true;
  // 如果已满，预订失败
  if (Object.keys(entry.assigned).length >= entry.slots) return false;

  // 新增预订
  entry.assigned[creepName] = true;
  return true;
}
