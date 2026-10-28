# Startet die geschützte externe Vorschau der BESS Energy Platform.
#   1. Plattformserver nur auf 127.0.0.1 mit Vorschau-Schranke, Secure-Cookies, noindex
#   2. Optional (-Funnel): HTTPS-Freigabe über Tailscale Funnel auf Port 443 (nur dieser Dienst)
# Rückbau: stop-preview.ps1. Laufzeitdaten außerhalb von Dropbox (Standard C:\dev\bess-preview).
param(
  [string]$Base = 'C:\dev\bess-preview',
  [int]$Port = 4711,
  [switch]$Funnel
)
$ErrorActionPreference = 'Stop'
$platform = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runtime = Join-Path $Base 'runtime'
if (-not (Test-Path (Join-Path $runtime 'gate.json'))) { throw "Keine eingerichtete Vorschau in $runtime – zuerst: node tools\provision-preview.mjs --runtime $runtime" }
$pidFile = Join-Path $Base 'server.pid'
if ((Test-Path $pidFile) -and (Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue)) { Write-Output "Server läuft bereits (PID $(Get-Content $pidFile))." }
else {
  $env:BESS_HOST = '127.0.0.1'; $env:BESS_PORT = "$Port"; $env:BESS_DATA_DIR = $runtime; $env:BESS_MODE = 'preview'
  $env:BESS_GATE = '1'; $env:BESS_TRUST_PROXY = '1'; $env:BESS_SECURE_COOKIES = '1'; $env:BESS_PREVIEW_HELPERS = '0'
  $p = Start-Process -FilePath 'node' -ArgumentList "`"$platform\server.mjs`"" -WorkingDirectory $platform -WindowStyle Hidden -PassThru `
       -RedirectStandardOutput (Join-Path $Base 'server.log') -RedirectStandardError (Join-Path $Base 'server.err.log')
  Set-Content -Path $pidFile -Value $p.Id
  Start-Sleep -Seconds 2
  Write-Output "Server gestartet (PID $($p.Id)) auf http://127.0.0.1:$Port"
}
$r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue
if ($r.StatusCode -ne 303) { throw "Schranke antwortet nicht wie erwartet (Status $($r.StatusCode))." }
Write-Output 'Schranke aktiv (unangemeldete Anfrage → 303 zur Vorschau-Anmeldung).'
if ($Funnel) {
  & 'C:\Program Files\Tailscale\tailscale.exe' funnel --bg --https=443 "http://127.0.0.1:$Port"
  & 'C:\Program Files\Tailscale\tailscale.exe' funnel status
}
