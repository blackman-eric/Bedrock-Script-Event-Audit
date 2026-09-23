$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"

if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Path $Dist | Out-Null

function New-McPack {
    param(
        [Parameter(Mandatory)] [string]$SourceDir,
        [Parameter(Mandatory)] [string]$OutputName
    )

    $TempZip = Join-Path $Dist ([System.IO.Path]::GetFileNameWithoutExtension($OutputName) + ".zip")
    $Output = Join-Path $Dist $OutputName

    Push-Location $SourceDir
    try {
        Compress-Archive -Path "manifest.json", "README.md", "scripts" -DestinationPath $TempZip -Force
    } finally {
        Pop-Location
    }

    Move-Item $TempZip $Output -Force
    Write-Host "Built $Output"
}

New-McPack (Join-Path $Root "event-audit") "Event_Audit_v1.0.0.mcpack"
New-McPack (Join-Path $Root "mcpe-174388-repro") "MCPE-174388_Repro_v1.0.0.mcpack"
