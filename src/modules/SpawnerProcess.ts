import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { config } from "../config";
import { isSourceKeeperRoom } from "../utils/roomName";
import StructureCache from "../utils/structureCache";
import { Cache } from "../core/Cache";
import { Debug } from "../core/Debug";
import { SpawnJob } from "./SpawnJob";

function bodyCost(body: BodyPartConstant[]): number {
  let cost = 0;
  for (const part of body) cost += BODYPART_COST[part];
  return cost;
}

function buildCarryMoveBody(
  energyCapacity: number,
  maxParts = 20,
): BodyPartConstant[] {
  const unit: BodyPartConstant[] = [CARRY, MOVE];
  const unitCost = bodyCost(unit);
  const body: BodyPartConstant[] = [];
  while (
    body.length + unit.length <= maxParts &&
    bodyCost(body) + unitCost <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [CARRY, MOVE];
}

/**
 * 构建 Worker 身体部件
 *
 * 策略：
 * 1. 基础单元: [WORK, CARRY, MOVE] (成本 200)。
 * 2. 尽可能多地添加基础单元，直到达到 maxParts (15) 或能量上限。
 * 3. 至少返回一个基础单元。
 */
function buildWorkerBody(energyCapacity: number): BodyPartConstant[] {
  const unit: BodyPartConstant[] = [WORK, CARRY, MOVE];
  const unitCost = bodyCost(unit);
  const maxParts = 15;

  const body: BodyPartConstant[] = [];
  while (
    body.length + unit.length <= maxParts &&
    bodyCost(body) + unitCost <= energyCapacity
  ) {
    body.push(...unit);
  }

  return body.length > 0 ? body : [WORK, CARRY, MOVE];
}

function buildMinerBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [MOVE, CARRY];
  while (
    body.filter((p) => p === WORK).length < 5 &&
    bodyCost(body) + BODYPART_COST[WORK] <= energyCapacity &&
    body.length + 1 <= 12
  ) {
    body.unshift(WORK);
  }
  if (body.filter((p) => p === WORK).length === 0) {
    const fallback: BodyPartConstant[] = [WORK, CARRY, MOVE];
    if (bodyCost(fallback) <= energyCapacity) return fallback;
  }
  if (bodyCost(body) <= energyCapacity) return body;
  const fallback: BodyPartConstant[] = [WORK, CARRY, MOVE];
  if (bodyCost(fallback) <= energyCapacity) return fallback;
  return [WORK, CARRY, MOVE];
}

function buildRemoteHarvesterBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [CARRY, MOVE, MOVE];
  while (
    body.filter((p) => p === WORK).length < 5 &&
    bodyCost(body) + 100 <= energyCapacity
  ) {
    body.unshift(WORK);
  }
  if (body.filter((p) => p === WORK).length === 0) {
    const fallback: BodyPartConstant[] = [WORK, CARRY, MOVE];
    if (bodyCost(fallback) <= energyCapacity) return fallback;
  }
  if (
    body.filter((p) => p === WORK).length >= 5 &&
    bodyCost(body) <= energyCapacity
  )
    return body;

  const fallback: BodyPartConstant[] = [WORK, WORK, WORK, CARRY, MOVE, MOVE];
  if (bodyCost(fallback) <= energyCapacity) return fallback;
  return [WORK, CARRY, MOVE];
}

function buildReserverBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [CLAIM, MOVE];
  while (
    body.length + 2 <= 8 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [CLAIM, MOVE];
}

function buildDefenderBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [MOVE, ATTACK];
  while (
    body.length + 2 <= 12 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [MOVE, ATTACK];
}

function buildKeeperKillerBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [MOVE, RANGED_ATTACK];
  while (
    body.length + unit.length <= 20 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  if (
    bodyCost(body) + BODYPART_COST[HEAL] <= energyCapacity &&
    body.length + 1 <= 20
  ) {
    body.push(HEAL);
  }
  return body.length > 0 ? body : [MOVE, RANGED_ATTACK];
}

function buildKeeperHealerBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  const unit: BodyPartConstant[] = [MOVE, HEAL];
  while (
    body.length + unit.length <= 12 &&
    bodyCost(body) + bodyCost(unit) <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [MOVE, HEAL];
}

