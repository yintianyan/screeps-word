import Role from "../../ai/role";
import Brain from "../../ai/decision";

export default class Hauler extends Role {
  constructor(creep: Creep) {
    super(creep);
  }

  checkState() {
    if (this.memory.working && this.creep.store[RESOURCE_ENERGY] === 0) {
      this.memory.working = false; // Go to Collect
      this.creep.say("🔄 collect");
    }
    // [FIX] Don't wait for 100% full. If we have > 90% or plenty of energy (e.g. > 400), go deliver.
    // Especially if capacity is large.
    if (!this.memory.working) {
      const free = this.creep.store.getFreeCapacity();
      const used = this.creep.store.getUsedCapacity();
      // If full or mostly full (free < 50 which is 1 part)
      // Or if we have a decent load (> 400) and no nearby pile?
      if (free === 0 || (free < 50 && used > 0)) {
        this.memory.working = true;
        this.creep.say("🚚 deliver");
      }
    }

    // Opportunistic Pickup: If moving to collect/deliver and see dropped energy on/near position
    const dropped = this.creep.pos.lookFor(LOOK_RESOURCES)[0];
    if (dropped && dropped.resourceType === RESOURCE_ENERGY) {
      this.creep.pickup(dropped);
    }
    const tombstone = this.creep.pos.lookFor(LOOK_TOMBSTONES)[0];
    if (tombstone && tombstone.store[RESOURCE_ENERGY] > 0) {
      this.creep.withdraw(tombstone, RESOURCE_ENERGY);
    }
    const ruin = this.creep.pos.lookFor(LOOK_RUINS)[0];
    if (ruin && ruin.store[RESOURCE_ENERGY] > 0) {
      this.creep.withdraw(ruin, RESOURCE_ENERGY);
    }
  }

  // Helper for opportunistic transfer
  private checkOpportunisticTransfer() {
    // Only if we have energy
    if (this.creep.store[RESOURCE_ENERGY] > 0) {
      const neighbors = this.creep.pos.findInRange(FIND_MY_CREEPS, 1);
      for (const neighbor of neighbors) {
        if (neighbor.id === this.creep.id) continue;
        // Only feed Upgraders/Builders who need energy
        if (
          (neighbor.memory.role === "upgrader" ||
            neighbor.memory.role === "builder") &&
          neighbor.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        ) {
          this.creep.transfer(neighbor, RESOURCE_ENERGY);
          this.creep.say("🤝 pass");
          break; // One transfer per tick
        }
      }
    }
  }

  // Override move to include opportunistic transfer during task execution
  move(target: RoomPosition | { pos: RoomPosition } | Structure, opts = {}) {
    this.checkOpportunisticTransfer();
    return super.move(target, opts);
  }

