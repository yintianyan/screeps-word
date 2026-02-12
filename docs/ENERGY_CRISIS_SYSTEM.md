# Energy Crisis System Documentation

## Overview

The **Energy Crisis System** is a dynamic resource management module designed to prevent energy bankruptcy and ensure colony survival during critical shortages. It automatically adjusts energy consumption based on the Controller Level (RCL) and current energy reserves.

## Core Concepts

### Crisis Levels

The system defines 5 crisis levels:

1.  **NONE (0)**: Abundance. No restrictions.
2.  **LOW (1)**: Minor shortage. Builders reduced.
3.  **MEDIUM (2)**: Significant shortage. Upgraders reduced.
4.  **HIGH (3)**: Severe shortage. Minimal upgrading, limited repairs.
5.  **CRITICAL (4)**: Emergency. Only Spawn/Extensions allowed. Upgraders stop unless downgrade is imminent.

### RCL-Based Logic

Higher RCL rooms have higher energy demands and higher "Safe" thresholds. The system scales the crisis thresholds accordingly.

- **RCL 1-3**: Low thresholds (e.g., <300 energy is critical).
- **RCL 4-6**: Medium thresholds (Storage required).
- **RCL 7-8**: High thresholds (e.g., <50,000 energy is critical).

## Configuration

The system uses a `DEFAULT_CONFIG` map keyed by RCL.

```typescript
interface RCLConfig {
  minEnergy: number; // "Safe" threshold
  crisisThreshold: number; // "Critical" threshold
  upgraderBudget: Record<CrisisLevel, number>; // Max Upgrader WORK parts/count
  builderBudget: Record<CrisisLevel, number>; // Max Builder WORK parts/count
}
```

### Example Config (RCL 6)

- **Safe**: > 50,000 Energy
- **Critical**: < 10,000 Energy
- **Upgrader Budget**:
  - NONE: 40 WORK
  - MEDIUM: 10 WORK
  - CRITICAL: 2 WORK

## Usage

### Integration

The `EnergyManager` is integrated into:

- `PopulationManager`: Determines how many Upgraders/Builders to spawn.
- `EconomyCenter`: Determines how many tasks to generate and their priority.
- `Tower`: Disables non-essential repairs during crisis.

### Monitoring

The current status can be viewed via console logs when the level changes.
To view manually:

```javascript
require("EnergyManager").EnergyManager.getStatusReport(Game.rooms["W1N1"]);
```

(Note: Requires exporting to global or accessing via memory inspection)

Check `Memory.rooms['W1N1'].energyManager`:

```json
{
  "level": 1,
  "totalEnergy": 45000
}
```

## Protection Mechanisms

1.  **Downgrade Protection**: Regardless of crisis level, if `ticksToDowngrade < 2000`, the system forces at least 1 Upgrader.
2.  **Anti-Starvation**: If containers are empty, caps usage to prevent Haulers from being unable to refuel Spawns.
3.  **Hysteresis**: (Planned) Buffer zones to prevent rapid toggling between levels.

## Extending

To modify thresholds, edit `src/components/EnergyManager.ts` -> `DEFAULT_CONFIG`.
