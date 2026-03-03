type DebugConfig = {
  enabled?: boolean;
  sampleRate?: number;
  maxEvents?: number;
  maxTicks?: number;
  flushInterval?: number;
  roomFilter?: string[];
};

type DebugEvent = {
  time: number;
  tag: string;
  room?: string;
  creep?: string;
  pid?: string;
  data?: unknown;
};

type DebugTick = {
  time: number;
  counters?: Record<string, number>;
  gauges?: Record<string, number>;
  kernelTop?: Array<[string, number]>;
};

type DebugStats = {
  events?: DebugEvent[];
  ticks?: DebugTick[];
  counters?: Record<string, number>;
  gauges?: Record<string, number>;
  kernelTop?: Array<[string, number]>;
  lastFlush?: number;
};

function getCfg(): Required<DebugConfig> {
  const c = (Memory.config as unknown as { debug?: DebugConfig } | undefined)
    ?.debug;
  return {
    enabled: c?.enabled === true,
    sampleRate: typeof c?.sampleRate === "number" ? c.sampleRate : 1,
    maxEvents: typeof c?.maxEvents === "number" ? c.maxEvents : 200,
    maxTicks: typeof c?.maxTicks === "number" ? c.maxTicks : 200,
    flushInterval: typeof c?.flushInterval === "number" ? c.flushInterval : 5,
    roomFilter: Array.isArray(c?.roomFilter) ? c.roomFilter : [],
  };
}

function ensureStats(): StatsMemory {
  if (!Memory.stats) {
    Memory.stats = {
      rooms: {},
      cpu: { bucket: 0, used: 0, limit: 0, scheduler: 0 },
      time: 0,
    };
  }
  const stats = Memory.stats;
  if (!stats.rooms) stats.rooms = {};
  if (!stats.cpu) stats.cpu = { bucket: 0, used: 0, limit: 0, scheduler: 0 };
  if (!stats.time) stats.time = 0;
  return stats;
}

function ensureDebug(): DebugStats {
  const stats = ensureStats();
  const s = stats as unknown as { debug?: DebugStats };
  if (!s.debug) s.debug = {};
  return s.debug;
}

function shouldRecord(roomName?: string): boolean {
  const cfg = getCfg();
  if (!cfg.enabled) return false;
  if (cfg.sampleRate < 1 && Math.random() > cfg.sampleRate) return false;
  if (cfg.roomFilter.length > 0 && roomName) {
    if (!cfg.roomFilter.includes(roomName)) return false;
  }
  return true;
}

function trim(): void {
  const cfg = getCfg();
  if (!cfg.enabled) return;
  const d = ensureDebug();
  if (d.events && d.events.length > cfg.maxEvents)
    d.events.splice(0, d.events.length - cfg.maxEvents);
  if (d.ticks && d.ticks.length > cfg.maxTicks)
    d.ticks.splice(0, d.ticks.length - cfg.maxTicks);
}

/**
 * 调试与指标系统
 *
 * 功能：
 * 1. Event: 记录关键事件 (如任务分配、状态变更)，支持采样和房间过滤。
 * 2. Counter: 累加计数器 (如 creep 生成数量)。
 * 3. Gauge: 瞬时值指标 (如 CPU 使用率、Bucket、Creep 总数)。
 * 4. Profiler: 记录 Kernel 耗时最高的进程类型。
 *
 * 数据存储在 Memory.stats.debug 中。
 */
export class Debug {
  public static enabled(): boolean {
    return getCfg().enabled;
  }

  public static event(
    tag: string,
    data?: unknown,
    meta?: Partial<DebugEvent>,
  ): void {
    const room = meta?.room;
    if (!shouldRecord(room)) return;
    const d = ensureDebug();
    if (!d.events) d.events = [];
    d.events.push({
      time: Game.time,
      tag,
      room,
      creep: meta?.creep,
      pid: meta?.pid,
      data,
    });
    trim();
  }

  public static inc(key: string, delta = 1): void {
    if (!getCfg().enabled) return;
    const d = ensureDebug();
    if (!d.counters) d.counters = {};
    d.counters[key] = (d.counters[key] ?? 0) + delta;
  }

  public static gauge(key: string, value: number): void {
    if (!getCfg().enabled) return;
    const d = ensureDebug();
    if (!d.gauges) d.gauges = {};
    d.gauges[key] = value;
  }

  public static setKernelTop(top: Array<[string, number]>): void {
    if (!getCfg().enabled) return;
    const d = ensureDebug();
    d.kernelTop = top;
  }

  public static flushTick(): void {
    const cfg = getCfg();
    if (!cfg.enabled) return;
    const d = ensureDebug();
    const last = typeof d.lastFlush === "number" ? d.lastFlush : -1;
    if (last !== -1 && Game.time - last < cfg.flushInterval) return;
    d.lastFlush = Game.time;
    if (!d.ticks) d.ticks = [];
    const tick: DebugTick = {
      time: Game.time,
      counters: d.counters,
      gauges: d.gauges,
      kernelTop: d.kernelTop,
    };
    d.ticks.push(tick);
    d.counters = {};
    d.gauges = {};
    trim();
  }
}
