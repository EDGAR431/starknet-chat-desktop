# Publica una version del escritorio (canal directo) con UN solo comando:
#   npm.cmd run release
# Compila, sube al servidor y comprueba que quedo publicado.
# Opciones:  -SkipBuild  (no recompila; sube lo que ya hay en out\make)
param(
  [string]$Server = "root@45.133.178.187",
  [string]$RemoteDir = "/root/stoat/desktop-updates/win32/x64",
  [string]$PublicUrl = "https://starknet-chat.tech/desktop-updates/win32/x64",
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

function Check($what) { if ($LASTEXITCODE -ne 0) { throw "Fallo: $what" } }

$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
Write-Host "== StarkNetChat escritorio $version ==" -ForegroundColor Cyan

# 1. Compilar
if (-not $SkipBuild) {
  Write-Host "[1/4] Compilando (puede tardar unos minutos)..."
  npm.cmd run make
  Check "la compilacion (npm run make)"
} else {
  Write-Host "[1/4] Compilacion omitida (-SkipBuild)"
}

# 2. Comprobar los ficheros de ESTA version
$out      = Join-Path $root "out\make\squirrel.windows\x64"
$releases = Join-Path $out "RELEASES"
$nupkg    = Join-Path $out "StarknetChat-$version-full.nupkg"
$setup    = Join-Path $out "starknetchat-desktop-setup.exe"
foreach ($f in @($releases, $nupkg, $setup)) {
  if (-not (Test-Path $f)) { throw "Falta $f . Compruebe que la version de package.json es la que acaba de compilar." }
}
$releasesText = (Get-Content $releases -Raw).TrimStart([char]0xFEFF).Trim()
if ($releasesText -notmatch [regex]::Escape("StarknetChat-$version-full.nupkg")) {
  throw "El fichero RELEASES no menciona la version $version."
}
Write-Host "[2/4] Ficheros correctos para la version $version"

# 3. Subir: primero paquete e instalador, y RELEASES el ULTIMO
#    (asi ningun cliente ve una version a medias)
Write-Host "[3/4] Subiendo al servidor..."
ssh $Server "mkdir -p $RemoteDir"
Check "crear la carpeta en el servidor"
scp $nupkg $setup "${Server}:${RemoteDir}/"
Check "subir paquete e instalador"
scp $releases "${Server}:${RemoteDir}/"
Check "subir RELEASES"

# 4. Comprobar desde fuera, como lo veria un cliente
Write-Host "[4/4] Comprobando en $PublicUrl ..."
$remote = (Invoke-WebRequest "$PublicUrl/RELEASES" -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" }).Content
if ($remote -is [byte[]]) { $remote = [Text.Encoding]::UTF8.GetString($remote) }
$remote = $remote.TrimStart([char]0xFEFF).Trim()
if ($remote -ne $releasesText) { throw "RELEASES publicado NO coincide con el local." }

$head = Invoke-WebRequest "$PublicUrl/starknetchat-desktop-setup.exe" -Method Head -UseBasicParsing
$localSize = (Get-Item $setup).Length
$remoteSize = [int64]($head.Headers["Content-Length"] | Select-Object -First 1)
if ($remoteSize -ne $localSize) { throw "El instalador publicado ($remoteSize bytes) no coincide con el local ($localSize bytes)." }

Write-Host ""
Write-Host "PUBLICADO: version $version" -ForegroundColor Green
Write-Host "  $PublicUrl/starknetchat-desktop-setup.exe"
Write-Host "Los clientes instalados la recibiran en un maximo de 4 horas."
