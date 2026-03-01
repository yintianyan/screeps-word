import { Cache } from "./Cache";

type ReservationEntry = {
  slots: number;
  assigned: Record<string, true>;
};

type ReservationBook = Record<string, ReservationEntry>;

function ensureEntry(book: ReservationBook, targetId: string): ReservationEntry {
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

export function reservedCount(targetId: string): number {
  const entry = getBook()[targetId];
  if (!entry) return 0;
  return Object.keys(entry.assigned).length;
}

export function tryReserve(
  targetId: string,
  creepName: string,
  slots: number,
): boolean {
  const book = getBook();
  const entry = ensureEntry(book, targetId);
  entry.slots = Math.max(entry.slots, Math.max(1, slots));

  if (entry.assigned[creepName]) return true;
  if (Object.keys(entry.assigned).length >= entry.slots) return false;

  entry.assigned[creepName] = true;
  return true;
}
