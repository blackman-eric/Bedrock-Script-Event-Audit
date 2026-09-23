# Bedrock Script Event Audit

Minecraft Bedrock Script API diagnostics and focused bug reproductions. The reusable Event Audit and the narrow MCPE-174388 reproduction share one repository but version independently.

```text
Bedrock-Script-Event-Audit/
├─ README.md
├─ LICENSE
├─ event-audit/
│  ├─ README.md
│  ├─ manifest.json
│  └─ scripts/
│     └─ main.js
├─ mcpe-174388-repro/
│  ├─ README.md
│  ├─ manifest.json
│  └─ scripts/
│     └─ main.js
└─ tools/
   ├─ build.ps1
   └─ publish-releases.ps1
```

## Event Audit

**Current version: 1.0.0**

Observation-only audit pack for comparing Minecraft Bedrock Script API event paths across interactions, attacks/damage, removal, block breaking, item use, containers, controls, explosions, and projectiles.

Release tag: `event-audit-v1.0.0`  
Release asset: `Event_Audit_v1.0.0.mcpack`

## MCPE-174388 Repro

**Current version: 1.0.0**

Focused reproduction for MCPE-174388. It contrasts the cancellable `EntityHurtBeforeEvent` path available for ordinary living entities with the attack/removal behavior of affected non-living entities, including the Creative one-hit timing path.

Release tag: `mcpe-174388-v1.0.0`  
Release asset: `MCPE-174388_Repro_v1.0.0.mcpack`

## Build

From PowerShell:

```powershell
./tools/build.ps1
```

This creates both `.mcpack` files in `dist/`.

## License

MIT.

## Choosing a pack

- **Event Audit** � use for broad Script API event investigation and comparing event paths across interactions.
- **MCPE-174388 Repro** � use for the focused MCPE-174388 reproduction and bug-report testing.
