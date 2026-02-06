const moveModule = {
    /**
     * 智能移动逻辑
     * 默认忽略 Creep 碰撞（走 Road），卡住时才考虑 Creep（绕路）
     * 这样可以避免 Creep 绕路后一直走平原不回来的问题
     * @param {Creep} creep 
     * @param {RoomPosition|Structure} target 
     * @param {object} opts 
     */
    smartMove: function(creep, target, opts = {}) {
        // 初始化记忆
        if (!creep.memory._move) creep.memory._move = {};
        
        // 检查是否卡住
        // 只有当这一 tick 和上一 tick 的位置完全一样，且 fatigue (疲劳) 为 0 时，才算真的卡住（而不是因为还没走完或者疲劳）
        if (creep.pos.x === creep.memory._move.lastX && 
            creep.pos.y === creep.memory._move.lastY && 
            creep.fatigue === 0) {
            creep.memory._move.stuckCount = (creep.memory._move.stuckCount || 0) + 1;
        } else {
            creep.memory._move.stuckCount = 0;
            creep.memory._move.lastX = creep.pos.x;
            creep.memory._move.lastY = creep.pos.y;
        }

        // 默认忽略 creeps (这样路径会优先选择 Road)
        let ignore = true;
        
        // 如果连续卡住 2 tick，说明撞车了，临时开启避让模式
        if (creep.memory._move.stuckCount >= 2) {
            ignore = false;
        }

        // 合并用户自定义 opts
        const moveOpts = Object.assign({
            visualizePathStyle: { stroke: ignore ? '#ffffff' : '#ff0000', lineStyle: 'dashed' },
            ignoreCreeps: ignore,
            reusePath: ignore ? 10 : 5 // 正常走缓存久一点，绕路时缓存短一点以便尽快回正轨
        }, opts);

        creep.moveTo(target, moveOpts);
    }
};

module.exports = moveModule;
