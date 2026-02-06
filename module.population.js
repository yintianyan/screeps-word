const populationModule = {
    /** @param {Room} room **/
    calculateTargets: function(room) {
        const targets = {
            harvester: 0,
            upgrader: 0,
            builder: 0,
            hauler: 0
        };

        // 1. Harvester: 
        // 基础数量 = Source 数量
        // 如果没有 Container/Link，且没有 Hauler，需要更多 Harvester 来弥补运输时间
        const sources = room.find(FIND_SOURCES);
        const sourceCount = sources.length;
        const haulers = room.find(FIND_MY_CREEPS, {filter: c => c.memory.role === 'hauler'});
        
        if (haulers.length > 0) {
            // 有搬运工，Harvester 只需要负责挖，数量 = Source 数量 + 1 (冗余)
            targets.harvester = sourceCount + 1;
        } else {
            // 没搬运工，Harvester 负责挖+运，数量 = Source 数量 * 2
            targets.harvester = sourceCount * 2;
        }

        // 2. Hauler:
        // 根据 Harvester 数量和掉落的能量来定
        // 每 2 个 Harvester 配 1 个 Hauler，或者如果有大量掉落能量，增加 Hauler
        const droppedEnergy = room.find(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY
        });
        const totalDropped = droppedEnergy.reduce((sum, res) => sum + res.amount, 0);
        
        // 基础 Hauler
        targets.hauler = Math.floor(targets.harvester / 2);
        // 如果掉落能量很多 (>1000)，增加 Hauler
        if (totalDropped > 1000) {
            targets.hauler += 2;
        }
        // 至少 1 个 Hauler (如果已有 Harvester)
        if (targets.harvester > 0 && targets.hauler < 1) {
            targets.hauler = 1;
        }

        // 3. Builder:
        // 取决于是否有工地
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        if (sites.length > 0) {
            // 工地越多，Builder 越多，上限 3
            targets.builder = Math.min(3, 1 + Math.floor(sites.length / 5));
        } else {
            targets.builder = 0;
        }

        // 4. Upgrader:
        // 只要有闲置能量就升级
        // 如果能量很充足 (>80% Capacity)，多来点 Upgrader
        const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
        if (energyRatio > 0.8) {
            targets.upgrader = 3;
        } else if (energyRatio > 0.3) {
            targets.upgrader = 2;
        } else {
            targets.upgrader = 1; // 至少保持 1 个升级防止掉级
        }

        return targets;
    }
};

module.exports = populationModule;
