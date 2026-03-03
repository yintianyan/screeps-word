/**
 * 解析房间名
 *
 * 将房间名 (如 "W8N3") 解析为坐标对象 {x, y}。
 * 这里的 x, y 是世界地图上的坐标。
 *
 * @param roomName 房间名
 */
export function parseRoomName(
  roomName: string,
): { x: number; y: number } | null {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
  if (!m) return null;
  const x = Number(m[2]);
  const y = Number(m[4]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * 判断是否为 Source Keeper 房间
 *
 * SK 房间位于房间坐标的 4-6 区间 (中间地带)。
 * 例如 W4N4, W5N5 等。
 *
 * @param roomName 房间名
 */
export function isSourceKeeperRoom(roomName: string): boolean {
  const p = parseRoomName(roomName);
  if (!p) return false;
  const mx = p.x % 10;
  const my = p.y % 10;
  const inSkBand = (v: number) => v >= 4 && v <= 6;
  const isHighway = mx === 0 || my === 0;
  if (isHighway) return false;
  return inSkBand(mx) && inSkBand(my);
}