  executeState() {
    if (this.memory.working) {
      // === DELIVER STATE ===
      const energyLevel = this.creep.room.memory.energyLevel || "LOW";

      // Candidate List
      interface Candidate {
        target: Structure | Creep;
        priority: number;
        type: string;
        pos: RoomPosition;
        visual: { stroke: string; opacity?: number; strokeWidth?: number };
      }
      const candidates: Candidate[] = [];

      // 1. Brain Task (Spawn/Extension)
      // Usually High Priority (200)
      const brain = new Brain(this.creep.room);
      brain.analyze();
      brain.generateTasks();
      const task = brain.getBestTask(this.creep);

      // [Optimization] Brain task integration
      // Brain logic might return "transfer_spawn" or others.
      // If we are in CRITICAL mode, we MUST prioritize Spawn/Ext.
      // If Brain returns something else (e.g. build), we might ignore it if CRITICAL.
      
      if (task && task.type === "transfer_spawn") {
        const target = Game.getObjectById(task.targetId as Id<Structure>);
        if (target) {
          candidates.push({
            target: target,
            priority: 200,
            type: "spawn_ext",
            pos: target.pos,
            visual: { stroke: "#ffffff" },
          });
        }
      }

      // If CRITICAL, we only care about Spawn/Extensions.
      // But if Brain didn't find them (maybe due to logic), we scan manually to be safe.
      if (energyLevel === "CRITICAL" || candidates.length === 0) {
        const extensions = this.creep.room.find(FIND_MY_STRUCTURES, {
          filter: (s) =>
            (s.structureType === STRUCTURE_SPAWN ||
              s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        extensions.forEach((ext) => {
          // Avoid duplicates if Brain already found it
          if (!candidates.find((c) => c.target.id === ext.id)) {
            candidates.push({
              target: ext,
              priority: 200,
              type: "spawn_ext",
              pos: ext.pos,
              visual: { stroke: "#ffffff" },
            });
          }
        });
        
      }

      // 1.5 Source Links - Priority 190 (High Priority to clear containers)
      const sourceLinks = this.creep.room.find(FIND_MY_STRUCTURES, {
          filter: (s) => s.structureType === STRUCTURE_LINK && 
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                         this.creep.room.find(FIND_SOURCES).some(src => s.pos.inRangeTo(src, 2))
      });
      sourceLinks.forEach(link => {
          candidates.push({
              target: link,
              priority: 190,
              type: "source_link",
              pos: link.pos,
              visual: { stroke: "#0000ff" }
          });
      });

      // If NOT CRITICAL, add other targets
      if (energyLevel !== "CRITICAL") {
        // 2. Priority Builders (Tag: priorityRequest) - Priority 150
        const priorityBuilders = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) =>
            c.memory.role === "builder" && c.memory.priorityRequest,
        });
        priorityBuilders.forEach((b) => {
          candidates.push({
            target: b,
            priority: 150,
            type: "priority_builder",
            pos: b.pos,
            visual: { stroke: "#ff00ff", strokeWidth: 0.5 }, // Magenta
          });
        });

        // 3. Towers - Priority 120
        const towers = this.creep.room.find(FIND_STRUCTURES, {
          filter: (s) =>
            s.structureType === STRUCTURE_TOWER &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 100,
        });
        towers.forEach((t) => {
          candidates.push({
            target: t,
            priority: 120,
            type: "tower",
            pos: t.pos,
            visual: { stroke: "#ff0000" },
          });
        });

        // 4. Upgraders (Active) - Priority 100
        const needyUpgraders = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) =>
            c.memory.role === "upgrader" &&
            (c.memory.working || c.memory.requestingEnergy) &&
            c.store.getFreeCapacity(RESOURCE_ENERGY) >
              c.store.getCapacity() * 0.5,
        });
        needyUpgraders.forEach((u) => {
          candidates.push({
            target: u,
            priority: 100,
            type: "upgrader",
            pos: u.pos,
            visual: { stroke: "#00ff00", opacity: 0.5 },
          });
        });

