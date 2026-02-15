# Remote Mining Analysis & Fix

## Issue
Remote mining was not occurring despite the room being RCL 5.

## Root Cause
The `RemoteManager` module had logic to *manage* remote rooms (spawn miners/haulers) ONLY if they were present in `room.memory.remotes`. However, there was **no logic to populate this list**. The Scout role only provided vision but did not trigger any "colonization" or "claim" logic.

## Fix Implemented
1.  **Automated Remote Evaluation**:
    - Modified `src/modules/remote/RemoteManager.ts`.
    - Added `evaluateRemote(homeRoom, remoteRoom)` method.
    - Integrated this check into the `manageScouting` loop. When a Scout provides vision of a neighbor room, `RemoteManager` now instantly evaluates it.

2.  **Evaluation Criteria**:
    - **Sources**: Must have > 0 sources.
    - **Ownership**: Must not be owned by another player.
    - **Reservation**: Must not be reserved by another player (Invader reservation is ignored as we can clear it).
    - **Threats**: Must not have an Invader Core (for now).
    - **Distance**: Must be a direct neighbor (Distance = 1).

3.  **Result**:
    - As soon as a Scout enters a suitable neighbor room, it will be added to `room.memory.remotes`.
    - The existing `manageRemoteRoom` logic will then pick it up in the next tick and start generating `REMOTE_HARVEST`, `REMOTE_HAUL`, etc. tasks.

## Verification
- Watch the console for `[RemoteManager] 🏳️ Colonizing ...` logs.
- Check `Memory.rooms['W1N1'].remotes` to see the list growing.
- Ensure `scout` creeps are spawning (RCL 2+ requirement met).
