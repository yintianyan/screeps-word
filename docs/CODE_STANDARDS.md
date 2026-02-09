# Code Modification Standards

## 1. Impact Assessment
Before making any changes, perform a comprehensive impact assessment:
- **Scope Analysis**: Identify which modules (e.g., Economy, Population, Movement) will be affected.
- **Dependency Check**: Ensure that changes in one module do not break dependencies in others (e.g., changing Creep memory structure).
- **Risk Evaluation**: Assess the risk of regression, especially for critical systems like Spawning and Harvesting.

## 2. Development Rules
- **Unit Tests**: All logic changes must be accompanied by unit tests (using Jest).
- **Integration Verification**: Verify changes in a simulated environment or through careful observation of logs/visuals.
- **Regression Testing**: Maintain a list of critical features (e.g., "Harvester spawns correctly", "Upgrader upgrades") and verify them after changes.
- **Backward Compatibility**: Ensure new code handles existing memory structures gracefully.

## 3. Code Review Checklist
- [ ] Logic addresses the root cause?
- [ ] Unit tests cover edge cases (e.g., RCL 1 vs RCL 8)?
- [ ] No "magic numbers" without explanation?
- [ ] Console logs added for debugging/verification?
- [ ] performance impact considered (CPU usage)?

## 4. Specific System Guidelines

### Harvesting System
- **Efficiency**: Ensure WORK parts match Source regeneration (5 WORK per source).
- **Congestion**: Avoid spawning more creeps than available spots.
- **Redundancy**: Only allow overlap during lifecycle replacement.

### Spawning System
- **Priority**: Critical roles (Harvester/Hauler) > Upgraders > Builders.
- **Energy Wait**: Wait for full energy capacity for high-tier creeps unless critical.

### Path Planning
- **Road Preference**: Creeps must strictly prefer roads to save fatigue.
- **Traffic Management**: Idle creeps must yield to active ones.
