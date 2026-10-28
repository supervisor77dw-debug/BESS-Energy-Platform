# Schaltet die externe Vorschau ab: Funnel-Freigabe auf 443 entfernen, Server beenden. Andere Tailscale-Serve-Einträge bleiben unberührt.
param([string]$Base = 'C:\dev\bess-preview')
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --https=443 off 2>$null
$pidFile = Join-Path $Base 'server.pid'
if (Test-Path $pidFile) {
  $id = Get-Content $pidFile
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $id -Confirm:$false; Write-Output "Server beendet (PID $id)." }
  Remove-Item $pidFile
}
& 'C:\Program Files\Tailscale\tailscale.exe' funnel status
