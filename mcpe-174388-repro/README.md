# MCPE-174388 Repro v0.2.0

Focused, observation-only reproduction for MCPE-174388.

Target environment:

- Minecraft Bedrock 26.51 stable
- `@minecraft/server` 2.10.0 stable

This snapshot narrows logging to the event paths needed for the issue: `entityHurt` before/after, `entityHitEntity`, entity death/removal, and related player attack context. No events are cancelled and gameplay behavior is not modified.
