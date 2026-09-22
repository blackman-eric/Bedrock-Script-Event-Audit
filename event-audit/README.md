# Event Audit v0.1.0

Observation-only Minecraft Bedrock Script API event logger.

- Target Script API: `@minecraft/server` 2.9.0
- Logs interaction, attack/damage, removal, block, item-use, container, control, explosion, and projectile event paths exposed by this snapshot.
- Does not cancel events or modify gameplay behavior.
- Content Log records use the `[EVENT-AUDIT]` prefix.

Optional markers can be inserted with:

```mcfunction
/scriptevent event:audit <label>
```
