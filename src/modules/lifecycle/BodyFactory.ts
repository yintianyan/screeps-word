// Factory Pattern: Encapsulates body generation logic

export default class BodyFactory {
  static generate(role: string, energyAvailable: number, _energyCapacity: number): BodyPartConstant[] {
    // 1. Determine Budget
    // Use available energy for emergency (low population), capacity for optimal (high population)
    // Here we assume the caller has decided the budget strategy.
    // But usually, we want:
    // - If population is critically low (0 harvesters), use available energy.
    // - Otherwise, use capacity.
    
    // Let's make it simple: We take `energyAvailable` if forced, or `energyCapacity` normally.
    // The caller (Lifecycle) should pass the appropriate value.
    
    let body: BodyPartConstant[] = [];

    // 2. Role Specific Logic
    switch (role) {
      case "harvester":
        body = this.generateHarvester(energyAvailable);
        break;
      case "hauler":
        body = this.generateHauler(energyAvailable);
        break;
      case "upgrader":
        body = this.generateWorker(energyAvailable, "upgrader");
        break;
      case "builder":
        body = this.generateWorker(energyAvailable, "builder");
        break;
      case "scout":
        body = [MOVE];
        break;
      case "remote_harvester":
        body = this.generateRemoteHarvester(energyAvailable);
        break;
      case "remote_hauler":
        body = this.generateHauler(energyAvailable); // Same as local for now
        break;
      case "remote_reserver":
        body = this.generateReserver(energyAvailable);
        break;
      case "remote_defender":
        body = this.generateDefender(energyAvailable);
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
    // 1 CARRY + 1 MOVE = 100 Cost.
    // Max 50 parts = 25 sets = 2500 Energy.
    const maxSets = Math.min(Math.floor(budget / 100), 25);
    const sets = Math.max(1, maxSets);
    const body: BodyPartConstant[] = [];
    for (let i = 0; i < sets; i++) {
      body.push(CARRY, MOVE);
    }
    return body;
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
