type TickCacheEntry = { tick: number; value: unknown };
type HeapCacheEntry = { expireAt: number; value: unknown };

type CacheHeap = {
  tick: Record<string, TickCacheEntry>;
  heap: Record<string, HeapCacheEntry>;
};

function getHeapStore(): CacheHeap {
  const g = (typeof global !== "undefined"
    ? (global as unknown)
    : ({} as unknown)) as { __cacheHeap?: CacheHeap };
  if (!g.__cacheHeap) g.__cacheHeap = { tick: {}, heap: {} };
  return g.__cacheHeap;
}

export class Cache {
  public static clearTick(): void {
    const store = getHeapStore();
    store.tick = {};
  }

  public static getTick<T>(key: string, build: () => T): T {
    const store = getHeapStore();
    const e = store.tick[key];
    if (e && e.tick === Game.time) return e.value as T;
    const value = build();
    store.tick[key] = { tick: Game.time, value };
    return value;
  }

  public static getHeap<T>(key: string, ttl: number, build: () => T): T {
    const store = getHeapStore();
    const e = store.heap[key];
    if (e && e.expireAt >= Game.time) return e.value as T;
    const value = build();
    store.heap[key] = { expireAt: Game.time + Math.max(1, ttl), value };
    return value;
  }
}
