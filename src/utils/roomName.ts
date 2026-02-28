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
