import { Cache } from "./Cache";
import { isSourceKeeperRoom, parseRoomName } from "../utils/roomName";

export type RoutePlannerOptions = {
  avoidSK?: boolean;
  preferHighway?: boolean;
  avoidRooms?: string[];
  ttl?: number;
};

function isHighwayRoom(roomName: string): boolean {
  const p = parseRoomName(roomName);
  if (!p) return false;
  return p.x % 10 === 0 || p.y % 10 === 0;
}

function buildKey(
  fromRoom: string,
  toRoom: string,
  opts: RoutePlannerOptions,
): string {
  const a = opts.avoidSK ? 1 : 0;
  const h = opts.preferHighway ? 1 : 0;
  const avoid = Array.isArray(opts.avoidRooms) ? opts.avoidRooms.join(",") : "";
  return `route:${fromRoom}:${toRoom}:a${a}:h${h}:x${avoid}`;
}

/**
 * 获取房间路由
 *
 * 计算从 fromRoom 到 toRoom 的房间路径。
 * 支持：
 * 1. 避开 Source Keeper 房间 (可选)。
 * 2. 优先走 Highway 房间 (可选)。
 * 3. 避开指定的房间列表。
 * 4. 结果缓存 (Heap Cache)。
 *
 * @param fromRoom 起点房间名
 * @param toRoom 终点房间名
 * @param opts 路由选项
 */
export function getRouteRooms(
  fromRoom: string,
  toRoom: string,
  opts: RoutePlannerOptions = {},
): string[] {
  if (fromRoom === toRoom) return [fromRoom];
  const ttl = typeof opts.ttl === "number" ? opts.ttl : 200;
  const key = buildKey(fromRoom, toRoom, opts);

  return Cache.getHeap(key, ttl, () => {
    const avoid = new Set(
      Array.isArray(opts.avoidRooms) ? opts.avoidRooms : [],
    );
    const avoidSK = !!opts.avoidSK;
    const preferHighway = !!opts.preferHighway;

    const route = Game.map.findRoute(fromRoom, toRoom, {
      routeCallback: (roomName: string): number | false => {
        if (roomName === toRoom) return 1;
        if (avoid.has(roomName)) return false;
        if (avoidSK && isSourceKeeperRoom(roomName)) return false;
        if (preferHighway) return isHighwayRoom(roomName) ? 1 : 2;
        return 1;
      },
    });

    if (route === ERR_NO_PATH) return [];
    return [fromRoom, ...route.map((r) => r.room)];
  });
}
