const monitorModule = {
    run: function(room) {
        if (!room) return;

        // 1. 统计各角色数量和状态
        const creeps = room.find(FIND_MY_CREEPS);
        const stats = {
            harvester: { count: 0, idle: 0, total: 0 },
            upgrader: { count: 0, idle: 0, total: 0 },
            builder: { count: 0, idle: 0, total: 0 },
            hauler: { count: 0, idle: 0, total: 0 }
        };

        // 统计总能量
        const totalEnergy = room.energyAvailable;
        const capacity = room.energyCapacityAvailable;

        creeps.forEach(creep => {
            const role = creep.memory.role;
            if (stats[role]) {
                stats[role].count++;
                stats[role].total++;
                
                // 检查是否闲置 (store empty && waiting)
                // 或者只是发呆
                // 这里我们假设如果它在 "wait" 状态，就算 idle
                // 我们之前在 role 代码里加了 creep.say("🙏 wait")
                // 但无法直接读取 say 的内容，我们只能通过行为推断
                // 简单起见，如果它 store 为空且没有 fatigue，也没有在移动，就算 idle
                if (creep.store.getUsedCapacity() === 0 && !creep.fatigue) {
                    // stats[role].idle++; // 暂时不计，容易误判
                }
            }
        });

        // 2. 绘制可视化面板
        const visual = new RoomVisual(room.name);
        const x = 1;
        const y = 1;

        // 标题
        visual.text(`📊 Colony Monitor [${room.name}]`, x, y, { align: 'left', font: 0.8, color: '#ffffff' });
        visual.text(`Energy: ${totalEnergy} / ${capacity}`, x, y + 1, { align: 'left', font: 0.6, color: '#00ff00' });
        
        // 控制器等级
        if (room.controller) {
            const progress = Math.floor((room.controller.progress / room.controller.progressTotal) * 100);
            visual.text(`RCL: ${room.controller.level} (${progress}%)`, x, y + 1.8, { align: 'left', font: 0.6, color: '#aaaaaa' });
            visual.text(`Downgrade: ${room.controller.ticksToDowngrade}`, x, y + 2.5, { align: 'left', font: 0.5, color: room.controller.ticksToDowngrade < 4000 ? '#ff0000' : '#aaaaaa' });
        }

        // 角色列表
        let row = y + 3.5;
        const roles = ['harvester', 'hauler', 'upgrader', 'builder'];
        
        roles.forEach(role => {
            const info = stats[role];
            let color = '#ffffff';
            if (role === 'harvester') color = '#ffaa00';
            if (role === 'hauler') color = '#00ffff';
            if (role === 'upgrader') color = '#ff00ff';
            if (role === 'builder') color = '#ffff00';

            visual.text(`${role.toUpperCase()}:`, x, row, { align: 'left', font: 0.6, color: color });
            visual.text(`${info.count}`, x + 4, row, { align: 'left', font: 0.6, color: '#ffffff' });
            row += 0.8;
        });

        // 3. 异常警告
        // 检查是否有 Role 缺失
        if (stats.harvester.count === 0) {
            visual.text(`⚠️ NO HARVESTERS!`, x, row + 1, { align: 'left', color: '#ff0000', font: 0.7 });
        }
        if (stats.hauler.count === 0 && stats.harvester.count > 0) {
            visual.text(`⚠️ NO HAULERS!`, x, row + 2, { align: 'left', color: '#ff0000', font: 0.7 });
        }

        // 检查长时间等待的 Creep (需要配合 Memory)
        creeps.forEach(creep => {
            if (creep.store.getUsedCapacity() === 0) {
                // 如果空背包，记录等待时间
                if (!creep.memory.idleTicks) creep.memory.idleTicks = 0;
                creep.memory.idleTicks++;
                
                // 如果等待超过 50 tick (且不是 harvester，harvester 挖矿也可能空背包如果直接转存)
                if (creep.memory.idleTicks > 50 && creep.memory.role !== 'harvester') {
                    visual.text(`⏳`, creep.pos.x, creep.pos.y - 0.5, { color: '#ff0000', font: 0.5 });
                }
            } else {
                creep.memory.idleTicks = 0;
            }
        });
    }
};

module.exports = monitorModule;