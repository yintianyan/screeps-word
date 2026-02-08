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
    if (!this.memory.working && this.creep.store.getFreeCapacity() === 0) {
      this.memory.working = true; // Go to Deliver
      this.creep.say("🚚 deliver");
    }

    // Opportunistic Pickup: If moving to collect/deliver and see dropped energy on/near position
    const dropped = this.creep.pos.lookFor(LOOK_RESOURCES)[0];
    if (dropped && dropped.resourceType === RESOURCE_ENERGY) {
      this.creep.pickup(dropped);
    }
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
            c.memory.working &&
            c.store.getFreeCapacity(RESOURCE_ENERGY) >
              c.store.getCapacity() * 0.5 &&
            !c.pos.inRangeTo(this.creep.room.controller, 1),
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
        sinkContainers.forEach((s) => {
          candidates.push({
            target: s,
            priority: 50,
            type: "container",
            pos: s.pos,
            visual: { stroke: "#00ffff" },
          });
        });

        // 7. Storage - Priority 10
        if (
          this.creep.room.storage &&
          this.creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        ) {
          candidates.push({
            target: this.creep.room.storage,
            priority: 10,
            type: "storage",
            pos: this.creep.room.storage.pos,
            visual: { stroke: "#ffffff", opacity: 0.3 },
          });
        }
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
    } else {
      // === COLLECT STATE ===
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
