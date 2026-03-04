import { Process } from "../../core/Process";
import { processRegistry } from "../../core/ProcessRegistry";
import { Squad } from "./Squad";
import { CampaignData, SquadData } from "../../types";

export class OffenseProcess extends Process {
  public run(): void {
    if (!Memory.war) {
      Memory.war = {
        spawnRequests: [],
        campaigns: {}
      };
    }

    // 挂载全局命令
    if (!global.War) {
      global.War = {
        attack: (target: string, origin: string, type: "harass" | "dismantle" | "capture" | "drain" = "harass") => {
          return OffenseProcess.startCampaign(target, origin, type);
        },
        list: () => {
          if (!Memory.war) return;
          console.log("Active Campaigns:");
          for (const id in Memory.war.campaigns) {
            const c = Memory.war.campaigns[id];
            console.log(`- ${id}: ${c.type} -> ${c.targetRoom} (State: ${c.state}, Squads: ${c.squads.length})`);
          }
        },
        stop: (id: string) => {
          if (Memory.war?.campaigns[id]) {
            Memory.war.campaigns[id].state = "completed";
            console.log(`Campaign ${id} stopped.`);
          } else {
            console.log(`Campaign ${id} not found.`);
          }
        }
      };
    }

    // Process campaigns
    for (const id in Memory.war.campaigns) {
      const campaign = Memory.war.campaigns[id];
      this.runCampaign(campaign, id);
    }

    // Clean up spawn requests
    // Remove requests that are "processing" or "completed" if we want to clear memory
    // But SpawnerProcess sets them to processing.
    // We can keep them for a bit or clear them.
    // For now, keep them until we implement a better cleanup.
    if (Memory.war.spawnRequests.length > 50) {
        Memory.war.spawnRequests = Memory.war.spawnRequests.filter(r => r.status === "pending");
    }
  }

  private runCampaign(campaign: CampaignData, id: string) {
    if (campaign.state === "completed" || campaign.state === "failed") return;

    // Check for Squad Spawning
    if (campaign.squads.length === 0 && campaign.state === "spawning") {
        // Spawn initial squads
        this.spawnSquad(campaign, "alpha", "duo");
        campaign.state = "rallying"; // Wait for them
    }

    // Run Squads
    for (const squadData of campaign.squads) {
        const squad = new Squad(squadData);
        squad.run(campaign.targetRoom);
    }
  }

  private spawnSquad(campaign: CampaignData, squadId: string, type: "duo" | "quad" | "solo") {
      const room = Game.rooms[campaign.originRoom];
      if (!room) return;

      const newSquad: SquadData = {
          id: squadId,
          type: type,
          creeps: [],
          role: "attacker", // Default
          state: "spawning",
          rallyPos: undefined 
      };

      const time = Game.time;
      const name1 = `War_${campaign.originRoom}_A_${time}`;
      const name2 = `War_${campaign.originRoom}_H_${time}`;

      // Request Spawns
      if (type === "duo") {
          // Attacker
          Memory.war!.spawnRequests.push({
              id: `req_${name1}`,
              roomName: campaign.originRoom,
              role: "attacker",
              body: [TOUGH, TOUGH, TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE], 
              priority: 80,
              memory: { role: "attacker", room: campaign.originRoom, targetRoom: campaign.targetRoom, working: false, name: name1 } as any,
              status: "pending"
          });
          newSquad.creeps.push(name1);
          
          // Healer
          Memory.war!.spawnRequests.push({
              id: `req_${name2}`,
              roomName: campaign.originRoom,
              role: "healer",
              body: [HEAL, HEAL, HEAL, HEAL, MOVE, MOVE, MOVE, MOVE], 
              priority: 80,
              memory: { role: "healer", room: campaign.originRoom, targetRoom: campaign.targetRoom, working: false, name: name2 } as any,
              status: "pending"
          });
          newSquad.creeps.push(name2);
      }

      campaign.squads.push(newSquad);
  }

  public static startCampaign(targetRoom: string, originRoom: string, type: "harass" | "dismantle" | "capture" | "drain") {
      if (!Memory.war) Memory.war = { spawnRequests: [], campaigns: {} };
      
      const id = `campaign_${targetRoom}_${Game.time}`;
      Memory.war.campaigns[id] = {
          targetRoom,
          originRoom,
          type,
          state: "spawning",
          squads: [],
          startTime: Game.time
      };
      console.log(`Started campaign ${id} against ${targetRoom} from ${originRoom}`);
      return id;
  }
}

processRegistry.register(OffenseProcess, "OffenseProcess");
