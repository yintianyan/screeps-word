# Optimization Log - Logistics System

## 1. Harvester Optimization

- **Persistent Source Assignment**: Replaced random source assignment with a deterministic slot-based system. Harvesters now automatically distribute themselves evenly across sources based on current population.
- **Link Integration**: Added logic to transfer energy directly to a nearby Link (Range 2) if available. This bypasses the need for Haulers in advanced rooms.

## 2. Hauler Optimization

- **Expanded Collection Sources**:
  - Added support for picking up from **Tombstones** and **Ruins**.
  - Added support for withdrawing from **Receiver Links** (Links near Storage).
- **Idle Behavior**: Implemented a fallback mechanism where Haulers with energy will dump it to any available Upgrader if no high-priority targets exist, preventing them from idling with a full load.
- **Priority Handling**: Confirmed adherence to the logistics protocol (Spawn > Priority Builder > Tower > Upgrader > Storage).

## 3. Upgrader Optimization

- **Link Integration**: Added logic to withdraw energy from a nearby Controller Link (Range 3). This allows for uninterrupted upgrading in advanced rooms.

## 4. Link Management (New)

- **Centralized LinkManager**: Created `src/components/linkManager.ts` and registered it in Kernel.
- **Topology Recognition**: Automatically identifies Link roles based on proximity to Source, Controller, and Storage.
- **Flow Control**:
  - **Source Links** push to **Controller Link** (Priority 1) to fuel Upgraders.
  - **Source Links** push to **Storage Link** (Priority 2) to store surplus.
  - **Storage Link** refills **Controller Link** if it gets low, ensuring Upgraders never starve even if Sources are momentarily dry.
