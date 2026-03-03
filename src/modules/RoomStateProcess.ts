import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import StructureCache from "../utils/structureCache";
import { config } from "../config";
import { Debug } from "../core/Debug";

type RoomMode = "recover" | "economy" | "build" | "upgrade" | "defense";

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

function calcMode(
  room: Room,
  minerCoverage: number,
  hasSites: boolean,
): RoomMode {
  const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
  if (hostiles > 0) return "defense";

  const ticksToDowngrade = room.controller?.ticksToDowngrade ?? 100000;
  if (ticksToDowngrade < config.CONTROLLER.DOWNGRADE_CRITICAL) return "recover";

  if (minerCoverage < 1) return "recover";

  if (room.energyAvailable < config.POPULATION.ENERGY_BUDGET.CRITICAL_MIN)
    return "recover";

  const storageEnergy =
    room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;

  if (hasSites) return "build";
  if (storageEnergy > config.POPULATION.UPGRADER.STORAGE_MEDIUM)
    return "upgrade";
  return "economy";
}

/**
 * 房间状态管理进程
 *
 * 负责监控房间的经济和防御状态，并决定当前的运营模式 (Mode)。
 * 运营模式会影响 SpawnerProcess 的人口策略和 RoomLogisticsProcess 的任务分配。
 *
 * 模式定义：
 * - recover: 恢复模式。RCL 极低、能量极低或 Miner 不足时触发。优先生产 Miner 和 Worker。
 * - defense: 防御模式。检测到敌对 Creep 时触发。优先生产 Defender 和维修 Rampart。
 * - build: 建造模式。有工地时触发。Worker 侧重建造。
 * - upgrade: 升级模式。能量富裕且无工地时触发。Worker 侧重升级 Controller。
 * - economy: 经济模式。默认状态。平衡发展。
 */
export class RoomStateProcess extends Process {
  public run(): void {
    for (const room of getMyRooms()) {
      const sources = StructureCache.getSources(room);
      const sourceCount = sources.length;

      const creeps = room.find(FIND_MY_CREEPS);
      const miners = creeps.filter((c) => c.memory.role === "miner");
      const minerAssigned = new Set<string>();
      for (const m of miners) {
        const sid = m.memory.sourceId;
        if (sid) minerAssigned.add(sid);
      }

      const minerCoverage =
        sourceCount > 0 ? minerAssigned.size / sourceCount : 0;

      let idleSourceCount = 0;
      for (const s of sources) {
        const active =
          minerAssigned.has(s.id) ||
          creeps.some((c) => c.memory.targetId === s.id);
        if (!active) idleSourceCount++;
      }

      const hasSites = StructureCache.getConstructionSites(room).some(
        (s) => s.my,
      );
      const mySites = room.find(FIND_MY_CONSTRUCTION_SITES);
      const myRoadSites = mySites.filter(
        (s) => s.structureType === STRUCTURE_ROAD,
      ).length;
      Debug.gauge(`room.${room.name}.sites.total`, mySites.length);
      Debug.gauge(`room.${room.name}.sites.road`, myRoadSites);
      Debug.gauge(
        `room.${room.name}.sites.nonRoad`,
        mySites.length - myRoadSites,
      );
      const desiredMode = calcMode(room, minerCoverage, hasSites);

      const mem = room.memory as RoomMemory & {
        strategy?: {
          mode: RoomMode;
          lastEval: number;
          lastSwitch: number;
          minerCoverage: number;
          idleSourceCount: number;
        };
      };

      const prev = mem.strategy;
      const now = Game.time;
      const stableTicks = config.STRATEGY.MODE_SWITCH_MIN_TICKS;
      const canSwitch =
        !prev ||
        prev.mode === desiredMode ||
        now - prev.lastSwitch >= stableTicks;

      const nextMode = canSwitch ? desiredMode : prev.mode;

      mem.strategy = {
        mode: nextMode,
        lastEval: now,
        lastSwitch: !prev || prev.mode !== nextMode ? now : prev.lastSwitch,
        minerCoverage,
        idleSourceCount,
      };

      const energyRatio =
        room.energyCapacityAvailable > 0
          ? room.energyAvailable / room.energyCapacityAvailable
          : 0;
      if (energyRatio < 0.15) room.memory.energyLevel = "CRITICAL";
      else if (energyRatio < 0.4) room.memory.energyLevel = "LOW";
      else if (energyRatio < 0.8) room.memory.energyLevel = "MEDIUM";
      else room.memory.energyLevel = "HIGH";
    }
  }
}

processRegistry.register(RoomStateProcess, "RoomStateProcess");
