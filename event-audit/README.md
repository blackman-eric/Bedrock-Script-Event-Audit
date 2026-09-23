# Event Audit v1.0.0

Observation-only Minecraft Bedrock Script API event audit for interaction, attack/damage, block breaking, held-item use, removal, containers, explosions, controls, and projectile paths.

## Target environment

- Minecraft Bedrock 26.51 stable
- `@minecraft/server` 2.10.0 stable

The pack does not cancel events or modify targets. Records are written to the Content Log with the prefix `[EVENT-AUDIT]`.

## What it watches

Relevant before-events include `entityHurt`, `entityRemove`, `entityTamed`, `explosion`, `itemUse`, `playerBreakBlock`, `playerInteractWithBlock`, and `playerInteractWithEntity`.

Supporting after-events include player/entity interaction, `entityHurt`, `entityHitEntity`, `entityHitBlock`, `playerSwingStart`, death/removal/taming, Sneak transitions, block break start/cancel/complete, button and lever actions, item-use phases, explosions, container opens, and projectile hits.

At startup the pack enumerates the runtime world/system event surfaces. A world before-event that is neither explicitly handled nor intentionally ignored is generically subscribed and logged as `UNEXPECTED_BEFORE_<name>`.

## Noise reduction

Ambient healing/health changes, spawn/load noise, mode/input-mode changes, container-close events, and generic subscriptions to every unknown after-event are omitted because they obscure action sequences without adding a useful interception path. Sneak transitions, `entityHitBlock`, block-break lifecycle events, button pushes, and lever actions remain.

## Entity removal

`entityRemove` before/after events are logged without filtering. This can include chunk/world-unload noise, but prevents instant-removal paths from being hidden by correlation logic.

## Optional marker

```mcfunction
/scriptevent event:audit <label>
```