        // 5. Builders (Standard) - Priority 80
        const needyBuilders = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) =>
            c.memory.role === "builder" &&
            (c.memory.working || c.memory.requestingEnergy) &&
            c.store[RESOURCE_ENERGY] < c.store.getCapacity() * 0.3,
        });
        needyBuilders.forEach((b) => {
          // Avoid double adding if it was priority
          if (!candidates.find((c) => c.target.id === b.id)) {
            candidates.push({
              target: b,
              priority: 80,
              type: "builder",
              pos: b.pos,
              visual: { stroke: "#ffff00", opacity: 0.5 },
            });
          }
        });

        // 6. Sink Containers - Priority 50
        const sources = this.creep.room.find(FIND_SOURCES);
        const sinkContainers = this.creep.room.find(FIND_STRUCTURES, {
          filter: (s) => {
            if (s.structureType !== STRUCTURE_CONTAINER) return false;
            if (s.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return false;

            // Filter out Source Containers (Range <= 2)
            for (const source of sources) {
              if (s.pos.inRangeTo(source, 2)) return false;
            }

            // Check if near Controller (Range 3) or Spawn (Range 3)
            const nearController =
              this.creep.room.controller &&
              s.pos.inRangeTo(this.creep.room.controller, 3);
            const nearSpawn = s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0;

            return nearController || nearSpawn;
          },
        });
        const cacheTarget =
          (this.creep.room.controller?.level || 1) < 4 ? 1500 : 5000;
        sinkContainers
          .filter((s) => (s as AnyStoreStructure).store[RESOURCE_ENERGY] < cacheTarget)
          .forEach((s) => {
          candidates.push({
            target: s,
            priority: 50,
            type: "container",
            pos: s.pos,
            visual: { stroke: "#00ffff" },
          });
        });

      }

      // === SCORING & SELECTION ===
      if (candidates.length > 0) {
        // Score = Priority - Distance
        // This allows a closer lower priority target to win if the difference is large enough,
        // BUT since our priority gaps are large (20-30 points), it mostly respects priority tiers
        // unless the distance difference is extreme.
        const bestCandidate = candidates.reduce(
          (best, current) => {
            const dist = this.creep.pos.getRangeTo(current.pos);
            const score = current.priority - dist * 1.0; // Distance Penalty Factor 1.0

            if (!best || score > best.score) {
              return { candidate: current, score: score };
            }
            return best;
          },
          null as { candidate: Candidate; score: number } | null,
        );

        if (bestCandidate) {
          const target = bestCandidate.candidate.target;

          // [NEW] Announce target so others know I'm coming
          this.memory.targetId = target.id;

          if (
            this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            this.move(target, {
              visualizePathStyle: bestCandidate.candidate.visual,
            });
          }
          return;
        }
      }

      // Fallback: Dump to Upgrader if no other target
      if (candidates.length === 0) {
        const upgrader = this.creep.room.find(FIND_MY_CREEPS, {
          filter: (c) =>
            c.memory.role === "upgrader" &&
            c.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        })[0];
        if (upgrader) {
          if (
            this.creep.transfer(upgrader, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            this.move(upgrader);
          }
        }
      }
    } else {
      // === COLLECT STATE ===
      // 0. Receiver Link (Near Storage)
      const receiverLink = this.creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_LINK &&
          s.store[RESOURCE_ENERGY] > 0 &&
          ((this.creep.room.controller && s.pos.inRangeTo(this.creep.room.controller, 4)) ||
            s.pos.findInRange(FIND_MY_SPAWNS, 4).length > 0),
      })[0] as StructureLink | undefined;
      if (receiverLink) {
        if (this.creep.withdraw(receiverLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(receiverLink);
        }
        return;
      }

      // 0.5 Tombstones & Ruins
      const tombstone = this.creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: (t) => t.store[RESOURCE_ENERGY] > 50,
      });
      if (tombstone) {
        if (
          this.creep.withdraw(tombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          this.move(tombstone);
        }
        return;
      }
      const ruin = this.creep.pos.findClosestByPath(FIND_RUINS, {
        filter: (r) => r.store[RESOURCE_ENERGY] > 50,
      });
      if (ruin) {
        if (this.creep.withdraw(ruin, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          this.move(ruin);
        }
        return;
      }

      // 1. Dropped Resources
      const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      if (dropped) {
        if (this.creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          this.move(dropped, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // 2. Containers (Source Containers Only)
      // Prioritize containers with most energy
      const sources = this.creep.room.find(FIND_SOURCES);
      const containers = this.creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 100 &&
          // Only collect from Source Containers
          sources.some((source) => s.pos.inRangeTo(source, 3)),
      });

      const container = this.creep.pos.findClosestByPath(containers);

      if (container) {
        if (
          this.creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          this.move(container, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
        return;
      }

      // 3. Fallback: Help Harvest if Source has piles (handled by dropped logic)
      // or Wait near Source (parking)
      if (!dropped && !container) {
        // Move to a parking spot near source to avoid blocking spawn
        // Ideally, read sourceId from memory
        if (this.memory.sourceId) {
          const source = Game.getObjectById(this.memory.sourceId as Id<Source>);
          if (source && !this.creep.pos.inRangeTo(source, 3)) {
            this.move(source);
          }
        }
      }
    }
  }
}
