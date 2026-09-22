# MCPE-174388 Repro v0.1.0

Early observation-only reproduction for MCPE-174388.

- Target Script API: `@minecraft/server` 2.11.0-beta
- Logs player attack-related entity events without cancelling or modifying them.
- Intended to compare ordinary living-entity damage events with boat/minecart-style attack behavior.
