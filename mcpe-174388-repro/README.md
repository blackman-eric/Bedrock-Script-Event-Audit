# MCPE-174388 Repro v1.0.0

Focused, observation-only behavior pack for reproducing the Script API event behavior tracked in MCPE-174388.

## Environment

- Minecraft Bedrock 26.51 stable
- `@minecraft/server` 2.10.0 stable

## What it logs

- `world.beforeEvents.entityHurt`
- `world.afterEvents.entityHurt`
- `world.afterEvents.entityHitEntity`
- `world.afterEvents.playerSwingStart`
- `world.afterEvents.entityDie`
- `world.beforeEvents.entityRemove`
- `world.afterEvents.entityRemove`

The pack is observation-only: it does not cancel events or modify gameplay. Records use the prefix `[MCPE-174388-REPRO]` and include sequence/tick values.

## Survival comparison

Use a Cow as the ordinary living control and an affected target such as a Minecart or Armor Stand. A normal living attack exposes cancellable `EntityHurtBeforeEvent`, followed by hit/hurt after-events. Affected non-living targets can produce `EntityHitEntityAfterEvent` on surviving hits while the `entityHurt` event family remains absent. Final destruction can produce `EntityRemoveBeforeEvent`, but it has no cancel property.

## Creative one-hit path

With a fresh affected target in Creative, one-hit destruction can enter the removal path before an `EntityHitEntityAfterEvent` for that destructive hit is delivered. `EntityHurtBeforeEvent` still does not fire first, so there is no cancellable pre-damage/destruction hook.

## Affected targets verified during the broader audit

Minecart, Hopper Minecart, Chest Minecart, TNT Minecart, Command Block Minecart, Boat, Chest Boat, Armor Stand, and Painting.
