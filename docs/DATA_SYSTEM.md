# Data Center & Cross-Room Collection System

## 1. Overview

The Data Center is a distributed system designed to collect, aggregate, and visualize real-time data from all colonies. It integrates with the existing Kernel and Dispatch systems to enable data-driven decision making.

## 2. Architecture

### 2.1 Components

1.  **RoomCollector (`src/modules/data/RoomCollector.ts`)**
    - **Scope**: Runs in every owned room.
    - **Role**: Scrapes local data (Energy, Population, Threat, Construction).
    - **Output**: Generates `RoomSnapshot` every tick.

2.  **DataCenter (`src/centers/DataCenter.ts`)**
    - **Scope**: Global singleton.
    - **Role**: Aggregates snapshots into `Memory.datastore`.
    - **Logic**: Runs anomaly detection and global analysis.

3.  **AnomalyDetector (`src/modules/data/AnomalyDetector.ts`)**
    - **Role**: Pure function analyzing snapshots.
    - **Output**: Generates `Alert` objects (e.g., Critical Energy, Hostile Detection).

4.  **Dashboard (`src/visuals/Dashboard.ts`)**
    - **Role**: Renders HUD on game screen using `RoomVisual`.

### 2.2 Data Flow

`RoomCollector` -> `RoomSnapshot` -> `DataCenter` -> `Memory.datastore` -> `Dashboard` / `GlobalDispatch`

## 3. Data Structure

### RoomSnapshot

```typescript
interface RoomSnapshot {
  timestamp: number;
  roomName: string;
  rcl: { level; progress; progressTotal };
  energy: { available; capacity; storage; terminal };
  census: Record<string, number>;
  threat: { level; hostiles; owner };
}
```

### Alerts

- **CRITICAL**: Hostiles present, Energy < 300 (Crisis).
- **WARNING**: Energy < 30% storage.
- **INFO**: GCL Level up.

## 4. Usage

### Enable Visualization

The dashboard runs automatically in all visible rooms registered with the Kernel.

### Access Data via Console

```javascript
// Get raw data
JSON.stringify(Memory.datastore.rooms["W1N1"]);

// Check alerts
Memory.datastore.alerts;
```

### Extending

To add new metrics:

1.  Update `RoomSnapshot` interface in `src/types/stats.ts`.
2.  Add collection logic in `RoomCollector.ts`.
3.  Add visualization in `Dashboard.ts`.

## 5. Performance

- **Aggregation**: Runs every 10 ticks.
- **History**: Keeps last 50 snapshots (sampled every 100 ticks).
- **CPU Impact**: Low (< 0.5 CPU per room).
