import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers: {
          "content-type": "application/json",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(
              new Error(
                `HTTP ${res.statusCode} ${res.statusMessage}: ${text.slice(0, 500)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendJsonl(filePath, obj) {
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, "utf8");
}

function todayStr() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function getApiPrefixes() {
  const envPrefix = process.env.SCREEPS_API_PREFIX;
  if (typeof envPrefix === "string") {
    const p = envPrefix.trim();
    if (p === "" || p === "/") return [""];
    return [p.startsWith("/") ? p : `/${p}`];
  }
  return ["/api", ""];
}

function apiUrl(baseUrl, prefix, path) {
  const b = normalizeBaseUrl(baseUrl);
  const p = prefix === "/" ? "" : prefix;
  const cleanP = p.endsWith("/") ? p.slice(0, -1) : p;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${b}${cleanP}${cleanPath}`;
}

function isVerbose() {
  return process.env.SCREEPS_VERBOSE === "1";
}

function getApiPrefixSingle() {
  const envPrefix = process.env.SCREEPS_API_PREFIX;
  if (typeof envPrefix === "string") {
    const p = envPrefix.trim();
    if (p === "" || p === "/") return "";
    return p.startsWith("/") ? p : `/${p}`;
  }
  return "/api";
}

function getDirectStatsUrl(baseUrl) {
  const explicit = process.env.SCREEPS_STATS_URL;
  if (typeof explicit === "string" && explicit.trim().length > 0)
    return explicit.trim();

  const userId = process.env.USER_ID;
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("Missing USER_ID or SCREEPS_STATS_URL for direct stats");
  }

  const prefix = getApiPrefixSingle();
  const base = normalizeBaseUrl(baseUrl);
  const path = prefix === "" ? "/debug/stats" : `${prefix}/debug/stats`;
  return `${base}${path}?userId=${encodeURIComponent(userId.trim())}`;
}

function getDirectStatsHeaders() {
  const key =
    (typeof process.env.SCREEPS_STATS_KEY === "string" &&
    process.env.SCREEPS_STATS_KEY.trim().length > 0
      ? process.env.SCREEPS_STATS_KEY.trim()
      : null) ||
    (typeof process.env.DEBUG_STATS_KEY === "string" &&
    process.env.DEBUG_STATS_KEY.trim().length > 0
      ? process.env.DEBUG_STATS_KEY.trim()
      : null);

  return key ? { "x-stats-key": key } : {};
}

function getAuthHeaderCandidates(token, tokenTypeHint) {
  const user = process.env.SCREEPS_USER;
  const usernameHeaders = user
    ? [
        { "x-username": user },
        { "X-Username": user },
        { "x-user": user },
        { "X-User": user },
      ]
    : [{}];

  const forcedType = process.env.SCREEPS_TOKEN_TYPE || tokenTypeHint;

  const forced = forcedType
    ? [
        { "x-token": token, "x-token-type": forcedType },
        { "x-token": token, "X-Token-Type": forcedType },
        { "X-Token": token, "x-token-type": forcedType },
        { "X-Token": token, "X-Token-Type": forcedType },
      ]
    : [];

  const tokenHeaders = [
    { "x-token": token, "x-token-type": "user" },
    { "x-token": token, "x-token-type": "auth" },
    { "x-token": token, "x-token-type": "password" },
    { "x-token": token },
    { "X-Token": token },
    { Authorization: `Bearer ${token}` },
    { Cookie: `token=${token}` },
  ];

  const out = [];
  for (const t of [...forced, ...tokenHeaders]) {
    for (const u of usernameHeaders) out.push({ ...t, ...u });
  }
  return out;
}

function getShardCandidates() {
  const shard = process.env.SCREEPS_SHARD;
  if (typeof shard === "string" && shard.trim().length > 0)
    return [shard.trim()];
  return ["shard0", ""];
}

async function getToken(baseUrl) {
  const cookie = process.env.SCREEPS_COOKIE;
  if (typeof cookie === "string" && cookie.trim().length > 0) {
    return { token: "__cookie__", tokenType: "__cookie__" };
  }

  const envToken = process.env.SCREEPS_TOKEN;
  if (envToken)
    return { token: envToken, tokenType: process.env.SCREEPS_TOKEN_TYPE };

  const user = process.env.SCREEPS_USER;
  const pass = process.env.SCREEPS_PASS;
  if (!user || !pass) {
    throw new Error(
      "Need SCREEPS_TOKEN or SCREEPS_USER+SCREEPS_PASS to authenticate",
    );
  }

  const signin = async (body) => {
    try {
      return await requestJson(body.__url, {
        method: "POST",
        body: body.__body,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) return null;
      throw e;
    }
  };

  const candidates = [
    { email: user, password: pass },
    { username: user, password: pass },
  ];

  for (const prefix of getApiPrefixes()) {
    const url = apiUrl(baseUrl, prefix, "/auth/signin");
    for (const body of candidates) {
      const res = await signin({ __url: url, __body: body });
      const token = res?.token;
      if (typeof token === "string" && token.length > 0) {
        const tokenType =
          typeof res?.tokenType === "string" ? res.tokenType : undefined;
        return { token, tokenType };
      }
    }
  }

  throw new Error(
    "Signin failed. Check SCREEPS_USER/SCREEPS_PASS, or set SCREEPS_TOKEN directly.",
  );
}

function getCookieHeader() {
  const cookie = process.env.SCREEPS_COOKIE;
  if (typeof cookie !== "string") return null;
  const c = cookie.trim();
  if (c.length === 0) return null;
  if (c.toLowerCase().startsWith("cookie:")) return c.slice(7).trim();
  return c;
}

async function getStats(baseUrl, tokenInfo) {
  if (process.env.SCREEPS_USE_DIRECT_STATS === "1") {
    const url = getDirectStatsUrl(baseUrl);
    const headers = getDirectStatsHeaders();
    if (isVerbose()) {
      const keys = Object.keys(headers).sort().join(",");
      process.stderr.write(`[collector] DIRECT ${url} headers=${keys}\n`);
    }
    return await requestJson(url, { method: "GET", headers });
  }

  const cookie = getCookieHeader();
  const headersToTry =
    tokenInfo.tokenType === "__cookie__" && cookie
      ? [{ Cookie: cookie }]
      : getAuthHeaderCandidates(tokenInfo.token, tokenInfo.tokenType);

  for (const prefix of getApiPrefixes()) {
    const baseGet = apiUrl(baseUrl, prefix, "/user/memory");
    const urlPost = apiUrl(baseUrl, prefix, "/user/memory");
    for (const headers of headersToTry) {
      for (const shard of getShardCandidates()) {
        const shardQuery = shard ? `&shard=${encodeURIComponent(shard)}` : "";
        const urlGet = `${baseGet}?path=stats${shardQuery}`;
        try {
          if (isVerbose()) {
            const keys = Object.keys(headers)
              .filter((k) => k.toLowerCase() !== "cookie")
              .sort()
              .join(",");
            process.stderr.write(`[collector] GET ${urlGet} headers=${keys}\n`);
          }
          const res = await requestJson(urlGet, { method: "GET", headers });
          const data = res?.data;
          if (typeof data === "string") {
            try {
              return JSON.parse(data);
            } catch {
              return null;
            }
          }
          return data ?? null;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) continue;
          if (msg.includes("HTTP 404")) {
            try {
              if (isVerbose()) {
                const keys = Object.keys(headers)
                  .filter((k) => k.toLowerCase() !== "cookie")
                  .sort()
                  .join(",");
                process.stderr.write(
                  `[collector] POST ${urlPost} headers=${keys} body=path,shard\n`,
                );
              }
              const res = await requestJson(urlPost, {
                method: "POST",
                headers,
                body: shard ? { path: "stats", shard } : { path: "stats" },
              });
              const data = res?.data;
              if (typeof data === "string") {
                try {
                  return JSON.parse(data);
                } catch {
                  return null;
                }
              }
              return data ?? null;
            } catch (e2) {
              const msg2 = e2 instanceof Error ? e2.message : String(e2);
              if (msg2.includes("HTTP 401") || msg2.includes("HTTP 403"))
                continue;
              if (msg2.includes("HTTP 404")) break;
              throw e2;
            }
          }
          throw e;
        }
      }
    }
  }

  throw new Error(
    "Unauthorized or API endpoint not found for /user/memory?path=stats",
  );
}

async function main() {
  const baseUrl = process.env.SCREEPS_URL || "http://127.0.0.1:21025";
  const intervalMs = Number(process.env.INTERVAL_MS || "5000");
  const outDir =
    process.env.OUTPUT_DIR ||
    path.resolve(process.cwd(), "tools/private-stats/out");
  ensureDir(outDir);

  const outFile = path.join(outDir, `${todayStr()}.jsonl`);
  const direct = process.env.SCREEPS_USE_DIRECT_STATS === "1";
  let tokenInfo = direct
    ? { token: "__direct__", tokenType: "__direct__" }
    : await getToken(baseUrl);
  let lastEventTime = 0;

  for (;;) {
    const startedAt = Date.now();
    try {
      const stats = await getStats(baseUrl, tokenInfo);
      if (!stats) throw new Error("No stats returned");

      const time = typeof stats.time === "number" ? stats.time : null;
      appendJsonl(outFile, {
        kind: "stats",
        at: startedAt,
        time,
        cpu: stats.cpu,
        kernelTop: stats.debug?.kernelTop,
      });

      const ticks = Array.isArray(stats.debug?.ticks) ? stats.debug.ticks : [];
      const lastTick = ticks.length > 0 ? ticks[ticks.length - 1] : null;
      if (lastTick && (time == null || lastTick.time === time)) {
        appendJsonl(outFile, { kind: "tick", at: startedAt, ...lastTick });
      }

      const events = Array.isArray(stats.debug?.events)
        ? stats.debug.events
        : [];
      const newEvents = events.filter(
        (e) => typeof e?.time === "number" && e.time > lastEventTime,
      );
      for (const e of newEvents) {
        appendJsonl(outFile, { kind: "event", at: startedAt, ...e });
      }
      if (newEvents.length > 0) {
        lastEventTime = Math.max(
          lastEventTime,
          ...newEvents.map((e) => e.time),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendJsonl(outFile, { kind: "error", at: startedAt, msg });
      if (!direct && (msg.includes("HTTP 401") || msg.includes("HTTP 403"))) {
        tokenInfo = await getToken(baseUrl);
      }
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(50, intervalMs - elapsed);
    await sleep(waitMs);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
