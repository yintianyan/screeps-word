import { SquadData } from "../../types";

export class Squad {
  private data: SquadData;

  constructor(data: SquadData) {
    this.data = data;
  }

  public get id(): string {
    return this.data.id;
  }

  public get state(): string {
    return this.data.state;
  }

  public run(targetRoom: string): void {
    const creeps = this.getCreeps();
    
    // Check spawning status
    if (this.data.state === "spawning") {
      const allSpawned = this.data.creeps.every(name => Game.creeps[name] && !Game.creeps[name].spawning);
      if (allSpawned && creeps.length === this.data.creeps.length) {
        this.data.state = "rallying";
      } else {
        return; // Waiting for spawns
      }
    }

    if (creeps.length === 0) {
        // All dead
        return; 
    }

    switch (this.data.state) {
      case "rallying":
        this.runRallying(creeps);
        break;
      case "moving":
        this.runMoving(creeps, targetRoom);
        break;
      case "engaging":
        this.runEngaging(creeps, targetRoom);
        break;
    }
  }

  private getCreeps(): Creep[] {
    return this.data.creeps
      .map(name => Game.creeps[name])
      .filter(c => c !== undefined);
  }

  private runRallying(creeps: Creep[]) {
    // Simple rally: Group up at the first creep's position or a rally point
    // For now, just switch to moving if we have enough creeps
    // Assume duo for now
    if (creeps.length === this.data.creeps.length) {
        this.data.state = "moving";
    }
  }

  private runMoving(creeps: Creep[], targetRoom: string) {
    // Formation move logic
    let allInRoom = true;
    const leader = creeps[0]; // Leader is usually the first creep (Attacker)

    for (let i = 0; i < creeps.length; i++) {
      const creep = creeps[i];
      
      // Check if creep is in target room and not on exit
      if (creep.room.name !== targetRoom || creep.pos.x === 0 || creep.pos.x === 49 || creep.pos.y === 0 || creep.pos.y === 49) {
        allInRoom = false;
        
        if (i === 0) {
          // Leader logic
          creep.moveTo(new RoomPosition(25, 25, targetRoom), { range: 20 });
        } else {
          // Follower logic (Healer follows Leader)
          if (leader && !leader.spawning) {
             if (creep.pos.getRangeTo(leader) > 1) {
                 creep.moveTo(leader);
             } else {
                 // Move with leader (piggyback move logic if needed, or just follow)
                 // If leader moves, follower should move to leader's previous pos?
                 // For now, simple moveTo leader is fine, but range 0? No, range 1.
                 creep.moveTo(leader); 
             }
          } else {
             // Fallback if leader lost
             creep.moveTo(new RoomPosition(25, 25, targetRoom), { range: 20 });
          }
        }
      }
    }

    if (allInRoom) {
      this.data.state = "engaging";
    }
  }

  private runEngaging(creeps: Creep[], targetRoom: string) {
    // Simple Duo Logic:
    // Attacker picks target, Healer heals Attacker (or self)
    // Attacker should kite if low health?
    
    const attacker = creeps.find(c => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0);
    const healer = creeps.find(c => c.getActiveBodyparts(HEAL) > 0);

    if (attacker) {
        if (attacker.room.name !== targetRoom) {
            attacker.moveTo(new RoomPosition(25, 25, targetRoom));
        } else {
            const hostiles = attacker.room.find(FIND_HOSTILE_CREEPS);
            const towers = attacker.room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
            const spawns = attacker.room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN });
            const extensions = attacker.room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION });
            
            // Target Priority: Tower > Spawn > Creep > Extension > Other
            let target: Creep | Structure | null = null;
            if (towers.length > 0) target = attacker.pos.findClosestByRange(towers);
            else if (spawns.length > 0) target = attacker.pos.findClosestByRange(spawns);
            else if (hostiles.length > 0) target = attacker.pos.findClosestByRange(hostiles);
            else if (extensions.length > 0) target = attacker.pos.findClosestByRange(extensions);
            else target = attacker.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType !== STRUCTURE_CONTROLLER });

            if (target) {
                // Kiting Logic
                const range = attacker.pos.getRangeTo(target);
                const isRanged = attacker.getActiveBodyparts(RANGED_ATTACK) > 0;
                const lowHealth = attacker.hits < attacker.hitsMax * 0.5;

                if (lowHealth) {
                    // Retreat to healer or exit?
                    // For now, just flee from target
                    const fleePath = PathFinder.search(attacker.pos, { pos: target.pos, range: 5 }, { flee: true });
                    if (fleePath.path.length > 0) attacker.moveByPath(fleePath.path);
                } else {
                    if (isRanged) {
                        if (range > 3) attacker.moveTo(target);
                        else if (range < 3) {
                             // Kiting: back off to range 3
                             const fleePath = PathFinder.search(attacker.pos, { pos: target.pos, range: 3 }, { flee: true });
                             if (fleePath.path.length > 0) attacker.moveByPath(fleePath.path);
                        }
                        attacker.rangedAttack(target);
                    } else {
                        if (attacker.attack(target) === ERR_NOT_IN_RANGE) {
                            attacker.moveTo(target);
                        }
                    }
                }
            }
        }
    }

    if (healer) {
        // Healer Logic
        // Priority: Heal self (if low) > Heal attacker > Follow attacker
        if (healer.hits < healer.hitsMax) {
            healer.heal(healer);
        } else if (attacker && attacker.hits < attacker.hitsMax) {
            if (healer.heal(attacker) === ERR_NOT_IN_RANGE) {
                healer.moveTo(attacker);
            }
        } else if (attacker) {
            // Keep close to attacker
            if (healer.pos.getRangeTo(attacker) > 1) {
                healer.moveTo(attacker);
            }
            // Pre-heal if engaging? 
            // Only if in range
            if (healer.pos.isNearTo(attacker)) healer.heal(attacker);
        }
    }
  }
}
