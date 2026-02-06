const autoBuilder = {
    run: function(room) {
        // 每 100 tick 运行一次，节省 CPU
        if (Game.time % 100 !== 0) return;

        const spawn = room.find(FIND_MY_SPAWNS)[0];
        if (!spawn) return;

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
                                if (currentCount >= maxExtensions) return; // 达到上限停止
                            }
                        }
                    }
                }
            }
        }
    }
};

module.exports = autoBuilder;
