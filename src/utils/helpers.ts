module.exports.loop = function() {
    if (Game.spawns['Spawn1']) {
        const room = Game.spawns['Spawn1'].room;
        const t = room.getTerrain().get(9, 31);
        console.log('Terrain at 9,31:', t);
        if (t === TERRAIN_MASK_WALL) console.log('It is a WALL');
    }
}