function buildUpgraderBody(energyCapacity: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [WORK, CARRY, MOVE];
  const unit: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE];
  const unitCost = bodyCost(unit);
  const maxParts = 24;

  while (
    body.length + unit.length <= maxParts &&
    bodyCost(body) + unitCost <= energyCapacity
  ) {
    body.push(...unit);
  }
  return body.length > 0 ? body : [WORK, CARRY, MOVE];
}

/**
 * 计算期望的 Worker 数量
 *
 * 动态调整逻辑：
 * 1. 基础数量：根据 RCL 设定不同的基准值 (config.POPULATION.WORKER.RCL_TARGETS)。
 * 2. 工地加成：如果有工地，增加 1 个；如果工地很多且 RCL >= 4，再增加 1 个。
 * 3. 高级物流减免 (RCL >= 5)：
 *    - 如果有 2+ Links，减少 worker (因为不需要搬运了)。
 *    - 如果有 Distributor，减少 worker (因为不需要填补 spawn 了)。
 * 4. Storage 储量调整：
 *    - 储量低 -> 增加 worker (加速采集)。
 *    - 储量高 (RCL >= 5) -> 减少 worker (避免爆仓，节省 CPU)。
 * 5. 性能指标调整 (Metrics)：
 *    - 闲置率高 -> 减少 worker。
 *    - 闲置率低且工地多 -> 增加 worker。
 */
function desiredWorkerCount(room: Room): number {
  const rcl = room.controller?.level ?? 0;
  const base =
    config.POPULATION.WORKER.RCL_TARGETS[
      Math.min(
        Math.max(0, rcl),
        config.POPULATION.WORKER.RCL_TARGETS.length - 1,
      )
    ] ?? config.POPULATION.WORKER.MIN;
  let target = base;

  const sites = StructureCache.getConstructionSites(room).filter(
    (s) => s.my,
  ).length;
  if (sites > 0) target += 1;
  if (sites > 5 && rcl >= 4) target += 1;

  if (rcl >= 5) {
    const links = (
      StructureCache.getMyStructures(room, STRUCTURE_LINK) as StructureLink[]
    ).length;
    const distributor = StructureCache.getCreeps(room, "distributor").length;
    if (links >= 2) target += config.POPULATION.WORKER.LINK_REDUCE;
    if (distributor > 0) target += config.POPULATION.WORKER.DISTRIBUTOR_REDUCE;
  }

  const storageEnergy =
    room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  if (room.storage) {
    if (storageEnergy < config.POPULATION.WORKER.STORAGE_LOW)
      target += config.POPULATION.WORKER.STORAGE_BOOST;
    if (rcl >= 5 && storageEnergy > config.POPULATION.WORKER.STORAGE_HIGH)
      target += config.POPULATION.WORKER.STORAGE_REDUCE;
  }

  if (room.memory.metrics) {
    const { idleRate } = room.memory.metrics;
    if (idleRate > config.POPULATION.WORKER.IDLE_HIGH) {
      target = Math.max(
        config.POPULATION.WORKER.MIN,
        target + config.POPULATION.WORKER.DELTA_IDLE,
      );
    } else if (
      idleRate < config.POPULATION.WORKER.IDLE_LOW &&
      sites >= config.POPULATION.WORKER.BUSY_SITES_MIN
    ) {
      target += config.POPULATION.WORKER.DELTA_BUSY;
    }
  }

  return Math.max(config.POPULATION.WORKER.MIN, target);
}

function shouldSpawnDefender(room: Room): boolean {
  const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
  const mem = room.memory as RoomMemory & { defenseLastHostile?: number };
  const recent =
    mem.defenseLastHostile != null &&
    Game.time - mem.defenseLastHostile <
      config.POPULATION.DEFENSE.RECENT_HOSTILE_TICKS;
  return hostiles > 0 || recent;
}

function hasKeeperHostile(room: Room): boolean {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  return hostiles.some((c) => c.owner?.username === "Source Keeper");
}

