type TickCacheEntry = { tick: number; value: unknown };
type HeapCacheEntry = { expireAt: number; value: unknown };

type CacheHeap = {
  tick: Record<string, TickCacheEntry>;
  heap: Record<string, HeapCacheEntry>;
};

function getHeapStore(): CacheHeap {
  const g = (
    typeof global !== "undefined" ? (global as unknown) : ({} as unknown)
  ) as { __cacheHeap?: CacheHeap };
  if (!g.__cacheHeap) g.__cacheHeap = { tick: {}, heap: {} };
  return g.__cacheHeap;
}

/**
 * 缓存系统
 *
 * 提供两级缓存机制：
 * 1. Tick Cache: 仅在当前 tick 有效，tick 结束自动失效。
 * 2. Heap Cache: 在 Global Heap 中存储，支持自定义过期时间 (TTL)。
 *
 * 注意：由于 Screeps 的 Global Reset 机制，Heap Cache 可能会被随时清空，
 * 因此不能用于存储持久化数据，只能用于性能优化。
 */
export class Cache {
  /**
   * 清除所有 Tick 缓存
   * 应在每 tick 开始时调用。
   */
  public static clearTick(): void {
    const store = getHeapStore();
    store.tick = {};
  }

  /**
   * 获取或创建 Tick 缓存
   *
   * @param key 缓存键
   * @param build 缓存生成函数 (当缓存不存在或过期时调用)
   */
  public static getTick<T>(key: string, build: () => T): T {
    const store = getHeapStore();
    const e = store.tick[key];
    if (e && e.tick === Game.time) return e.value as T;
    const value = build();
    store.tick[key] = { tick: Game.time, value };
    return value;
  }

  /**
   * 获取或创建 Heap 缓存 (跨 Tick)
   *
   * @param key 缓存键
   * @param ttl 存活时间 (Tick 数)
   * @param build 缓存生成函数
   */
  public static getHeap<T>(key: string, ttl: number, build: () => T): T {
    const store = getHeapStore();
    const e = store.heap[key];
    if (e && e.expireAt >= Game.time) return e.value as T;
    const value = build();
    store.heap[key] = { expireAt: Game.time + Math.max(1, ttl), value };
    return value;
  }
}
