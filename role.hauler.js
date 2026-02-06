const roleHauler = {
    /** @param {Creep} creep **/
    run: function(creep) {
        // 状态切换
        if(creep.memory.hauling && creep.store[RESOURCE_ENERGY] == 0) {
            creep.memory.hauling = false;
            creep.say('🔄 collect');
        }
        if(!creep.memory.hauling && creep.store.getFreeCapacity() == 0) {
            creep.memory.hauling = true;
            creep.say('🚚 haul');
        }

        if(creep.memory.hauling) {
            // 1. 优先填充 Spawn 和 Extension
            let targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_EXTENSION ||
                            structure.structureType == STRUCTURE_SPAWN) &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                }
            });

            // 2. 如果都满了，填充 Tower (如果有)
            if (targets.length === 0) {
                targets = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_TOWER &&
                               structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });
            }

            // 3. 还没有，就放 Storage (如果有)
            if (targets.length === 0) {
                targets = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_STORAGE &&
                               structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });
            }

            if(targets.length > 0) {
                // 找最近的一个
                const closest = creep.pos.findClosestByPath(targets);
                if(creep.transfer(closest, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(closest, {visualizePathStyle: {stroke: '#ffffff'}});
                }
            } else {
                // 如果所有地方都满了，可以选择去升级控制器，或者在 Spawn 附近待命
                 if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                     creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#ffffff'}});
                }
            }
        }
        else {
            // 寻找能量来源：掉落的资源 > 墓碑 > 废墟
            
            // 1. 掉落的资源
            const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
                filter: (resource) => resource.resourceType == RESOURCE_ENERGY
            });
            
            if (droppedResources.length > 0) {
                const target = creep.pos.findClosestByPath(droppedResources);
                if(creep.pickup(target) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, {visualizePathStyle: {stroke: '#ffaa00'}});
                }
                return;
            }

            // 2. 墓碑 (死掉的 creep)
            const tombstones = creep.room.find(FIND_TOMBSTONES, {
                filter: (tombstone) => tombstone.store[RESOURCE_ENERGY] > 0
            });
            if (tombstones.length > 0) {
                const target = creep.pos.findClosestByPath(tombstones);
                if(creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, {visualizePathStyle: {stroke: '#ffaa00'}});
                }
                return;
            }

            // 3. 如果有 Container (容器)，也可以从 Container 取 (以后扩展)
            // const containers = ...
            
            // 如果实在没事干，可以尝试去 source 旁边捡漏（或者这里可以扩展为去 Container 取货）
             const sources = creep.room.find(FIND_SOURCES);
             const source = sources[0]; // 简单去第一个 source 附近碰运气
             if (!creep.pos.inRangeTo(source, 3)) {
                 creep.moveTo(source);
             }
        }
    }
};

module.exports = roleHauler;
