const moveModule = require("module.move");

const roleHauler = {
  /** @param {Creep} creep **/
  run: function (creep) {
    // 状态切换
    if (creep.memory.hauling && creep.store[RESOURCE_ENERGY] == 0) {
      creep.memory.hauling = false;
      creep.say("🔄 collect");
    }
    if (!creep.memory.hauling && creep.store.getFreeCapacity() == 0) {
      creep.memory.hauling = true;
      creep.say("🚚 haul");
    }

    // === 紧急填充逻辑 ===
    // 只有在能量极低（影响孵化）时才强制切换
    // 避免普通消耗导致搬运工频繁震荡 (Collecting <-> Hauling)
    if (!creep.memory.hauling && creep.store[RESOURCE_ENERGY] > 0) {
      // 阈值：总容量的 40% 或 300 (孵化底线)，取大者。
      // 只有低于这个线，才视为“危机”，需要立即送货。
      const emergencyLimit = Math.max(
        300,
        creep.room.energyCapacityAvailable * 0.4,
      );

      // 最小运载量：至少 50 或 10% 容量，避免带着 1-2 点能量跑来跑去
      const minCarry = Math.max(50, creep.store.getCapacity() * 0.1);

      if (
        creep.room.energyAvailable < emergencyLimit &&
        creep.store[RESOURCE_ENERGY] >= minCarry
      ) {
        creep.memory.hauling = true;
        creep.say("🚨 救援");
      }
    }

    if (creep.memory.hauling) {
      // === 送货模式 ===

      // 0. 预判逻辑：统计所有其他搬运工的送货目标和携带量
      // 用于防止多个搬运工同时前往同一个只需少量能量的目标
      const incomingEnergy = {};
      const otherHaulers = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) =>
          c.memory.role === "hauler" &&
          c.memory.hauling &&
          c.id !== creep.id &&
          c.memory.targetId,
      });

      otherHaulers.forEach((h) => {
        incomingEnergy[h.memory.targetId] =
          (incomingEnergy[h.memory.targetId] || 0) + h.store[RESOURCE_ENERGY];
      });

      // 目标锁定逻辑：一旦选定目标，就存入 memory.targetId，直到送完或者目标无效
      let target = null;

      // 1. 尝试从 memory 获取已锁定的目标
      if (creep.memory.targetId) {
        target = Game.getObjectById(creep.memory.targetId);

        // 验证目标是否有效
        let isValid = false;
        if (target) {
          const freeCapacity = target.store
            ? target.store.getFreeCapacity(RESOURCE_ENERGY)
            : 0;

          // 基本有效性检查：必须还有空位
          if (freeCapacity > 0) {
            isValid = true;

            // 进阶检查：是否被其他人填满？
            // 如果 (其他人正在运送的量) >= (目标剩余空间)，则认为目标已饱和，我应该放弃
            const othersIncoming = incomingEnergy[target.id] || 0;
            if (othersIncoming >= freeCapacity) {
              console.log(
                `[Hauler] ${creep.name} switching from ${target.structureType || "target"} #${target.id}: Saturated by others (Incoming: ${othersIncoming} >= Free: ${freeCapacity})`,
              );
              isValid = false; // 标记为无效，触发重新寻找
            }
          }
        }

        if (!isValid) {
          delete creep.memory.targetId;
          target = null;
        }
      }

      // 2. 如果没有目标 (或已失效)，重新寻找
      if (!target) {
        let targets = [];

        // 辅助函数：过滤掉已饱和的目标
        const filterSaturated = (structure) => {
          const free = structure.store.getFreeCapacity(RESOURCE_ENERGY);
          if (free <= 0) return false;

          const incoming = incomingEnergy[structure.id] || 0;
          // 如果 (已有运送量) >= (剩余容量)，则跳过
          return incoming < free;
        };

        // 优先级 1: Spawn / Extension
        // 策略：严格优先。只要有不满的 Spawn/Extension，绝不送去其他地方。
        // 1. 找出所有不满的 Spawn/Extension
        const unfilledSpawns = creep.room.find(FIND_STRUCTURES, {
          filter: (structure) => {
            return (
              (structure.structureType == STRUCTURE_EXTENSION ||
                structure.structureType == STRUCTURE_SPAWN) &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            );
          },
        });

        // 2. 优先找其中“未饱和”的（即还没有人去送的）
        targets = unfilledSpawns.filter((s) => filterSaturated(s));

        // 3. 如果所有不满的都已经有人送了（targets 为空），但依然有不满的存在
        // 为了严格遵守“Spawn 最高优先级”，我们宁可多人送同一个，也不能去送 Tower
        // 强制回退到所有未满的 Spawn/Extension，即使它们已饱和
        if (targets.length === 0 && unfilledSpawns.length > 0) {
          targets = unfilledSpawns;
        }

        // === 严格优先权控制 ===
        // 如果有任何 Spawn/Extension 需要填充，禁止考虑其他目标
        const strictSpawnPriority =
          targets.length > 0 || unfilledSpawns.length > 0;

        // 优先级 2: Tower (仅当 Spawn/Extension 全满时)
        if (targets.length === 0 && !strictSpawnPriority) {
          targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
              return (
                structure.structureType == STRUCTURE_TOWER &&
                filterSaturated(structure)
              );
            },
          });
        }

        // 优先级 2.5: 喂养 Creeps (Upgrader/Builder) (仅当 Spawn/Extension 全满时)
        if (targets.length === 0 && !strictSpawnPriority) {
          const hungryCreeps = creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => {
              // 1. 基本条件：请求能量且未饱和
              if (!c.memory.requestingEnergy || !filterSaturated(c))
                return false;

              // 2. 检查 Creep 附近 (Range 3) 是否有带能量的 Container/Storage
              // 如果有，说明它自己可以去取，搬运工不要浪费时间跑过去
              const nearbyStorage = c.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (s) =>
                  (s.structureType == STRUCTURE_CONTAINER ||
                    s.structureType == STRUCTURE_STORAGE) &&
                  s.store[RESOURCE_ENERGY] > 50, // 至少有点存货
              });

              if (nearbyStorage.length > 0) return false;

              return true;
            },
          });

          if (hungryCreeps.length > 0) {
            // 优先喂 Builder > Upgrader (按用户新需求)
            // 且优先满足等待时间过长 (>5 ticks) 的
            targets = hungryCreeps.sort((a, b) => {
              // 1. 强制共享检测
              const forceA = (a.memory.waitingTicks || 0) > 5;
              const forceB = (b.memory.waitingTicks || 0) > 5;
              if (forceA !== forceB) return forceA ? -1 : 1;

              // 2. 角色优先级
              const rolePriority = { builder: 2, upgrader: 1 };
              const priorityA = rolePriority[a.memory.role] || 0;
              const priorityB = rolePriority[b.memory.role] || 0;
              if (priorityA !== priorityB) return priorityB - priorityA;

              // 3. 等待时间
              return (
                (b.memory.waitingTicks || 0) - (a.memory.waitingTicks || 0)
              );
            });
            // 这里不需要 filter，sort 后 targets[0] 就是最好的，findClosestByPath 会再基于距离筛选
            // 但为了让 findClosestByPath 有效，我们可能需要保留数组
          }
        }

        // 优先级 3: Spawn Container (仅当 Spawn/Extension 全满时)
        if (targets.length === 0 && !strictSpawnPriority) {
          const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
          if (spawn) {
            const spawnContainers = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
              filter: (s) =>
                s.structureType === STRUCTURE_CONTAINER &&
                filterSaturated(s) &&
                // 防止震荡：只有当背包接近满时才存入，避免刚取了一点就存回去
                creep.store.getUsedCapacity(RESOURCE_ENERGY) >
                  creep.store.getCapacity(RESOURCE_ENERGY) * 0.9,
            });
            if (spawnContainers.length > 0) {
              targets = spawnContainers;
            }
          }
        }

        // 优先级 4: Storage (仅当 Spawn/Extension 全满时)
        // 策略：Storage 是主要蓄水池，优先级较高。但如果 Controller Container 极度缺货，应优先送往那里。

        // 检查 Controller Container 状态
        let controllerContainer = null;
        if (creep.room.controller) {
          const containers = creep.room.controller.pos.findInRange(
            FIND_STRUCTURES,
            4,
            {
              filter: (s) =>
                s.structureType === STRUCTURE_CONTAINER && filterSaturated(s),
            },
          );
          if (containers.length > 0) controllerContainer = containers[0];
        }

        // 如果 Controller Container 很空 (< 500)，强行提升优先级到 Storage 之前
        if (
          targets.length === 0 &&
          !strictSpawnPriority &&
          controllerContainer &&
          controllerContainer.store[RESOURCE_ENERGY] < 500
        ) {
          targets = [controllerContainer];
        }

        if (targets.length === 0 && !strictSpawnPriority) {
          const isCrisis = creep.room.memory.energyState === "CRISIS";
          targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
              // 基础条件
              if (structure.structureType !== STRUCTURE_STORAGE) return false;
              if (!filterSaturated(structure)) return false;

              // 危机模式下，禁止将能量存回 Storage (因为我们刚从那里取出来！)
              // 这防止了 "从 Storage 取 -> 填 Spawn 满 -> 存回 Storage" 的死循环
              if (isCrisis) return false;

              return (
                creep.store.getUsedCapacity(RESOURCE_ENERGY) >
                creep.store.getCapacity(RESOURCE_ENERGY) * 0.9
              );
            },
          });
        }

        // 优先级 5: Controller Container (常规补充)
        if (
          targets.length === 0 &&
          !strictSpawnPriority &&
          controllerContainer
        ) {
          targets = [controllerContainer];
        }

        // 选择最近的目标并锁定
        if (targets.length > 0) {
          target = creep.pos.findClosestByPath(targets);
          if (target) {
            creep.memory.targetId = target.id;
          }
        }
      }

      // 3. 执行送货
      if (target) {
        // === 智能重定向逻辑 ===
        // 在尝试传输前，先检查目标是否已满 (对于 Structure)
        // 如果已满，立即扫描周围 3 格内是否有请求能量的 Creep
        let redirected = false;

        if (
          target.structureType &&
          target.store.getFreeCapacity(RESOURCE_ENERGY) === 0
        ) {
          // 目标已满！
          const nearbyRequestingCreeps = creep.pos.findInRange(
            FIND_MY_CREEPS,
            3,
            {
              filter: (c) => c.memory.requestingEnergy,
            },
          );

          if (nearbyRequestingCreeps.length > 0) {
            // 按优先级排序：Builder > Upgrader > Other
            // 且优先满足等待时间最长的 (waitingTicks)
            const bestCreep = nearbyRequestingCreeps.sort((a, b) => {
              const rolePriority = { builder: 2, upgrader: 1 };
              const priorityA = rolePriority[a.memory.role] || 0;
              const priorityB = rolePriority[b.memory.role] || 0;

              if (priorityA !== priorityB) return priorityB - priorityA; // 高优先
              return (
                (b.memory.waitingTicks || 0) - (a.memory.waitingTicks || 0)
              ); // 长等待优先
            })[0];

            if (bestCreep) {
              console.log(
                `${creep.name} redirected energy from full ${target.structureType} to ${bestCreep.name} (${bestCreep.memory.role})`,
              );
              if (creep.pos.isNearTo(bestCreep)) {
                creep.transfer(bestCreep, RESOURCE_ENERGY);
                redirected = true;
              } else {
                delete creep.memory.targetId;
              }
            }
          }
        }

        if (!redirected) {
          const result = creep.transfer(target, RESOURCE_ENERGY);
          if (result == ERR_NOT_IN_RANGE) {
            const moveOpts = {
              visualizePathStyle: { stroke: "#ffffff" },
            };

            // === 智能避让升级者 (Anti-Crowd Logic) ===
            // 当去往 Controller 区域 (Range 5) 时，如果检测到堵塞 (stuckCount > 0)
            // 自动启用避让模式，绕过 Upgrader，寻找侧边路径
            if (
              creep.room.controller &&
              target.pos.inRangeTo(creep.room.controller, 5)
            ) {
              if (creep.memory._move && creep.memory._move.stuckCount > 0) {
                moveOpts.avoidRoles = ["upgrader"];
                moveOpts.visualizePathStyle.stroke = "#ff00ff"; // Purple path
                creep.say("⤵️ bypass");
              }
            }

            moveModule.smartMove(creep, target, moveOpts);
          } else if (result == ERR_FULL) {
            // 如果返回 ERR_FULL (虽然上面预判了，但多加一层保险)
            // 清除目标，让下一 tick 重新寻找
            delete creep.memory.targetId;
          }

          // === 4. 送货死锁处理 (Hauling Deadlock) ===
          // 如果送货途中长时间卡住 (> 5 ticks)，放弃当前目标，重新选择
          // 可能是目标被围住了，或者路径不可达
          if (creep.memory._move && creep.memory._move.stuckCount > 10) {
            console.log(
              `[Hauler] ${creep.name} gave up target ${target.id} due to stuck (>5 ticks)`,
            );
            delete creep.memory.targetId;
            creep.memory._move.stuckCount = 0;
            creep.say("🏳️ yield");
          }
        }
      } else {
        // 如果真的没有任何地方可送 (且背包有货)
        // 检查是否需要孵化待命... (保留原有逻辑)

        let fallback = null;
        if (
          creep.room.storage &&
          creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        ) {
          fallback = creep.room.storage;
        }

        if (!fallback) {
          const containers = creep.room.find(FIND_STRUCTURES, {
            filter: (s) =>
              s.structureType === STRUCTURE_CONTAINER &&
              s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
              s.pos.findInRange(FIND_SOURCES, 2).length === 0,
          });
          if (containers.length > 0) {
            fallback = creep.pos.findClosestByPath(containers);
          }
        }

        if (!fallback) {
          const anyContainers = creep.room.find(FIND_STRUCTURES, {
            filter: (s) =>
              s.structureType === STRUCTURE_CONTAINER &&
              s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
          });
          if (anyContainers.length > 0) {
            fallback = creep.pos.findClosestByPath(anyContainers);
          }
        }

        if (fallback) {
          const res = creep.transfer(fallback, RESOURCE_ENERGY);
          if (res === ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, fallback);
          }
          return;
        }

        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn) {
          const getIdleSpot = () => {
            if (creep.memory.idleSpot) {
              const pos = new RoomPosition(
                creep.memory.idleSpot.x,
                creep.memory.idleSpot.y,
                creep.room.name,
              );
              if (pos.inRangeTo(spawn, 3) && pos.getRangeTo(spawn) >= 2) {
                const terrain = creep.room.getTerrain().get(pos.x, pos.y);
                if (terrain !== TERRAIN_MASK_WALL) {
                  const structures = pos.lookFor(LOOK_STRUCTURES);
                  if (
                    !structures.some(
                      (s) =>
                        s.structureType === STRUCTURE_ROAD ||
                        (typeof OBSTACLE_OBJECT_TYPES !== "undefined" &&
                          OBSTACLE_OBJECT_TYPES.includes(s.structureType)),
                    )
                  ) {
                    if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length === 0) {
                      // 检查是否被其他 Creep 占据 (忽略自己)
                      const creeps = pos.lookFor(LOOK_CREEPS);
                      if (
                        creeps.length === 0 ||
                        (creeps.length === 1 && creeps[0].id === creep.id)
                      ) {
                        return pos;
                      }
                    }
                  }
                }
              }
            }

            const candidates = [];
            const terrain = creep.room.getTerrain();
            for (let dx = -3; dx <= 3; dx++) {
              for (let dy = -3; dy <= 3; dy++) {
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                const pos = new RoomPosition(x, y, creep.room.name);
                if (!pos.inRangeTo(spawn, 3)) continue;
                if (pos.getRangeTo(spawn) < 2) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                const structures = pos.lookFor(LOOK_STRUCTURES);
                if (structures.some((s) => s.structureType === STRUCTURE_ROAD))
                  continue;
                if (
                  structures.some(
                    (s) =>
                      typeof OBSTACLE_OBJECT_TYPES !== "undefined" &&
                      OBSTACLE_OBJECT_TYPES.includes(s.structureType),
                  )
                )
                  continue;
                if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue;
                if (pos.lookFor(LOOK_CREEPS).length > 0) continue;

                candidates.push(pos);
              }
            }

            if (candidates.length > 0) {
              candidates.sort(
                (a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b),
              );
              const pos = candidates[0];
              creep.memory.idleSpot = { x: pos.x, y: pos.y };
              return pos;
            }

            return null;
          };

          const idlePos = getIdleSpot();
          if (idlePos && !creep.pos.isEqualTo(idlePos)) {
            moveModule.smartMove(creep, idlePos, { range: 0 });
          } else if (!idlePos) {
            if (!creep.pos.inRangeTo(spawn, 3)) {
              moveModule.smartMove(creep, spawn, { range: 3 });
            } else {
              moveModule.parkOffRoad(creep, spawn, 3);
            }
          }
        }
      }
    } else {
      // 寻找能量来源

      // === 0. 危机取货逻辑 (Crisis Fetch) ===
      // 用户需求：能源危机时，搬运者应将能够找到的能源先存满 spawn
      // 此时无视 Source 绑定，无视 Container 类型，只求最快拿到能量
      const isCrisis =
        creep.room.memory.energyState === "CRISIS" ||
        creep.room.energyAvailable < 300;

      if (isCrisis) {
        // 尝试维持上一个危机取货目标，防止在两个近距离容器间震荡
        let target = null;
        if (creep.memory.crisisTargetId) {
          target = Game.getObjectById(creep.memory.crisisTargetId);
          // 验证目标是否依然有货且有效
          if (
            !target ||
            !target.store ||
            target.store.getUsedCapacity(RESOURCE_ENERGY) === 0
          ) {
            delete creep.memory.crisisTargetId;
            target = null;
          }
        }

        if (!target) {
          // 扫描所有有能量的容器 (Storage + Container + Tombstone + Ruin)
          const energyStructures = creep.room.find(FIND_STRUCTURES, {
            filter: (s) =>
              (s.structureType === STRUCTURE_STORAGE ||
                s.structureType === STRUCTURE_CONTAINER) &&
              s.store[RESOURCE_ENERGY] > 0,
          });

          const tombstones = creep.room.find(FIND_TOMBSTONES, {
            filter: (t) => t.store[RESOURCE_ENERGY] > 0,
          });
          const ruins = creep.room.find(FIND_RUINS, {
            filter: (r) => r.store[RESOURCE_ENERGY] > 0,
          });

          const allTargets = [...energyStructures, ...tombstones, ...ruins];

          if (allTargets.length > 0) {
            target = creep.pos.findClosestByPath(allTargets);
            if (target) creep.memory.crisisTargetId = target.id;
          }
        }

        if (target) {
          if (creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, target, {
              visualizePathStyle: { stroke: "#ff0000" }, // 红色路径示警
            });
          }
          return;
        }
      } else {
        // 正常模式下清除危机目标记忆
        delete creep.memory.crisisTargetId;
      }

      // 掉落的资源 > 墓碑 > 废墟

      // 0. 优先从 Mining Container 取货 (如果有能量)
      // 必须是 Source 附近的 Container，或者是 Spawn 附近的 Container (如果是空的 Spawn 需要补充？暂时不考虑)

      // === 动态负载均衡 (Dynamic Load Balancing) ===
      // 不再盲目去绑定的 Source，而是先扫描全图，看有没有 "爆仓" 的 Container
      // 只有当没有紧急情况时，才优先去自己的 Source

      let targetContainer = null;
      const allMiningContainers = creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.pos.findInRange(FIND_SOURCES, 2).length > 0,
      });

      if (allMiningContainers.length > 0) {
        let bestContainer = null;
        let maxScore = -Infinity;

        allMiningContainers.forEach((c) => {
          const energy = c.store[RESOURCE_ENERGY];
          if (energy < 100) return; // 忽略几乎空的

          let score = energy;

          // 距离惩罚 (每格 -10 分，避免为了多 100 能量跑半个地图)
          const dist = creep.pos.getRangeTo(c);
          score -= dist * 10;

          // 绑定奖励 (Source Affinity)
          // 如果是分配给我的 Source，奖励 800 分 (相当于 800 能量的优势)
          if (
            creep.memory.sourceId &&
            c.pos
              .findInRange(FIND_SOURCES, 2)
              .some((s) => s.id === creep.memory.sourceId)
          ) {
            score += 800;
          }

          // 爆仓奖励 (Emergency Overflow)
          // 如果能量 > 1800 (即将满)，奖励 2000 分 (无视距离和绑定，强制去搬)
          if (energy > 1800) {
            score += 2000;
          } else if (energy > 1500) {
            score += 1000;
          }

          // 目标粘性 (Target Stickiness)
          // 如果这本来就是我锁定的目标，奖励 200 分，防止在两个距离相近的容器间震荡
          if (creep.memory.targetContainerId === c.id) {
            score += 200;
          }

          if (score > maxScore) {
            maxScore = score;
            bestContainer = c;
          }
        });

        if (bestContainer) {
          targetContainer = bestContainer;
          creep.memory.targetContainerId = bestContainer.id;
        } else {
          delete creep.memory.targetContainerId;
        }
      }

      // 如果通过评分系统没找到（比如都空了），再回退到旧逻辑（找自己的或者任意的）
      // 其实上面的逻辑已经覆盖了找自己的，所以这里只需要处理还没找到的情况

      // 如果分配了 Source ID，优先去该 Source 附近的 Container
      if (!targetContainer && creep.memory.sourceId) {
        const source = Game.getObjectById(creep.memory.sourceId);
        if (source) {
          const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
          });
          if (containers.length > 0) {
            const c = containers[0];
            // 危机模式下，只有当 Container 有能量时才绑定，否则忽略，避免死守空仓
            if (!isCrisis || c.store[RESOURCE_ENERGY] > 0) {
              targetContainer = c;
            }
          }
        }
      }

      // 如果没有分配 Source ID 或者分配的 Source 附近没有 Container，则找任意 Mining Container
      if (!targetContainer) {
        const containers = creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 50 &&
            s.pos.findInRange(FIND_SOURCES, 2).length > 0, // 必须是 Mining Container
        });
        if (containers.length > 0) {
          targetContainer = creep.pos.findClosestByPath(containers);
        }
      }

      // 绑定 Container 的特殊逻辑：死等直到满
      // 如果目标是绑定的 Container，即使空了也要去，并且一直在那等到自己满
      if (
        targetContainer &&
        creep.memory.sourceId &&
        targetContainer.pos.inRangeTo(
          Game.getObjectById(creep.memory.sourceId),
          2,
        ) &&
        (!creep.memory.unbindUntil || Game.time >= creep.memory.unbindUntil)
      ) {
        // 增加额外的死锁检测重置：如果进入了这个 "Binding Logic"，说明我们在有意靠近/等待 Container
        // 无论如何都应该重置死锁，防止被开头那个通用逻辑误杀
        let keepBinding = true;

        // 尝试取货
        if (targetContainer.store[RESOURCE_ENERGY] > 0) {
          creep.memory.waitOnContainerTicks = 0;
          const withdrawResult = creep.withdraw(
            targetContainer,
            RESOURCE_ENERGY,
          );
          if (withdrawResult == ERR_NOT_IN_RANGE) {
            moveModule.smartMove(creep, targetContainer, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          } else if (withdrawResult == OK) {
            // 取货成功，如果还没满，下一 tick 继续
            // 如果满了，下个 tick 的状态切换逻辑会把它切成 hauling
          }
        } else {
          // 危机模式下，强制解除空仓绑定
          if (isCrisis && targetContainer.store[RESOURCE_ENERGY] === 0) {
            keepBinding = false;
          }

          if (keepBinding) {
            // 没货，但也要过去守着
            if (!creep.pos.inRangeTo(targetContainer, 1)) {
              moveModule.smartMove(creep, targetContainer, {
                range: 1, // 明确指定范围
                visualizePathStyle: { stroke: "#ffaa00" },
              });
            } else {
              // 到了位置，虽然 Container 没货，但如果旁边有 Harvester 且有能量，我应该等它给我
              // 否则才算是真正的 waiting
              const nearbyHarvester = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
                filter: (c) =>
                  c.memory.role === "harvester" && c.store[RESOURCE_ENERGY] > 0,
              })[0];

              if (nearbyHarvester) {
                creep.memory.waitOnContainerTicks = 0;
                creep.say("🤲 gimme"); // 提示 Harvester 给我能量
              } else {
                creep.say("⏳ waiting");
                // 如果站在路上，尝试移到路边（但在 Container 范围内）
                moveModule.parkOffRoad(creep, targetContainer, 1);
                creep.memory.waitOnContainerTicks =
                  (creep.memory.waitOnContainerTicks || 0) + 1;

                if (creep.memory.waitOnContainerTicks > 20) {
                  creep.memory.unbindUntil = Game.time + 50;
                  creep.memory.waitOnContainerTicks = 0;
                  delete creep.memory.targetContainerId;
                  keepBinding = false;
                }
              }
            }
          }

          // 同时尝试捡脚下的掉落资源 (Range 1 范围内)
          const dropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
            filter: (r) => r.resourceType === RESOURCE_ENERGY,
          });
          if (dropped.length > 0) {
            creep.pickup(dropped[0]);
          }

          // === 提前离开逻辑 ===
          // 如果 Container 空了（或几乎空了），且自己身上已经有不少能量 (>50%)，
          // 不要死等，直接去送货。这能缓解拥堵，并提高周转率。
          const containerEnergy = targetContainer.store[RESOURCE_ENERGY];
          const myEnergy = creep.store[RESOURCE_ENERGY];
          const myCapacity = creep.store.getCapacity(RESOURCE_ENERGY);

          if (containerEnergy < 50 && myEnergy > myCapacity * 0.5) {
            creep.memory.hauling = true;
            creep.say("🏃 early");
            return;
          }

          if (keepBinding) return; // 强制留在这里，直到状态切换（满载）
        }
      }

      // === 紧急取货逻辑 ===
      // 如果 Spawn 没满，且 Mining Container 没货，允许从 Storage 或 General Container 取货
      if (
        !targetContainer &&
        creep.room.energyAvailable < creep.room.energyCapacityAvailable
      ) {
        // 找 Storage
        if (
          creep.room.storage &&
          creep.room.storage.store[RESOURCE_ENERGY] > 0
        ) {
          // 只有当 Storage 能量充足或者非常紧急时才取
          if (
            creep.room.storage.store[RESOURCE_ENERGY] > 500 ||
            creep.room.energyAvailable < 300
          ) {
            if (
              creep.withdraw(creep.room.storage, RESOURCE_ENERGY) ==
              ERR_NOT_IN_RANGE
            ) {
              moveModule.smartMove(creep, creep.room.storage, {
                visualizePathStyle: { stroke: "#ffaa00" },
              });
            }
            return;
          }
        }

        // 找 General Container (非 Mining)
        const generalContainers = creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 50 &&
            s.pos.findInRange(FIND_SOURCES, 2).length === 0,
        });
        if (generalContainers.length > 0) {
          targetContainer = creep.pos.findClosestByPath(generalContainers);
        }
      }

      if (targetContainer) {
        if (
          creep.withdraw(targetContainer, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE
        ) {
          moveModule.smartMove(creep, targetContainer, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 1. 掉落的资源 (优先捡自己 Source 附近的)
      let droppedResources = [];
      if (creep.memory.sourceId) {
        const source = Game.getObjectById(creep.memory.sourceId);
        if (source) {
          droppedResources = source.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
            filter: (resource) => resource.resourceType == RESOURCE_ENERGY,
          });
        }
      }

      if (droppedResources.length === 0) {
        droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
          filter: (resource) => resource.resourceType == RESOURCE_ENERGY,
        });
      }

      if (droppedResources.length > 0) {
        const target = creep.pos.findClosestByPath(droppedResources);
        if (creep.pickup(target) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 2. 墓碑 (死掉的 creep)
      const tombstones = creep.room.find(FIND_TOMBSTONES, {
        filter: (tombstone) => tombstone.store[RESOURCE_ENERGY] > 0,
      });
      if (tombstones.length > 0) {
        const target = creep.pos.findClosestByPath(tombstones);
        if (creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          moveModule.smartMove(creep, target, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // 3. 如果有 Container (容器)，也可以从 Container 取 (以后扩展)
      // const containers = ...

      // 如果实在没事干，可以尝试去 source 旁边捡漏（或者这里可以扩展为去 Container 取货）
      const sources = creep.room.find(FIND_SOURCES);
      if (sources.length > 0) {
        const source = sources[0]; // 简单去第一个 source 附近碰运气
        if (!creep.pos.inRangeTo(source, 3)) {
          moveModule.smartMove(creep, source, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
      }
    }
  },
};

module.exports = roleHauler;
