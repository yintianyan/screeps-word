
export interface ProfilerData {
  map: { [key: string]: { time: number; calls: number; max: number } };
  enabled: boolean;
}

declare global {
  interface Memory {
    profiler: ProfilerData;
  }
}

export class Profiler {
  private static _instance: Profiler;
  private _data: { [key: string]: { time: number; calls: number; max: number } } = {};
  private _enabled = false;
  private _depth = 0;

  private constructor() {
    if (typeof Memory !== "undefined" && Memory.profiler) {
      this._enabled = Memory.profiler.enabled || false;
    }
  }

  public static getInstance(): Profiler {
    if (!Profiler._instance) {
      Profiler._instance = new Profiler();
    }
    return Profiler._instance;
  }

  public enable() {
    this._enabled = true;
    if (typeof Memory !== "undefined") {
        Memory.profiler = { map: {}, enabled: true };
    }
  }

  public disable() {
    this._enabled = false;
    if (typeof Memory !== "undefined") {
        Memory.profiler = { map: {}, enabled: false };
    }
  }

  public isEnabled(): boolean {
    return this._enabled;
  }

  public wrap<T extends (...args: any[]) => any>(fn: T, name: string): T {
    if (!this._enabled) return fn;

    return ((...args: any[]) => {
      const start = Game.cpu.getUsed();
      this._depth++;
      const result = fn.apply(this, args);
      this._depth--;
      const end = Game.cpu.getUsed();
      this.record(name, end - start);
      return result;
    }) as T;
  }

  public record(key: string, time: number) {
    if (!this._enabled) return;
    if (!this._data[key]) {
      this._data[key] = { time: 0, calls: 0, max: 0 };
    }
    this._data[key].time += time;
    this._data[key].calls++;
    if (time > this._data[key].max) {
      this._data[key].max = time;
    }
  }

  public toString(): string {
    let output = "Profiler Report:\n";
    const sorted = Object.keys(this._data).sort(
      (a, b) => this._data[b].time - this._data[a].time
    );

    output += "| Name | Total Time | Calls | Avg Time | Max Time |\n";
    output += "| --- | --- | --- | --- | --- |\n";
    
    for (const key of sorted) {
      const data = this._data[key];
      const avg = data.time / data.calls;
      output += `| ${key} | ${data.time.toFixed(3)} | ${data.calls} | ${avg.toFixed(3)} | ${data.max.toFixed(3)} |\n`;
    }
    return output;
  }

  public reset() {
    this._data = {};
  }
}

export const profiler = Profiler.getInstance();

export function Profile(name?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const key = name || `${target.constructor.name}.${propertyKey}`;
    
    descriptor.value = function (...args: any[]) {
      if (!profiler.isEnabled()) {
        return originalMethod.apply(this, args);
      }
      const start = Game.cpu.getUsed();
      const result = originalMethod.apply(this, args);
      const end = Game.cpu.getUsed();
      profiler.record(key, end - start);
      return result;
    };
    return descriptor;
  };
}
