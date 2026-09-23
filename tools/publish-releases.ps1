$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"

& (Join-Path $PSScriptRoot "build.ps1")

gh release create "event-audit-v1.0.0" `
    (Join-Path $Dist "Event_Audit_v1.0.0.mcpack") `
    --title "Event Audit v1.0.0" `
    --notes "First public release of the observation-only Bedrock Script API Event Audit."

gh release create "mcpe-174388-v1.0.0" `
    (Join-Path $Dist "MCPE-174388_Repro_v1.0.0.mcpack") `
    --title "MCPE-174388 Repro v1.0.0" `
    --notes "Focused reproduction for MCPE-174388 covering Survival event behavior and Creative one-hit destruction timing."
