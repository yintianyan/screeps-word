export const config = {
  USERNAME: "SongHao",
  CPU: {
    BUCKET_LIMIT: 500,
    CRITICAL_BUCKET: 200,
  },
  LAYOUT: {
    DEFAULT: "stamp" as "stamp" | "bunker",
  },
  BODIES: {
    HARVESTER: {
      1: [WORK, CARRY, MOVE],
      2: [WORK, WORK, CARRY, MOVE],
    },
  },
};
