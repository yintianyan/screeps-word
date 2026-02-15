# Hauler Behavior Analysis Report

## 1. Issue Diagnosis: Haulers Not Filling Storage

Based on the code analysis of `src/modules/hauler/index.ts`, I have identified several potential reasons why Haulers might not be transferring energy to storage.

### A. Energy State Logic (Lines 72, 106-125, 128)

- The code retrieves `energyLevel` from memory.
- If `energyLevel === "CRITICAL"`, it **only** considers Spawns and Extensions (lines 104-125).
- Storage is **explicitly excluded** from the candidate list in CRITICAL mode because the block adding other targets (lines 128-242) is wrapped in `if (energyLevel !== "CRITICAL")`.
- **Potential Issue**: If the room is stuck in "CRITICAL" mode (perhaps due to `EnergyManager` logic or hysteresis), Haulers will **never** fill Storage, even if Spawns are full. They will simply idle or fall back to dumping to Upgraders (lines 280-294).

### B. Storage Candidate Logic (Lines 229-241)

- Storage is added as a candidate with Priority 10.
- Condition: `this.creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0`.
- This logic seems correct for normal operation, assuming `energyLevel !== "CRITICAL"`.

### C. Fallback Logic (Lines 280-294)

- If `candidates.length === 0` (e.g., Spawn full, and we are in CRITICAL mode so Storage is ignored), the Hauler defaults to finding an Upgrader.
- It does **not** check Storage in this fallback block.
- **Consequence**: In CRITICAL mode, if Spawn is full, energy goes to Upgrader, bypassing Storage entirely.

### D. Pathfinding & Distance (Lines 246-261)

- The scoring algorithm `Score = Priority - Distance` works fine. Storage has low priority (10), so it will only be chosen if higher priority targets (Spawn, Tower, etc.) are full or non-existent.

## 2. Proposed Fixes

### Fix 1: Add Storage to CRITICAL Mode Fallback

If we are in CRITICAL mode and Spawns/Extensions are full, we should allow filling Storage instead of idling or forcing Upgrader dump (unless Upgrader is critical).
**Action**: Modify the logic to include Storage as a low-priority candidate even in CRITICAL mode, OR add a specific check for "Spawn Full" in CRITICAL mode to fallback to Storage.

### Fix 2: Revise Fallback Logic

The current fallback (Lines 280-294) blindly dumps to Upgrader.
**Action**: Change fallback to:

1. Try Storage (if available and not full).
2. Try Upgrader.

### Fix 3: Verify Energy Manager Integration

Ensure `EnergyManager` is correctly updating `energyLevel`. If it incorrectly reports CRITICAL when energy is actually available (but low), it triggers this behavior.

## 3. Plan

1.  **Create Unit Test**: Replicate the scenario (CRITICAL mode, Spawn Full, Storage Empty). Verify Hauler ignores Storage.
2.  **Apply Fix**:
    - Allow Storage as a candidate in CRITICAL mode (maybe with lower priority or only if Spawn full).
    - Update Fallback logic to prioritize Storage over Upgrader for dumping surplus.
3.  **Verify**: Run test again.

## 4. AI Behavior Tree (Simplified)

**Current:**

- Is Carrying Energy?
  - Yes:
    - Is CRITICAL?
      - Yes: Target = Spawn/Extension. (If full -> Candidates Empty -> Fallback: Upgrader)
      - No: Target = Spawn > Tower > Upgrader > Storage.
  - No: Collect Energy.

**Proposed:**

- Is Carrying Energy?
  - Yes:
    - Is CRITICAL?
      - Yes: Target = Spawn/Extension.
      - **If Candidates Empty (Spawn Full)**: Add Storage as candidate.
      - No: Target = Spawn > Tower > Upgrader > Storage.
    - **Final Fallback**: Storage > Upgrader.
  - No: Collect Energy.
