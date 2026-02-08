---
name: "logistics-protocol"
description: "Defines rules for energy distribution, active delivery, and supply chain management. Invoke when optimizing hauler logic or debugging resource starvation."
---

# Logistics Protocol (物流协议)

This skill defines the standard operating procedures for energy logistics within the colony. It governs how energy is transported from Sources to Sinks and how Creeps coordinate supply and demand.

## 1. Supply Chain Hierarchy

### Sources (Producers)
*   **Primary**: Dropped Resources (Decay fast, highest pickup priority).
*   **Secondary**: Mining Containers (Standard source).
*   **Tertiary**: Tombstones & Ruins (Opportunistic).

### Sinks (Consumers)
*   **Tier 1 (Critical)**: Spawn, Extensions (Survival).
*   **Tier 2 (Defense)**: Towers (Energy < 500).
*   **Tier 3 (Active Support)**:
    *   **Upgraders**: When energy < 50% and actively working.
    *   **Builders**: When energy < 50% and building Critical Structures (Spawn/Extension).
*   **Tier 4 (Storage)**: Storage, Terminal (Surplus).
*   **Tier 5 (Buffer)**: General Containers, Controller Link.

## 2. Active Delivery Protocol (主动配送)

Haulers are authorized to deliver directly to working Creeps under the following conditions:

*   **Target Eligibility**:
    *   Role must be `upgrader` or `builder`.
    *   `memory.working` must be `true`.
    *   Energy store must be low (e.g., < 50% capacity).
    *   (Builder Only) Must be targeting a high-priority site.
*   **Distance Constraint**:
    *   Target must be within reasonable range (e.g., same room or < 10 tiles deviation) to avoid inefficient travel.

## 3. Request Signaling (请求支援)

Creeps (Upgraders/Builders) can signal distress/need via Memory:

*   **Signal**: Set `memory.requestingEnergy = true`.
*   **Condition**:
    *   Energy == 0.
    *   No Containers/Storage within Range 5.
    *   Distance to Source > 10.
*   **Response**:
    *   Haulers scan for this flag.
    *   Upon assigning a Hauler, the Hauler may (optionally) set `memory.targetCreep = <id>` to prevent double-booking, though simple competition is often sufficient.
*   **Termination**:
    *   Creep clears flag when `store.getFreeCapacity() == 0` or energy > 50%.

## 4. Anti-Starvation Rules

*   **Builder Deadlock**: If Builder has 0 energy and no supply, it MUST NOT block the mining spot. It should move to a "Waiting Area" or request delivery.
*   **Hauler Idle**: If Hauler has energy but no standard sinks, it MUST look for Upgraders to dump energy into, rather than sleeping.
