# Startet Sunstate Heat im Dev-Modus (Server + Client).
# Aufruf:  .\start.ps1        (oder Doppelklick auf start.cmd)
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# PATH neu laden, damit ein frisch installiertes Node.js gefunden wird
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js wurde nicht gefunden. Bitte installieren: https://nodejs.org (LTS)' -ForegroundColor Red
    Write-Host 'oder per:  winget install OpenJS.NodeJS.LTS'
    Read-Host 'Enter zum Beenden'
    exit 1
}
Write-Host "Node.js $(node -v) gefunden." -ForegroundColor Cyan

# Abhängigkeiten nur installieren, wenn sie fehlen oder package.json neuer ist
$needInstall = -not (Test-Path 'node_modules') -or
    ((Get-Item 'package.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime)
if ($needInstall) {
    Write-Host 'Installiere Abhängigkeiten (npm install) ...' -ForegroundColor Cyan
    npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { Read-Host 'npm install fehlgeschlagen. Enter zum Beenden'; exit 1 }
}

# CC0-Modelle und -Sounds nachladen, falls sie fehlen (ohne sie läuft das Spiel mit Ersatzmodellen)
if (-not (Test-Path 'client/public/assets/kaykit')) {
    Write-Host 'Lade freie Assets (npm run assets) ...' -ForegroundColor Cyan
    npm run assets
    if ($LASTEXITCODE -ne 0) { Write-Host 'Assets konnten nicht geladen werden - starte mit Ersatzmodellen.' -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '  Spiel öffnen:  http://localhost:5173' -ForegroundColor Magenta
Write-Host '  Freunde im LAN: http://<LAN-Adresse unten>:5173' -ForegroundColor Magenta
Write-Host '  Beenden: Strg+C' -ForegroundColor Magenta
Write-Host ''

# Browser kurz nach dem Start öffnen
Start-Job -ScriptBlock { Start-Sleep -Seconds 4; Start-Process 'http://localhost:5173' } | Out-Null

npm run dev
