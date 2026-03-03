import { Process } from "../core/Process";
import { processRegistry } from "../core/ProcessRegistry";
import { config } from "../config";

function getMyRooms(): Room[] {
  const rooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) rooms.push(room);
  }
  return rooms;
}

/**
 * 终端 (Terminal) 进程
 * 
 * 负责管理 Terminal 的资源进出。
 * 
 * 主要职责：
 * 1. 能量平衡 (Energy Balancing): 将多余的能量发送到匮乏的房间。
 * 2. 资源销售 (Sell Excess Minerals): 自动出售过多的矿物换取 Credits。
 * 3. 资源求购 (尚未实现): 购买缺失的矿物。
 */
export class TerminalProcess extends Process {
  public run(): void {
    // Only run every 50 ticks to save CPU
    if (Game.time % 50 !== 0) return;

    for (const room of getMyRooms()) {
        this.runRoom(room);
    }
  }

  private runRoom(room: Room): void {
      const terminal = room.terminal;
      if (!terminal || !terminal.my || terminal.cooldown > 0) return;

      // 1. Energy Balancing
      // If we have excess energy, send to rooms that need it.
      // Excess: > 150k in storage + terminal
      // Need: < 50k in storage + terminal
      
      const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      const terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      const totalEnergy = storageEnergy + terminalEnergy;
      
      if (totalEnergy > 150000 && terminalEnergy > 20000) {
          // Find target room
          const target = this.findEnergyNeed(room.name);
          if (target) {
              const amount = Math.min(terminalEnergy - 10000, 10000); // Keep 10k reserve
              const cost = Game.market.calcTransactionCost(amount, room.name, target);
              if (terminalEnergy >= amount + cost) {
                  const result = terminal.send(RESOURCE_ENERGY, amount, target, "Energy balancing");
                  if (result === OK) {
                      console.log(`[Terminal] Sent ${amount} energy from ${room.name} to ${target}`);
                      return;
                  }
              }
          }
      }

      // 2. Sell Excess Minerals
      // Sell if > 20k mineral
      for (const res in terminal.store) {
          if (res === RESOURCE_ENERGY) continue;
          const resource = res as ResourceConstant;
          const amount = terminal.store.getUsedCapacity(resource);
          
          if (amount > 20000) {
              const sellAmount = 5000;
              // Find buy order
              const orders = Game.market.getAllOrders({
                  type: ORDER_BUY,
                  resourceType: resource
              });
              
              // Sort by price high to low
              orders.sort((a, b) => b.price - a.price);
              
              // Filter orders with reasonable price (e.g., > 0.01 or whatever threshold)
              // And checking transaction cost
              const bestOrder = orders.find(o => o.remainingAmount > 0 && o.price > 0.05); // Simple threshold
              
              if (bestOrder) {
                   const dealAmount = Math.min(sellAmount, bestOrder.remainingAmount);
                   const cost = Game.market.calcTransactionCost(dealAmount, room.name, bestOrder.roomName!);
                   if (terminalEnergy >= cost) {
                       const result = Game.market.deal(bestOrder.id, dealAmount, room.name);
                       if (result === OK) {
                           console.log(`[Terminal] Sold ${dealAmount} ${resource} from ${room.name} to ${bestOrder.roomName} @ ${bestOrder.price}`);
                           return;
                       }
                   }
              }
          }
      }
  }

  private findEnergyNeed(sourceRoomName: string): string | null {
      let bestTarget: string | null = null;
      let minEnergy = 50000;

      for (const roomName in Game.rooms) {
          if (roomName === sourceRoomName) continue;
          const room = Game.rooms[roomName];
          if (!room.controller?.my || !room.terminal || !room.storage) continue;
          
          const energy = room.storage.store.getUsedCapacity(RESOURCE_ENERGY) + room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
          if (energy < minEnergy) {
              minEnergy = energy;
              bestTarget = roomName;
          }
      }
      return bestTarget;
  }
}

processRegistry.register(TerminalProcess, "TerminalProcess");
