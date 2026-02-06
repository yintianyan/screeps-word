const priorityModule = {
    /**
     * 获取建筑类型的优先级
     * 数值越大优先级越高
     */
    getPriority: function(structureType) {
        switch(structureType) {
            case STRUCTURE_SPAWN: return 100; // 重生点最重要
            case STRUCTURE_TOWER: return 90;  // 防御塔也很重要
            case STRUCTURE_CONTAINER: return 80;
            case STRUCTURE_EXTENSION: return 70;
            case STRUCTURE_STORAGE: return 60;
            case STRUCTURE_LINK: return 50;
            case STRUCTURE_EXTRACTOR: return 40;
            case STRUCTURE_LAB: return 40;
            case STRUCTURE_TERMINAL: return 40;
            case STRUCTURE_FACTORY: return 40;
            case STRUCTURE_OBSERVER: return 40;
            case STRUCTURE_POWER_SPAWN: return 40;
            case STRUCTURE_NUKER: return 40;
            case STRUCTURE_ROAD: return 10; // 路最后修
            case STRUCTURE_RAMPART: return 5;
            case STRUCTURE_WALL: return 1;
            default: return 5;
        }
    },

    /**
     * 比较两个建筑工地的优先级
     * 用于 sort 函数: sites.sort(priorityModule.compare)
     */
    compare: function(a, b) {
        const priorityA = priorityModule.getPriority(a.structureType);
        const priorityB = priorityModule.getPriority(b.structureType);
        
        if (priorityA !== priorityB) {
            return priorityB - priorityA; // 降序排列
        }
        
        // 如果优先级相同，比较完成度 (剩下的工程量越小越优先)
        const progressA = a.progress / a.progressTotal;
        const progressB = b.progress / b.progressTotal;
        return progressB - progressA;
    },

    /**
     * 获取最高优先级的工地
     * @param {Array<ConstructionSite>} sites 
     * @param {RoomPosition} creepPos (可选) 如果提供，同一优先级下选择最近的
     */
    getBestTarget: function(sites, creepPos) {
        if (!sites || sites.length === 0) return null;
        
        // 1. 按优先级分组
        // 既然我们只是要找最好的，可以遍历一遍找到最高优先级
        let maxPriority = -1;
        let bestSites = [];

        sites.forEach(site => {
            const p = this.getPriority(site.structureType);
            if (p > maxPriority) {
                maxPriority = p;
                bestSites = [site];
            } else if (p === maxPriority) {
                bestSites.push(site);
            }
        });

        if (bestSites.length === 0) return null;

        // 2. 在同优先级下，优先 "集中火力"
        // 如果有已经开工的 (progress > 0)，优先修进度最快的，忽略距离
        // 这样可以避免大家雨露均沾，而是合力先修完一个
        const inProgress = bestSites.filter(s => s.progress > 0);
        if (inProgress.length > 0) {
            inProgress.sort((a, b) => (b.progress / b.progressTotal) - (a.progress / a.progressTotal));
            return inProgress[0];
        }

        // 3. 如果都没开工，再找最近的，避免舍近求远
        if (creepPos) {
            return creepPos.findClosestByPath(bestSites);
        }

        // 4. 如果没有位置信息，随便返回一个 (或者按 id 排序保证确定性)
        return bestSites[0];
    }
};

module.exports = priorityModule;