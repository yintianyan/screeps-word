import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";

function asNumber(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pickTopEntries(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, score]) => ({ key, score }));
}

function parseRoomFromGaugeKey(key) {
  const m = /^room\.([^.]+)\.creeps\.(worker|total)$/.exec(key);
  if (!m) return null;
  return { room: m[1], metric: m[2] };
}

function getDefaultInputPath() {
  const outDir = path.resolve(process.cwd(), "tools/private-stats/out");
  const files = fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".jsonl"))
    .map((d) => path.join(outDir, d.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (files.length === 0) {
    throw new Error(`No jsonl files found in ${outDir}`);
  }
  return files[0];
}

function getArgValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

function getNumberArg(name, fallback) {
  const raw = getArgValue(name, String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function addScore(map, key, delta) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + delta);
}

function buildStallWindows(samples, stalledEvents, emergencyEvents, opts) {
  const windows = [];
  if (samples.length === 0) return windows;
  const sorted = [...samples].sort((a, b) => a.time - b.time);
  let current = null;
  for (const s of sorted) {
    const isNoWorker = s.worker <= 0;
    const isNoCreeps = s.total <= 0;
    const isStall = isNoWorker || isNoCreeps;
    if (!isStall) {
      if (current) {
        current.end = s.time;
        windows.push(current);
        current = null;
      }
      continue;
    }
    if (!current) {
      current = {
        start: s.time,
        end: s.time,
        minWorker: s.worker,
        minTotal: s.total,
        samples: 1,
      };
      continue;
    }
    if (s.time - current.end > opts.maxGapTicks) {
      windows.push(current);
      current = {
        start: s.time,
        end: s.time,
        minWorker: s.worker,
        minTotal: s.total,
        samples: 1,
      };
      continue;
    }
    current.end = s.time;
    current.minWorker = Math.min(current.minWorker, s.worker);
    current.minTotal = Math.min(current.minTotal, s.total);
    current.samples += 1;
  }
  if (current) windows.push(current);
  const normalized = [];
  for (const w of windows) {
    const duration = w.end - w.start;
    if (duration < opts.minStallTicks) continue;
    const stalledNoEnergyCount = stalledEvents.filter(
      (t) => t >= w.start && t <= w.end,
    ).length;
    const emergencyWorkerCount = emergencyEvents.filter(
      (t) => t >= w.start && t <= w.end,
    ).length;
    normalized.push({
      ...w,
      duration,
      stalledNoEnergyCount,
      emergencyWorkerCount,
    });
  }
  return normalized.sort((a, b) => b.duration - a.duration);
}

function formatTop(title, entries, formatter = (e) => `${e.key} => ${e.score}`) {
  if (entries.length === 0) return `${title}\n  (无数据)`;
  const lines = entries.map((e, i) => `  ${i + 1}. ${formatter(e)}`);
  return `${title}\n${lines.join("\n")}`;
}

async function main() {
  const inputPath =
    process.argv[2] && !process.argv[2].startsWith("--")
      ? path.resolve(process.cwd(), process.argv[2])
      : getDefaultInputPath();
  const minStallTicks = getNumberArg("--min-stall", 80);
  const maxGapTicks = getNumberArg("--max-gap", 120);
  const topN = getNumberArg("--top", 10);
  const outputJson = getArgValue("--json", "");

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const roomScore = new Map();
  const creepScore = new Map();
  const coordScore = new Map();
  const roomSamples = new Map();
  const roomStalledEvents = new Map();
  const roomEmergencyEvents = new Map();
  let lineCount = 0;
  let parsedCount = 0;
  let trafficRecords = 0;
  let stuckDiagRecords = 0;
  let moveStuckEvents = 0;

  const stream = fs.createReadStream(inputPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineCount += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    parsedCount += 1;
    if (obj.kind === "traffic") {
      trafficRecords += 1;
      const topRooms = Array.isArray(obj.topRooms) ? obj.topRooms : [];
      for (const room of topRooms) {
        const roomName = typeof room.roomName === "string" ? room.roomName : "";
        const score =
          asNumber(room.severeStuckSamples) * 10 +
          asNumber(room.noPathCount) * 5 +
          asNumber(room.maxStuck);
        addScore(roomScore, roomName, score);
        addScore(creepScore, room.lastStuckCreep, asNumber(room.maxStuck));
        if (typeof room.lastStuckPos === "string" && roomName) {
          addScore(coordScore, `${roomName}:${room.lastStuckPos}`, score || 1);
        }
      }
      continue;
    }
    if (obj.kind === "stuck_diag") {
      stuckDiagRecords += 1;
      const hotspots = Array.isArray(obj.hotspots) ? obj.hotspots : [];
      for (const h of hotspots) {
        const roomName = typeof h.roomName === "string" ? h.roomName : "";
        const score =
          asNumber(h.severeStuckSamples) * 10 +
          asNumber(h.noPathCount) * 5 +
          asNumber(h.maxStuck);
        addScore(roomScore, roomName, score);
        addScore(creepScore, h.lastStuckCreep, asNumber(h.maxStuck));
        if (typeof h.lastStuckPos === "string" && roomName) {
          addScore(coordScore, `${roomName}:${h.lastStuckPos}`, score || 1);
        }
      }
      continue;
    }
    if (obj.kind === "event") {
      const tag = typeof obj.tag === "string" ? obj.tag : "";
      const room = typeof obj.room === "string" ? obj.room : "";
      if (tag === "move_stuck") {
        moveStuckEvents += 1;
        const stuck = asNumber(obj?.data?.stuck, 1);
        addScore(roomScore, room, stuck);
        if (typeof obj.creep === "string") addScore(creepScore, obj.creep, stuck);
        const to = obj?.data?.to;
        if (
          to &&
          typeof to === "object" &&
          typeof to.room === "string" &&
          typeof to.x === "number" &&
          typeof to.y === "number"
        ) {
          addScore(coordScore, `${to.room}:${to.x}:${to.y}`, stuck);
        }
      } else if (tag === "spawner_stalled_no_energy") {
        if (!roomStalledEvents.has(room)) roomStalledEvents.set(room, []);
        roomStalledEvents.get(room).push(asNumber(obj.time));
      } else if (tag === "spawner_emergency_worker") {
        if (!roomEmergencyEvents.has(room)) roomEmergencyEvents.set(room, []);
        roomEmergencyEvents.get(room).push(asNumber(obj.time));
      }
      continue;
    }
    if (obj.kind === "tick") {
      const time = asNumber(obj.time, -1);
      if (time < 0) continue;
      const gauges = obj.gauges && typeof obj.gauges === "object" ? obj.gauges : {};
      for (const key of Object.keys(gauges)) {
        const parsed = parseRoomFromGaugeKey(key);
        if (!parsed) continue;
        if (!roomSamples.has(parsed.room)) roomSamples.set(parsed.room, new Map());
        const byTime = roomSamples.get(parsed.room);
        const existing = byTime.get(time) ?? { time, worker: 0, total: 0 };
        const value = asNumber(gauges[key]);
        if (parsed.metric === "worker") existing.worker = value;
        if (parsed.metric === "total") existing.total = value;
        byTime.set(time, existing);
      }
      continue;
    }
  }

  const stallWindows = [];
  for (const [room, byTime] of roomSamples.entries()) {
    const samples = [...byTime.values()];
    const windows = buildStallWindows(
      samples,
      roomStalledEvents.get(room) ?? [],
      roomEmergencyEvents.get(room) ?? [],
      { minStallTicks, maxGapTicks },
    );
    for (const w of windows) {
      stallWindows.push({
        room,
        ...w,
      });
    }
  }
  stallWindows.sort((a, b) => b.duration - a.duration);

  const topRooms = pickTopEntries(roomScore, topN);
  const topCreeps = pickTopEntries(creepScore, topN);
  const topCoords = pickTopEntries(coordScore, topN);
  const topWindows = stallWindows.slice(0, topN).map((w) => ({
    room: w.room,
    start: w.start,
    end: w.end,
    duration: w.duration,
    minWorker: w.minWorker,
    minTotal: w.minTotal,
    samples: w.samples,
    stalledNoEnergyCount: w.stalledNoEnergyCount,
    emergencyWorkerCount: w.emergencyWorkerCount,
  }));

  const summary = {
    inputPath,
    lineCount,
    parsedCount,
    minStallTicks,
    maxGapTicks,
    signal: {
      trafficRecords,
      stuckDiagRecords,
      moveStuckEvents,
      roomsWithTickSamples: roomSamples.size,
      stallWindowCount: stallWindows.length,
    },
    top: {
      rooms: topRooms,
      creeps: topCreeps,
      coords: topCoords,
      spawnStallWindows: topWindows,
    },
  };

  const output = [
    `输入文件: ${inputPath}`,
    `记录: total=${lineCount} parsed=${parsedCount} traffic=${trafficRecords} stuck_diag=${stuckDiagRecords} move_stuck_event=${moveStuckEvents}`,
    formatTop("最常卡住房间", topRooms, (e) => `${e.key} | score=${e.score}`),
    formatTop("最常卡住坐标", topCoords, (e) => `${e.key} | score=${e.score}`),
    formatTop("最常卡住 creep", topCreeps, (e) => `${e.key} | score=${e.score}`),
    formatTop(
      "孵化卡死窗口",
      topWindows.map((w, i) => ({ key: String(i + 1), score: w.duration, data: w })),
      (e) =>
        `${e.data.room} | ${e.data.start}-${e.data.end} | duration=${e.data.duration} | minWorker=${e.data.minWorker} | minTotal=${e.data.minTotal} | stalledNoEnergy=${e.data.stalledNoEnergyCount} | emergencyWorker=${e.data.emergencyWorkerCount}`,
    ),
  ].join("\n");
  process.stdout.write(`${output}\n`);

  if (outputJson) {
    const outPath = path.resolve(process.cwd(), outputJson);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    process.stdout.write(`JSON报告: ${outPath}\n`);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.stack ?? e.message : String(e);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