function canFightKeeperInRoom(room: Room): boolean {
  const towers = StructureCache.getMyStructures(
    room,
    STRUCTURE_TOWER,
  ) as StructureTower[];
  if (towers.length === 0) return false;
  const towerEnergy = towers.reduce(
    (sum, t) => sum + t.store.getUsedCapacity(RESOURCE_ENERGY),
    0,
  );
  return towerEnergy >= 500;
}

function isOffenseBlocked(room: Room, defenders: number): boolean {
  const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
  if (hostiles === 0) return false;
  const towers = StructureCache.getMyStructures(
    room,
    STRUCTURE_TOWER,
  ) as StructureTower[];
  if (towers.length > 0) return false;
  return defenders === 0;
}

function getRemoteTargets(room: Room): string[] {
  return room.memory.remotes ?? [];
}

function canRunSkRemote(home: Room): boolean {
  const rcl = home.controller?.level ?? 0;
  if (rcl < config.REMOTE_MINING.SK_MIN_RCL) return false;
  const energy = home.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  if (energy < config.REMOTE_MINING.SK_MIN_STORAGE_ENERGY) return false;
  return true;
}

function getStringProp(value: unknown, prop: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = (value as Record<string, unknown>)[prop];
  return typeof v === "string" ? v : undefined;
}

interface ActiveJob {
  pid: string;
  role: string;
  room: string;
  targetRoom?: string;
  createdAt?: number;
  bodyCost?: number;
}

function getSpawnEnergyBudget(room: Room, isCritical: boolean): number {
  const capacity = room.energyCapacityAvailable;
  const available = room.energyAvailable;

  if (isCritical) {
    return Math.max(config.POPULATION.ENERGY_BUDGET.CRITICAL_MIN, available);
  }

  if (available < capacity * config.POPULATION.ENERGY_BUDGET.LOW_RATIO) {
    return Math.max(
      available,
      capacity * config.POPULATION.ENERGY_BUDGET.MID_RATIO,
    );
  }

  return capacity;
}

/**
 * 孵化进程
 *
 * 负责管理所有房间的 Creep 孵化。
 *
 * 主要职责：
 * 1. 检查每个房间的 Creep 存活情况 (Worker, Upgrader, Hauler, Distributor, Miner 等)。
 * 2. 计算需要补充的 Creep 数量和身体部件。
 * 3. 生成 SpawnJob 并提交给 Kernel。
 * 4. 处理特殊角色的孵化 (Defender, RemoteMining 等)。
 */
export class SpawnerProcess extends Process {
  public run(): void {
    const children = this.kernel.getChildren(this.pid);
    const activeJobs: ActiveJob[] = children.map((pid) => {
      const mem = this.kernel.getProcessMemory(pid);
      const bodyParts = Array.isArray(mem.body)
        ? (mem.body.filter((part): part is BodyPartConstant =>
            typeof part === "string" &&
            Object.prototype.hasOwnProperty.call(BODYPART_COST, part),
          ) as BodyPartConstant[])
        : [];
      const createdAt = typeof mem.createdAt === "number" ? mem.createdAt : undefined;
      return {
        pid,
        role: mem.role as string,
        room: mem.roomName as string,
        targetRoom: getStringProp(mem.memory as unknown, "targetRoom"),
        createdAt,
        bodyCost: bodyParts.length > 0 ? bodyCost(bodyParts) : undefined,
      };
    });

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller?.my) continue;

      const creeps = StructureCache.getCreeps(room);
      const pendingJobFreshWindow = Math.max(
        20,
        Math.floor(config.SPAWN.JOB_TIMEOUT / 3),
      );
      const roomJobs = activeJobs.filter((j) => j.room === roomName);
      const validJob = (job: ActiveJob): boolean => {
        const fresh =
          typeof job.createdAt !== "number" ||
          Game.time - job.createdAt <= pendingJobFreshWindow;
        if (!fresh) return false;
        if (
          typeof job.bodyCost === "number" &&
          job.bodyCost > room.energyCapacityAvailable
        ) {
          return false;
        }
        return true;
      };
      const queuedRoleCount = (role: string): number => {
        return roomJobs.filter((j) => j.role === role && validJob(j)).length;
      };

      const count = (role: string) => {
        return (
          creeps.filter((c) => c.memory.role === role).length +
          queuedRoleCount(role)
        );
      };

