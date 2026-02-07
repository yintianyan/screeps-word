# Skill Module Optimization & Architecture Report

## 1. Overview
This document details the re-architecture of the Screeps bot codebase from a monolithic `main.js` script to a modular, high-performance **Kernel-based Architecture**. The goal was to resolve performance bottlenecks (CPU/Memory), improve code maintainability (High Cohesion/Low Coupling), and introduce a robust testing infrastructure.

## 2. Architecture Analysis

### 2.1 Before Optimization
*   **Structure**: Linear execution in `main.js`.
*   **Data Flow**: Heavy reliance on `Memory` (JSON) for all state persistence.
*   **Performance Bottlenecks**:
    *   **Redundant API Calls**: `room.find()` was called multiple times per tick for the same data (e.g., finding sources, creeps, structures).
    *   **Serialization Overhead**: Storing transient data in `Memory` caused high CPU usage during `JSON.parse` and `JSON.stringify`.
    *   **Fragility**: A single error in one module could crash the entire tick loop.

### 2.2 After Optimization (The New Architecture)
We introduced a **Kernel Layer** that acts as the operating system for the bot.

*   **Core Kernel (`core.kernel.js`)**:
    *   **Module Registry**: Manages `population`, `planner`, `spawner`, etc.
    *   **Error Boundaries**: Wraps each module in `try-catch` blocks.
    *   **Profiling**: Automatically tracks CPU usage per module.
*   **Dual-Layer Caching (`core.cache.js`)**:
    *   **TickCache**: Valid for 1 tick. Stores `room.find` results.
    *   **HeapCache**: Valid across ticks (global scope). Stores static map data.

## 3. Key Improvements

### 3.1 Algorithms & Data Structures
*   **Caching Strategy**: Implemented lazy-loading getters. Data is fetched only when requested and cached for the remainder of the tick/lifetime.
*   **Time Complexity**: Reduced Creep/Structure lookup from $O(N \times M)$ (where M is number of modules) to $O(N)$ (fetched once per tick).

### 3.2 Interface Specification
All modules now adhere to a standard interface:
```javascript
module.exports = {
    run: function(room) {
        // Implementation
    }
}
```
Modules are registered in `main.js` via:
```javascript
Kernel.register('moduleName', moduleInstance);
```

### 3.3 Performance Metrics (Projected)
*   **Response Time**: ~40% reduction in CPU usage during heavy ticks due to caching.
*   **Memory Usage**: ~20% reduction in `Memory` size by moving non-critical state to Heap.

## 4. Testing Infrastructure
We introduced a **Mock-based Unit Testing** framework.
*   **Location**: `test/`
*   **Runner**: `test/runner.js`
*   **Coverage**: Verified `Cache` mechanics and `Population` decision logic.

## 5. Deployment & Migration Guide

### 5.1 Migration Steps
1.  **Backup**: Ensure you have a commit of your working `default` branch.
2.  **Files**: The following files are new/modified:
    *   `core.kernel.js` (New)
    *   `core.cache.js` (New)
    *   `module.spawner.js` (New - Extracted from main)
    *   `module.creeps.js` (New - Extracted from main)
    *   `module.population.js` (Refactored)
    *   `main.js` (Updated entry point)
3.  **Deploy**: Simply push these files to your Screeps branch.

### 5.2 Verification
*   Check the console for `[Kernel]` logs.
*   Verify that creeps are spawning and moving (Kernel is driving the loop).
*   Run tests locally: `export NODE_PATH=$(pwd) && node test/runner.js`.

## 6. Future Roadmap
*   **Process Priority**: Allow Kernel to skip low-priority modules when CPU bucket is low.
*   **Memory Segments**: Move large data (like Room Planner maps) to `RawMemory` segments to further save main heap.
