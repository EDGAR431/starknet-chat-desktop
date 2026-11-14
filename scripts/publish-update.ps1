# Sube la build de Squirrel al VPS. Ejecutar tras `npm.cmd run make`.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1
param(
  [string]$Server = "root@45.133.178.187",
  [string]$RemoteDir = "/root/desktop-updates/win32/x64"
)
$src = Join-Path $PSScriptRoot "..\out\make\squirrel.windows\x64"
if (-not (Test-Path (Join-Path $src "RELEASES"))) { throw "No hay RELEASES en $src. Ejecute npm.cmd run make primero." }
ssh $Server "mkdir -p $RemoteDir"
# primero los .nupkg y el instalador, y RELEASES el ultimo (asi nadie ve una version a medias)
Get-ChildItem $src -Filter *.nupkg | ForEach-Object { scp $_.FullName "${Server}:${RemoteDir}/" }
Get-ChildItem $src -Filter *.exe   | ForEach-Object { scp $_.FullName "${Server}:${RemoteDir}/" }
scp (Join-Path $src "RELEASES") "${Server}:${RemoteDir}/"
Write-Host "Publicado en $RemoteDir"
