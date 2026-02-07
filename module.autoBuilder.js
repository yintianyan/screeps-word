const autoBuilder = {
    run: function(room) {
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        if (!spawn) return;

        // === 高频检查 (每 10 tick): 关键基础设施 (Containers) ===
        if (Game.time % 10 === 0) {
            const currentRCL = room.controller.level;
            
            // 4. 自动建造 Container (在 Source 旁边)
            // 只有 RCL >= 2 才能造 Container
            if (currentRCL >= 2) {
                const sources = room.find(FIND_SOURCES);
                sources.forEach(source => {
                    // 检查 Source 周围 2 格内是否已有 Container 或工地
                    // 扩大搜索范围到 2，以匹配智能选址的结果
                    const nearby = source.pos.findInRange(FIND_STRUCTURES, 2, {
                        filter: s => s.structureType === STRUCTURE_CONTAINER
                    });
                    const nearbySites = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, {
                        filter: s => s.structureType === STRUCTURE_CONTAINER
                    });

                    if (nearby.length === 0 && nearbySites.length === 0) {
                        // 智能选择最佳位置
                        let bestPos = null;
                        let bestScore = -9999;

                        // 遍历 Source 周围 8 个格子
                        for (let x = -1; x <= 1; x++) {
                            for (let y = -1; y <= 1; y++) {
                                if (x === 0 && y === 0) continue;
                                
                                const posX = source.pos.x + x;
                                const posY = source.pos.y + y;
                                
                                // 检查地形
                                const terrain = room.getTerrain().get(posX, posY);
                                if (terrain === TERRAIN_MASK_WALL) continue;

                                const pos = new RoomPosition(posX, posY, room.name);
                                
                                // 评分标准：
                                // 1. 距离 Spawn 近 (权重高)
                                // 2. 是平原 (Plain) 而不是沼泽 (Swamp)
                                // 3. 周围空地多 (方便 Hauler 进出)
                                
                                let score = 0;
                                
                                // 距离分 (越近越好，取负数)
                                const path = pos.findPathTo(spawn, {ignoreCreeps: true, range: 1});
                                if (path.length === 0) continue; // 不可达
                                score -= path.length * 2;

                                // 地形分
                                if (terrain === 0) score += 5; // Plain
                                if (terrain === TERRAIN_MASK_SWAMP) score -= 5; // Swamp

                                // 可达性分 (周围有多少个非墙格子)
                                let openNeighbors = 0;
                                for (let dx = -1; dx <= 1; dx++) {
                                    for (let dy = -1; dy <= 1; dy++) {
                                        if (dx === 0 && dy === 0) continue;
                                        if (room.getTerrain().get(posX + dx, posY + dy) !== TERRAIN_MASK_WALL) {
                                            openNeighbors++;
                                        }
                                    }
                                }
                                score += openNeighbors;

                                if (score > bestScore) {
                                    bestScore = score;
                                    bestPos = pos;
                                }
                            }
                        }

                        if (bestPos) {
                            room.createConstructionSite(bestPos.x, bestPos.y, STRUCTURE_CONTAINER);
                        }
                    }
                });

                // 4.1 自动建造 Controller Container (用于升级)
                // 只有当 Controller 等级足够高时才需要 (比如 RCL 2)
                if (room.controller) {
                    const nearby = room.controller.pos.findInRange(FIND_STRUCTURES, 3, {
                        filter: s => s.structureType === STRUCTURE_CONTAINER
                    });
                    const nearbySites = room.controller.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
                        filter: s => s.structureType === STRUCTURE_CONTAINER
                    });

                    if (nearby.length === 0 && nearbySites.length === 0) {
                        // 找到通往 Controller 的路径，在距离 2-3 格的位置放 Container
                        // 这样 Upgrader 可以站在 Container 上或旁边升级
                        const path = spawn.pos.findPathTo(room.controller, {ignoreCreeps: true, range: 2});
                        if (path.length > 0) {
                            const containerPos = path[path.length - 1];
                            room.createConstructionSite(containerPos.x, containerPos.y, STRUCTURE_CONTAINER);
                        }
                    }
                }

                // 4.2 自动建造 General Container (Spawn 附近，作为中转站)
                // 在 Spawn 附近 Range 2 的位置
                const spawnNearby = spawn.pos.findInRange(FIND_STRUCTURES, 2, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER
                });
                const spawnNearbySites = spawn.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER
                });
                
                if (spawnNearby.length === 0 && spawnNearbySites.length === 0) {
                    // 简单的找个空地
                    const targetX = spawn.pos.x;
                    const targetY = spawn.pos.y + 2; // 下方两格
                    // 检查地形
                    const terrain = room.getTerrain().get(targetX, targetY);
                    if (terrain !== TERRAIN_MASK_WALL) {
                        room.createConstructionSite(targetX, targetY, STRUCTURE_CONTAINER);
                    }
                }

                // 4.3 清理多余的 Container 工地
                // 如果 Source 附近已经有 Container 了，就移除该 Source 附近所有的 Container 工地，防止重复建造
                sources.forEach(source => {
                    const nearbyContainers = source.pos.findInRange(FIND_STRUCTURES, 2, {
                        filter: s => s.structureType === STRUCTURE_CONTAINER
                    });
                    
                    if (nearbyContainers.length > 0) {
                        const nearbySites = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, {
                            filter: s => s.structureType === STRUCTURE_CONTAINER
                        });
                        
                        nearbySites.forEach(site => {
                            console.log(`清理多余的 Container 工地: ${site.pos}`);
                            site.remove();
                        });
                    }
                });
            }
        }

        // === 低频检查 (每 100 tick): 非关键设施 (Roads, Extensions, Towers) ===
        if (Game.time % 100 !== 0) return;

        // 1. 自动建造道路 (Spawn -> Sources)
        const sources = room.find(FIND_SOURCES);
        sources.forEach(source => {
            const path = spawn.pos.findPathTo(source, {ignoreCreeps: true});
            path.forEach(step => {
                room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
            });
        });

        // 2. 自动建造道路 (Spawn -> Controller)
        if (room.controller) {
            const path = spawn.pos.findPathTo(room.controller, {ignoreCreeps: true});
            path.forEach(step => {
                room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
            });
        }

        // 3. 自动建造 Extension (围绕 Spawn)
        // 简单的布局：以 Spawn 为中心的棋盘格或随机空地
        // 检查当前 RCL 允许的 Extension 数量
        const currentRCL = room.controller.level;
        const EXTENSION_LIMITS = {
            1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60
        };
        const maxExtensions = EXTENSION_LIMITS[currentRCL] || 0;
        
        // 统计现有的 Extension 和工地
        const extensions = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_EXTENSION
        });
        const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: s => s.structureType === STRUCTURE_EXTENSION
        });
        
        let currentCount = extensions.length + sites.length;

        if (currentCount < maxExtensions) {
            // 简单的螺旋查找空位
            for (let dist = 2; dist <= 6; dist++) {
                for (let x = spawn.pos.x - dist; x <= spawn.pos.x + dist; x++) {
                    for (let y = spawn.pos.y - dist; y <= spawn.pos.y + dist; y++) {
                        // 只在边框上检查 (Spiral)
                        if (x === spawn.pos.x - dist || x === spawn.pos.x + dist || 
                            y === spawn.pos.y - dist || y === spawn.pos.y + dist) {
                            
                            // 检查是否可以建造
                            // 1. 地形不能是墙
                            const terrain = room.getTerrain().get(x, y);
                            if (terrain === TERRAIN_MASK_WALL) continue;

                            // 2. 棋盘格布局 (x+y 是偶数才放，或者奇数，留出路的位置)
                            if ((x + y) % 2 !== 0) continue; 

                            // 3. 尝试建造
                            const result = room.createConstructionSite(x, y, STRUCTURE_EXTENSION);
                            if (result === OK) {
                                currentCount++;
                                if (currentCount >= maxExtensions) break; // 达到上限停止
                            }
                        }
                    }
                    if (currentCount >= maxExtensions) break;
                }
                if (currentCount >= maxExtensions) break;
            }
        }

        // 5. 自动建造 Tower (在 Spawn 附近)
        // RCL 3 解锁 Tower
        if (currentRCL >= 3) {
            const towers = room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_TOWER});
            const towerSites = room.find(FIND_MY_CONSTRUCTION_SITES, {filter: s => s.structureType === STRUCTURE_TOWER});
            
            if (towers.length + towerSites.length < 1) { // 暂时只造 1 个
                 // 在 Spawn 附近找个位置 (例如 x+2, y+2)
                 const targetX = spawn.pos.x + 2;
                 const targetY = spawn.pos.y + 2;
                 room.createConstructionSite(targetX, targetY, STRUCTURE_TOWER);
            }
        }
    }
};

module.exports = autoBuilder;
