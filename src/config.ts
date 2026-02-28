export const config = {
  USERNAME: "SongHao",
  CPU: {
    BUCKET_LIMIT: 500,
    CRITICAL_BUCKET: 200,
  },
  CONTROLLER: {
    DOWNGRADE_CRITICAL: 5000,
    DOWNGRADE_LOW: 10000,
  },
  REMOTE_MINING: {
    SK_MIN_RCL: 7,
    SK_MIN_STORAGE_ENERGY: 50000,
    KEEPER_SQUAD: {
      KILLERS: 1,
      HEALERS: 1,
    },
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
