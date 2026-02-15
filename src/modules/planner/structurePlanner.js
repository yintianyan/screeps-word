// 智能结构规划器
// 根据地形和关键点自动规划 Container、Rampart 和 Extension

const structurePlanner = {
    run: function(room) {
        if (!room.controller || !room.controller.my) return;
        if (Game.time % 100 !== 0) return; // 节约CPU，每100 tick 运行一次

        // 1. 规划 Container (RCL 2+)
        if (room.controller.level >= 2) {
            this.planMiningContainers(room);
        }
        if (room.controller.level >= 3) {
            this.planControllerContainer(room);
        }

        // 2. 规划防御工事 (Ramparts)
        if (room.controller.level >= 3) {
            this.planBunkerRamparts(room);
        }
    },

    planMiningContainers: function(room) {
        const sources = room.find(FIND_SOURCES);
        sources.forEach(source => {
            // 检查周围是否已有 Container 或工地
            const nearby = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: s => s.structureType === STRUCTURE_CONTAINER
            });
            if (nearby.length > 0) return;

            const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
                filter: s => s.structureType === STRUCTURE_CONTAINER
            });
            if (sites.length > 0) return;

            // 寻找最佳位置 (Plain > Swamp, 非墙)
            // 优先选择路径上的点? 简单起见，找第一个非墙空地
            // 更好的是：计算从 Spawn 到 Source 的路径，取路径上距离 Source 1 的点
            const spawn = room.find(FIND_MY_SPAWNS)[0];
            let targetPos = null;

            if (spawn) {
                const path = room.findPath(source.pos, spawn.pos, { ignoreCreeps: true, range: 1 });
                if (path.length > 0) {
                    targetPos = new RoomPosition(path[0].x, path[0].y, room.name);
                }
            }

            // 如果找不到路径点，随机找一个空地
            if (!targetPos) {
                const terrain = room.getTerrain();
                for (let x = -1; x <= 1; x++) {
                    for (let y = -1; y <= 1; y++) {
                        if (x===0 && y===0) continue;
                        const px = source.pos.x + x;
                        const py = source.pos.y + y;
                        if (terrain.get(px, py) !== TERRAIN_MASK_WALL) {
                            targetPos = new RoomPosition(px, py, room.name);
                            break;
                        }
                    }
                    if (targetPos) break;
                }
            }

            if (targetPos) {
                targetPos.createConstructionSite(STRUCTURE_CONTAINER);
                console.log(`[Planner] 🔨 Mining Container planned at ${targetPos}`);
            }
        });
    },

    planControllerContainer: function(room) {
        if (!room.controller) return;
        
        // 检查是否已有 Link (如果有 Link，就不需要 Container 了)
        const nearbyLink = room.controller.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: s => s.structureType === STRUCTURE_LINK
        });
        if (nearbyLink.length > 0) return;

        // 检查 Container
        const nearby = room.controller.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });
        if (nearby.length > 0) return;

        // 规划逻辑同上，尽量靠近 Spawn 路径
        // ... (简化，直接找 Range 2 的空地)
        const targetPos = this.findFreeSpot(room.controller.pos, 2, room);
        if (targetPos) {
            targetPos.createConstructionSite(STRUCTURE_CONTAINER);
            console.log(`[Planner] 🔨 Controller Container planned at ${targetPos}`);
        }
    },

    planBunkerRamparts: function(room) {
        // 保护关键建筑：Spawn, Storage, Terminal, Towers, Containers
        const criticalStructures = room.find(FIND_STRUCTURES, {
            filter: s => [
                STRUCTURE_SPAWN, 
                STRUCTURE_STORAGE, 
                STRUCTURE_TERMINAL, 
                STRUCTURE_TOWER,
                STRUCTURE_CONTAINER
            ].includes(s.structureType)
        });

        criticalStructures.forEach(s => {
            const rampart = s.pos.lookFor(LOOK_STRUCTURES).find(str => str.structureType === STRUCTURE_RAMPART);
            if (!rampart) {
                s.pos.createConstructionSite(STRUCTURE_RAMPART);
            }
        });
    },

    findFreeSpot: function(pos, range, room) {
        const terrain = room.getTerrain();
        for (let x = -range; x <= range; x++) {
            for (let y = -range; y <= range; y++) {
                if (Math.abs(x) < range && Math.abs(y) < range) continue; // Only check outer ring? Or just check all
                const px = pos.x + x;
                const py = pos.y + y;
                if (px < 1 || px > 48 || py < 1 || py > 48) continue;
                if (terrain.get(px, py) !== TERRAIN_MASK_WALL) {
                    // Check for existing structures
                    const structs = room.lookForAt(LOOK_STRUCTURES, px, py);
                    if (structs.length === 0) {
                        return new RoomPosition(px, py, room.name);
                    }
                }
            }
        }
        return null;
    }
};

module.exports = structurePlanner;