      const getDyingCount = (role: string, bodyPartsCount: number) => {
        const spawnTime = bodyPartsCount * 3;
        const buffer = config.SPAWN.REPLACE_BUFFER;
        return creeps.filter(
          (c) =>
            c.memory.role === role &&
            (c.ticksToLive ?? 1500) < spawnTime + buffer,
        ).length;
      };

      const workerCount = count("worker");
      const minerCount = count("miner");
      const haulerCount = count("hauler");
      const actualWorkerCount = creeps.filter(
        (c) => c.memory.role === "worker",
      ).length;
      const actualMinerCount = creeps.filter(
        (c) => c.memory.role === "miner",
      ).length;
      const lowBucket =
        Game.cpu.bucket < config.POPULATION.CPU_BUCKET_STOP_NON_CRITICAL;
      const mode = room.memory.strategy?.mode;
      const rcl = room.controller.level;

      const extBuilt = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION,
      }).length;
      const extDesired = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;
      const towerBuilt = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER,
      }).length;
      const towerDesired = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] ?? 0;

      Debug.gauge(`room.${room.name}.creeps.total`, creeps.length);
      Debug.gauge(`room.${room.name}.creeps.worker`, actualWorkerCount);
      Debug.gauge(`room.${room.name}.creeps.miner`, actualMinerCount);
      Debug.gauge(`room.${room.name}.struct.extension`, extBuilt);
      Debug.gauge(`room.${room.name}.struct.extensionDesired`, extDesired);
      Debug.gauge(`room.${room.name}.struct.tower`, towerBuilt);
      Debug.gauge(`room.${room.name}.struct.towerDesired`, towerDesired);

      if (creeps.length < 2 && actualWorkerCount === 0) {
        const minBody = [WORK, CARRY, MOVE];
        const minCost = bodyCost(minBody);

        if (room.energyAvailable >= minCost) {
          console.log(
            `[Spawner] EMERGENCY: Requesting recovery worker for ${room.name}`,
          );
          Debug.event(
            "spawner_emergency_worker",
            {
              energyAvailable: room.energyAvailable,
              energyCapacity: room.energyCapacityAvailable,
              minCost,
            },
            { room: room.name, pid: this.pid },
          );
          this.requestSpawn(room.name, "worker", minBody, 100, {
            room: room.name,
            working: false,
          });
          continue;
        } else if (Game.time % 50 === 0) {
          // In recovery mode, we might need to recycle existing creeps if we are stuck?
          // Or just wait.
          Debug.event(
            "spawner_stalled_no_energy",
            { energyAvailable: room.energyAvailable, minCost },
            { room: room.name, pid: this.pid },
          );
        }
      }

      // 修复：在 recover 模式下，如果已有足够 worker，允许孵化 miner
      // 这里的关键是：如果 worker 足够了，但 miner 还没出来，我们需要确保有足够的能量孵化 miner
      // Miner 需要较多能量 (5 WORK = 500 + 50 + 50 = 600+)
      // 如果当前能量不足以孵化完整 Miner，是否应该降级？
      // buildMinerBody 已经有降级逻辑。

      if (
        mode === "recover" &&
        rcl >= 3 &&
        workerCount >= config.POPULATION.WORKER.MIN
      ) {
        const sources = StructureCache.getSources(room);
        if (sources.length > 0) {
          const budget = getSpawnEnergyBudget(room, true);
          const body = buildMinerBody(budget);

          const minerBodySize = body.length;
          const dyingMiners = getDyingCount("miner", minerBodySize);
          const minerJobs = roomJobs.filter((j) => j.role === "miner").length;
          const replaceLead =
            body.length * 3 + Math.min(config.SPAWN.REPLACE_BUFFER, 15);

          if (actualMinerCount - dyingMiners < sources.length) {
            if (roomJobs.length > 0) {
              for (const j of roomJobs) {
                if (j.role === "miner" || j.role === "defender") continue;
                if (j.role === "worker" && actualWorkerCount === 0) continue;
                this.kernel.killProcess(j.pid);
              }
            }

            if (minerJobs === 0) {
              const isAssigned = (sourceId: string) => {
                const hasCreep = creeps.some((c) => {
                  if (
                    c.memory.role !== "miner" ||
                    c.memory.sourceId !== sourceId
                  )
                    return false;
                  if ((c.ticksToLive ?? 1500) < replaceLead) return false;
                  return true;
                });
                if (hasCreep) return true;

                const jobs = activeJobs.filter(
                  (j) => j.role === "miner" && j.room === roomName,
                );
                for (const j of jobs) {
                  const m = this.kernel.getProcessMemory(j.pid);
                  if (
                    getStringProp(m.memory as unknown, "sourceId") === sourceId
                  )
                    return true;
                }
                return false;
              };

              const unassignedSource = sources.find((s) => !isAssigned(s.id));
              if (unassignedSource) {
                this.requestSpawn(room.name, "miner", body, 105, {
                  role: "miner",
                  room: room.name,
                  working: false,
                  homeRoom: room.name,
                  sourceId: unassignedSource.id,
                });
                continue; // Added continue here to ensure we stop processing other roles if we decided to spawn a miner
              }
            }
          }
        }
      }

      if (rcl >= 3 && workerCount >= config.POPULATION.WORKER.MIN) {
        const sources = StructureCache.getSources(room);
        const planned = room.memory.mining ?? {};
        const plannedSources = sources.filter(
          (s) => planned[s.id]?.containerPos != null,
        );

        const minerTarget = sources.length;
        const minerBodySize = buildMinerBody(
          room.energyCapacityAvailable,
        ).length;
        const dyingMiners = getDyingCount("miner", minerBodySize);

        if (actualMinerCount - dyingMiners < minerTarget) {
          const minerJobs = roomJobs.filter((j) => j.role === "miner").length;
          if (roomJobs.length > 0) {
            for (const j of roomJobs) {
              if (j.role === "miner" || j.role === "defender") continue;
              if (j.role === "worker" && actualWorkerCount === 0) continue;
              this.kernel.killProcess(j.pid);
            }
          }

          if (minerJobs === 0) {
            const body = buildMinerBody(getSpawnEnergyBudget(room, true));
            const replaceLead =
              body.length * 3 + Math.min(config.SPAWN.REPLACE_BUFFER, 15);
            const isAssigned = (sourceId: string) => {
              const hasCreep = creeps.some((c) => {
                if (c.memory.role !== "miner" || c.memory.sourceId !== sourceId)
                  return false;
                if ((c.ticksToLive ?? 1500) < replaceLead) return false;
                return true;
              });
              if (hasCreep) return true;

              const jobs = activeJobs.filter(
                (j) => j.role === "miner" && j.room === roomName,
              );
              for (const j of jobs) {
                const m = this.kernel.getProcessMemory(j.pid);
                if (getStringProp(m.memory as unknown, "sourceId") === sourceId)
                  return true;
              }
              return false;
            };

            const unassignedSource =
              plannedSources.find((s) => !isAssigned(s.id)) ??
              sources.find((s) => !isAssigned(s.id));
            if (unassignedSource) {
              this.requestSpawn(room.name, "miner", body, 105, {
                role: "miner",
                room: room.name,
                working: false,
                homeRoom: room.name,
                sourceId: unassignedSource.id,
              });
              continue;
            }
          }
        }
      }

      const target = desiredWorkerCount(room);

      const workerBodySize = buildWorkerBody(
        room.energyCapacityAvailable,
      ).length;
      const queuedWorkers = queuedRoleCount("worker");
      const effectiveWorkerCount =
        actualWorkerCount -
        getDyingCount("worker", workerBodySize) +
        queuedWorkers;

      if (effectiveWorkerCount < target) {
        const recoveryThreshold = target * 0.8;
        const isRecovery = effectiveWorkerCount < recoveryThreshold;
        const energyBudget = getSpawnEnergyBudget(room, isRecovery);

        const body = buildWorkerBody(energyBudget);

        this.requestSpawn(room.name, "worker", body, 90, {
          room: room.name,
          working: false,
        });
        continue;
      }

      if (rcl >= 3 && minerCount > 0 && haulerCount === 0) {
        const body = buildCarryMoveBody(room.energyAvailable);
        const sources = room.find(FIND_SOURCES);
        const sourceId = sources[0]?.id;
        if (sourceId) {
          this.requestSpawn(room.name, "hauler", body, 92, {
            role: "hauler",
            room: room.name,
            working: false,
            homeRoom: room.name,
            sourceId,
            hauling: false,
          });
          continue;
        }
      }

      if (hasKeeperHostile(room) && !canFightKeeperInRoom(room)) {
        continue;
      }

      if (shouldSpawnDefender(room)) {
        const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
        const desiredDefenders =
          hostiles > 0 ? Math.min(3, Math.max(1, hostiles)) : 1;
        const defenderCount = count("defender");

        if (defenderCount < desiredDefenders) {
          const body = buildDefenderBody(getSpawnEnergyBudget(room, true));
          this.requestSpawn(room.name, "defender", body, 95, {
            role: "defender",
            room: room.name,
            working: false,
            homeRoom: room.name,
          });
          continue;
        }
      }

      const storageEnergy =
        room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      const hubId = room.memory.links?.hub;
      const hubObj = hubId
        ? Game.getObjectById(hubId as Id<StructureLink>)
        : null;
      const hub = hubObj instanceof StructureLink ? hubObj : null;
      const hubEnergy = hub?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      const energyTight =
        room.energyAvailable <
        room.energyCapacityAvailable *
          config.POPULATION.ENERGY_BUDGET.LOW_RATIO;

      const canSpawnDistributor =
        mode !== "recover" &&
        !energyTight &&
        room.controller.level >= 4 &&
        (storageEnergy > config.POPULATION.DISTRIBUTOR.STORAGE_MIN_FOR_SPAWN ||
          hubEnergy > 200);

      if (canSpawnDistributor) {
        const distTarget =
          hub &&
          storageEnergy > config.POPULATION.DISTRIBUTOR.STORAGE_MIN_FOR_BIG
            ? 2
            : 1;
        const distBodySize = buildCarryMoveBody(
          room.energyCapacityAvailable,
        ).length;
        const effectiveDistCount =
          count("distributor") - getDyingCount("distributor", distBodySize);

        if (effectiveDistCount < distTarget) {
          let budget = getSpawnEnergyBudget(room, false);
          if (
            room.storage &&
            room.storage.store.energy <
              config.POPULATION.DISTRIBUTOR.STORAGE_MIN_FOR_BIG
          ) {
            budget = Math.min(
              budget,
              Math.max(
                config.POPULATION.DISTRIBUTOR.MIN_BUDGET,
                room.storage.store.energy /
                  config.POPULATION.DISTRIBUTOR.STORAGE_BUDGET_DIVISOR,
              ),
            );
          }

          const body = buildCarryMoveBody(budget);
          this.requestSpawn(room.name, "distributor", body, 65, {
            role: "distributor",
            room: room.name,
            working: false,
            homeRoom: room.name,
          });
          continue;
        }
      }

      if (!lowBucket && mode !== "recover" && room.controller.level >= 3) {
        const upgraderCount = count("upgrader");
        let desiredUpgraders = 0;

        const hasExtensionDeficit = extBuilt < extDesired;

        const energyHealthy =
          storageEnergy > config.POPULATION.UPGRADER.STORAGE_HEALTHY ||
          room.energyAvailable >
            room.energyCapacityAvailable *
              config.POPULATION.UPGRADER.AVAILABLE_HEALTHY_RATIO;

        if (!hasExtensionDeficit && workerCount >= target && energyHealthy) {
          if (room.controller.level === 8) {
            desiredUpgraders = 1;
          } else if (storageEnergy > config.POPULATION.UPGRADER.STORAGE_RICH) {
            desiredUpgraders = config.POPULATION.UPGRADER.COUNT_RICH;
          } else if (
            storageEnergy > config.POPULATION.UPGRADER.STORAGE_MEDIUM ||
            room.memory.mining
          ) {
            desiredUpgraders = config.POPULATION.UPGRADER.COUNT_MEDIUM;
          } else {
            desiredUpgraders = config.POPULATION.UPGRADER.COUNT_LOW;
          }

          if (
            room.energyAvailable <
              room.energyCapacityAvailable *
                config.POPULATION.UPGRADER.THROTTLE_RATIO &&
            desiredUpgraders > 1
          ) {
            desiredUpgraders = config.POPULATION.UPGRADER.COUNT_LOW;
          }
        } else {
          desiredUpgraders = 0;
        }

        const upgraderBodySize = buildUpgraderBody(
          room.energyCapacityAvailable,
        ).length;
        const effectiveUpgraderCount =
          upgraderCount - getDyingCount("upgrader", upgraderBodySize);

        if (effectiveUpgraderCount < desiredUpgraders) {
          const body = buildUpgraderBody(getSpawnEnergyBudget(room, false));
          this.requestSpawn(room.name, "upgrader", body, 50, {
            role: "upgrader",
            room: room.name,
            working: false,
            homeRoom: room.name,
          });
          continue;
        }
      }

      if (room.controller.level >= 3) {
        const sources = StructureCache.getSources(room);

        let haulerTarget = 0;
        if (rcl < 4 || !room.storage)
          haulerTarget = Math.max(1, sources.length);
        else {
          const hub = room.memory.links?.hub;
          const sourceLinks = room.memory.links?.source ?? [];
          const okLink = rcl >= 5 && !!hub && sourceLinks.length >= 1;
          haulerTarget = okLink ? 1 : 1;
        }

        const haulerBodySize = buildCarryMoveBody(
          room.energyCapacityAvailable,
        ).length;
        const effectiveHaulerCount =
          haulerCount - getDyingCount("hauler", haulerBodySize);

        if (effectiveHaulerCount < haulerTarget) {
          const body = buildCarryMoveBody(getSpawnEnergyBudget(room, false));

          const idx = haulerCount % sources.length;
          const sourceId = sources[idx]?.id;

          if (sourceId) {
            this.requestSpawn(room.name, "hauler", body, 80, {
              role: "hauler",
              room: room.name,
              working: false,
              homeRoom: room.name,
              sourceId,
              hauling: false,
            });
            continue;
          }
        }
      }

      if (!lowBucket && mode !== "recover") {
        const scoutTarget =
          room.memory.scout?.status === "active"
            ? room.memory.scout.targetRoom
            : undefined;
        if (scoutTarget && count("scout") < 1) {
          const body: BodyPartConstant[] = [MOVE];
          this.requestSpawn(room.name, "scout", body, 60, {
            role: "scout",
            room: room.name,
            working: false,
            homeRoom: room.name,
            targetRoom: scoutTarget,
          });
          continue;
        }
      }

      if (
        !lowBucket &&
        mode !== "recover" &&
        !isOffenseBlocked(room, count("defender"))
      ) {
        const remotesAll = getRemoteTargets(room);
        const needsKeeperSquad = remotesAll.find(
          (r) => room.memory.remote?.[r]?.threat?.hasKeeper,
        );

        const remoteCreepCounts = Cache.getTick("sp:remoteCreepCounts", () => {
          const m = new Map<string, number>();
          const all = Object.values(Game.creeps);
          for (const c of all) {
            const role = c.memory.role;
            const home = c.memory.homeRoom;
            const target = c.memory.targetRoom;
            if (
              typeof role !== "string" ||
              typeof home !== "string" ||
              typeof target !== "string"
            )
              continue;
            const k = `${home}|${role}|${target}`;
            m.set(k, (m.get(k) ?? 0) + 1);
          }
          return m;
        });

        const countAssigned = (role: string, targetRoom: string) => {
          const k = `${roomName}|${role}|${targetRoom}`;
          const cCount = remoteCreepCounts.get(k) ?? 0;
          const jCount = activeJobs.filter(
            (j) =>
              j.role === role &&
              j.room === roomName &&
              j.targetRoom === targetRoom,
          ).length;
          return cCount + jCount;
        };

        if (needsKeeperSquad && canRunSkRemote(room)) {
          const killers = countAssigned("keeperKiller", needsKeeperSquad);
          const healers = countAssigned("keeperHealer", needsKeeperSquad);

          if (killers < config.REMOTE_MINING.KEEPER_SQUAD.KILLERS) {
            if (
              getSpawnEnergyBudget(room, false) <
              room.energyCapacityAvailable * 0.9
            )
              continue;

            const body = buildKeeperKillerBody(room.energyCapacityAvailable);
            this.requestSpawn(room.name, "keeperKiller", body, 75, {
              role: "keeperKiller",
              room: room.name,
              working: false,
              homeRoom: room.name,
              targetRoom: needsKeeperSquad,
            });
            continue;
          }
          if (healers < config.REMOTE_MINING.KEEPER_SQUAD.HEALERS) {
            if (
              getSpawnEnergyBudget(room, false) <
              room.energyCapacityAvailable * 0.9
            )
              continue;

            const body = buildKeeperHealerBody(room.energyCapacityAvailable);
            this.requestSpawn(room.name, "keeperHealer", body, 75, {
              role: "keeperHealer",
              room: room.name,
              working: false,
              homeRoom: room.name,
              targetRoom: needsKeeperSquad,
            });
            continue;
          }
        }

        const allowedRemotes = getRemoteTargets(room).filter((r) => {
          if (isSourceKeeperRoom(r) && !canRunSkRemote(room)) return false;
          if (isSourceKeeperRoom(r)) {
            const killers = countAssigned("keeperKiller", r);
            const healers = countAssigned("keeperHealer", r);
            if (killers < 1 || healers < 1) return false;
          }
          return true;
        });

        let spawnedRemote = false;

        for (const remote of allowedRemotes) {
          if (room.controller.level >= 3) {
            const reservers = countAssigned("reserver", remote);
            if (reservers < 1) {
              const body = buildReserverBody(getSpawnEnergyBudget(room, false));
              this.requestSpawn(room.name, "reserver", body, 40, {
                role: "reserver",
                room: room.name,
                working: false,
                homeRoom: room.name,
                targetRoom: remote,
              });
              spawnedRemote = true;
              break;
            }
          }

          const harvesters = countAssigned("remoteHarvester", remote);
          const sourceCount =
            room.memory.remote?.[remote]?.stats?.sourceCount ?? 1;
          if (harvesters < sourceCount) {
            const body = buildRemoteHarvesterBody(
              getSpawnEnergyBudget(room, false),
            );
            this.requestSpawn(room.name, "remoteHarvester", body, 35, {
              role: "remoteHarvester",
              room: room.name,
              working: false,
              homeRoom: room.name,
              targetRoom: remote,
            });
            spawnedRemote = true;
            break;
          }

          const haulers = countAssigned("remoteHauler", remote);
          const stats = room.memory.remote?.[remote]?.stats;
          let desiredHaulers = 1;
          if (stats && stats.neededCarryParts > 0) {
            const budget = getSpawnEnergyBudget(room, false);
            const sampleBody = buildCarryMoveBody(budget);
            const carryParts = sampleBody.filter((p) => p === CARRY).length;
            if (carryParts > 0) {
              desiredHaulers = Math.ceil(stats.neededCarryParts / carryParts);
            }
          }
          desiredHaulers = Math.min(desiredHaulers, 5);

          if (haulers < desiredHaulers) {
            const body = buildCarryMoveBody(getSpawnEnergyBudget(room, false));
            this.requestSpawn(room.name, "remoteHauler", body, 30, {
              role: "remoteHauler",
              room: room.name,
              working: false,
              homeRoom: room.name,
              targetRoom: remote,
              hauling: false,
            });
            spawnedRemote = true;
            break;
          }
        }

        if (spawnedRemote) continue;
      }
    }
  }

  private requestSpawn(
    roomName: string,
    role: string,
    body: BodyPartConstant[],
    priority: number,
    memory: Record<string, unknown>,
  ) {
    const pid = `spawn_${roomName}_${role}_${Game.time}_${Math.floor(Math.random() * 1000)}`;
    const job = new SpawnJob(pid, this.pid, priority);
    this.kernel.addProcess(job);

    const mem = this.kernel.getProcessMemory(pid);
    mem.roomName = roomName;
    mem.role = role;
    mem.body = body;
    mem.memory = memory;
    mem.spawnName =
      memory.name ??
      `${role === "worker" ? "W" : role[0].toUpperCase()}_${roomName}_${Game.time}`;
  }
}

processRegistry.register(SpawnerProcess, "SpawnerProcess");
