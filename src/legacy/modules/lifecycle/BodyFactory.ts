// Factory Pattern: Encapsulates body generation logic

export default class BodyFactory {
  static generate(role: string, energyAvailable: number, energyCapacity: number): BodyPartConstant[] {
    // 1. Determine Budget
    // Use available energy for emergency (low population), capacity for optimal (high population)
    // Here we assume the caller has decided the budget strategy.
    // But usually, we want:
    // - If population is critically low (0 harvesters), use available energy.
    // - Otherwise, use capacity.
    
    // Let's make it simple: We take `energyAvailable` if forced, or `energyCapacity` normally.
    // The caller (Lifecycle) should pass the appropriate value.
    
    // [FIX] Always ensure budget is at least minimal viable (300 for spawn + extension) or current available
    // For critical roles, we MUST fit in available energy.
    // For upgrading roles, we can aim higher but clamp to available if we need to spawn NOW?
    // Actually, Lifecycle logic says:
    // "if (!body || body.length === 0) ... Can't spawn yet (e.g. waiting for energy)"
    // So if we return a body costing 800 but have 300, Lifecycle will wait.
    // This causes DEADLOCK if we have 0 creeps and 300 energy but ask for 800 body.

    let budget = energyCapacity;
    
    // Critical roles MUST use current energy if we are recovering (low energy)
    // But how do we know if we are recovering?
    // Simple heuristic: If available < capacity * 0.5, we might be in trouble, so scale down?
    // Better: If available < 300 (Spawn capacity), we are definitely in trouble.
    // BUT, Lifecycle passes `energyAvailable` as the second arg, and `energyCapacity` as third.
    // If we want to force spawn (e.g. harvester), we should use `energyAvailable`.
    
    if (role === 'harvester' || role === 'hauler') {
        // Dynamic scaling: If energy is low, spawn what we can
        if (energyAvailable < energyCapacity * 0.8) {
             budget = Math.max(300, energyAvailable);
        }
    }

    let body: BodyPartConstant[] = [];

    // 2. Role Specific Logic
    switch (role) {
      case "harvester":
        // Harvester critical check: If budget < 300, try 200
        body = this.generateHarvester(Math.max(200, Math.min(budget, energyAvailable)));
        break;
      case "hauler":
        body = this.generateHauler(Math.min(budget, energyAvailable));
        break;
      case "upgrader":
        // [FIX] Deadlock Prevention
        // If we have plenty of energy (> 80%) but not 100% capacity,
        // and we are requesting a max-tier creep, we might get stuck waiting for that last 50 energy.
        // So, if available energy is high, clamp budget to available.
        // This ensures we spawn a 2250 cost creep immediately instead of waiting forever for 2300.
        if (energyAvailable > energyCapacity * 0.8) {
            budget = Math.min(budget, energyAvailable);
        }
        body = this.generateWorker(budget, "upgrader");
        break;
      case "builder":
        body = this.generateWorker(budget, "builder");
        break;
      case "scout":
        body = [MOVE];
        break;
      case "remote_harvester":
        body = this.generateRemoteHarvester(budget);
        break;
      case "remote_hauler":
        body = this.generateHauler(budget); // Same as local for now
        break;
      case "remote_reserver":
        body = this.generateReserver(budget);
        break;
      case "remote_defender":
        body = this.generateDefender(budget);
        break;
      case "sk_guard":
        body = this.generateSKGuard(budget);
        break;
      case "sk_miner":
        body = this.generateSKMiner(budget);
        break;
      case "sk_hauler":
        body = this.generateHauler(budget); // Same as hauler for now, maybe add TOUGH later
        break;
      default:
        body = [WORK, CARRY, MOVE]; // Fallback
        break;
    }

    // 3. Validation & Sorting
    if (this.calculateCost(body) > energyAvailable) {
        // Fallback to smaller body if generated one is too expensive (edge case)
        // This shouldn't happen if logic is correct, but safe to clamp.
        // Actually, let's return null if we can't afford minimum.
        return this.generateFallback(role, energyAvailable);
    }

    return this.sortBody(body);
  }

  private static generateHarvester(budget: number): BodyPartConstant[] {
    if (budget >= 700) return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]; // 5W 1C 3M (700)
    if (budget >= 550) return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE]; // 4W 1C 2M (550)
    if (budget >= 300) return [WORK, WORK, CARRY, MOVE]; // 2W 1C 1M (300)
    return [WORK, CARRY, MOVE]; // Min (200)
  }

  private static generateHauler(budget: number): BodyPartConstant[] {
    // Hauler needs CARRY + MOVE
    // Ratio:
    // Road: 2 CARRY : 1 MOVE (Load = 100, Move cost = 1. Loaded Fatigue = 2*2 = 4. Move Power = 2. Speed = 4/2 = 2 ticks/tile?)
    // Wait. 1 MOVE generates 2 fatigue. Plain cost 2, Road cost 1.
    // Full load: CARRY weight = 1 per part? No, weight is capacity. 50 capacity per CARRY.
    // Actually weight logic: Each body part (except MOVE) generates fatigue when moving.
    // 1 MOVE reduces fatigue by 2 per tick.
    // On Plain: Cost is 2 per part.
    // On Road: Cost is 1 per part.
    
    // Config: 2:1 ratio (CARRY:MOVE)
    // 2 CARRY (100 cap) + 1 MOVE. Total parts = 3.
    // Weight = 2 (CARRY) + 1 (MOVE)? No, CARRY generates fatigue only when full?
    // Screeps logic: Fatigue = sum(parts except MOVE) * terrainFactor.
    // On Road (factor 1): 2 CARRY * 1 = 2 fatigue. 1 MOVE removes 2. Speed = 1 tick/tile. PERFECT on roads.
    // On Plain (factor 2): 2 CARRY * 2 = 4 fatigue. 1 MOVE removes 2. Speed = 2 ticks/tile. SLOW.
    
    // If we assume ROADS everywhere (RCL 3+), 2:1 is best.
    // If we assume Plains (RCL 1-2), 1:1 is best.
    
    // For now, let's stick to 1:1 for reliability, or mix.
    // 150 energy -> [CARRY, CARRY, MOVE] (Road optimized) or [CARRY, MOVE] (Plain optimized)?
    // Let's go with 1:1 for small, 2:1 for big?
    
    // Budget 300: 3x [CARRY, MOVE] = 150 Capacity. Speed 1 on Plain.
    // Budget 1000: 6x [CARRY, CARRY, MOVE] + leftover?
    // Let's just use a pattern generator.
    
    // Optimization: As capacity grows, use larger pattern.
    // Cap at 50 parts.
    
    let parts: BodyPartConstant[] = [];
    let cost = 0;
    
    // Pattern: CARRY, CARRY, MOVE (150 cost)
    // This is road-optimized.
    const pattern = [CARRY, CARRY, MOVE];
    const patternCost = 150;
    
    // If budget is small (< 300), use 1:1 [CARRY, MOVE]
    if (budget < 300) {
        while (cost + 100 <= budget && parts.length + 2 <= 50) {
            parts.push(CARRY, MOVE);
            cost += 100;
        }
    } else {
        while (cost + patternCost <= budget && parts.length + 3 <= 50) {
            parts.push(CARRY, CARRY, MOVE);
            cost += patternCost;
        }
    }
    
    return parts;
  }

  private static generateWorker(budget: number, role: string): BodyPartConstant[] {
    // Standard Worker: Balanced WORK/CARRY/MOVE
    // Base: [WORK, CARRY, MOVE] = 200
    // Grow: [WORK, CARRY, MOVE] = 200 (Balanced) or [WORK, MOVE] (Fast Work)
    
    // Upgrader: Focus on WORK
    if (role === "upgrader") {
        if (budget >= 1000) return [WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE]; // 5W 3C 5M
        if (budget >= 800) return [WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE]; // 4W 2C 3M
        if (budget >= 550) return [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE]; // 3W 2C 3M
        if (budget >= 300) return [WORK, WORK, CARRY, MOVE];
        return [WORK, CARRY, MOVE];
    }
    
    // Builder: Balanced
    const maxSets = Math.min(Math.floor(budget / 200), 16); // Max 48 parts
    const sets = Math.max(1, maxSets);
    const body: BodyPartConstant[] = [];
    for (let i = 0; i < sets; i++) {
        body.push(WORK, CARRY, MOVE);
    }
    return body;
  }

  private static generateRemoteHarvester(budget: number): BodyPartConstant[] {
      // Needs to move on roads (1 MOVE per 2 WORK/CARRY) or plain (1:1)
      // Usually 5 WORK + 1 CARRY + 3 MOVE (Road) or 6 MOVE (Plain)
      // Let's assume roads.
      if (budget >= 800) return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]; // 5W 1C 6M (Safety)
      if (budget >= 650) return [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE]; // 5W 3M (Road)
      return [WORK, WORK, WORK, MOVE, MOVE, MOVE]; // 3W 3M
  }

  private static generateReserver(budget: number): BodyPartConstant[] {
      // CLAIM + MOVE = 600 + 50 = 650
      if (budget >= 1300) return [CLAIM, CLAIM, MOVE, MOVE];
      if (budget >= 650) return [CLAIM, MOVE];
      return [];
  }

  private static generateDefender(budget: number): BodyPartConstant[] {
      // TOUGH + ATTACK + MOVE
      // Simple melee: ATTACK + MOVE = 80 + 50 = 130
      const maxSets = Math.floor(budget / 130);
      const sets = Math.min(maxSets, 25);
      const body: BodyPartConstant[] = [];
      for(let i=0; i<sets; i++) {
          body.push(ATTACK, MOVE);
      }
      return body;
  }

  private static generateSKGuard(budget: number): BodyPartConstant[] {
      // Goal: Tank SK ranged damage (approx 60/tick?) and kill it fast.
      // 25 MOVE, 20 ATTACK, 5 HEAL = 50 parts. Cost: 1250+1600+1250 = 4100.
      // RCL 7 (5600) can afford it.
      // RCL 6 (2300) is tight.
      
      if (budget >= 4100) {
          return [
              MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
              MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
              MOVE, MOVE, MOVE, MOVE, MOVE,
              ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
              ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
              HEAL, HEAL, HEAL, HEAL, HEAL
          ];
      }
      
      if (budget >= 2300) {
          // RCL 6 Budget: ~2300.
          // 12 ATTACK (960) + 13 MOVE (650) + 2 HEAL (500) = 2110.
          // 120 damage/tick. SK has 4000 hits?
          // 4000 / 360 (12*30) = 11 hits? No, damage is 30 per attack part. 12*30 = 360.
          // 4000 / 360 = ~12 ticks to kill.
          // In 12 ticks, SK deals ~60 * 12 = 720 damage.
          // 2 HEAL heals 24/tick. 12 ticks = 288 healed.
          // Net damage taken = 720 - 288 = 432.
          // Creep has 27 parts * 100 = 2700 hits.
          // It survives easily.
          // Then heals up.
          
          return [
              MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
              ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
              HEAL, HEAL
          ];
      }
      
      return []; // Can't spawn effective guard
  }

  private static generateSKMiner(budget: number): BodyPartConstant[] {
      // 7 WORK (700) + 1 CARRY (50) + 4 MOVE (200) = 950.
      // Fits RCL 5+.
      if (budget >= 950) {
          return [WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE, MOVE];
      }
      return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]; // 5 WORK fallback
  }

  private static generateFallback(role: string, _budget: number): BodyPartConstant[] {
      if (role === 'hauler') return [CARRY, MOVE];
      return [WORK, CARRY, MOVE];
  }

  private static calculateCost(body: BodyPartConstant[]): number {
    return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
  }

  private static sortBody(body: BodyPartConstant[]): BodyPartConstant[] {
    const sortOrder: Record<string, number> = {
      [TOUGH]: 0,
      [WORK]: 1,
      [CARRY]: 2,
      [ATTACK]: 3,
      [RANGED_ATTACK]: 4,
      [HEAL]: 5,
      [CLAIM]: 6,
      [MOVE]: 7,
    };
    return body.sort((a, b) => sortOrder[a] - sortOrder[b]);
  }
}
